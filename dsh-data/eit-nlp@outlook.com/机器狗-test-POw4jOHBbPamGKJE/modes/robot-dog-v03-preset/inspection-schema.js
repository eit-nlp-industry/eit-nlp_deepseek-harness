// Structured observation validation for the event-site inspection demo.

export const VERDICTS = new Set(['met', 'not_met', 'uncertain'])

export const EVIDENCE_KINDS = new Set(['absence', 'clear_anomaly', 'other'])

export const CHECKPOINT_STATUSES = new Set([
  'pending',
  'checking',
  'met',
  'needs_fix',
  'uncertain',
  'remediating',
  'recheck_pending',
  'rechecking',
])

export const SUGGESTED_ACTIONS = new Set([
  'none',
  'record_issue',
  'request_better_view',
  'advance',
  'wait_remediation',
  'recheck',
])

/**
 * @param {unknown} value
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function parseObservation(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'observation must be an object' }
  }
  const raw = /** @type {Record<string, unknown>} */ (value)
  const checkpointId = String(raw.checkpoint_id ?? '').trim()
  const streamId = String(raw.stream_id ?? '').trim()
  const frameId = Number(raw.frame_id)
  const inspectionRound = Number(raw.inspection_round)
  const verdict = String(raw.verdict ?? '').trim()
  if (checkpointId === '') return { ok: false, error: 'checkpoint_id required' }
  if (streamId === '') return { ok: false, error: 'stream_id required' }
  if (!Number.isFinite(frameId)) return { ok: false, error: 'frame_id must be a number' }
  if (!Number.isFinite(inspectionRound) || inspectionRound < 1) {
    return { ok: false, error: 'inspection_round must be >= 1' }
  }
  if (!VERDICTS.has(verdict)) {
    return { ok: false, error: 'verdict must be met | not_met | uncertain' }
  }

  const locationMatches = Boolean(raw.location_matches)
  const viewComplete = Boolean(raw.view_complete)
  const imageReadable = Boolean(raw.image_readable)
  const observations = Array.isArray(raw.observations)
    ? raw.observations.map(item => String(item)).filter(item => item.length > 0).slice(0, 12)
    : []
  const reason = typeof raw.reason === 'string' ? raw.reason.trim().slice(0, 500) : ''
  const suggestedAction = typeof raw.suggested_action === 'string'
    ? raw.suggested_action.trim()
    : 'none'
  const evidenceAssetId = typeof raw.evidence_asset_id === 'string'
    ? raw.evidence_asset_id.trim()
    : ''
  const evidenceFrameId = typeof raw.evidence_frame_id === 'string'
    ? raw.evidence_frame_id.trim()
    : (Number.isFinite(frameId) ? `frame_${frameId}` : '')
  const evidenceKindRaw = typeof raw.evidence_kind === 'string'
    ? raw.evidence_kind.trim()
    : ''
  const evidenceKind = EVIDENCE_KINDS.has(evidenceKindRaw)
    ? evidenceKindRaw
    : (verdict === 'not_met' ? 'absence' : 'other')

  if (verdict === 'met' && (!locationMatches || !viewComplete || !imageReadable)) {
    return {
      ok: false,
      error: 'met requires location_matches, view_complete, and image_readable',
    }
  }

  if (verdict === 'not_met') {
    if (!locationMatches || !imageReadable) {
      return {
        ok: false,
        error: 'not_met requires location_matches and image_readable',
      }
    }
    // Absence claims need a complete decision region. Clear anomalies may use a
    // partial but sufficient view (e.g. a box clearly blocking the marked aisle).
    if (evidenceKind === 'absence' && !viewComplete) {
      return {
        ok: false,
        error: 'absence not_met requires view_complete=true; use uncertain or clear_anomaly',
      }
    }
  }

  return {
    ok: true,
    value: {
      checkpoint_id: checkpointId,
      inspection_round: inspectionRound,
      stream_id: streamId,
      frame_id: frameId,
      location_matches: locationMatches,
      view_complete: viewComplete,
      image_readable: imageReadable,
      verdict,
      observations,
      reason,
      suggested_action: SUGGESTED_ACTIONS.has(suggestedAction) ? suggestedAction : 'none',
      evidence_kind: evidenceKind,
      evidence_asset_id: evidenceAssetId,
      evidence_frame_id: evidenceFrameId,
    },
  }
}
