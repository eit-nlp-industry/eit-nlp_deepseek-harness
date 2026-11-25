import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  DEFAULT_PRD_RELPATH,
  prdIdSuffix,
  resolveActivePrd,
  resolvePrdCandidate,
} from './active-prd.js'
import { defaultProjectId } from './start-project.js'
import { flowPaths, initFlowStore, readJson } from './store.js'

test('prdIdSuffix ignores default PRD.md', () => {
  assert.equal(prdIdSuffix('PRD.md'), null)
  assert.equal(prdIdSuffix('prd.md'), null)
  assert.equal(prdIdSuffix('PRD-income.md'), 'prd-income')
  assert.equal(prdIdSuffix('docs/PRD-todo.md'), 'prd-todo')
})

test('defaultProjectId appends prd suffix', () => {
  assert.equal(defaultProjectId('/tmp/my-app', undefined, 'PRD.md'), 'my-app')
  assert.equal(defaultProjectId('/tmp/my-app', undefined, 'PRD-income.md'), 'my-app-prd-income')
  assert.equal(defaultProjectId('/tmp/my-app', 'explicit', 'PRD-income.md'), 'explicit')
})

test('resolveActivePrd reads .active-prd before default', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'active-prd-'))
  await writeFile(path.join(root, 'PRD.md'), '# default\n', 'utf8')
  await writeFile(path.join(root, 'PRD-alt.md'), '# alt\n', 'utf8')
  await writeFile(path.join(root, '.active-prd'), '# choose\nPRD-alt.md\n', 'utf8')

  const active = await resolveActivePrd({ projectRoot: root })
  assert.equal(active.prd_relpath, 'PRD-alt.md')
  assert.equal(active.source, 'active_prd_file')
})

test('resolveActivePrd prefers flow.prd_relpath over .active-prd', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'active-prd-flow-'))
  await writeFile(path.join(root, 'PRD.md'), '# default\n', 'utf8')
  await writeFile(path.join(root, 'PRD-alt.md'), '# alt\n', 'utf8')
  await writeFile(path.join(root, 'PRD-flow.md'), '# flow\n', 'utf8')
  await writeFile(path.join(root, '.active-prd'), 'PRD-alt.md\n', 'utf8')
  await initFlowStore({
    projectRoot: root,
    project_id: 'demo',
    development_session_id: 'sess-dev',
    prd_relpath: 'PRD-flow.md',
  })

  const active = await resolveActivePrd({ projectRoot: root })
  assert.equal(active.prd_relpath, 'PRD-flow.md')
  assert.equal(active.source, 'flow')
  const flow = await readJson(flowPaths(root).flow)
  assert.equal(flow.prd_relpath, 'PRD-flow.md')
})

test('resolvePrdCandidate rejects path escape', () => {
  assert.throws(() => resolvePrdCandidate('/tmp/proj', '../outside.md'))
  assert.equal(resolvePrdCandidate('/tmp/proj', DEFAULT_PRD_RELPATH).prd_relpath, 'PRD.md')
})
