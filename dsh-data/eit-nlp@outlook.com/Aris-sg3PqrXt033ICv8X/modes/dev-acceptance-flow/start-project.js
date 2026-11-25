import path from 'node:path'
import {
  DEFAULT_PRD_RELPATH,
  prdIdSuffix,
  resolveActivePrd,
  resolvePrdCandidate,
} from './active-prd.js'
import { addManagedRoot } from './managed-roots.js'
import {
  appendJournal,
  archiveFlowRoot,
  ensureFlowDirs,
  flowPaths,
  initFlowStore,
  readJsonIfExists,
  writeJsonAtomic,
  writeOutboxAction,
} from './store.js'

export const PENDING_START_FILE = 'pending-start.json'
export const PENDING_START_DONE_FILE = 'pending-start.done.json'

/**
 * @param {string} projectRoot
 */
export function pendingStartPath(projectRoot) {
  return path.join(flowPaths(projectRoot).flowRoot, PENDING_START_FILE)
}

/**
 * @param {string} projectRoot
 * @param {string} [relativeOrAbsolute]
 */
export async function resolvePrdPath(projectRoot, relativeOrAbsolute = DEFAULT_PRD_RELPATH) {
  const resolved = resolvePrdCandidate(projectRoot, relativeOrAbsolute)
  const { access } = await import('node:fs/promises')
  await access(resolved.prd_path)
  return resolved.prd_path
}

/**
 * @param {string} projectRoot
 * @param {string} [explicitId]
 * @param {string} [prdRelpath]
 */
export function defaultProjectId(projectRoot, explicitId, prdRelpath) {
  if (typeof explicitId === 'string' && explicitId.trim() !== '') return explicitId.trim()
  const base = path.basename(path.resolve(projectRoot))
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project'
  const suffix = prdIdSuffix(prdRelpath)
  return suffix ? `${base}-${suffix}` : base
}

/**
 * CLI side: register the root and drop a pending-start request for the bridge.
 *
 * @param {object} input
 * @param {string} input.projectRoot
 * @param {string} [input.project_id]
 * @param {string} [input.prd]
 * @param {number} [input.max_remediation_rounds]
 * @param {boolean} [input.prompt]
 * @param {boolean} [input.force]
 * @param {string} [input.dev_preset]
 * @param {string} [input.acc_preset]
 * @param {string} [input.managedRootsFile]
 */
export async function requestProjectStart(input) {
  const projectRoot = path.resolve(input.projectRoot)
  const active = await resolveActivePrd({
    projectRoot,
    prd: typeof input.prd === 'string' ? input.prd : undefined,
  })
  const paths = flowPaths(projectRoot)
  await ensureFlowDirs(paths)

  const existing = await readJsonIfExists(paths.flow)
  if (existing && input.force !== true) {
    throw new Error(`FLOW_EXISTS: ${paths.flow} 已存在；重新开工请加 --force`)
  }

  const request = {
    schemaVersion: 1,
    project_id: defaultProjectId(projectRoot, input.project_id, active.prd_relpath),
    project_root: projectRoot,
    prd_path: active.prd_path,
    prd_relpath: active.prd_relpath,
    prd_source: active.source,
    max_remediation_rounds: Number.isInteger(input.max_remediation_rounds)
      ? input.max_remediation_rounds
      : 3,
    prompt: input.prompt !== false,
    force: input.force === true,
    dev_preset: typeof input.dev_preset === 'string' && input.dev_preset.trim() !== ''
      ? input.dev_preset
      : 'development',
    acc_preset: typeof input.acc_preset === 'string' && input.acc_preset.trim() !== ''
      ? input.acc_preset
      : 'aris-acceptance',
    requested_at: new Date().toISOString(),
  }

  await writeJsonAtomic(pendingStartPath(projectRoot), request)
  const managedRoots = await addManagedRoot(projectRoot, input.managedRootsFile)

  return {
    status: 'pending',
    pending_start: pendingStartPath(projectRoot),
    managed_roots: managedRoots,
    request,
  }
}

/**
 * Bridge side: create the development session only, init `.flow`, optional kickoff.
 * Acceptance session stays null until the first submission (see ensureAcceptanceSession).
 *
 * @param {object} input
 * @param {string} input.projectRoot
 * @param {{ create: Function, rename?: Function }} input.sessionController
 * @param {(message: string) => void} [input.log]
 */
export async function processPendingStart(input) {
  const projectRoot = path.resolve(input.projectRoot)
  const paths = flowPaths(projectRoot)
  const pendingFile = pendingStartPath(projectRoot)
  const request = await readJsonIfExists(pendingFile, null)
  if (!request) return { processed: false, reason: 'no_pending_start' }

  const log = input.log ?? (() => {})
  const sessionController = input.sessionController
  if (!sessionController || typeof sessionController.create !== 'function') {
    throw new Error('processPendingStart 需要带 create() 的 sessionController')
  }

  const force = request.force === true
  const existing = await readJsonIfExists(paths.flow)
  if (existing && !force) {
    await archivePendingStart(paths, request, {
      skipped: true,
      reason: 'flow_exists',
    })
    return { processed: false, reason: 'flow_exists', flow: existing }
  }
  if (existing && force) {
    const archived = await archiveFlowRoot(projectRoot)
    log(
      `start: force archived previous .flow`
      + (archived.archive_dir ? ` → ${archived.archive_dir}` : ''),
    )
  }

  const prdRel = typeof request.prd_relpath === 'string' && request.prd_relpath.trim() !== ''
    ? request.prd_relpath
    : (typeof request.prd_path === 'string'
      ? resolvePrdCandidate(projectRoot, request.prd_path).prd_relpath
      : DEFAULT_PRD_RELPATH)
  const prdPath = typeof request.prd_path === 'string' && request.prd_path.trim() !== ''
    ? request.prd_path
    : path.join(projectRoot, prdRel)
  const projectId = defaultProjectId(
    projectRoot,
    /** @type {string} */ (request.project_id),
    prdRel,
  )
  const cwd = projectRoot
  const devPreset = typeof request.dev_preset === 'string' ? request.dev_preset : 'development'

  log(`start: creating development session for ${projectId} at ${cwd} (prd=${prdRel})`)
  const development = await sessionController.create({
    cwd,
    agentPreset: devPreset,
  })

  const developmentSessionId = String(development.sessionId ?? development.session_id)

  if (typeof sessionController.rename === 'function') {
    try {
      await sessionController.rename({
        sessionId: developmentSessionId,
        title: `研发 · ${projectId}`,
      })
    } catch {
      // Title is cosmetic; continue.
    }
  }

  const boot = await initFlowStore({
    projectRoot,
    project_id: projectId,
    development_session_id: developmentSessionId,
    acceptance_session_id: null,
    prd_relpath: prdRel,
    max_remediation_rounds: typeof request.max_remediation_rounds === 'number'
      ? request.max_remediation_rounds
      : 3,
    force,
  })

  let kickoffOutbox = null
  if (request.prompt !== false) {
    kickoffOutbox = await writeOutboxAction(paths, {
      id: `prompt-dev-start-${Date.now()}`,
      type: 'prompt_development_start',
      project_id: projectId,
      development_session_id: developmentSessionId,
      project_root: projectRoot,
      prd_path: prdPath,
      prd_relpath: prdRel,
      created_at: new Date().toISOString(),
    })
  }

  await appendJournal(paths, {
    at: new Date().toISOString(),
    kind: 'project_start',
    project_id: projectId,
    development_session_id: developmentSessionId,
    acceptance_session_id: null,
    prd_path: prdPath,
    prd_relpath: prdRel,
    kickoff: Boolean(kickoffOutbox),
  })

  await archivePendingStart(paths, request, {
    development_session_id: developmentSessionId,
    acceptance_session_id: null,
    kickoff_outbox: kickoffOutbox,
  })

  log(`start: ready ${projectId} dev=${developmentSessionId} (acceptance deferred)`)
  return {
    processed: true,
    created: boot.created,
    flow: boot.flow,
    development_session_id: developmentSessionId,
    acceptance_session_id: null,
    kickoff_outbox: kickoffOutbox,
  }
}

/**
 * @param {ReturnType<typeof flowPaths>} paths
 * @param {Record<string, unknown>} request
 * @param {Record<string, unknown>} result
 */
async function archivePendingStart(paths, request, result) {
  await ensureFlowDirs(paths)
  const done = path.join(paths.flowRoot, PENDING_START_DONE_FILE)
  await writeJsonAtomic(done, {
    ...request,
    completed_at: new Date().toISOString(),
    result,
  })
  const pending = path.join(paths.flowRoot, PENDING_START_FILE)
  try {
    const { unlink } = await import('node:fs/promises')
    await unlink(pending)
  } catch (error) {
    if (!(error && /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT')) throw error
  }
}
