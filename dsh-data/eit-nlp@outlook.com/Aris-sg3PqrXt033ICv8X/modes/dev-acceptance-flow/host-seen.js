import path from 'node:path'
import { readJsonIfExists, writeJsonAtomic } from './store.js'

/**
 * @param {{ flowRoot: string }} paths
 */
export function hostSeenPath(paths) {
  return path.join(paths.flowRoot, 'host-seen.json')
}

/**
 * @param {{ flowRoot: string }} paths
 */
export async function loadHostSeen(paths) {
  const raw = await readJsonIfExists(hostSeenPath(paths), {
    rejected_event_ids: [],
  })
  const ids = Array.isArray(raw?.rejected_event_ids)
    ? raw.rejected_event_ids.filter((id) => typeof id === 'string')
    : []
  return {
    rejected_event_ids: ids.slice(-500),
  }
}

/**
 * @param {{ flowRoot: string }} paths
 * @param {{ rejected_event_ids: string[] }} seen
 * @param {string} eventId
 */
export async function rememberRejectedEvent(paths, seen, eventId) {
  if (!eventId || seen.rejected_event_ids.includes(eventId)) return seen
  const next = {
    rejected_event_ids: [...seen.rejected_event_ids, eventId].slice(-500),
  }
  await writeJsonAtomic(hostSeenPath(paths), next)
  return next
}
