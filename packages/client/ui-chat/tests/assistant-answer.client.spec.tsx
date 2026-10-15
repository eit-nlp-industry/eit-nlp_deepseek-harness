// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import type { ChainRenderOpts } from '@deepseek-ai/dsh-client-ui-slots'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssistantNodeView } from '../src/client/chat/AssistantNodeView.tsx'
import { useDisclosure } from '../src/client/chat/use-disclosure.ts'
import { useSearchableHidden } from '../src/client/chat/searchable-hidden.ts'
import { useDetailedPresentation } from './presentation-fixture.client.ts'

afterEach(cleanup)

describe('closing answer replacement eligibility', () => {
  it.each([
    ['settled', 'completed', 1],
    ['interrupted', 'interrupted', 0],
    ['settled', 'error', 0],
    ['running', 'completed', 0],
  ] as const)('offers %s / %s closing prose to the answer slot %i times', (status, reason, calls) => {
    const blocks = [{ kind: 'text', text: '原始最终答案' }]
    const finalNode = { seq: 6 }
    const renderSlotChain = vi.fn((_key: string, _owner: unknown, options?: ChainRenderOpts) => options?.fallback)
    // This component reads only the final-node identity and closing-turn fields.
    const props = {
      node: { data: { status, blocks, finalNode }, location: { kind: 'turn', turn: {
        turn: 1, status: 'closed', end: { data: { reason: { kind: reason } } },
      } } },
      useTurnData: () => ({ closing: { finalNode } }),
      useDisclosure,
      useGroupAction: useSearchableHidden,
      usePresentation: useDetailedPresentation,
      renderMessageImages: () => null,
      renderSlot: () => null,
      renderSlotChain,
      fileMentions: () => undefined,
      openFile: () => {},
      t: () => 'label',
    } as ComponentProps<typeof AssistantNodeView>
    render(<AssistantNodeView {...props} />)
    expect(renderSlotChain).toHaveBeenCalledTimes(calls)
    expect(screen.getByText('原始最终答案')).toBeTruthy()
  })
})
