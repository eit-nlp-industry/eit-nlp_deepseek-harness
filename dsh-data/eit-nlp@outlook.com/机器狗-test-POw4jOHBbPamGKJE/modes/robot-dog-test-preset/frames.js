// frame_id → Attachment reference registry for the robot-dog-test preset.
//
// A submitted observation frame is the only durable handle the model has for a
// picture it already saw. Later tools (remember_person, cropping) resolve the
// same frame_id here so bbox and pixels always come from the same bytes.
//
// Module-level state: every plugin file of this package shares one instance.

const DEFAULT_TTL_MS = 10 * 60 * 1000

/** @type {Map<string, { ref: unknown, capturedAt: number, expiresAt: number }>} */
const entries = new Map()

function key(sessionId, frameId) {
  return `${String(sessionId)}::${String(frameId)}`
}

/**
 * Register the attachment a submitted frame refers to.
 * @param {string} sessionId
 * @param {string} frameId
 * @param {unknown} ref
 * @param {number} capturedAt
 * @param {number} [ttlMs]
 */
export function putFrame(sessionId, frameId, ref, capturedAt, ttlMs = DEFAULT_TTL_MS) {
  const now = Date.now()
  entries.set(key(sessionId, frameId), { ref, capturedAt, expiresAt: now + ttlMs })
}

/**
 * Resolve one frame, honouring the TTL.
 * @returns {{ ref: unknown, capturedAt: number } | null}
 */
export function getFrame(sessionId, frameId) {
  const entry = entries.get(key(sessionId, frameId))
  if (entry === undefined) return null
  if (entry.expiresAt <= Date.now()) {
    entries.delete(key(sessionId, frameId))
    return null
  }
  return { ref: entry.ref, capturedAt: entry.capturedAt }
}

/** Drop every entry for one session (disposal). */
export function clearSession(sessionId) {
  const prefix = `${String(sessionId)}::`
  for (const entryKey of entries.keys()) {
    if (entryKey.startsWith(prefix)) entries.delete(entryKey)
  }
}

/** Drop expired entries; returns how many were removed. */
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

/** Size of the registry, for the debug status snapshot. */
export function size() {
  return entries.size
}
