/**
 * Browser half: keep `render_ui` as a short tool status and render its latest
 * successful result as an answer replacement or supplementary card.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import 'antd/dist/reset.css'
import '@eit/json-render-antd/styles.css'
import { jsonRenderAnswerDefinition, selectJsonRenderAnswer } from './answer.ts'
import { JsonRenderAnswer, JsonRenderReplacement, type JsonRenderAnswerInjected } from './JsonRenderAnswer.tsx'
import { JsonRenderRow } from './JsonRenderRow.tsx'

export const inject = ['sessions', 'slots', 'uiConversation']

/**
 * Register the answer card and the status row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const injectAnswer = (): JsonRenderAnswerInjected => ({
    async submitForm(sessionId, text) {
      const binding = ctx.sessions.binding(sessionId as SessionId)
      if (binding === undefined) throw new Error('当前会话未打开，无法提交表单')
      const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
      if (!result.ok) throw new Error(result.error.message)
    },
  })
  ctx.uiConversation.events.register(jsonRenderAnswerDefinition)
  ctx.slots.inject('conversation.chat.answer', () => ctx.slots.register({
    name: 'conversation.chat.answer',
    select: (owner) => {
      const card = selectJsonRenderAnswer(owner)
      return owner.canReplaceAnswer === true && card?.answerPresentation === 'replace' ? {} : null
    },
    inject: injectAnswer,
  }, JsonRenderReplacement))
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    id: 'json-render-answer',
    order: -10,
    inject: injectAnswer,
  }, JsonRenderAnswer))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'render_ui',
  }, JsonRenderRow))
}
