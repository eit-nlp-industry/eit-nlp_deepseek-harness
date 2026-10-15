import { parseJsonRenderPayload, type JsonRenderPayload } from '@eit/json-render-protocol'

/** Read a persisted render payload. Invalid metadata yields null so the row can fall back. */
export function payloadFromMeta(meta: unknown): JsonRenderPayload | null {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null
  const payload = (meta as { payload?: unknown }).payload
  if (payload === undefined) return null
  const parsed = parseJsonRenderPayload(payload)
  return parsed.success ? parsed.data : null
}
