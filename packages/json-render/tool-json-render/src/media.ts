/**
 * Catalog-backed images for json-render. Disk files stay behind asset ids.
 * Callers receive `/api/media/<id>/content` and the browser loads that path
 * with the existing login cookie. The route never accepts a client path.
 */

import { realpathSync, statSync } from 'node:fs'
import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'

const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/
const MEDIA_PATH = /^\/api\/media\/([A-Za-z0-9][A-Za-z0-9._-]{0,80})\/content$/
const PRIVATE_KEYS = new Set(['file', 'path', 'owner', 'token', 'authorization', 'password', 'component', 'type'])

/** Inclusive byte cap for one image response. Matches the attachment image cap. */
const MEDIA_MAX_BYTES = 20 * 1024 * 1024

/**
 * Process filesystem operations used to resolve catalog files.
 * Replacing a method changes how later reads resolve links and missing files.
 */
export const mediaFiles = {
  lstat,
  readFile,
  realpath,
  stat,
}

/** One catalog row. `file` is relative to the media root and is not sent to clients. */
export interface MediaAssetRecord {
  readonly id: string
  readonly file: string
  readonly alt: string
  readonly caption?: string
  readonly owner?: string
}

/** The media catalog cannot be used. The message names no directory. */
export class MediaCatalogError extends Error {
  constructor() {
    super('tool-json-render: media catalog is invalid')
  }
}

interface MediaWebServer {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

interface MediaConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/**
 * Browser path for one catalog id. The id is copied, not encoded.
 * @param id - catalog id, already a single safe segment.
 * @returns root-relative content path.
 */
export function mediaContentPath(id: string): string {
  return `/api/media/${id}/content`
}

/**
 * Public image facts for a catalog row.
 * @param asset - catalog row whose id, alt, and caption may be shown.
 * @returns `business_data` containing only src, alt, and an optional caption.
 */
export function imageBusinessData(asset: MediaAssetRecord): {
  image: { src: string; alt: string; caption?: string }
} {
  return { image: publicImage(asset) }
}

/**
 * Whether `data.image` names an asset or a source string.
 * @param data - tool `business_data`.
 * @returns true when the value carries an image reference.
 */
export function referencesImage(data: unknown): boolean {
  return imageFields(data) !== undefined
}

/**
 * Catalog rows this deployment may show. A row with no owner is shared.
 * @param assets - rows from `index.json`.
 * @param owner - deployment owner. Empty matches only shared rows.
 * @returns rows whose owner is absent or equal to `owner`.
 */
export function visibleAssets(assets: readonly MediaAssetRecord[], owner: string): readonly MediaAssetRecord[] {
  return assets.filter(asset => asset.owner === undefined || asset.owner === owner)
}

/**
 * Replace a known image reference with src, alt, and caption.
 * @param data - tool `business_data`.
 * @param assets - rows the caller is allowed to show.
 * @returns data whose image, when recognized, has only public fields.
 */
export function normalizeImageBusinessData(data: unknown, assets: readonly MediaAssetRecord[]): unknown {
  if (!isRecord(data)) return data
  const fields = imageFields(data)
  if (fields === undefined) return data
  const id = assetIdOf(fields)
  const asset = id === undefined ? undefined : assets.find(item => item.id === id)
  const parent = withoutPrivate(data)
  if (asset === undefined) return parent
  return { ...parent, image: publicImage(asset) }
}

/**
 * Root-relative media path already stored on `data.image.src`.
 * @param data - tool `business_data` or a normalized copy.
 * @returns the path when it is a media content path.
 */
export function canonicalImageSrc(data: unknown): string | undefined {
  const fields = imageFields(data)
  const src = fields === undefined ? undefined : fields.src
  return typeof src === 'string' && MEDIA_PATH.test(src) ? src : undefined
}

/**
 * Resolve a configured media root before serving or catalog reads.
 * @param root - absolute directory from config or `JSON_RENDER_MEDIA_ROOT`.
 * @returns the real directory path.
 */
export function openMediaRoot(root: string): string {
  if (!isAbsolute(root)) throw new Error('tool-json-render: mediaRoot must be an absolute directory')
  let real: string
  try {
    real = realpathSync(root)
  } catch {
    throw new Error('tool-json-render: mediaRoot must be an absolute directory')
  }
  if (!statSync(real).isDirectory()) throw new Error('tool-json-render: mediaRoot must be an absolute directory')
  return real
}

/**
 * Read `index.json` from a media root.
 * @param root - real media directory.
 * @returns catalog rows. A missing index is an empty catalog.
 */
export async function readMediaCatalog(root: string): Promise<MediaAssetRecord[]> {
  const rootReal = await mediaFiles.realpath(root)
  const indexPath = join(rootReal, 'index.json')
  let indexReal: string
  try {
    indexReal = await mediaFiles.realpath(indexPath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return []
    throw new MediaCatalogError()
  }
  if (!staysInRoot(rootReal, indexReal)) throw new MediaCatalogError()
  let text: string
  try {
    text = await mediaFiles.readFile(indexReal, 'utf8')
  } catch {
    throw new MediaCatalogError()
  }
  return parseCatalog(text)
}

/**
 * Answer one media content request. Rejection is applied before any file read.
 * @param input - request target, connection rejection, and catalog location.
 * @returns image bytes, or a short plain-text failure that names no path.
 */
export async function mediaResponse(input: {
  readonly url: string
  readonly method: string
  readonly rejection: 401 | 403 | undefined
  readonly root: string
  readonly owner: string
  readonly maxBytes?: number
}): Promise<Response> {
  if (input.rejection !== undefined) return text(input.rejection, input.rejection === 401 ? 'unauthorized' : 'forbidden')
  if (input.method !== 'GET') return text(405, 'method not allowed')
  const id = mediaAssetId(input.url)
  if (id === undefined) return text(404, 'not found')
  let rootReal: string
  try {
    rootReal = await mediaFiles.realpath(input.root)
  } catch {
    return text(500, 'unavailable')
  }
  let assets: readonly MediaAssetRecord[]
  try {
    assets = await readMediaCatalog(rootReal)
  } catch {
    return text(500, 'unavailable')
  }
  const asset = assets.find(item => item.id === id)
  if (asset === undefined) return text(404, 'not found')
  if (asset.owner !== undefined && asset.owner !== input.owner) return text(403, 'forbidden')
  return readImage(rootReal, asset.file, input.maxBytes ?? MEDIA_MAX_BYTES)
}

/**
 * Mount `GET /api/media/<id>/content` when the Web server and connection exist.
 * @param ctx - host context. The route waits until both services are present.
 * @param root - real media directory. Empty skips the route.
 * @param owner - deployment owner compared with catalog row owners.
 */
export function mountMediaRoute(ctx: Context, root: string, owner: string): void {
  if (root === '') return
  ctx.inject(['webServer', 'connection'], (ready) => {
    const webServer = Reflect.get(ready, 'webServer') as MediaWebServer
    const connection = Reflect.get(ready, 'connection') as MediaConnection
    ready.effect(() => webServer.register({
      kind: 'prefix',
      path: '/api/media',
      handler: async (req, res) => {
        const response = await mediaResponse({
          url: req.url ?? '/',
          method: req.method ?? 'GET',
          rejection: connection.requestRejection(req),
          root,
          owner,
        })
        res.statusCode = response.status
        response.headers.forEach((value, key) => { res.setHeader(key, value) })
        res.end(Buffer.from(await response.arrayBuffer()))
      },
    }), 'tool-json-render: /api/media')
  })
}

function publicImage(asset: MediaAssetRecord): { src: string; alt: string; caption?: string } {
  const image: { src: string; alt: string; caption?: string } = {
    src: mediaContentPath(asset.id),
    alt: asset.alt,
  }
  if (asset.caption !== undefined) image.caption = asset.caption
  return image
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function imageFields(data: unknown): Record<string, unknown> | undefined {
  if (!isRecord(data) || !('image' in data)) return undefined
  const image = data.image
  if (typeof image === 'string') return { src: image }
  if (!isRecord(image)) return undefined
  if (typeof image.assetId !== 'string' && typeof image.id !== 'string' && typeof image.src !== 'string') return undefined
  return image
}

function assetIdOf(fields: Record<string, unknown>): string | undefined {
  const named = fieldText(fields.assetId) ?? fieldText(fields.id)
  if (named !== undefined) return safeId(named)
  const src = fieldText(fields.src)
  if (src === undefined) return undefined
  return MEDIA_PATH.exec(src)?.[1]
}

function fieldText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function safeId(value: string): string | undefined {
  return ASSET_ID.test(value) ? value : undefined
}

function withoutPrivate(data: Record<string, unknown>): Record<string, unknown> {
  const parent: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (key === 'image' || PRIVATE_KEYS.has(key)) continue
    parent[key] = value
  }
  return parent
}

function mediaAssetId(url: string): string | undefined {
  let pathname: string
  try {
    pathname = new URL(url, 'http://127.0.0.1').pathname
  } catch {
    return undefined
  }
  return MEDIA_PATH.exec(pathname)?.[1]
}

function staysInRoot(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function containedPath(root: string, file: string): string | undefined {
  if (file.includes('\0') || file.includes('\\') || isAbsolute(file)) return undefined
  const parts = file.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) return undefined
  return join(root, ...parts)
}

function errorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

function parseCatalog(body: string): MediaAssetRecord[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new MediaCatalogError()
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.assets)) throw new MediaCatalogError()
  const seen = new Set<string>()
  return parsed.assets.map((item) => {
    if (!isRecord(item)) throw new MediaCatalogError()
    const id = fieldText(item.id)
    const file = fieldText(item.file)
    const alt = fieldText(item.alt)
    if (id === undefined || safeId(id) === undefined || file === undefined || alt === undefined) throw new MediaCatalogError()
    if (seen.has(id)) throw new MediaCatalogError()
    seen.add(id)
    const caption = fieldText(item.caption)
    const owner = fieldText(item.owner)
    const record: MediaAssetRecord = { id, file, alt }
    if (caption !== undefined) return owner === undefined ? { ...record, caption } : { ...record, caption, owner }
    return owner === undefined ? record : { ...record, owner }
  })
}

function text(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

async function readImage(root: string, file: string, maxBytes: number): Promise<Response> {
  const target = containedPath(root, file)
  if (target === undefined) return text(403, 'forbidden')
  let linked: Awaited<ReturnType<typeof mediaFiles.lstat>>
  try {
    linked = await mediaFiles.lstat(target)
  } catch (error) {
    return text(errorCode(error) === 'ENOENT' ? 404 : 403, errorCode(error) === 'ENOENT' ? 'not found' : 'forbidden')
  }
  if (!linked.isFile() && !linked.isSymbolicLink()) return text(403, 'forbidden')
  let real: string
  try {
    real = await mediaFiles.realpath(target)
  } catch (error) {
    return text(errorCode(error) === 'ENOENT' ? 404 : 403, errorCode(error) === 'ENOENT' ? 'not found' : 'forbidden')
  }
  if (!staysInRoot(root, real)) return text(403, 'forbidden')
  let info: Awaited<ReturnType<typeof mediaFiles.stat>>
  try {
    info = await mediaFiles.stat(real)
  } catch (error) {
    return text(errorCode(error) === 'ENOENT' ? 404 : 403, errorCode(error) === 'ENOENT' ? 'not found' : 'forbidden')
  }
  if (!info.isFile()) return text(403, 'forbidden')
  if (info.size > maxBytes) return text(413, 'file exceeds byte limit')
  let bytes: Buffer
  try {
    bytes = await mediaFiles.readFile(real)
  } catch {
    return text(403, 'forbidden')
  }
  const mediaType = imageMediaType(real, bytes)
  if (mediaType === undefined) return text(415, 'unsupported media')
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': mediaType,
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function imageMediaType(file: string, bytes: Buffer): string | undefined {
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
  if (ext === '.png' && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if ((ext === '.jpg' || ext === '.jpeg') && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (ext === '.gif' && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'
  if (ext === '.webp' && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  return undefined
}
