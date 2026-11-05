/**
 * Turn json-render events into the user message already sent for form submits.
 * The message is queued with `session.prompt` as user text. Workflow documents,
 * parameters, order ids, and items stay user-provided data.
 */
import type { JsonRenderEvent, JsonRenderPayload } from '@eit/json-render-protocol'

const FORM_INTRO = '用户提交了 json-render 表单，请根据这些值继续，不要再次弹出同一张表：'
const WORKFLOW_INTRO = '我确认提交以下编辑后的流程。请在下一条回复实际调用 render_ui，用 mode="display"、components=["Workflow"]、intent="rich_content" 和 answer_presentation="replace" 生成更新后的可编辑流程卡片。根据下文还原 workflow-v1 文档，保留流程 ID、步骤顺序、分支、说明和参数。把文档放入 business_data.workflow。将其初始化到 /_ui/workflow，Workflow 使用可编辑模式并通过 $bindState 绑定该路径。保留「保存流程」按钮，点击时发出 workflow.save，payload.workflow 从 /_ui/workflow 读取最新值，payload.parameters 使用下方参数。使用一个 Stack，只放 Workflow 和「保存流程」按钮。流程名称显示在编辑器内。'
const ORDER_INTRO = '用户提交了 json-render 排序，请根据这些数据继续：'

const WORKFLOW_INCOMPLETE = '流程数据不完整，无法提交'
const WORKFLOW_DUPLICATE = '流程条目 ID 重复，无法提交'
const WORKFLOW_PARAMETERS = '流程参数缺失或不完整，无法提交'
const ORDER_INCOMPLETE = '排序 ID 不完整，无法提交'
const ORDER_DUPLICATE = '排序 ID 重复，无法提交'
const ORDER_ITEMS = '缺少条目数据，无法提交'
const ITEM_DUPLICATE = '条目 ID 重复，无法提交'

/** One sortable or business record identified by a non-empty id. */
interface ItemRecord extends Record<string, unknown> {
  id: string
}

/** Original payload plus facts from the `render_ui` call that produced it. */
export interface JsonRenderSubmitSources {
  payload: JsonRenderPayload
  /** `business_data` from the tool call. Absent when the call did not send any. */
  businessData?: unknown
}

/** What the card should do with one renderer event. */
export type JsonRenderSubmitDecision =
  | { action: 'ignore' }
  | { action: 'reject'; notice: string }
  | { action: 'send'; text: string; releaseOnSuccess: boolean }

/**
 * Values carried by one form submit.
 * @param event - renderer event. A missing payload or a payload without `form` yields the payload or an empty object.
 * @returns the submitted values.
 */
export function formValues(event: JsonRenderEvent): unknown {
  const payload = event.payload
  if (payload === undefined) return {}
  return 'form' in payload ? payload.form : payload
}

/**
 * Read `business_data` from a `render_ui` tool-call arguments string.
 * @param raw - JSON arguments stored on the tool call.
 * @returns the business data value, or undefined when the arguments do not carry it.
 */
export function businessDataFromToolArguments(raw: unknown): unknown {
  if (typeof raw !== 'string') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    // Tool arguments are model JSON. Unreadable arguments carry no business data.
    void error
    return undefined
  }
  if (!isRecord(parsed) || !('business_data' in parsed)) return undefined
  return parsed.business_data
}

/**
 * Decide how one renderer event continues the session.
 * The event name selects the action. `workflow.save` and `route.order.apply` arrive as clicks.
 * `workflow.change`, `workflow.select`, `workflow.execute`, and `route.order.change` do not send.
 * @param event - renderer event carrying the latest edited values.
 * @param sources - original payload and the call's business data. Item records come from these, not from a fixed state path.
 * @returns ignore, a notice that leaves the edit in place, or the user-message body.
 */
export function decideJsonRenderSubmit(event: JsonRenderEvent, sources: JsonRenderSubmitSources): JsonRenderSubmitDecision {
  const name = event.event.name
  if (name === 'form.submit') {
    return { action: 'send', releaseOnSuccess: false, text: userBody(FORM_INTRO, formValues(event)) }
  }
  if (name === 'workflow.save') return workflowDecision(event.payload)
  if (name === 'route.order.apply') return orderDecision(event.payload, sources)
  return { action: 'ignore' }
}

function workflowDecision(payload: JsonRenderEvent['payload']): JsonRenderSubmitDecision {
  if (!isRecord(payload) || !isRecord(payload.parameters)) return { action: 'reject', notice: WORKFLOW_PARAMETERS }
  // Chat presents the receipt line. Session history retains the rendering request and submitted data.
  const lines = ['我已提交编辑后的流程', '<!-- dsh:workflow-submit -->', WORKFLOW_INTRO, '']
  const issue = describeWorkflow(payload.workflow, lines)
  if (issue !== null) return { action: 'reject', notice: issue }
  return {
    action: 'send',
    releaseOnSuccess: true,
    text: [...lines, '', ...describeParameter('流程参数', payload.parameters)].join('\n'),
  }
}

function orderDecision(payload: JsonRenderEvent['payload'], sources: JsonRenderSubmitSources): JsonRenderSubmitDecision {
  const order = isRecord(payload) ? payload.order : undefined
  if (!isStringList(order)) return { action: 'reject', notice: ORDER_INCOMPLETE }
  if (new Set(order).size !== order.length) return { action: 'reject', notice: ORDER_DUPLICATE }
  const primary = sortableItemLists(sources.payload)
  const secondary = otherItemLists(sources, primary)
  return orderFromLists(order, primary) ?? orderFromLists(order, secondary) ?? { action: 'reject', notice: ORDER_ITEMS }
}

function userBody(intro: string, data: unknown): string {
  return `${intro}\n${JSON.stringify(data)}`
}

function describeParameter(label: string, value: unknown, indent = ''): string[] {
  const entries = Array.isArray(value)
    ? value.map((item, index) => [`第 ${index + 1} 项`, item] as const)
    : isRecord(value) ? Object.entries(value) : undefined
  if (entries === undefined) return [`${indent}${label}：${JSON.stringify(value)}`]
  const kind = Array.isArray(value) ? '列表' : '对象'
  if (entries.length === 0) return [`${indent}${label}：空${kind}`]
  return [`${indent}${label}（${kind}）`, ...entries.flatMap(([key, item]) => describeParameter(key, item, `${indent}  `))]
}

function describeWorkflow(workflow: unknown, lines: string[]): string | null {
  if (!isRecord(workflow) || workflow.version !== 'workflow-v1' || !nonEmpty(workflow.id) || !nonEmpty(workflow.title)) {
    return WORKFLOW_INCOMPLETE
  }
  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) return WORKFLOW_INCOMPLETE
  lines.push(`流程名称：${workflow.title}`, `流程 ID：${workflow.id}`, '流程步骤')
  const ids = new Set<string>([workflow.id])
  for (const [index, step] of workflow.steps.entries()) {
    const issue = describeNode(step, ids, lines, index + 1, '')
    if (issue !== null) return issue
  }
  return null
}

function describeNode(node: unknown, ids: Set<string>, lines: string[], position: number, indent: string): string | null {
  if (!isRecord(node) || !nonEmpty(node.title) || !nonEmpty(node.id)) return WORKFLOW_INCOMPLETE
  const taken = takeId(ids, node.id)
  if (taken !== null) return taken
  const kind = node.type === 'condition' ? '条件' : '步骤'
  lines.push(`${indent}${position}. ${kind}：${node.title}（ID：${node.id}）`)
  if (typeof node.description === 'string') lines.push(`${indent}   说明：${node.description}`)
  if (node.type === 'step') return null
  if (node.type !== 'condition' || indent !== '') return WORKFLOW_INCOMPLETE
  if (!Array.isArray(node.branches) || node.branches.length < 1 || node.branches.length > 2) return WORKFLOW_INCOMPLETE
  for (const branch of node.branches) {
    if (!isRecord(branch) || !nonEmpty(branch.label) || !nonEmpty(branch.id) || !Array.isArray(branch.steps)) return WORKFLOW_INCOMPLETE
    const branchId = takeId(ids, branch.id)
    if (branchId !== null) return branchId
    lines.push(`   - 分支：${branch.label}（ID：${branch.id}）`)
    if (branch.steps.length === 0) lines.push('     无步骤')
    for (const [index, child] of branch.steps.entries()) {
      const issue = describeNode(child, ids, lines, index + 1, '     ')
      if (issue !== null) return issue
    }
  }
  return null
}

function takeId(ids: Set<string>, id: unknown): string | null {
  if (!nonEmpty(id)) return WORKFLOW_INCOMPLETE
  if (ids.has(id)) return WORKFLOW_DUPLICATE
  ids.add(id)
  return null
}

function sortableItemLists(payload: JsonRenderPayload): ItemRecord[][] {
  const initial = payload.state?.initial
  const lists: ItemRecord[][] = []
  for (const element of Object.values(payload.spec.elements)) {
    if (element.type !== 'SortableSequence' || !isRecord(element.props)) continue
    const items = resolveItems(element.props.items, initial)
    if (items !== null) lists.push(items)
  }
  return lists
}

function resolveItems(items: unknown, initial: unknown): ItemRecord[] | null {
  if (isItemList(items)) return items
  if (!isRecord(items) || typeof items.$state !== 'string') return null
  const resolved = readPointer(initial, items.$state)
  return isItemList(resolved) ? resolved : null
}

function otherItemLists(sources: JsonRenderSubmitSources, primary: ItemRecord[][]): ItemRecord[][] {
  const skip = new Set<ItemRecord[]>(primary)
  return [...itemLists(sources.payload), ...itemLists(sources.businessData)].filter(list => !skip.has(list))
}

function itemLists(value: unknown): ItemRecord[][] {
  const found: ItemRecord[][] = []
  const seen = new Set<unknown>()
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      if (isItemList(node)) found.push(node)
      for (const entry of node) visit(entry)
      return
    }
    for (const entry of Object.values(node)) visit(entry)
  }
  visit(value)
  return found
}

function orderFromLists(ids: readonly string[], lists: readonly ItemRecord[][]): JsonRenderSubmitDecision | undefined {
  let incomplete = false
  let duplicateItems = false
  for (const list of lists) {
    const orderedItems = reorder(ids, list)
    if (orderedItems === undefined) continue
    if (!uniqueIds(list)) {
      duplicateItems = true
      continue
    }
    if (list.length !== ids.length) {
      incomplete = true
      continue
    }
    return { action: 'send', releaseOnSuccess: true, text: userBody(ORDER_INTRO, { order: [...ids], orderedItems }) }
  }
  if (incomplete) return { action: 'reject', notice: ORDER_INCOMPLETE }
  if (duplicateItems) return { action: 'reject', notice: ITEM_DUPLICATE }
  return undefined
}

function reorder(ids: readonly string[], list: readonly ItemRecord[]): ItemRecord[] | undefined {
  const byId = new Map(list.map(item => [item.id, item]))
  const ordered: ItemRecord[] = []
  for (const id of ids) {
    const item = byId.get(id)
    if (item === undefined) return undefined
    ordered.push(item)
  }
  return ordered
}

function uniqueIds(list: ItemRecord[]): boolean {
  return new Set(list.map(item => item.id)).size === list.length
}

function isItemList(value: unknown): value is ItemRecord[] {
  return Array.isArray(value) && value.length > 0 && value.every(isItem)
}

function isItem(value: unknown): value is ItemRecord {
  return isRecord(value) && typeof value.id === 'string' && value.id.trim() !== ''
}

function readPointer(root: unknown, pointer: string): unknown {
  if (!pointer.startsWith('/')) return undefined
  let current = root
  for (const segment of pointer.slice(1).split('/')) {
    if (current === null || typeof current !== 'object') return undefined
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~')
    const next = propertyAt(current, key)
    if (next === undefined) return undefined
    current = next
  }
  return current
}

function propertyAt(current: object, key: string): unknown {
  if (Array.isArray(current)) {
    const index = Number(key)
    if (!Number.isInteger(index) || String(index) !== key) return undefined
    return current[index]
  }
  if (!Object.hasOwn(current, key)) return undefined
  return Reflect.get(current, key)
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every(id => typeof id === 'string' && id.trim() !== '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}
