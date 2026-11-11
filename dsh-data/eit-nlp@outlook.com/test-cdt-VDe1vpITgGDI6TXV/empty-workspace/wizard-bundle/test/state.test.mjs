import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WIZARD_TOOL, foldWizardState, validateStage } from '../state.js'

let seq = 0
function call(args, name = WIZARD_TOOL) {
  seq += 1
  return { type: 'tool/call', seq, data: { name, callId: `c${seq}`, arguments: JSON.stringify(args) } }
}
function stage(over = {}) {
  return {
    wizardId: 'campus-2026',
    stageId: 'needs',
    version: 1,
    kind: 'form',
    title: '活动需求',
    data: { fields: [{ key: 'title', label: '活动名称', type: 'text', value: '旧物交换' }] },
    ...over,
  }
}

test('empty log yields no wizard', () => {
  const state = foldWizardState([])
  assert.equal(state.wizardId, null)
  assert.deepEqual(state.stages, [])
  assert.equal(state.currentStageId, null)
})

test('other tools and bad JSON are ignored', () => {
  const events = [
    call({ wizardId: 'w', stageId: 's', version: 1, kind: 'form', title: 't', data: {} }, 'read'),
    { type: 'tool/call', seq: 99, data: { name: WIZARD_TOOL, callId: 'x', arguments: '{oops' } },
  ]
  assert.equal(foldWizardState(events).wizardId, null)
})

test('one stage becomes current', () => {
  const state = foldWizardState([call(stage())])
  assert.equal(state.wizardId, 'campus-2026')
  assert.equal(state.currentStageId, 'needs')
  assert.equal(state.stages.length, 1)
  assert.equal(state.stages[0].version, 1)
  assert.equal(state.stages[0].stale, false)
})

test('a higher version wins; a late lower version never overwrites it', () => {
  const state = foldWizardState([
    call(stage({ version: 1 })),
    call(stage({ version: 3, data: { fields: [] } })),
    call(stage({ version: 2, data: { fields: [{ key: 'stale' }] } })),
  ])
  const needs = state.stages.find(s => s.stageId === 'needs')
  assert.equal(needs.version, 3)
  assert.deepEqual(needs.data, { fields: [] })
})

test('invalidates marks a downstream stage stale and a re-emit clears it', () => {
  const state = foldWizardState([
    call(stage({ stageId: 'needs', version: 1 })),
    call({ ...stage({ stageId: 'preview', version: 1, kind: 'preview' }), invalidates: ['needs'] }),
  ])
  const needs = state.stages.find(s => s.stageId === 'needs')
  assert.equal(needs.stale, true)
  assert.equal(needs.staleBy, 'preview')
  assert.equal(state.currentStageId, 'preview')

  const refreshed = foldWizardState([
    call(stage({ stageId: 'needs', version: 1 })),
    call({ ...stage({ stageId: 'preview', version: 1, kind: 'preview' }), invalidates: ['needs'] }),
    call(stage({ stageId: 'needs', version: 2 })),
  ])
  assert.equal(refreshed.stages.find(s => s.stageId === 'needs').stale, false)
  assert.equal(refreshed.currentStageId, 'needs')
})

test('records are rejected when identity or version is not explicit', () => {
  assert.equal(validateStage(stage({ stageId: '' }), 1), null)
  assert.equal(validateStage(stage({ wizardId: '../x' }), 1), null)
  assert.equal(validateStage(stage({ version: 0 }), 1), null)
  assert.equal(validateStage(stage({ version: 1.5 }), 1), null)
  assert.equal(validateStage(stage({ kind: 'summary' }), 1), null)
  assert.equal(validateStage(stage({ data: null }), 1), null)
  assert.ok(validateStage(stage(), 7))
})

test('a different wizardId starts a fresh stage set', () => {
  const state = foldWizardState([
    call(stage({ wizardId: 'a', stageId: 'needs', version: 1 })),
    call(stage({ wizardId: 'b', stageId: 'needs', version: 1, data: { fields: [{ key: 'x' }] } })),
  ])
  assert.equal(state.wizardId, 'b')
  assert.equal(state.stages.length, 1)
  assert.deepEqual(state.stages[0].data, { fields: [{ key: 'x' }] })
})
