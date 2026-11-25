import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { autoBindDevelopmentSessions } from './auto-bind-development.js'
import { flowPaths, readJson } from './store.js'

test('autoBindDevelopmentSessions inits flow for live development session', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flow-autobind-'))
  await writeFile(path.join(root, 'PRD.md'), '# X\n', 'utf8')
  const managedRootsFile = path.join(root, 'managed.json')

  const session = {
    id: 'session-dev-live-1',
    header: { cwd: root },
  }
  const result = await autoBindDevelopmentSessions({
    sessions: {
      list: () => [session],
    },
    agentPresets: {
      presetForSession: (s) => (s === session ? 'development' : null),
    },
    managedRootsFile,
  })

  assert.equal(result.bound.length, 1)
  assert.equal(result.bound[0].development_session_id, 'session-dev-live-1')
  const flow = await readJson(flowPaths(root).flow)
  assert.equal(flow.development_session_id, 'session-dev-live-1')
  assert.equal(flow.acceptance_session_id, null)
  assert.equal(flow.flow_status, 'developing')
  assert.equal(flow.prd_relpath, 'PRD.md')
})

test('autoBindDevelopmentSessions uses .active-prd and kickoff that path', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flow-autobind-prd-'))
  await writeFile(path.join(root, 'PRD.md'), '# default\n', 'utf8')
  await writeFile(path.join(root, 'PRD-income.md'), '# income\n', 'utf8')
  await writeFile(path.join(root, '.active-prd'), 'PRD-income.md\n', 'utf8')
  const managedRootsFile = path.join(root, 'managed.json')
  const session = { id: 'session-dev-prd', header: { cwd: root } }

  const result = await autoBindDevelopmentSessions({
    sessions: { list: () => [session] },
    agentPresets: { presetForSession: () => 'development' },
    managedRootsFile,
  })

  assert.equal(result.bound.length, 1)
  assert.equal(result.bound[0].prd_relpath, 'PRD-income.md')
  const flow = await readJson(flowPaths(root).flow)
  assert.equal(flow.prd_relpath, 'PRD-income.md')
  assert.match(String(flow.project_id), /prd-income/)
  const { listJsonFiles } = await import('./store.js')
  const outbox = await listJsonFiles(flowPaths(root).outbox)
  assert.equal(outbox.length, 1)
  const action = await readJson(outbox[0])
  assert.equal(action.type, 'prompt_development_start')
  assert.equal(action.prd_relpath, 'PRD-income.md')
})

test('autoBindDevelopmentSessions archives and rebinds when .active-prd mismatches idle flow', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flow-autobind-mismatch-'))
  await writeFile(path.join(root, 'PRD.md'), '# default\n', 'utf8')
  await writeFile(path.join(root, 'PRD-alt.md'), '# alt\n', 'utf8')
  const managedRootsFile = path.join(root, 'managed.json')
  const session = { id: 'session-dev-1', header: { cwd: root } }
  await autoBindDevelopmentSessions({
    sessions: { list: () => [session] },
    agentPresets: { presetForSession: () => 'development' },
    managedRootsFile,
  })
  await writeFile(path.join(root, '.active-prd'), 'PRD-alt.md\n', 'utf8')
  const second = await autoBindDevelopmentSessions({
    sessions: { list: () => [session] },
    agentPresets: { presetForSession: () => 'development' },
    managedRootsFile,
  })
  assert.equal(second.bound.length, 1)
  assert.equal(second.bound[0].prd_relpath, 'PRD-alt.md')
  const flow = await readJson(flowPaths(root).flow)
  assert.equal(flow.prd_relpath, 'PRD-alt.md')
  assert.equal(flow.flow_status, 'developing')
  assert.match(String(flow.project_id), /prd-alt/)
  const { readdir } = await import('node:fs/promises')
  const archives = (await readdir(root)).filter((name) => name.startsWith('.flow-archive-'))
  assert.equal(archives.length, 1)
})

test('autoBindDevelopmentSessions archives acceptance_passed when switching PRD', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flow-autobind-passed-'))
  await writeFile(path.join(root, 'PRD.md'), '# default\n', 'utf8')
  await writeFile(path.join(root, 'PRD-travel.md'), '# travel\n', 'utf8')
  const managedRootsFile = path.join(root, 'managed.json')
  const session = { id: 'session-dev-passed', header: { cwd: root } }
  await autoBindDevelopmentSessions({
    sessions: { list: () => [session] },
    agentPresets: { presetForSession: () => 'development' },
    managedRootsFile,
  })
  const paths = flowPaths(root)
  const flow = await readJson(paths.flow)
  flow.flow_status = 'acceptance_passed'
  flow.active_submission_id = 'sub-001'
  await writeFile(paths.flow, `${JSON.stringify(flow, null, 2)}\n`, 'utf8')
  await writeFile(path.join(root, '.active-prd'), 'PRD-travel.md\n', 'utf8')

  const result = await autoBindDevelopmentSessions({
    sessions: { list: () => [session] },
    agentPresets: { presetForSession: () => 'development' },
    managedRootsFile,
  })
  assert.equal(result.bound.length, 1)
  assert.equal(result.bound[0].prd_relpath, 'PRD-travel.md')
  const next = await readJson(flowPaths(root).flow)
  assert.equal(next.flow_status, 'developing')
  assert.equal(next.prd_relpath, 'PRD-travel.md')
  assert.equal(next.active_submission_id, null)
  assert.equal(next.acceptance_session_id, null)
})

test('autoBindDevelopmentSessions keeps protected mismatch during remediating', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flow-autobind-protect-'))
  await writeFile(path.join(root, 'PRD.md'), '# default\n', 'utf8')
  await writeFile(path.join(root, 'PRD-alt.md'), '# alt\n', 'utf8')
  const managedRootsFile = path.join(root, 'managed.json')
  const session = { id: 'session-dev-protect', header: { cwd: root } }
  await autoBindDevelopmentSessions({
    sessions: { list: () => [session] },
    agentPresets: { presetForSession: () => 'development' },
    managedRootsFile,
  })
  const paths = flowPaths(root)
  const flow = await readJson(paths.flow)
  flow.flow_status = 'remediating'
  await writeFile(paths.flow, `${JSON.stringify(flow, null, 2)}\n`, 'utf8')
  await writeFile(path.join(root, '.active-prd'), 'PRD-alt.md\n', 'utf8')

  const result = await autoBindDevelopmentSessions({
    sessions: { list: () => [session] },
    agentPresets: { presetForSession: () => 'development' },
    managedRootsFile,
  })
  assert.equal(result.bound.length, 0)
  assert.equal(result.skipped[0].reason, 'prd_mismatch')
  const kept = await readJson(paths.flow)
  assert.equal(kept.prd_relpath, 'PRD.md')
  assert.equal(kept.flow_status, 'remediating')
})

test('autoBindDevelopmentSessions is idempotent for same session', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flow-autobind2-'))
  await writeFile(path.join(root, 'PRD.md'), '# X\n', 'utf8')
  const managedRootsFile = path.join(root, 'managed.json')
  const session = { id: 'session-dev-2', header: { cwd: root } }
  const deps = {
    sessions: { list: () => [session] },
    agentPresets: { presetForSession: () => 'development' },
    managedRootsFile,
  }
  await autoBindDevelopmentSessions(deps)
  const second = await autoBindDevelopmentSessions(deps)
  assert.equal(second.bound.length, 0)
  assert.equal(second.skipped[0].reason, 'already_bound')
})

test('autoBindDevelopmentSessions ignores non-development presets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flow-autobind3-'))
  const result = await autoBindDevelopmentSessions({
    sessions: {
      list: () => [{ id: 'session-acc', header: { cwd: root } }],
    },
    agentPresets: {
      presetForSession: () => 'aris-acceptance',
    },
    managedRootsFile: path.join(root, 'managed.json'),
  })
  assert.equal(result.bound.length, 0)
})

test('autoBindDevelopmentSessions rebinds placeholder development session', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flow-autobind-rebind-'))
  await writeFile(path.join(root, 'PRD.md'), '# X\n', 'utf8')
  const managedRootsFile = path.join(root, 'managed.json')
  await autoBindDevelopmentSessions({
    sessions: {
      list: () => [{ id: 'session-defect-lab-placeholder-dev', header: { cwd: root } }],
    },
    agentPresets: { presetForSession: () => 'development' },
    managedRootsFile,
  })

  const live = { id: 'session-dev-live-rebind', header: { cwd: root } }
  const result = await autoBindDevelopmentSessions({
    sessions: { list: () => [live] },
    agentPresets: { presetForSession: () => 'development' },
    managedRootsFile,
  })
  assert.equal(result.bound.length, 1)
  assert.equal(result.bound[0].rebound, true)
  const rebound = await readJson(flowPaths(root).flow)
  assert.equal(rebound.development_session_id, 'session-dev-live-rebind')
})

test('autoBindDevelopmentSessions keeps sticky development mid remediating', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flow-autobind-sticky-'))
  await writeFile(path.join(root, 'PRD.md'), '# X\n', 'utf8')
  const managedRootsFile = path.join(root, 'managed.json')
  await autoBindDevelopmentSessions({
    sessions: {
      list: () => [{ id: 'session-dev-original', header: { cwd: root } }],
    },
    agentPresets: { presetForSession: () => 'development' },
    managedRootsFile,
  })

  const paths = flowPaths(root)
  const flow = await readJson(paths.flow)
  flow.flow_status = 'remediating'
  flow.development_session_id = 'session-dev-original'
  await writeFile(paths.flow, `${JSON.stringify(flow, null, 2)}\n`, 'utf8')

  const peer = { id: 'session-dev-peer', header: { cwd: root } }
  const result = await autoBindDevelopmentSessions({
    // Original session absent from list (UI flicker / closed tab) — still sticky.
    sessions: { list: () => [peer] },
    agentPresets: { presetForSession: () => 'development' },
    managedRootsFile,
  })
  assert.equal(result.bound.length, 0)
  assert.equal(
    result.skipped.some((item) => item.reason === 'sticky_development_session'),
    true,
  )
  const kept = await readJson(paths.flow)
  assert.equal(kept.development_session_id, 'session-dev-original')
})
