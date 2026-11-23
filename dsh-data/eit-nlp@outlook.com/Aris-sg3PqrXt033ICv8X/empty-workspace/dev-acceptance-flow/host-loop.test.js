import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runHostOnce, startHostLoop } from './host-loop.js'
import { initFlowStore, listJsonFiles, writeImmutableJson } from './store.js'

const examples = path.join(path.dirname(fileURLToPath(import.meta.url)), 'examples')

async function loadExample(...parts) {
  return JSON.parse(await readFile(path.join(examples, ...parts), 'utf8'))
}

async function withProject(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'flow-host-'))
  try {
    await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('init + once processes submission and review into acceptance_passed', async () => {
  await withProject(async (root) => {
    const boot = await initFlowStore({
      projectRoot: root,
      project_id: 'todo-demo',
      development_session_id: 'sess-dev',
      acceptance_session_id: 'sess-acc',
      event_id: 'evt-boot',
      at: '2026-11-23T01:00:00.000Z',
    })
    assert.equal(boot.created, true)
    assert.equal(boot.flow.flow_status, 'developing')

    const submission = await loadExample('todo-happy', 'submission.sub-001.json')
    await writeImmutableJson(
      path.join(boot.paths.submissions, 'sub-001.json'),
      submission,
    )

    const afterSub = await runHostOnce({ projectRoot: root })
    assert.equal(afterSub.flow.flow_status, 'awaiting_acceptance')
    assert.equal(afterSub.flow.active_submission_id, 'sub-001')
    const outboxAfterSub = await listJsonFiles(boot.paths.outbox)
    assert.equal(outboxAfterSub.some((file) => file.includes('prompt-acceptance-sub-001')), true)

    const review = await loadExample('todo-happy', 'review.rev-001.passed.json')
    await writeImmutableJson(path.join(boot.paths.reviews, 'rev-001.json'), review)

    const afterReview = await runHostOnce({ projectRoot: root })
    assert.equal(afterReview.flow.flow_status, 'acceptance_passed')
    const outboxAfterReview = await listJsonFiles(boot.paths.outbox)
    assert.equal(
      outboxAfterReview.some((file) => file.includes('prompt-delivery-rev-001')),
      true,
    )

    // Idempotent second pass
    const again = await runHostOnce({ projectRoot: root })
    assert.equal(again.flow.flow_status, 'acceptance_passed')
    assert.equal(again.outcomes.every((row) => row.ignored || !row.handled), true)
  })
})

test('host loop rejects foreign project_id without changing flow', async () => {
  await withProject(async (root) => {
    const boot = await initFlowStore({
      projectRoot: root,
      project_id: 'todo-demo',
      development_session_id: 'sess-dev',
      acceptance_session_id: 'sess-acc',
    })
    await writeImmutableJson(path.join(boot.paths.submissions, 'sub-bad.json'), {
      ...await loadExample('todo-happy', 'submission.sub-001.json'),
      project_id: 'other',
      event_id: 'evt-bad-project',
      submission_id: 'sub-bad',
    })
    const result = await runHostOnce({ projectRoot: root })
    assert.equal(result.flow.flow_status, 'developing')
    assert.equal(result.outcomes[0].error?.code, 'PROJECT_ID_MISMATCH')

    const second = await runHostOnce({ projectRoot: root })
    assert.equal(second.outcomes[0].ignored, true)
  })
})

test('watch loop picks up a newly written submission', async () => {
  await withProject(async (root) => {
    const boot = await initFlowStore({
      projectRoot: root,
      project_id: 'todo-demo',
      development_session_id: 'sess-dev',
      acceptance_session_id: 'sess-acc',
    })
    const controller = new AbortController()
    const loop = await startHostLoop({
      projectRoot: root,
      intervalMs: 20,
      signal: controller.signal,
      log: () => {},
    })

    try {
      const submission = await loadExample('todo-happy', 'submission.sub-001.json')
      await writeImmutableJson(path.join(boot.paths.submissions, 'sub-001.json'), submission)

      let status = 'developing'
      for (let i = 0; i < 50; i += 1) {
        const once = await loop.runOnce()
        if (!once) continue
        status = /** @type {string} */ (once.flow.flow_status)
        if (status === 'awaiting_acceptance') break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      assert.equal(status, 'awaiting_acceptance')
    } finally {
      await loop.stop()
      controller.abort()
    }
  })
})
