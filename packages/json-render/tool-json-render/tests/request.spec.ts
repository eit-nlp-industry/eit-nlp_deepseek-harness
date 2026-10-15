import { describe, expect, it, vi } from 'vitest'
import { RENDER_UI_MAX_ATTEMPTS, requestJsonRender } from '../src/request.ts'

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
    const fetchImpl = vi.fn(async () => jsonResponse(200, payload))
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
    const fetchImpl = vi.fn(async () => jsonResponse(400, { error: { message: 'business_data is required' } }))
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
      .mockResolvedValueOnce(jsonResponse(200, { error: { message: 'nope' } }))
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
})
