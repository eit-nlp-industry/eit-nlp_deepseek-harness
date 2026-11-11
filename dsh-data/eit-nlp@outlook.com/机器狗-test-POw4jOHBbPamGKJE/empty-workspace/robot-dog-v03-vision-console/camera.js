// Video decoder for the vision console.
//
// Same proven ffmpeg approach as the robot-dog-test bundle: a realtime MJPEG
// stream on stdout, split on JPEG SOI/EOI markers, keeping only the latest frame.
// Kept local so the console bundle has no dependency on any preset bundle.

import { spawn } from 'node:child_process'

const SOI = Buffer.from([0xff, 0xd8])
const EOI = Buffer.from([0xff, 0xd9])
const MAX_FRAME_BYTES = 16 * 1024 * 1024
const MAX_PENDING_BYTES = 32 * 1024 * 1024
const MIN_RESTART_MS = 1_000
const MAX_RESTART_MS = 30_000

export function createCamera(config, logger) {
  let latest = null
  let child = null
  let pending = Buffer.alloc(0)
  let running = false
  let sequence = 0
  let lastError = ''
  let restartTimer = null
  let restartDelay = MIN_RESTART_MS
  let startedAt = null

  function noteError(message) {
    lastError = String(message ?? '').slice(0, 400)
    try {
      logger?.warn?.(`[vision-console-v03] ${lastError}`)
    } catch {
      // logging must never break the loop
    }
  }

  function args() {
    return [
      '-hide_banner', '-loglevel', 'error',
      '-re',
      ...(config.loop ? ['-stream_loop', '-1'] : []),
      '-an',
      '-i', config.videoPath,
      '-vf', `fps=${config.captureFps},scale=${config.maxWidth}:-2`,
      '-c:v', 'mjpeg',
      '-q:v', String(config.jpegQuality),
      '-f', 'image2pipe',
      '-',
    ]
  }

  function accept(chunk) {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
    for (;;) {
      const start = pending.indexOf(SOI)
      if (start < 0) {
        pending = Buffer.alloc(0)
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
        noteError(`frame too large (${frame.length} bytes)`)
        continue
      }
      sequence += 1
      latest = { jpeg: frame, sequence, capturedAt: Date.now() }
    }
  }

  function scheduleRestart() {
    if (!running || restartTimer !== null) return
    restartTimer = setTimeout(() => {
      restartTimer = null
      launch()
    }, restartDelay)
    restartTimer.unref?.()
    restartDelay = Math.min(restartDelay * 2, MAX_RESTART_MS)
  }

  function launch() {
    if (!running || child !== null) return
    pending = Buffer.alloc(0)
    const proc = spawn(config.ffmpegPath, args(), { stdio: ['ignore', 'pipe', 'pipe'] })
    child = proc
    const stale = () => child !== proc

    proc.stdout.on('data', chunk => {
      if (stale()) return
      try {
        accept(chunk)
      } catch (error) {
        noteError(`frame parse failed: ${error instanceof Error ? error.message : String(error)}`)
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
      noteError(error?.code === 'ENOENT'
        ? `ffmpeg not found: ${config.ffmpegPath}`
        : `ffmpeg error: ${error instanceof Error ? error.message : String(error)}`)
    })

    proc.on('spawn', () => {
      restartDelay = MIN_RESTART_MS
      startedAt = Date.now()
      lastError = ''
    })

    proc.on('exit', (code, signal) => {
      if (stale()) return
      child = null
      if (!running) return
      noteError(lastError || `ffmpeg exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`)
      scheduleRestart()
    })
  }

  /** Drop the current process and, when live, start one on the configured file. */
  function restart() {
    const proc = child
    child = null
    pending = Buffer.alloc(0)
    latest = null
    if (proc !== null) {
      try {
        proc.kill('SIGTERM')
      } catch {
        // already gone
      }
    }
    if (running) launch()
  }

  /**
   * Decode another file without restarting the push loop. The frame sequence
   * stays monotonic so already-pushed frame ids never alias new pixels.
   */
  function setVideoPath(nextPath) {
    const value = typeof nextPath === 'string' ? nextPath.trim() : ''
    if (value.length === 0 || value === config.videoPath) return false
    config.videoPath = value
    lastError = ''
    restart()
    return true
  }

  function start() {
    if (running) return
    running = true
    launch()
  }

  function stop() {
    running = false
    if (restartTimer !== null) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
    if (child !== null) {
      const proc = child
      child = null
      try {
        proc.kill('SIGTERM')
      } catch {
        // already gone
      }
    }
    latest = null
    pending = Buffer.alloc(0)
  }

  return {
    start,
    stop,
    setVideoPath,
    latest: () => latest,
    status: () => ({
      running,
      sequence,
      lastFrameAt: latest?.capturedAt ?? null,
      lastError,
      startedAt,
      videoPath: config.videoPath,
    }),
  }
}
