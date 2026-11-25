import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  acceptanceSessionTitle,
  ensureAcceptanceSession,
  resolveWorkspaceIdForRoot,
} from './ensure-acceptance-session.js'
import { applySubmission } from './transitions.js'
import {
  flowPaths,
  initFlowStore,
  listJsonFiles,
  readJson,
  saveFlowState,
  writeImmutableJson,
  writeOutboxAction,
} from './store.js'

const SUBMISSION = {
  schemaVersion: 1,
  event_id: 'evt-sub-lazy-1',
  submission_id: 'sub-001',
  project_id: 'lazy-app',
  kind: 'initial',
  code_revision: 'abcdef1',
  prd_revision: 'prdhash1',
  self_check_status: 'passed',
  artifact_manifest_ref: 'artifacts/manifest.json',
  requirement_evidence_map_ref: 'artifacts/req-map.json',
  final_verification_ref: 'artifacts/final.json',
  readonly_tree_ref: '.flow/trees/sub-001',
  submitted_at: '2026-11-23T08:00:00.000Z',
}

test('ensureAcceptanceSession creates acceptance session after submission outbox', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flow-lazy-acc-'))
  await initFlowStore({
    projectRoot: root,
    project_id: 'lazy-app',
    development_session_id: 'sess-dev',
    acceptance_session_id: null,
  })

  const paths = flowPaths(root)
  const store = {
    flow: (await readJson(paths.flow)),
    findings: (await readJson(paths.findings)),
  }
  const submitted = applySubmission({
    flow: store.flow,
    submission: SUBMISSION,
    findings: store.findings,
  })
  assert.equal(submitted.ok, true)
  await saveFlowState(paths, submitted.flow, submitted.findings)
  await writeImmutableJson(path.join(paths.submissions, 'sub-001.json'), SUBMISSION)
  await writeOutboxAction(paths, {
    id: 'prompt-acceptance-sub-001',
    type: 'prompt_acceptance',
    project_id: 'lazy-app',
    development_session_id: 'sess-dev',
    acceptance_session_id: null,
    submission_id: 'sub-001',
  })

  /** @type {Array<object>} */
  const created = []
  const result = await ensureAcceptanceSession({
    projectRoot: root,
    sessionController: {
      async create(request) {
        created.push(request)
        return { sessionId: 'sess-acc-lazy', agentPreset: request.agentPreset }
      },
    },
  })

  assert.equal(result.ensured, true)
  assert.equal(created.length, 1)
  assert.equal(created[0].agentPreset, 'aris-acceptance')
  assert.equal(result.acceptance_session_id, 'sess-acc-lazy')

  const flow = await readJson(paths.flow)
  assert.equal(flow.acceptance_session_id, 'sess-acc-lazy')

  const outbox = await listJsonFiles(paths.outbox)
  assert.equal(outbox.length, 1)
  const action = await readJson(outbox[0])
  assert.equal(action.acceptance_session_id, 'sess-acc-lazy')

  const again = await ensureAcceptanceSession({
    projectRoot: root,
    sessionController: {
      async create() {
        throw new Error('should not create again')
      },
    },
  })
  assert.equal(again.ensured, false)
  assert.equal(again.reason, 'already_bound')
})

test('ensureAcceptanceSession prefers workspaceId over cwd', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flow-lazy-ws-'))
  await initFlowStore({
    projectRoot: root,
    project_id: 'lazy-app',
    development_session_id: 'sess-dev',
    acceptance_session_id: null,
  })
  const paths = flowPaths(root)
  const storeFlow = await readJson(paths.flow)
  const findings = await readJson(paths.findings)
  const submitted = applySubmission({
    flow: storeFlow,
    submission: SUBMISSION,
    findings,
  })
  await saveFlowState(paths, submitted.flow, submitted.findings)
  await writeOutboxAction(paths, {
    id: 'prompt-acceptance-sub-001',
    type: 'prompt_acceptance',
    project_id: 'lazy-app',
    development_session_id: 'sess-dev',
    acceptance_session_id: null,
    submission_id: 'sub-001',
  })

  /** @type {Array<object>} */
  const created = []
  await ensureAcceptanceSession({
    projectRoot: root,
    workspaceRegistry: {
      list: () => [{ id: 'ws-test', path: root }],
    },
    sessionController: {
      async create(request) {
        created.push(request)
        return { sessionId: 'sess-acc-ws', agentPreset: request.agentPreset }
      },
    },
  })
  assert.equal(created.length, 1)
  assert.equal(created[0].workspaceId, 'ws-test')
  assert.equal(created[0].cwd, undefined)
  assert.equal(
    await resolveWorkspaceIdForRoot({ list: () => [{ id: 'ws-test', path: root }] }, root),
    'ws-test',
  )
})

test('ensureAcceptanceSession no-ops while still developing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flow-lazy-skip-'))
  await initFlowStore({
    projectRoot: root,
    project_id: 'lazy-app',
    development_session_id: 'sess-dev',
    acceptance_session_id: null,
  })

  const result = await ensureAcceptanceSession({
    projectRoot: root,
    sessionController: {
      async create() {
        throw new Error('should not create')
      },
    },
  })
  assert.equal(result.ensured, false)
  assert.equal(result.reason, 'not_needed')
})

test('acceptanceSessionTitle prefers prd stem over bare project id', () => {
  assert.equal(acceptanceSessionTitle('test-prd', 'PRD.md'), '验收 · test-prd')
  assert.equal(acceptanceSessionTitle('test-prd', 'travel-PRD.md'), '验收 · travel-prd')
})

test('ensureAcceptanceSession keeps sticky live acceptance over preferred peer', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flow-lazy-sticky-'))
  await initFlowStore({
    projectRoot: root,
    project_id: 'lazy-app',
    development_session_id: 'sess-dev',
    acceptance_session_id: 'sess-acc-orphan',
  })
  const paths = flowPaths(root)
  const flow = await readJson(paths.flow)
  flow.flow_status = 'awaiting_acceptance'
  flow.active_submission_id = 'sub-002'
  await saveFlowState(paths, flow, await readJson(paths.findings))
  await writeOutboxAction(paths, {
    id: 'prompt-acceptance-sub-002',
    type: 'prompt_acceptance',
    project_id: 'lazy-app',
    development_session_id: 'sess-dev',
    acceptance_session_id: 'sess-acc-orphan',
    submission_id: 'sub-002',
  })

  const liveWorkspace = {
    id: 'sess-acc-ws',
    header: { cwd: root, createdAt: 200, turns: 1, title: 'PRD 提交结果核查' },
    stats: { turns: 1 },
    title: 'PRD 提交结果核查',
  }
  const liveOrphan = {
    id: 'sess-acc-orphan',
    header: { cwd: root, createdAt: 100, turns: 1, title: '验收 · lazy-app' },
    stats: { turns: 1 },
    title: '验收 · lazy-app',
  }
  const result = await ensureAcceptanceSession({
    projectRoot: root,
    workspaceRegistry: {
      list: () => [{
        id: 'ws-defect',
        path: root,
        sessionIds: ['sess-acc-ws', 'sess-dev'],
      }],
    },
    sessions: { list: () => [liveOrphan, liveWorkspace] },
    agentPresets: {
      presetForSession: (session) => (
        session === liveWorkspace || session === liveOrphan ? 'aris-acceptance' : null
      ),
    },
    sessionController: {
      async create() {
        throw new Error('should not create when sticky live exists')
      },
    },
  })
  assert.equal(result.ensured, false)
  assert.equal(result.reason, 'already_bound_live')
  assert.equal(result.acceptance_session_id, 'sess-acc-orphan')
  const action = await readJson((await listJsonFiles(paths.outbox))[0])
  assert.equal(action.acceptance_session_id, 'sess-acc-orphan')
})

test('ensureAcceptanceSession rebinds only when bound acceptance is no longer live', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flow-lazy-rebind-'))
  await initFlowStore({
    projectRoot: root,
    project_id: 'lazy-app',
    development_session_id: 'sess-dev',
    acceptance_session_id: 'sess-acc-orphan',
  })
  const paths = flowPaths(root)
  const flow = await readJson(paths.flow)
  flow.flow_status = 'awaiting_acceptance'
  flow.active_submission_id = 'sub-002'
  await saveFlowState(paths, flow, await readJson(paths.findings))
  await writeOutboxAction(paths, {
    id: 'prompt-acceptance-sub-002',
    type: 'prompt_acceptance',
    project_id: 'lazy-app',
    development_session_id: 'sess-dev',
    acceptance_session_id: 'sess-acc-orphan',
    submission_id: 'sub-002',
  })

  const liveWorkspace = {
    id: 'sess-acc-ws',
    header: { cwd: root, createdAt: 200, turns: 1, title: 'PRD 提交结果核查' },
    stats: { turns: 1 },
    title: 'PRD 提交结果核查',
  }
  const result = await ensureAcceptanceSession({
    projectRoot: root,
    workspaceRegistry: {
      list: () => [{
        id: 'ws-defect',
        path: root,
        sessionIds: ['sess-acc-ws', 'sess-dev'],
      }],
    },
    sessions: { list: () => [liveWorkspace] },
    agentPresets: {
      presetForSession: (session) => (session === liveWorkspace ? 'aris-acceptance' : null),
    },
    sessionController: {
      async create() {
        throw new Error('should not create when live exists')
      },
    },
  })
  assert.equal(result.rebound, true)
  assert.equal(result.acceptance_session_id, 'sess-acc-ws')
  const action = await readJson((await listJsonFiles(paths.outbox))[0])
  assert.equal(action.acceptance_session_id, 'sess-acc-ws')
})
