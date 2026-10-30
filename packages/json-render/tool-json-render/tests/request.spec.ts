import { describe, expect, it, vi } from 'vitest'
import { baseRenderProfile, formsRenderProfile } from '@eit/json-render-catalog'
import { richRenderProfile } from '@eit/json-render-catalog/experimental'
import { generationRenderProfile } from '../src/profile.ts'
import {
  hasBusinessData,
  RENDER_UI_MAX_ATTEMPTS,
  renderUserQuery,
  requestJsonRender,
  resolvedRenderProfile,
  selectRenderRoute,
  type RenderDebugRecord,
} from '../src/request.ts'

const payload = {
  format: 'json-render-v1',
  spec: { root: 'card', elements: { card: { type: 'Card', props: { title: '概览' } } } },
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('requestJsonRender', () => {
  it('returns a display payload on the first success', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, payload))
    const result = await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001/',
      timeoutMs: 1000,
      args: { mode: 'display', user_query: '展示概览', business_data: { name: 'A' } },
      signal: new AbortController().signal,
      fetchImpl,
    })
    expect(result.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const init = fetchImpl.mock.calls[0]?.[1]
    expect(String(init?.body)).toContain('"format":"json-render-v1"')
    expect(String(init?.body)).toContain('请逐项展示 business_data')
    expect(String(init?.body)).not.toContain('"intent"')
  })

  it('rejects a display call that has no business data', async () => {
    const fetchImpl = vi.fn()
    const result = await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001',
      timeoutMs: 1000,
      args: { mode: 'display', user_query: '展示概览' },
      signal: new AbortController().signal,
      fetchImpl,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('步骤说明')
  })

  it('retries transport failures and stops at three attempts', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED')
    })
    const result = await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001',
      timeoutMs: 1000,
      args: { mode: 'display', user_query: '展示概览', business_data: { steps: ['检查电源'] } },
      signal: new AbortController().signal,
      fetchImpl,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(RENDER_UI_MAX_ATTEMPTS)
    expect(result).toMatchObject({ ok: false, mode: 'display' })
    if (!result.ok) expect(result.message).toContain('已尝试 3 次')
  })

  it('does not retry HTTP 400 and does not keep the error body as a payload', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, {
      error: {
        code: 'bad_request',
        message: 'business_data is required',
        requestId: 'req-400',
        diagnostics: { profile: 'base', issues: ['missing field'] },
      },
    }))
    const result = await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001',
      timeoutMs: 1000,
      args: { mode: 'display', user_query: '展示概览', business_data: { name: 'A' } },
      signal: new AbortController().signal,
      fetchImpl,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('business_data is required')
      expect(result).not.toHaveProperty('payload')
    }
  })

  it('retries an invalid success body then accepts a payload', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(200, payload))
    const result = await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001',
      timeoutMs: 1000,
      args: {
        mode: 'form',
        user_query: '请选择型号',
        intent: 'generic_pick_one',
        business_data: { models: ['A', 'B'] },
      },
      signal: new AbortController().signal,
      fetchImpl,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.message).toContain('本轮在此结束')
  })

  it('rejects an incomplete form without calling the server', async () => {
    const fetchImpl = vi.fn()
    const result = await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001',
      timeoutMs: 1000,
      args: { mode: 'form', user_query: '请选择', intent: 'generic_pick_one' },
      signal: new AbortController().signal,
      fetchImpl,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('ask_user_question')
  })

  it('keeps ordinary display on base and does not send host mode or a catalog field', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, payload))
    await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001',
      timeoutMs: 1000,
      args: {
        mode: 'display',
        user_query: '展示概览',
        intent: 'generic_filters',
        locale: 'zh-CN',
        scene: 'kb',
        business_data: { name: 'A' },
      },
      signal: new AbortController().signal,
      fetchImpl,
    })
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(body.format).toBe('json-render-v1')
    expect(body.prompt_mode).toBe('full')
    expect(body.context).toEqual({ locale: 'zh-CN', scene: 'kb' })
    expect(body).not.toHaveProperty('intent')
    expect(body).not.toHaveProperty('mode')
    expect(body).not.toHaveProperty('profile')
    expect(body).not.toHaveProperty('catalog')
    expect(body).not.toHaveProperty('framework')
    expect(selectRenderRoute({ mode: 'display', user_query: '展示概览', business_data: { name: 'A' } }).profile).toBe('base')
    expect(generationRenderProfile(selectRenderRoute({ mode: 'display', user_query: '展示概览', business_data: { name: 'A' } }))).toBe(baseRenderProfile)
  })

  it('maps filter and single-choice forms onto the forms profile', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, payload))
    for (const intent of ['generic_filters', 'generic_pick_one'] as const) {
      fetchImpl.mockClear()
      await requestJsonRender({
        baseUrl: 'http://127.0.0.1:3001',
        timeoutMs: 1000,
        args: { mode: 'form', user_query: '请选择', intent, business_data: { models: ['A'] }, prompt_mode: 'progressive' },
        signal: new AbortController().signal,
        fetchImpl,
      })
      const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as { prompt_mode: string; context: { intent: string } }
      expect(body.prompt_mode).toBe('progressive')
      expect(body.context.intent).toBe(intent)
      const route = selectRenderRoute({ mode: 'form', user_query: '请选择', intent, business_data: { models: ['A'] } })
      expect(route.profile).toBe('forms')
      expect(generationRenderProfile(route)).toBe(formsRenderProfile)
    }
  })

  it('selects rich_content for an image and for a mixed form page', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, {
      ...payload,
      diagnostics: { profile: { id: 'rich' } },
    }))
    const onDebug = vi.fn<(record: RenderDebugRecord) => void>()
    await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001',
      timeoutMs: 1000,
      args: {
        mode: 'display',
        user_query: '展示图片',
        components: ['Card', 'Image'],
        business_data: { src: '/json-render/media/sample.webp', alt: '样例' },
      },
      signal: new AbortController().signal,
      fetchImpl,
      debug: true,
      onDebug,
    })
    const imageBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as { context: { intent: string }; user_query: string }
    expect(imageBody.context.intent).toBe('rich_content')
    expect(imageBody.user_query).not.toContain('component')
    const imageRoute = selectRenderRoute({
      mode: 'display',
      user_query: '展示图片',
      components: ['Image'],
      business_data: { src: '/json-render/media/sample.webp' },
    })
    expect(generationRenderProfile(imageRoute)).toBe(richRenderProfile)
    expect(onDebug.mock.calls.some(([record]) => record.diagnostics?.profile === 'rich')).toBe(true)
    expect(JSON.stringify(onDebug.mock.calls)).not.toContain('sample.webp')

    fetchImpl.mockClear()
    await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001',
      timeoutMs: 1000,
      args: {
        mode: 'form',
        user_query: '筛选并看图',
        intent: 'generic_filters',
        components: ['Image'],
        business_data: { src: '/json-render/media/sample.webp' },
      },
      signal: new AbortController().signal,
      fetchImpl,
    })
    const mixed = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as { context: { intent: string } }
    expect(mixed.context.intent).toBe('rich_content')
    expect(resolvedRenderProfile('base', { diagnostics: { profile: 'forms' } })).toBe('forms')
    expect(resolvedRenderProfile('base', { meta: { extensions: { profile: 'rich_content' } } })).toBe('rich')
    expect(resolvedRenderProfile('forms', null)).toBe('forms')
  })

  it('stops after three server failures and keeps debug records free of secrets', async () => {
    let attempts = 0
    const fetchImpl = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) return new Response('{', { status: 502 })
      return jsonResponse(503, {
        error: {
          code: 'generation_failed',
          message: 'busy',
          requestId: 'req-1',
          diagnostics: {
            profile: 'base',
            stability: 'stable',
            catalog: 'base',
            issues: ['unknown component Image', 'see https://cdn.example/secret.jpg'],
            prompt: 'FULL SECRET PROMPT',
            business_data: { name: 'secret-person' },
            src: 'https://cdn.example/secret.jpg',
            apiKey: 'sk-test',
          },
        },
      })
    })
    const onDebug = vi.fn<(record: RenderDebugRecord) => void>()
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const result = await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001',
      timeoutMs: 1000,
      args: { mode: 'display', user_query: '展示概览', business_data: { name: 'secret-person' } },
      signal: new AbortController().signal,
      fetchImpl,
      debug: true,
      onDebug,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(RENDER_UI_MAX_ATTEMPTS)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('已尝试 3 次')
      expect(result.message).not.toContain('secret-person')
      expect(result.message).not.toContain('{')
    }
    expect(onDebug).toHaveBeenCalled()
    const dumped = JSON.stringify(onDebug.mock.calls)
    expect(dumped).toContain('generation_failed')
    expect(dumped).toContain('req-1')
    expect(dumped).toContain('unknown component Image')
    expect(dumped).not.toContain('secret-person')
    expect(dumped).not.toContain('secret.jpg')
    expect(dumped).not.toContain('sk-test')
    expect(dumped).not.toContain('FULL SECRET PROMPT')
    expect(debug).not.toHaveBeenCalled()
    debug.mockRestore()
  })

  it('rejects an unknown prompt mode without calling the server', async () => {
    const fetchImpl = vi.fn()
    const result = await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001',
      timeoutMs: 1000,
      args: { mode: 'display', user_query: '展示概览', prompt_mode: 'short', business_data: { name: 'A' } },
      signal: new AbortController().signal,
      fetchImpl,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('prompt_mode')
  })

  it('logs a safe record when debug is on and no sink is provided', async () => {
    const fetchImpl = vi.fn(async () => new Response('{', { status: 400 }))
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const result = await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001',
      timeoutMs: 1000,
      args: { mode: 'display', user_query: '展示概览', business_data: { name: 'A' } },
      signal: new AbortController().signal,
      fetchImpl,
      debug: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('HTTP 400')
    expect(debug).toHaveBeenCalled()
    expect(JSON.stringify(debug.mock.calls)).not.toContain('展示概览')
    debug.mockRestore()
  })

  it('does not emit debug records when debug mode is off', async () => {
    const fetchImpl = vi.fn(async () => { throw 'down' })
    const onDebug = vi.fn()
    const result = await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001',
      timeoutMs: 1000,
      args: { mode: 'display', user_query: '展示概览', business_data: { name: 'A' } },
      signal: new AbortController().signal,
      fetchImpl,
      onDebug,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(RENDER_UI_MAX_ATTEMPTS)
    expect(onDebug).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('界面生成失败')
  })

  it('rejects empty facts, a form without a forms intent, and an overlong query locally', async () => {
    expect(hasBusinessData(null)).toBe(false)
    expect(hasBusinessData('  ')).toBe(false)
    expect(hasBusinessData('a')).toBe(true)
    expect(hasBusinessData(1)).toBe(true)
    expect(hasBusinessData(false)).toBe(true)
    expect(hasBusinessData([])).toBe(false)
    expect(hasBusinessData([1])).toBe(true)
    expect(hasBusinessData({})).toBe(false)
    expect(hasBusinessData({ a: 1 })).toBe(true)
    expect(hasBusinessData(() => undefined)).toBe(false)

    const fetchImpl = vi.fn()
    const missingIntent = await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001',
      timeoutMs: 1000,
      args: { mode: 'form', user_query: '请选择', business_data: { models: ['A'] } },
      signal: new AbortController().signal,
      fetchImpl,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(missingIntent.ok).toBe(false)
    if (!missingIntent.ok) expect(missingIntent.message).toContain('generic_filters')
    expect(selectRenderRoute({ mode: 'form', user_query: '请选择', business_data: { models: ['A'] } }).intent).toBeUndefined()

    const query = '项'.repeat(2000)
    const displayQuery = renderUserQuery({ mode: 'display', user_query: query, business_data: { name: 'A' } })
    expect(displayQuery.length).toBeLessThanOrEqual(2000)
    expect(displayQuery).toContain('请逐项展示 business_data')
    expect(renderUserQuery({ mode: 'form', user_query: query, business_data: { models: ['A'] } })).toHaveLength(2000)

    const sent = vi.fn<typeof fetch>(async () => jsonResponse(200, payload))
    await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001',
      timeoutMs: 1000,
      args: {
        mode: 'display',
        user_query: '展示',
        prompt_mode: 'full',
        intent: 'rich_content',
        scene: '  ',
        locale: '',
        business_data: false,
      },
      signal: new AbortController().signal,
      fetchImpl: sent,
    })
    const body = JSON.parse(String(sent.mock.calls[0]?.[1]?.body)) as {
      prompt_mode: string
      business_data: boolean
      context: { intent: string }
    }
    expect(body.prompt_mode).toBe('full')
    expect(body.business_data).toBe(false)
    expect(body.context).toEqual({ intent: 'rich_content' })
    expect(generationRenderProfile(selectRenderRoute({
      mode: 'display', user_query: '展示', intent: 'rich_content', business_data: false,
    }))).toBe(richRenderProfile)
  })

  it('retries payloads that are not json-render-v1 and keeps only safe diagnostics', async () => {
    const bodies: unknown[] = [
      1,
      null,
      [],
      { format: 'other' },
      { format: 'json-render-v1', spec: null },
      { format: 'json-render-v1', spec: 'card' },
      { format: 'json-render-v1' },
    ]
    for (const body of bodies) {
      const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, body))
      const result = await requestJsonRender({
        baseUrl: 'http://127.0.0.1:3001',
        timeoutMs: 1000,
        args: { mode: 'display', user_query: '展示', business_data: { name: 'A' } },
        signal: new AbortController().signal,
        fetchImpl,
      })
      expect(fetchImpl).toHaveBeenCalledTimes(RENDER_UI_MAX_ATTEMPTS)
      expect(result.ok).toBe(false)
    }

    const blank = new Response('{}', { status: 200 })
    vi.spyOn(blank, 'json').mockResolvedValue(undefined)
    const nonJson = vi.fn<typeof fetch>(async () => blank)
    const nonJsonResult = await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001',
      timeoutMs: 1000,
      args: { mode: 'display', user_query: '展示', business_data: { name: 'A' } },
      signal: new AbortController().signal,
      fetchImpl: nonJson,
    })
    expect(nonJson).toHaveBeenCalledTimes(RENDER_UI_MAX_ATTEMPTS)
    expect(nonJsonResult.ok).toBe(false)

    const noisy = 'e'.repeat(300)
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(500, {
      message: noisy,
      requestId: 'req root!',
      diagnostics: {
        profile: { id: 'forms' },
        stability: 'not a token',
        catalog: 'base',
        issues: ['', 'x'.repeat(121), 'see https://cdn.example/a', 12, 'unknown component Image'],
      },
    }))
    const onDebug = vi.fn<(record: RenderDebugRecord) => void>()
    const result = await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001',
      timeoutMs: 1000,
      args: { mode: 'display', user_query: '展示', business_data: { name: 'A' } },
      signal: new AbortController().signal,
      fetchImpl,
      debug: true,
      onDebug,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('…')
      expect(result.message).not.toContain(noisy)
    }
    const dumped = JSON.stringify(onDebug.mock.calls)
    expect(dumped).toContain('unknown component Image')
    expect(dumped).toContain('forms')
    expect(dumped).not.toContain('https://')
    expect(dumped).not.toContain('req root!')

    const plain = vi.fn<typeof fetch>(async () => new Response('nope', { status: 502 }))
    const plainResult = await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001',
      timeoutMs: 1000,
      args: { mode: 'display', user_query: '展示', business_data: { name: 'A' } },
      signal: new AbortController().signal,
      fetchImpl: plain,
      debug: true,
      onDebug,
    })
    expect(plain).toHaveBeenCalledTimes(RENDER_UI_MAX_ATTEMPTS)
    expect(plainResult.ok).toBe(false)
    if (!plainResult.ok) expect(plainResult.message).toContain('HTTP 502')

    const blankError = await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001',
      timeoutMs: 1000,
      args: { mode: 'display', user_query: '展示', business_data: { name: 'A' } },
      signal: new AbortController().signal,
      fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse(400, { error: { message: '   ' }, diagnostics: {} })),
      debug: true,
      onDebug,
    })
    expect(blankError.ok).toBe(false)
    if (!blankError.ok) expect(blankError.message).toContain('HTTP 400')
    expect(resolvedRenderProfile('base', { diagnostics: { profile: { name: 'missing' } }, meta: { extensions: { profile: 'base' } } })).toBe('base')
    expect(resolvedRenderProfile('forms', { diagnostics: { profile: 'nope' }, meta: {} })).toBe('forms')
    expect(resolvedRenderProfile('rich', [])).toBe('rich')
  })

  it('stops when the caller aborts and emits debug from the environment switches', async () => {
    const cancelled = new AbortController()
    cancelled.abort()
    const fetchImpl = vi.fn()
    const aborted = await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001',
      timeoutMs: 1000,
      args: { mode: 'display', user_query: '展示', business_data: { name: 'A' } },
      signal: cancelled.signal,
      fetchImpl,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(aborted.ok).toBe(false)
    if (!aborted.ok) expect(aborted.message).toContain('已取消')

    const during = new AbortController()
    const duringFetch = vi.fn<typeof fetch>(async () => {
      during.abort()
      throw new Error('The operation was aborted')
    })
    const duringResult = await requestJsonRender({
      baseUrl: 'http://127.0.0.1:3001',
      timeoutMs: 1000,
      args: { mode: 'display', user_query: '展示', business_data: { name: 'A' } },
      signal: during.signal,
      fetchImpl: duringFetch,
    })
    expect(duringFetch).toHaveBeenCalledTimes(1)
    expect(duringResult.ok).toBe(false)
    if (!duringResult.ok) expect(duringResult.message).toContain('已取消')

    const previousDebug = process.env.JSON_RENDER_DEBUG
    const previousNode = process.env.NODE_ENV
    try {
      process.env.JSON_RENDER_DEBUG = '1'
      delete process.env.NODE_ENV
      const onDebug = vi.fn()
      await requestJsonRender({
        baseUrl: 'http://127.0.0.1:3001',
        timeoutMs: 1000,
        args: { mode: 'display', user_query: '展示概览', business_data: { name: 'A' } },
        signal: new AbortController().signal,
        fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse(200, payload)),
        onDebug,
      })
      expect(onDebug).toHaveBeenCalled()
      expect(JSON.stringify(onDebug.mock.calls)).not.toContain('展示概览')

      delete process.env.JSON_RENDER_DEBUG
      process.env.NODE_ENV = 'development'
      const devDebug = vi.spyOn(console, 'debug').mockImplementation(() => {})
      await requestJsonRender({
        baseUrl: 'http://127.0.0.1:3001',
        timeoutMs: 1000,
        args: { mode: 'display', user_query: '展示概览', business_data: { name: 'A' } },
        signal: new AbortController().signal,
        fetchImpl: vi.fn<typeof fetch>(async () => jsonResponse(200, payload)),
      })
      expect(devDebug).toHaveBeenCalled()
      expect(JSON.stringify(devDebug.mock.calls)).not.toContain('展示概览')
      devDebug.mockRestore()
    } finally {
      if (previousDebug === undefined) delete process.env.JSON_RENDER_DEBUG
      else process.env.JSON_RENDER_DEBUG = previousDebug
      if (previousNode === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNode
    }
  })
})
