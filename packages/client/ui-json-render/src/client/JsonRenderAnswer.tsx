import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { JsonRenderCard } from './JsonRenderCard.tsx'
import { selectJsonRenderAnswer } from './answer.ts'

export interface JsonRenderAnswerInjected {
  submitForm(sessionId: string, text: string): Promise<void>
}

/**
 * Supplementary card under the closing answer.
 * @param props - turn identity, replacement eligibility, and form submission callback.
 * @returns the latest card, or null when absent or rendered by the answer slot.
 */
export function JsonRenderAnswer(props: PropsRuntime<'conversation.chat.turnTail'> & JsonRenderAnswerInjected) {
  const card = selectJsonRenderAnswer(props)
  if (card === null) return null
  if (card.answerPresentation === 'replace' && props.canReplaceAnswer === true) return null
  return (
    <JsonRenderCard
      payload={card.payload}
      instanceId={card.callId}
      profile={card.profile}
      submitForm={text => props.submitForm(props.sessionId, text)}
    />
  )
}

/**
 * Complete answer component with the original Markdown as a rendering fallback.
 * @param props - closing prose, Markdown affordances, turn identity, and form callback.
 * @returns the interface, or original prose when the result cannot be rendered.
 */
export function JsonRenderReplacement(props: PropsRuntime<'conversation.chat.answer'> & JsonRenderAnswerInjected) {
  const card = selectJsonRenderAnswer(props)
  const fallback = () => <MarkdownText text={props.text} labels={props.labels}
    fileMentions={props.fileMentions} pathImages={props.pathImages} />
  if (card === null) return fallback()
  return <JsonRenderCard key={card.callId} payload={card.payload} instanceId={card.callId}
    profile={card.profile} submitForm={text => props.submitForm(props.sessionId, text)} fallbackRender={fallback} />
}
