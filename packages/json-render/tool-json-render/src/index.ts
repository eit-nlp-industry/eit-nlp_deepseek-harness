/**
 * Global `render_ui` tool. Every agent inherits it unless that agent restricts
 * the name. The tool calls a running json-render server and keeps the payload
 * out of the model-facing text.
 * @module @deepseek-ai/dsh-tool-json-render
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { requestJsonRender, type RenderUiResult } from './request.ts'

export const name = 'tool-json-render'

export const inject = ['tools']

export const DEFAULT_RENDER_BASE_URL = 'http://127.0.0.1:3001'

export const DEFAULT_RENDER_TIMEOUT_MS = 60_000

/** Default trigger text. Override `description` in the plugin config to change when agents call the tool. */
export const DEFAULT_RENDER_UI_DESCRIPTION = [
  'Render a json-render interface when a card, table, steps, or form would help the user.',
  'Put the detailed facts in business_data before calling. user_query only describes the layout and stays under 2000 characters.',
  'For mode "display", business_data must contain the same items the written answer uses: titles, step descriptions, comparison fields, numbers, citations, and warnings. A title or one-line summary is not enough. Continue with a complete written fallback; the client shows the interface instead when it fully answers the request.',
  'answer_presentation defaults to "replace" for display: the interface must fully answer the request. Use "supplement" when the written answer contains necessary explanations or caveats absent from the interface.',
  'Use mode "form" with intent "generic_filters" or "generic_pick_one" only when business_data already contains the real candidates and their fields; a successful form ends the turn and waits for the user to submit.',
  'If the request is ambiguous or a choice is missing, call ask_user_question instead.',
  'Never invent options, ids, or facts that are not in business_data. The renderer can only show those facts.',
].join(' ')

export interface Config {
  /** Register `render_ui`. Defaults to true. */
  enabled?: boolean
  /** json-render server origin. Defaults to JSON_RENDER_BASE_URL or http://127.0.0.1:3001. */
  baseUrl?: string
  /** Per-attempt timeout in milliseconds. Defaults to 60000. */
  timeoutMs?: number
  /** Model-facing description that decides when the tool is called. */
  description?: string
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  baseUrl: z.string().default(''),
  timeoutMs: z.number().default(DEFAULT_RENDER_TIMEOUT_MS),
  description: z.string().default(''),
})

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/**
 * Register `render_ui` on the calling context. A host mount lands in the global
 * tool layer, so later agents see it without listing the plugin again.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.enabled === false) return
  const timeoutMs = config.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS
  if (!positiveInteger(timeoutMs)) {
    throw new Error('tool-json-render: timeoutMs must be a positive integer')
  }
  const fromEnv = process.env.JSON_RENDER_BASE_URL?.trim()
  const baseUrl = ((config.baseUrl ?? '').trim() || fromEnv || DEFAULT_RENDER_BASE_URL).replace(/\/$/, '')
  const description = (config.description ?? '').trim() || DEFAULT_RENDER_UI_DESCRIPTION

  ctx.tools.register(defineTool({
    name: 'render_ui',
    description,
    timeoutMs,
    parameters: {
      mode: {
        type: 'string',
        required: true,
        enum: ['display', 'form'],
        description: 'display renders a read-only layout. form renders generic_filters or generic_pick_one and ends the turn on success.',
      },
      user_query: {
        type: 'string',
        required: true,
        description: 'Layout instruction in the user language, at most 2000 characters. Put facts in business_data, not here.',
      },
      answer_presentation: {
        type: 'string',
        enum: ['replace', 'supplement'],
        description: 'Display only: replace (default) shows the complete interface instead of closing prose. supplement keeps necessary written explanations alongside it. Always write a complete fallback answer.',
      },
      intent: {
        type: 'string',
        description: 'Required for form: generic_filters or generic_pick_one.',
      },
      scene: {
        type: 'string',
        description: 'Optional scene hint passed through to the renderer, such as kb.',
      },
      locale: {
        type: 'string',
        description: 'Optional locale hint, such as zh-CN.',
      },
      business_data: {
        type: 'json',
        description: 'Structured facts the card must show. Required for display and form. Include every item, step description, comparison field, number, citation, and warning. Do not send only a title.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          mode: { type: 'string', required: true, enum: ['display', 'form'] },
          message: { type: 'string', required: true },
          payload: { type: 'json' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
      presentationMeta: (args, value) => value.ok && value.payload !== undefined
        ? { payload: value.payload, answerPresentation: value.mode === 'display' ? (args.answer_presentation ?? 'replace') : 'supplement' }
        : null,
    },
    isConcurrencySafe: () => false,
    async execute(args, exec): Promise<RenderUiResult> {
      const result = await requestJsonRender({
        baseUrl,
        timeoutMs,
        args,
        signal: exec.signal,
      })
      if (result.ok && result.mode === 'form') exec.concludeTurn()
      return result.ok
        ? result
        : { ok: false, mode: result.mode, message: result.message }
    },
  }))
}
