/**
 * HTTP client for one json-render server call, with a fixed attempt budget.
 * The server is the v0.2.7 `POST /v1/render` contract: format, user_query,
 * business_data, optional prompt_mode, and context.locale / context.intent.
 * Host mode is not a server field and does not select the catalog.
 */

import { isJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import { canonicalImageSrc, normalizeImageBusinessData, referencesImage, type MediaAssetRecord } from './media.ts'

export const RENDER_UI_MAX_ATTEMPTS = 3

export const RENDER_UI_FORMAT = 'json-render-v1'

/** Release of the json-render server and Generation SDK this host calls. */
export const JSON_RENDER_RELEASE = 'v0.2.7'

export const FORM_INTENTS = ['generic_filters', 'generic_pick_one'] as const

export const RICH_COMPONENTS = [
  'Image',
  'ImageUpload',
  'Tabs',
  'MapPreview',
  'SortableSequence',
  'Collapsible',
  'CodeBlock',
  'Workflow',
  'Chart',
] as const

export const PROMPT_MODES = ['full', 'progressive'] as const

export type RenderUiMode = 'display' | 'form'

export type FormIntent = (typeof FORM_INTENTS)[number]

export type RichComponent = (typeof RICH_COMPONENTS)[number]

export type PromptMode = (typeof PROMPT_MODES)[number]

/** Catalog the server or Generation SDK should use. */
export type RenderProfileKind = 'base' | 'forms' | 'rich'

export interface RenderUiArgs {
  mode: RenderUiMode
  /** Whether the display fully answers the request or accompanies the written answer. */
  answer_presentation?: 'replace' | 'supplement'
  user_query: string
  intent?: string
  /** Explicit rich component names. Any match selects rich_content for the whole layout. */
  components?: readonly string[]
  /** Server prompt mode. Only full or progressive are accepted. */
  prompt_mode?: string
  scene?: string
  locale?: string
  business_data?: unknown
  /** Form only: false opts out of adding a missing submit button. */
  submit_button?: boolean
  /** Label for a submit button added by the host. */
  submit_label?: string
}

export interface RenderRoute {
  profile: RenderProfileKind
  /** Omitted for base. This is the only catalog selector sent to the server. */
  intent?: FormIntent | 'rich_content'
  promptMode: PromptMode
}

export interface RenderUiSuccess {
  ok: true
  mode: RenderUiMode
  message: string
  payload: JsonValue
}

export interface RenderUiFailure {
  ok: false
  mode: RenderUiMode
  message: string
}

export type RenderUiResult = RenderUiSuccess | RenderUiFailure

/** Safe request and response fields. Never carries prompts, business data, secrets, or resource URLs. */
export interface RenderDebugRecord {
  format: typeof RENDER_UI_FORMAT
  intent?: string
  promptMode: PromptMode
  code?: string
  requestId?: string
  diagnostics?: {
    profile?: string
    stability?: string
    catalog?: string
    issues?: string[]
  }
}

export interface RequestJsonRenderOptions {
  baseUrl: string
  timeoutMs: number
  args: RenderUiArgs
  signal: AbortSignal
  fetchImpl?: typeof fetch
  /** Emit safe diagnostics. Also on when JSON_RENDER_DEBUG=1 or NODE_ENV=development. */
  debug?: boolean
  onDebug?: (record: RenderDebugRecord) => void
  /** Catalog rows this call may show. Absent when no media root is configured. */
  assets?: readonly MediaAssetRecord[]
}

const DISPLAY_MESSAGE = '界面已附上。请继续用文字回答，不要复述或改写界面 JSON。'
const FORM_MESSAGE = '界面已附上。本轮在此结束，等待用户提交。不要再调用工具，也不要复述界面 JSON。'

const RICH_COMPONENT_NAMES: ReadonlySet<string> = new Set(RICH_COMPONENTS)

/** True when business_data is a value the render server will accept. */
export function hasBusinessData(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number' || typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return false
}

const USER_QUERY_MAX_CHARS = 2000

const DISPLAY_DETAIL_HINT = '只展示回答用户问题所需的内容；不要默认附加数据明细、原始字段、坐标或运行参数表，除非用户明确要求。组件仍可使用这些数据完成渲染。'

/**
 * Choose the catalog from the business entry and explicit component names.
 * user_query wording is not a catalog selector. Host mode is not sent.
 * @param args - tool arguments.
 * @returns the profile, the intent to send, and the prompt mode.
 */
export function selectRenderRoute(args: RenderUiArgs): RenderRoute {
  const promptMode: PromptMode = args.prompt_mode === 'progressive' ? 'progressive' : 'full'
  const listed = args.components ?? []
  const needsRich = args.intent === 'rich_content' || listed.some(name => RICH_COMPONENT_NAMES.has(name))
  if (needsRich) return { profile: 'rich', intent: 'rich_content', promptMode }
  if (args.mode === 'form' && (args.intent === 'generic_filters' || args.intent === 'generic_pick_one')) {
    return { profile: 'forms', intent: args.intent, promptMode }
  }
  if (args.mode === 'form') return { profile: 'forms', promptMode }
  return { profile: 'base', promptMode }
}

/** Reject calls that the server would refuse, before any HTTP attempt. */
export function formRequestError(args: RenderUiArgs): string | undefined {
  if (args.prompt_mode !== undefined && args.prompt_mode !== 'full' && args.prompt_mode !== 'progressive') {
    return 'prompt_mode 只能是 full 或 progressive。'
  }
  if (args.mode === 'display' && !hasBusinessData(args.business_data)) {
    return '展示模式也需要非空 business_data，并且要包含回答里的条目、步骤说明、对比字段、数值和出处。不要只传标题或一句话。补全后再调用 render_ui。'
  }
  if (args.mode !== 'form') return undefined
  const route = selectRenderRoute(args)
  if (route.intent !== 'rich_content' && !FORM_INTENTS.includes(args.intent as FormIntent)) {
    return '表单模式必须提供 intent：generic_filters 或 generic_pick_one。意图不清时改用 ask_user_question，不要调用 render_ui。'
  }
  if (!hasBusinessData(args.business_data)) {
    return '表单模式需要非空 business_data，候选项必须来自已有事实，并带上名称、说明等字段。缺数据时改用 ask_user_question，不要调用 render_ui。'
  }
  return undefined
}

/** Layout text plus a display hint, kept inside the server's 2000-character limit. */
export function renderUserQuery(args: RenderUiArgs): string {
  const query = args.user_query.trim()
  const contentHint = args.mode === 'display' ? DISPLAY_DETAIL_HINT : args.submit_button === false
    ? '用户明确不需要默认提交按钮。请遵循用户指定的操作，不要额外添加提交按钮。'
    : `表单必须包含一个可见且可用的提交 Button，通过 on.press 绑定 form.submit。${args.submit_label ? `提交按钮名称：${args.submit_label}。` : '用户指定按钮名称时使用该名称，否则使用“提交”。'}其他操作按钮不能代替提交按钮，除非用户明确要求不提供提交。`
  const components = [...new Set(args.components?.filter(name => RICH_COMPONENT_NAMES.has(name)) ?? [])]
  const hint = components.length === 0 ? contentHint : `请使用这些组件：${components.join('、')}。\n${contentHint}`
  const room = USER_QUERY_MAX_CHARS - hint.length - 1
  const head = query.length > room ? query.slice(0, room) : query
  return `${head}\n${hint}`.slice(0, USER_QUERY_MAX_CHARS)
}

type JsonObject = { [key: string]: JsonValue }

function jsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
}

function ensureFormSubmit(payload: JsonValue, args: RenderUiArgs): JsonValue {
  if (args.mode !== 'form' || args.submit_button === false) return payload
  if (!jsonObject(payload) || !jsonObject(payload.spec)) throw new Error('表单缺少 spec')
  const spec = payload.spec
  if (typeof spec.root !== 'string' || !jsonObject(spec.elements)) throw new Error('表单缺少根节点或元素表')
  const elements = spec.elements
  const visited = new Set<string>()
  const visit = (key: string): boolean => {
    if (visited.has(key)) return false
    visited.add(key)
    const element = elements[key]
    if (!jsonObject(element)) throw new Error('表单引用了不存在的元素')
    if (element.visible === false) return false
    const props = jsonObject(element.props) ? element.props : {}
    const on = jsonObject(element.on) ? element.on : {}
    const press = jsonObject(on.press) ? on.press : {}
    const params = jsonObject(press.params) ? press.params : {}
    if (element.type === 'Button' && props.disabled !== true
      && ((press.action === 'form.submit' && (params.eventName === undefined || params.eventName === 'form.submit'))
        || (press.action === 'emit.event' && params.name === 'form.submit'))) return true
    if (element.children === undefined) return false
    if (!Array.isArray(element.children)) throw new Error('表单子节点必须是列表')
    return element.children.some((child) => {
      if (typeof child !== 'string') throw new Error('表单子节点引用必须是字符串')
      return visit(child)
    })
  }
  if (visit(spec.root)) return payload
  const allocate = (name: string): string => {
    let key = name
    for (let index = 1; Object.hasOwn(elements, key); index++) key = `${name}-${index}`
    return key
  }
  const button = allocate('host-form-submit')
  const root = allocate('host-form-root')
  return { ...payload, spec: { ...spec, root, elements: {
    ...elements,
    [button]: { type: 'Button', props: { label: args.submit_label?.trim() || '提交' }, on: { press: { action: 'form.submit' } } },
    [root]: { type: 'Stack', props: { direction: 'vertical', gap: 'md' }, children: [spec.root, button] },
  } } }
}

function successMessage(mode: RenderUiMode): string {
  return mode === 'form' ? FORM_MESSAGE : DISPLAY_MESSAGE
}

function isPayload(value: unknown): value is JsonValue {
  if (!isJsonValue(value) || typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.format === RENDER_UI_FORMAT
    && typeof record.spec === 'object'
    && record.spec !== null
}

function clip(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed
}

function own(value: object, key: string): unknown {
  if (!Object.hasOwn(value, key)) return undefined
  return (value as Record<string, unknown>)[key]
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function safeToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(text)) return undefined
  return text
}

function safeIssue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text.length === 0 || text.length > 120) return undefined
  if (/https?:|data:|bearer|api[_-]?key|\bsk-|password|secret|\/\//i.test(text)) return undefined
  return text
}

function profileKind(value: unknown): RenderProfileKind | undefined {
  const token = typeof value === 'string' ? value : profileId(value)
  if (token === 'base' || token === 'forms' || token === 'rich') return token
  if (token === 'rich_content') return 'rich'
  return undefined
}

function profileId(value: unknown): string | undefined {
  const record = asObject(value)
  if (record === undefined) return undefined
  return typeof record.id === 'string' ? record.id : undefined
}

/**
 * Read the catalog the server actually used.
 * Server diagnostics win over the catalog this host requested.
 * @param body - raw JSON response.
 * @returns base, forms, or rich when the response names one.
 */
export function responseRenderProfile(body: unknown): RenderProfileKind | undefined {
  const root = asObject(body)
  if (root === undefined) return undefined
  const diagnostics = asObject(own(root, 'diagnostics'))
  const fromDiagnostics = diagnostics === undefined ? undefined : profileKind(own(diagnostics, 'profile'))
  if (fromDiagnostics !== undefined) return fromDiagnostics
  const meta = asObject(own(root, 'meta'))
  const extensions = meta === undefined ? undefined : asObject(own(meta, 'extensions'))
  if (extensions === undefined) return undefined
  return profileKind(own(extensions, 'profile'))
}

/**
 * Catalog to render. Server diagnostics win; otherwise the requested route stands.
 * @param requested - catalog selected for this call.
 * @param body - raw JSON response.
 * @returns the profile the client registry should follow.
 */
export function resolvedRenderProfile(requested: RenderProfileKind, body: unknown): RenderProfileKind {
  return responseRenderProfile(body) ?? requested
}

function safeDiagnostics(value: unknown): RenderDebugRecord['diagnostics'] | undefined {
  const record = asObject(value)
  if (record === undefined) return undefined
  const profile = safeToken(typeof record.profile === 'string' ? record.profile : profileId(record.profile))
  const stability = safeToken(record.stability)
  const catalog = safeToken(record.catalog)
  const issues = Array.isArray(record.issues)
    ? record.issues.map(safeIssue).filter((issue): issue is string => issue !== undefined).slice(0, 8)
    : []
  const diagnostics: NonNullable<RenderDebugRecord['diagnostics']> = {}
  if (profile !== undefined) diagnostics.profile = profile
  if (stability !== undefined) diagnostics.stability = stability
  if (catalog !== undefined) diagnostics.catalog = catalog
  if (issues.length > 0) diagnostics.issues = issues
  return Object.keys(diagnostics).length > 0 ? diagnostics : undefined
}

function errorRecord(body: unknown): {
  message?: string
  code?: string
  requestId?: string
  diagnostics?: RenderDebugRecord['diagnostics']
} {
  const root = asObject(body)
  if (root === undefined) return {}
  const error = asObject(own(root, 'error')) ?? root
  const message = typeof error.message === 'string' && error.message.trim() !== '' ? clip(error.message) : undefined
  const code = safeToken(error.code)
  const requestId = safeToken(error.requestId) ?? safeToken(own(root, 'requestId'))
  const diagnostics = safeDiagnostics(error.diagnostics) ?? safeDiagnostics(own(root, 'diagnostics'))
  return {
    ...message !== undefined ? { message } : {},
    ...code !== undefined ? { code } : {},
    ...requestId !== undefined ? { requestId } : {},
    ...diagnostics !== undefined ? { diagnostics } : {},
  }
}

function validationFailure(body: unknown, mode: RenderUiMode): RenderUiFailure | undefined {
  const root = asObject(body)
  const error = root === undefined ? undefined : asObject(own(root, 'error')) ?? root
  if (error === undefined || error.code !== 'MODEL_OUTPUT_INVALID') return undefined
  const requestId = safeToken(error.requestId)
  const diagnostics = asObject(error.diagnostics)
  const issues = Array.isArray(diagnostics?.issues) ? diagnostics.issues.slice(0, 8) : []
  const details: string[] = []
  for (const value of issues) {
    const issue = asObject(value)
    if (issue === undefined) continue
    const code = safeToken(issue.code)
    const path = safeIssue(issue.path)
    const reason = typeof issue.message === 'string' ? safeIssue(issue.message.slice(0, 120)) : undefined
    if (code !== undefined && reason !== undefined) details.push(`${code}${path === undefined ? '' : ` at ${path}`}: ${reason}`)
  }
  return {
    ok: false,
    mode,
    message: `界面生成校验失败：MODEL_OUTPUT_INVALID${requestId === undefined ? '' : `（requestId: ${requestId}）`}。${details.length === 0 ? '' : `诊断：${details.join('；')}。`}请根据诊断修正请求后至多再调用一次；无法修正时用文字回答。不要原样重试，也不要向用户展示错误码或诊断 JSON。`,
  }
}

/** The flag can change while fetch is pending. */
function callAborted(signal: AbortSignal): boolean {
  const aborted: boolean = signal.aborted
  return aborted
}

function debugEnabled(options: RequestJsonRenderOptions): boolean {
  return options.debug === true
    || process.env.JSON_RENDER_DEBUG === '1'
    || process.env.NODE_ENV === 'development'
}

function emitDebug(options: RequestJsonRenderOptions, record: RenderDebugRecord): void {
  if (!debugEnabled(options)) return
  if (options.onDebug !== undefined) {
    options.onDebug(record)
    return
  }
  console.debug(record)
}

function requestRecord(route: RenderRoute): RenderDebugRecord {
  return {
    format: RENDER_UI_FORMAT,
    ...route.intent !== undefined ? { intent: route.intent } : {},
    promptMode: route.promptMode,
  }
}

async function readJson(response: Response): Promise<unknown> {
  return await response.json()
}

function requestBody(args: RenderUiArgs, route: RenderRoute): Record<string, unknown> {
  const context: Record<string, string> = {}
  if (args.scene !== undefined && args.scene.trim() !== '') context.scene = args.scene.trim()
  if (args.locale !== undefined && args.locale.trim() !== '') context.locale = args.locale.trim()
  if (route.intent !== undefined) context.intent = route.intent
  const body: Record<string, unknown> = {
    format: RENDER_UI_FORMAT,
    user_query: renderUserQuery(args),
    prompt_mode: route.promptMode,
  }
  if (Object.keys(context).length > 0) body.context = context
  body.business_data = args.business_data
  return body
}

/**
 * Call POST /v1/render up to three times.
 * HTTP 400 and exhausted generation validation are not retried. Transport and other server failures are.
 * @param options - server origin, arguments, and the attempt signal.
 * @returns the payload, or a short failure the model can continue from.
 */
function prepareRenderArgs(
  args: RenderUiArgs,
  assets: readonly MediaAssetRecord[] | undefined,
): { ok: true; args: RenderUiArgs } | { ok: false; message: string } {
  if (assets === undefined || !referencesImage(args.business_data)) return { ok: true, args }
  const businessData = normalizeImageBusinessData(args.business_data, assets)
  if (canonicalImageSrc(businessData) === undefined) {
    return { ok: false, message: '图片资源不在媒体目录中。请改用文字回答，不要猜测地址。' }
  }
  return { ok: true, args: { ...args, business_data: businessData, intent: 'rich_content', locale: 'zh-CN' } }
}

export async function requestJsonRender(options: RequestJsonRenderOptions): Promise<RenderUiResult> {
  const prepared = prepareRenderArgs(options.args, options.assets)
  if (!prepared.ok) return { ok: false, mode: options.args.mode, message: prepared.message }
  const args = prepared.args
  const localError = formRequestError(args)
  if (localError !== undefined) return { ok: false, mode: args.mode, message: localError }

  const route = selectRenderRoute(args)
  emitDebug(options, requestRecord(route))
  const fetchImpl = options.fetchImpl ?? fetch
  const url = `${options.baseUrl.replace(/\/$/, '')}/v1/render`
  let last = '界面生成失败'
  for (let attempt = 1; attempt <= RENDER_UI_MAX_ATTEMPTS; attempt += 1) {
    if (options.signal.aborted) return { ok: false, mode: args.mode, message: '界面生成已取消。请用文字继续回答。' }
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody(args, route)),
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]),
      })
      if (response.status === 400) {
        let body: unknown
        try {
          body = await readJson(response)
        } catch {
          body = undefined
        }
        const parsed = errorRecord(body)
        emitDebug(options, {
          ...requestRecord(route),
          ...parsed.code !== undefined ? { code: parsed.code } : {},
          ...parsed.requestId !== undefined ? { requestId: parsed.requestId } : {},
          ...parsed.diagnostics !== undefined ? { diagnostics: parsed.diagnostics } : {},
        })
        const invalid = validationFailure(body, args.mode)
        if (invalid !== undefined) return invalid
        const detail = parsed.message ?? `HTTP ${response.status}`
        const labeled = parsed.code === undefined ? detail : `${parsed.code}: ${detail}`
        return {
          ok: false,
          mode: args.mode,
          message: `界面生成被拒绝：${labeled}。请用文字回答，或在缺信息时调用 ask_user_question。不要把错误 JSON 展示给用户。`,
        }
      }
      if (!response.ok) {
        let body: unknown
        try {
          body = await readJson(response)
        } catch {
          body = undefined
        }
        const parsed = errorRecord(body)
        emitDebug(options, {
          ...requestRecord(route),
          ...parsed.code !== undefined ? { code: parsed.code } : {},
          ...parsed.requestId !== undefined ? { requestId: parsed.requestId } : {},
          ...parsed.diagnostics !== undefined ? { diagnostics: parsed.diagnostics } : {},
        })
        const invalid = validationFailure(body, args.mode)
        if (invalid !== undefined) return invalid
        const detail = parsed.message ?? `HTTP ${response.status}`
        last = parsed.code === undefined ? detail : `${parsed.code}: ${detail}`
        continue
      }
      let json: unknown
      try {
        json = await readJson(response)
      } catch {
        last = '响应不是 JSON'
        continue
      }
      if (!isPayload(json)) {
        last = '响应不是 json-render-v1'
        continue
      }
      const reported = responseRenderProfile(json)
      emitDebug(options, {
        ...requestRecord(route),
        ...reported !== undefined ? { diagnostics: { profile: reported } } : {},
      })
      return { ok: true, mode: args.mode, message: successMessage(args.mode), payload: ensureFormSubmit(json, args) }
    } catch (error) {
      if (callAborted(options.signal)) return { ok: false, mode: args.mode, message: '界面生成已取消。请用文字继续回答。' }
      last = error instanceof Error ? clip(error.message) : '界面生成失败'
      emitDebug(options, requestRecord(route))
    }
  }
  return {
    ok: false,
    mode: args.mode,
    message: `界面生成失败，已尝试 ${RENDER_UI_MAX_ATTEMPTS} 次：${last}。请用文字继续回答。不要把错误 JSON 展示给用户。`,
  }
}
