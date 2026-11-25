import { watch } from 'node:fs'
import path from 'node:path'
import { loadHostSeen, rememberRejectedEvent } from './host-seen.js'
import { applyReview, applySubmission } from './transitions.js'
import {
  appendJournal,
  flowPaths,
  listJsonFiles,
  loadFlowStore,
  readJson,
  saveFlowState,
  writeOutboxAction,
} from './store.js'

/**
 * @param {Record<string, unknown>} flow
 * @param {string} eventId
 */
function seenEvent(flow, eventId) {
  if (flow.last_event_id === eventId) return true
  return Array.isArray(flow.processed_event_ids) && flow.processed_event_ids.includes(eventId)
}

/**
 * @param {ReturnType<typeof flowPaths>} paths
 * @param {string} submissionId
 */
async function loadSubmissionById(paths, submissionId) {
  const file = path.join(paths.submissions, `${submissionId}.json`)
  return readJson(file)
}

/**
 * @param {object} input
 * @param {ReturnType<typeof flowPaths>} input.paths
 * @param {Record<string, unknown>} input.flow
 * @param {Record<string, unknown>} input.findings
 * @param {{ rejected_event_ids: string[] }} input.seen
 * @param {string} input.file
 * @param {(message: string) => void} [input.log]
 */
async function processSubmissionFile(input) {
  const { paths, log = () => {} } = input
  let flow = input.flow
  let findings = input.findings
  let seen = input.seen

  const submission = await readJson(input.file)
  const eventId = typeof submission.event_id === 'string' ? submission.event_id : ''
  if (eventId && (seenEvent(flow, eventId) || seen.rejected_event_ids.includes(eventId))) {
    return { flow, findings, seen, handled: false, ignored: true }
  }

  const result = applySubmission({ flow, submission, findings })
  if (!result.ok) {
    seen = await rememberRejectedEvent(paths, seen, eventId)
    await appendJournal(paths, {
      at: new Date().toISOString(),
      kind: 'submission_rejected',
      file: path.basename(input.file),
      code: result.code,
      message: result.message,
      details: result.details ?? {},
    })
    await writeOutboxAction(paths, {
      id: `reject-sub-${eventId || Date.now()}`,
      type: 'submission_rejected',
      code: result.code,
      message: result.message,
      details: result.details ?? {},
      submission_id: submission.submission_id ?? null,
      at: new Date().toISOString(),
    })
    return { flow, findings, seen, handled: false, error: result }
  }

  if (result.ignored) {
    return { flow, findings, seen, handled: false, ignored: true }
  }

  flow = /** @type {Record<string, unknown>} */ (result.flow)
  findings = /** @type {Record<string, unknown>} */ (result.findings)
  await saveFlowState(paths, flow, findings)

  const action = {
    id: `prompt-acceptance-${submission.submission_id}`,
    type: 'prompt_acceptance',
    action: result.action,
    project_id: flow.project_id,
    development_session_id: flow.development_session_id,
    acceptance_session_id: flow.acceptance_session_id,
    submission_id: submission.submission_id,
    submission_file: path.relative(paths.projectRoot, input.file),
    readonly_tree_ref: submission.readonly_tree_ref,
    flow_status: flow.flow_status,
    at: flow.updated_at,
  }
  await writeOutboxAction(paths, action)
  await appendJournal(paths, {
    at: flow.updated_at,
    kind: 'submission_accepted',
    submission_id: submission.submission_id,
    event_id: submission.event_id,
    flow_status: flow.flow_status,
  })
  log(`accepted submission ${submission.submission_id} → ${flow.flow_status}`)
  return { flow, findings, seen, handled: true, result, outbox: action }
}

/**
 * @param {object} input
 * @param {ReturnType<typeof flowPaths>} input.paths
 * @param {Record<string, unknown>} input.flow
 * @param {Record<string, unknown>} input.findings
 * @param {{ rejected_event_ids: string[] }} input.seen
 * @param {string} input.file
 * @param {(message: string) => void} [input.log]
 */
/**
 * Stable reject key even when review.event_id is missing/invalid.
 * @param {Record<string, unknown>} review
 * @param {string} file
 */
function reviewRejectionKey(review, file) {
  const eventId = typeof review.event_id === 'string' ? review.event_id.trim() : ''
  if (eventId) return eventId
  const reviewId = typeof review.review_id === 'string' && review.review_id.trim() !== ''
    ? review.review_id.trim()
    : path.basename(file)
  return `invalid-review:${reviewId}`
}

async function processReviewFile(input) {
  const { paths, log = () => {} } = input
  let flow = input.flow
  let findings = input.findings
  let seen = input.seen

  const review = await readJson(input.file)
  const eventId = typeof review.event_id === 'string' ? review.event_id : ''
  const rejectKey = reviewRejectionKey(review, input.file)
  if (
    (eventId && (seenEvent(flow, eventId) || seen.rejected_event_ids.includes(eventId)))
    || seen.rejected_event_ids.includes(rejectKey)
  ) {
    return { flow, findings, seen, handled: false, ignored: true }
  }

  const submissionId = review.submission_id
  if (typeof submissionId !== 'string' || submissionId.trim() === '') {
    const error = { ok: false, code: 'SUBMISSION_ID_INVALID', message: 'review 缺少 submission_id' }
    seen = await rememberRejectedEvent(paths, seen, rejectKey)
    await appendJournal(paths, {
      at: new Date().toISOString(),
      kind: 'review_rejected',
      file: path.basename(input.file),
      code: error.code,
      message: error.message,
    })
    return { flow, findings, seen, handled: false, error }
  }

  let submission
  try {
    submission = await loadSubmissionById(paths, submissionId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const rejected = {
      ok: false,
      code: 'SUBMISSION_MISSING',
      message: `找不到 submission ${submissionId}: ${message}`,
    }
    seen = await rememberRejectedEvent(paths, seen, rejectKey)
    await appendJournal(paths, {
      at: new Date().toISOString(),
      kind: 'review_rejected',
      file: path.basename(input.file),
      code: rejected.code,
      message: rejected.message,
    })
    return { flow, findings, seen, handled: false, error: rejected }
  }

  const result = applyReview({ flow, submission, review, findings })
  if (!result.ok) {
    seen = await rememberRejectedEvent(paths, seen, rejectKey)
    await appendJournal(paths, {
      at: new Date().toISOString(),
      kind: 'review_rejected',
      file: path.basename(input.file),
      code: result.code,
      message: result.message,
      details: result.details ?? {},
    })
    await writeOutboxAction(paths, {
      id: `reject-rev-${rejectKey.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)}`,
      type: 'review_rejected',
      code: result.code,
      message: result.message,
      details: result.details ?? {},
      review_id: review.review_id ?? null,
      at: new Date().toISOString(),
    })
    return { flow, findings, seen, handled: false, error: result }
  }

  if (result.ignored) {
    return { flow, findings, seen, handled: false, ignored: true }
  }

  flow = /** @type {Record<string, unknown>} */ (result.flow)
  findings = /** @type {Record<string, unknown>} */ (result.findings)
  await saveFlowState(paths, flow, findings)

  /** @type {Record<string, unknown>} */
  let action
  if (result.action === 'acceptance_passed') {
    action = {
      id: `prompt-delivery-${review.review_id}`,
      type: 'prompt_development_delivery',
      action: result.action,
      project_id: flow.project_id,
      development_session_id: flow.development_session_id,
      review_id: review.review_id,
      submission_id: review.submission_id,
      flow_status: flow.flow_status,
      ledgerPolicy: result.ledgerPolicy,
      at: flow.updated_at,
    }
  } else if (result.action === 'remediating') {
    action = {
      id: `prompt-remediation-${review.review_id}`,
      type: 'prompt_development_remediation',
      action: result.action,
      project_id: flow.project_id,
      development_session_id: flow.development_session_id,
      review_id: review.review_id,
      submission_id: review.submission_id,
      remediation_round: flow.remediation_round,
      remediationTasks: result.remediationTasks,
      flow_status: flow.flow_status,
      ledgerPolicy: result.ledgerPolicy,
      at: flow.updated_at,
    }
  } else if (result.action === 'acceptance_blocked') {
    action = {
      id: `await-user-${review.review_id}`,
      type: 'await_user',
      action: result.action,
      project_id: flow.project_id,
      waiting_reason: flow.waiting_reason,
      waiting_detail: flow.waiting_detail,
      review_id: review.review_id,
      flow_status: flow.flow_status,
      ledgerPolicy: result.ledgerPolicy,
      at: flow.updated_at,
    }
  } else {
    action = {
      id: `needs-manual-${review.review_id}`,
      type: 'needs_manual',
      action: result.action,
      project_id: flow.project_id,
      review_id: review.review_id,
      remediationTasks: result.remediationTasks,
      flow_status: flow.flow_status,
      waiting_reason: flow.waiting_reason,
      ledgerPolicy: result.ledgerPolicy,
      at: flow.updated_at,
    }
  }

  await writeOutboxAction(paths, action)
  await appendJournal(paths, {
    at: flow.updated_at,
    kind: 'review_accepted',
    review_id: review.review_id,
    event_id: review.event_id,
    verdict: review.verdict,
    flow_status: flow.flow_status,
    action: result.action,
  })
  log(`accepted review ${review.review_id} (${review.verdict}) → ${flow.flow_status}`)
  return { flow, findings, seen, handled: true, result, outbox: action }
}

/**
 * Scan existing submission/review files once and apply any not-yet-processed events.
 * @param {object} input
 * @param {string} input.projectRoot
 * @param {(message: string) => void} [input.log]
 */
export async function runHostOnce(input) {
  const paths = flowPaths(input.projectRoot)
  const log = input.log ?? (() => {})
  let { flow, findings } = await loadFlowStore(paths)
  let seen = await loadHostSeen(paths)
  /** @type {Array<Record<string, unknown>>} */
  const outcomes = []

  const submissionFiles = (await listJsonFiles(paths.submissions)).filter((file) => {
    const base = path.basename(file)
    // Only top-level submission documents; ignore companion manifests named beside them.
    return !base.includes('.artifacts.') && !base.includes('.requirements.') && !base.includes('.remediation.')
  })
  for (const file of submissionFiles) {
    const outcome = await processSubmissionFile({ paths, flow, findings, seen, file, log })
    flow = outcome.flow
    findings = outcome.findings
    seen = outcome.seen
    outcomes.push({ kind: 'submission', file, ...summarize(outcome) })
  }

  // Reload after submissions so reviews see the latest active_submission_id.
  ;({ flow, findings } = await loadFlowStore(paths))

  const reviewFiles = await listJsonFiles(paths.reviews)
  for (const file of reviewFiles) {
    const outcome = await processReviewFile({ paths, flow, findings, seen, file, log })
    flow = outcome.flow
    findings = outcome.findings
    seen = outcome.seen
    outcomes.push({ kind: 'review', file, ...summarize(outcome) })
  }

  return { paths, flow, findings, seen, outcomes }
}

/**
 * @param {Record<string, unknown>} outcome
 */
function summarize(outcome) {
  return {
    handled: Boolean(outcome.handled),
    ignored: Boolean(outcome.ignored),
    error: outcome.error
      ? {
          code: /** @type {{ code?: string }} */ (outcome.error).code,
          message: /** @type {{ message?: string }} */ (outcome.error).message,
        }
      : null,
    action: outcome.outbox
      ? /** @type {{ type?: string }} */ (outcome.outbox).type
      : outcome.result
        ? /** @type {{ action?: string }} */ (outcome.result).action
        : null,
  }
}

/**
 * Poll `.flow/submissions` and `.flow/reviews`, apply the validator, persist state, write outbox.
 * First version uses interval polling (plus optional fs.watch hints) so restarts remain simple.
 * @param {object} input
 * @param {string} input.projectRoot
 * @param {number} [input.intervalMs]
 * @param {(message: string) => void} [input.log]
 * @param {AbortSignal} [input.signal]
 */
export async function startHostLoop(input) {
  const paths = flowPaths(input.projectRoot)
  const log = input.log ?? console.log
  const intervalMs = input.intervalMs ?? 1000
  const signal = input.signal

  let closed = false
  let chain = Promise.resolve()
  let timer = /** @type {NodeJS.Timeout | null} */ (null)

  const tick = () => {
    if (closed) return chain
    chain = chain.then(async () => {
      if (closed) return null
      try {
        return await runHostOnce({ projectRoot: paths.projectRoot, log })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log(`host-loop error: ${message}`)
        await appendJournal(paths, {
          at: new Date().toISOString(),
          kind: 'host_error',
          message,
        }).catch(() => {})
        return null
      }
    })
    return chain
  }

  await tick()

  timer = setInterval(() => {
    void tick()
  }, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()

  const watchers = []
  try {
    const subWatcher = watch(paths.submissions, () => { void tick() })
    const revWatcher = watch(paths.reviews, () => { void tick() })
    if (typeof subWatcher.unref === 'function') subWatcher.unref()
    if (typeof revWatcher.unref === 'function') revWatcher.unref()
    watchers.push(subWatcher, revWatcher)
  } catch {
    // Directory may appear later; interval polling still covers it.
  }

  const stop = async () => {
    if (closed) return
    closed = true
    if (timer) clearInterval(timer)
    for (const watcher of watchers) watcher.close()
    await chain
  }

  if (signal) {
    if (signal.aborted) await stop()
    else signal.addEventListener('abort', () => { void stop() }, { once: true })
  }

  return {
    paths,
    stop,
    runOnce: () => tick(),
  }
}
