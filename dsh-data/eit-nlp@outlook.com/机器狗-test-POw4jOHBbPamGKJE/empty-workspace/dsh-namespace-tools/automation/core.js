import { normalizeConfig } from '../config.js'

/** 校验业务条件；condition 为判定结果，message 为不包含接口原文的错误说明。 */
export function ensure(condition, message) {
  if (!condition) throw new Error(message)
}

/** 判断 value 是否为非数组对象，用于校验外部 JSON 结构。 */
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 校验 text 为非空字符串，max 为最大字符数。 */
function validText(text, max) {
  return typeof text === 'string' && text.trim() === text && text.length > 0 && text.length <= max
}

/**
 * 从完整注册响应筛选本轮可分类工具，仅接受布尔 true 和精确 active 状态。
 * @param payload 网站返回的 registrations 对象；空结果、重复 ID 或无效结构会拒绝。
 * @param options.allowEmpty 双来源维护允许网站为空，随后检查合并清单。
 * @returns 按 tool_id 排序的分类元数据，不包含 api_url 等连接配置。
 */
export function selectTools(payload, { allowEmpty = false } = {}) {
  ensure(object(payload) && Array.isArray(payload.registrations), 'SOURCE_INVALID: 缺少 registrations 数组')
  const selected = [], ids = new Set()
  for (const row of payload.registrations) {
    ensure(object(row), 'SOURCE_INVALID: 注册记录不是对象')
    if (row.state !== 'active' || row.enabled !== true) continue
    ensure(validText(row.tool_id, 512) && /^[A-Za-z0-9_.:-]+$/.test(row.tool_id), 'SOURCE_INVALID: 工具 ID 无效')
    ensure(!ids.has(row.tool_id), `SOURCE_DUPLICATE: ${row.tool_id}`)
    ids.add(row.tool_id)
    const description = row.description ?? ''
    ensure(typeof description === 'string' && description.length <= 32768, 'SOURCE_INVALID: 描述无效或过长')
    const input = row.effective_input_schema ?? row.input_schema ?? {}
    const output = row.output_schema ?? {}
    ensure((object(input) || typeof input === 'boolean') && (object(output) || typeof output === 'boolean'), 'SOURCE_INVALID: schema 无效')
    selected.push({ tool_id: row.tool_id, name: typeof row.name === 'string' ? row.name : row.tool_id,
      description, input_schema: input, output_schema: output })
  }
  ensure(allowEmpty || selected.length > 0, 'SOURCE_EMPTY: 没有 active 且 enabled 为 true 的工具，保留旧结果')
  return selected.sort((a, b) => a.tool_id.localeCompare(b.tool_id))
}

/** 校验 namespace 元数据列表 definitions；复用现有插件的命名、长度和重复 ID 约束。 */
function definitions(definitions) {
  ensure(Array.isArray(definitions), 'DECISION_INVALID: namespaces 必须是数组')
  if (!definitions.length) return []
  const result = normalizeConfig({ namespaces: definitions.map((entry, i) => {
    ensure(object(entry), 'DECISION_INVALID: namespace 必须是对象')
    return { id: entry.id, name: entry.name, description: entry.description, tools: [`validation_${i}`] }
  }) })
  return result.namespaces.map(({ id, name, description }) => ({ id, name, description }))
}

/**
 * 校验模型分类，现有 namespace 不得改名或改职责；namespace:null 表示信息不足。
 * @param tools prepare 筛选后的本轮工具，必须完整且唯一分配。
 * @param existing 已有分组元数据；输出引用时保持其定义。
 * @param decision 模型 JSON，namespaces 只定义新组，assignments 包含 tool_id、namespace、reason。
 */
export function classify(tools, existing, decision) {
  ensure(Array.isArray(tools) && tools.length > 0, 'DECISION_INVALID: 工具快照为空')
  ensure(object(decision) && Array.isArray(decision.assignments), 'DECISION_INVALID: 缺少 assignments')
  const known = new Map(definitions(existing).map(entry => [entry.id, entry]))
  const added = definitions(decision.namespaces)
  for (const entry of added) {
    ensure(!known.has(entry.id), `NAMESPACE_REDEFINED: ${entry.id}`)
    ensure(![...known.values()].some(n => n.name === entry.name), `NAMESPACE_DUPLICATE_NAME: ${entry.name}`)
    known.set(entry.id, entry)
  }
  const expected = new Set(tools.map(t => t.tool_id)), seen = new Set(), used = new Set()
  ensure(expected.size === tools.length, 'DECISION_INVALID: 工具快照存在重复 ID')
  const assignments = decision.assignments.map(row => {
    ensure(object(row) && expected.has(row.tool_id), 'ASSIGNMENT_UNKNOWN: 包含本轮范围外的工具')
    ensure(!seen.has(row.tool_id), `ASSIGNMENT_DUPLICATE: ${row.tool_id}`)
    ensure(validText(row.reason, 2048), `ASSIGNMENT_REASON: ${row.tool_id}`)
    ensure(row.namespace === null || known.has(row.namespace), `ASSIGNMENT_NAMESPACE: ${row.tool_id}`)
    seen.add(row.tool_id)
    if (row.namespace !== null) used.add(row.namespace)
    return { tool_id: row.tool_id, namespace: row.namespace, reason: row.reason }
  }).sort((a, b) => a.tool_id.localeCompare(b.tool_id))
  ensure(seen.size === expected.size, 'ASSIGNMENT_MISSING: 必须为每个符合条件的工具提供一条记录')
  ensure(added.every(n => used.has(n.id)), 'NAMESPACE_UNUSED: 新建分组必须有工具归属')
  return { namespaces: [...known.values()].filter(n => used.has(n.id)), assignments }
}

/**
 * 将已接受的分类转换成候选运行配置；不删除本轮范围外成员或更改可见性策略。
 * @param base 当前插件配置；eager 成员必须保持原归属。
 * @param catalog 已校验分类；namespace:null 保留该工具原归属，不把新待处理工具加入分组。
 * @param mapping 已核对的 tool_id 到完整 DSH 名称映射；包括待处理项，不能缺失或碰撞。
 */
export function compileConfig(base, catalog, mapping) {
  normalizeConfig(base)
  ensure(object(catalog) && Array.isArray(catalog.assignments), 'CATALOG_INVALID')
  // 再次通过统一分类校验，防止手工编辑 catalog 后绕过唯一归属约束。
  const checked = classify(catalog.assignments.map(a => ({ tool_id: a.tool_id })), catalog.namespaces,
    { namespaces: [], assignments: catalog.assignments })
  ensure(object(mapping), 'MAPPING_INVALID: 映射必须是对象')
  const runtimeNames = new Set()
  for (const row of checked.assignments) {
    ensure(Object.hasOwn(mapping, row.tool_id) && typeof mapping[row.tool_id] === 'string', `MAPPING_MISSING: ${row.tool_id}`)
    const name = mapping[row.tool_id]
    ensure(/^[A-Za-z0-9_.:-]+$/.test(name) && name.length <= 512, 'MAPPING_INVALID: 完整工具名无效')
    ensure(!runtimeNames.has(name), `MAPPING_COLLISION: ${name}`)
    runtimeNames.add(name)
  }
  const eager = new Set(base.eagerTools ?? [])
  // 仅确定分类的成员可移动；pending 仍完整校验映射，但保留当前配置的归属和可见性策略。
  const assigned = checked.assignments.filter(a => a.namespace !== null)
  const changedNames = new Set(assigned.map(a => mapping[a.tool_id]))
  const originalGroups = new Map(base.namespaces.flatMap(n => n.tools.map(t => [t, n.id])))
  const merged = new Map(base.namespaces.map(n => [n.id, { ...n, tools: n.tools.filter(t => !changedNames.has(t)) }]))
  for (const entry of checked.namespaces) {
    if (!merged.has(entry.id)) merged.set(entry.id, { ...entry, tools: [] })
    else {
      const old = merged.get(entry.id)
      ensure(old.name === entry.name && old.description === entry.description, `NAMESPACE_CONFLICT: ${entry.id}`)
    }
  }
  for (const row of assigned) {
    const name = mapping[row.tool_id]
    ensure(!eager.has(name) || originalGroups.get(name) === row.namespace, `EAGER_MOVE_FORBIDDEN: ${name}`)
    merged.get(row.namespace).tools.push(name)
  }
  const result = { ...base, namespaces: [...merged.values()].filter(n => n.tools.length) }
  normalizeConfig(result)
  return result
}
