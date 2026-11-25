import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildPromptForAction } from './prompt-templates.js'
import { consumeOutboxOnce } from './outbox-consumer.js'
import { loadManagedRoots } from './managed-roots.js'
import {
  PENDING_START_DONE_FILE,
  processPendingStart,
  requestProjectStart,
} from './start-project.js'
import { createMemorySessionDriver } from './session-driver.js'
import { flowPaths, listJsonFiles, readJson } from './store.js'

async function makeProject() {
  const root = await mkdtemp(path.join(tmpdir(), 'flow-start-'))
  await writeFile(path.join(root, 'PRD.md'), '# Demo\n', 'utf8')
  const managedRootsFile = path.join(root, 'managed-roots.json')
  return { root, managedRootsFile }
}

test('requestProjectStart writes pending-start and registers managed root', async () => {
  const { root, managedRootsFile } = await makeProject()
  const result = await requestProjectStart({
    projectRoot: root,
    project_id: 'demo-app',
    managedRootsFile,
  })
  assert.equal(result.status, 'pending')
  assert.equal(result.request.project_id, 'demo-app')
  const pending = JSON.parse(await readFile(result.pending_start, 'utf8'))
  assert.equal(pending.dev_preset, 'development')
  assert.equal(pending.acc_preset, 'aris-acceptance')
  const managed = await loadManagedRoots(managedRootsFile)
  assert.ok(managed.includes(path.resolve(root)))
})

test('processPendingStart creates only development session and queues kickoff', async () => {
  const { root, managedRootsFile } = await makeProject()
  await requestProjectStart({
    projectRoot: root,
    project_id: 'demo-app',
    managedRootsFile,
  })

  /** @type {Array<object>} */
  const created = []
  /** @type {Array<object>} */
  const renamed = []
  let seq = 0
  const sessionController = {
    async create(request) {
      seq += 1
      const sessionId = `session-${request.agentPreset}-${seq}`
      created.push({ ...request, sessionId })
      return { sessionId, agentPreset: request.agentPreset }
    },
    async rename(request) {
      renamed.push(request)
      return { title: request.title }
    },
  }

  const processed = await processPendingStart({
    projectRoot: root,
    sessionController,
  })
  assert.equal(processed.processed, true)
  assert.equal(created.length, 1)
  assert.equal(created[0].agentPreset, 'development')
  assert.equal(renamed.length, 1)
  assert.equal(processed.flow.flow_status, 'developing')
  assert.equal(processed.flow.development_session_id, 'session-development-1')
  assert.equal(processed.flow.acceptance_session_id, null)

  const paths = flowPaths(root)
  const outbox = await listJsonFiles(paths.outbox)
  assert.equal(outbox.length, 1)
  const action = await readJson(outbox[0])
  assert.equal(action.type, 'prompt_development_start')

  const done = await readJson(path.join(paths.flowRoot, PENDING_START_DONE_FILE))
  assert.equal(done.result.development_session_id, 'session-development-1')
  assert.equal(done.result.acceptance_session_id, null)

  const again = await processPendingStart({ projectRoot: root, sessionController })
  assert.equal(again.processed, false)
  assert.equal(again.reason, 'no_pending_start')
})

test('prompt_development_start delivers via outbox consumer', async () => {
  const { root, managedRootsFile } = await makeProject()
  await requestProjectStart({
    projectRoot: root,
    project_id: 'demo-app',
    managedRootsFile,
  })
  let seq = 0
  await processPendingStart({
    projectRoot: root,
    sessionController: {
      async create(request) {
        seq += 1
        return { sessionId: `sess-${seq}`, agentPreset: request.agentPreset }
      },
    },
  })

  const driver = createMemorySessionDriver()
  const result = await consumeOutboxOnce({ projectRoot: root, driver })
  assert.equal(result.outcomes.length, 1)
  assert.equal(result.outcomes[0].ok, true)
  assert.equal(result.outcomes[0].target, 'development')
  assert.match(result.outcomes[0].prompt_text, /新项目开工/)
  assert.match(result.outcomes[0].prompt_text, /PRD/)
})

test('buildPromptForAction covers development start', () => {
  const prompt = buildPromptForAction({
    id: 'a1',
    type: 'prompt_development_start',
    project_id: 'x',
    development_session_id: 'sess-dev',
    project_root: '/tmp/x',
    prd_relpath: 'docs/PRD.md',
  })
  assert.ok(prompt)
  assert.equal(prompt.target, 'development')
  assert.equal(prompt.session_id, 'sess-dev')
  assert.match(prompt.text, /docs\/PRD\.md/)
})

test('requestProjectStart refuses existing flow without force', async () => {
  const { root, managedRootsFile } = await makeProject()
  const paths = flowPaths(root)
  await mkdir(paths.flowRoot, { recursive: true })
  await writeFile(paths.flow, JSON.stringify({
    schemaVersion: 1,
    project_id: 'old',
    project_root: root,
    development_session_id: 'a',
    acceptance_session_id: 'b',
    flow_status: 'developing',
    active_submission_id: null,
    active_review_id: null,
    remediation_round: 0,
    max_remediation_rounds: 3,
    waiting_reason: 'none',
    waiting_detail: '',
    last_event_id: 'e',
    processed_event_ids: ['e'],
    updated_at: new Date().toISOString(),
  }, null, 2), 'utf8')

  await assert.rejects(
    () => requestProjectStart({ projectRoot: root, managedRootsFile }),
    /FLOW_EXISTS/,
  )
})
