import path from 'node:path'

/**
 * Prefer the outbox-baked session id so a mid-flight flow rebind cannot redirect
 * remediation / acceptance prompts to a newly opened peer session. Fall back to
 * flow when the action still carries a placeholder (pre-rebind bootstrap).
 *
 * @param {Record<string, unknown>} action
 * @param {object} context
 * @param {'development' | 'acceptance'} role
 */
function resolveSessionId(action, context, role) {
  const flow = context.flow && typeof context.flow === 'object'
    ? /** @type {Record<string, unknown>} */ (context.flow)
    : null
  if (role === 'development') {
    const fromAction = typeof action.development_session_id === 'string'
      ? action.development_session_id.trim()
      : ''
    const fromFlow = typeof flow?.development_session_id === 'string'
      ? flow.development_session_id.trim()
      : ''
    if (fromAction && !isPlaceholderSessionId(fromAction)) return fromAction
    if (fromFlow) return fromFlow
    return fromAction
  }
  const fromAction = typeof action.acceptance_session_id === 'string'
    ? action.acceptance_session_id.trim()
    : ''
  const fromFlow = typeof flow?.acceptance_session_id === 'string'
    ? flow.acceptance_session_id.trim()
    : ''
  if (fromAction) return fromAction
  return fromFlow
}

/**
 * @param {string} sessionId
 */
function isPlaceholderSessionId(sessionId) {
  const id = sessionId.toLowerCase()
  return id.includes('placeholder') || id.endsWith('-lab-dev') || id === 'pending-development'
}

/**
 * Build the session prompt for one outbox action.
 * Returns null when the action should not auto-prompt a session.
 *
 * @param {Record<string, unknown>} action
 * @param {object} [context]
 * @param {string} [context.projectRoot]
 * @param {Record<string, unknown> | null} [context.submission]
 * @param {Record<string, unknown> | null} [context.review]
 * @param {Record<string, unknown> | null} [context.findings]
 * @param {Record<string, unknown> | null} [context.flow]
 */
export function buildPromptForAction(action, context = {}) {
  const type = action.type
  if (type === 'prompt_development_start') return buildDevelopmentStartPrompt(action, context)
  if (type === 'prompt_acceptance') return buildAcceptancePrompt(action, context)
  if (type === 'prompt_development_remediation') return buildRemediationPrompt(action, context)
  if (type === 'prompt_development_delivery') return buildDeliveryPrompt(action, context)
  if (type === 'await_user') return buildAwaitUserNotice(action)
  if (type === 'needs_manual') return buildNeedsManualNotice(action)
  if (type === 'submission_rejected' || type === 'review_rejected') {
    return buildRejectionNotice(action)
  }
  return null
}

/**
 * @param {Record<string, unknown>} action
 * @param {object} context
 */
function buildDevelopmentStartPrompt(action, context) {
  const projectRoot = typeof action.project_root === 'string'
    ? action.project_root
    : (context.projectRoot ?? '.')
  const prdRel = typeof action.prd_relpath === 'string' && action.prd_relpath.trim() !== ''
    ? action.prd_relpath
    : 'PRD.md'
  const prdPath = typeof action.prd_path === 'string' && action.prd_path.trim() !== ''
    ? action.prd_path
    : path.join(projectRoot, prdRel)

  const text = [
    '【宿主协调：新项目开工】',
    `project_id: ${action.project_id}`,
    `project_root: ${projectRoot}`,
    `PRD: ${prdPath}`,
    '',
    '要求：',
    `1. 目标项目目录就是 ${projectRoot}；以该 PRD（${prdRel}）为唯一规格开始研发。`,
    '2. 不要读取或对照同目录其它 PRD 文件；规格只认上面这一份，以及 .flow/flow.json 的 prd_relpath。',
    '3. 按 development-orchestrator 阶段推进；FINAL_VERIFICATION 后进入 ACCEPTANCE_GATE 并写出 .flow/submissions/。',
    '4. 未获宿主验收放行前禁止 PACKAGE。',
    '5. 界面 todo 镜像 .development/tasks.json，同时只有一项 in_progress。',
  ].join('\n')

  return {
    target: 'development',
    session_id: resolveSessionId(action, context, 'development'),
    mode: 'queue',
    text,
    meta: {
      action_id: action.id,
      action_type: action.type,
      project_id: action.project_id,
      prd_path: prdPath,
    },
  }
}

/**
 * @param {Record<string, unknown>} action
 * @param {object} context
 */
function buildAcceptancePrompt(action, context) {
  const submission = context.submission ?? {}
  const flow = context.flow && typeof context.flow === 'object'
    ? /** @type {Record<string, unknown>} */ (context.flow)
    : null
  const projectRoot = context.projectRoot ?? '.'
  const prdRel = typeof flow?.prd_relpath === 'string' && flow.prd_relpath.trim() !== ''
    ? String(flow.prd_relpath)
    : 'PRD.md'
  const prdPath = path.join(projectRoot, prdRel)
  const submissionFile = typeof action.submission_file === 'string'
    ? action.submission_file
    : path.join('.flow/submissions', `${action.submission_id}.json`)
  const reviewPath = path.join('.flow/reviews', `rev-for-${action.submission_id}.json`)

  const text = [
    '【宿主协调：请执行结果核查】',
    `project_id: ${action.project_id}`,
    `submission_id: ${action.submission_id}`,
    `code_revision: ${submission.code_revision ?? '(见 submission 文件)'}`,
    `prd_revision: ${submission.prd_revision ?? '(见 submission 文件)'}`,
    `PRD: ${prdPath}`,
    `只读代码树: ${action.readonly_tree_ref ?? submission.readonly_tree_ref ?? ''}`,
    `送验文件: ${submissionFile}`,
    `证据清单: ${submission.artifact_manifest_ref ?? ''}`,
    `需求-证据映射: ${submission.requirement_evidence_map_ref ?? ''}`,
    `最终自检报告: ${submission.final_verification_ref ?? ''}`,
    '',
    '要求：',
    '1. 只读取上述只读树与证据，不要修改代码，不要执行测试命令。',
    `2. 只对照上述 PRD（${prdRel}），不要读取同目录其它 PRD 文件；证据不足用 blocked，有不符合项用 changes_required，满足则 passed。`,
    '3. 使用验收工具记账时必须带同一 project_id；blocked 不要记为违约 fail。',
    '4. 将结构化验收结果写入：',
    `   ${path.join(projectRoot, reviewPath)}`,
    '   必须含 event_id；每条 finding 含 category、description、evidence_refs[{kind,ref}]、acceptance_condition、status。',
    '5. findings 复用稳定 finding_id；范围外建议放 out_of_scope_suggestions，不要阻塞 passed。',
  ].join('\n')

  return {
    target: 'acceptance',
    session_id: resolveSessionId(action, context, 'acceptance'),
    mode: 'queue',
    text,
    meta: {
      action_id: action.id,
      action_type: action.type,
      project_id: action.project_id,
      submission_id: action.submission_id,
      expected_review_path: reviewPath,
    },
  }
}

/**
 * @param {Record<string, unknown>} action
 * @param {object} context
 */
function buildRemediationPrompt(action, context) {
  const tasks = Array.isArray(action.remediationTasks) ? action.remediationTasks : []
  const taskLines = tasks.length === 0
    ? ['- （无结构化任务，请读取 .flow/findings.json 与对应 review）']
    : tasks.map((task) => {
      const row = /** @type {Record<string, unknown>} */ (task)
      return `- ${row.finding_id} / ${row.requirement_id}: ${row.description}\n  复测条件: ${row.acceptance_condition}`
    })

  const text = [
    '【宿主协调：请整改并重新送验】',
    `project_id: ${action.project_id}`,
    `驳回的 submission_id: ${action.submission_id}`,
    `review_id: ${action.review_id}`,
    `当前整改轮次: ${action.remediation_round}`,
    '',
    '待处理问题：',
    ...taskLines,
    '',
    '要求：',
    '1. 进入整改实现与验证；不要进入 PACKAGE/交付。',
    '2. 修复后提交 git commit，导出只读树，写出新的 remediation submission 到 .flow/submissions/。',
    '3. previous_submission_id 必须指向被驳回的 submission；addresses_finding_ids 列出已处理编号。',
    '4. self_check_status 必须为 passed，并附真实 final_verification_ref。',
    '5. 界面 todo 仍镜像 .development/tasks.json，同时只有一项 in_progress。',
  ].join('\n')

  return {
    target: 'development',
    session_id: resolveSessionId(action, context, 'development'),
    mode: 'queue',
    text,
    meta: {
      action_id: action.id,
      action_type: action.type,
      project_id: action.project_id,
      review_id: action.review_id,
      finding_ids: tasks.map((task) => /** @type {Record<string, unknown>} */ (task).finding_id),
    },
  }
}

/**
 * @param {Record<string, unknown>} action
 * @param {object} context
 */
function buildDeliveryPrompt(action, context) {
  const text = [
    '【宿主协调：验收已通过，请继续交付】',
    `project_id: ${action.project_id}`,
    `submission_id: ${action.submission_id}`,
    `review_id: ${action.review_id}`,
    '',
    '要求：',
    '1. 当前状态为 acceptance_passed，可以离开 ACCEPTANCE_GATE。',
    '2. 继续 PACKAGE；仅当 PRD/仓库已有部署配置时再 DEPLOYMENT。',
    '3. 验收通过不等于部署成功；完成后在聊天中区分“验收通过”与“交付完成”。',
    '4. 不要修改验收结论，不要回退已关闭的 finding。',
  ].join('\n')

  return {
    target: 'development',
    session_id: resolveSessionId(action, context, 'development'),
    mode: 'queue',
    text,
    meta: {
      action_id: action.id,
      action_type: action.type,
      project_id: action.project_id,
      review_id: action.review_id,
    },
  }
}

/**
 * @param {Record<string, unknown>} action
 */
function buildAwaitUserNotice(action) {
  return {
    target: 'user',
    session_id: null,
    mode: 'none',
    text: [
      '【宿主协调：验收阻塞，等待补充材料】',
      `project_id: ${action.project_id}`,
      `review_id: ${action.review_id}`,
      `原因: ${action.waiting_detail || action.waiting_reason || ''}`,
      '',
      '请补充证据或澄清后，由研发写出新的 remediation submission 再送验。',
      '不要直接 applyUserResumed 跳过送验。',
    ].join('\n'),
    meta: {
      action_id: action.id,
      action_type: action.type,
      project_id: action.project_id,
    },
  }
}

/**
 * @param {Record<string, unknown>} action
 */
function buildNeedsManualNotice(action) {
  return {
    target: 'user',
    session_id: null,
    mode: 'none',
    text: [
      '【宿主协调：已达自动整改上限，转人工】',
      `project_id: ${action.project_id}`,
      `review_id: ${action.review_id}`,
      `waiting_reason: ${action.waiting_reason}`,
      '',
      '未关闭问题请查看 .flow/findings.json；自动循环已停止。',
    ].join('\n'),
    meta: {
      action_id: action.id,
      action_type: action.type,
      project_id: action.project_id,
      remediationTasks: action.remediationTasks ?? [],
    },
  }
}

/**
 * @param {Record<string, unknown>} action
 */
function buildRejectionNotice(action) {
  return {
    target: 'user',
    session_id: null,
    mode: 'none',
    text: [
      '【宿主协调：交接被拒绝】',
      `type: ${action.type}`,
      `code: ${action.code}`,
      `message: ${action.message}`,
      `details: ${JSON.stringify(action.details ?? {})}`,
    ].join('\n'),
    meta: {
      action_id: action.id,
      action_type: action.type,
      code: action.code,
    },
  }
}
