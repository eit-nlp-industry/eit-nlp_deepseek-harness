/** Shared DSH map subscription fields, adapter identities, and position decoding. */
export const MAP_POSITION_PATH = '/tracking/position'
/** Inclusive schematic coordinate limits used by MapPreview. */
export const MAP_COORDINATE_MIN = 0
/** Inclusive schematic coordinate limits used by MapPreview. */
export const MAP_COORDINATE_MAX = 100
/** Location stream backed by the robot service. */
export const LIVE_MAP_SOURCE = 'robot-live'
/** Location stream backed by the campus demonstration adapter. */
export const DEMO_MAP_SOURCE = 'robot-demo'
/** Trajectory identity owned by the campus demonstration adapter. */
export const CAMPUS_DEMO_TRACK_ID = 'campus-route'
/** Sources implemented by DSH location adapters. */
export type LiveMapSource = typeof LIVE_MAP_SOURCE | typeof DEMO_MAP_SOURCE
/** Movement states accepted from a location stream. */
export type MapStatus = 'idle' | 'moving' | 'arrived'
/** Initial or streamed schematic coordinates. */
export type MapPosition = { x: number; y: number; status?: MapStatus; heading?: number; progress?: number }

/**
 * Decode provider coordinates without inventing defaults or retaining unknown fields.
 * @param value - Initial position or untrusted location frame.
 * @returns Canonical coordinates, or undefined for invalid values.
 */
export function parseMapPosition(value: unknown): MapPosition | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const p = value as Record<string, unknown>
  if (typeof p.x !== 'number' || !Number.isFinite(p.x) || p.x < MAP_COORDINATE_MIN || p.x > MAP_COORDINATE_MAX
    || typeof p.y !== 'number' || !Number.isFinite(p.y) || p.y < MAP_COORDINATE_MIN || p.y > MAP_COORDINATE_MAX
    || (p.status !== undefined && p.status !== 'idle' && p.status !== 'moving' && p.status !== 'arrived')
    || (p.heading !== undefined && (typeof p.heading !== 'number' || !Number.isFinite(p.heading) || p.heading < 0 || p.heading >= 360))
    || (p.progress !== undefined && (typeof p.progress !== 'number' || !Number.isFinite(p.progress) || p.progress < 0 || p.progress > 1))) return undefined
  return { x: p.x, y: p.y,
    ...p.status === undefined ? {} : { status: p.status },
    ...p.heading === undefined ? {} : { heading: p.heading },
    ...p.progress === undefined ? {} : { progress: p.progress },
  }
}
