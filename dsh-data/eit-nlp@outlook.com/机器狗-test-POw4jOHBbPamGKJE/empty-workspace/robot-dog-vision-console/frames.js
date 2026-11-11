// frame_id → Attachment reference registry for the vision console.
//
// A pushed observation frame is the only handle the model has for a picture it
// already saw. `remember_person` resolves the same frame_id here, so the bbox the
// model reports and the pixels we draw on come from the exact same bytes.

const DEFAULT_TTL_MS = 10 * 60 * 1000

/** @type {Map<string, { ref: unknown, capturedAt: number, expiresAt: number }>} */
const entries = new Map()

function key(sessionId, frameId) {
  return `${String(sessionId)}::${String(frameId)}`
}

/**
 * @param {string} sessionId
 * @param {string} frameId
 * @param {unknown} ref normalized ImageAttachmentRef
 * @param {number} capturedAt
 * @param {number} [ttlMs]
 */
export function putFrame(sessionId, frameId, ref, capturedAt, ttlMs = DEFAULT_TTL_MS) {
  entries.set(key(sessionId, frameId), { ref, capturedAt, expiresAt: Date.now() + ttlMs })
}

/**
 * @returns {{ ref: unknown, capturedAt: number } | null}
 */
export function getFrame(sessionId, frameId) {
  const entryKey = key(sessionId, frameId)
  const entry = entries.get(entryKey)
  if (entry === undefined) return null
  if (entry.expiresAt <= Date.now()) {
    entries.delete(entryKey)
    return null
  }
  return { ref: entry.ref, capturedAt: entry.capturedAt }
}

/** Drop every frame of one session. */
export function clearSession(sessionId) {
  const prefix = `${String(sessionId)}::`
  for (const entryKey of entries.keys()) {
    if (entryKey.startsWith(prefix)) entries.delete(entryKey)
  }
}

/** Drop expired frames; returns how many were removed. */
export function sweep() {
  const now = Date.now()
  let removed = 0
  for (const [entryKey, entry] of entries) {
    if (entry.expiresAt <= now) {
      entries.delete(entryKey)
      removed += 1
    }
  }
  return removed
}

export function size() {
  return entries.size
}
