/** Shared presentation guidance reaches ordinary scopes before any tool call. */
import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { PERSONA_PREFIX_SECTION, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { describe, expect, it } from 'vitest'
import * as JsonRender from '@deepseek-ai/dsh-tool-json-render'

const sectionName = 'json-render:presentation-policy'

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  return ctx
}

describe('shared presentation policy', () => {
  it('provides the packaged rules before a call without skill or file tools', async () => {
    const ctx = await harness()
    try {
      await ctx.plugin(JsonRender)
      const assembly = await ctx.systemPrompt.assemble()
      const policy = assembly.sections.find(section => section.name === sectionName)
      expect(policy?.interpolate).toBe(false)
      expect(policy?.text).toContain('# DSH 呈现选型')
      expect(policy?.text).toContain('# 按钮预设、回传与宿主支持')
      expect(policy?.text).toContain('payload.form')
      expect(policy?.text).toContain('跳过')
      expect(policy?.text).toContain('关键意图尚未确定时，最多先用一道原生问题澄清')
      expect(policy?.text).toContain('不得拆成同一份原生问卷中的多题，也不得分多次原生提问收集')
      const recordedPrompt = readFileSync(new URL('../../../../snapshots/session/json-render-fallback/system-prompt.expected.md', import.meta.url), 'utf8')
      expect(recordedPrompt.replaceAll('\r\n', '\n')).toContain(policy?.text.replaceAll('\r\n', '\n'))
      expect(assembly.tools.map(tool => tool.name)).toEqual(['render_ui'])
      const root = new URL('../skills/select-dsh-presentation/', import.meta.url)
      for (const path of ['references/button-actions.md', 'references/capabilities.md', 'references/examples.md']) {
        expect(policy?.text).toContain(readFileSync(new URL(path, root), 'utf8').trim())
      }
      const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { files: string[] }
      expect(manifest.files).toContain('skills/')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('survives two preset persona overrides without granting a restricted tool', async () => {
    const ctx = await harness()
    try {
      await ctx.plugin(JsonRender)
      for (const identity of ['Travel helper', 'New custom agent']) {
        const key: ScopeKey = { agent: identity }
        const scope = createScope(ctx, key)
        await scope.ctx.plugin({
          name: 'test-persona', inject: ['systemPrompt', 'tools'],
          apply(scoped: Context) {
            scoped.systemPrompt.section({ name: PERSONA_PREFIX_SECTION, order: 0, text: identity })
            scoped.tools.restrict({ deny: ['render_ui'] })
          },
        })
        const assembly = await ctx.systemPrompt.assemble({ scope: key })
        expect(renderPrompt(assembly)).toContain(identity)
        expect(assembly.sections.find(section => section.name === sectionName)?.text).toContain('当前可用工具')
        expect(assembly.tools).toEqual([])
      }
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('honors complete prompt replacement', async () => {
    const ctx = await harness()
    try {
      await ctx.plugin(JsonRender)
      const key: ScopeKey = { agent: 'complete-agent' }
      await createScope(ctx, key).ctx.plugin({
        name: 'complete-persona', inject: ['systemPrompt'],
        apply(scoped: Context) {
          scoped.systemPrompt.section({ name: PERSONA_PREFIX_SECTION, order: 0, text: 'Complete.', complete: true })
        },
      })
      expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: key }))).toBe('Complete.')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('removes the guidance and tool when the plugin unloads', async () => {
    const ctx = await harness()
    try {
      const fiber = await ctx.plugin(JsonRender)
      expect((await ctx.systemPrompt.assemble()).sections.some(section => section.name === sectionName)).toBe(true)
      await fiber.dispose()
      const assembly = await ctx.systemPrompt.assemble()
      expect(assembly.sections.some(section => section.name === sectionName)).toBe(false)
      expect(assembly.tools).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
