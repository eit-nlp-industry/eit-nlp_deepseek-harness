import { fail } from './validate.js'

/**
 * @param {unknown} input
 */
export function validateFindingsLedger(input) {
  if (!input || typeof input !== 'object') return fail('FINDINGS_INVALID', 'findings 必须是对象')
  const ledger = /** @type {Record<string, unknown>} */ (input)
  if (ledger.schemaVersion !== 1) return fail('SCHEMA_VERSION_INVALID', 'schemaVersion 必须为 1')
  if (typeof ledger.project_id !== 'string' || ledger.project_id.trim() === '') {
    return fail('PROJECT_ID_INVALID', 'project_id 无效')
  }
  if (!Array.isArray(ledger.items)) return fail('FINDINGS_ITEMS_INVALID', 'items 必须是数组')
  return { ok: true, value: ledger }
}

/**
 * @param {string} projectId
 */
export function emptyFindingsLedger(projectId) {
  return {
    schemaVersion: 1,
    project_id: projectId,
    items: [],
    updated_at: new Date().toISOString(),
  }
}

/**
 * @param {Record<string, unknown>} ledger
 * @param {string[]} findingIds
 * @param {string} submissionId
 * @param {string} at
 */
export function markFindingsPendingRetest(ledger, findingIds, submissionId, at) {
  const items = /** @type {Array<Record<string, unknown>>} */ (ledger.items ?? []).map((item) => {
    if (!findingIds.includes(/** @type {string} */ (item.finding_id))) return item
    const history = Array.isArray(item.history) ? [...item.history] : []
    history.push({
      at,
      status: 'fixed_pending_retest',
      review_id: item.last_review_id ?? item.opened_in_review_id,
      submission_id: submissionId,
      note: '研发送验声称已处理',
    })
    return {
      ...item,
      status: 'fixed_pending_retest',
      last_submission_id: submissionId,
      history,
    }
  })
  return {
    ...ledger,
    items,
    updated_at: at,
  }
}

/**
 * Merge review findings into the stable ledger. Reuses finding_id across rounds.
 * @param {Record<string, unknown>} ledger
 * @param {Record<string, unknown>} review
 */
export function applyReviewToFindings(ledger, review) {
  if (ledger.project_id !== review.project_id) {
    return fail('PROJECT_ID_MISMATCH', 'findings 与 review 的 project_id 不一致')
  }

  const at = /** @type {string} */ (review.reviewed_at)
  const byId = new Map(
    /** @type {Array<Record<string, unknown>>} */ (ledger.items ?? []).map((item) => [
      item.finding_id,
      { ...item, history: Array.isArray(item.history) ? [...item.history] : [] },
    ]),
  )

  for (const raw of /** @type {Array<Record<string, unknown>>} */ (review.findings ?? [])) {
    const existing = byId.get(raw.finding_id)
    const historyEntry = {
      at,
      status: raw.status,
      review_id: review.review_id,
      submission_id: review.submission_id,
      note: typeof review.summary === 'string' ? review.summary : undefined,
    }
    if (!existing) {
      byId.set(raw.finding_id, {
        finding_id: raw.finding_id,
        requirement_id: raw.requirement_id,
        category: raw.category,
        blocking: raw.blocking,
        description: raw.description,
        acceptance_condition: raw.acceptance_condition,
        status: raw.status,
        opened_in_review_id: review.review_id,
        opened_against_submission_id: review.submission_id,
        last_submission_id: review.submission_id,
        last_review_id: review.review_id,
        history: [historyEntry],
      })
      continue
    }
    existing.status = raw.status
    existing.blocking = raw.blocking
    existing.description = raw.description
    existing.acceptance_condition = raw.acceptance_condition
    existing.category = raw.category
    existing.requirement_id = raw.requirement_id
    existing.last_submission_id = review.submission_id
    existing.last_review_id = review.review_id
    existing.history.push(historyEntry)
    byId.set(raw.finding_id, existing)
  }

  // Out-of-scope suggestions never become findings / remediation tasks.
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      project_id: ledger.project_id,
      items: [...byId.values()],
      updated_at: at,
    },
  }
}

/**
 * Blocking open findings that should become remediation tasks.
 * @param {Record<string, unknown>} ledger
 */
export function openBlockingFindings(ledger) {
  return /** @type {Array<Record<string, unknown>>} */ (ledger.items ?? []).filter(
    (item) => item.blocking === true && (item.status === 'open' || item.status === 'retested_failed'
      || item.status === 'fixed_pending_retest'),
  )
}
