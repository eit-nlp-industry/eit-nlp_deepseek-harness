/** Same-origin live map subscriptions, scoped to one message and map element. */
import type { JsonRenderPayload } from '@eit/json-render-protocol'

/** A single update for the existing panel's state store. */
export interface MapPositionUpdate {
  path: '/tracking/position'
  value: { x: number; y: number; status: 'idle' | 'moving' | 'arrived'; heading?: number }
}

/** Where a live map's position frames come from. */
export type LiveMapSource = 'robot-live' | 'robot-demo'

/** One map element whose position can move without rewriting the payload. */
export interface LiveMap {
  readonly elementId: string
  readonly trackId: string
  readonly source: LiveMapSource
  /** Literal or state-resolved places, for the local campus demo. */
  readonly places?: ReadonlyArray<{ id: string; x: number; y: number }>
  /** Target place from the payload, for the local campus demo. */
  readonly targetPlaceId?: string
}

/** Exact local demo track this host simulates in the browser. */
export const CAMPUS_DEMO_TRACK_ID = 'campus-route'

/** Browser transport subset used by each live map subscription. */
export interface LocationStream {
  /** Register delivery of a named position event. */
  addEventListener(type: 'position', listener: (event: MessageEvent<string>) => void): void
  /** Stop delivery and browser reconnection. */
  close(): void
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolve(value: unknown, initial: unknown): unknown {
  if (!record(value) || typeof value.$state !== 'string') return value
  if (!value.$state.startsWith('/')) return undefined
  let current = initial
  for (const part of value.$state.slice(1).split('/')) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~')
    if (!record(current) || !Object.hasOwn(current, key)) return undefined
    current = current[key]
  }
  return current
}

/**
 * Resolve live tracking declarations without changing the payload.
 * @param payload - immutable message payload.
 * @returns map element identities, track ids, and local-demo route facts.
 */
export function liveMaps(payload: JsonRenderPayload): LiveMap[] {
  return Object.entries(payload.spec.elements).flatMap(([elementId, element]): LiveMap[] => {
    if (element.type !== 'MapPreview' || !record(element.props)) return []
    const tracking = resolve(element.props.tracking, payload.state?.initial)
    const position = element.props.position
    if (!record(position) || position.$state !== '/tracking/position') return []
    if (!record(tracking) || typeof tracking.trackId !== 'string' || tracking.trackId.trim() === '') return []
    if (tracking.source === 'robot-live') {
      return [{ elementId, trackId: tracking.trackId, source: 'robot-live' as const }]
    }
    if (tracking.source !== 'robot-demo' || tracking.trackId !== CAMPUS_DEMO_TRACK_ID) return []
    const places = resolve(element.props.places, payload.state?.initial)
    const demoPlaces = Array.isArray(places)
      ? places.flatMap(place => record(place)
        && typeof place.id === 'string'
        && typeof place.x === 'number' && Number.isFinite(place.x)
        && typeof place.y === 'number' && Number.isFinite(place.y)
        ? [{ id: place.id, x: place.x, y: place.y }]
        : [])
      : []
    const targetPlaceId = typeof element.props.targetPlaceId === 'string' ? element.props.targetPlaceId : undefined
    return [{
      elementId,
      trackId: tracking.trackId,
      source: 'robot-demo' as const,
      ...demoPlaces.length > 0 ? { places: demoPlaces } : {},
      ...targetPlaceId === undefined ? {} : { targetPlaceId },
    }]
  })
}

/**
 * Subscribe to a map until arrival or disposal. Invalid and stale frames have no effects.
 * @param endpoint - host-configured same-origin endpoint.
 * @param origin - page origin used to enforce same-origin requests.
 * @param trackId - exact trajectory id from the payload.
 * @param publish - updates the existing panel store.
 * @param createStream - EventSource factory owned by the browser host.
 * @returns idempotent disposer, also preventing late event delivery.
 */
export function subscribeMap(endpoint: string, origin: string, trackId: string, publish: (update: MapPositionUpdate) => void,
  createStream: (url: string) => LocationStream): () => void {
  const url = new URL(endpoint, origin)
  if (url.origin !== origin || url.username !== '' || url.password !== '' || url.hash !== '') throw new Error('Map tracking endpoint must be same-origin')
  url.searchParams.set('trackId', trackId)
  const stream = createStream(url.href)
  let closed = false
  let lastSeq = -Infinity
  const close = () => {
    if (closed) return
    closed = true
    stream.close()
  }
  stream.addEventListener('position', (event) => {
    if (closed) return
    let frame: unknown
    try { frame = JSON.parse(event.data) } catch (error) {
      // Individual malformed SSE frames do not invalidate the connection.
      void error
      return
    }
    if (!record(frame) || frame.trackId !== trackId || !Number.isSafeInteger(frame.seq) || typeof frame.seq !== 'number' || frame.seq <= lastSeq) return
    if (typeof frame.x !== 'number' || !Number.isFinite(frame.x) || frame.x < 0 || frame.x > 100
      || typeof frame.y !== 'number' || !Number.isFinite(frame.y) || frame.y < 0 || frame.y > 100) return
    if (frame.status !== 'idle' && frame.status !== 'moving' && frame.status !== 'arrived') return
    if (frame.heading !== undefined && (typeof frame.heading !== 'number' || !Number.isFinite(frame.heading) || frame.heading < 0 || frame.heading >= 360)) return
    lastSeq = frame.seq
    publish({ path: '/tracking/position', value: { x: frame.x, y: frame.y, status: frame.status,
      ...typeof frame.heading === 'number' ? { heading: frame.heading } : {} } })
    if (frame.status === 'arrived') close()
  })
  return close
}
