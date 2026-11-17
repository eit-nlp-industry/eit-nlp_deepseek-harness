import assert from 'node:assert/strict'
import { test } from 'node:test'
import { auditSubmit, buildCard, checkCard, CLOSED } from '../cards.js'

test('need_form 构造出合法卡片：无 select、动作是文本、数字是 number', () => {
  const card = buildCard('need_form', {
    title: '需求确认',
    fields: [
      { key: 'theme', label: '主题', type: 'text', value: '读书会' },
      { key: 'headcount', label: '人数', type: 'number', value: 25 },
    ],
  })
  const fields = card.business_data.fields
  assert.equal(card.mode, 'form')
  assert.equal(card.intent, 'rich_content')
  assert.ok(fields.every(f => f.type === 'text' || f.type === 'number'))
  assert.equal(fields.find(f => f.key === 'headcount').type, 'number')
  assert.equal(fields.at(-1).key, 'action')
  assert.match(card.user_query, /form\.submit/)
  assert.deepEqual(checkCard(card), { ok: true, violations: [] })
})

test('pick_one 自动补“返回修改”，且至少两个候选', () => {
  const card = buildCard('pick_one', { title: '选方案', options: [{ value: 'A', label: 'A', description: 'a' }] })
  assert.ok(card.business_data.options.length >= 2)
  assert.ok(card.business_data.options.some(o => o.value === 'back'))
  assert.equal(checkCard(card).ok, true)
})

test('confirm_card 带 Workflow 时声明 components', () => {
  const card = buildCard('confirm_card', { title: '确认', summary: [{ label: '人数', value: '25' }], workflow: { version: 'workflow-v1', id: 'w', title: '流程', steps: [] } })
  assert.deepEqual(card.components, ['Workflow'])
  assert.equal(card.business_data.fields[0].key, 'action')
})

test('checkCard：rich 里的 select 会被判 RICH_SELECT', () => {
  const result = checkCard({
    mode: 'form', intent: 'rich_content',
    business_data: { fields: [{ key: 'action', label: 'continue / back', type: 'select', value: 'continue' }] },
    user_query: 'on.press 必须是 {"action":"form.submit","params":{"eventName":"form.submit"}}',
  })
  assert.equal(result.ok, false)
  assert.ok(result.violations.some(v => v.code === 'RICH_SELECT'))
  assert.ok(result.violations.some(v => v.code === 'CLOSED_TEXT'))
})

test('checkCard：选项不足 / 缺返回修改', () => {
  const result = checkCard({
    mode: 'form', intent: 'generic_pick_one',
    business_data: { options: [{ value: 'A', label: 'A', description: 'a' }] },
    user_query: 'x {"action":"form.submit","params":{"eventName":"form.submit"}}',
  })
  assert.ok(result.violations.some(v => v.code === 'OPTIONS_MIN'))
  assert.ok(result.violations.some(v => v.code === 'OPTIONS_BACK'))
})

test('checkCard：人数写成文本 → TYPE_MISMATCH；缺按钮参数 → BUTTON_SHAPE', () => {
  const result = checkCard({
    mode: 'form', intent: 'rich_content',
    business_data: { fields: [{ key: 'headcount', label: '人数', type: 'text', value: 25 }] },
    user_query: '普通卡片',
  })
  assert.ok(result.violations.some(v => v.code === 'TYPE_MISMATCH'))
  assert.ok(result.violations.some(v => v.code === 'BUTTON_SHAPE'))
})

test('auditSubmit：缺 action 时产出降级单选卡', () => {
  const result = auditSubmit({ declared: ['headcount', 'action'], payload: { headcount: 25 } })
  assert.equal(result.ok, false)
  assert.deepEqual(result.missing, ['action'])
  assert.equal(result.fallback.intent, 'generic_pick_one')
  assert.ok(result.fallback.business_data.options.some(o => o.value === 'back'))
})

test('auditSubmit：字段齐全时通过', () => {
  const result = auditSubmit({ declared: ['action'], payload: { action: 'confirm' } })
  assert.equal(result.ok, true)
  assert.equal(result.fallback, null)
})

test('CLOSED 映射表覆盖动作语义', () => {
  assert.deepEqual(CLOSED.action.values, ['confirm', 'back', 'continue', 'reset'])
  assert.equal(CLOSED.action.fallback.reset, 'reset_yes|reset_no')
})
