/**
 * Deterministic card constructors, checker and submit audit for the
 * 校园活动筹备助手 preset.
 *
 * The runtime never hands a tool the rendered payload, so `checkCard` inspects the
 * arguments a caller is about to pass to `render_ui`, not the generated spec.
 * @module @local/dsh-campus-activity-preset/cards
 */

/** Closed-value keys and their allowed values. */
export const CLOSED = {
  action: { values: ['confirm', 'back', 'continue', 'reset'], fallback: { confirm: 'confirm', back: 'back', continue: 'continue', reset: 'reset_yes|reset_no' } },
  reset_confirm: { values: ['yes', 'no'], fallback: { yes: 'yes', no: 'no' } },
  decision: { values: ['confirm', 'back'], fallback: { confirm: 'confirm', back: 'back' } },
}

/** Keys that must be numeric fields when present. */
const NUMERIC_KEYS = ['headcount', 'budget', 'budgetCap', 'durationHours', 'duration', 'qty', 'quantity', 'unit', 'unitPrice', 'price', 'amount', 'count']

const SUBMIT = '{"action":"form.submit","params":{"eventName":"form.submit"}}'
const BACK_OPTION = { value: 'back', label: '返回修改', description: '回到可编辑的步骤，保留已填写的数据' }

const fail = (code, path, fix) => ({ code, path, fix })

/**
 * Build one canonical card argument set for render_ui.
 * @param {'need_form'|'pick_one'|'confirm_card'} shape
 * @param {object} input
 * @returns {{mode:string,intent:string,components?:string[],business_data:object,user_query:string}}
 */
export function buildCard(shape, input = {}) {
  if (shape === 'need_form') {
    const fields = (input.fields ?? []).map(field => ({
      key: String(field.key),
      label: String(field.label ?? field.key),
      type: field.type === 'number' ? 'number' : 'text',
      value: field.value ?? '',
    }))
    if (!fields.some(field => field.key === 'action')) {
      fields.push({ key: 'action', label: '本步操作（continue 继续 / back 返回 / reset 重置）', type: 'text', value: 'continue' })
    }
    return {
      mode: 'form',
      intent: 'rich_content',
      business_data: { title: input.title ?? '需求确认', note: input.note ?? '', fields },
      user_query: `第 ${input.step ?? 1} 步需求确认卡：用 DynamicForm 按 business_data.fields 顺序渲染（全部为 text 或 number，不使用 select）；底部只放一个按钮「提交」，on.press 必须正好是 ${SUBMIT}。`,
    }
  }

  if (shape === 'pick_one') {
    const options = (input.options ?? []).map(option => ({
      value: String(option.value),
      label: String(option.label),
      description: String(option.description ?? ''),
    }))
    if (!options.some(option => option.value === 'back')) options.push({ ...BACK_OPTION })
    if (options.length < 2) throw new Error('pick_one 至少需要 2 个候选')
    return {
      mode: 'form',
      intent: 'generic_pick_one',
      business_data: { title: input.title ?? '请选择', question: input.question ?? '', options, note: input.note ?? '' },
      user_query: `展示候选差异，让用户单选提交；底部只放一个按钮「提交」，on.press 必须正好是 ${SUBMIT}。`,
    }
  }

  if (shape === 'confirm_card') {
    const fields = [{ key: 'action', label: '本步操作（confirm 确认 / back 返回修改）', type: 'text', value: 'confirm' }]
    const card = {
      mode: 'form',
      intent: 'rich_content',
      business_data: { title: input.title ?? '最终确认', summary: input.summary ?? [], note: input.note ?? '', fields },
      user_query: `最终确认卡：摘要列表 + 文本 action（confirm / back）+ 只读 Workflow（若有），不使用 select；底部只放一个按钮「提交」，on.press 必须正好是 ${SUBMIT}。`,
    }
    if (input.workflow !== undefined) {
      card.components = ['Workflow']
      card.business_data.workflow = input.workflow
    }
    return card
  }

  throw new Error(`未知卡片形态：${shape}`)
}

/**
 * Check one render_ui argument set against the deterministic rules.
 * @returns {{ok:boolean, violations:Array<{code:string,path:string,fix?:object}>}}
 */
export function checkCard(args = {}) {
  const violations = []
  const rich = args.intent === 'rich_content' || Array.isArray(args.components)
  const fields = Array.isArray(args.business_data?.fields) ? args.business_data.fields : []
  const options = Array.isArray(args.business_data?.options) ? args.business_data.options : []

  for (const [index, field] of fields.entries()) {
    if (rich && field?.type === 'select') {
      violations.push(fail('RICH_SELECT', `business_data.fields[${index}].type`, {
        replace_with: 'generic_pick_one',
        options: [{ value: 'continue', label: '继续' }, { value: 'back', label: '返回修改' }],
      }))
    }
    if (CLOSED[field?.key] !== undefined && field?.type !== 'text') {
      violations.push(fail('CLOSED_TEXT', `business_data.fields[${index}].type`, {
        replace_with: 'text',
        allowed: CLOSED[field.key].values,
      }))
    }
    if (NUMERIC_KEYS.includes(field?.key) && field?.type !== 'number') {
      violations.push(fail('TYPE_MISMATCH', `business_data.fields[${index}].type`, { replace_with: 'number' }))
    }
  }

  if (args.intent === 'generic_pick_one') {
    if (options.length < 2) {
      violations.push(fail('OPTIONS_MIN', 'business_data.options', { min: 2, has: options.length }))
    }
    for (const [index, option] of options.entries()) {
      if (!option?.value || !option?.label || option?.description === undefined) {
        violations.push(fail('OPTIONS_MIN', `business_data.options[${index}]`, { require: ['value', 'label', 'description'] }))
      }
    }
    if (!options.some(option => option?.value === 'back')) {
      violations.push(fail('OPTIONS_BACK', 'business_data.options', { append: BACK_OPTION }))
    }
  }

  const actionField = fields.find(field => field?.key === 'action')
  if (actionField !== undefined) {
    const allowed = CLOSED.action.values
    const label = String(actionField.label ?? '')
    if (!allowed.some(value => label.includes(value))) {
      violations.push(fail('MAPPING_GAP', 'business_data.fields[action].label', {
        missing: allowed,
        label: `本步操作（continue 继续 / back 返回修改 / reset 重置 / confirm 确认）`,
      }))
    }
  }

  if (typeof args.user_query !== 'string' || !args.user_query.includes(SUBMIT)) {
    violations.push(fail('BUTTON_SHAPE', 'user_query', { append: `on.press 必须是 ${SUBMIT}` }))
  }

  return { ok: violations.length === 0, violations }
}

/**
 * Audit one submitted payload against the keys the card declared.
 * @param {{ declared: string[], payload: Record<string, unknown>, fallbackFor?: string }} input
 */
export function auditSubmit(input = {}) {
  const declared = Array.isArray(input.declared) ? input.declared : []
  const payload = input.payload !== null && typeof input.payload === 'object' ? input.payload : {}
  const missing = declared.filter(key => payload[key] === undefined || payload[key] === null || payload[key] === '')
  const result = { ok: missing.length === 0, missing, fallback: null }
  if (missing.includes('action') && CLOSED.action !== undefined) {
    result.fallback = buildCard('pick_one', {
      title: '操作没有提交成功，请重新选择',
      question: '上一步的 action 值没有回传，请直接选择下一步操作',
      options: [
        { value: 'continue', label: '继续下一步', description: '按当前数据继续' },
        { value: 'back', label: '返回修改', description: '回到上一步修改' },
      ],
    })
  }
  return result
}
