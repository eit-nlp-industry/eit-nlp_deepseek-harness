import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { JsonRenderCard } from './JsonRenderCard.tsx'
import { selectJsonRenderAnswer } from './answer.ts'

export interface JsonRenderAnswerInjected {
  submitForm(sessionId: string, text: string): Promise<void>
}

/** Card under the closing answer. A turn with no successful payload renders nothing. */
export function JsonRenderAnswer(props: PropsRuntime<'conversation.chat.turnTail'> & JsonRenderAnswerInjected) {
  const card = selectJsonRenderAnswer(props)
  if (card === null) return null
  return (
    <JsonRenderCard
      payload={card.payload}
      instanceId={card.callId}
      submitForm={text => props.submitForm(props.sessionId, text)}
    />
  )
}
