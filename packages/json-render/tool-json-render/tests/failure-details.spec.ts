/** Rejected renderer output stays diagnostic data through the tool pipeline. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as toolJsonRender from '../src/index.ts'
import { requestJsonRender } from '../src/request.ts'
import { executeRenderUi } from './execute-render.ts'

const invalidPayload = { format: 'json-render-v1', spec: { root: 'main', elements: { main: { type: 'Text', props: { content: {} } } } } }
const validationError = {
  code: 'MODEL_OUTPUT_INVALID', requestId: 'req-validation', stage: 'validation',
  diagnostics: { issues: [{ code: 'invalid_props', path: '/elements/main/props/content', message: 'Expected scalar text' }] },
  rawOutput: '{"op":"add","path":"/elements/main","value":{"type":"Text","props":{"content":{}}}}',
  invalidPayload,
}
const args = { mode: 'display' as const, user_query: '展示结果', business_data: { name: 'Example' } }

describe('render_ui failure details', () => {
  it.each([
    validationError,
    { code: 'MODEL_OUTPUT_INVALID', requestId: 'req-parse', stage: 'parse', rawOutput: 'not JSONL', diagnostics: { issues: [{ code: 'invalid_format', message: 'Missing root and elements' }] } },
  ])('preserves structured $stage diagnostics without a repeated request', async (error) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error }), { status: 502 }))
    const result = await requestJsonRender({ baseUrl: 'http://fixture.test', timeoutMs: 1000, signal: new AbortController().signal, args, fetchImpl })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ ok: false, error })
    expect(result).not.toHaveProperty('payload')
  })

  it('makes the rejected JSON available to the model and session metadata without rendering a card', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    const fiber = await ctx.plugin(toolJsonRender, { baseUrl: 'http://fixture.test' })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: validationError }), { status: 502 })))
    try {
      const result = await executeRenderUi(ctx.tools, 'invalid-ui', args)
      expect(result.isError).toBe(false)
      expect(JSON.stringify(result.content)).toContain('invalidPayload')
      expect(JSON.stringify(result.content)).toContain('/elements/main/props/content')
      expect(result).toHaveProperty('meta.renderFailure.invalidPayload', invalidPayload)
      expect(result).not.toHaveProperty('meta.payload')
    } finally {
      vi.unstubAllGlobals()
      await fiber.dispose()
    }
  })
})
