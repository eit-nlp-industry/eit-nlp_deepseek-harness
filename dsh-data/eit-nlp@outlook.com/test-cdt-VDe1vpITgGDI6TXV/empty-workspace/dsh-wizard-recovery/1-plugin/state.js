/**
 * Pure fold from committed session events to one wizard state.
 * The session log is the only source of truth: a stage exists because a
 * `wizard_stage` tool call was committed, never because a card title says so.
 * @module dsh-wizard/state
 */

/** Wire name of the structured stage tool. */
export const WIZARD_TOOL = 'wizard_stage'

/** Stage kinds the view knows how to render. */
export const STAGE_KINDS = ['form', 'preview', 'done']

/** Accepts only ids that are safe to show and to key a Map by. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value, max) {
  return typeof value === 'string' && value.trim() !== '' && value.length <= max
}

/**
 * Validate one recorded stage call.
 * @param args - parsed tool arguments.
 * @param seq - committed event sequence.
 * @returns a stage record, or null when the call is not a usable stage.
 */
export function validateStage(args, seq) {
  if (!isObject(args)) return null
  if (!nonEmptyString(args.wizardId, 64) || !ID.test(args.wizardId)) return null
  if (!nonEmptyString(args.stageId, 64) || !ID.test(args.stageId)) return null
  if (!Number.isInteger(args.version) || args.version < 1) return null
  if (!STAGE_KINDS.includes(args.kind)) return null
  if (!nonEmptyString(args.title, 200)) return null
  if (!isObject(args.data)) return null
  const invalidates = Array.isArray(args.invalidates)
    ? args.invalidates.filter(id => typeof id === 'string' && ID.test(id))
    : []
  return {
    wizardId: args.wizardId,
    stageId: args.stageId,
    version: args.version,
    kind: args.kind,
    title: args.title,
    data: args.data,
    invalidates,
    stale: false,
    seq: Number(seq) || 0,
  }
}

/**
 * Fold committed events into the latest wizard state.
 * A stage keeps its highest version: a late, older call never replaces a newer
 * result, and a re-emitted stage becomes fresh again.
 * @param events - session events in commit order.
 * @returns `{ wizardId, stages, currentStageId, revision }`; no wizard when empty.
 */
export function foldWizardState(events) {
  const stages = new Map()
  let wizardId = null
  let currentStageId = null
  let revision = 0
  for (const event of events ?? []) {
    if (event?.type !== 'tool/call') continue
    const data = event.data ?? {}
    if (data.name !== WIZARD_TOOL) continue
    let args
    try {
      args = JSON.parse(String(data.arguments ?? ''))
    } catch {
      continue
    }
    const record = validateStage(args, event.seq)
    if (record === null) continue
    // A different wizardId starts a fresh stage set: stages never leak across
    // wizards that reuse the same stage ids.
    if (wizardId !== null && record.wizardId !== wizardId) {
      stages.clear()
      currentStageId = null
    }
    const previous = stages.get(record.stageId)
    if (previous !== undefined && record.version <= previous.version) continue
    // A new version of a stage is fresh; later invalidations may mark it stale.
    stages.set(record.stageId, { ...record, stale: false, staleBy: null })
    wizardId = record.wizardId
    currentStageId = record.stageId
    revision = Math.max(revision, record.seq)
    for (const target of record.invalidates) {
      if (target === record.stageId) continue
      const existing = stages.get(target)
      if (existing !== undefined) {
        stages.set(target, { ...existing, stale: true, staleBy: record.stageId })
      }
    }
  }
  return {
    wizardId,
    stages: [...stages.values()].sort((a, b) => a.seq - b.seq),
    currentStageId,
    revision,
  }
}
