// @vitest-environment jsdom
import type { ComponentProps, ReactNode } from 'react'
import type { ChainRenderOpts } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatNode } from '../src/client/contract/chat-nodes.ts'
import { AssistantNodeView } from '../src/client/chat/AssistantNodeView.tsx'
import { useDisclosure } from '../src/client/chat/use-disclosure.ts'
import { useSearchableHidden } from '../src/client/chat/searchable-hidden.ts'
import { useDetailedPresentation } from './presentation-fixture.client.ts'

afterEach(cleanup)

const emptyTurnData = {
  get: () => undefined,
  source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
}

describe('closing answer replacement eligibility', () => {
  it.each([
    ['settled', 'completed', 1],
    ['interrupted', 'interrupted', 0],
    ['settled', 'error', 0],
    ['running', 'completed', 0],
  ] as const)('offers %s / %s closing prose to the answer slot %i times', (status, reason, calls) => {
    const blocks = [{ kind: 'text' as const, text: '原始最终答案' }]
    const finalNode = {
      kind: 'assistant' as const, seq: 6, time: 6, turn: 1, step: 1, blocks,
    }
    const endReason = reason === 'error'
      ? { kind: 'error' as const, error: { message: 'failed', code: 'UNKNOWN' } }
      : { kind: reason }
    const turn: TurnLocation = {
      turn: 1, status: 'closed', steps: [],
      start: { type: 'turn/start', seq: SessionSeq(1), time: 1, data: { turn: 1 } },
      end: { type: 'turn/end', seq: SessionSeq(6), time: 6, data: { turn: 1, reason: endReason } },
      data: emptyTurnData,
    }
    const node: ChatNode<'assistant-step'> = {
      key: 'assistant', id: 'assistant', kind: 'assistant-step', target: 'chat',
      anchorSeq: 6, location: { kind: 'turn', turn }, visibility: 'visible',
      data: { status, turn: 1, step: 1, time: 6, blocks, finalNode },
    }
    const renderSlotChain = vi.fn((_key: string, _owner: unknown, options?: ChainRenderOpts) => options?.fallback)
    // Aggregate GlobalStandardProps merges are unused here; match other ui-chat fixture casts.
    const props = {
      node,
      useTurnData: (key: 'turn-tail') => key === 'turn-tail'
        ? { turn: 1, seq: 6, time: 6, closing: { ...node.data, finalNode }, branchUnavailable: false }
        : undefined,
      useDisclosure,
      useGroupAction: useSearchableHidden,
      usePresentation: useDetailedPresentation,
      renderMessageImages: () => null,
      renderSlot: () => null,
      renderSlotChain,
      SessionProvider: ({ children }: { children: ReactNode }) => children,
      fileMentions: () => undefined,
      openFile: () => {},
      openSkill: () => {},
      inspectCall: undefined,
      forkAt: () => {},
      loadImage: () => Promise.reject(new Error('not used')),
      t: () => 'label',
    } as unknown as ComponentProps<typeof AssistantNodeView>
    render(<AssistantNodeView {...props} />)
    expect(renderSlotChain).toHaveBeenCalledTimes(calls)
    expect(screen.getByText('原始最终答案')).toBeTruthy()
  })
})
