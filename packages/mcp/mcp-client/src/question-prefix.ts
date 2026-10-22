/**
 * Prepend a short cue to each user turn. Does not call any MCP tool —
 * it only plants text the model already treats as a recall trigger.
 *
 * @module @deepseek-ai/dsh-mcp-client/question-prefix
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'mcp-question-prefix': { kind: 'mcp-question-prefix'; server: string }
  }
}

/**
 * Register the `agent/pre-step` hook that inserts `prefix` before the first
 * user message of a turn. Empty prefix is a no-op. Failures never block the turn.
 *
 * @param ctx - plugin context that owns the agent event bus.
 * @param serverName - configured MCP namespace, used only for attribution.
 * @param prefix - literal cue prepended before the user question.
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
      if (alreadyPrefixed(decision, text)) return decision
      return {
        ...decision,
        messages: [prefixNotice(serverName, text), ...decision.messages],
      }
    },
    { prepend: true },
  )
}

function alreadyPrefixed(decision: Extract<PreStepDecision, { kind: 'enter' }>, text: string): boolean {
  return decision.messages.some(message =>
    message.content.some(block => block.type === 'text' && block.text.includes(text)),
  )
}

function prefixNotice(server: string, text: string) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'mcp-question-prefix', server },
  })
}
