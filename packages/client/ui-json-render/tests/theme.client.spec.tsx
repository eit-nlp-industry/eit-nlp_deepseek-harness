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
  it.each([2, 3])('stretches nested form containers and distributes %i distinct actions', (count) => {
    vi.stubGlobal('matchMedia', (media: string) => ({
      matches: false, media, onchange: null, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
    }))
    const actions = ['提交草稿', '恢复初始内容', '跳过本条'].slice(0, count)
    const payload: JsonRenderPayload = { format: 'json-render-v1', spec: { root: 'outer', elements: {
      outer: { type: 'Stack', props: { direction: 'vertical', align: 'start' }, children: ['inner', 'actions'] },
      inner: { type: 'Stack', props: { direction: 'vertical' }, children: ['fields'] },
      fields: { type: 'DynamicForm', props: { fields: [{ type: 'input', key: 'contact', label: '联系人', value: '林晓' }] } },
      actions: { type: 'Stack', props: { direction: 'horizontal' }, children: actions },
      ...Object.fromEntries(actions.map((label, index) => [label, {
        type: 'Button', props: { label, intent: index === 0 ? 'primary' : 'default', variant: index === 0 ? 'default' : 'outline' },
      }])),
    } } }
    const { container } = render(<JsonRenderCard payload={payload} instanceId={`layout-${count}`} submitForm={vi.fn()} />)
    const sheet = transform({ filename: 'JsonRenderRow.module.css',
      code: readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/client/JsonRenderRow.module.css')), cssModules: true })
    const style = document.createElement('style')
    style.dataset.jsonRenderTestTheme = ''
    style.textContent = sheet.code.toString().replaceAll(sheet.exports!.panel!.name, container.firstElementChild!.className)
    document.head.append(style)
    for (const stack of container.querySelectorAll('.eit-jr-stack--vertical')) {
      expect(getComputedStyle(stack).width).toBe('100%')
    }
    expect(container.querySelectorAll('.ant-btn-primary')).toHaveLength(1)
    expect(container.querySelectorAll('.ant-btn-default')).toHaveLength(count - 1)
    const row = screen.getByRole('button', { name: '提交草稿' }).parentElement!
    expect(getComputedStyle(row).width).toBe('100%')
    expect(getComputedStyle(row).flexWrap).toBe('wrap')
  })

  it('leaves nested image previews unframed while retaining unrelated detail cards', () => {
    const payload: JsonRenderPayload = {
      format: 'json-render-v1',
      spec: {
        root: 'details',
        elements: {
          details: { type: 'Card', props: { title: '图片详情' }, children: ['preview', 'metadata'] },
          preview: { type: 'Card', props: { title: '图片预览' }, children: ['image'] },
          image: { type: 'Image', props: { src: '/sample.png', alt: '样例图' } },
          metadata: { type: 'Card', props: { title: '文件信息' }, children: ['text'] },
          text: { type: 'Text', props: { text: 'PNG' } },
        },
      },
    }
    const { container } = render(<JsonRenderCard payload={payload} instanceId="nested-image" submitForm={vi.fn()} />)
    const sheet = transform({
      filename: 'JsonRenderRow.module.css',
      code: readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/client/JsonRenderRow.module.css')),
      cssModules: true,
    })
    const style = document.createElement('style')
    style.dataset.jsonRenderTestTheme = ''
    style.textContent = sheet.code.toString().replaceAll(sheet.exports!.panel!.name, container.firstElementChild!.className)
    document.head.append(style)
    const preview = screen.getByText('图片预览').closest('.eit-jr-card')!
    expect(getComputedStyle(container.firstElementChild!).paddingTop).toBe('0px')
    expect(getComputedStyle(preview).borderTopWidth).toBe('0px')
    expect(getComputedStyle(preview.querySelector('.ant-card-body')!).paddingInline).toBe('0px')
    const image = screen.getByRole('img', { name: '样例图' })
    expect(getComputedStyle(image.closest('.eit-jr-image')!).maxWidth).toBe('640px')
    expect(getComputedStyle(image.parentElement!).aspectRatio).toBe('16 / 9')
    expect(getComputedStyle(image).objectFit).toBe('contain')
    expect(getComputedStyle(image).height).toBe('100%')
    const metadata = screen.getByText('文件信息').closest('.eit-jr-card')!
    expect(getComputedStyle(metadata.querySelector('.ant-card-body')!).paddingLeft).toBe('16px')
  })

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
    expect(submitForm.mock.calls[0]![0]).toContain('选择文档：kb-deploy')
    expect(await screen.findByText('已提交，等待继续回答')).toBeTruthy()
  }, 20_000)
})
