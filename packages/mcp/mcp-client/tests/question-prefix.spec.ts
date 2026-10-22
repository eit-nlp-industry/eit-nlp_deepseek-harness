import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { installQuestionPrefix } from '../src/question-prefix.ts'

function fakeAgent(): Agent {
  return { session: {} } as Agent
}

function user(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }] })
}

describe('installQuestionPrefix', () => {
  it('does nothing when the prefix is blank', async () => {
    const ctx = new Context()
    installQuestionPrefix(ctx, 'hindsight', '  ')
    const messages = [user('怎么做')]
    const decision = await ctx.waterfall(
      'agent/pre-step',
      { agent: fakeAgent(), messages, turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages }),
    )
    expect(decision).toEqual({ kind: 'enter', messages })
    await ctx.fiber.dispose()
  })

  it('inserts the cue before a new user question', async () => {
    const ctx = new Context()
    installQuestionPrefix(ctx, 'hindsight', '按照之前约定。')
    const messages = [user('这个怎么做')]
    const decision = await ctx.waterfall(
      'agent/pre-step',
      { agent: fakeAgent(), messages, turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages }),
    )
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages).toHaveLength(2)
    expect(decision.messages[0]?.content).toEqual([{ type: 'text', text: '按照之前约定。' }])
    expect(decision.messages[1]).toBe(messages[0])
    await ctx.fiber.dispose()
  })

  it('does not duplicate the cue when the user already wrote it', async () => {
    const ctx = new Context()
    installQuestionPrefix(ctx, 'hindsight', '按照之前约定。')
    const messages = [user('按照之前约定。这个怎么做')]
    const decision = await ctx.waterfall(
      'agent/pre-step',
      { agent: fakeAgent(), messages, turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages }),
    )
    expect(decision).toEqual({ kind: 'enter', messages })
    await ctx.fiber.dispose()
  })
})
