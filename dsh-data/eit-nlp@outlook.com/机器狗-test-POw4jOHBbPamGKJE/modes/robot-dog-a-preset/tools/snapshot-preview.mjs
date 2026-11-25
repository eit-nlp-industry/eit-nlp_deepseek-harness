// Dev-only preview: render one look from a still 360 image without starting DSH.
//
//   node tools/snapshot-preview.mjs <input.jpg> [output.jpg] [yaw] [pitch] [fov] [width]
//
// Example:
//   node tools/snapshot-preview.mjs "/data/.../Instant Snapshot/test.jpg" /tmp/look.jpg 90 0 90 768

import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

import { imageFormat, project } from '../v360.js'

function resolveFfmpeg() {
  if (process.env.CAMERA_FFMPEG) return process.env.CAMERA_FFMPEG
  try {
    const require = createRequire(import.meta.url)
    const statics = require('ffmpeg-static')
    if (typeof statics === 'string' && statics.length > 0) return statics
  } catch {
    // fall through to PATH
  }
  return 'ffmpeg'
}

const [input, output = '/tmp/snapshot-look.jpg', yaw = '0', pitch = '0', fov = '90', width = '768']
  = process.argv.slice(2)

if (input === undefined) {
  console.error('usage: node tools/snapshot-preview.mjs <input.jpg> [output.jpg] [yaw] [pitch] [fov] [width]')
  process.exit(2)
}

const bytes = await readFile(input)
const jpeg = await project(resolveFfmpeg(), bytes, {
  yaw: Number(yaw),
  pitch: Number(pitch),
  fov: Number(fov),
  width: Number(width),
  inputFormat: imageFormat(bytes),
})
await writeFile(output, jpeg)
console.log(JSON.stringify({ output, bytes: jpeg.length, yaw: Number(yaw), pitch: Number(pitch), fov: Number(fov), width: Number(width) }))
