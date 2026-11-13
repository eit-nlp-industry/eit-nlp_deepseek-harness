// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { JsonRenderPayload } from '@eit/json-render-protocol'
import { JsonRenderCard } from '../src/client/JsonRenderCard.tsx'

afterEach(cleanup)

const workflow = {
  version: 'workflow-v1', id: 'materials', title: '取材料流程',
  steps: [{ id: 'office', type: 'step', title: '前往办公室' }],
}

function workflowPayload(): JsonRenderPayload {
  return {
    format: 'json-render-v1',
    state: { initial: { _ui: { workflow }, parameters: { destination: '图书馆门口' } } },
    spec: { root: 'main', elements: {
      main: { type: 'Stack', props: { gap: 'md' }, children: ['workflow', 'save', 'execute'] },
      workflow: {
        type: 'Workflow',
        props: { value: { $bindState: '/_ui/workflow' }, mode: 'edit' },
        on: { change: { action: 'emit.event', params: { name: 'workflow.change', payload: { workflow: { $state: '/_ui/workflow' } } } } },
      },
      save: { type: 'Button', props: { label: '保存流程' }, on: { press: { action: 'emit.event', params: {
        name: 'workflow.save', payload: { workflow: { $state: '/_ui/workflow' }, parameters: { $state: '/parameters' } },
      } } } },
      execute: { type: 'Button', props: { label: '执行流程' }, on: { press: { action: 'emit.event', params: {
        name: 'workflow.execute', payload: { workflow: { $state: '/_ui/workflow' }, parameters: { $state: '/parameters' } },
      } } } },
    } },
  }
}

const routeItems = [
  { id: 'library', title: '图书馆', description: '第一站 · 取书' },
  { id: 'college', title: '四明书院', description: '第二站 · 交接材料' },
  { id: 'canteen', title: '食堂', description: '拖到最前面，先吃饭' },
]

function routePayload(): JsonRenderPayload {
  return {
    format: 'json-render-v1',
    state: { initial: { _ui: { order: ['library', 'college', 'canteen'] } } },
    spec: { root: 'main', elements: {
      main: { type: 'Stack', children: ['sort', 'apply'] },
      sort: { type: 'SortableSequence', props: { items: routeItems, value: { $bindState: '/_ui/order' } }, on: { change: { action: 'emit.event', params: { name: 'route.order.change', payload: { order: { $state: '/_ui/order' } } } } } },
      apply: { type: 'Button', props: { label: '应用顺序' }, on: { press: { action: 'emit.event', params: { name: 'route.order.apply', payload: { order: { $state: '/_ui/order' } } } } } },
    } },
  }
}

function submitted(text: string): Record<string, unknown> {
  return JSON.parse(text.slice(text.indexOf('\n') + 1)) as Record<string, unknown>
}

it('saves the edited workflow through the form prompt and keeps it after a failed send', async () => {
  const submitForm = vi.fn<(text: string) => Promise<void>>()
  let release: (() => void) | undefined
  submitForm.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve }))
  render(<JsonRenderCard payload={workflowPayload()} instanceId="workflow" submitForm={submitForm} />)
  fireEvent.click(screen.getByRole('button', { name: '＋ 新增步骤' }))
  expect(screen.getByText('新步骤')).toBeTruthy()
  expect(submitForm).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '执行流程' }))
  expect(submitForm).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: '保存流程' }))
  expect(await screen.findByText('正在提交')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '保存流程' }))
  expect(submitForm).toHaveBeenCalledOnce()
  release?.()
  expect(await screen.findByText('已提交，等待继续回答')).toBeTruthy()
  const saved = submitForm.mock.calls[0]![0]
  expect(saved.startsWith('我已提交编辑后的流程\n<!-- dsh:workflow-submit -->\n')).toBe(true)
  expect(saved).toContain('1. 步骤：前往办公室（ID：office）\n2. 步骤：新步骤')
  expect(saved).toContain('destination："图书馆门口"')
  expect(saved).toContain('下一条回复实际调用 render_ui')

  submitForm.mockRejectedValueOnce(new Error('网络失败'))
  fireEvent.click(screen.getByRole('button', { name: '保存流程' }))
  expect(await screen.findByText('网络失败')).toBeTruthy()
  expect(screen.getByText('新步骤')).toBeTruthy()
  submitForm.mockResolvedValueOnce(undefined)
  fireEvent.click(screen.getByRole('button', { name: '保存流程' }))
  expect(await screen.findByText('已提交，等待继续回答')).toBeTruthy()
  expect(submitForm).toHaveBeenCalledTimes(3)
  expect(submitForm.mock.calls[2]![0]).toBe(saved)
}, 20_000)

it('submits the dragged route as full items and ignores draft changes', async () => {
  const submitForm = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
  render(<JsonRenderCard payload={routePayload()} instanceId="route" submitForm={submitForm} />)
  const handle = screen.getByRole('button', { name: '移动 食堂' })
  fireEvent.keyDown(handle, { key: 'ArrowUp' })
  fireEvent.keyDown(handle, { key: 'ArrowUp' })
  expect(submitForm).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '应用顺序' }))
  expect(await screen.findByText('已提交，等待继续回答')).toBeTruthy()
  const sent = submitted(submitForm.mock.calls[0]![0])
  expect(sent.order).toEqual(['canteen', 'library', 'college'])
  expect(sent.orderedItems).toEqual([routeItems[2], routeItems[0], routeItems[1]])
})

it('reports missing route items without sending', async () => {
  const submitForm = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
  const missing: JsonRenderPayload = {
    format: 'json-render-v1',
    state: { initial: { _ui: { order: ['a', 'b'] } } },
    spec: { root: 'apply', elements: {
      apply: { type: 'Button', props: { label: '应用顺序' }, on: { press: { action: 'emit.event', params: { name: 'route.order.apply', payload: { order: ['b', 'a'] } } } } },
    } },
  }
  render(<JsonRenderCard payload={missing} instanceId="missing" submitForm={submitForm} />)
  fireEvent.click(screen.getByRole('button', { name: '应用顺序' }))
  expect(await screen.findByText('缺少条目数据，无法提交')).toBeTruthy()
  expect(submitForm).not.toHaveBeenCalled()
})

it('orders items from the call business data instead of the initial id list', async () => {
  const submitForm = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
  const missing: JsonRenderPayload = {
    format: 'json-render-v1',
    state: { initial: { _ui: { order: ['a', 'b'] } } },
    spec: { root: 'apply', elements: {
      apply: { type: 'Button', props: { label: '应用顺序' }, on: { press: { action: 'emit.event', params: { name: 'route.order.apply', payload: { order: ['b', 'a'] } } } } },
    } },
  }
  render(<JsonRenderCard payload={missing} instanceId="business" submitForm={submitForm} businessData={{
    items: [{ id: 'a', title: '甲', detail: '一条' }, { id: 'b', title: '乙', detail: '二条' }],
  }} />)
  fireEvent.click(screen.getByRole('button', { name: '应用顺序' }))
  expect(await screen.findByText('已提交，等待继续回答')).toBeTruthy()
  expect(submitted(submitForm.mock.calls[0]![0])).toEqual({
    order: ['b', 'a'],
    orderedItems: [{ id: 'b', title: '乙', detail: '二条' }, { id: 'a', title: '甲', detail: '一条' }],
  })
})

it('ignores another confirmation while a form submit is in flight', async () => {
  let release: (() => void) | undefined
  const submitForm = vi.fn<(text: string) => Promise<void>>(() => new Promise<void>((resolve) => { release = resolve }))
  const payload: JsonRenderPayload = {
    format: 'json-render-v1',
    spec: { root: 'main', elements: {
      main: { type: 'Stack', children: ['submit', 'apply'] },
      submit: { type: 'Button', props: { label: '确认选择' }, on: { press: { action: 'form.submit' } } },
      apply: { type: 'Button', props: { label: '应用顺序' }, on: { press: { action: 'emit.event', params: { name: 'route.order.apply', payload: { order: ['missing'] } } } } },
    } },
  }
  render(<JsonRenderCard payload={payload} instanceId="pending" submitForm={submitForm} />)
  fireEvent.click(screen.getByRole('button', { name: '确认选择' }))
  fireEvent.click(screen.getByRole('button', { name: '应用顺序' }))
  expect(screen.queryByText('缺少条目数据，无法提交')).toBeNull()
  expect(submitForm).toHaveBeenCalledOnce()
  release?.()
  expect(await screen.findByText('已提交，等待继续回答')).toBeTruthy()
  expect(submitForm).toHaveBeenCalledOnce()
})

it('shows a generic failure when the prompt rejects without an Error', async () => {
  const submitForm = vi.fn<(text: string) => Promise<void>>().mockRejectedValueOnce('offline')
  const payload: JsonRenderPayload = {
    format: 'json-render-v1',
    spec: { root: 'apply', elements: {
      apply: { type: 'Button', props: { label: '应用顺序' }, on: { press: { action: 'emit.event', params: { name: 'route.order.apply', payload: { order: ['a'] } } } } },
    } },
  }
  render(<JsonRenderCard payload={payload} instanceId="generic-failure" submitForm={submitForm} businessData={{
    items: [{ id: 'a', title: '甲' }],
  }} />)
  fireEvent.click(screen.getByRole('button', { name: '应用顺序' }))
  expect(await screen.findByText('提交失败')).toBeTruthy()
  expect(screen.getByRole('button', { name: '应用顺序' })).toBeTruthy()
})

it('keeps a successful form submit one-shot and unchanged', async () => {
  let release: (() => void) | undefined
  const submitForm = vi.fn<(text: string) => Promise<void>>(() => new Promise<void>((resolve) => { release = resolve }))
  const payload: JsonRenderPayload = {
    format: 'json-render-v1',
    spec: { root: 'submit', elements: {
      submit: { type: 'Button', props: { label: '确认选择' }, on: { press: { action: 'form.submit' } } },
    } },
  }
  render(<JsonRenderCard payload={payload} instanceId="form" submitForm={submitForm} />)
  fireEvent.click(screen.getByRole('button', { name: '确认选择' }))
  expect(screen.queryByText('正在提交')).toBeNull()
  expect(submitForm).toHaveBeenCalledOnce()
  expect(submitForm.mock.calls[0]![0].startsWith('用户提交了 json-render 表单，请根据这些值继续，不要再次弹出同一张表：')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '确认选择' }))
  expect(submitForm).toHaveBeenCalledOnce()
  release?.()
  expect(await screen.findByText('已提交，等待继续回答')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '确认选择' }))
  expect(submitForm).toHaveBeenCalledOnce()
})
