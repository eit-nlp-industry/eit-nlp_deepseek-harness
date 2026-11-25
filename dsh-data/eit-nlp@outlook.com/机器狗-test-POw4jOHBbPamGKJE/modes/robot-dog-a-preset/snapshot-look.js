// Snapshot source: the still 360 images on disk.
//
//   snapshot.list()   -> { directory, items: [{ id, bytes, modifiedAt }] }
//   snapshot.read(id) -> { id, jpeg }   raw bytes, no projection
//
// Projection lives in camera_look; this service only answers "which file".

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

export const name = 'snapshot-look'
export const inject = []

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024

function parseConfig(config) {
  if (typeof config?.directory !== 'string' || !config.directory.startsWith('/')) {
    throw new TypeError('snapshot-look: config.directory must be an absolute path')
  }
  return {
    directory: resolve(config.directory),
    maxBytes: config.maxBytes ?? DEFAULT_MAX_BYTES,
  }
}

function isSafeId(id) {
  return typeof id === 'string'
    && id.length > 0
    && id.length <= 255
    && !id.includes('/')
    && !id.includes('\\')
    && id !== '.'
    && id !== '..'
}

export function apply(ctx, rawConfig = {}) {
  const config = parseConfig(rawConfig)

  function insideDirectory(path) {
    return path === config.directory || path.startsWith(`${config.directory}${sep}`)
  }

  async function list() {
    const entries = await readdir(config.directory, { withFileTypes: true })
    const items = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const extension = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
      if (!IMAGE_EXTENSIONS.has(extension)) continue
      try {
        const info = await stat(join(config.directory, entry.name))
        items.push({ id: entry.name, bytes: info.size, modifiedAt: info.mtime.toISOString() })
      } catch {
        // The file may disappear between readdir and stat; skip it.
      }
    }
    items.sort((a, b) => a.id.localeCompare(b.id))
    return { directory: config.directory, items }
  }

  async function read(id) {
    const target = id ?? (await list()).items[0]?.id
    if (!isSafeId(target)) {
      throw new RangeError('id must be a file name inside the snapshot directory')
    }
    const path = resolve(join(config.directory, target))
    if (!insideDirectory(path)) throw new RangeError('id escapes the snapshot directory')

    const info = await stat(path)
    if (!info.isFile()) throw new Error(`SNAPSHOT_NOT_FOUND: ${target}`)
    if (info.size > config.maxBytes) throw new Error(`SNAPSHOT_TOO_LARGE: ${target}`)
    return { id: target, jpeg: await readFile(path) }
  }

  ctx.root.provide('snapshot', {
    directory: config.directory,
    list,
    read,
  })
}
