// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ConversationContextReader, ConversationMatch, ConversationTurnDataMap, InputActions, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { JsonRenderEvent, JsonRenderPayload } from '@eit/json-render-protocol'
import { formValues, JsonRenderCard, jsonRenderPopupContainer } from '../src/client/JsonRenderCard.tsx'
import { JsonRenderReplacement } from '../src/client/JsonRenderAnswer.tsx'
import { jsonRenderAnswerDefinition, answerPresentationFromMeta, profileFromMeta, selectJsonRenderAnswer, type JsonRenderAnswerData } from '../src/client/answer.ts'
import { payloadFromMeta } from '../src/client/payload.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function submitEvent(payload?: JsonRenderEvent['payload']): JsonRenderEvent {
  return {
    protocol: 'json-render-event',
    version: '1.0',
    id: 'event-1',
    instanceId: 'instance-1',
    event: { name: 'form.submit', type: 'submit' },
    ...payload !== undefined ? { payload } : {},
  }
}

function unusedHook(): never {
  throw new Error('unused')
}

const inputActions: InputActions = {
  captureInsertion: unusedHook,
  insertText: unusedHook,
  setDraft: unusedHook,
  persistDraft: unusedHook,
  addAttachments: unusedHook,
  removeAttachment: unusedHook,
  pruneAttachments: unusedHook,
  submit: unusedHook,
}

const answerSeats = {
  useSession: unusedHook,
  useProjection: unusedHook,
  useConversation: unusedHook,
  useInput: unusedHook,
  useChat: unusedHook,
  useTrajectory: unusedHook,
  inputActions,
  useWorkspaces: unusedHook,
  useResource: unusedHook,
  usePanelInfo: unusedHook,
  useSessions: unusedHook,
  useSessionStatus: unusedHook,
  useSessionRetainInfo: unusedHook,
}

function turnOf(card: JsonRenderAnswerData | undefined, endSeq: number | undefined): TurnLocation {
  const values: Partial<ConversationTurnDataMap> = card === undefined ? {} : { 'json-render-answer': card }
  return {
    turn: 1,
    start: undefined,
    end: endSeq === undefined ? undefined : {
      seq: SessionSeq(endSeq),
      time: endSeq,
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' } },
    },
    status: endSeq === undefined ? 'open' : 'closed',
    steps: [],
    data: {
      get: key => values[key],
      source: key => ({ getSnapshot: () => values[key], subscribe: () => () => {} }),
    },
  }
}

function sessionEvent(seq: number, type: string, data: unknown, surfaceOp?: 'append'): SessionEvent {
  return {
    seq,
    time: seq,
    type,
    data,
    ...surfaceOp === undefined ? {} : { surfaceOp },
  } as SessionEvent
}

function updateMatch(event: SessionEvent, location: ConversationMatch['location']): ConversationMatch {
  return { event, role: 'update', location }
}

describe('json-render answer presentation', () => {
  it('requires an explicit replacement declaration and keeps historical results supplementary', () => {
    expect(answerPresentationFromMeta({ answerPresentation: 'replace' })).toBe('replace')
    expect(answerPresentationFromMeta({ answerPresentation: 'supplement' })).toBe('supplement')
    expect(answerPresentationFromMeta({})).toBe('supplement')
    expect(answerPresentationFromMeta(null)).toBe('supplement')
    expect(profileFromMeta({ profile: 'base' })).toBe('base')
    expect(profileFromMeta({ profile: 'rich' })).toBe('rich')
    expect(profileFromMeta({ profile: 'forms' })).toBe('forms')
    expect(profileFromMeta({ profile: 'other' })).toBeUndefined()
    expect(profileFromMeta({})).toBeUndefined()
    expect(profileFromMeta(null)).toBeUndefined()
    expect(profileFromMeta(1)).toBeUndefined()
  })

  it('rejects missing and malformed payloads without claiming the answer', () => {
    expect(payloadFromMeta({})).toBeNull()
    expect(payloadFromMeta({ payload: { format: 'json-render-v1', spec: {} } })).toBeNull()
    expect(payloadFromMeta('no')).toBeNull()
    expect(payloadFromMeta([])).toBeNull()
    expect(formValues(submitEvent())).toEqual({})
    expect(formValues(submitEvent({ value: 1 }))).toEqual({ value: 1 })
    expect(formValues(submitEvent({ form: { a: 1 } }))).toEqual({ a: 1 })
    expect(jsonRenderPopupContainer(undefined, 'missing-panel')).toBe(document.body)
    const host = document.createElement('div')
    host.className = 'panel'
    const inner = document.createElement('button')
    host.append(inner)
    document.body.append(host)
    expect(jsonRenderPopupContainer(inner, 'panel')).toBe(host)
    const outside = document.createElement('span')
    document.body.append(outside)
    expect(jsonRenderPopupContainer(outside, 'panel')).toBe(document.body)
    host.remove()
    outside.remove()
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

  it('uses the written fallback for a missing root and the default notice when none is supplied', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const missing: JsonRenderPayload = { format: 'json-render-v1', spec: { root: 'gone', elements: {} } }
    render(<JsonRenderCard payload={missing} instanceId="missing" submitForm={vi.fn()}
      fallbackRender={() => <p>根节点缺失</p>} />)
    expect(screen.getByText('根节点缺失')).toBeTruthy()

    const valid: JsonRenderPayload = {
      format: 'json-render-v1',
      spec: { root: 'card', elements: { card: { type: 'Card', props: { title: '仍然显示' } } } },
    }
    render(<JsonRenderCard payload={valid} instanceId="kept" submitForm={vi.fn()}
      fallbackRender={() => <p>不应出现</p>} />)
    expect(screen.getByText('仍然显示')).toBeTruthy()
    expect(screen.queryByText('不应出现')).toBeNull()

    const broken: JsonRenderPayload = {
      format: 'json-render-v1',
      spec: { root: 'table', elements: { table: { type: 'Table', props: { columns: ['名称'], rows: [null] } } } },
    }
    render(<JsonRenderCard payload={broken} instanceId="default-fallback" submitForm={vi.fn()} />)
    expect(screen.getByText('界面无法显示，文字回答仍然有效。')).toBeTruthy()
  })

  it('reports a rejected submit once and ignores a second click while it is pending', async () => {
    const payload: JsonRenderPayload = {
      format: 'json-render-v1',
      spec: {
        root: 'card',
        elements: {
          card: { type: 'Card', props: { title: '提交' }, children: ['submit'] },
          submit: { type: 'Button', props: { label: '确认发送' }, on: { press: { action: 'form.submit' } } },
        },
      },
    }
    let release: () => void = () => {}
    const pendingSubmit = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const pending = render(<JsonRenderCard payload={payload} instanceId="pending" submitForm={pendingSubmit} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认发送' })) })
    expect(pendingSubmit).toHaveBeenCalledOnce()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认发送' })) })
    expect(pendingSubmit).toHaveBeenCalledOnce()
    release()
    pending.unmount()

    const failed = vi.fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('网络中断'))
      .mockRejectedValueOnce('down')
    render(<JsonRenderCard payload={payload} instanceId="failed" submitForm={failed} />)
    fireEvent.click(screen.getByRole('button', { name: '确认发送' }))
    expect(await screen.findByText('网络中断')).toBeTruthy()
    failed.mockClear()
    render(<JsonRenderCard payload={payload} instanceId="failed-text" submitForm={failed} />)
    fireEvent.click(screen.getAllByRole('button', { name: '确认发送' }).at(-1)!)
    expect(await screen.findByText('提交失败')).toBeTruthy()
  })

  it('reuses a published card when the profile is unchanged and replaces it when the profile differs', () => {
    const build = jsonRenderAnswerDefinition.buildLocationData
    if (build === undefined) throw new Error('json-render answer publishes no location data')
    const payload: JsonRenderPayload = {
      format: 'json-render-v1',
      spec: { root: 'card', elements: { card: { type: 'Card', props: { title: '卡片' } } } },
    }
    const card = { callId: 'c', seq: 4, payload, answerPresentation: 'replace' as const, profile: 'rich' as const }
    const context = {
      key: '1',
      kind: 'json-render-answer',
      id: '1',
      matches: [],
      start: undefined,
      state: { turn: 1, calls: new Map(), card },
      current: new Map(),
    }
    expect(build(context, 'step', null)).toBeNull()
    expect(build({ ...context, state: undefined }, 'turn', null)).toBeNull()
    expect(build({ ...context, state: { ...context.state, card: undefined } }, 'turn', null)).toBeNull()
    const published = build(context, 'turn', null)
    expect(published).toMatchObject({ key: 'json-render-answer', value: card })
    expect(build(context, 'turn', published)).toBe(published)
    const changed = build(context, 'turn', {
      kind: 'turn',
      turn: 1,
      key: 'json-render-answer',
      value: { ...card, profile: 'base' },
    })
    expect(changed).not.toBe(published)
    expect(changed).toMatchObject({ value: card })
  })

  it('hides a card that arrives after the turn ends and restores prose when no card exists', () => {
    const payload: JsonRenderPayload = {
      format: 'json-render-v1',
      spec: { root: 'card', elements: { card: { type: 'Card', props: { title: '卡片' } } } },
    }
    const card = { callId: 'c', seq: 9, payload, answerPresentation: 'replace' as const }
    const late = selectJsonRenderAnswer({ turn: turnOf(card, 3), seq: 3 })
    expect(late).toBeNull()
    const open = selectJsonRenderAnswer({ turn: turnOf(card, undefined), seq: 9 })
    expect(open?.callId).toBe('c')

    const state = { turn: 1, calls: new Map(), card: undefined }
    const context = {
      key: '1', kind: 'json-render-answer', id: '1', matches: [], start: undefined, state, current: new Map(),
    }
    const location = { kind: 'session' } as const
    const reader: ConversationContextReader = { previous: () => undefined }
    expect(jsonRenderAnswerDefinition.update(context, updateMatch(
      sessionEvent(1, 'step/end', { turn: 1, step: 1 }),
      location,
    ))).toBe(state)
    expect(jsonRenderAnswerDefinition.update(context, updateMatch(
      sessionEvent(2, 'tool/result', {
        turn: 1, step: 1, meta: null,
        message: { source: { callId: 'missing' }, content: [], isError: false },
      }, 'append'),
      location,
    ))).toBe(state)
    expect(() => jsonRenderAnswerDefinition.start(context, {
      event: sessionEvent(1, 'tool/call', {
        turn: 1, step: 1, callId: 'x', name: 'bash', arguments: '{}',
      }, 'append'),
      role: 'start',
      location,
    }, reader)).toThrow(/turn\/start/)

    const labels = { footnotes: 'References', code: {
      copyLabel: 'Copy', copiedLabel: 'Copied',
      toolbarLabels: { codeLabel: 'Code', wrapLabel: 'Wrap', unwrapLabel: 'Unwrap' },
    } }
    const submitForm = vi.fn<(sessionId: string, text: string) => Promise<void>>().mockResolvedValue(undefined)
    const empty = render(<JsonRenderReplacement
      {...answerSeats}
      turn={turnOf(undefined, 1)}
      seq={1}
      openFile={() => {}}
      canReplaceAnswer={true}
      text="没有卡片"
      labels={labels}
      pathImages={{ resolve: () => undefined }}
      sessionId={SessionId('s')}
      submitForm={submitForm}
    />)
    expect(screen.getByText('没有卡片')).toBeTruthy()
    empty.unmount()

    const button: JsonRenderPayload = {
      format: 'json-render-v1',
      spec: {
        root: 'card',
        elements: {
          card: { type: 'Card', props: { title: '替换卡' }, children: ['submit'] },
          submit: { type: 'Button', props: { label: '确认发送' }, on: { press: { action: 'form.submit' } } },
        },
      },
    }
    render(<JsonRenderReplacement
      {...answerSeats}
      turn={turnOf({ callId: 'c', seq: 1, payload: button, answerPresentation: 'replace' }, 2)}
      seq={2}
      openFile={() => {}}
      canReplaceAnswer={true}
      text="替换文字"
      labels={labels}
      pathImages={{ resolve: () => undefined }}
      sessionId={SessionId('session-1')}
      submitForm={submitForm}
    />)
    fireEvent.click(screen.getByRole('button', { name: '确认发送' }))
    expect(submitForm).toHaveBeenCalledOnce()
    expect(submitForm.mock.calls[0]?.[0]).toBe('session-1')
  })
})
