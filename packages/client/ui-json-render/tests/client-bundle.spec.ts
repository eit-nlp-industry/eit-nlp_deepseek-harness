// @vitest-environment jsdom
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { build } from 'tsdown'
import { afterEach, expect, it, vi } from 'vitest'
import { createElement, type ComponentType } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.head.querySelectorAll('[data-plugin-css]').forEach((style) => { style.remove() })
})

it('renders Chart and retries failed form events in the HTTP browser bundle', async () => {
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: false, media, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }))
  // jsdom has no Canvas; ECharts supports SVG with fallback text metrics.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const bundles = await build({
    cwd: packageDirectory,
    config: resolve(packageDirectory, 'tsdown.config.ts'),
    configLoader: 'native', filter: /\/client$/,
    write: false, clean: false, exports: false, report: false, logLevel: 'silent',
  })
  try {
    let failRandom = false
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
    const entry = bundles.flatMap(bundle => bundle.chunks)
      .find(chunk => chunk.type === 'chunk' && chunk.fileName === 'client.js')
    if (entry === undefined || entry.type !== 'chunk') throw new Error('Browser entry missing')
    const localRequire = createRequire(import.meta.url)
    const webRequire = createRequire(resolve(packageDirectory, '../../../apps/web/package.json'))
    const seeds = new Map<string, unknown>([
      ['react', localRequire('react')], ['react/jsx-runtime', localRequire('react/jsx-runtime')],
      ['react-dom', webRequire('react-dom')], ['zod', localRequire('zod')],
      ['@deepseek-ai/dsh-client-ui-primitives', {}],
    ])
    let factory: ((require: (name: string) => unknown) => { apply?: (context: unknown) => void }) | undefined
    runInNewContext(entry.code, {
      window: {
        __ModuleLoader__: { load(value: { factory: NonNullable<typeof factory> }) { factory = value.factory } },
        document,
        devicePixelRatio: 1,
        matchMedia: window.matchMedia,
        Node,
        addEventListener: window.addEventListener.bind(window),
        removeEventListener: window.removeEventListener.bind(window),
      },
      document, navigator: window.navigator,
      getComputedStyle: window.getComputedStyle.bind(window),
      HTMLElement, SVGElement, Element, ShadowRoot, Node,
      console, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL, URLSearchParams, AbortController,
      crypto: { getRandomValues(array: Uint8Array<ArrayBuffer>) {
        if (failRandom) throw new Error('random source unavailable')
        return getRandomValues(array)
      } },
    })
    if (factory === undefined) throw new Error('Plugin factory was not registered')
    const exports = factory((name) => {
      if (!seeds.has(name)) throw new Error(`Unregistered module: ${name}`)
      return seeds.get(name)
    })
    expect(exports.apply).toBeTypeOf('function')
    if (typeof exports.apply !== 'function') throw new Error('Plugin apply missing')
    let Tail: ComponentType<Record<string, unknown>> | undefined
    exports.apply({
      effect(callback: () => unknown) { callback() },
      locale: { register() {} },
      uiConversation: { events: { register() {} } },
      slots: {
        inject(_name: string, callback: () => void) { callback() },
        register(description: { name: string }, component: ComponentType<Record<string, unknown>>) {
          if (description.name === 'conversation.chat.turnTail') Tail = component
        },
      },
    })
    if (Tail === undefined) throw new Error('Turn-tail component missing')
    const payload = { format: 'json-render-v1', spec: { root: 'chart', elements: {
      chart: { type: 'Chart', props: { type: 'bar', labels: ['Q1', 'Q2'], series: [{ name: '营收', values: [120, 156] }] } },
    } } }
    render(createElement(Tail, {
      turn: { data: { get: () => [{ callId: 'chart', seq: 1, payload, profile: 'rich', answerPresentation: 'supplement' }] } },
      seq: 1, sessionId: 'chart-test', canReplaceAnswer: false, submitForm: async () => {},
    }))
    await waitFor(() => {
      const svg = document.querySelector('.eit-jr-chart__canvas svg')
      expect(svg).not.toBeNull()
      expect(svg?.textContent).toContain('Q1')
      expect(svg?.textContent).toContain('Q2')
      expect(document.querySelector('[role="alert"]')).toBeNull()
    })
    cleanup()
    const submitForm = vi.fn<(sessionId: string, text: string) => Promise<void>>().mockResolvedValue(undefined)
    const form = { format: 'json-render-v1', spec: { root: 'root', elements: {
      root: { type: 'Stack', children: ['fields', 'submit'] },
      fields: { type: 'DynamicForm', props: { fields: [{ type: 'input', key: 'note', label: '说明', value: '费用' }] } },
      submit: { type: 'Button', props: { label: '确认记账' }, on: { press: { action: 'form.submit' } } },
    } } }
    render(createElement(Tail, {
      turn: { data: { get: () => [{ callId: 'form', seq: 1, payload: form, answerPresentation: 'supplement' }] } },
      seq: 1, sessionId: 'http-test', canReplaceAnswer: false, submitForm,
    }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '编辑后的费用' } })
    failRandom = true
    fireEvent.click(screen.getByRole('button', { name: '确认记账' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '操作未能发送，请重试')
    expect(submitForm).not.toHaveBeenCalled()
    expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('编辑后的费用')
    failRandom = false
    fireEvent.click(screen.getByRole('button', { name: '确认记账' }))
    await waitFor(() => { expect(submitForm).toHaveBeenCalledOnce() })
    expect(submitForm.mock.calls[0]![1]).toContain('编辑后的费用')
  } finally {
    for (const bundle of bundles) await bundle[Symbol.asyncDispose]()
  }
}, 120_000)
