// @vitest-environment jsdom
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { antdRegistry } from '@eit/json-render-antd'
import { antdRichRegistry } from '@eit/json-render-antd/experimental'
import type { JsonRenderPayload } from '@eit/json-render-protocol'
import { JsonRenderCard } from '../src/client/JsonRenderCard.tsx'
import { hostImagePath, imageElement, readHostImage } from '../src/client/image.ts'
import { inferRenderProfile, reactRegistryForProfile, registryRecognizes } from '../src/client/registry.ts'

const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
))

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function imagePayload(src: string): JsonRenderPayload {
  const image = imageElement(src, '样例图')
  return {
    format: 'json-render-v1',
    spec: { root: 'image', elements: { image } },
  }
}

async function listen(pathname: string, bytes: Uint8Array): Promise<{ server: Server; origin: string }> {
  const files = new Map([[pathname, bytes]])
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    const body = readHostImage(path, files)
    if (body === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'image/png' })
    res.end(body)
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return { server, origin: `http://127.0.0.1:${port}` }
}

describe('json-render image host route', () => {
  it('renders a host-built Image from the rich registry and serves its relative path', async () => {
    const src = hostImagePath('sample.webp')
    expect(imageElement(src, '样例图')).toEqual({ type: 'Image', props: { src, alt: '样例图' } })
    expect(() => hostImagePath('a/b')).toThrow(/safe segment/)
    expect(reactRegistryForProfile('rich')).toBe(antdRichRegistry)
    expect(readHostImage('/other', new Map([[src, PNG]]))).toBeUndefined()
    expect(registryRecognizes(antdRegistry, 'Image')).toBe(false)
    expect(registryRecognizes(antdRichRegistry, 'Image')).toBe(true)
    expect(reactRegistryForProfile('base')).toBe(antdRegistry)
    expect(reactRegistryForProfile('forms')).toBe(antdRegistry)
    expect(inferRenderProfile(imagePayload(src))).toBe('rich')

    const base = imagePayload(src)
    const payload: JsonRenderPayload = {
      ...base,
      spec: {
        ...base.spec,
        elements: {
          image: { type: 'Image', props: { src, alt: '样例图', caption: '已登记' } },
        },
      },
    }
    const { server, origin } = await listen(src, PNG)
    const submitForm = vi.fn()
    try {
      render(<JsonRenderCard payload={payload} instanceId="image" submitForm={submitForm} />)
      const img = screen.getByRole('img', { name: '样例图' })
      expect(img.getAttribute('src')).toBe(src)
      expect(Object.keys(imageElement(src, '样例图').props)).toEqual(['src', 'alt'])
      expect(screen.getByText('已登记')).toBeTruthy()
      expect(new URL(img.getAttribute('src')!, window.location.origin).pathname).toBe(src)
      expect(new URL(img.getAttribute('src')!, window.location.origin).origin).toBe(window.location.origin)
      fireEvent.click(screen.getByRole('button', { name: '预览 样例图' }))
      expect(screen.getByRole('button', { name: '关闭预览' })).toBeTruthy()
      expect(document.querySelector('.eit-jr-preview img')?.getAttribute('src')).toBe(src)
      fireEvent.error(img)
      expect(screen.getByText('图片暂不可用')).toBeTruthy()
      expect(submitForm).not.toHaveBeenCalled()
      const served = await fetch(`${origin}${src}`)
      expect(served.status).toBe(200)
      expect(served.headers.get('content-type')).toBe('image/png')
      expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG)
      const missing = await fetch(`${origin}/api/media/missing/content`)
      expect(missing.status).toBe(404)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
  })

  it('keeps a base diagnostic on the stable registry and injects upload adapters by target name', () => {
    const src = hostImagePath('sample.webp')
    const payload = imagePayload(src)
    const hidden = render(<JsonRenderCard payload={payload} instanceId="base-image" profile="base" submitForm={vi.fn()}
      fallbackRender={() => <p>文字兜底</p>} />)
    expect(screen.getByText('文字兜底')).toBeTruthy()
    hidden.unmount()

    const upload: JsonRenderPayload = {
      format: 'json-render-v1',
      spec: {
        root: 'upload',
        elements: {
          upload: { type: 'ImageUpload', props: { uploadTarget: 'photos', label: '图片' } },
        },
      },
    }
    const unconfigured = render(<JsonRenderCard payload={upload} instanceId="upload-off" profile="rich" submitForm={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toContain('上传能力未配置')
    expect(screen.getByRole('alert').textContent).toContain('photos')
    expect(unconfigured.container.innerHTML).not.toContain('https://')
    expect(unconfigured.container.innerHTML).not.toContain('sk-')
    unconfigured.unmount()

    render(<JsonRenderCard payload={upload} instanceId="upload-on" profile="rich" submitForm={vi.fn()}
      imageUploads={{
        photos: { upload: () => Promise.reject(new Error('unused')) },
      }} />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText('图片')).toBeTruthy()
  })
})
