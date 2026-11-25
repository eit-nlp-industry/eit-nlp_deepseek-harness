import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_PRD_RELPATH, prdIdSuffix } from './active-prd.js'
import {
  appendJournal,
  flowPaths,
  listJsonFiles,
  loadFlowStore,
  readJson,
  saveFlowState,
  writeJsonAtomic,
} from './store.js'

/**
 * Human title for host-created acceptance sessions.
 * @param {string} projectId
 * @param {string} [prdRelpath]
 */
export function acceptanceSessionTitle(projectId, prdRelpath) {
  const suffix = prdIdSuffix(prdRelpath)
  if (suffix) return `验收 · ${suffix}`
  return `验收 · ${projectId}`
}

/**
 * @param {string} cwd
 */
async function resolveRoot(cwd) {
  try {
    return await realpath(cwd)
  } catch {
    return path.resolve(cwd)
  }
}

/**
 * Prefer creating under the same Workspace entity as the project folder
 * so the UI groups acceptance with development (not under 未分组).
 * Falls back to cwd when no workspace matches.
 *
 * Matches symlink and canonical paths via realpath.
 *
 * @param {{ list?: Function } | null | undefined} workspaceRegistry
 * @param {string} projectRoot
 * @returns {Promise<string | null>}
 */
export async function resolveWorkspaceIdForRoot(workspaceRegistry, projectRoot) {
  if (!workspaceRegistry || typeof workspaceRegistry.list !== 'function') return null
  const target = await resolveRoot(projectRoot)
  for (const workspace of workspaceRegistry.list()) {
    if (typeof workspace?.path !== 'string' || workspace.path.trim() === '') continue
    const workspaceRoot = await resolveRoot(workspace.path)
    if (workspaceRoot === target) {
      return typeof workspace.id === 'string' ? workspace.id : null
    }
  }
  return null
}

/**
 * @param {{ list?: Function } | null | undefined} workspaceRegistry
 * @param {string} projectRoot
 * @returns {Promise<Set<string>>}
 */
async function workspaceSessionIdsForRoot(workspaceRegistry, projectRoot) {
  /** @type {Set<string>} */
  const ids = new Set()
  if (!workspaceRegistry || typeof workspaceRegistry.list !== 'function') return ids
  const target = await resolveRoot(projectRoot)
  for (const workspace of workspaceRegistry.list()) {
    if (typeof workspace?.path !== 'string' || workspace.path.trim() === '') continue
    const workspaceRoot = await resolveRoot(workspace.path)
    if (workspaceRoot !== target) continue
    const sessionIds = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []
    for (const id of sessionIds) {
      if (typeof id === 'string' && id.trim() !== '') ids.add(id)
    }
  }
  return ids
}

/**
 * @param {object} session
 */
function sessionIdentity(session) {
  const sessionId = String(session?.id ?? session?.sessionId ?? '')
  const cwd = typeof session?.header?.cwd === 'string' && session.header.cwd.trim() !== ''
    ? path.resolve(session.header.cwd)
    : (typeof session?.cwd === 'string' && session.cwd.trim() !== ''
      ? path.resolve(session.cwd)
      : null)
  const title = typeof session?.header?.title === 'string'
    ? session.header.title
    : (typeof session?.title === 'string' ? session.title : '')
  return { sessionId, cwd, title }
}

/**
 * Prefer an existing live acceptance session for this project root.
 * Rank:
 * 1. Sessions already listed on the matching Workspace (UI grouping)
 * 2. Non-auto titles (not `验收 · <projectId>`)
 * 3. More turns, then older createdAt
 *
 * @param {object} input
 * @param {string} input.projectRoot
 * @param {{ list?: Function }} [input.sessions]
 * @param {{ presetForSession?: Function }} [input.agentPresets]
 * @param {{ list?: Function }} [input.workspaceRegistry]
 * @param {string} [input.accPreset]
 * @param {string} [input.projectId]
 * @param {string} [input.prdRelpath]
 * @param {string | null} [input.currentId]
 */
export async function findLiveAcceptanceSession(input) {
  const sessions = input.sessions
  const agentPresets = input.agentPresets
  if (!sessions || typeof sessions.list !== 'function') return null
  if (!agentPresets || typeof agentPresets.presetForSession !== 'function') return null
  const accPreset = typeof input.accPreset === 'string' && input.accPreset.trim() !== ''
    ? input.accPreset
    : 'aris-acceptance'
  const targetRoot = await resolveRoot(input.projectRoot)
  const workspaceIds = await workspaceSessionIdsForRoot(input.workspaceRegistry, input.projectRoot)
  const expectedAutoTitle = typeof input.projectId === 'string' && input.projectId.trim() !== ''
    ? acceptanceSessionTitle(input.projectId, input.prdRelpath)
    : null

  /** @type {Array<{ sessionId: string, createdAt: number, turns: number, inWorkspace: boolean, autoCreated: boolean, isCurrent: boolean }>} */
  const matches = []
  for (const session of sessions.list()) {
    const preset = agentPresets.presetForSession(session)
    if (preset !== accPreset) continue
    const { sessionId, cwd, title } = sessionIdentity(session)
    if (!sessionId || !cwd) continue
    const root = await resolveRoot(cwd)
    if (root !== targetRoot) continue
    const turns = Number(session?.stats?.turns ?? session?.header?.turns ?? 0)
    const createdAt = Number(
      session?.header?.createdAt
      ?? session?.createdAt
      ?? session?.identity?.createdAt
      ?? 0,
    )
    const autoCreated = title.startsWith('验收 ·')
      || Boolean(expectedAutoTitle && title === expectedAutoTitle)
    matches.push({
      sessionId,
      createdAt: Number.isFinite(createdAt) ? createdAt : 0,
      turns: Number.isFinite(turns) ? turns : 0,
      inWorkspace: workspaceIds.has(sessionId),
      autoCreated,
      isCurrent: Boolean(input.currentId && sessionId === input.currentId),
    })
  }
  if (matches.length === 0) return null

  // Sticky: already-bound live acceptance always wins over ranking heuristics.
  const currentMatch = matches.find((item) => item.isCurrent)
  if (currentMatch) return currentMatch.sessionId

  matches.sort((a, b) => {
    // Prefer human-created / renamed acceptance sessions over host "验收 · …" clones.
    if (a.autoCreated !== b.autoCreated) return a.autoCreated ? 1 : -1
    if (a.inWorkspace !== b.inWorkspace) return a.inWorkspace ? -1 : 1
    if (b.turns !== a.turns) return b.turns - a.turns
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
    return a.sessionId.localeCompare(b.sessionId)
  })
  return matches[0].sessionId
}

/**
 * Lazily create or rebind the acceptance session when a project needs review.
 *
 * @param {object} input
 * @param {string} input.projectRoot
 * @param {{ create: Function, rename?: Function }} input.sessionController
 * @param {{ list?: Function }} [input.workspaceRegistry]
 * @param {{ list?: Function }} [input.sessions]
 * @param {{ presetForSession?: Function }} [input.agentPresets]
 * @param {string} [input.acc_preset]
 * @param {(message: string) => void} [input.log]
 */
export async function ensureAcceptanceSession(input) {
  const paths = flowPaths(input.projectRoot)
  let store
  try {
    store = await loadFlowStore(paths)
  } catch {
    return { ensured: false, reason: 'no_flow' }
  }

  const flow = store.flow
  const log = input.log ?? (() => {})
  const preset = typeof input.acc_preset === 'string' && input.acc_preset.trim() !== ''
    ? input.acc_preset
    : 'aris-acceptance'
  const projectId = String(flow.project_id)
  const cwd = String(flow.project_root ?? paths.projectRoot)

  const needsAcceptance = flow.flow_status === 'awaiting_acceptance'
    || (await hasPromptAcceptanceOutbox(paths))

  const prdRelpath = typeof flow.prd_relpath === 'string' && flow.prd_relpath.trim() !== ''
    ? String(flow.prd_relpath)
    : DEFAULT_PRD_RELPATH

  const currentAcc = typeof flow.acceptance_session_id === 'string'
    && flow.acceptance_session_id.trim() !== ''
    ? flow.acceptance_session_id.trim()
    : null

  const liveId = await findLiveAcceptanceSession({
    projectRoot: cwd,
    sessions: input.sessions,
    agentPresets: input.agentPresets,
    workspaceRegistry: input.workspaceRegistry,
    accPreset: preset,
    projectId,
    prdRelpath,
    currentId: currentAcc,
  })

  // Sticky: keep the already-bound live acceptance; never jump to a "preferred" peer.
  if (currentAcc && liveId === currentAcc) {
    await patchAcceptanceOutbox(paths, currentAcc)
    return {
      ensured: false,
      reason: 'already_bound_live',
      acceptance_session_id: currentAcc,
    }
  }

  // Bound id is gone from the live list — adopt another live acceptance if any.
  if (currentAcc && liveId && liveId !== currentAcc) {
    const nextFlow = {
      ...flow,
      acceptance_session_id: liveId,
      updated_at: new Date().toISOString(),
    }
    await saveFlowState(paths, nextFlow, store.findings)
    await patchAcceptanceOutbox(paths, liveId)
    await appendJournal(paths, {
      at: nextFlow.updated_at,
      kind: 'acceptance_session_rebound',
      project_id: projectId,
      previous_acceptance_session_id: currentAcc,
      acceptance_session_id: liveId,
      source: 'live_session',
    })
    log(`acceptance: rebound ${currentAcc} → ${liveId}`)
    return {
      ensured: true,
      rebound: true,
      acceptance_session_id: liveId,
      flow: nextFlow,
    }
  }

  // Keep the stored id even if temporarily unlistable; never create a second acceptance.
  if (currentAcc) {
    await patchAcceptanceOutbox(paths, currentAcc)
    return {
      ensured: false,
      reason: 'already_bound',
      acceptance_session_id: currentAcc,
    }
  }

  // No acceptance id yet — only discover/create when a review round is actually needed.
  if (!needsAcceptance) {
    return { ensured: false, reason: 'not_needed' }
  }

  if (liveId) {
    const nextFlow = {
      ...flow,
      acceptance_session_id: liveId,
      updated_at: new Date().toISOString(),
    }
    await saveFlowState(paths, nextFlow, store.findings)
    await patchAcceptanceOutbox(paths, liveId)
    await appendJournal(paths, {
      at: nextFlow.updated_at,
      kind: 'acceptance_session_rebound',
      project_id: projectId,
      previous_acceptance_session_id: null,
      acceptance_session_id: liveId,
      source: 'live_session',
    })
    log(`acceptance: bind live ${liveId}`)
    return {
      ensured: true,
      rebound: true,
      acceptance_session_id: liveId,
      flow: nextFlow,
    }
  }

  const sessionController = input.sessionController
  if (!sessionController || typeof sessionController.create !== 'function') {
    throw new Error('ensureAcceptanceSession 需要带 create() 的 sessionController')
  }

  const workspaceId = await resolveWorkspaceIdForRoot(input.workspaceRegistry, cwd)
  log(`acceptance: creating ${preset} session for ${projectId}`
    + (workspaceId ? ` (workspace ${workspaceId})` : ' (cwd fallback)'))
  const created = await sessionController.create(
    workspaceId
      ? { workspaceId, agentPreset: preset }
      : { cwd, agentPreset: preset },
  )
  const acceptanceSessionId = String(created.sessionId ?? created.session_id)

  if (typeof sessionController.rename === 'function') {
    try {
      await sessionController.rename({
        sessionId: acceptanceSessionId,
        title: acceptanceSessionTitle(projectId, prdRelpath),
      })
    } catch {
      // Title is cosmetic.
    }
  }

  const nextFlow = {
    ...flow,
    acceptance_session_id: acceptanceSessionId,
    updated_at: new Date().toISOString(),
  }
  await saveFlowState(paths, nextFlow, store.findings)
  await patchAcceptanceOutbox(paths, acceptanceSessionId)
  await appendJournal(paths, {
    at: nextFlow.updated_at,
    kind: 'acceptance_session_created',
    project_id: projectId,
    acceptance_session_id: acceptanceSessionId,
    agent_preset: preset,
    workspace_id: workspaceId,
  })

  log(`acceptance: bound ${acceptanceSessionId}`)
  return {
    ensured: true,
    acceptance_session_id: acceptanceSessionId,
    flow: nextFlow,
  }
}

/**
 * @param {ReturnType<typeof flowPaths>} paths
 */
async function hasPromptAcceptanceOutbox(paths) {
  const files = await listJsonFiles(paths.outbox)
  for (const file of files) {
    const action = await readJson(file)
    if (action.type === 'prompt_acceptance') return true
  }
  return false
}

/**
 * @param {ReturnType<typeof flowPaths>} paths
 * @param {string} acceptanceSessionId
 */
async function patchAcceptanceOutbox(paths, acceptanceSessionId) {
  const files = await listJsonFiles(paths.outbox)
  for (const file of files) {
    const action = await readJson(file)
    if (action.type !== 'prompt_acceptance') continue
    if (action.acceptance_session_id === acceptanceSessionId) continue
    await writeJsonAtomic(file, {
      ...action,
      acceptance_session_id: acceptanceSessionId,
    })
  }
}
