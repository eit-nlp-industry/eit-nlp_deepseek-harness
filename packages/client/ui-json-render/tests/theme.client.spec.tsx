// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'lightningcss'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { FormField, JsonRenderPayload } from '@eit/json-render-protocol'
import { JsonRenderCard } from '../src/client/JsonRenderCard.tsx'

afterEach(() => {
  cleanup()
  document.head.querySelectorAll('[data-json-render-test-theme]').forEach((style) => { style.remove() })
  vi.unstubAllGlobals()
})

describe('themed json-render forms', () => {
  it.each(['Card', 'Stack'] as const)('frames a %s root, keeps its picker themed, and submits its selection', async (rootType) => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }))
    const payload: JsonRenderPayload = {
      format: 'json-render-v1',
      spec: {
        root: 'card',
        elements: {
          card: {
            type: rootType,
            props: rootType === 'Card' ? { title: '知识库文档' } : { direction: 'vertical', gap: 'md', align: 'stretch' },
            children: ['fields', 'submit'],
          },
          fields: {
            type: 'DynamicForm',
            props: {
              fields: [
                { key: 'document', type: 'select', label: '选择文档', value: { options: [{ label: '部署指南', value: 'kb-deploy' }] } },
                { key: 'city', type: 'input', label: '城市或地区' },
                { key: 'preferences', type: 'input', label: '出行场景与偏好' },
              ] satisfies FormField[],
            },
          },
          submit: { type: 'Button', props: { label: '确认选择' }, on: { press: { action: 'form.submit' } } },
        },
      },
    }
    const submitForm = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    const { container } = render(<JsonRenderCard payload={payload} instanceId="knowledge-picker" submitForm={submitForm} />)
    // jsdom receives the compiled feature sheet as well as Ant Design's runtime sheets.
    const sheet = transform({
      filename: 'JsonRenderRow.module.css',
      code: readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/client/JsonRenderRow.module.css')),
      cssModules: true,
    })
    const style = document.createElement('style')
    style.dataset.jsonRenderTestTheme = ''
    style.textContent = sheet.code.toString().replaceAll(sheet.exports!.panel!.name, container.firstElementChild!.className)
    document.head.append(style)
    const surface = container.firstElementChild!
    expect(getComputedStyle(surface).paddingTop).toBe('20px')
    const control = container.querySelector('.ant-card, .ant-btn')!
    expect(getComputedStyle(control).getPropertyValue('--ant-color-text').trim()).toBe('var(--dsw-alias-label-primary)')
    for (const field of container.querySelectorAll('.ant-form-item-control')) {
      expect(getComputedStyle(field).flexBasis).toBe('auto')
      expect(getComputedStyle(field).flexShrink).toBe('0')
    }
    if (rootType === 'Card') {
      expect(getComputedStyle(control).boxShadow).toBe('none')
      expect(getComputedStyle(container.querySelector('.ant-card-body')!).gap).toBe('16px')
    }

    fireEvent.mouseDown(screen.getByRole('combobox'))
    await waitFor(() => { expect(container.querySelector('.ant-select-dropdown')).not.toBeNull() })
    const dropdown = container.querySelector<HTMLElement>('.ant-select-dropdown')!
    fireEvent.click(within(dropdown).getByText('部署指南', { selector: '.ant-select-item-option-content' }))
    fireEvent.click(screen.getByRole('button', { name: '确认选择' }))

    await waitFor(() => { expect(submitForm).toHaveBeenCalledOnce() })
    expect(submitForm.mock.calls[0]![0]).toContain('"document":"kb-deploy"')
    expect(await screen.findByText('已提交，等待继续回答')).toBeTruthy()
  }, 20_000)
})
