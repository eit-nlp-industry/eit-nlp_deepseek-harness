// Locate the ffmpeg binary once, independent of any plugin lifecycle.
//
// Resolution order: explicit config -> CAMERA_FFMPEG -> bundled ffmpeg-static
// -> PATH. ffmpeg-static lives in this package's node_modules, so a caller
// passes its own module URL to anchor the lookup when needed.

import { createRequire } from 'node:module'

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
