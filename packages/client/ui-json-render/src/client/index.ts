/**
 * Browser half: keep `render_ui` as a short tool status, and draw the last
 * successful payload at the end of that turn's answer.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { jsonRenderAnswerDefinition } from './answer.ts'
import { JsonRenderAnswer } from './JsonRenderAnswer.tsx'
import { JsonRenderRow } from './JsonRenderRow.tsx'
import 'antd/dist/reset.css'
import '@eit/json-render-antd/styles.css'

export const inject = ['sessions', 'slots', 'uiConversation']

/**
 * Register the answer card and the status row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.uiConversation.events.register(jsonRenderAnswerDefinition)
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    id: 'json-render-answer',
    order: -10,
    inject: (): { submitForm(sessionId: string, text: string): Promise<void> } => ({
      async submitForm(sessionId, text) {
        const binding = ctx.sessions.binding(sessionId as SessionId)
        if (binding === undefined) throw new Error('当前会话未打开，无法提交表单')
        const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
        if (!result.ok) throw new Error(result.error.message)
      },
    }),
  }, JsonRenderAnswer))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'render_ui',
  }, JsonRenderRow))
}
