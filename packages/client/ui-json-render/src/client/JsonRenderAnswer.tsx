import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { JsonRenderCard } from './JsonRenderCard.tsx'
import { selectJsonRenderAnswer, selectJsonRenderAnswers } from './answer.ts'
import { liveMaps } from './map-tracking.ts'

export interface JsonRenderAnswerInjected {
  submitForm(sessionId: string, text: string): Promise<void>
}

/**
 * Supplementary card under the closing answer.
 * @param props - turn identity, replacement eligibility, and form submission callback.
 * @returns retained cards, excluding a sole card rendered by the answer slot.
 */
export function JsonRenderAnswer(props: PropsRuntime<'conversation.chat.turnTail'> & JsonRenderAnswerInjected & Partial<PropsLocale<'jsonRender'>>) {
  const cards = selectJsonRenderAnswers(props)
  return <>{cards.map((card) => {
    if (cards.length === 1 && card.answerPresentation === 'replace' && props.canReplaceAnswer === true && liveMaps(card.payload).length === 0) return null
    return <JsonRenderCard key={card.callId}
      payload={card.payload}
      instanceId={`${props.sessionId}:${card.callId}`}
      profile={card.profile}
      businessData={card.businessData}
      eventFailureText={props.t?.('eventFailed')}
      submitForm={text => props.submitForm(props.sessionId, text)}
    />
  })}</>
}

/**
 * Complete answer component with the original Markdown as a rendering fallback.
 * @param props - closing prose, Markdown affordances, turn identity, and form callback.
 * @returns the interface, or original prose when the result cannot be rendered.
 */
export function JsonRenderReplacement(props: PropsRuntime<'conversation.chat.answer'> & JsonRenderAnswerInjected & Partial<PropsLocale<'jsonRender'>>) {
  const card = selectJsonRenderAnswer(props)
  const fallback = () => <MarkdownText text={props.text} labels={props.labels}
    fileMentions={props.fileMentions} pathImages={props.pathImages} />
  if (card === null) return fallback()
  return <JsonRenderCard key={card.callId} payload={card.payload} instanceId={`${props.sessionId}:${card.callId}`}
    profile={card.profile} businessData={card.businessData} eventFailureText={props.t?.('eventFailed')}
    submitForm={text => props.submitForm(props.sessionId, text)} fallbackRender={fallback} />
}
