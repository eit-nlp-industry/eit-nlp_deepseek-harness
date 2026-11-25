// Same-origin SSE for MapPreview live tracking: GET /api/location?trackId=…
//
// Access control: trackId must already exist in the in-memory registry
// (EventSource cannot send custom Authorization).
// Static looping demos: patrol-42, quiet-ab-01.
// One-shot escort tracks are allocated at runtime via motionTrackRegistry
// (unique trackId); allocating a new one freezes other one-shot tracks.

import { randomBytes } from 'node:crypto'

export const name = 'location-api'
export const inject = ['webServer']

// 循环演示轨与带路单程轨：1 帧/秒，单程 300 步（约 5 分钟）。
const FRAME_INTERVAL_MS = 1000
const STEPS_ONE_WAY = 300
const ESCORT_FRAME_INTERVAL_MS = FRAME_INTERVAL_MS
const ESCORT_STEPS_ONE_WAY = STEPS_ONE_WAY

const PATROL_START = { x: 22, y: 62, heading: 50 }
const OFFICE = { x: 62, y: 42, heading: 230 }

// 与 v0.3 query_place（location-mock）一致：用户指定坐标。
const QUIET_START = { x: 0, y: 50, heading: 160 }
const STUDY_A = { x: 4, y: 70, heading: 140 }
const STUDY_B = { x: 15, y: 85, heading: 320 }

function lerpPath(from, to, heading, steps) {
  const frames = []
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    frames.push({
      x: Number((from.x + (to.x - from.x) * t).toFixed(2)),
      y: Number((from.y + (to.y - from.y) * t).toFixed(2)),
      heading,
      status: 'moving',
    })
  }
  return frames
}

function loopFrames(a, b, outHeading, backHeading) {
  return [
    ...lerpPath(a, b, outHeading, STEPS_ONE_WAY),
    ...lerpPath(b, a, backHeading, STEPS_ONE_WAY),
  ]
}

function oneShotSpec(from, to, heading) {
  const start = {
    x: from.x,
    y: from.y,
    heading: Number.isFinite(from.heading) ? from.heading : heading,
  }
  return {
    start,
    once: true,
    frameIntervalMs: ESCORT_FRAME_INTERVAL_MS,
    frames: [
      ...lerpPath(start, to, heading, ESCORT_STEPS_ONE_WAY),
      { x: to.x, y: to.y, heading, status: 'arrived' },
    ],
  }
}

const STATIC_TRACK_SPECS = Object.freeze({
  'patrol-42': {
    start: PATROL_START,
    frames: loopFrames(PATROL_START, OFFICE, 50, 230),
  },
  'quiet-ab-01': {
    start: QUIET_START,
    frames: [
      ...lerpPath(QUIET_START, STUDY_A, 160, STEPS_ONE_WAY),
      ...loopFrames(STUDY_A, STUDY_B, 140, 320),
    ],
  },
})

function jsonResponse(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(payload.byteLength),
  })
  res.end(payload)
}

function formatSse(frame) {
  return `event: position\ndata: ${JSON.stringify(frame)}\n\n`
}

function createTrack(trackId, spec) {
  const once = spec.once === true
  const frameIntervalMs = Number.isFinite(spec.frameIntervalMs) && spec.frameIntervalMs > 0
    ? spec.frameIntervalMs
    : FRAME_INTERVAL_MS
  const track = {
    trackId,
    seq: 0,
    x: spec.start.x,
    y: spec.start.y,
    heading: spec.start.heading,
    status: 'idle',
    version: 0,
    subscribers: new Set(),
    timer: undefined,
    frameIndex: 0,
  }
  const frames = spec.frames

  function snapshot() {
    const body = {
      trackId: track.trackId,
      seq: track.seq,
      x: track.x,
      y: track.y,
      status: track.status,
    }
    if (typeof track.heading === 'number') body.heading = track.heading
    return body
  }

  function publish() {
    track.version += 1
    for (const write of track.subscribers) write(snapshot())
  }

  function stopTicker() {
    if (track.timer !== undefined) {
      clearTimeout(track.timer)
      track.timer = undefined
    }
  }

  function resetOnce() {
    track.frameIndex = 0
    track.x = spec.start.x
    track.y = spec.start.y
    track.heading = spec.start.heading
    track.status = 'idle'
  }

  function tick() {
    stopTicker()
    if (once && track.frameIndex >= frames.length) return
    track.timer = setTimeout(() => {
      track.timer = undefined
      const frame = once
        ? frames[track.frameIndex]
        : frames[track.frameIndex % frames.length]
      track.frameIndex += 1
      track.seq += 1
      track.x = frame.x
      track.y = frame.y
      track.heading = frame.heading
      track.status = frame.status
      publish()
      if (once && track.frameIndex >= frames.length) return
      tick()
    }, frameIntervalMs)
  }

  function ensureRunning() {
    if (once && track.frameIndex >= frames.length) resetOnce()
    if (track.timer === undefined) tick()
  }

  /** Stop playback and keep the dog at the current coordinates (status idle). */
  function freeze() {
    stopTicker()
    if (track.status === 'arrived') return
    if (track.status === 'idle' && track.frameIndex === 0) return
    track.status = 'idle'
    track.frameIndex = frames.length
    track.seq += 1
    publish()
  }

  return { track, once, snapshot, publish, ensureRunning, stopTicker, freeze }
}

function point(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} is required`)
  const x = Number(value.x)
  const y = Number(value.y)
  if (!Number.isFinite(x) || x < 0 || x > 100 || !Number.isFinite(y) || y < 0 || y > 100) {
    throw new TypeError(`${label} must be finite x/y in 0–100`)
  }
  return { x, y }
}

export function apply(ctx) {
  const tracks = new Map()
  for (const [id, spec] of Object.entries(STATIC_TRACK_SPECS)) {
    tracks.set(id, createTrack(id, spec))
  }

  function freezeOtherOneShots(exceptId) {
    for (const [id, other] of tracks) {
      if (id !== exceptId && other.once) other.freeze()
    }
  }

  const registry = {
    /**
     * Allocate a unique one-shot track and freeze other one-shot tracks.
     * @param {{ start: { x: number, y: number }, end: { x: number, y: number }, heading?: number }} input
     */
    allocateOneShot(input) {
      const start = point(input?.start, 'start')
      const end = point(input?.end, 'end')
      const heading = Number.isFinite(input?.heading)
        ? Number(input.heading)
        : Math.atan2(end.y - start.y, end.x - start.x) * (180 / Math.PI)
      const normalizedHeading = ((heading % 360) + 360) % 360
      const trackId = `escort-${randomBytes(8).toString('hex')}`
      const entry = createTrack(trackId, oneShotSpec(start, end, normalizedHeading))
      freezeOtherOneShots(trackId)
      tracks.set(trackId, entry)
      return {
        track_id: trackId,
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y },
      }
    },
  }

  ctx.root.provide('motionTrackRegistry', registry)

  ctx.effect(() => () => {
    for (const entry of tracks.values()) entry.stopTicker()
  }, 'location-api: stop tickers')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/location',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' })
        res.end()
        return
      }

      const url = new URL(req.url ?? '/', 'http://localhost')
      const trackId = (url.searchParams.get('trackId') ?? '').trim()
      if (trackId.length === 0) {
        jsonResponse(res, 400, { error: 'trackId required' })
        return
      }
      const entry = tracks.get(trackId)
      if (!entry) {
        jsonResponse(res, 403, { error: 'trackId not allowed' })
        return
      }

      try {
        const fs = await import('node:fs')
        fs.appendFileSync(
          '/data/dsh/eit-nlp@outlook.com/机器狗-test-POw4jOHBbPamGKJE/modes/scripts/location-api/connect.log',
          `${new Date().toISOString()} ua=${req.headers['user-agent'] ?? ''} trackId=${trackId}\n`,
        )
      } catch { /* ignore logging failures */ }

      if (entry.once) freezeOtherOneShots(trackId)
      entry.ensureRunning()

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })

      let closed = false
      const write = (frame) => {
        if (closed) return
        try {
          res.write(formatSse(frame))
          if (typeof res.flush === 'function') res.flush()
        } catch {
          closed = true
          entry.track.subscribers.delete(write)
        }
      }

      entry.track.subscribers.add(write)
      write(entry.snapshot())

      const keepalive = setInterval(() => {
        if (closed) return
        try {
          res.write(': keepalive\n\n')
        } catch {
          closed = true
          entry.track.subscribers.delete(write)
          clearInterval(keepalive)
        }
      }, 15000)

      const onClose = () => {
        if (closed) return
        closed = true
        clearInterval(keepalive)
        entry.track.subscribers.delete(write)
      }
      req.on('close', onClose)
      res.on('close', onClose)
    },
  }), 'location-api: /api/location')
}
