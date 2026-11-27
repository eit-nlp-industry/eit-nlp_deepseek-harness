import { access, realpath } from 'node:fs/promises'
import path from 'node:path'
import { readActivePrdFile, resolveActivePrd } from './active-prd.js'
import { addManagedRoot } from './managed-roots.js'
import { defaultProjectId } from './start-project.js'
import {
  appendJournal,
  archiveFlowRoot,
  flowPaths,
  initFlowStore,
  listJsonFiles,
  readJson,
  readJsonIfExists,
  saveFlowState,
  writeJsonAtomic,
  writeOutboxAction,
} from './store.js'

/**
 * @param {object} session
 * @returns {{ sessionId: string, cwd: string | null }}
 */
function sessionIdentity(session) {
  const sessionId = String(session?.id ?? session?.sessionId ?? '')
  const cwd = typeof session?.header?.cwd === 'string' && session.header.cwd.trim() !== ''
    ? path.resolve(session.header.cwd)
    : (typeof session?.cwd === 'string' && session.cwd.trim() !== ''
      ? path.resolve(session.cwd)
      : null)
  return { sessionId, cwd }
}

/**
 * @param {object} session
 */
function sessionCreatedAt(session) {
  const value = Number(
    session?.header?.createdAt
    ?? session?.createdAt
    ?? session?.identity?.createdAt
    ?? 0,
  )
  return Number.isFinite(value) ? value : 0
}

/**
 * Lab / bootstrap placeholders are not real UI sessions.
 * @param {unknown} sessionId
 */
export function isPlaceholderDevelopmentSessionId(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') return true
  const id = sessionId.trim().toLowerCase()
  return id.includes('placeholder') || id.endsWith('-lab-dev') || id === 'pending-development'
}

/**
 * Resolve symlinks so lab-* and acceptance-defect-lab/* share one flow root.
 * @param {string} cwd
 */
async function resolveProjectRoot(cwd) {
  try {
    return await realpath(cwd)
  } catch {
    return path.resolve(cwd)
  }
}

/**
 * When several live development sessions share one project root, prefer a peer
 * that is not the previous bound id (user usually opened a new session for the
 * new PRD), then the newest createdAt.
 *
 * @param {Array<{ sessionId: string, createdAt: number }>} peers
 * @param {string | null | undefined} previousSessionId
 */
export function preferDevelopmentSession(peers, previousSessionId) {
  if (!Array.isArray(peers) || peers.length === 0) return null
  const ranked = [...peers].sort((a, b) => {
    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt
    return String(a.sessionId).localeCompare(String(b.sessionId))
  })
  const previous = typeof previousSessionId === 'string' ? previousSessionId.trim() : ''
  if (previous !== '') {
    const newerPeer = ranked.find((peer) => peer.sessionId !== previous)
    if (newerPeer) return newerPeer
  }
  return ranked[0]
}

/**
 * Flow statuses where development_session_id must stay sticky.
 * Even if the bound session briefly drops out of sessions.list(), do not steal
 * the binding to a newly opened development session mid-acceptance / remediating.
 */
export const STICKY_DEVELOPMENT_FLOW_STATUSES = new Set([
  'awaiting_acceptance',
  'remediating',
  'awaiting_user',
  'acceptance_passed',
  'delivering',
  'needs_manual',
])

/**
 * Mid-coordination statuses: do not auto-archive `.flow` just because `.active-prd`
 * points at another file. Protect an in-flight review / remediation / delivery.
 */
export const PROTECTED_PRD_SWITCH_STATUSES = new Set([
  'awaiting_acceptance',
  'remediating',
  'awaiting_user',
  'delivering',
])

/**
 * Normalize flow.prd_relpath for comparison with `.active-prd`.
 * @param {Record<string, unknown>} flow
 */
export function flowPrdRelpath(flow) {
  if (typeof flow.prd_relpath === 'string' && flow.prd_relpath.trim() !== '') {
    return flow.prd_relpath.trim().replace(/\\/g, '/')
  }
  return 'PRD.md'
}

/**
 * Discover live development sessions and ensure `.flow` is bootstrapped.
 *
 * Rebinds only for placeholder ids, or when the bound session is gone and the
 * flow is not mid-coordination (see STICKY_DEVELOPMENT_FLOW_STATUSES).
 *
 * When `.active-prd` selects a different PRD than `flow.prd_relpath` and the
 * flow is not mid-coordination, archives `.flow/` and bootstraps a new cycle
 * onto the preferred live session (not the previous bound one when a newer
 * peer exists), so kickoff is not re-delivered into a stale session.
 *
 * @param {object} input
 * @param {{ list?: Function }} [input.sessions]
 * @param {{ presetForSession?: Function }} [input.agentPresets]
 * @param {string} [input.devPreset]
 * @param {string} [input.managedRootsFile]
 * @param {(message: string) => void} [input.log]
 */
export async function autoBindDevelopmentSessions(input = {}) {
  const sessions = input.sessions
  const agentPresets = input.agentPresets
  const log = input.log ?? (() => {})
  const devPreset = typeof input.devPreset === 'string' && input.devPreset.trim() !== ''
    ? input.devPreset
    : 'development'

  if (!sessions || typeof sessions.list !== 'function') {
    return { bound: [], skipped: [], reason: 'sessions_unavailable' }
  }
  if (!agentPresets || typeof agentPresets.presetForSession !== 'function') {
    return { bound: [], skipped: [], reason: 'agent_presets_unavailable' }
  }

  /** @type {Array<{ sessionId: string, cwd: string, root: string, createdAt: number, session: object }>} */
  const liveDev = []
  for (const session of sessions.list()) {
    const preset = agentPresets.presetForSession(session)
    if (preset !== devPreset) continue
    const { sessionId, cwd } = sessionIdentity(session)
    if (!sessionId || !cwd) continue
    const root = await resolveProjectRoot(cwd)
    liveDev.push({
      sessionId,
      cwd,
      root,
      createdAt: sessionCreatedAt(session),
      session,
    })
  }

  /** @type {Map<string, typeof liveDev>} */
  const peersByRoot = new Map()
  for (const row of liveDev) {
    const list = peersByRoot.get(row.root) ?? []
    list.push(row)
    peersByRoot.set(row.root, list)
  }

  /** @type {Array<Record<string, unknown>>} */
  const bound = []
  /** @type {Array<Record<string, unknown>>} */
  const skipped = []
  /** @type {string[]} */
  const roots = []

  for (const [root, peers] of peersByRoot) {
    for (const peer of peers) roots.push(peer.cwd, root)

    try {
      await addManagedRoot(root, input.managedRootsFile)
      for (const peer of peers) {
        if (peer.cwd !== root) await addManagedRoot(peer.cwd, input.managedRootsFile)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log(`auto-bind: managed root failed for ${root}: ${message}`)
    }

    const bindRoot = peers[0].cwd
    const paths = flowPaths(root)
    let existing = await readJsonIfExists(paths.flow, null)

    if (existing) {
      let selected = null
      try {
        const selectedRaw = await readActivePrdFile(bindRoot)
        selected = selectedRaw ? selectedRaw.replace(/\\/g, '/') : null
      } catch {
        // Selection read is best-effort; binding may still proceed.
      }
      const currentPrd = flowPrdRelpath(existing)
      if (selected && selected !== currentPrd) {
        const status = String(existing.flow_status ?? '')
        if (PROTECTED_PRD_SWITCH_STATUSES.has(status)) {
          for (const peer of peers) {
            skipped.push({
              sessionId: peer.sessionId,
              cwd: peer.cwd,
              reason: 'prd_mismatch',
              flow_prd_relpath: currentPrd,
              selected_prd_relpath: selected,
              flow_status: status,
            })
          }
          log(`auto-bind: prd mismatch (protected ${status}) at ${bindRoot}: flow=${currentPrd} selected=${selected}`)
          continue
        }

        const previousDevId = typeof existing.development_session_id === 'string'
          ? existing.development_session_id
          : null
        const preferred = preferDevelopmentSession(peers, previousDevId) ?? peers[0]
        const archiveRoot = path.resolve(String(existing.project_root ?? root))
        const archived = await archiveFlowRoot(archiveRoot)
        await appendJournalNoteAfterArchive(archiveRoot, archived, {
          previous_prd_relpath: currentPrd,
          selected_prd_relpath: selected,
          previous_flow_status: status,
          previous_project_id: existing.project_id,
          previous_development_session_id: previousDevId,
          development_session_id: preferred.sessionId,
        })
        log(
          `auto-bind: archived .flow for PRD switch at ${archiveRoot}`
          + ` (${currentPrd} → ${selected}; bind ${preferred.sessionId}`
          + (archived.archive_dir ? `; ${archived.archive_dir}` : '')
          + ')',
        )

        const created = await bootstrapLiveDevelopment({
          bindRoot: preferred.cwd,
          sessionId: preferred.sessionId,
          log,
        })
        if (!created.ok) {
          skipped.push({
            sessionId: preferred.sessionId,
            cwd: preferred.cwd,
            reason: created.reason,
            message: created.message,
          })
          continue
        }
        bound.push({
          ...created.bound,
          previous_development_session_id: previousDevId,
          prd_switched: true,
        })
        for (const peer of peers) {
          if (peer.sessionId === preferred.sessionId) continue
          skipped.push({
            sessionId: peer.sessionId,
            cwd: peer.cwd,
            reason: 'prd_switch_bound_to_peer',
            development_session_id: preferred.sessionId,
          })
        }
        continue
      }
    }

    if (!existing) {
      const preferred = preferDevelopmentSession(peers, null) ?? peers[0]
      const created = await bootstrapLiveDevelopment({
        bindRoot: preferred.cwd,
        sessionId: preferred.sessionId,
        log,
      })
      if (!created.ok) {
        skipped.push({
          sessionId: preferred.sessionId,
          cwd: preferred.cwd,
          reason: created.reason,
          message: created.message,
        })
        continue
      }
      bound.push(created.bound)
      for (const peer of peers) {
        if (peer.sessionId === preferred.sessionId) continue
        skipped.push({
          sessionId: peer.sessionId,
          cwd: peer.cwd,
          reason: 'flow_bound_to_other_session',
          development_session_id: preferred.sessionId,
        })
      }
      continue
    }

    const liveIds = new Set(peers.map((peer) => peer.sessionId))
    const currentId = /** @type {string} */ (existing.development_session_id)

    if (liveIds.has(currentId)) {
      for (const peer of peers) {
        skipped.push({
          sessionId: peer.sessionId,
          cwd: peer.cwd,
          reason: peer.sessionId === currentId ? 'already_bound' : 'flow_bound_to_other_session',
          development_session_id: currentId,
        })
      }
      continue
    }

    const sticky = STICKY_DEVELOPMENT_FLOW_STATUSES.has(String(existing.flow_status ?? ''))
    const canRebind = isPlaceholderDevelopmentSessionId(currentId) || !sticky
    if (!canRebind) {
      for (const peer of peers) {
        skipped.push({
          sessionId: peer.sessionId,
          cwd: peer.cwd,
          reason: 'sticky_development_session',
          development_session_id: currentId,
          flow_status: existing.flow_status,
        })
      }
      continue
    }

    const preferred = preferDevelopmentSession(peers, currentId) ?? peers[0]
    const findings = await readJsonIfExists(
      paths.findings,
      { schemaVersion: 1, project_id: existing.project_id, items: [], updated_at: new Date().toISOString() },
    )
    const nextFlow = {
      ...existing,
      development_session_id: preferred.sessionId,
      updated_at: new Date().toISOString(),
    }
    await saveFlowState(paths, nextFlow, findings)
    await patchDevelopmentOutbox(paths, preferred.sessionId)
    await appendJournal(paths, {
      at: nextFlow.updated_at,
      kind: 'auto_rebind_development',
      project_id: existing.project_id,
      previous_development_session_id: currentId,
      development_session_id: preferred.sessionId,
      source: 'live_session',
    })
    log(`auto-rebind: ${existing.project_id} ${currentId} → ${preferred.sessionId} @ ${root}`)
    bound.push({
      project_id: existing.project_id,
      project_root: root,
      development_session_id: preferred.sessionId,
      rebound: true,
      previous_development_session_id: currentId,
    })
    for (const peer of peers) {
      if (peer.sessionId === preferred.sessionId) continue
      skipped.push({
        sessionId: peer.sessionId,
        cwd: peer.cwd,
        reason: 'flow_bound_to_other_session',
        development_session_id: preferred.sessionId,
      })
    }
  }

  return { bound, skipped, roots: [...new Set(roots)] }
}

/**
 * Journal is under the archived tree; write a sibling note at project root when possible,
 * otherwise best-effort skip (archive already preserves the old journal).
 *
 * @param {string} archiveRoot
 * @param {{ archived: boolean, archive_dir?: string, reason?: string }} archived
 * @param {Record<string, unknown>} details
 */
async function appendJournalNoteAfterArchive(archiveRoot, archived, details) {
  if (!archived.archived || typeof archived.archive_dir !== 'string') return
  try {
    const notePath = path.join(archived.archive_dir, 'host-journal.jsonl')
    const line = `${JSON.stringify({
      at: new Date().toISOString(),
      kind: 'auto_archive_for_prd_switch',
      project_root: archiveRoot,
      archive_dir: archived.archive_dir,
      ...details,
    })}\n`
    const { appendFile } = await import('node:fs/promises')
    await appendFile(notePath, line, 'utf8')
  } catch {
    // Archive already moved; a missing journal note must not block bootstrap.
  }
}

/**
 * @param {object} input
 * @param {string} input.bindRoot
 * @param {string} input.sessionId
 * @param {(message: string) => void} input.log
 */
async function bootstrapLiveDevelopment(input) {
  const { bindRoot, sessionId, log } = input
  let active
  try {
    active = await resolveActivePrd({ projectRoot: bindRoot })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`auto-bind: prd resolve failed for ${bindRoot}: ${message}`)
    return { ok: false, reason: 'prd_resolve_failed', message }
  }
  const projectId = defaultProjectId(bindRoot, undefined, active.prd_relpath)
  const boot = await initFlowStore({
    projectRoot: bindRoot,
    project_id: projectId,
    development_session_id: sessionId,
    acceptance_session_id: null,
    prd_relpath: active.prd_relpath,
  })
  const bindPaths = flowPaths(bindRoot)
  await appendJournal(bindPaths, {
    at: new Date().toISOString(),
    kind: 'auto_bind_development',
    project_id: projectId,
    development_session_id: sessionId,
    prd_relpath: active.prd_relpath,
    prd_source: active.source,
    source: 'live_session',
  })
  await writeOutboxAction(bindPaths, {
    id: `prompt-dev-start-autobind-${Date.now()}`,
    type: 'prompt_development_start',
    project_id: projectId,
    development_session_id: sessionId,
    project_root: bindRoot,
    prd_path: active.prd_path,
    prd_relpath: active.prd_relpath,
    created_at: new Date().toISOString(),
  })
  log(`auto-bind: ${projectId} ← ${sessionId} @ ${bindRoot} (prd=${active.prd_relpath})`)
  return {
    ok: true,
    bound: {
      project_id: projectId,
      project_root: bindRoot,
      development_session_id: sessionId,
      prd_relpath: active.prd_relpath,
      created: boot.created,
    },
  }
}

/**
 * @param {string} projectRoot
 */
export async function flowExists(projectRoot) {
  try {
    await access(flowPaths(projectRoot).flow)
    return true
  } catch {
    return false
  }
}

/**
 * Keep pending development prompts aimed at the rebound live session.
 * @param {ReturnType<typeof flowPaths>} paths
 * @param {string} developmentSessionId
 */
async function patchDevelopmentOutbox(paths, developmentSessionId) {
  const files = await listJsonFiles(paths.outbox)
  for (const file of files) {
    const action = await readJson(file)
    if (
      action.type !== 'prompt_development_start'
      && action.type !== 'prompt_development_remediation'
      && action.type !== 'prompt_development_delivery'
    ) {
      continue
    }
    if (action.development_session_id === developmentSessionId) continue
    await writeJsonAtomic(file, {
      ...action,
      development_session_id: developmentSessionId,
    })
  }
}
