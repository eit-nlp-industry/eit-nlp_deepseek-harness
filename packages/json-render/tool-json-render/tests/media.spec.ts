import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Config } from '../src/index.ts'
import * as toolJsonRender from '../src/index.ts'
import {
  canonicalImageSrc,
  imageBusinessData,
  mediaFiles,
  mediaResponse,
  normalizeImageBusinessData,
  openMediaRoot,
  readMediaCatalog,
  referencesImage,
  visibleAssets,
  type MediaAssetRecord,
} from '../src/media.ts'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG = Buffer.from([0xff, 0xd8, 0xff])
const GIF = Buffer.from('GIF89a')
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])
const SECRET = 'SECRET_DISK_PATH'

function pathHas(path: unknown, suffix: string): boolean {
  return typeof path === 'string' && path.endsWith(suffix)
}

function requestText(body: BodyInit | null | undefined): string {
  if (typeof body !== 'string') throw new Error('expected a string request body')
  return body
}

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete process.env.JSON_RENDER_MEDIA_ROOT
  delete process.env.JSON_RENDER_MEDIA_OWNER
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-json-media-')))
  roots.push(root)
  return root
}

async function catalog(root: string, assets: readonly unknown[]): Promise<void> {
  await writeFile(join(root, 'index.json'), JSON.stringify({ assets }))
}

function row(extra: Partial<MediaAssetRecord> & Pick<MediaAssetRecord, 'id' | 'file'>): MediaAssetRecord {
  return { alt: '参考照片', ...extra }
}

async function textOf(response: Response): Promise<string> {
  return await response.text()
}


async function callRenderUi(
  tools: Context['tools'],
  callId: string,
  args: Record<string, unknown>,
) {
  const batch = await tools.execute({
    signal: new AbortController().signal,
    calls: [{
      type: 'tool-call' as const,
      id: ToolCallId(callId),
      name: 'render_ui',
      arguments: JSON.stringify(args),
    }],
  })
  const result = batch.results[0]?.result
  if (result === undefined) throw new Error(`missing result for ${callId}`)
  return result
}

describe('json-render media catalog', () => {
  it('publishes only src, alt, and caption for a catalog row', () => {
    const asset = row({ id: 'ref-photo', file: 'ref-photo.png', caption: '已登记', owner: 'library' })
    expect(imageBusinessData(asset)).toEqual({
      image: { src: '/api/media/ref-photo/content', alt: '参考照片', caption: '已登记' },
    })
    expect(imageBusinessData(row({ id: 'plain', file: 'plain.png' })).image.caption).toBeUndefined()
    expect(referencesImage(null)).toBe(false)
    expect(referencesImage({ image: 1 })).toBe(false)
    expect(referencesImage({ image: {} })).toBe(false)
    expect(referencesImage({ title: '概览' })).toBe(false)
    expect(referencesImage({ image: 'C:\\fixture\\mock.png' })).toBe(true)
    expect(normalizeImageBusinessData(['C:\\fixture\\mock.png'], [asset])).toEqual(['C:\\fixture\\mock.png'])
    expect(normalizeImageBusinessData({ title: '概览' }, [asset])).toEqual({ title: '概览' })
    const hidden = normalizeImageBusinessData({
      title: '概览',
      token: 'sk-test',
      image: { assetId: 'missing', file: 'C:\\fixture\\mock.png', component: 'Image', type: 'Image' },
    }, [asset])
    expect(hidden).toEqual({ title: '概览' })
    expect(JSON.stringify(hidden)).not.toContain('SECRET')
    expect(JSON.stringify(hidden)).not.toContain('sk-test')
    const shown = normalizeImageBusinessData({
      title: '概览',
      password: 'hidden',
      image: { id: 'ref-photo', src: 'https://example.test/a.png', component: 'Image' },
    }, [asset])
    expect(shown).toEqual({
      title: '概览',
      image: { src: '/api/media/ref-photo/content', alt: '参考照片', caption: '已登记' },
    })
    expect(canonicalImageSrc(shown)).toBe('/api/media/ref-photo/content')
    expect(canonicalImageSrc({ image: { src: 'https://example.test/a.png' } })).toBeUndefined()
    const fromSrc = normalizeImageBusinessData({
      image: { src: '/api/media/ref-photo/content', alt: '模型改写' },
    }, [asset])
    expect(fromSrc).toEqual({
      image: { src: '/api/media/ref-photo/content', alt: '参考照片', caption: '已登记' },
    })
    expect(normalizeImageBusinessData({ image: { assetId: '../secret' } }, [asset])).toEqual({})
    expect(normalizeImageBusinessData({ image: { assetId: '   ' } }, [asset])).toEqual({})
    expect(visibleAssets([
      asset,
      row({ id: 'shared', file: 'shared.png' }),
      row({ id: 'other', file: 'other.png', owner: 'other' }),
    ], 'library').map(item => item.id)).toEqual(['ref-photo', 'shared'])
    expect(visibleAssets([asset], '').map(item => item.id)).toEqual([])
  })

  it('serves catalog images and rejects unauthenticated, foreign, missing, and unsafe targets', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    await writeFile(join(root, 'ref-photo.png'), PNG)
    await writeFile(join(root, 'ref-photo.PNG'), PNG)
    await writeFile(join(root, 'shot.jpg'), JPEG)
    await writeFile(join(root, 'shot.jpeg'), JPEG)
    await writeFile(join(root, 'clip.gif'), GIF)
    await writeFile(join(root, 'clip.webp'), WEBP)
    await writeFile(join(root, 'bad.webp'), Buffer.from('not-a-webp'))
    await writeFile(join(root, 'notes.png'), Buffer.from(`<html>${SECRET}</html>`))
    await writeFile(join(root, 'empty.png'), Buffer.alloc(0))
    await writeFile(join(root, 'vector.svg'), Buffer.from('<svg></svg>'))
    await mkdir(join(root, 'library'))
    await writeFile(join(root, 'library', 'nested.png'), PNG)
    await mkdir(join(root, 'frames.png'))
    await writeFile(join(outside, 'outside.png'), PNG)
    await writeFile(join(outside, SECRET), Buffer.from(SECRET))
    await catalog(root, [
      row({ id: 'ref-photo', file: 'ref-photo.png', caption: '已登记', owner: 'library' }),
      row({ id: 'upper', file: 'ref-photo.PNG', owner: 'library' }),
      row({ id: 'shared', file: 'library/nested.png' }),
      row({ id: 'jpg', file: 'shot.jpg' }),
      row({ id: 'jpeg', file: 'shot.jpeg' }),
      row({ id: 'gif', file: 'clip.gif' }),
      row({ id: 'webp', file: 'clip.webp' }),
      row({ id: 'bad-webp', file: 'bad.webp' }),
      row({ id: 'caption', file: 'ref-photo.png', caption: '仅说明' }),
      row({ id: 'slash', file: 'a\\b.png' }),
      row({ id: 'empty-seg', file: 'a//b.png' }),
      row({ id: 'notes', file: 'notes.png' }),
      row({ id: 'empty', file: 'empty.png' }),
      row({ id: 'svg', file: 'vector.svg' }),
      row({ id: 'dir', file: 'frames.png' }),
      row({ id: 'parent', file: '../outside.png', owner: 'library' }),
      row({ id: 'absolute', file: join(outside, 'outside.png'), owner: 'library' }),
      row({ id: 'nul', file: 'a\0.png', owner: 'library' }),
      row({ id: 'dot', file: './ref-photo.png', owner: 'library' }),
      row({ id: 'other', file: 'ref-photo.png', owner: 'other', alt: '其他租户' }),
      row({ id: 'gone', file: 'missing.png', owner: 'library' }),
    ])

    const ok = await mediaResponse({
      url: '/api/media/ref-photo/content?path=C:\\fixture\\mock.png',
      method: 'GET',
      rejection: undefined,
      root,
      owner: 'library',
    })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('image/png')
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff')
    expect(ok.headers.get('cache-control')).toBe('private, no-store')
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(PNG)

    expect((await mediaResponse({
      url: '/api/media/upper/content', method: 'GET', rejection: undefined, root, owner: 'library',
    })).headers.get('content-type')).toBe('image/png')
    expect((await mediaResponse({
      url: '/api/media/shared/content', method: 'GET', rejection: undefined, root, owner: 'library',
    })).status).toBe(200)
    expect((await mediaResponse({
      url: '/api/media/jpg/content', method: 'GET', rejection: undefined, root, owner: 'library',
    })).headers.get('content-type')).toBe('image/jpeg')
    expect((await mediaResponse({
      url: '/api/media/jpeg/content', method: 'GET', rejection: undefined, root, owner: 'library',
    })).headers.get('content-type')).toBe('image/jpeg')
    expect((await mediaResponse({
      url: '/api/media/gif/content', method: 'GET', rejection: undefined, root, owner: 'library',
    })).headers.get('content-type')).toBe('image/gif')
    expect((await mediaResponse({
      url: '/api/media/webp/content', method: 'GET', rejection: undefined, root, owner: 'library',
    })).headers.get('content-type')).toBe('image/webp')

    const denied = [
      mediaResponse({ url: '/api/media/ref-photo/content', method: 'GET', rejection: 401, root: join(root, 'missing'), owner: 'library' }),
      mediaResponse({ url: '/api/media/ref-photo/content', method: 'POST', rejection: 403, root: join(root, 'missing'), owner: 'library' }),
      mediaResponse({ url: '/api/media/ref-photo/content', method: 'POST', rejection: undefined, root, owner: 'library' }),
      mediaResponse({ url: '/api/media/ref-photo/content', method: 'HEAD', rejection: undefined, root, owner: 'library' }),
      mediaResponse({ url: 'http://[', method: 'GET', rejection: undefined, root, owner: 'library' }),
      mediaResponse({ url: '/api/media/..%2F..%2Fetc/content', method: 'GET', rejection: undefined, root, owner: 'library' }),
      mediaResponse({ url: '/api/media/missing/content', method: 'GET', rejection: undefined, root, owner: 'library' }),
      mediaResponse({ url: '/api/media/other/content', method: 'GET', rejection: undefined, root, owner: 'library' }),
      mediaResponse({ url: '/api/media/gone/content', method: 'GET', rejection: undefined, root, owner: 'library' }),
      mediaResponse({ url: '/api/media/parent/content', method: 'GET', rejection: undefined, root, owner: 'library' }),
      mediaResponse({ url: '/api/media/absolute/content', method: 'GET', rejection: undefined, root, owner: 'library' }),
      mediaResponse({ url: '/api/media/nul/content', method: 'GET', rejection: undefined, root, owner: 'library' }),
      mediaResponse({ url: '/api/media/dot/content', method: 'GET', rejection: undefined, root, owner: 'library' }),
      mediaResponse({ url: '/api/media/dir/content', method: 'GET', rejection: undefined, root, owner: 'library' }),
      mediaResponse({ url: '/api/media/notes/content', method: 'GET', rejection: undefined, root, owner: 'library' }),
      mediaResponse({ url: '/api/media/empty/content', method: 'GET', rejection: undefined, root, owner: 'library' }),
      mediaResponse({ url: '/api/media/svg/content', method: 'GET', rejection: undefined, root, owner: 'library' }),
      mediaResponse({ url: '/api/media/bad-webp/content', method: 'GET', rejection: undefined, root, owner: 'library' }),
      mediaResponse({ url: '/api/media/slash/content', method: 'GET', rejection: undefined, root, owner: 'library' }),
      mediaResponse({ url: '/api/media/empty-seg/content', method: 'GET', rejection: undefined, root, owner: 'library' }),
      mediaResponse({
        url: '/api/media/ref-photo/content', method: 'GET', rejection: undefined, root, owner: 'library', maxBytes: PNG.length - 1,
      }),
    ]
    const statuses = [401, 403, 405, 405, 404, 404, 404, 403, 404, 403, 403, 403, 403, 403, 415, 415, 415, 415, 403, 403, 413]
    const bodies = await Promise.all(denied)
    expect(bodies.map(response => response.status)).toEqual(statuses)
    for (const response of bodies) expect(response.headers.get('content-type')).toContain('text/plain')
    const texts = await Promise.all(bodies.map(textOf))
    expect(texts[0]).toBe('unauthorized')
    expect(texts[7]).toBe('forbidden')
    for (const body of texts) {
      expect(body).not.toContain(SECRET)
      expect(body).not.toContain(root)
      expect(body).not.toContain('<html')
      expect(body).not.toContain('其他租户')
    }
  })

  it('fails closed when the catalog is unreadable and does not echo its text', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    await writeFile(join(outside, 'secret.json'), Buffer.from(SECRET))
    const originalRealpath = mediaFiles.realpath
    vi.spyOn(mediaFiles, 'realpath').mockImplementation((path, options) => {
      if (pathHas(path, 'index.json')) return Promise.resolve(join(outside, 'secret.json'))
      return originalRealpath(path, options)
    })
    const linked = await mediaResponse({
      url: '/api/media/ref-photo/content', method: 'GET', rejection: undefined, root, owner: 'library',
    })
    expect(linked.status).toBe(500)
    expect(await textOf(linked)).toBe('unavailable')
    vi.restoreAllMocks()

    vi.spyOn(mediaFiles, 'realpath').mockImplementation((path, options) => {
      if (pathHas(path, 'index.json')) return Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))
      return originalRealpath(path, options)
    })
    const deniedIndex = await mediaResponse({
      url: '/api/media/ref-photo/content', method: 'GET', rejection: undefined, root, owner: 'library',
    })
    expect(deniedIndex.status).toBe(500)
    expect(await textOf(deniedIndex)).toBe('unavailable')
    vi.restoreAllMocks()

    await writeFile(join(root, 'index.json'), `{${SECRET}`)
    const invalid = await mediaResponse({
      url: '/api/media/ref-photo/content', method: 'GET', rejection: undefined, root, owner: 'library',
    })
    expect(invalid.status).toBe(500)
    expect(await textOf(invalid)).toBe('unavailable')

    await rm(join(root, 'index.json'))
    await mkdir(join(root, 'index.json'))
    const directory = await mediaResponse({
      url: '/api/media/ref-photo/content', method: 'GET', rejection: undefined, root, owner: 'library',
    })
    expect(directory.status).toBe(500)

    await rm(join(root, 'index.json'), { recursive: true })
    expect(await readMediaCatalog(root)).toEqual([])
    const missing = await mediaResponse({
      url: '/api/media/ref-photo/content', method: 'GET', rejection: undefined, root, owner: 'library',
    })
    expect(missing.status).toBe(404)

    await writeFile(join(root, 'index.json'), JSON.stringify({ assets: { id: 'ref-photo' } }))
    await expect(readMediaCatalog(root)).rejects.toThrow(/media catalog is invalid/)
    await writeFile(join(root, 'index.json'), JSON.stringify({ assets: [null] }))
    await expect(readMediaCatalog(root)).rejects.toThrow(/media catalog is invalid/)
    await writeFile(join(root, 'index.json'), JSON.stringify({
      assets: [row({ id: 'ref-photo', file: 'a.png' }), row({ id: 'ref-photo', file: 'b.png' })],
    }))
    await expect(readMediaCatalog(root)).rejects.toThrow(/media catalog is invalid/)
    await writeFile(join(root, 'index.json'), JSON.stringify({ assets: [{ id: '../x', file: 'a.png', alt: '参考照片' }] }))
    await expect(readMediaCatalog(root)).rejects.toThrow(/media catalog is invalid/)
    const gone = join(root, 'missing-root')
    expect((await mediaResponse({
      url: '/api/media/ref-photo/content', method: 'GET', rejection: undefined, root: gone, owner: 'library',
    })).status).toBe(500)
  })

  it('checks symbolic links and read failures without exposing the target', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    await writeFile(join(root, 'ref-photo.png'), PNG)
    await writeFile(join(outside, 'outside.png'), PNG)
    await catalog(root, [row({ id: 'ref-photo', file: 'ref-photo.png', owner: 'library' })])
    const ask = () => mediaResponse({
      url: '/api/media/ref-photo/content', method: 'GET', rejection: undefined, root, owner: 'library',
    })
    const link = { isFile: () => false, isSymbolicLink: () => true } as Awaited<ReturnType<typeof mediaFiles.lstat>>
    const originalLstat = mediaFiles.lstat
    const originalRealpath = mediaFiles.realpath
    const originalStat = mediaFiles.stat
    const originalRead = mediaFiles.readFile
    vi.spyOn(mediaFiles, 'lstat').mockImplementation((path) => {
      if (pathHas(path, 'ref-photo.png')) return Promise.resolve(link)
      return originalLstat(path)
    })
    vi.spyOn(mediaFiles, 'realpath').mockImplementation((path, options) => {
      if (pathHas(path, 'ref-photo.png')) return Promise.resolve(join(outside, 'outside.png'))
      return originalRealpath(path, options)
    })
    const escaped = await ask()
    expect(escaped.status).toBe(403)
    expect(await textOf(escaped)).toBe('forbidden')
    vi.restoreAllMocks()

    vi.spyOn(mediaFiles, 'lstat').mockImplementation((path) => {
      if (pathHas(path, 'ref-photo.png')) return Promise.resolve(link)
      return originalLstat(path)
    })
    const inside = await ask()
    expect(inside.status).toBe(200)
    expect(Buffer.from(await inside.arrayBuffer())).toEqual(PNG)
    vi.restoreAllMocks()

    vi.spyOn(mediaFiles, 'lstat').mockImplementation((path) => {
      if (pathHas(path, 'ref-photo.png')) return Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))
      return originalLstat(path)
    })
    expect((await ask()).status).toBe(403)
    vi.restoreAllMocks()

    vi.spyOn(mediaFiles, 'lstat').mockImplementation((path) => {
      if (pathHas(path, 'ref-photo.png')) throw 'denied'
      return originalLstat(path)
    })
    expect((await ask()).status).toBe(403)
    vi.restoreAllMocks()

    vi.spyOn(mediaFiles, 'realpath').mockImplementation((path, options) => {
      if (pathHas(path, 'ref-photo.png')) return Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
      return originalRealpath(path, options)
    })
    expect((await ask()).status).toBe(404)
    vi.restoreAllMocks()

    vi.spyOn(mediaFiles, 'realpath').mockImplementation((path, options) => {
      if (pathHas(path, 'ref-photo.png')) return Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))
      return originalRealpath(path, options)
    })
    expect((await ask()).status).toBe(403)
    vi.restoreAllMocks()

    vi.spyOn(mediaFiles, 'stat').mockImplementation((path) => {
      if (pathHas(path, 'ref-photo.png')) return Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
      return originalStat(path)
    })
    expect((await ask()).status).toBe(404)
    vi.restoreAllMocks()

    vi.spyOn(mediaFiles, 'lstat').mockImplementation((path) => {
      if (pathHas(path, 'ref-photo.png')) throw { code: 1 }
      return originalLstat(path)
    })
    expect((await ask()).status).toBe(403)
    vi.restoreAllMocks()

    vi.spyOn(mediaFiles, 'stat').mockImplementation((path) => {
      if (pathHas(path, 'ref-photo.png')) return Promise.reject(Object.assign(new Error('denied'), { code: 'EPERM' }))
      return originalStat(path)
    })
    expect((await ask()).status).toBe(403)
    vi.restoreAllMocks()

    vi.spyOn(mediaFiles, 'stat').mockImplementation((path) => {
      if (pathHas(path, 'ref-photo.png')) {
        return Promise.resolve({ isFile: () => false, size: 1 } as Awaited<ReturnType<typeof mediaFiles.stat>>)
      }
      return originalStat(path)
    })
    expect((await ask()).status).toBe(403)
    vi.restoreAllMocks()

    vi.spyOn(mediaFiles, 'readFile').mockImplementation((path, options) => {
      if (pathHas(path, 'ref-photo.png')) return Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))
      return originalRead(path, options)
    })
    expect((await ask()).status).toBe(403)
    vi.restoreAllMocks()
  })
})

describe('render_ui media mount', () => {
  it('rejects a media root that is not an absolute directory', async () => {
    const root = await tempRoot()
    const file = join(root, 'file.png')
    await writeFile(file, PNG)
    expect(() => openMediaRoot('relative')).toThrow(/absolute directory/)
    expect(() => openMediaRoot(join(root, 'missing'))).toThrow(/absolute directory/)
    expect(() => openMediaRoot(file)).toThrow(/absolute directory/)
    expect(openMediaRoot(root)).toBe(root)
  })

  it('mounts the same-origin route and rewrites catalog images before render', async () => {
    const root = await tempRoot()
    const other = await tempRoot()
    await writeFile(join(root, 'ref-photo.png'), PNG)
    await catalog(root, [
      row({ id: 'ref-photo', file: 'ref-photo.png', caption: '已登记', owner: 'library' }),
      row({ id: 'foreign', file: 'ref-photo.png', owner: 'other' }),
    ])
    await writeFile(join(other, 'index.json'), '{')
    const routes: {
      kind: string
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    }[] = []
    const disposeRoute = vi.fn()
    const gate: { rejection: 401 | 403 | undefined } = { rejection: undefined }
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.reflect.provide('webServer', {
      register(route: { kind: string; path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }) {
        routes.push(route)
        return disposeRoute
      },
    })
    ctx.reflect.provide('connection', { requestRejection: () => gate.rejection })
    const fiber = ctx.plugin(toolJsonRender, { mediaRoot: root, mediaOwner: 'library', baseUrl: 'http://render.test' } satisfies Config)
    await fiber
    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({ kind: 'prefix', path: '/api/media' })
    const handler = routes[0]!.handler
    const socket = new Socket()
    const req = new IncomingMessage(socket)
    req.method = 'GET'
    req.url = '/api/media/ref-photo/content'
    const res = new ServerResponse(req)
    try {
      await handler(req, res)
      expect(res.statusCode).toBe(200)
      expect(res.getHeader('content-type')).toBe('image/png')
      const bareSocket = new Socket()
      const bareReq = new IncomingMessage(bareSocket)
      bareReq.url = undefined
      const bareRes = new ServerResponse(bareReq)
      try {
        await handler(bareReq, bareRes)
        expect(bareRes.statusCode).toBe(404)
      } finally {
        bareRes.destroy()
        bareSocket.destroy()
      }
    } finally {
      res.destroy()
      socket.destroy()
    }
    gate.rejection = 401
    const deniedSocket = new Socket()
    const deniedReq = new IncomingMessage(deniedSocket)
    deniedReq.method = 'GET'
    deniedReq.url = '/api/media/ref-photo/content'
    const denied = new ServerResponse(deniedReq)
    try {
      await handler(deniedReq, denied)
      expect(denied.statusCode).toBe(401)
      expect(String(denied.getHeader('content-type'))).toContain('text/plain')
    } finally {
      denied.destroy()
      deniedSocket.destroy()
    }

    const sent = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      format: 'json-render-v1',
      spec: { root: 'image', elements: {} },
      diagnostics: { profile: 'rich' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', sent)
    const rendered = await callRenderUi(ctx.tools, 'image', {
      mode: 'display',
      user_query: '展示参考照片',
      locale: 'en-US',
      scene: 'kb',
      prompt_mode: 'progressive',
      business_data: {
        title: '概览',
        image: {
          assetId: 'ref-photo',
          file: 'C:\\fixture\\mock.png',
          component: 'Image',
          type: 'Image',
          token: 'sk-test',
        },
      },
    })
    expect(rendered.isError).toBe(false)
    expect(sent).toHaveBeenCalledOnce()
    const body = JSON.parse(requestText(sent.mock.calls[0]?.[1]?.body)) as {
      format: string
      prompt_mode: string
      context: { intent: string; locale: string; scene: string }
      business_data: { title: string; image: { src: string; alt: string; caption: string } }
    }
    expect(body.format).toBe('json-render-v1')
    expect(body.prompt_mode).toBe('progressive')
    expect(body.context).toEqual({ intent: 'rich_content', locale: 'zh-CN', scene: 'kb' })
    expect(body.business_data).toEqual({
      title: '概览',
      image: { src: '/api/media/ref-photo/content', alt: '参考照片', caption: '已登记' },
    })
    expect(JSON.stringify(body)).not.toContain('mock.png')
    expect(JSON.stringify(body)).not.toContain('sk-test')
    expect(JSON.stringify(body)).not.toContain('%')
    const output = ctx.tools.get('render_ui')!.output
    expect(output.presentationMeta!.bind(output)(
      { mode: 'display', user_query: '展示', business_data: { image: { assetId: 'ref-photo' } } },
      { ok: true, mode: 'display', message: 'ready', payload: { format: 'json-render-v1', spec: { root: 'image', elements: {} } } },
    )).toMatchObject({ profile: 'rich' })

    sent.mockClear()
    const foreign = await callRenderUi(ctx.tools, 'foreign', {
      mode: 'display',
      user_query: '展示',
      business_data: { image: { assetId: 'foreign' } },
    })
    expect(sent).not.toHaveBeenCalled()
    expect(JSON.stringify(foreign.content)).toContain('不在媒体目录')

    const plain = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      format: 'json-render-v1',
      spec: { root: 'card', elements: {} },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', plain)
    await callRenderUi(ctx.tools, 'plain', { mode: 'display', user_query: '展示', business_data: { title: '概览' } })
    const plainBody = JSON.parse(requestText(plain.mock.calls[0]?.[1]?.body)) as { context?: { intent?: string } }
    expect(plainBody.context?.intent).toBeUndefined()

    await fiber.dispose()
    expect(disposeRoute).toHaveBeenCalled()
  })

  it('keeps ordinary display working when the catalog cannot be read', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'index.json'), '{')
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = ctx.plugin(toolJsonRender, { mediaRoot: root, baseUrl: 'http://render.test' } satisfies Config)
    await fiber
    const sent = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      format: 'json-render-v1', spec: { root: 'card', elements: {} },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', sent)
    const image = await callRenderUi(ctx.tools, 'broken', { mode: 'display', user_query: '展示', business_data: { image: { assetId: 'ref-photo' } } })
    expect(sent).not.toHaveBeenCalled()
    expect(JSON.stringify(image.content)).toContain('无法读取')
    await callRenderUi(ctx.tools, 'table', { mode: 'display', user_query: '展示', business_data: { title: '概览' } })
    expect(sent).toHaveBeenCalledOnce()
    await fiber.dispose()
  })

  it('reads the media root and owner from the environment when config is empty', async () => {
    const root = await tempRoot()
    await catalog(root, [row({ id: 'ref-photo', file: 'ref-photo.png', owner: 'from-env' })])
    await writeFile(join(root, 'ref-photo.png'), PNG)
    process.env.JSON_RENDER_MEDIA_ROOT = root
    process.env.JSON_RENDER_MEDIA_OWNER = 'from-env'
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = ctx.plugin(toolJsonRender, { baseUrl: 'http://render.test' } satisfies Config)
    await fiber
    const sent = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      format: 'json-render-v1', spec: { root: 'image', elements: {} },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', sent)
    await callRenderUi(ctx.tools, 'env', { mode: 'form', user_query: '确认', intent: 'generic_pick_one', business_data: { image: { assetId: 'ref-photo' } } })
    const body = JSON.parse(requestText(sent.mock.calls[0]?.[1]?.body)) as { context: { intent: string; locale: string } }
    expect(body.context).toEqual({ intent: 'rich_content', locale: 'zh-CN' })
    await fiber.dispose()
  })
})
