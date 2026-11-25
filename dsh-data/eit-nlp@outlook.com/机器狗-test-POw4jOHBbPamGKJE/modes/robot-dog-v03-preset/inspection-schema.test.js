import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseObservation } from './inspection-schema.js'
import { createInspectionStore } from './inspection-store.js'

describe('parseObservation', () => {
  it('accepts a valid absence not_met observation', () => {
    const parsed = parseObservation({
      checkpoint_id: 'checkin-desk',
      inspection_round: 1,
      stream_id: 'clip-b',
      frame_id: 12,
      location_matches: true,
      view_complete: true,
      image_readable: true,
      verdict: 'not_met',
      evidence_kind: 'absence',
      observations: ['指定桌面完整可见', '未见签到处标牌'],
      reason: '缺少签到表',
      suggested_action: 'record_issue',
    })
    assert.equal(parsed.ok, true)
    assert.equal(parsed.value.evidence_kind, 'absence')
  })

  it('rejects absence not_met when view is incomplete', () => {
    const parsed = parseObservation({
      checkpoint_id: 'checkin-desk',
      inspection_round: 1,
      stream_id: 'clip-b',
      frame_id: 12,
      location_matches: true,
      view_complete: false,
      image_readable: true,
      verdict: 'not_met',
      evidence_kind: 'absence',
      reason: '没看到签到表',
    })
    assert.equal(parsed.ok, false)
    assert.match(parsed.error, /absence/)
  })

  it('accepts clear_anomaly not_met with partial but sufficient view', () => {
    const parsed = parseObservation({
      checkpoint_id: 'entry-aisle',
      inspection_round: 1,
      stream_id: 'clip-c',
      frame_id: 8,
      location_matches: true,
      view_complete: false,
      image_readable: true,
      verdict: 'not_met',
      evidence_kind: 'clear_anomaly',
      observations: ['检查区域内可见纸箱占道'],
      reason: '纸箱占据指定通行区域',
    })
    assert.equal(parsed.ok, true)
    assert.equal(parsed.value.evidence_kind, 'clear_anomaly')
  })

  it('rejects met when image is unreadable', () => {
    const parsed = parseObservation({
      checkpoint_id: 'activity-sign',
      inspection_round: 1,
      stream_id: 'clip-a',
      frame_id: 3,
      location_matches: true,
      view_complete: true,
      image_readable: false,
      verdict: 'met',
    })
    assert.equal(parsed.ok, false)
  })

  it('rejects unknown verdict', () => {
    const parsed = parseObservation({
      checkpoint_id: 'entry-aisle',
      inspection_round: 1,
      stream_id: 'clip-c',
      frame_id: 1,
      location_matches: true,
      view_complete: true,
      image_readable: true,
      verdict: 'pass',
    })
    assert.equal(parsed.ok, false)
  })
})

describe('inspection-store', () => {
  it('persists and reloads a task', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'insp-store-'))
    try {
      const store = createInspectionStore(dir)
      const task = {
        taskId: 'insp-demo',
        sessionId: 'session-1',
        phase: 'awaiting_remediation',
        streamId: 'stream-1',
        checkpoints: [],
      }
      await store.save(task)
      await store.bindSession('session-1', 'insp-demo')
      const loaded = await store.load('insp-demo')
      assert.equal(loaded.taskId, 'insp-demo')
      const pointer = await store.loadSessionPointer('session-1')
      assert.equal(pointer.taskId, 'insp-demo')
      const raw = await readFile(join(dir, 'insp-demo.json'), 'utf8')
      assert.match(raw, /awaiting_remediation/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
