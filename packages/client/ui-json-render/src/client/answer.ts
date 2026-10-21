/**
 * Turn-scoped latest `render_ui` result and its answer presentation.
 */
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { ConversationMatch, ConversationNodeDefinition, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { JsonRenderPayload } from '@eit/json-render-protocol'
import { payloadFromMeta } from './payload.ts'

/** Wire name of the host tool. */
export const RENDER_UI_TOOL = 'render_ui'

/** The card shown at the end of one completed turn. */
export interface JsonRenderAnswerData {
  readonly callId: string
  readonly seq: number
  readonly payload: JsonRenderPayload
  readonly answerPresentation: 'replace' | 'supplement'
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Latest `render_ui` payload, cleared when a later render fails. */
    'json-render-answer': JsonRenderAnswerData
  }
}

/** Turn-tail owner fields this card reads. */
export interface JsonRenderAnswerOwner {
  readonly turn: TurnLocation
  readonly seq: number
}

interface RenderCall {
  readonly name: string
}

interface AnswerState {
  readonly turn: number
  readonly calls: ReadonlyMap<string, RenderCall>
  readonly card: JsonRenderAnswerData | undefined
}

/**
 * The card that belongs under this turn's closing answer.
 * @param owner - turn-tail owner for the completed turn.
 * @returns the last in-window success, or null when this turn rendered nothing.
 */
export function selectJsonRenderAnswer(owner: JsonRenderAnswerOwner): JsonRenderAnswerData | null {
  const card = owner.turn.data.get('json-render-answer')
  if (card === undefined) return null
  const end = owner.turn.end?.seq ?? owner.seq
  return card.seq <= end ? card : null
}

/**
 * Read the tool's explicit answer declaration; historical metadata remains supplementary.
 * @param meta - persisted tool-result metadata.
 * @returns replacement only when explicitly declared.
 */
export function answerPresentationFromMeta(meta: unknown): 'replace' | 'supplement' {
  return typeof meta === 'object' && meta !== null && 'answerPresentation' in meta
    && meta.answerPresentation === 'replace' ? 'replace' : 'supplement'
}

function settledCard(match: ConversationMatch, callId: string): JsonRenderAnswerData | undefined {
  if (match.event.type !== 'tool/result') return undefined
  if (match.event.data.message.isError === true) return undefined
  const payload = payloadFromMeta(match.event.data.meta)
  if (payload === null) return undefined
  return { callId, seq: match.event.seq, payload, answerPresentation: answerPresentationFromMeta(match.event.data.meta) }
}

/** Records the latest `render_ui` result on its turn. It publishes no view node. */
export const jsonRenderAnswerDefinition: ConversationNodeDefinition<AnswerState> = {
  kind: 'json-render-answer',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('json-render-answer start requires turn/start')
    return { turn: match.event.data.turn, calls: new Map(), card: undefined }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      calls.set(String(match.event.data.callId), { name: match.event.data.name })
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result') return context.state
    const callId = String(match.event.data.message.source.callId)
    const call = context.state.calls.get(callId)
    if (call?.name !== RENDER_UI_TOOL) return context.state
    const card = settledCard(match, callId)
    return { ...context.state, card }
  },
  buildLocationData: (context, scope, previous) => {
    if (scope !== 'turn' || context.state === undefined || context.state.card === undefined) return null
    const card = context.state.card
    if (previous?.kind === 'turn'
      && previous.turn === context.state.turn
      && previous.key === 'json-render-answer'
      && previous.value.callId === card.callId
      && previous.value.seq === card.seq) return previous
    return {
      kind: 'turn',
      turn: context.state.turn,
      key: 'json-render-answer',
      value: card,
    }
  },
}
