/** Register files under a deployment's media root without replacing existing asset metadata. */
import { createHash } from 'node:crypto'
import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path'

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--root' || !isAbsolute(args[1])) {
  throw new Error('Usage: node scripts/prepare-json-render-media.mjs --root /absolute/image/directory')
}
const root = await realpath(args[1])
const indexPath = join(root, 'index.json')
let previous = { assets: [] }
try {
  previous = JSON.parse(await readFile(indexPath, 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
if (!Array.isArray(previous.assets)) throw new Error('Existing index.json must have an assets array')
const existingIds = new Set()
for (const asset of previous.assets) {
  if (typeof asset.id !== 'string' || typeof asset.file !== 'string' || typeof asset.alt !== 'string'
    || existingIds.has(asset.id)) throw new Error('Invalid or duplicate entry in existing index.json')
  existingIds.add(asset.id)
}

const extensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
const files = []
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) await scan(file)
    else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) {
      const info = await stat(file)
      if (info.size === 0 || info.size > 20 * 1024 * 1024) {
        console.warn(`Skipped empty or oversized image: ${relative(root, file)}`)
        continue
      }
      files.push(relative(root, file).split(sep).join('/'))
    }
  }
}
await scan(root)
files.sort()
if (files.length === 0) throw new Error('No supported images found; index.json was not changed')
const assets = [...previous.assets]
for (const file of files) {
  if (assets.some(asset => asset.file === file)) continue
  const id = `frame-${createHash('sha256').update(file).digest('hex').slice(0, 20)}`
  if (existingIds.has(id)) throw new Error(`Asset id collision: ${id}`)
  assets.push({ id, file, alt: basename(file, extname(file)) })
  existingIds.add(id)
}
// Check retained records too; publishing must not grant access outside the configured root.
for (const asset of assets) {
  if (isAbsolute(asset.file)) throw new Error(`Absolute catalog file rejected: ${asset.id}`)
  const resolved = await realpath(join(root, asset.file))
  const child = relative(root, resolved)
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error(`Catalog file outside root: ${asset.id}`)
  }
  if (!(await stat(resolved)).isFile()) throw new Error(`Catalog file is not a regular file: ${asset.id}`)
}
await writeFile(indexPath, JSON.stringify({ ...previous, assets }, null, 2) + '\n')
console.log(`Catalog ready: ${assets.length} images`)
for (const asset of assets.slice(0, 3)) {
  console.log(JSON.stringify({ assetId: asset.id, file: asset.file, url: `/api/media/${asset.id}/content` }))
}
