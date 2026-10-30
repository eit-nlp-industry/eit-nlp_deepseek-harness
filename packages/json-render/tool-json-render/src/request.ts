/**
 * HTTP client for one json-render server call, with a fixed attempt budget.
 * The server is the v0.2.0-rc.5 `POST /v1/render` contract: format, user_query,
 * business_data, optional prompt_mode, and context.locale / context.intent.
 * Host mode is not a server field and does not select the catalog.
 */

import { isJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'

export const RENDER_UI_MAX_ATTEMPTS = 3

export const RENDER_UI_FORMAT = 'json-render-v1'

/** Release of the json-render server and Generation SDK this host calls. */
export const JSON_RENDER_RELEASE = 'v0.2.0-rc.5'

export const FORM_INTENTS = ['generic_filters', 'generic_pick_one'] as const

export const RICH_COMPONENTS = [
  'Image',
  'ImageUpload',
  'Tabs',
  'MapPreview',
  'SortableSequence',
  'Collapsible',
  'CodeBlock',
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

const DISPLAY_DETAIL_HINT = '请逐项展示 business_data，保留步骤说明、对比字段、数值和出处，不要收成一句摘要。'

/**
 * Choose the catalog from the business entry and explicit component names.
 * user_query wording is not a catalog selector. Host mode is not sent.
 * @param args - tool arguments.
 * @returns the profile, the intent to send, and the prompt mode.
 */
export function selectRenderRoute(args: RenderUiArgs): RenderRoute {
  const promptMode: PromptMode = args.prompt_mode === 'progressive' ? 'progressive' : 'full'
  const listed = Array.isArray(args.components) ? args.components : []
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
  if (args.mode !== 'display') return query.slice(0, USER_QUERY_MAX_CHARS)
  const room = USER_QUERY_MAX_CHARS - DISPLAY_DETAIL_HINT.length - 1
  const head = query.length > room ? query.slice(0, room) : query
  return `${head}\n${DISPLAY_DETAIL_HINT}`
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

function errorRecord(body: unknown): { message?: string; code?: string; requestId?: string; diagnostics?: RenderDebugRecord['diagnostics'] } {
  const root = asObject(body)
  if (root === undefined) return {}
  const error = asObject(own(root, 'error')) ?? root
  const message = typeof error.message === 'string' && error.message.trim() !== '' ? clip(error.message) : undefined
  return {
    message,
    code: safeToken(error.code),
    requestId: safeToken(error.requestId) ?? safeToken(own(root, 'requestId')),
    diagnostics: safeDiagnostics(error.diagnostics) ?? safeDiagnostics(own(root, 'diagnostics')),
  }
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
 * HTTP 400 is not retried. Other transport, server, and payload failures are.
 * @param options - server origin, arguments, and the attempt signal.
 * @returns the payload, or a short failure the model can continue from.
 */
export async function requestJsonRender(options: RequestJsonRenderOptions): Promise<RenderUiResult> {
  const localError = formRequestError(options.args)
  if (localError !== undefined) return { ok: false, mode: options.args.mode, message: localError }

  const route = selectRenderRoute(options.args)
  emitDebug(options, requestRecord(route))
  const fetchImpl = options.fetchImpl ?? fetch
  const url = `${options.baseUrl.replace(/\/$/, '')}/v1/render`
  let last = '界面生成失败'
  for (let attempt = 1; attempt <= RENDER_UI_MAX_ATTEMPTS; attempt += 1) {
    if (options.signal.aborted) return { ok: false, mode: options.args.mode, message: '界面生成已取消。请用文字继续回答。' }
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody(options.args, route)),
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
        const detail = parsed.message ?? `HTTP ${response.status}`
        return {
          ok: false,
          mode: options.args.mode,
          message: `界面生成被拒绝：${detail}。请用文字回答，或在缺信息时调用 ask_user_question。不要把错误 JSON 展示给用户。`,
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
        last = parsed.message ?? `HTTP ${response.status}`
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
      return { ok: true, mode: options.args.mode, message: successMessage(options.args.mode), payload: json }
    } catch (error) {
      if (options.signal.aborted) return { ok: false, mode: options.args.mode, message: '界面生成已取消。请用文字继续回答。' }
      last = error instanceof Error ? clip(error.message) : '界面生成失败'
      emitDebug(options, requestRecord(route))
    }
  }
  return {
    ok: false,
    mode: options.args.mode,
    message: `界面生成失败，已尝试 ${RENDER_UI_MAX_ATTEMPTS} 次：${last}。请用文字继续回答。不要把错误 JSON 展示给用户。`,
  }
}
