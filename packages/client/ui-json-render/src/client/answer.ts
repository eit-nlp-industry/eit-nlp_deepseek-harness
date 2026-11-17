/**
 * Successful `render_ui` results retained in one conversation turn.
 */
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { ConversationMatch, ConversationNodeDefinition, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { JsonRenderPayload } from '@eit/json-render-protocol'
import { payloadFromMeta } from './payload.ts'
import { businessDataFromToolArguments } from './submit.ts'

/** Wire name of the host tool. */
export const RENDER_UI_TOOL = 'render_ui'

/** The card shown at the end of one completed turn. */
export interface JsonRenderAnswerData {
  readonly callId: string
  readonly seq: number
  readonly payload: JsonRenderPayload
  readonly answerPresentation: 'replace' | 'supplement'
  readonly profile?: 'base' | 'forms' | 'rich'
  /** Facts from the render_ui call. Route-order items are read from here when the payload omits them. */
  readonly businessData?: unknown
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Successful `render_ui` payloads in result arrival order. */
    'json-render-answer': readonly JsonRenderAnswerData[]
  }
}

/** Turn-tail owner fields this card reads. */
export interface JsonRenderAnswerOwner {
  readonly turn: TurnLocation
  readonly seq: number
}

interface RenderCall {
  readonly name: string
  readonly businessData?: unknown
}

interface AnswerState {
  readonly turn: number
  readonly calls: ReadonlyMap<string, RenderCall>
  readonly cards: readonly JsonRenderAnswerData[]
}

/**
 * The card that belongs under this turn's closing answer.
 * @param owner - turn-tail owner for the completed turn.
 * @returns the sole in-window success, or null when zero or multiple cards exist.
 */
export function selectJsonRenderAnswer(owner: JsonRenderAnswerOwner): JsonRenderAnswerData | null {
  const cards = selectJsonRenderAnswers(owner)
  const card = cards[0]
  return cards.length === 1 && card !== undefined ? card : null
}

/**
 * Successful results within this turn's visible event range.
 * @param owner - turn and current event position.
 * @returns retained cards in result arrival order.
 */
export function selectJsonRenderAnswers(owner: JsonRenderAnswerOwner): readonly JsonRenderAnswerData[] {
  const cards = owner.turn.data.get('json-render-answer') ?? []
  const end = owner.turn.end?.seq ?? owner.seq
  return cards.filter(card => card.seq <= end)
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

/**
 * Profile diagnostic persisted beside the payload.
 * @param meta - persisted tool-result metadata.
 * @returns the server profile when it is base, forms, or rich.
 */
export function profileFromMeta(meta: unknown): 'base' | 'forms' | 'rich' | undefined {
  if (typeof meta !== 'object' || meta === null || !('profile' in meta)) return undefined
  const profile = meta.profile
  if (profile === 'base' || profile === 'forms' || profile === 'rich') return profile
  return undefined
}

function settledCard(match: ConversationMatch, callId: string, businessData: unknown): JsonRenderAnswerData | undefined {
  if (match.event.type !== 'tool/result' || !isAppendSurfaceEvent(match.event)) return undefined
  if (match.event.data.message.isError === true) return undefined
  const payload = payloadFromMeta(match.event.data.meta)
  if (payload === null) return undefined
  const profile = profileFromMeta(match.event.data.meta)
  return {
    callId,
    seq: match.event.seq,
    payload,
    answerPresentation: answerPresentationFromMeta(match.event.data.meta),
    ...profile !== undefined ? { profile } : {},
    ...businessData !== undefined ? { businessData } : {},
  }
}

/** Records successful `render_ui` results on their turn. It publishes no view node. */
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
    return { turn: match.event.data.turn, calls: new Map(), cards: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      const name = match.event.data.name
      const businessData = name === RENDER_UI_TOOL ? businessDataFromToolArguments(match.event.data.arguments) : undefined
      calls.set(String(match.event.data.callId), {
        name,
        ...businessData !== undefined ? { businessData } : {},
      })
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result') return context.state
    const callId = String(match.event.data.message.source.callId)
    const call = context.state.calls.get(callId)
    if (call?.name !== RENDER_UI_TOOL) return context.state
    const card = settledCard(match, callId, call.businessData)
    if (card === undefined) return context.state
    const index = context.state.cards.findIndex(existing => existing.callId === callId)
    const cards = [...context.state.cards]
    if (index < 0) cards.push(card)
    else cards[index] = card
    return { ...context.state, cards }
  },
  buildLocationData: (context, scope, previous) => {
    if (scope !== 'turn' || context.state === undefined || context.state.cards.length === 0) return null
    const cards = context.state.cards
    if (previous?.kind === 'turn'
      && previous.turn === context.state.turn
      && previous.key === 'json-render-answer'
      && previous.value === cards) return previous
    return {
      kind: 'turn',
      turn: context.state.turn,
      key: 'json-render-answer',
      value: cards,
    }
  },
}
