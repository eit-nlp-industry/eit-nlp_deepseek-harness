// Camera Provider (step 1): decode a local video like a live camera and keep
// only the latest complete equirectangular frame in memory.
//
// Nothing here touches the model or the robot yet. The frame is exposed over
// HTTP so the pipeline can be verified independently:
//   GET /camera/latest.jpg   -> current frame (503 while the decoder is down)
//   GET /camera/status.json  -> seq / ageMs / stale / last error
//
// The service is also provided as `camera` for later tools (camera_look,
// camera_latest) to consume via ctx.get('camera').

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const name = 'camera-provider'
export const inject = []

const SOI = Buffer.from([0xff, 0xd8])
const EOI = Buffer.from([0xff, 0xd9])
const MAX_FRAME_BYTES = 16 * 1024 * 1024
const MAX_PENDING_BYTES = 32 * 1024 * 1024
const MIN_RESTART_MS = 1_000
const MAX_RESTART_MS = 30_000

function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(payload.byteLength),
  })
  res.end(payload)
}

function resolveFfmpeg(explicit) {
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  if (process.env.CAMERA_FFMPEG) return process.env.CAMERA_FFMPEG
  try {
    const require = createRequire(import.meta.url)
    const statics = require('ffmpeg-static')
    if (typeof statics === 'string' && statics.length > 0) return statics
  } catch {
    // ffmpeg-static is optional; fall back to PATH.
  }
  return 'ffmpeg'
}

function parseConfig(config) {
  if (typeof config?.video !== 'string' || !config.video.startsWith('/')) {
    throw new TypeError('camera-provider: config.video must be an absolute path')
  }
  const fps = config.fps ?? 5
  if (!Number.isFinite(fps) || fps <= 0 || fps > 60) {
    throw new TypeError('camera-provider: config.fps must be in (0, 60]')
  }
  const width = config.width ?? 1920
  if (!Number.isSafeInteger(width) || width < 160 || width > 8192) {
    throw new TypeError('camera-provider: config.width must be a safe integer in [160, 8192]')
  }
  const quality = config.quality ?? 4
  if (!Number.isSafeInteger(quality) || quality < 2 || quality > 31) {
    throw new TypeError('camera-provider: config.quality must be in [2, 31]')
  }
  const prefix = config.path ?? '/camera'
  if (typeof prefix !== 'string' || !prefix.startsWith('/') || prefix.endsWith('/')) {
    throw new TypeError('camera-provider: config.path must start with "/" and not end with "/"')
  }
  return {
    video: config.video,
    fps,
    width,
    quality,
    prefix,
    ffmpeg: resolveFfmpeg(config.ffmpegPath),
    staleMs: config.staleMs ?? 3_000,
    // `-re` stops throttling after the first `-stream_loop` pass, so the clip
    // is replayed by restarting the process instead (see `loop`).
    loop: config.loop === true,
  }
}

export function apply(ctx, rawConfig = {}) {
  const config = parseConfig(rawConfig)

  let child = null
  let frames = 0
  let position = 0
  let latest = null
  let finished = false
  let pending = Buffer.alloc(0)
  let lastFrameAt = 0
  let lastError = ''
  let restartDelay = MIN_RESTART_MS
  let restartTimer = null
  let stopped = false
  let durationSec = Number.isFinite(config.videoDurationSec) ? config.videoDurationSec : null

  // Position inside the current play-through (0-based per decoder start).
  function videoTime() {
    return position / config.fps
  }

  function probeDuration() {
    try {
      const probe = spawn(config.ffmpeg, ['-hide_banner', '-i', config.video])
      let output = ''
      probe.stderr?.on('data', (chunk) => {
        if (output.length < 65_536) output += String(chunk)
      })
      probe.on('close', () => {
        const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(output)
        if (match !== null) {
          durationSec = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
        }
      })
      probe.on('error', () => {})
    } catch {
      // Duration is optional; without it videoSeconds stays cumulative.
    }
  }

  function state() {
    const ageMs = lastFrameAt === 0 ? null : Date.now() - lastFrameAt
    return {
      ok: latest !== null && ageMs !== null && ageMs <= config.staleMs,
      video: config.video,
      ffmpeg: config.ffmpeg,
      seq: frames,
      videoSeconds: videoTime(),
      durationSec,
      finished,
      ageMs,
      stale: latest === null || (ageMs !== null && ageMs > config.staleMs),
      lastFrameAt: lastFrameAt === 0 ? null : new Date(lastFrameAt).toISOString(),
      error: lastError || null,
    }
  }

  function acceptChunk(chunk) {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])

    for (;;) {
      const start = pending.indexOf(SOI)
      if (start < 0) {
        // Keep one byte: a marker split across chunks must not be lost.
        pending = pending.subarray(Math.max(0, pending.length - 1))
        return
      }
      if (start > 0) pending = pending.subarray(start)

      const end = pending.indexOf(EOI, SOI.length)
      if (end < 0) {
        if (pending.length > MAX_PENDING_BYTES) pending = Buffer.alloc(0)
        return
      }

      const frame = Buffer.from(pending.subarray(0, end + EOI.length))
      pending = pending.subarray(end + EOI.length)

      if (frame.length > MAX_FRAME_BYTES) {
        lastError = `frame too large (${frame.length} bytes)`
        continue
      }
      const now = Date.now()
      frames += 1
      position += 1
      lastFrameAt = now
      latest = { jpeg: frame, seq: frames, capturedAt: lastFrameAt, videoSeconds: videoTime() }
    }
  }

  function start() {
    if (stopped) return
    // Both counters describe the current play-through, so `frameSeq` and
    // `videoSeconds` always agree (videoSeconds = frameSeq / fps).
    frames = 0
    position = 0
    finished = false
    pending = Buffer.alloc(0)
    const args = [
      '-hide_banner', '-loglevel', 'error',
      // Official realtime throttle.
      '-re',
      ...(config.loop ? ['-stream_loop', '-1'] : []),
      '-an',
      '-i', config.video,
      '-vf', `fps=${config.fps},scale=${config.width}:-2`,
      '-c:v', 'mjpeg',
      '-q:v', String(config.quality),
      '-f', 'image2pipe',
      '-',
    ]

    let proc
    try {
      proc = spawn(config.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      lastError = `spawn failed: ${error instanceof Error ? error.message : String(error)}`
      scheduleRestart()
      return
    }

    child = proc

    // Frames from a killed decoder can still arrive while the new one starts;
    // ignoring anything whose process is no longer `child` keeps frame counts
    // aligned with the clip actually being played.
    const stale = () => child !== proc

    proc.stdout.on('data', chunk => {
      if (stale()) return
      try {
        acceptChunk(chunk)
      } catch (error) {
        lastError = `frame parse failed: ${error instanceof Error ? error.message : String(error)}`
        pending = Buffer.alloc(0)
      }
    })

    proc.stderr.on('data', chunk => {
      if (stale()) return
      const text = chunk.toString('utf8').trim()
      if (text.length > 0) lastError = text.slice(0, 400)
    })

    proc.on('error', error => {
      if (stale()) return
      lastError = error?.code === 'ENOENT'
        ? `ffmpeg not found: ${config.ffmpeg} (install ffmpeg or set config.ffmpegPath / CAMERA_FFMPEG)`
        : `ffmpeg error: ${error instanceof Error ? error.message : String(error)}`
      ctx.logger?.warn?.(`[camera] ${lastError}`)
    })

    proc.on('exit', (code, signal) => {
      // A superseded process must not settle the current one's state.
      if (stale()) return
      child = null
      if (stopped) return
      if (code === 0) {
        // Clip finished. By default it stays finished: the last frame remains
        // available and only an explicit reset/restart replays it.
        lastError = ''
        if (config.loop === true) {
          scheduleRestart()
        } else {
          finished = true
          ctx.logger?.info?.('[camera] clip finished; decoding stopped')
        }
        return
      }
      lastError = lastError || `ffmpeg exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
      ctx.logger?.warn?.(`[camera] ${lastError}`)
      scheduleRestart()
    })

    proc.on('spawn', () => {
      restartDelay = MIN_RESTART_MS
      lastError = ''
      ctx.logger?.info?.(`[camera] decoding ${config.video} at ${config.fps}fps, width ${config.width}`)
    })
  }

  function scheduleRestart() {
    if (stopped || restartTimer !== null) return
    const delay = restartDelay
    restartDelay = Math.min(MAX_RESTART_MS, Math.round(restartDelay * 1.7))
    restartTimer = setTimeout(() => {
      restartTimer = null
      start()
    }, delay)
    restartTimer.unref?.()
  }

  function stop() {
    stopped = true
    if (restartTimer !== null) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
    if (child !== null) {
      try {
        child.kill('SIGTERM')
      } catch {
        // already gone
      }
      child = null
    }
    latest = null
  }

  // Restart decoding from the first frame. `start()` zeroes both frame
  // counters, so `frameSeq` and `videoSeconds` restart together.
  function restart() {
    stop()
    pending = Buffer.alloc(0)
    lastError = ''
    restartDelay = MIN_RESTART_MS
    stopped = false
    start()
    return { restarted: true }
  }

  // Pause keeps the counter at zero and stops producing frames; the next
  // resume starts decoding from the clip's first frame.
  function pause() {
    stop()
    pending = Buffer.alloc(0)
    return { paused: true }
  }

  function resume() {
    if (!stopped) return { resumed: false }
    pending = Buffer.alloc(0)
    lastError = ''
    restartDelay = MIN_RESTART_MS
    stopped = false
    start()
    return { resumed: true }
  }

  const camera = {
    status: state,
    latest() {
      return latest
    },
    restart,
    pause,
    resume,
  }

  ctx.root.provide('camera', camera)
  ctx.effect(() => {
    probeDuration()
    start()
    return stop
  }, 'camera-provider: decode loop')
}
