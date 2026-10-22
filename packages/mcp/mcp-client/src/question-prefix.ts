/**
 * Prepend a short cue to each user question. Does not call any MCP tool —
 * it only plants text the model already treats as a recall trigger.
 *
 * @module @deepseek-ai/dsh-mcp-client/question-prefix
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'mcp-question-prefix': { kind: 'mcp-question-prefix'; server: string }
  }
}

/**
 * Register the `agent/pre-step` hook that writes `prefix` at the start of the
 * first user question of a turn. Empty prefix is a no-op.
 *
 * @param ctx - plugin context that owns the agent event bus.
 * @param serverName - configured MCP namespace, used only when falling back to a notice.
 * @param prefix - literal cue prepended onto the user question.
 */
export function installQuestionPrefix(ctx: Context, serverName: string, prefix: string): void {
  const text = prefix.trim()
  if (text.length === 0) return

  ctx.on(
    'agent/pre-step',
    async ({ signal }, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted) return decision
      if (decision.messages.length === 0) return decision
      return { ...decision, messages: prefixMessages(decision.messages, serverName, text) }
    },
    { prepend: true, global: true },
  )
}

function prefixMessages(messages: UserMessage[], server: string, text: string): UserMessage[] {
  const first = messages[0]
  if (first === undefined || alreadyHasCue(messages, text)) return messages
  const block = first.content[0]
  if (first.content.length === 1 && block?.type === 'text') {
    return [
      createUserMessage({
        content: [{ type: 'text', text: `${text}${block.text}` }],
        source: first.source,
      }),
      ...messages.slice(1),
    ]
  }
  return [createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'mcp-question-prefix', server },
  }), ...messages]
}

function alreadyHasCue(messages: UserMessage[], text: string): boolean {
  return messages.some(message =>
    message.content.some(block => block.type === 'text' && block.text.includes(text)),
  )
}
