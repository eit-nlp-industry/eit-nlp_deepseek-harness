/**
 * Real Loader-path guard. A default export would make unwrapExports drop inject,
 * so the tool would never register.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply, DEFAULT_RENDER_UI_DESCRIPTION } from '@deepseek-ai/dsh-tool-json-render'
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
    expect(ctx.tools.get('render_ui')?.isConcurrencySafe?.({ mode: 'display', user_query: '展示' })).toBe(false)
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
      expect(project({ mode: 'display', user_query: '展示' }, display)).toEqual({ payload, profile: 'base', answerPresentation: 'replace' })
      expect(project({ mode: 'display', user_query: '展示', answer_presentation: 'supplement' }, display))
        .toEqual({ payload, profile: 'base', answerPresentation: 'supplement' })
      expect(project({ mode: 'form', user_query: '选择', intent: 'generic_filters', answer_presentation: 'replace' }, { ...display, mode: 'form' }))
        .toEqual({ payload, profile: 'forms', answerPresentation: 'supplement' })
      expect(project({ mode: 'display', user_query: '展示' }, {
        ...display,
        payload: { ...payload, diagnostics: { profile: 'rich' } },
      })).toMatchObject({ profile: 'rich' })
      expect(project({}, { ok: false, mode: 'display', message: 'failed' })).toBeNull()
    } finally {
      await fiber.dispose()
    }
  })

  it('keeps the pinned render_ui schema aligned with the mounted tool', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(toolJsonRender)
    try {
      const pinned = JSON.parse(readFileSync(new URL('../../../../snapshots/session/json-render-fallback/tool-schemas.expected.json', import.meta.url), 'utf8')) as {
        initial: { name: string }[]
      }
      const live = ctx.tools.schemas().find(schema => schema.name === 'render_ui')
      expect(live?.description).toBe(DEFAULT_RENDER_UI_DESCRIPTION)
      expect(live).toEqual(pinned.initial.find(schema => schema.name === 'render_ui'))
    } finally {
      await fiber.dispose()
    }
  })

  it('honors host config and ends the turn only after a successful form', async () => {
    const previous = process.env.JSON_RENDER_BASE_URL
    const payload = { format: 'json-render-v1', spec: { root: 'card', elements: { card: { type: 'Card', props: { title: 'A' } } } } }
    const respond = (status: number) => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(status === 200 ? payload : { error: { message: '拒绝' } }), {
      status,
      headers: { 'content-type': 'application/json' },
    }))
    try {
      delete process.env.JSON_RENDER_BASE_URL
      const disabled = new Context()
      await disabled.plugin(SystemPrompt)
      await disabled.plugin(ToolRuntime)
      apply(disabled, { enabled: false })
      expect(disabled.tools.schemas().map(schema => schema.name)).not.toContain('render_ui')
      expect(() => apply(disabled, { timeoutMs: 0 })).toThrow(/positive integer/)
      expect(() => apply(disabled, { timeoutMs: 1.5 })).toThrow(/positive integer/)

      const configured = new Context()
      await configured.plugin(SystemPrompt)
      await configured.plugin(ToolRuntime)
      apply(configured, { baseUrl: 'http://configured.test/', description: '  only tables  ' })
      expect(configured.tools.get('render_ui')?.description).toBe('only tables')
      const configuredFetch = respond(200)
      vi.stubGlobal('fetch', configuredFetch)
      const display = await configured.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId('display'),
        name: 'render_ui',
        arguments: { mode: 'display', user_query: '展示', business_data: { name: 'A' } },
      })
      expect(configuredFetch.mock.calls[0]?.[0]).toBe('http://configured.test/v1/render')
      expect(display.isError).toBe(false)
      if (!display.isError) expect(display.concludesTurn).toBeUndefined()

      process.env.JSON_RENDER_BASE_URL = '   '
      const fallback = new Context()
      await fallback.plugin(SystemPrompt)
      await fallback.plugin(ToolRuntime)
      apply(fallback, {})
      const fallbackFetch = respond(200)
      vi.stubGlobal('fetch', fallbackFetch)
      await fallback.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId('fallback'),
        name: 'render_ui',
        arguments: { mode: 'display', user_query: '展示', business_data: { name: 'A' } },
      })
      expect(String(fallbackFetch.mock.calls[0]?.[0])).toBe('http://10.37.0.21:3001/v1/render')

      process.env.JSON_RENDER_BASE_URL = 'http://env.test/'
      const fromEnv = new Context()
      await fromEnv.plugin(SystemPrompt)
      await fromEnv.plugin(ToolRuntime)
      apply(fromEnv, { baseUrl: '  ' })
      const envFetch = respond(400)
      vi.stubGlobal('fetch', envFetch)
      const failed = await fromEnv.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId('failed'),
        name: 'render_ui',
        arguments: { mode: 'display', user_query: '展示', business_data: { name: 'A' } },
      })
      expect(String(envFetch.mock.calls[0]?.[0])).toBe('http://env.test/v1/render')
      expect(failed.isError).toBe(false)
      if (!failed.isError) expect(JSON.stringify(failed.content)).toContain('拒绝')

      const formHost = new Context()
      await formHost.plugin(SystemPrompt)
      await formHost.plugin(ToolRuntime)
      apply(formHost, { baseUrl: 'http://configured.test' })
      vi.stubGlobal('fetch', respond(200))
      const form = await formHost.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId('form'),
        name: 'render_ui',
        arguments: { mode: 'form', user_query: '选择', intent: 'generic_pick_one', business_data: { models: ['A'] } },
      })
      expect(form.isError).toBe(false)
      if (!form.isError) expect(form.concludesTurn).toBe(true)
    } finally {
      vi.unstubAllGlobals()
      if (previous === undefined) delete process.env.JSON_RENDER_BASE_URL
      else process.env.JSON_RENDER_BASE_URL = previous
    }
  })
})
