import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createAcceptanceStore } from './store.js'

async function withStore(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'aris-acceptance-'))
  try {
    await fn(createAcceptanceStore(root), root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('projects keep separate acceptance ledgers and error books', async () => {
  await withStore(async (store) => {
    await store.recordAcceptance({
      projectId: '校园开放日',
      phase: 'result_check',
      verdict: 'fail',
      constraint: '验收条件：报名页必须可提交',
      summary: '提交按钮无响应',
      evidence: 'test-report.md',
      severity: 'high',
    })
    await store.recordAcceptance({
      projectId: '图书馆预约',
      phase: 'process_supervision',
      verdict: 'pass',
      constraint: '执行步骤：先写测试再改接口',
      summary: '步骤和证据一致',
    })

    const campus = await store.listErrors('校园开放日')
    const library = await store.listErrors('图书馆预约')
    const campusAcceptance = await store.listAcceptance('校园开放日')
    const libraryAcceptance = await store.listAcceptance('图书馆预约')

    assert.equal(campus.total, 1)
    assert.equal(campus.records[0].violation, '提交按钮无响应')
    assert.equal(library.total, 0)
    assert.equal(campusAcceptance.records[0].verdict, 'fail')
    assert.equal(libraryAcceptance.records[0].verdict, 'pass')
    assert.equal(libraryAcceptance.records.some((record) => record.projectId === '校园开放日'), false)
  })
})

test('a failed check increments only that project alert reserve', async () => {
  await withStore(async (store) => {
    await store.addError({
      projectId: 'proj-a',
      phase: 'retest',
      constraint: '整改后需复测',
      violation: '复测报告仍是整改前的结果',
    })
    await store.addError({
      projectId: 'proj-a',
      phase: 'retest',
      constraint: '整改后需复测',
      violation: '第二次复测仍未覆盖失败用例',
    })
    await store.addError({
      projectId: 'proj-b',
      phase: 'result_check',
      constraint: '测试结果必须附日志',
      violation: '只有结论没有日志',
    })

    const a = await store.alertStatus('proj-a')
    const b = await store.alertStatus('proj-b')
    assert.equal(a.count, 2)
    assert.equal(a.delivery, 'reserved')
    assert.equal(a.parentNotified, false)
    assert.equal(a.pending.every((item) => item.delivered === false && item.parentNotified === false), true)
    assert.equal(b.count, 1)
    assert.equal(b.pending.length, 1)
  })
})

test('project ids cannot cross directories', async () => {
  await withStore(async (store) => {
    await assert.rejects(() => store.listErrors('../proj-a'), /PROJECT_ID_INVALID/)
    await assert.rejects(() => store.listAcceptance('a/b'), /PROJECT_ID_INVALID/)
    await assert.rejects(() => store.alertStatus(''), /PROJECT_ID_INVALID/)
  })
})
