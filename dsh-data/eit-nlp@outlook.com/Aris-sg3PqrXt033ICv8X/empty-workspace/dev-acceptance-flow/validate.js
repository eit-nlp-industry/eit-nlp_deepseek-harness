/** Structural checks for flow coordination JSON. Schemas in ./schemas are the contract; this module is the executable subset used by the host guard. */

const FLOW_STATUSES = new Set([
  'bootstrapping',
  'developing',
  'awaiting_user',
  'awaiting_acceptance',
  'remediating',
  'acceptance_passed',
  'delivering',
  'delivery_completed',
  'needs_manual',
  'failed_terminal',
])

const WAITING_REASONS = new Set([
  'none',
  'prd_clarification',
  'acceptance_blocked',
  'awaiting_review',
  'max_rounds_exceeded',
  'environment',
  'other',
])

const SUBMISSION_KINDS = new Set(['initial', 'remediation'])
const SELF_CHECK = new Set(['passed', 'blocked'])
const VERDICTS = new Set(['passed', 'changes_required', 'blocked'])
const FINDING_CATEGORIES = new Set([
  'requirement_gap',
  'behavior_defect',
  'missing_evidence',
  'process_skip',
  'regression',
  'out_of_scope_suggestion',
  'environment_block',
  'other',
])
const FINDING_STATUSES = new Set([
  'open',
  'fixed_pending_retest',
  'retested_passed',
  'retested_failed',
  'deferred_out_of_scope',
  'blocked_insufficient_evidence',
])
const EVIDENCE_KINDS = new Set([
  'command_log',
  'test_report',
  'artifact_file',
  'source_path',
  'git_commit',
  'acceptance_record_id',
  'other',
])

const PROJECT_ID_RE = /^[^\\/\0]+$/
const GIT_SHA_RE = /^[0-9a-f]{7,64}$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 */
export function fail(code, message, details = {}) {
  return { ok: false, code, message, details }
}

/**
 * @param {unknown} value
 * @param {number} [max]
 */
function nonEmptyString(value, max = 8000) {
  return typeof value === 'string' && value.trim() !== '' && value.trim().length <= max
}

/**
 * @param {unknown} value
 */
function projectId(value) {
  return nonEmptyString(value, 120) && PROJECT_ID_RE.test(/** @type {string} */ (value).trim())
}

/**
 * @param {unknown} value
 */
function gitSha(value) {
  return typeof value === 'string' && GIT_SHA_RE.test(value)
}

/**
 * @param {unknown} value
 */
function isoDateTime(value) {
  return typeof value === 'string' && ISO_RE.test(value)
}

/**
 * @param {unknown} refs
 */
function evidenceRefs(refs) {
  if (!Array.isArray(refs) || refs.length < 1) return false
  return refs.every((item) => {
    if (!item || typeof item !== 'object') return false
    const row = /** @type {Record<string, unknown>} */ (item)
    if (!EVIDENCE_KINDS.has(/** @type {string} */ (row.kind))) return false
    if (!nonEmptyString(row.ref)) return false
    if (row.note !== undefined && typeof row.note !== 'string') return false
    return true
  })
}

/**
 * @param {unknown} finding
 */
function reviewFinding(finding) {
  if (!finding || typeof finding !== 'object') return fail('FINDING_INVALID', 'finding 必须是对象')
  const row = /** @type {Record<string, unknown>} */ (finding)
  if (!nonEmptyString(row.finding_id, 120)) return fail('FINDING_ID_INVALID', 'finding_id 无效')
  if (!nonEmptyString(row.requirement_id, 120)) return fail('REQUIREMENT_ID_INVALID', 'requirement_id 无效')
  if (!FINDING_CATEGORIES.has(/** @type {string} */ (row.category))) {
    return fail('FINDING_CATEGORY_INVALID', 'category 无效')
  }
  if (typeof row.blocking !== 'boolean') return fail('FINDING_BLOCKING_INVALID', 'blocking 必须是布尔值')
  if (!nonEmptyString(row.description)) return fail('FINDING_DESCRIPTION_INVALID', 'description 无效')
  if (!evidenceRefs(row.evidence_refs)) return fail('EVIDENCE_REFS_INVALID', 'evidence_refs 至少一条且字段合法')
  if (!nonEmptyString(row.acceptance_condition)) {
    return fail('ACCEPTANCE_CONDITION_INVALID', 'acceptance_condition 无效')
  }
  if (!FINDING_STATUSES.has(/** @type {string} */ (row.status))) {
    return fail('FINDING_STATUS_INVALID', 'status 无效')
  }
  return { ok: true }
}

/**
 * @param {unknown} input
 */
export function validateFlow(input) {
  if (!input || typeof input !== 'object') return fail('FLOW_INVALID', 'flow 必须是对象')
  const flow = /** @type {Record<string, unknown>} */ (input)
  if (flow.schemaVersion !== 1) return fail('SCHEMA_VERSION_INVALID', 'schemaVersion 必须为 1')
  if (!projectId(flow.project_id)) return fail('PROJECT_ID_INVALID', 'project_id 无效')
  if (!nonEmptyString(flow.project_root, 1024)) return fail('PROJECT_ROOT_INVALID', 'project_root 无效')
  if (!nonEmptyString(flow.development_session_id, 200)) {
    return fail('DEVELOPMENT_SESSION_INVALID', 'development_session_id 无效')
  }
  if (!nonEmptyString(flow.acceptance_session_id, 200)) {
    return fail('ACCEPTANCE_SESSION_INVALID', 'acceptance_session_id 无效')
  }
  if (!FLOW_STATUSES.has(/** @type {string} */ (flow.flow_status))) {
    return fail('FLOW_STATUS_INVALID', 'flow_status 无效')
  }
  if (flow.active_submission_id !== null && flow.active_submission_id !== undefined) {
    if (!nonEmptyString(flow.active_submission_id, 120)) {
      return fail('ACTIVE_SUBMISSION_INVALID', 'active_submission_id 无效')
    }
  }
  if (flow.active_review_id !== null && flow.active_review_id !== undefined) {
    if (!nonEmptyString(flow.active_review_id, 120)) {
      return fail('ACTIVE_REVIEW_INVALID', 'active_review_id 无效')
    }
  }
  if (!Number.isInteger(flow.remediation_round) || /** @type {number} */ (flow.remediation_round) < 0) {
    return fail('REMEDIATION_ROUND_INVALID', 'remediation_round 必须是 >= 0 的整数')
  }
  if (!Number.isInteger(flow.max_remediation_rounds) || /** @type {number} */ (flow.max_remediation_rounds) < 1) {
    return fail('MAX_ROUNDS_INVALID', 'max_remediation_rounds 必须是 >= 1 的整数')
  }
  if (!WAITING_REASONS.has(/** @type {string} */ (flow.waiting_reason))) {
    return fail('WAITING_REASON_INVALID', 'waiting_reason 无效')
  }
  if (flow.waiting_detail !== undefined && typeof flow.waiting_detail !== 'string') {
    return fail('WAITING_DETAIL_INVALID', 'waiting_detail 必须是字符串')
  }
  if (flow.last_event_id !== null && flow.last_event_id !== undefined) {
    if (!nonEmptyString(flow.last_event_id, 200)) return fail('LAST_EVENT_INVALID', 'last_event_id 无效')
  }
  if (flow.processed_event_ids !== undefined) {
    if (!Array.isArray(flow.processed_event_ids) || flow.processed_event_ids.length > 200) {
      return fail('PROCESSED_EVENTS_INVALID', 'processed_event_ids 必须是长度 <= 200 的数组')
    }
    if (!flow.processed_event_ids.every((id) => nonEmptyString(id, 200))) {
      return fail('PROCESSED_EVENTS_INVALID', 'processed_event_ids 含非法 id')
    }
  }
  if (!isoDateTime(flow.updated_at)) return fail('UPDATED_AT_INVALID', 'updated_at 必须是 ISO 时间')
  return { ok: true, value: flow }
}

/**
 * @param {unknown} input
 */
export function validateSubmission(input) {
  if (!input || typeof input !== 'object') return fail('SUBMISSION_INVALID', 'submission 必须是对象')
  const sub = /** @type {Record<string, unknown>} */ (input)
  if (sub.schemaVersion !== 1) return fail('SCHEMA_VERSION_INVALID', 'schemaVersion 必须为 1')
  if (!nonEmptyString(sub.submission_id, 120)) return fail('SUBMISSION_ID_INVALID', 'submission_id 无效')
  if (!nonEmptyString(sub.event_id, 200)) return fail('EVENT_ID_INVALID', 'event_id 无效')
  if (!projectId(sub.project_id)) return fail('PROJECT_ID_INVALID', 'project_id 无效')
  if (!SUBMISSION_KINDS.has(/** @type {string} */ (sub.kind))) return fail('SUBMISSION_KIND_INVALID', 'kind 无效')
  if (!nonEmptyString(sub.prd_revision, 128)) return fail('PRD_REVISION_INVALID', 'prd_revision 无效')
  if (!gitSha(sub.code_revision)) return fail('CODE_REVISION_INVALID', 'code_revision 必须是 git sha')
  if (!nonEmptyString(sub.readonly_tree_ref, 1024)) {
    return fail('READONLY_TREE_INVALID', 'readonly_tree_ref 无效')
  }
  if (!nonEmptyString(sub.artifact_manifest_ref, 1024)) {
    return fail('ARTIFACT_MANIFEST_INVALID', 'artifact_manifest_ref 无效')
  }
  if (!nonEmptyString(sub.requirement_evidence_map_ref, 1024)) {
    return fail('REQUIREMENT_MAP_INVALID', 'requirement_evidence_map_ref 无效')
  }
  if (!SELF_CHECK.has(/** @type {string} */ (sub.self_check_status))) {
    return fail('SELF_CHECK_INVALID', 'self_check_status 无效')
  }
  if (!isoDateTime(sub.submitted_at)) return fail('SUBMITTED_AT_INVALID', 'submitted_at 无效')

  if (sub.kind === 'remediation') {
    if (!nonEmptyString(sub.previous_submission_id, 120)) {
      return fail('PREVIOUS_SUBMISSION_REQUIRED', '整改送验必须带 previous_submission_id')
    }
    if (!nonEmptyString(sub.remediation_summary_ref, 1024)) {
      return fail('REMEDIATION_SUMMARY_REQUIRED', '整改送验必须带 remediation_summary_ref')
    }
    if (!Array.isArray(sub.addresses_finding_ids) || sub.addresses_finding_ids.length < 1) {
      return fail('ADDRESSES_FINDINGS_REQUIRED', '整改送验必须声明 addresses_finding_ids')
    }
    if (!sub.addresses_finding_ids.every((id) => nonEmptyString(id, 120))) {
      return fail('ADDRESSES_FINDINGS_INVALID', 'addresses_finding_ids 含非法 id')
    }
  } else if (sub.addresses_finding_ids !== undefined) {
    if (!Array.isArray(sub.addresses_finding_ids)
      || !sub.addresses_finding_ids.every((id) => nonEmptyString(id, 120))) {
      return fail('ADDRESSES_FINDINGS_INVALID', 'addresses_finding_ids 无效')
    }
  }

  if (sub.self_check_status === 'passed') {
    if (!nonEmptyString(sub.final_verification_ref, 1024)) {
      return fail('FINAL_VERIFICATION_REQUIRED', '自检通过必须附 final_verification_ref')
    }
  }

  return { ok: true, value: sub }
}

/**
 * @param {unknown} input
 */
export function validateReview(input) {
  if (!input || typeof input !== 'object') return fail('REVIEW_INVALID', 'review 必须是对象')
  const review = /** @type {Record<string, unknown>} */ (input)
  if (review.schemaVersion !== 1) return fail('SCHEMA_VERSION_INVALID', 'schemaVersion 必须为 1')
  if (!nonEmptyString(review.review_id, 120)) return fail('REVIEW_ID_INVALID', 'review_id 无效')
  if (!nonEmptyString(review.event_id, 200)) return fail('EVENT_ID_INVALID', 'event_id 无效')
  if (!projectId(review.project_id)) return fail('PROJECT_ID_INVALID', 'project_id 无效')
  if (!nonEmptyString(review.submission_id, 120)) return fail('SUBMISSION_ID_INVALID', 'submission_id 无效')
  if (!gitSha(review.reviewed_revision)) return fail('REVIEWED_REVISION_INVALID', 'reviewed_revision 无效')
  if (!nonEmptyString(review.prd_revision, 128)) return fail('PRD_REVISION_INVALID', 'prd_revision 无效')
  if (!VERDICTS.has(/** @type {string} */ (review.verdict))) return fail('VERDICT_INVALID', 'verdict 无效')
  if (!Array.isArray(review.findings)) return fail('FINDINGS_INVALID', 'findings 必须是数组')
  if (!isoDateTime(review.reviewed_at)) return fail('REVIEWED_AT_INVALID', 'reviewed_at 无效')

  for (const finding of review.findings) {
    const checked = reviewFinding(finding)
    if (!checked.ok) return checked
  }

  if (review.verdict === 'passed') {
    const blocking = review.findings.filter((f) => /** @type {{ blocking: boolean }} */ (f).blocking)
    if (blocking.length > 0) {
      return fail('PASSED_WITH_BLOCKING', 'passed 不得包含 blocking=true 的 finding')
    }
  }

  if (review.verdict === 'changes_required' && review.findings.length < 1) {
    return fail('CHANGES_REQUIRED_EMPTY', 'changes_required 至少一条 finding')
  }

  if (review.verdict === 'blocked' && !nonEmptyString(review.summary, 4000)) {
    return fail('BLOCKED_SUMMARY_REQUIRED', 'blocked 必须有 summary')
  }

  if (review.out_of_scope_suggestions !== undefined) {
    if (!Array.isArray(review.out_of_scope_suggestions)) {
      return fail('OUT_OF_SCOPE_INVALID', 'out_of_scope_suggestions 必须是数组')
    }
    for (const item of review.out_of_scope_suggestions) {
      if (!item || typeof item !== 'object') return fail('OUT_OF_SCOPE_INVALID', '建议项无效')
      if (!nonEmptyString(/** @type {Record<string, unknown>} */ (item).description)) {
        return fail('OUT_OF_SCOPE_INVALID', '建议项缺少 description')
      }
    }
  }

  if (review.ledger_refs !== undefined) {
    if (!Array.isArray(review.ledger_refs)) return fail('LEDGER_REFS_INVALID', 'ledger_refs 必须是数组')
    for (const item of review.ledger_refs) {
      if (!item || typeof item !== 'object') return fail('LEDGER_REFS_INVALID', 'ledger_refs 项无效')
      const row = /** @type {Record<string, unknown>} */ (item)
      if (row.kind !== 'acceptance_record' && row.kind !== 'error_book') {
        return fail('LEDGER_REFS_INVALID', 'ledger kind 无效')
      }
      if (!nonEmptyString(row.id)) return fail('LEDGER_REFS_INVALID', 'ledger id 无效')
    }
  }

  return { ok: true, value: review }
}

/**
 * Host policy for the acceptance ledger. blocked must never increment violations.
 * @param {'passed' | 'changes_required' | 'blocked'} verdict
 */
export function ledgerPolicyForVerdict(verdict) {
  if (verdict === 'passed') {
    return { recordAcceptance: true, acceptanceVerdict: 'pass', writeErrorBook: false, countViolation: false }
  }
  if (verdict === 'changes_required') {
    return { recordAcceptance: true, acceptanceVerdict: 'fail', writeErrorBook: true, countViolation: true }
  }
  return { recordAcceptance: false, acceptanceVerdict: null, writeErrorBook: false, countViolation: false }
}
