// Camera Look: reproject the latest equirectangular frame into a rectilinear
// (perspective) view, like a virtual pan-tilt head.
//
//   GET /camera/look.jpg?yaw=0&pitch=-5&fov=90&width=768
//
// yaw   -180..180  (0 = calibrated forward direction)
// pitch  -90..90   (negative looks down)
// fov     10..180  horizontal field of view
// width  160..1600 output width; height follows 16:9
//
// With mode "flat" the filter is skipped and the raw frame is returned, for
// sources that were already reframed by the camera app.

import { spawn } from 'node:child_process'

export const name = 'camera-look'
export const inject = []

const FFMPEG_TIMEOUT_MS = 5_000
const CACHE_LIMIT = 32

function bad(res, code, message) {
  const body = Buffer.from(JSON.stringify({ error: { code, message } }))
  res.writeHead(400, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(body.byteLength),
  })
  res.end(body)
}

function numberParam(params, key, fallback, min, max) {
  const raw = params.get(key)
  if (raw === null || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${key} must be a number in [${min}, ${max}]`)
  }
  return value
}

function project(ffmpeg, jpeg, { yaw, pitch, fov, width }) {
  return new Promise((resolve, reject) => {
    const filter = `v360=e:flat:yaw=${yaw}:pitch=${pitch}:h_fov=${fov}:w=${width}:h=${Math.round(width * 9 / 16)}`
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'jpeg_pipe',
      '-i', 'pipe:0',
      '-vf', filter,
      '-frames:v', '1',
      '-c:v', 'mjpeg', '-q:v', '4',
      '-f', 'image2pipe',
      '-',
    ]
    const proc = spawn(ffmpeg, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = []
    const errors = []
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('v360 projection timed out'))
    }, FFMPEG_TIMEOUT_MS)

    proc.stdout.on('data', chunk => chunks.push(chunk))
    proc.stderr.on('data', chunk => errors.push(chunk))

    proc.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })

    proc.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(errors.join('').trim() || `ffmpeg exited with ${code}`))
        return
      }
      const out = Buffer.concat(chunks)
      if (out.length === 0) {
        reject(new Error('v360 produced an empty frame'))
        return
      }
      resolve(out)
    })

    proc.stdin.on('error', () => {
      // ffmpeg may close stdin early; the close handler reports the real error.
    })
    proc.stdin.end(jpeg)
  })
}

export function apply(ctx, config = {}) {
  const path = config.path ?? '/camera/look.jpg'
  const mode = config.mode ?? 'equirect'
  const cacheMs = config.cacheMs ?? 1_000
  const cache = new Map()

  async function look(frame, params) {
    const yaw = numberParam(params, 'yaw', 0, -180, 180)
    const pitch = numberParam(params, 'pitch', 0, -90, 90)
    const fov = numberParam(params, 'fov', 90, 10, 180)
    const width = Math.round(numberParam(params, 'width', 768, 160, 1600))

    if (mode === 'flat') return { jpeg: frame.jpeg, yaw, pitch, fov, width }

    const key = `${frame.seq}:${yaw}:${pitch}:${fov}:${width}`
    const hit = cache.get(key)
    if (hit !== undefined && Date.now() - hit.at <= cacheMs) {
      return { jpeg: hit.jpeg, yaw, pitch, fov, width }
    }

    const ffmpeg = ctx.get('camera')?.status?.()?.ffmpeg ?? 'ffmpeg'
    const jpeg = await project(ffmpeg, frame.jpeg, { yaw, pitch, fov, width })
    cache.set(key, { at: Date.now(), jpeg })
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value
      cache.delete(oldest)
    }
    return { jpeg, yaw, pitch, fov, width }
  }

  // Debug HTTP route removed; the projection is exposed as a service that the
  // camera tools will call. Params: { yaw, pitch, fov, width }.
  const cameraLook = {
    mode,
    async look(params = {}) {
      const frame = ctx.get('camera')?.latest?.()
      if (frame === null || frame === undefined) {
        throw new Error('CAMERA_UNAVAILABLE: no frame decoded yet')
      }
      const query = new URLSearchParams(
        Object.entries(params).map(([key, value]) => [key, String(value)]),
      )
      return look(frame, query)
    },
  }

  ctx.root.provide('cameraLook', cameraLook)
}
