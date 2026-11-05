import { describe, expect, it } from 'vitest'
import type { JsonRenderEvent, JsonRenderPayload } from '@eit/json-render-protocol'
import {
  businessDataFromToolArguments, decideJsonRenderSubmit, formValues, type JsonRenderSubmitDecision,
} from '../src/client/submit.ts'

const items = [
  { id: 'library', title: '图书馆', description: '第一站 · 取书' },
  { id: 'college', title: '四明书院', description: '第二站 · 交接材料' },
  { id: 'canteen', title: '食堂', description: '拖到最前面，先吃饭' },
]

const initialWorkflow = {
  version: 'workflow-v1', id: 'materials', title: '取材料流程',
  steps: [{ id: 'office', type: 'step', title: '前往办公室' }],
}

function event(name: string, payload?: Record<string, unknown>, type: JsonRenderEvent['event']['type'] = 'click'): JsonRenderEvent {
  return {
    protocol: 'json-render-event',
    version: '1.0',
    id: 'event-1',
    instanceId: 'instance-1',
    event: { name, type },
    state: { _ui: { order: ['library', 'college', 'canteen'], workflow: { ...initialWorkflow, title: '旧流程' } } },
    ...payload === undefined ? {} : { payload },
  }
}

function payload(elements: JsonRenderPayload['spec']['elements'], initial?: Record<string, unknown>): JsonRenderPayload {
  return {
    format: 'json-render-v1',
    ...initial === undefined ? {} : { state: { initial } },
    spec: { root: 'main', elements: { main: { type: 'Stack' }, ...elements } },
  }
}

function body(decision: JsonRenderSubmitDecision): { intro: string; data: Record<string, unknown> } {
  if (decision.action !== 'send') throw new Error(`expected send, received ${decision.action}`)
  const split = decision.text.indexOf('\n')
  return { intro: decision.text.slice(0, split), data: JSON.parse(decision.text.slice(split + 1)) as Record<string, unknown> }
}

describe('json-render confirmation messages', () => {
  it('keeps form.submit on the existing user message and ignores the event type', () => {
    expect(formValues(event('form.submit'))).toEqual({})
    expect(formValues(event('form.submit', { city: '杭州' }))).toEqual({ city: '杭州' })
    const decision = decideJsonRenderSubmit(event('form.submit', { form: { document: 'kb-deploy' } }, 'submit'), {
      payload: payload({}),
    })
    expect(decision).toMatchObject({ action: 'send', releaseOnSuccess: false })
    expect(body(decision)).toEqual({
      intro: '用户提交了 json-render 表单，请根据这些值继续，不要再次弹出同一张表：',
      data: { document: 'kb-deploy' },
    })
  })

  it('sends the edited workflow from the event instead of the initial document', () => {
    const workflow = {
      version: 'workflow-v1', id: 'materials', title: '取材料流程',
      steps: [
        { id: 'office', type: 'step', title: '前往办公室', description: '敲门' },
        {
          id: 'present', type: 'condition', title: '老师在吗',
          branches: [
            { id: 'yes', label: '在', steps: [{ id: 'take', type: 'step', title: '取材料' }] },
            { id: 'no', label: '不在', steps: [] },
          ],
        },
      ],
    }
    const decision = decideJsonRenderSubmit(event('workflow.save', { workflow, parameters: { destination: '图书馆门口' } }), {
      payload: payload({
        workflow: { type: 'Workflow', props: { value: { $bindState: '/_ui/workflow' } } },
      }, { _ui: { workflow: initialWorkflow } }),
    })
    expect(decision).toMatchObject({ action: 'send', releaseOnSuccess: true })
    if (decision.action !== 'send') throw new Error('expected workflow submission')
    expect(decision.text).toContain('下一条回复实际调用 render_ui')
    expect(decision.text).toContain('流程名称：取材料流程\n流程 ID：materials')
    expect(decision.text).toContain('1. 步骤：前往办公室（ID：office）\n   说明：敲门')
    expect(decision.text).toContain('2. 条件：老师在吗（ID：present）')
    expect(decision.text).toContain('分支：在（ID：yes）\n     1. 步骤：取材料（ID：take）')
    expect(decision.text).toContain('分支：不在（ID：no）\n     无步骤')
    expect(decision.text).toContain('destination："图书馆门口"')
    expect(decision.text).not.toContain('旧流程')
  })

  it.each([
    ['missing payload', undefined],
    ['array parameters', { workflow: initialWorkflow, parameters: [] }],
    ['missing parameters', { workflow: initialWorkflow }],
  ] as const)('rejects a workflow save with %s', (_label, eventPayload) => {
    const decision = decideJsonRenderSubmit(
      eventPayload === undefined ? event('workflow.save') : event('workflow.save', eventPayload),
      { payload: payload({}) },
    )
    expect(decision).toEqual({ action: 'reject', notice: '流程参数缺失或不完整，无法提交' })
  })

  it.each([
    ['wrong version', { ...initialWorkflow, version: 'other' }],
    ['blank title', { ...initialWorkflow, title: '  ' }],
    ['empty steps', { ...initialWorkflow, steps: [] }],
    ['step without a title', { ...initialWorkflow, steps: [{ id: 'office', type: 'step' }] }],
    ['blank step id', { ...initialWorkflow, steps: [{ id: ' ', type: 'step', title: '前往办公室' }] }],
    ['unknown node', { ...initialWorkflow, steps: [{ id: 'office', type: 'note', title: '备注' }] }],
    ['nested condition', { ...initialWorkflow, steps: [{ id: 'ask', type: 'condition', title: '在吗', branches: [{ id: 'yes', label: '在', steps: [{ id: 'inner', type: 'condition', title: '再问', branches: [] }] }] }] }],
    ['three branches', { ...initialWorkflow, steps: [{ id: 'ask', type: 'condition', title: '在吗', branches: [{ id: 'a', label: '甲', steps: [] }, { id: 'b', label: '乙', steps: [] }, { id: 'c', label: '丙', steps: [] }] }] }],
    ['no branches', { ...initialWorkflow, steps: [{ id: 'ask', type: 'condition', title: '在吗', branches: [] }] }],
    ['non-object branch', { ...initialWorkflow, steps: [{ id: 'ask', type: 'condition', title: '在吗', branches: [null] }] }],
    ['branch without steps', { ...initialWorkflow, steps: [{ id: 'ask', type: 'condition', title: '在吗', branches: [{ id: 'yes', label: '在' }] }] }],
    ['blank branch label', { ...initialWorkflow, steps: [{ id: 'ask', type: 'condition', title: '在吗', branches: [{ id: 'yes', label: ' ', steps: [] }] }] }],
    ['non-object step', { ...initialWorkflow, steps: [null] }],
  ])('rejects an incomplete workflow: %s', (_label, workflow) => {
    const decision = decideJsonRenderSubmit(event('workflow.save', { workflow, parameters: {} }), { payload: payload({}) })
    expect(decision).toEqual({ action: 'reject', notice: '流程数据不完整，无法提交' })
  })

  it('rejects a workflow whose ids are not unique', () => {
    const workflow = {
      ...initialWorkflow,
      steps: [
        { id: 'office', type: 'step', title: '前往办公室' },
        { id: 'ask', type: 'condition', title: '在吗', branches: [{ id: 'office', label: '在', steps: [{ id: 'take', type: 'step', title: '取材料' }] }] },
      ],
    }
    const decision = decideJsonRenderSubmit(event('workflow.save', { workflow, parameters: {} }), { payload: payload({}) })
    expect(decision).toEqual({ action: 'reject', notice: '流程条目 ID 重复，无法提交' })
  })

  it('sends the event order and the sortable records, not the initial order or map places', () => {
    const decision = decideJsonRenderSubmit(event('route.order.apply', { order: ['canteen', 'library', 'college'] }), {
      payload: payload({
        map: { type: 'MapPreview', props: { places: [{ id: 'library', label: '地图图书馆', x: 1, y: 2 }, { id: 'college', label: '地图书院', x: 3, y: 4 }, { id: 'canteen', label: '地图食堂', x: 5, y: 6 }] } },
        sort: { type: 'SortableSequence', props: { items, value: { $bindState: '/_ui/order' } } },
        ignored: { type: 'SortableSequence', props: { items: 'not-a-list' } },
        unbound: { type: 'SortableSequence' },
      }, { _ui: { order: ['library', 'college', 'canteen'] } }),
    })
    const sent = body(decision)
    expect(sent.intro).toBe('用户提交了 json-render 排序，请根据这些数据继续：')
    expect(sent.data.order).toEqual(['canteen', 'library', 'college'])
    expect(sent.data.orderedItems).toEqual([items[2], items[0], items[1]])
    const skipped = decideJsonRenderSubmit(event('route.order.apply', { order: ['a'] }), {
      payload: payload({
        other: { type: 'SortableSequence', props: { items: [{ id: 'x', title: '其他' }] } },
        sort: { type: 'SortableSequence', props: { items: [{ id: 'a', title: '甲' }] } },
      }),
    })
    expect(body(skipped).data.orderedItems).toEqual([{ id: 'a', title: '甲' }])
  })

  it('resolves sortable items from the declared state path and from business data', () => {
    const bound = decideJsonRenderSubmit(event('route.order.apply', { order: ['b', 'a'] }), {
      payload: payload({
        sort: { type: 'SortableSequence', props: { items: { $state: '/catalog/stops' } } },
      }, { catalog: { stops: [{ id: 'a', title: '甲' }, { id: 'b', title: '乙', note: '完整' }] }, _ui: { order: ['a', 'b'] } }),
    })
    expect(body(bound).data.orderedItems).toEqual([{ id: 'b', title: '乙', note: '完整' }, { id: 'a', title: '甲' }])

    const encoded = decideJsonRenderSubmit(event('route.order.apply', { order: ['a'] }), {
      payload: payload({
        sort: { type: 'SortableSequence', props: { items: { $state: '/a~1b~0c' } } },
      }, { 'a/b~c': [{ id: 'a', title: '斜杠' }] }),
    })
    expect(body(encoded).data.orderedItems).toEqual([{ id: 'a', title: '斜杠' }])

    const indexed = decideJsonRenderSubmit(event('route.order.apply', { order: ['a'] }), {
      payload: payload({
        sort: { type: 'SortableSequence', props: { items: { $state: '/rows/0' } } },
      }, { rows: [[{ id: 'a', title: '第一行' }]] }),
    })
    expect(body(indexed).data.orderedItems).toEqual([{ id: 'a', title: '第一行' }])

    const loop: Record<string, unknown> = { items: [{ id: 'a', title: '甲' }, { id: 'b', title: '乙' }] }
    loop.self = loop
    const fromBusiness = decideJsonRenderSubmit(event('route.order.apply', { order: ['b', 'a'] }), {
      payload: payload({
        sort: { type: 'SortableSequence', props: { items: { $state: 'stops' } } },
        other: { type: 'Card', props: { title: '说明' } },
      }, { label: '不是条目', empty: null, hole: { a: null }, blank: [{ id: ' ' }], numeric: [{ id: 1 }], untitled: [{ title: '仅标题' }], foreign: [null], none: [] }),
      businessData: loop,
    })
    expect(body(fromBusiness).data).toEqual({
      order: ['b', 'a'],
      orderedItems: [{ id: 'b', title: '乙' }, { id: 'a', title: '甲' }],
    })
  })

  it('rejects an order that is incomplete, repeated, or missing its items', () => {
    const sources = {
      payload: payload({
        sort: { type: 'SortableSequence', props: { items } },
      }),
    }
    expect(decideJsonRenderSubmit(event('route.order.apply', { order: ['library'] }), sources)).toEqual({
      action: 'reject', notice: '排序 ID 不完整，无法提交',
    })
    expect(decideJsonRenderSubmit(event('route.order.apply', { order: ['library', 'library', 'college'] }), sources)).toEqual({
      action: 'reject', notice: '排序 ID 重复，无法提交',
    })
    expect(decideJsonRenderSubmit(event('route.order.apply', { order: [' '] }), sources)).toEqual({
      action: 'reject', notice: '排序 ID 不完整，无法提交',
    })
    expect(decideJsonRenderSubmit(event('route.order.apply'), { payload: payload({}) })).toEqual({
      action: 'reject', notice: '排序 ID 不完整，无法提交',
    })
    expect(decideJsonRenderSubmit(event('route.order.apply', { order: [] }), { payload: payload({}) })).toEqual({
      action: 'reject', notice: '排序 ID 不完整，无法提交',
    })
    expect(decideJsonRenderSubmit(event('route.order.apply', { order: ['library', 2] }), { payload: payload({}) })).toEqual({
      action: 'reject', notice: '排序 ID 不完整，无法提交',
    })
    expect(decideJsonRenderSubmit(event('route.order.apply', { order: ['missing'] }), { payload: payload({}) })).toEqual({
      action: 'reject', notice: '缺少条目数据，无法提交',
    })
    expect(decideJsonRenderSubmit(event('route.order.apply', { order: ['library'] }), {
      payload: payload({
        sort: { type: 'SortableSequence', props: { items: { $state: '/gone' } } },
        indexed: { type: 'SortableSequence', props: { items: { $state: '/rows/nope' } } },
        padded: { type: 'SortableSequence', props: { items: { $state: '/rows/01' } } },
        text: { type: 'SortableSequence', props: { items: { $state: '/label/extra' } } },
        numeric: { type: 'SortableSequence', props: { items: { $state: 2 } } },
      }, { rows: [items], label: 'text' }),
    })).toEqual({ action: 'reject', notice: '排序 ID 不完整，无法提交' })
    const library = items[0] ?? { id: 'library', title: '图书馆' }
    expect(decideJsonRenderSubmit(event('route.order.apply', { order: ['library', 'college', 'canteen'] }), {
      payload: payload({
        sort: { type: 'SortableSequence', props: { items: [library, { ...library, title: '重复' }, items[1] ?? library, items[2] ?? library] } },
      }),
    })).toEqual({ action: 'reject', notice: '条目 ID 重复，无法提交' })
  })

  it('does not send while the user is still editing or executing', () => {
    const sources = { payload: payload({ sort: { type: 'SortableSequence', props: { items } } }) }
    for (const name of ['workflow.change', 'workflow.select', 'workflow.execute', 'route.order.change', 'tabs.change']) {
      const decision = decideJsonRenderSubmit(event(name, {
        workflow: initialWorkflow, parameters: {}, order: ['canteen', 'library', 'college'],
      }, name === 'workflow.change' ? 'change' : 'click'), sources)
      expect(decision).toEqual({ action: 'ignore' })
    }
  })

  it('reads business data only from a JSON object that carries it', () => {
    expect(businessDataFromToolArguments(1)).toBeUndefined()
    expect(businessDataFromToolArguments('{')).toBeUndefined()
    expect(businessDataFromToolArguments('[]')).toBeUndefined()
    expect(businessDataFromToolArguments('{"mode":"display"}')).toBeUndefined()
    expect(businessDataFromToolArguments('{"business_data":{"items":[{"id":"a"}]}}')).toEqual({ items: [{ id: 'a' }] })
  })
})
