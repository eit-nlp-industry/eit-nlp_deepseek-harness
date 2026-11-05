// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ConversationMatch, ConversationNodeContext } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { JsonRenderCard } from '../src/client/JsonRenderCard.tsx'
import { payloadFromMeta } from '../src/client/payload.ts'
import { answerPresentationFromMeta, jsonRenderAnswerDefinition } from '../src/client/answer.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('json-render answer presentation', () => {
  it('requires an explicit replacement declaration and keeps historical results supplementary', () => {
    expect(answerPresentationFromMeta({ answerPresentation: 'replace' })).toBe('replace')
    expect(answerPresentationFromMeta({ answerPresentation: 'supplement' })).toBe('supplement')
    expect(answerPresentationFromMeta({})).toBe('supplement')
    expect(answerPresentationFromMeta(null)).toBe('supplement')
  })

  it('rejects missing and malformed payloads without claiming the answer', () => {
    expect(payloadFromMeta({})).toBeNull()
    expect(payloadFromMeta({ payload: { format: 'json-render-v1', spec: {} } })).toBeNull()
  })

  it('shows the written answer when a valid payload cannot be rendered', () => {
    const payload = payloadFromMeta({ payload: {
      format: 'json-render-v1',
      spec: { root: 'missing', elements: { missing: { type: 'UnavailableWidget', props: {} } } },
    } })
    expect(payload).not.toBeNull()
    render(<JsonRenderCard payload={payload!} instanceId="unsupported" submitForm={vi.fn()}
      fallbackRender={() => <p>保留的最终文字</p>} />)
    expect(screen.getByText('保留的最终文字')).toBeTruthy()
  })

  it('recovers from a component exception and accepts a later valid instance', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = payloadFromMeta({ payload: {
      format: 'json-render-v1',
      spec: { root: 'table', elements: { table: { type: 'Table', props: { columns: ['名称'], rows: [null] } } } },
    } })
    expect(broken).not.toBeNull()
    const props = { submitForm: vi.fn(), fallbackRender: () => <p>文字兜底</p> }
    const view = render(<JsonRenderCard {...props} payload={broken!} instanceId="broken" />)
    expect(screen.getByText('文字兜底')).toBeTruthy()
    const valid = payloadFromMeta({ payload: {
      format: 'json-render-v1',
      spec: { root: 'card', elements: { card: { type: 'Card', props: { title: '恢复的组件' } } } },
    } })
    view.rerender(<JsonRenderCard {...props} payload={valid!} instanceId="recovered" />)
    expect(screen.getByText('恢复的组件')).toBeTruthy()
    expect(screen.queryByText('文字兜底')).toBeNull()
  })

  it('keeps business data from the render_ui call beside the payload', () => {
    const context = {
      key: 'answer', kind: 'json-render-answer', id: '1', matches: [], start: undefined, state: undefined, current: new Map(),
    } as ConversationNodeContext
    const match = (type: string, data: unknown, seq: number): ConversationMatch => ({
      role: type === 'turn/start' ? 'start' : 'update',
      location: { kind: 'session' },
      event: { seq, time: seq, type, data, surfaceOp: 'append' } as SessionEvent,
    })
    const cardPayload = {
      format: 'json-render-v1',
      spec: { root: 'card', elements: { card: { type: 'Card', props: { title: 'A' } } } },
    }
    let state = jsonRenderAnswerDefinition.start(context, match('turn/start', { turn: 1 }, 1), { previous: () => undefined })
    expect(jsonRenderAnswerDefinition.buildLocationData?.({ ...context, state: undefined }, 'turn', null)).toBeNull()
    expect(jsonRenderAnswerDefinition.buildLocationData?.({ ...context, state }, 'turn', null)).toBeNull()
    expect(jsonRenderAnswerDefinition.buildLocationData?.({ ...context, state }, 'step', null)).toBeNull()
    state = jsonRenderAnswerDefinition.update({ ...context, state }, match('tool/call', {
      turn: 1, step: 1, callId: 'other', name: 'bash', arguments: '{"business_data":{"ignored":true}}',
    }, 2))
    state = jsonRenderAnswerDefinition.update({ ...context, state }, match('tool/call', {
      turn: 1, step: 1, callId: 'render-1', name: 'render_ui', arguments: '{',
    }, 3))
    state = jsonRenderAnswerDefinition.update({ ...context, state }, match('tool/result', {
      turn: 1, step: 1, meta: { payload: cardPayload },
      message: { source: { callId: 'other' }, content: [], isError: false },
    }, 4))
    expect(state.card).toBeUndefined()
    state = jsonRenderAnswerDefinition.update({ ...context, state }, match('tool/result', {
      turn: 1, step: 1, meta: { payload: cardPayload },
      message: { source: { callId: 'render-1' }, content: [], isError: false },
    }, 5))
    expect(state.card?.businessData).toBeUndefined()
    state = jsonRenderAnswerDefinition.update({ ...context, state }, match('tool/call', {
      turn: 1, step: 1, callId: 'render-2', name: 'render_ui',
      arguments: JSON.stringify({ business_data: { items: [{ id: 'a', title: '甲' }] } }),
    }, 6))
    state = jsonRenderAnswerDefinition.update({ ...context, state }, match('tool/result', {
      turn: 1, step: 1, meta: { payload: cardPayload },
      message: { source: { callId: 'render-2' }, content: [], isError: false },
    }, 7))
    expect(state.card?.businessData).toEqual({ items: [{ id: 'a', title: '甲' }] })
    const published = jsonRenderAnswerDefinition.buildLocationData?.({ ...context, state }, 'turn', null)
    expect(published?.value.businessData).toEqual({ items: [{ id: 'a', title: '甲' }] })
    expect(jsonRenderAnswerDefinition.buildLocationData?.({ ...context, state }, 'turn', published ?? null)).toBe(published)
  })
})
