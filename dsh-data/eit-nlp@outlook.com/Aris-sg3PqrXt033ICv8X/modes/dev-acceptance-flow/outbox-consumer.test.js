import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { consumeOutboxOnce, runHostCycle } from './outbox-consumer.js'
import { createMemorySessionDriver } from './session-driver.js'
import { initFlowStore, listJsonFiles, writeImmutableJson } from './store.js'

const examples = path.join(path.dirname(fileURLToPath(import.meta.url)), 'examples')

async function loadExample(...parts) {
  return JSON.parse(await readFile(path.join(examples, ...parts), 'utf8'))
}

async function withProject(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'flow-outbox-'))
  try {
    await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('host cycle delivers acceptance prompt via memory driver', async () => {
  await withProject(async (root) => {
    const boot = await initFlowStore({
      projectRoot: root,
      project_id: 'todo-demo',
      development_session_id: 'sess-dev',
      acceptance_session_id: 'sess-acc',
    })
    const submission = await loadExample('todo-happy', 'submission.sub-001.json')
    await writeImmutableJson(path.join(boot.paths.submissions, 'sub-001.json'), submission)

    const driver = createMemorySessionDriver()
    const cycle = await runHostCycle({ projectRoot: root, driver, log: () => {} })

    assert.equal(cycle.flow.flow_status, 'awaiting_acceptance')
    assert.equal(cycle.outbox.outcomes.length, 1)
    assert.equal(cycle.outbox.outcomes[0].ok, true)
    assert.equal(cycle.outbox.outcomes[0].target, 'acceptance')
    assert.equal(cycle.outbox.outcomes[0].session_id, 'sess-acc')
    assert.equal(driver.sent.length, 1)
    assert.match(driver.sent[0].text, /请执行结果核查/)
    assert.match(driver.sent[0].text, /project_id: todo-demo/)
    assert.equal((await listJsonFiles(boot.paths.outbox)).length, 0)
    assert.equal((await listJsonFiles(boot.paths.outboxDone)).length, 1)
  })
})

test('remediation and delivery prompts target development session', async () => {
  await withProject(async (root) => {
    const boot = await initFlowStore({
      projectRoot: root,
      project_id: 'todo-demo',
      development_session_id: 'sess-dev',
      acceptance_session_id: 'sess-acc',
    })
    const driver = createMemorySessionDriver()

    await writeImmutableJson(
      path.join(boot.paths.submissions, 'sub-001.json'),
      await loadExample('todo-happy', 'submission.sub-001.json'),
    )
    await runHostCycle({ projectRoot: root, driver, log: () => {} })
    driver.sent.length = 0

    await writeImmutableJson(
      path.join(boot.paths.reviews, 'rev-001.json'),
      await loadExample('todo-remediation', 'review.rev-001.changes_required.json'),
    )
    const afterFail = await runHostCycle({ projectRoot: root, driver, log: () => {} })
    assert.equal(afterFail.flow.flow_status, 'remediating')
    assert.equal(driver.sent[0].target, 'development')
    assert.equal(driver.sent[0].session_id, 'sess-dev')
    assert.match(driver.sent[0].text, /请整改并重新送验/)
    assert.match(driver.sent[0].text, /FIND-001/)

    driver.sent.length = 0
    await writeImmutableJson(
      path.join(boot.paths.submissions, 'sub-002.json'),
      await loadExample('todo-remediation', 'submission.sub-002.json'),
    )
    await runHostCycle({ projectRoot: root, driver, log: () => {} })
    assert.equal(driver.sent[0].target, 'acceptance')

    driver.sent.length = 0
    await writeImmutableJson(
      path.join(boot.paths.reviews, 'rev-002.json'),
      await loadExample('todo-remediation', 'review.rev-002.passed.json'),
    )
    const afterPass = await runHostCycle({ projectRoot: root, driver, log: () => {} })
    assert.equal(afterPass.flow.flow_status, 'acceptance_passed')
    assert.equal(driver.sent[0].target, 'development')
    assert.match(driver.sent[0].text, /验收已通过，请继续交付/)
  })
})

test('file driver writes dispatch artifacts', async () => {
  await withProject(async (root) => {
    const boot = await initFlowStore({
      projectRoot: root,
      project_id: 'todo-demo',
      development_session_id: 'sess-dev',
      acceptance_session_id: 'sess-acc',
    })
    await writeImmutableJson(
      path.join(boot.paths.submissions, 'sub-001.json'),
      await loadExample('todo-happy', 'submission.sub-001.json'),
    )
    // default file driver
    const host = await import('./host-loop.js').then((m) => m.runHostOnce({ projectRoot: root }))
    assert.equal(host.flow.flow_status, 'awaiting_acceptance')
    const consumed = await consumeOutboxOnce({ projectRoot: root, log: () => {} })
    assert.equal(consumed.outcomes[0].ok, true)
    const dispatchFiles = await listJsonFiles(boot.paths.dispatch)
    assert.equal(dispatchFiles.length >= 1, true)
    const payload = JSON.parse(await readFile(dispatchFiles[0], 'utf8'))
    assert.equal(payload.session_id, 'sess-acc')
    assert.equal(payload.target, 'acceptance')
  })
})

test('consume is idempotent after archive', async () => {
  await withProject(async (root) => {
    await initFlowStore({
      projectRoot: root,
      project_id: 'todo-demo',
      development_session_id: 'sess-dev',
      acceptance_session_id: 'sess-acc',
    })
    const driver = createMemorySessionDriver()
    const bootPaths = (await import('./store.js')).flowPaths(root)
    await writeImmutableJson(
      path.join(bootPaths.submissions, 'sub-001.json'),
      await loadExample('todo-happy', 'submission.sub-001.json'),
    )
    await runHostCycle({ projectRoot: root, driver, log: () => {} })
    assert.equal(driver.sent.length, 1)
    const second = await consumeOutboxOnce({ projectRoot: root, driver, log: () => {} })
    assert.equal(second.outcomes.length, 0)
    assert.equal(driver.sent.length, 1)
  })
})
