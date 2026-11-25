import { rename } from 'node:fs/promises'
import path from 'node:path'
import { isPlaceholderDevelopmentSessionId } from './auto-bind-development.js'
import { buildPromptForAction } from './prompt-templates.js'
import { createFileSessionDriver } from './session-driver.js'
import {
  appendJournal,
  ensureFlowDirs,
  flowPaths,
  listJsonFiles,
  loadFlowStore,
  readJson,
  readJsonIfExists,
} from './store.js'

/**
 * @param {ReturnType<typeof flowPaths>} paths
 * @param {string} submissionId
 */
async function loadSubmission(paths, submissionId) {
  if (typeof submissionId !== 'string' || submissionId.trim() === '') return null
  return readJsonIfExists(path.join(paths.submissions, `${submissionId}.json`), null)
}

/**
 * @param {ReturnType<typeof flowPaths>} paths
 * @param {string} reviewId
 */
async function loadReview(paths, reviewId) {
  if (typeof reviewId !== 'string' || reviewId.trim() === '') return null
  return readJsonIfExists(path.join(paths.reviews, `${reviewId}.json`), null)
}

/**
 * @param {ReturnType<typeof flowPaths>} paths
 * @param {string} file
 */
async function archiveOutboxFile(paths, file) {
  await ensureFlowDirs(paths)
  const target = path.join(paths.outboxDone, path.basename(file))
  await rename(file, target)
  return target
}

/**
 * Consume pending `.flow/outbox` actions through a session driver.
 *
 * @param {object} input
 * @param {string} input.projectRoot
 * @param {{ name: string, prompt: Function }} [input.driver]
 * @param {(message: string) => void} [input.log]
 * @param {boolean} [input.deliverUserNotices] deliver await_user / needs_manual / reject notices
 */
export async function consumeOutboxOnce(input) {
  const paths = flowPaths(input.projectRoot)
  await ensureFlowDirs(paths)
  const log = input.log ?? (() => {})
  const driver = input.driver ?? createFileSessionDriver({ dispatchDir: paths.dispatch })
  const deliverUserNotices = input.deliverUserNotices !== false

  let store
  try {
    store = await loadFlowStore(paths)
  } catch {
    store = { flow: null, findings: null }
  }

  const files = await listJsonFiles(paths.outbox)
  /** @type {Array<Record<string, unknown>>} */
  const outcomes = []

  for (const file of files) {
    const action = await readJson(file)
    const type = action.type

    const needsSession = type === 'prompt_acceptance'
      || type === 'prompt_development_remediation'
      || type === 'prompt_development_delivery'
      || type === 'prompt_development_start'
    const isNotice = type === 'await_user'
      || type === 'needs_manual'
      || type === 'submission_rejected'
      || type === 'review_rejected'

    if (isNotice && !deliverUserNotices) {
      outcomes.push({ file, action_id: action.id, skipped: true, reason: 'user_notice_disabled' })
      continue
    }

    const submission = await loadSubmission(paths, /** @type {string} */ (action.submission_id))
    const review = await loadReview(paths, /** @type {string} */ (action.review_id))
    const prompt = buildPromptForAction(action, {
      projectRoot: paths.projectRoot,
      submission,
      review,
      findings: store.findings,
      flow: store.flow,
    })

    if (!prompt) {
      outcomes.push({ file, action_id: action.id, skipped: true, reason: 'no_prompt_template' })
      continue
    }

    if (needsSession && !prompt.session_id) {
      const error = { code: 'SESSION_ID_MISSING', message: `动作 ${action.id} 缺少目标 session_id` }
      await appendJournal(paths, {
        at: new Date().toISOString(),
        kind: 'outbox_delivery_failed',
        action_id: action.id,
        type,
        ...error,
      })
      outcomes.push({ file, action_id: action.id, ok: false, error })
      continue
    }

    if (
      needsSession
      && prompt.target === 'development'
      && isPlaceholderDevelopmentSessionId(prompt.session_id)
    ) {
      outcomes.push({
        file,
        action_id: action.id,
        skipped: true,
        reason: 'awaiting_development_rebind',
        session_id: prompt.session_id,
      })
      continue
    }

    try {
      const delivery = await driver.prompt(prompt)
      const archived = await archiveOutboxFile(paths, file)
      await appendJournal(paths, {
        at: new Date().toISOString(),
        kind: 'outbox_delivered',
        action_id: action.id,
        type,
        target: prompt.target,
        session_id: prompt.session_id,
        driver: driver.name,
        delivery,
        archived,
      })
      log(`delivered ${action.id} → ${prompt.target} (${prompt.session_id ?? 'user'})`)
      outcomes.push({
        file,
        action_id: action.id,
        ok: true,
        target: prompt.target,
        session_id: prompt.session_id,
        delivery,
        archived,
        prompt_text: prompt.text,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await appendJournal(paths, {
        at: new Date().toISOString(),
        kind: 'outbox_delivery_failed',
        action_id: action.id,
        type,
        message,
      })
      outcomes.push({
        file,
        action_id: action.id,
        ok: false,
        error: { code: 'DRIVER_FAILED', message },
      })
    }
  }

  return { paths, driver: driver.name, outcomes }
}

/**
 * Host cycle: apply submissions/reviews, then deliver outbox actions.
 *
 * @param {object} input
 * @param {string} input.projectRoot
 * @param {{ name: string, prompt: Function }} [input.driver]
 * @param {(message: string) => void} [input.log]
 */
export async function runHostCycle(input) {
  const { runHostOnce } = await import('./host-loop.js')
  const host = await runHostOnce({
    projectRoot: input.projectRoot,
    log: input.log,
  })
  const outbox = await consumeOutboxOnce({
    projectRoot: input.projectRoot,
    driver: input.driver,
    log: input.log,
  })
  return { host, outbox, flow: host.flow, findings: host.findings }
}
