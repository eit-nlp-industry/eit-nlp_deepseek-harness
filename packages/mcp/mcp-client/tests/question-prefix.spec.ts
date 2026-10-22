import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { installQuestionPrefix } from '../src/question-prefix.ts'

function fakeAgent(): Agent {
  return { session: {} } as Agent
}

function user(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }] })
}

async function enter(ctx: Context, agent: Agent, messages: ReturnType<typeof user>[]) {
  return agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages, turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter' as const, messages }),
  )
}

describe('installQuestionPrefix', () => {
  it('does nothing when the prefix is blank', async () => {
    const ctx = new Context()
    installQuestionPrefix(ctx, 'hindsight', '  ')
    const messages = [user('怎么做')]
    expect(await enter(ctx, fakeAgent(), messages)).toEqual({ kind: 'enter', messages })
    await ctx.fiber.dispose()
  })

  it('writes the cue onto the user question through agent-scoped dispatch', async () => {
    const ctx = new Context()
    installQuestionPrefix(ctx, 'hindsight', '按照之前约定。')
    const messages = [user('这个怎么做')]
    const decision = await enter(ctx, fakeAgent(), messages)
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages).toHaveLength(1)
    expect(decision.messages[0]?.content).toEqual([{ type: 'text', text: '按照之前约定。这个怎么做' }])
    await ctx.fiber.dispose()
  })

  it('does not duplicate the cue when the user already wrote it', async () => {
    const ctx = new Context()
    installQuestionPrefix(ctx, 'hindsight', '按照之前约定。')
    const messages = [user('按照之前约定。这个怎么做')]
    expect(await enter(ctx, fakeAgent(), messages)).toEqual({ kind: 'enter', messages })
    await ctx.fiber.dispose()
  })
})
