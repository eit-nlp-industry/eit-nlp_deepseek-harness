import {
  applyReviewToFindings,
  emptyFindingsLedger,
  markFindingsPendingRetest,
  openBlockingFindings,
  validateFindingsLedger,
} from './findings.js'
import {
  fail,
  ledgerPolicyForVerdict,
  validateFlow,
  validateReview,
  validateSubmission,
} from './validate.js'

const PROCESSED_WINDOW = 200

/**
 * @param {Record<string, unknown>} flow
 * @param {string} eventId
 */
function alreadyProcessed(flow, eventId) {
  const ids = Array.isArray(flow.processed_event_ids) ? flow.processed_event_ids : []
  return ids.includes(eventId) || flow.last_event_id === eventId
}

/**
 * @param {Record<string, unknown>} flow
 * @param {string} eventId
 * @param {string} at
 * @param {Partial<Record<string, unknown>>} patch
 */
function commit(flow, eventId, at, patch) {
  const prev = Array.isArray(flow.processed_event_ids) ? flow.processed_event_ids : []
  const processed = [...prev.filter((id) => id !== eventId), eventId].slice(-PROCESSED_WINDOW)
  return {
    ...flow,
    ...patch,
    last_event_id: eventId,
    processed_event_ids: processed,
    updated_at: at,
  }
}

/**
 * @param {Record<string, unknown>} flow
 */
function requireValidFlow(flow) {
  const checked = validateFlow(flow)
  if (!checked.ok) return checked
  return { ok: true, value: /** @type {Record<string, unknown>} */ (checked.value) }
}

/**
 * Create the initial coordination record after both sessions exist.
 * @param {object} input
 * @param {string} input.project_id
 * @param {string} input.project_root
 * @param {string} input.development_session_id
 * @param {string} input.acceptance_session_id
 * @param {number} [input.max_remediation_rounds]
 * @param {string} [input.event_id]
 * @param {string} [input.at]
 */
export function bootstrapFlow(input) {
  const at = input.at ?? new Date().toISOString()
  const eventId = input.event_id ?? `evt-bootstrap-${at}`
  const flow = {
    schemaVersion: 1,
    project_id: input.project_id,
    project_root: input.project_root,
    development_session_id: input.development_session_id,
    acceptance_session_id: input.acceptance_session_id,
    flow_status: 'developing',
    active_submission_id: null,
    active_review_id: null,
    remediation_round: 0,
    max_remediation_rounds: input.max_remediation_rounds ?? 3,
    waiting_reason: 'none',
    waiting_detail: '',
    last_event_id: eventId,
    processed_event_ids: [eventId],
    updated_at: at,
  }
  const checked = validateFlow(flow)
  if (!checked.ok) return checked
  return {
    ok: true,
    flow,
    findings: emptyFindingsLedger(input.project_id),
    action: 'bootstrap',
  }
}

/**
 * @param {object} input
 * @param {Record<string, unknown>} input.flow
 * @param {'prd_clarification' | 'acceptance_blocked' | 'environment' | 'other'} input.waiting_reason
 * @param {string} [input.waiting_detail]
 * @param {string} [input.event_id]
 * @param {string} [input.at]
 */
export function applyAwaitUser(input) {
  const flowCheck = requireValidFlow(input.flow)
  if (!flowCheck.ok) return flowCheck
  const flow = flowCheck.value
  const eventId = input.event_id ?? `evt-await-user-${input.at ?? Date.now()}`
  if (alreadyProcessed(flow, eventId)) {
    return { ok: true, ignored: true, reason: 'duplicate_event', flow, action: 'noop' }
  }

  const from = flow.flow_status
  if (from !== 'developing' && from !== 'remediating' && from !== 'awaiting_acceptance') {
    return fail('TRANSITION_REJECTED', `不能从 ${from} 进入 awaiting_user`, { from, to: 'awaiting_user' })
  }
  // awaiting_acceptance → awaiting_user is reserved for blocked reviews via applyReview.
  if (from === 'awaiting_acceptance') {
    return fail('TRANSITION_REJECTED', '验收等待中请通过 blocked review 进入 awaiting_user', { from })
  }

  const next = commit(flow, eventId, input.at ?? new Date().toISOString(), {
    flow_status: 'awaiting_user',
    waiting_reason: input.waiting_reason,
    waiting_detail: input.waiting_detail ?? '',
  })
  return { ok: true, flow: next, action: 'await_user' }
}

/**
 * Resume development after user clarification (not after acceptance blocked — that needs a new submission).
 * @param {object} input
 * @param {Record<string, unknown>} input.flow
 * @param {string} [input.event_id]
 * @param {string} [input.at]
 */
export function applyUserResumed(input) {
  const flowCheck = requireValidFlow(input.flow)
  if (!flowCheck.ok) return flowCheck
  const flow = flowCheck.value
  const eventId = input.event_id ?? `evt-user-resumed-${input.at ?? Date.now()}`
  if (alreadyProcessed(flow, eventId)) {
    return { ok: true, ignored: true, reason: 'duplicate_event', flow, action: 'noop' }
  }
  if (flow.flow_status !== 'awaiting_user') {
    return fail('TRANSITION_REJECTED', `不能从 ${flow.flow_status} 恢复为 developing`, {
      from: flow.flow_status,
      to: 'developing',
    })
  }
  if (flow.waiting_reason === 'acceptance_blocked') {
    return fail(
      'MUST_RESUBMIT',
      '验收 blocked 后必须重新送验，不能直接回到 developing',
      { waiting_reason: flow.waiting_reason },
    )
  }
  const next = commit(flow, eventId, input.at ?? new Date().toISOString(), {
    flow_status: flow.remediation_round > 0 && flow.active_submission_id ? 'remediating' : 'developing',
    waiting_reason: 'none',
    waiting_detail: '',
  })
  return { ok: true, flow: next, action: 'user_resumed' }
}

/**
 * Accept a new submission and move to awaiting_acceptance.
 * @param {object} input
 * @param {Record<string, unknown>} input.flow
 * @param {Record<string, unknown>} input.submission
 * @param {Record<string, unknown>} [input.findings]
 */
export function applySubmission(input) {
  const flowCheck = requireValidFlow(input.flow)
  if (!flowCheck.ok) return flowCheck
  const flow = flowCheck.value

  const subCheck = validateSubmission(input.submission)
  if (!subCheck.ok) return subCheck
  const submission = /** @type {Record<string, unknown>} */ (subCheck.value)

  if (alreadyProcessed(flow, /** @type {string} */ (submission.event_id))) {
    return { ok: true, ignored: true, reason: 'duplicate_event', flow, action: 'noop', submission }
  }

  if (submission.project_id !== flow.project_id) {
    return fail('PROJECT_ID_MISMATCH', 'submission.project_id 与 flow 不一致', {
      flow: flow.project_id,
      submission: submission.project_id,
    })
  }

  if (submission.self_check_status !== 'passed') {
    return fail('SELF_CHECK_NOT_PASSED', '自检未通过，不能作为验证成功送验', {
      self_check_status: submission.self_check_status,
    })
  }

  const from = /** @type {string} */ (flow.flow_status)
  const allowedFrom = new Set(['developing', 'remediating', 'awaiting_user'])
  if (!allowedFrom.has(from)) {
    return fail('TRANSITION_REJECTED', `不能从 ${from} 送验`, { from, to: 'awaiting_acceptance' })
  }

  if (from === 'developing' && submission.kind !== 'initial') {
    return fail('SUBMISSION_KIND_MISMATCH', 'developing 状态只接受 initial 送验')
  }
  if (from === 'remediating' && submission.kind !== 'remediation') {
    return fail('SUBMISSION_KIND_MISMATCH', 'remediating 状态只接受 remediation 送验')
  }
  if (from === 'awaiting_user') {
    if (flow.waiting_reason === 'prd_clarification') {
      return fail('TRANSITION_REJECTED', '澄清未恢复前不能送验，先 applyUserResumed')
    }
    if (flow.waiting_reason === 'acceptance_blocked') {
      if (submission.kind !== 'remediation') {
        return fail('SUBMISSION_KIND_MISMATCH', '验收 blocked 后必须用 remediation 重新送验')
      }
    } else {
      return fail('TRANSITION_REJECTED', `awaiting_user(${flow.waiting_reason}) 不能直接送验`)
    }
  }

  if (submission.kind === 'remediation') {
    if (submission.previous_submission_id !== flow.active_submission_id) {
      return fail('PREVIOUS_SUBMISSION_MISMATCH', 'previous_submission_id 必须等于当前 active_submission_id', {
        active: flow.active_submission_id,
        previous: submission.previous_submission_id,
      })
    }
  }

  let findings = input.findings ?? emptyFindingsLedger(/** @type {string} */ (flow.project_id))
  const findingsCheck = validateFindingsLedger(findings)
  if (!findingsCheck.ok) return findingsCheck
  findings = /** @type {Record<string, unknown>} */ (findingsCheck.value)
  if (findings.project_id !== flow.project_id) {
    return fail('PROJECT_ID_MISMATCH', 'findings.project_id 与 flow 不一致')
  }

  const at = /** @type {string} */ (submission.submitted_at)
  if (submission.kind === 'remediation') {
    findings = markFindingsPendingRetest(
      findings,
      /** @type {string[]} */ (submission.addresses_finding_ids),
      /** @type {string} */ (submission.submission_id),
      at,
    )
  }

  const next = commit(flow, /** @type {string} */ (submission.event_id), at, {
    flow_status: 'awaiting_acceptance',
    active_submission_id: submission.submission_id,
    active_review_id: null,
    waiting_reason: 'awaiting_review',
    waiting_detail: '',
  })

  return {
    ok: true,
    flow: next,
    findings,
    submission,
    action: 'await_acceptance',
    ledgerPolicy: null,
  }
}

/**
 * Apply a structured review against the active submission.
 * @param {object} input
 * @param {Record<string, unknown>} input.flow
 * @param {Record<string, unknown>} input.submission
 * @param {Record<string, unknown>} input.review
 * @param {Record<string, unknown>} [input.findings]
 */
export function applyReview(input) {
  const flowCheck = requireValidFlow(input.flow)
  if (!flowCheck.ok) return flowCheck
  const flow = flowCheck.value

  const subCheck = validateSubmission(input.submission)
  if (!subCheck.ok) return subCheck
  const submission = /** @type {Record<string, unknown>} */ (subCheck.value)

  const reviewCheck = validateReview(input.review)
  if (!reviewCheck.ok) return reviewCheck
  const review = /** @type {Record<string, unknown>} */ (reviewCheck.value)

  if (alreadyProcessed(flow, /** @type {string} */ (review.event_id))) {
    return { ok: true, ignored: true, reason: 'duplicate_event', flow, action: 'noop', review }
  }

  if (flow.flow_status !== 'awaiting_acceptance') {
    return fail('TRANSITION_REJECTED', `不能从 ${flow.flow_status} 采纳验收结果`, {
      from: flow.flow_status,
    })
  }

  if (review.project_id !== flow.project_id || submission.project_id !== flow.project_id) {
    return fail('PROJECT_ID_MISMATCH', 'review/submission 与 flow 的 project_id 不一致')
  }

  if (review.submission_id !== flow.active_submission_id) {
    return fail('STALE_OR_FOREIGN_SUBMISSION', 'review.submission_id 必须等于 active_submission_id', {
      active: flow.active_submission_id,
      review: review.submission_id,
    })
  }

  if (submission.submission_id !== flow.active_submission_id) {
    return fail('SUBMISSION_NOT_ACTIVE', '提供的 submission 不是当前 active_submission_id')
  }

  if (review.reviewed_revision !== submission.code_revision) {
    return fail('REVISION_MISMATCH', 'reviewed_revision 必须等于 submission.code_revision', {
      reviewed_revision: review.reviewed_revision,
      code_revision: submission.code_revision,
    })
  }

  if (review.prd_revision !== submission.prd_revision) {
    return fail('PRD_REVISION_MISMATCH', 'review.prd_revision 必须等于 submission.prd_revision')
  }

  let findings = input.findings ?? emptyFindingsLedger(/** @type {string} */ (flow.project_id))
  const findingsCheck = validateFindingsLedger(findings)
  if (!findingsCheck.ok) return findingsCheck
  findings = /** @type {Record<string, unknown>} */ (findingsCheck.value)

  const merged = applyReviewToFindings(findings, review)
  if (!merged.ok) return merged
  findings = /** @type {Record<string, unknown>} */ (merged.value)

  const at = /** @type {string} */ (review.reviewed_at)
  const verdict = /** @type {string} */ (review.verdict)
  const ledgerPolicy = ledgerPolicyForVerdict(/** @type {'passed' | 'changes_required' | 'blocked'} */ (verdict))

  if (verdict === 'passed') {
    const next = commit(flow, /** @type {string} */ (review.event_id), at, {
      flow_status: 'acceptance_passed',
      active_review_id: review.review_id,
      waiting_reason: 'none',
      waiting_detail: '',
    })
    return {
      ok: true,
      flow: next,
      findings,
      review,
      action: 'acceptance_passed',
      ledgerPolicy,
      remediationTasks: [],
    }
  }

  if (verdict === 'blocked') {
    const next = commit(flow, /** @type {string} */ (review.event_id), at, {
      flow_status: 'awaiting_user',
      active_review_id: review.review_id,
      waiting_reason: 'acceptance_blocked',
      waiting_detail: review.summary ?? '',
    })
    return {
      ok: true,
      flow: next,
      findings,
      review,
      action: 'acceptance_blocked',
      ledgerPolicy,
      remediationTasks: [],
    }
  }

  // changes_required
  const round = /** @type {number} */ (flow.remediation_round)
  const max = /** @type {number} */ (flow.max_remediation_rounds)
  const remediationTasks = openBlockingFindings(findings)
    .filter((item) => item.status === 'open' || item.status === 'retested_failed')
    .map((item) => ({
      finding_id: item.finding_id,
      requirement_id: item.requirement_id,
      description: item.description,
      acceptance_condition: item.acceptance_condition,
    }))

  if (round >= max) {
    const next = commit(flow, /** @type {string} */ (review.event_id), at, {
      flow_status: 'needs_manual',
      active_review_id: review.review_id,
      waiting_reason: 'max_rounds_exceeded',
      waiting_detail: `已达自动整改上限 ${max} 轮`,
    })
    return {
      ok: true,
      flow: next,
      findings,
      review,
      action: 'needs_manual',
      ledgerPolicy,
      remediationTasks,
    }
  }

  const next = commit(flow, /** @type {string} */ (review.event_id), at, {
    flow_status: 'remediating',
    active_review_id: review.review_id,
    remediation_round: round + 1,
    waiting_reason: 'none',
    waiting_detail: '',
  })
  return {
    ok: true,
    flow: next,
    findings,
    review,
    action: 'remediating',
    ledgerPolicy,
    remediationTasks,
  }
}

/**
 * @param {object} input
 * @param {Record<string, unknown>} input.flow
 * @param {string} [input.event_id]
 * @param {string} [input.at]
 */
export function applyStartDelivery(input) {
  const flowCheck = requireValidFlow(input.flow)
  if (!flowCheck.ok) return flowCheck
  const flow = flowCheck.value
  const eventId = input.event_id ?? `evt-start-delivery-${input.at ?? Date.now()}`
  if (alreadyProcessed(flow, eventId)) {
    return { ok: true, ignored: true, reason: 'duplicate_event', flow, action: 'noop' }
  }
  if (flow.flow_status !== 'acceptance_passed') {
    return fail('TRANSITION_REJECTED', '只有 acceptance_passed 可以进入 delivering', {
      from: flow.flow_status,
    })
  }
  const next = commit(flow, eventId, input.at ?? new Date().toISOString(), {
    flow_status: 'delivering',
    waiting_reason: 'none',
    waiting_detail: '',
  })
  return { ok: true, flow: next, action: 'delivering' }
}

/**
 * @param {object} input
 * @param {Record<string, unknown>} input.flow
 * @param {string} [input.event_id]
 * @param {string} [input.at]
 */
export function applyDeliveryCompleted(input) {
  const flowCheck = requireValidFlow(input.flow)
  if (!flowCheck.ok) return flowCheck
  const flow = flowCheck.value
  const eventId = input.event_id ?? `evt-delivery-done-${input.at ?? Date.now()}`
  if (alreadyProcessed(flow, eventId)) {
    return { ok: true, ignored: true, reason: 'duplicate_event', flow, action: 'noop' }
  }
  if (flow.flow_status !== 'delivering') {
    return fail('TRANSITION_REJECTED', '只有 delivering 可以进入 delivery_completed', {
      from: flow.flow_status,
    })
  }
  const next = commit(flow, eventId, input.at ?? new Date().toISOString(), {
    flow_status: 'delivery_completed',
    waiting_reason: 'none',
    waiting_detail: '',
  })
  return { ok: true, flow: next, action: 'delivery_completed' }
}

/**
 * @param {object} input
 * @param {Record<string, unknown>} input.flow
 * @param {string} [input.detail]
 * @param {string} [input.event_id]
 * @param {string} [input.at]
 */
export function applyFailedTerminal(input) {
  const flowCheck = requireValidFlow(input.flow)
  if (!flowCheck.ok) return flowCheck
  const flow = flowCheck.value
  const eventId = input.event_id ?? `evt-failed-${input.at ?? Date.now()}`
  if (alreadyProcessed(flow, eventId)) {
    return { ok: true, ignored: true, reason: 'duplicate_event', flow, action: 'noop' }
  }
  const from = /** @type {string} */ (flow.flow_status)
  const allowed = new Set([
    'developing',
    'awaiting_acceptance',
    'remediating',
    'delivering',
    'awaiting_user',
  ])
  if (!allowed.has(from)) {
    return fail('TRANSITION_REJECTED', `不能从 ${from} 进入 failed_terminal`, { from })
  }
  const next = commit(flow, eventId, input.at ?? new Date().toISOString(), {
    flow_status: 'failed_terminal',
    waiting_reason: 'other',
    waiting_detail: input.detail ?? '',
  })
  return { ok: true, flow: next, action: 'failed_terminal' }
}
