import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createHostSessionControllerDriver } from './host-session-driver.js'
import { runHostCycle } from './outbox-consumer.js'
import { createSdkSessionDriver } from './sdk-session-driver.js'
import { initFlowStore, writeImmutableJson } from './store.js'

const examples = path.join(path.dirname(fileURLToPath(import.meta.url)), 'examples')

async function loadExample(...parts) {
  return JSON.parse(await readFile(path.join(examples, ...parts), 'utf8'))
}

async function withProject(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'flow-sdk-'))
  try {
    await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('sdk driver calls session/prompt through injected client', async () => {
  await withProject(async (root) => {
    const calls = []
    const client = {
      async resumeSession(sessionId) {
        calls.push({ op: 'resume', sessionId })
      },
      async prompt(sessionId, blocks) {
        calls.push({ op: 'prompt', sessionId, blocks })
        return 'msg-1'
      },
      async request(method, params) {
        calls.push({ op: 'request', method, params })
        return {}
      },
    }

    await initFlowStore({
      projectRoot: root,
      project_id: 'todo-demo',
      development_session_id: 'sess-dev',
      acceptance_session_id: 'sess-acc',
    })
    await writeImmutableJson(
      path.join(root, '.flow/submissions/sub-001.json'),
      await loadExample('todo-happy', 'submission.sub-001.json'),
    )

    const driver = createSdkSessionDriver({ client, waitForIdle: true })
    const cycle = await runHostCycle({ projectRoot: root, driver, log: () => {} })
    await driver.close()

    assert.equal(cycle.outbox.outcomes[0].ok, true)
    assert.equal(cycle.outbox.outcomes[0].delivery.protocol, 'session/prompt')
    assert.equal(cycle.outbox.outcomes[0].delivery.messageId, 'msg-1')
    assert.deepEqual(calls.map((row) => row.op), ['resume', 'prompt', 'request'])
    assert.equal(calls[1].sessionId, 'sess-acc')
    assert.equal(calls[1].blocks[0].text.includes('请执行结果核查'), true)
    assert.equal(calls[2].method, 'session/wait')
  })
})

test('host sessionController driver admits queue prompts', async () => {
  const seen = []
  const sessionController = {
    async prompt(request, signal) {
      seen.push({ request, aborted: signal.aborted })
      return { accepted: true }
    },
  }
  const driver = createHostSessionControllerDriver(sessionController, { timeoutMs: 5_000 })
  const result = await driver.prompt({
    target: 'development',
    session_id: 'sess-dev',
    mode: 'queue',
    text: '请继续交付',
    meta: { action_id: 'a1' },
  })
  assert.equal(result.delivered, true)
  assert.equal(result.protocol, 'sessionController.prompt')
  assert.equal(seen[0].request.sessionId, 'sess-dev')
  assert.equal(seen[0].request.mode, 'queue')
  assert.equal(seen[0].request.content[0].text, '请继续交付')
  assert.equal(typeof seen[0].request.requestId, 'string')
})
