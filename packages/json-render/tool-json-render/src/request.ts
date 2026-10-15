/** HTTP client for one json-render server call, with a fixed attempt budget. */

import { isJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'

export const RENDER_UI_MAX_ATTEMPTS = 3

export const RENDER_UI_FORMAT = 'json-render-v1'

export const FORM_INTENTS = ['generic_filters', 'generic_pick_one'] as const

export type RenderUiMode = 'display' | 'form'

export type FormIntent = (typeof FORM_INTENTS)[number]

export interface RenderUiArgs {
  mode: RenderUiMode
  user_query: string
  intent?: string
  scene?: string
  locale?: string
  business_data?: unknown
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

export interface RequestJsonRenderOptions {
  baseUrl: string
  timeoutMs: number
  args: RenderUiArgs
  signal: AbortSignal
  fetchImpl?: typeof fetch
}

const DISPLAY_MESSAGE = '界面已附上。请继续用文字回答，不要复述或改写界面 JSON。'
const FORM_MESSAGE = '界面已附上。本轮在此结束，等待用户提交。不要再调用工具，也不要复述界面 JSON。'

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

/** Reject calls that the server would refuse, before any HTTP attempt. */
export function formRequestError(args: RenderUiArgs): string | undefined {
  if (args.mode === 'display' && !hasBusinessData(args.business_data)) {
    return '展示模式也需要非空 business_data，并且要包含回答里的条目、步骤说明、对比字段、数值和出处。不要只传标题或一句话。补全后再调用 render_ui。'
  }
  if (args.mode !== 'form') return undefined
  if (!FORM_INTENTS.includes(args.intent as FormIntent)) {
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

async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const error = (body as { error?: { message?: unknown } }).error
      if (typeof error?.message === 'string' && error.message.trim() !== '') return clip(error.message)
    }
  } catch {
    // A non-JSON error body is still a failed attempt.
  }
  return `HTTP ${response.status}`
}

function requestBody(args: RenderUiArgs): Record<string, unknown> {
  const context: Record<string, string> = {}
  if (args.scene !== undefined && args.scene.trim() !== '') context.scene = args.scene.trim()
  if (args.locale !== undefined && args.locale.trim() !== '') context.locale = args.locale.trim()
  if (args.mode === 'form' && args.intent !== undefined) context.intent = args.intent
  const body: Record<string, unknown> = {
    format: RENDER_UI_FORMAT,
    user_query: renderUserQuery(args),
    prompt_mode: 'full',
  }
  if (Object.keys(context).length > 0) body.context = context
  if (args.business_data !== undefined) body.business_data = args.business_data
  return body
}

/**
 * Call POST /v1/render up to three times.
 * HTTP 400 is not retried. Other transport, server, and payload failures are.
 */
export async function requestJsonRender(options: RequestJsonRenderOptions): Promise<RenderUiResult> {
  const localError = formRequestError(options.args)
  if (localError !== undefined) return { ok: false, mode: options.args.mode, message: localError }

  const fetchImpl = options.fetchImpl ?? fetch
  const url = `${options.baseUrl.replace(/\/$/, '')}/v1/render`
  let last = '界面生成失败'
  for (let attempt = 1; attempt <= RENDER_UI_MAX_ATTEMPTS; attempt += 1) {
    if (options.signal.aborted) return { ok: false, mode: options.args.mode, message: '界面生成已取消。请用文字继续回答。' }
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody(options.args)),
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]),
      })
      if (response.status === 400) {
        return {
          ok: false,
          mode: options.args.mode,
          message: `界面生成被拒绝：${await errorMessage(response)}。请用文字回答，或在缺信息时调用 ask_user_question。不要把错误 JSON 展示给用户。`,
        }
      }
      if (!response.ok) {
        last = await errorMessage(response)
        continue
      }
      let json: unknown
      try {
        json = await response.json()
      } catch {
        last = '响应不是 JSON'
        continue
      }
      if (!isPayload(json)) {
        last = '响应不是 json-render-v1'
        continue
      }
      return { ok: true, mode: options.args.mode, message: successMessage(options.args.mode), payload: json }
    } catch (error) {
      if (options.signal.aborted) return { ok: false, mode: options.args.mode, message: '界面生成已取消。请用文字继续回答。' }
      last = error instanceof Error ? clip(error.message) : '界面生成失败'
    }
  }
  return {
    ok: false,
    mode: options.args.mode,
    message: `界面生成失败，已尝试 ${RENDER_UI_MAX_ATTEMPTS} 次：${last}。请用文字继续回答。不要把错误 JSON 展示给用户。`,
  }
}
