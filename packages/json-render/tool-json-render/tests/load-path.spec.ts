/**
 * Real Loader-path guard. A default export would make unwrapExports drop inject,
 * so the tool would never register.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as toolJsonRender from '@deepseek-ai/dsh-tool-json-render'

describe('dsh-tool-json-render real-load-path guard', () => {
  it('has no default export and keeps name and inject through unwrapExports', () => {
    expect('default' in toolJsonRender).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(toolJsonRender) as Record<string, unknown>
    expect(unwrapped).toBe(toolJsonRender)
    expect(unwrapped.name).toBe('tool-json-render')
    expect(unwrapped.inject).toEqual(['tools'])
    expect(typeof unwrapped.apply).toBe('function')
  })

  it('registers render_ui on the tool runtime', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(toolJsonRender) as Parameters<Context['plugin']>[0]
    const fiber = await ctx.plugin(unwrapped)
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('render_ui')
    await fiber.dispose()
  })

  it('declares answer replacement only for successful display results', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(toolJsonRender)
    try {
      const output = ctx.tools.get('render_ui')!.output
      const project = output.presentationMeta!.bind(output)
      const payload = { format: 'json-render-v1', spec: { root: 'card', elements: {} } }
      const display = { ok: true, mode: 'display', message: 'ready', payload }
      expect(project({ mode: 'display' }, display)).toEqual({ payload, answerPresentation: 'replace' })
      expect(project({ mode: 'display', answer_presentation: 'supplement' }, display))
        .toEqual({ payload, answerPresentation: 'supplement' })
      expect(project({ mode: 'form', answer_presentation: 'replace' }, { ...display, mode: 'form' }))
        .toEqual({ payload, answerPresentation: 'supplement' })
      expect(project({}, { ok: false, mode: 'display', message: 'failed' })).toBeNull()
    } finally {
      await fiber.dispose()
    }
  })
})
