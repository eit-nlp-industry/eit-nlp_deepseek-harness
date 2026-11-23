import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  applyDeliveryCompleted,
  applyFailedTerminal,
  applyReview,
  applyStartDelivery,
  applySubmission,
  applyUserResumed,
  bootstrapFlow,
  ledgerPolicyForVerdict,
  validateReview,
  validateSubmission,
} from './index.js'

const root = path.dirname(fileURLToPath(import.meta.url))

async function loadExample(...parts) {
  const text = await readFile(path.join(root, 'examples', ...parts), 'utf8')
  return JSON.parse(text)
}

function baseSubmission(overrides = {}) {
  return {
    schemaVersion: 1,
    submission_id: 'sub-001',
    event_id: 'evt-sub-001',
    project_id: 'todo-demo',
    kind: 'initial',
    prd_revision: 'prd-sha-aaaa1111',
    code_revision: 'abc1234',
    readonly_tree_ref: '.flow/trees/sub-001',
    artifact_manifest_ref: '.flow/submissions/sub-001.artifacts.json',
    requirement_evidence_map_ref: '.flow/submissions/sub-001.requirements.json',
    previous_submission_id: null,
    remediation_summary_ref: null,
    addresses_finding_ids: [],
    self_check_status: 'passed',
    self_check_summary: 'ok',
    final_verification_ref: 'artifacts/verification-report.json',
    submitted_at: '2026-11-23T02:00:00.000Z',
    ...overrides,
  }
}

function baseReview(overrides = {}) {
  return {
    schemaVersion: 1,
    review_id: 'rev-001',
    event_id: 'evt-rev-001',
    project_id: 'todo-demo',
    submission_id: 'sub-001',
    reviewed_revision: 'abc1234',
    prd_revision: 'prd-sha-aaaa1111',
    verdict: 'passed',
    summary: 'ok',
    findings: [],
    out_of_scope_suggestions: [],
    ledger_refs: [],
    reviewed_at: '2026-11-23T02:10:00.000Z',
    ...overrides,
  }
}

test('bootstrap creates developing flow', () => {
  const result = bootstrapFlow({
    project_id: 'todo-demo',
    project_root: '/projects/todo-demo',
    development_session_id: 'sess-dev',
    acceptance_session_id: 'sess-acc',
    at: '2026-11-23T01:00:00.000Z',
    event_id: 'evt-boot',
  })
  assert.equal(result.ok, true)
  assert.equal(result.flow.flow_status, 'developing')
  assert.equal(result.findings.items.length, 0)
})

test('happy path: submit → pass → deliver', async () => {
  const boot = bootstrapFlow({
    project_id: 'todo-demo',
    project_root: '/projects/todo-demo',
    development_session_id: 'sess-dev-todo-001',
    acceptance_session_id: 'sess-acc-todo-001',
    at: '2026-11-23T01:00:00.000Z',
    event_id: 'evt-boot',
  })
  const submission = await loadExample('todo-happy', 'submission.sub-001.json')
  const submitted = applySubmission({ flow: boot.flow, submission, findings: boot.findings })
  assert.equal(submitted.ok, true)
  assert.equal(submitted.flow.flow_status, 'awaiting_acceptance')
  assert.equal(submitted.flow.active_submission_id, 'sub-001')

  const review = await loadExample('todo-happy', 'review.rev-001.passed.json')
  const reviewed = applyReview({
    flow: submitted.flow,
    submission,
    review,
    findings: submitted.findings,
  })
  assert.equal(reviewed.ok, true)
  assert.equal(reviewed.flow.flow_status, 'acceptance_passed')
  assert.equal(reviewed.ledgerPolicy.countViolation, false)
  assert.equal(reviewed.ledgerPolicy.acceptanceVerdict, 'pass')
  // out_of_scope suggestions must not become remediation tasks
  assert.equal(reviewed.remediationTasks.length, 0)

  const delivering = applyStartDelivery({
    flow: reviewed.flow,
    event_id: 'evt-del-1',
    at: '2026-11-23T02:20:00.000Z',
  })
  assert.equal(delivering.flow.flow_status, 'delivering')

  const done = applyDeliveryCompleted({
    flow: delivering.flow,
    event_id: 'evt-del-2',
    at: '2026-11-23T02:30:00.000Z',
  })
  assert.equal(done.flow.flow_status, 'delivery_completed')
})

test('remediation path: changes_required → fix → retest pass keeps FIND-001', async () => {
  const boot = bootstrapFlow({
    project_id: 'todo-demo',
    project_root: '/projects/todo-demo',
    development_session_id: 'sess-dev',
    acceptance_session_id: 'sess-acc',
    event_id: 'evt-boot',
    at: '2026-11-23T01:00:00.000Z',
  })
  const initial = await loadExample('todo-happy', 'submission.sub-001.json')
  const submitted = applySubmission({ flow: boot.flow, submission: initial, findings: boot.findings })
  assert.equal(submitted.ok, true)

  const failReview = await loadExample('todo-remediation', 'review.rev-001.changes_required.json')
  const failed = applyReview({
    flow: submitted.flow,
    submission: initial,
    review: failReview,
    findings: submitted.findings,
  })
  assert.equal(failed.ok, true)
  assert.equal(failed.flow.flow_status, 'remediating')
  assert.equal(failed.flow.remediation_round, 1)
  assert.equal(failed.ledgerPolicy.countViolation, true)
  assert.equal(failed.remediationTasks[0].finding_id, 'FIND-001')
  assert.equal(failed.findings.items[0].finding_id, 'FIND-001')
  assert.equal(failed.findings.items[0].status, 'open')

  const sub2 = await loadExample('todo-remediation', 'submission.sub-002.json')
  const resubmitted = applySubmission({
    flow: failed.flow,
    submission: sub2,
    findings: failed.findings,
  })
  assert.equal(resubmitted.ok, true)
  assert.equal(resubmitted.flow.flow_status, 'awaiting_acceptance')
  assert.equal(resubmitted.flow.active_submission_id, 'sub-002')
  assert.equal(resubmitted.findings.items[0].status, 'fixed_pending_retest')

  const passReview = await loadExample('todo-remediation', 'review.rev-002.passed.json')
  const passed = applyReview({
    flow: resubmitted.flow,
    submission: sub2,
    review: passReview,
    findings: resubmitted.findings,
  })
  assert.equal(passed.ok, true)
  assert.equal(passed.flow.flow_status, 'acceptance_passed')
  assert.equal(passed.findings.items.length, 1)
  assert.equal(passed.findings.items[0].finding_id, 'FIND-001')
  assert.equal(passed.findings.items[0].status, 'retested_passed')
  assert.equal(passed.findings.items[0].history.length >= 3, true)
})

test('blocked does not count as violation and requires resubmit', async () => {
  const boot = bootstrapFlow({
    project_id: 'todo-demo',
    project_root: '/projects/todo-demo',
    development_session_id: 'sess-dev',
    acceptance_session_id: 'sess-acc',
    event_id: 'evt-boot',
    at: '2026-11-23T01:00:00.000Z',
  })
  const submission = await loadExample('todo-happy', 'submission.sub-001.json')
  const submitted = applySubmission({ flow: boot.flow, submission, findings: boot.findings })
  const blockedReview = await loadExample('todo-blocked', 'review.rev-blocked.json')
  const blocked = applyReview({
    flow: submitted.flow,
    submission,
    review: blockedReview,
    findings: submitted.findings,
  })
  assert.equal(blocked.ok, true)
  assert.equal(blocked.flow.flow_status, 'awaiting_user')
  assert.equal(blocked.flow.waiting_reason, 'acceptance_blocked')
  assert.equal(blocked.ledgerPolicy.countViolation, false)
  assert.equal(blocked.ledgerPolicy.recordAcceptance, false)

  const resume = applyUserResumed({
    flow: blocked.flow,
    event_id: 'evt-resume-bad',
    at: '2026-11-23T02:06:00.000Z',
  })
  assert.equal(resume.ok, false)
  assert.equal(resume.code, 'MUST_RESUBMIT')

  const badInitial = applySubmission({
    flow: blocked.flow,
    submission: baseSubmission({
      submission_id: 'sub-001b',
      event_id: 'evt-sub-001b',
      kind: 'initial',
      submitted_at: '2026-11-23T02:07:00.000Z',
    }),
    findings: blocked.findings,
  })
  assert.equal(badInitial.ok, false)

  const resubmit = applySubmission({
    flow: blocked.flow,
    submission: baseSubmission({
      submission_id: 'sub-001b',
      event_id: 'evt-sub-001b',
      kind: 'remediation',
      previous_submission_id: 'sub-001',
      remediation_summary_ref: '.flow/submissions/sub-001b.remediation.md',
      addresses_finding_ids: ['FIND-ENV-001'],
      code_revision: 'abc9999',
      submitted_at: '2026-11-23T02:07:00.000Z',
    }),
    findings: blocked.findings,
  })
  assert.equal(resubmit.ok, true)
  assert.equal(resubmit.flow.flow_status, 'awaiting_acceptance')
})

test('duplicate event_id is ignored', () => {
  const boot = bootstrapFlow({
    project_id: 'todo-demo',
    project_root: '/projects/todo-demo',
    development_session_id: 'sess-dev',
    acceptance_session_id: 'sess-acc',
    event_id: 'evt-boot',
    at: '2026-11-23T01:00:00.000Z',
  })
  const submission = baseSubmission()
  const first = applySubmission({ flow: boot.flow, submission, findings: boot.findings })
  const second = applySubmission({ flow: first.flow, submission, findings: first.findings })
  assert.equal(second.ok, true)
  assert.equal(second.ignored, true)
  assert.equal(second.flow.flow_status, 'awaiting_acceptance')

  const review = baseReview()
  const reviewed = applyReview({
    flow: first.flow,
    submission,
    review,
    findings: first.findings,
  })
  const again = applyReview({
    flow: reviewed.flow,
    submission,
    review,
    findings: reviewed.findings,
  })
  assert.equal(again.ignored, true)
  assert.equal(again.flow.flow_status, 'acceptance_passed')
})

test('old passed review cannot release a newer active submission', () => {
  const boot = bootstrapFlow({
    project_id: 'todo-demo',
    project_root: '/projects/todo-demo',
    development_session_id: 'sess-dev',
    acceptance_session_id: 'sess-acc',
    event_id: 'evt-boot',
    at: '2026-11-23T01:00:00.000Z',
  })
  const sub1 = baseSubmission()
  const s1 = applySubmission({ flow: boot.flow, submission: sub1, findings: boot.findings })
  const failReview = baseReview({
    verdict: 'changes_required',
    findings: [{
      finding_id: 'FIND-001',
      requirement_id: 'REQ-4',
      category: 'behavior_defect',
      blocking: true,
      description: 'bug',
      evidence_refs: [{ kind: 'test_report', ref: 'a.log' }],
      acceptance_condition: 'fixed',
      status: 'open',
    }],
  })
  const failed = applyReview({
    flow: s1.flow,
    submission: sub1,
    review: failReview,
    findings: s1.findings,
  })
  const sub2 = baseSubmission({
    submission_id: 'sub-002',
    event_id: 'evt-sub-002',
    kind: 'remediation',
    previous_submission_id: 'sub-001',
    remediation_summary_ref: 'r.md',
    addresses_finding_ids: ['FIND-001'],
    code_revision: 'def5678',
    submitted_at: '2026-11-23T03:00:00.000Z',
  })
  const s2 = applySubmission({ flow: failed.flow, submission: sub2, findings: failed.findings })
  assert.equal(s2.flow.active_submission_id, 'sub-002')

  const stalePass = baseReview({
    review_id: 'rev-stale',
    event_id: 'evt-rev-stale',
    submission_id: 'sub-001',
    reviewed_revision: 'abc1234',
    verdict: 'passed',
    findings: [],
    reviewed_at: '2026-11-23T03:05:00.000Z',
  })
  const rejected = applyReview({
    flow: s2.flow,
    submission: sub2,
    review: stalePass,
    findings: s2.findings,
  })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'STALE_OR_FOREIGN_SUBMISSION')
})

test('revision mismatch is rejected', () => {
  const boot = bootstrapFlow({
    project_id: 'todo-demo',
    project_root: '/projects/todo-demo',
    development_session_id: 'sess-dev',
    acceptance_session_id: 'sess-acc',
    event_id: 'evt-boot',
    at: '2026-11-23T01:00:00.000Z',
  })
  const submission = baseSubmission()
  const submitted = applySubmission({ flow: boot.flow, submission, findings: boot.findings })
  const review = baseReview({ reviewed_revision: 'deadbeef' })
  const rejected = applyReview({
    flow: submitted.flow,
    submission,
    review,
    findings: submitted.findings,
  })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'REVISION_MISMATCH')
})

test('project_id mismatch is rejected', () => {
  const boot = bootstrapFlow({
    project_id: 'todo-demo',
    project_root: '/projects/todo-demo',
    development_session_id: 'sess-dev',
    acceptance_session_id: 'sess-acc',
    event_id: 'evt-boot',
    at: '2026-11-23T01:00:00.000Z',
  })
  const rejected = applySubmission({
    flow: boot.flow,
    submission: baseSubmission({ project_id: 'other-project' }),
    findings: boot.findings,
  })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'PROJECT_ID_MISMATCH')
})

test('max remediation rounds enter needs_manual', () => {
  let boot = bootstrapFlow({
    project_id: 'todo-demo',
    project_root: '/projects/todo-demo',
    development_session_id: 'sess-dev',
    acceptance_session_id: 'sess-acc',
    max_remediation_rounds: 1,
    event_id: 'evt-boot',
    at: '2026-11-23T01:00:00.000Z',
  })
  const sub1 = baseSubmission()
  let state = applySubmission({ flow: boot.flow, submission: sub1, findings: boot.findings })
  const finding = {
    finding_id: 'FIND-001',
    requirement_id: 'REQ-4',
    category: 'behavior_defect',
    blocking: true,
    description: 'bug',
    evidence_refs: [{ kind: 'test_report', ref: 'a.log' }],
    acceptance_condition: 'fixed',
    status: 'open',
  }
  state = applyReview({
    flow: state.flow,
    submission: sub1,
    review: baseReview({ verdict: 'changes_required', findings: [finding] }),
    findings: state.findings,
  })
  assert.equal(state.flow.flow_status, 'remediating')
  assert.equal(state.flow.remediation_round, 1)

  const sub2 = baseSubmission({
    submission_id: 'sub-002',
    event_id: 'evt-sub-002',
    kind: 'remediation',
    previous_submission_id: 'sub-001',
    remediation_summary_ref: 'r.md',
    addresses_finding_ids: ['FIND-001'],
    code_revision: 'def5678',
    submitted_at: '2026-11-23T03:00:00.000Z',
  })
  state = applySubmission({ flow: state.flow, submission: sub2, findings: state.findings })
  state = applyReview({
    flow: state.flow,
    submission: sub2,
    review: baseReview({
      review_id: 'rev-002',
      event_id: 'evt-rev-002',
      submission_id: 'sub-002',
      reviewed_revision: 'def5678',
      verdict: 'changes_required',
      findings: [{ ...finding, status: 'retested_failed' }],
      reviewed_at: '2026-11-23T03:10:00.000Z',
    }),
    findings: state.findings,
  })
  assert.equal(state.ok, true)
  assert.equal(state.flow.flow_status, 'needs_manual')
  assert.equal(state.flow.waiting_reason, 'max_rounds_exceeded')
})

test('passed with blocking finding fails validation', () => {
  const result = validateReview(baseReview({
    findings: [{
      finding_id: 'FIND-001',
      requirement_id: 'REQ-1',
      category: 'behavior_defect',
      blocking: true,
      description: 'still broken',
      evidence_refs: [{ kind: 'test_report', ref: 'a.log' }],
      acceptance_condition: 'fixed',
      status: 'open',
    }],
  }))
  assert.equal(result.ok, false)
  assert.equal(result.code, 'PASSED_WITH_BLOCKING')
})

test('self_check blocked cannot submit as success', () => {
  const boot = bootstrapFlow({
    project_id: 'todo-demo',
    project_root: '/projects/todo-demo',
    development_session_id: 'sess-dev',
    acceptance_session_id: 'sess-acc',
    event_id: 'evt-boot',
    at: '2026-11-23T01:00:00.000Z',
  })
  const checked = validateSubmission(baseSubmission({
    self_check_status: 'blocked',
    final_verification_ref: null,
  }))
  // structural: blocked may omit final_verification_ref
  assert.equal(checked.ok, true)
  const rejected = applySubmission({
    flow: boot.flow,
    submission: checked.value,
    findings: boot.findings,
  })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'SELF_CHECK_NOT_PASSED')
})

test('ledger policy maps verdicts', () => {
  assert.deepEqual(ledgerPolicyForVerdict('blocked'), {
    recordAcceptance: false,
    acceptanceVerdict: null,
    writeErrorBook: false,
    countViolation: false,
  })
  assert.equal(ledgerPolicyForVerdict('changes_required').countViolation, true)
})

test('failed_terminal from developing', () => {
  const boot = bootstrapFlow({
    project_id: 'todo-demo',
    project_root: '/projects/todo-demo',
    development_session_id: 'sess-dev',
    acceptance_session_id: 'sess-acc',
    event_id: 'evt-boot',
    at: '2026-11-23T01:00:00.000Z',
  })
  const result = applyFailedTerminal({
    flow: boot.flow,
    detail: '无法继续',
    event_id: 'evt-fail',
    at: '2026-11-23T01:30:00.000Z',
  })
  assert.equal(result.ok, true)
  assert.equal(result.flow.flow_status, 'failed_terminal')
})
