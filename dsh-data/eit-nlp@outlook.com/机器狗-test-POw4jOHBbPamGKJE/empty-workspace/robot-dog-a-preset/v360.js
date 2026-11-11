// Shared equirectangular -> rectilinear projection.
//
// Both camera sources converge here: the live frame from the video provider and
// a still snapshot both go through the same v360 pipeline, so "look at yaw/pitch"
// behaves identically no matter where the pixels came from.

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

/**
 * Resolve the ffmpeg binary independently of the video provider, so snapshot
 * projection keeps working while camera-provider is disabled.
 */
export function resolveFfmpeg(explicit) {
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

export const FFMPEG_TIMEOUT_MS = 5_000
export const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

/** Wrap any angle into [-180, 180). */
export function wrapYaw(value) {
  return ((value + 180) % 360 + 360) % 360 - 180
}

export function numberParam(params, key, fallback, min, max) {
  const raw = params instanceof URLSearchParams ? params.get(key) : params?.[key]
  if (raw === null || raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${key} must be a number in [${min}, ${max}]`)
  }
  return value
}

export function normalizeLook(params) {
  return {
    yaw: numberParam(params, 'yaw', 0, -180, 180),
    pitch: numberParam(params, 'pitch', 0, -90, 90),
    fov: numberParam(params, 'fov', 90, 10, 180),
    width: Math.round(numberParam(params, 'width', 768, 160, 1600)),
  }
}

/** Detect the pipe format ffmpeg needs for a still image buffer. */
export function imageFormat(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg_pipe'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png_pipe'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp_pipe'
  return null
}

export function project(ffmpeg, bytes, { yaw, pitch, fov, width, inputFormat }) {
  return new Promise((resolve, reject) => {
    const height = Math.round(width * 9 / 16)
    const filter = `v360=e:flat:yaw=${yaw}:pitch=${pitch}:h_fov=${fov}:w=${width}:h=${height}`
    const args = [
      '-hide_banner', '-loglevel', 'error',
      ...(inputFormat === null || inputFormat === undefined ? [] : ['-f', inputFormat]),
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
    let bytesOut = 0
    let settled = false

    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }

    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      finish(new Error('v360 projection timed out'))
    }, FFMPEG_TIMEOUT_MS)

    proc.stdout.on('data', chunk => {
      bytesOut += chunk.length
      if (bytesOut > MAX_OUTPUT_BYTES) {
        proc.kill('SIGKILL')
        finish(new Error('v360 output exceeded the size limit'))
        return
      }
      chunks.push(chunk)
    })
    proc.stderr.on('data', chunk => errors.push(chunk))

    proc.on('error', error => finish(error))
    proc.on('close', code => {
      if (code !== 0) {
        finish(new Error(errors.join('').trim() || `ffmpeg exited with ${code}`))
        return
      }
      const out = Buffer.concat(chunks)
      if (out.length === 0) {
        finish(new Error('v360 produced an empty frame'))
        return
      }
      finish(null, out)
    })

    proc.stdin.on('error', () => {
      // ffmpeg may close stdin early; close reports the real failure.
    })
    proc.stdin.end(bytes)
  })
}
