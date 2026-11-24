// @vitest-environment jsdom
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { build } from 'tsdown'
import { afterEach, expect, it, vi } from 'vitest'
import { createElement, type ComponentType } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.head.querySelectorAll('[data-plugin-css]').forEach((style) => { style.remove() })
})

it('executes the browser plugin factory and renders Chart as SVG', async () => {
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
    let factory: ((require: (name: string) => unknown) => Record<string, unknown>) | undefined
    runInNewContext(entry.code, {
      window: {
        __ModuleLoader__: { load(value: { factory: NonNullable<typeof factory> }) { factory = value.factory } },
        document,
        devicePixelRatio: 1,
        addEventListener: window.addEventListener.bind(window),
        removeEventListener: window.removeEventListener.bind(window),
      },
      document, navigator: window.navigator,
      getComputedStyle: window.getComputedStyle.bind(window),
      HTMLElement, SVGElement, Element, ShadowRoot,
      console, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL, URLSearchParams, AbortController,
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
  } finally {
    for (const bundle of bundles) await bundle[Symbol.asyncDispose]()
  }
}, 120_000)
