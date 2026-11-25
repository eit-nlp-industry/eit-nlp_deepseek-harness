// Person store for the vision console.
//
// The saved picture is the FULL frame with a rectangle drawn around the person —
// not a crop — so the record keeps the surroundings (doorway, corridor, group)
// while still pointing at exactly who was meant. Coordinates are normalized
// 0..1 against the frame, matching the bbox the model reports.
//
// ffmpeg's `drawbox` does the drawing: the deployment already runs ffmpeg for
// decoding, so no image library is added.

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/**
 * Paint one bbox onto a JPEG and return the new JPEG bytes.
 *
 * @param {string} ffmpegPath
 * @param {Buffer} jpeg source bytes (the exact frame the model saw)
 * @param {{ x: number, y: number, w: number, h: number }} box normalized 0..1
 * @param {{ color?: string, thickness?: number, timeoutMs?: number }} [options]
 * @returns {Promise<Buffer>}
 */
export function drawBox(ffmpegPath, jpeg, box, options = {}) {
  const color = typeof options.color === 'string' && options.color.length > 0 ? options.color : 'red'
  const thickness = Number.isFinite(options.thickness) ? Math.max(2, Math.round(options.thickness)) : 6
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 8000

  // drawbox wants pixels; the caller normalizes percent against the frame size.
  const x = Math.max(0, Math.round(box.x))
  const y = Math.max(0, Math.round(box.y))
  const w = Math.max(1, Math.round(box.w))
  const h = Math.max(1, Math.round(box.h))

  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'jpeg_pipe', '-i', 'pipe:0',
    '-vf', `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}@0.9:t=${thickness}`,
    '-frames:v', '1',
    '-c:v', 'mjpeg',
    '-q:v', '2',
    '-f', 'image2pipe',
    '-',
  ]

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = []
    const errors = []
    let total = 0
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        proc.kill('SIGKILL')
      } catch {
        // already gone
      }
      reject(new Error('drawbox timed out'))
    }, timeoutMs)

    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }

    proc.stdout.on('data', chunk => {
      total += chunk.length
      if (total > MAX_OUTPUT_BYTES) {
        finish(new Error('boxed image exceeded the size limit'))
        try {
          proc.kill('SIGKILL')
        } catch {
          // already gone
        }
        return
      }
      chunks.push(chunk)
    })
    proc.stderr.on('data', chunk => errors.push(chunk))
    proc.on('error', error => finish(error))
    proc.on('close', code => {
      if (code !== 0) {
        finish(new Error(Buffer.concat(errors).toString('utf8').trim() || `ffmpeg exited with ${code}`))
        return
      }
      finish(null, Buffer.concat(chunks))
    })
    proc.stdin.on('error', () => {})
    proc.stdin.end(jpeg)
  })
}

/** Filesystem-safe directory name for one person. */
export function safeName(name, fallback) {
  if (typeof name !== 'string') return fallback
  const trimmed = name.trim().slice(0, 32)
  return /^[\p{L}\p{N}_-]+$/u.test(trimmed) ? trimmed : fallback
}

/**
 * Persist one person record: the annotated frame plus its metadata sidecar.
 *
 * @param {object} input
 * @param {string} input.dir person-store root
 * @param {Buffer} input.jpeg annotated JPEG
 * @param {{ x: number, y: number, w: number, h: number }} input.box normalized bbox
 * @param {object} input.meta metadata for the sidecar
 * @param {string} input.personId
 * @param {string} input.stamp ISO-ish file stamp
 * @returns {Promise<{ path: string, metaPath: string }>}
 */
export async function savePerson({ dir, jpeg, box, meta, personId, stamp }) {
  const directory = join(dir, personId)
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${stamp}.jpg`)
  const metaPath = join(directory, `${stamp}.json`)
  await writeFile(path, jpeg)
  await writeFile(metaPath, `${JSON.stringify({ ...meta, personId, bbox: box, file: path }, null, 2)}\n`, 'utf8')
  return { path, metaPath }
}
