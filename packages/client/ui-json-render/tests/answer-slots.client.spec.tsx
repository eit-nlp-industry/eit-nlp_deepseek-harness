// @vitest-environment jsdom
import { useState, type ReactNode } from 'react'
import { act, cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import {
  ConversationNodeAssembler, UiConversation,
  type ConversationTimelineSnapshot,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply, inject } from '../src/client/index.ts'

afterEach(cleanup)

const payload = {
  format: 'json-render-v1',
  spec: { root: 'card', elements: { card: { type: 'Card', props: { title: '完整的展示答案' } } } },
}

function event(seq: number, type: string, data: unknown): SessionEventLikeEntry {
  return { type: 'event', event: { seq, time: seq, type, data, surfaceOp: 'append' } as SessionEvent }
}

async function fixture(meta: unknown, isError = false, laterError = false) {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const conversation = new UiConversation(runtime.ctx, runtime.ctx.sessions)
  type Seats = PropsRenderSlots<'conversation.chat.answer' | 'conversation.chat.turnTail'>
  const captured: { seats?: Seats; setContent?: (content: ReactNode) => void } = {}
  await runtime.root.declare({
    'conversation.chat.answer': { kind: 'chain', scope: 'session' },
    'conversation.chat.turnTail': { kind: 'list', scope: 'session' },
  }, function Root(props) {
    const [content, setContent] = useState<ReactNode>(null)
    captured.seats = props
    captured.setContent = setContent
    return content
  })
  await runtime.mount({ apply, inject })
  await runtime.sessions.add({ id: 'answer-fixture' })
  const session = runtime.sessions.retainFor(runtime.ctx, SessionId('answer-fixture'))
  const assembler = new ConversationNodeAssembler(conversation.events, {
    entries: () => [{ target: 'answer-test', create: () => ({
      empty: { turns: new Map(), turnOrder: [] },
      replace: input => input.timeline,
      apply: input => input.timeline,
    }) }],
  })
  const entries = [
    event(1, 'turn/start', { turn: 1 }),
    event(2, 'step/start', { turn: 1, step: 1 }),
    event(3, 'tool/call', { turn: 1, step: 1, callId: 'render-1', name: 'render_ui', arguments: '{}' }),
    event(4, 'tool/result', { turn: 1, step: 1, meta,
      message: { source: { callId: 'render-1' }, content: [], isError } }),
    ...laterError ? [
      event(5, 'tool/call', { turn: 1, step: 1, callId: 'render-2', name: 'render_ui', arguments: '{}' }),
      event(6, 'tool/result', { turn: 1, step: 1,
        message: { source: { callId: 'render-2' }, content: [], isError: true } }),
    ] : [],
    event(laterError ? 7 : 5, 'step/end', { turn: 1, step: 1 }),
    event(laterError ? 8 : 6, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
  assembler.replaceWindow(entries, false)
  assembler.activateTarget('answer-test')
  const turn = (assembler.snapshot('answer-test') as ConversationTimelineSnapshot).turns.get(1)!
  const view = runtime.renderRoot()
  const { seats, setContent } = captured
  if (seats === undefined || setContent === undefined) throw new Error('missing root seats')
  const { SessionProvider } = seats
  const owner = { turn, seq: turn.end!.seq, openFile: () => {}, canReplaceAnswer: true }
  const text = '保留的最终文字'
  const labels = { footnotes: 'References', code: {
    copyLabel: 'Copy', copiedLabel: 'Copied',
    toolbarLabels: { codeLabel: 'Code', wrapLabel: 'Wrap', unwrapLabel: 'Unwrap' },
  } }
  act(() => { setContent(<SessionProvider session={session}>
    {seats.renderSlotChain('conversation.chat.answer', {
      ...owner, text, labels, pathImages: { resolve: () => undefined },
    }, { fallback: <MarkdownText text={text} labels={labels} /> })}
    {seats.renderSlot('conversation.chat.turnTail', owner)}
  </SessionProvider>) })
  return view
}

describe('answer slots over replayed tool events', () => {
  it('replaces closing prose once and keeps it out of the tail', async () => {
    await fixture({ payload, answerPresentation: 'replace' })
    expect(screen.getAllByText('完整的展示答案')).toHaveLength(1)
    expect(screen.queryByText('保留的最终文字')).toBeNull()
  })

  it.each(['supplement', undefined])('keeps prose alongside %s results', async (answerPresentation) => {
    await fixture({ payload, answerPresentation })
    expect(screen.getAllByText('完整的展示答案')).toHaveLength(1)
    expect(screen.getByText('保留的最终文字')).toBeTruthy()
  })

  it.each([{}, { payload: { format: 'invalid' }, answerPresentation: 'replace' }])('retains prose for unusable metadata', async (meta) => {
    await fixture(meta)
    expect(screen.getByText('保留的最终文字')).toBeTruthy()
  })

  it('retains prose when the tool reports an error', async () => {
    await fixture({ payload, answerPresentation: 'replace' }, true)
    expect(screen.getByText('保留的最终文字')).toBeTruthy()
  })

  it('does not hide prose behind an earlier success when a later render fails', async () => {
    await fixture({ payload, answerPresentation: 'replace' }, false, true)
    expect(screen.getByText('保留的最终文字')).toBeTruthy()
    expect(screen.queryByText('完整的展示答案')).toBeNull()
  })
})
