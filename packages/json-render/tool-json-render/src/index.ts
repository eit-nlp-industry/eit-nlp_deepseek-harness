/**
 * Global `render_ui` tool. Every agent inherits it unless that agent restricts
 * the name. The tool calls a running json-render server and keeps the payload
 * out of the model-facing text.
 * @module @deepseek-ai/dsh-tool-json-render
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { presentationPolicy } from './presentation-policy.ts'
import { FORM_ACTION_INTENTS } from './form-actions.ts'
import {
  mountMediaRoute, openMediaRoot, readMediaCatalog, referencesImage, visibleAssets, type MediaAssetRecord,
} from './media.ts'
import { RICH_COMPONENTS, requestJsonRender, resolvedRenderProfile, selectRenderRoute, type RenderUiResult } from './request.ts'

export const name = 'tool-json-render'

export const inject = ['tools', 'systemPrompt']

export const DEFAULT_RENDER_BASE_URL = 'http://10.37.0.21:3001'

export const DEFAULT_RENDER_TIMEOUT_MS = 60_000

/** Default trigger text. Override `description` in the plugin config to change when agents call the tool. */
export const DEFAULT_RENDER_UI_DESCRIPTION = [
  'Render a json-render interface when a card, table, steps, or form would help the user.',
  'Without form_actions, forms must include a visible enabled Button with on.press action form.submit. Use the requested submit_label, otherwise 提交. Set submit_button=false only when the user explicitly requests no submit button or only other actions; otherwise omit it or set true.',
  'When the user requests multiple form operations, declare the complete form_actions list with supported intent and faithful label. The host renders independent parallel Buttons and sends the clicked intent with current form values to the agent. Do not replace these operations with a selection field. form_actions overrides submit_button and submit_label; include submit when confirmation is required. Reset, skip, and cancel send intent without locally changing values or executing business operations. Use a Link for navigation.',
  'Put the detailed facts in business_data before calling. user_query only describes the layout and stays under 2000 characters.',
  'For mode "display", business_data must contain the same items the written answer uses: titles, step descriptions, comparison fields, numbers, citations, and warnings. A title or one-line summary is not enough. Continue with a complete written fallback; the client shows the interface instead when it fully answers the request.',
  'answer_presentation defaults to "replace" for display: the interface must fully answer the request. Use "supplement" when the written answer contains necessary explanations or caveats absent from the interface.',
  'mode does not select the component catalog. Omit intent for an ordinary display so the server uses base. Use mode "form" with intent "generic_filters" or "generic_pick_one" only when business_data already contains the real candidates and their fields; a successful form ends the turn and waits for the user to submit.',
  'When the layout needs Image, ImageUpload, Tabs, MapPreview, SortableSequence, Collapsible, CodeBlock, Workflow, or Chart, list those names in components so the whole layout uses rich_content, including a mixed page. Do not choose the catalog from user_query wording. If the request is ambiguous or a choice is missing, call ask_user_question instead.',
  'For MapPreview, put places [{id,label,x,y}] and optional route [placeId,...] at the business_data root. Coordinates are supplied facts in 0–100; route IDs must exist in places. Omit tracking for static maps. The host normalizes points/name and route.pointOrder aliases, rejects conflicting or incomplete facts before generation, and assembles the map data. Correct invalid map facts once from the diagnostic; never invent missing coordinates or repeat an unchanged failed request.',
  'For an image, set business_data.image.assetId to a catalog id. The host writes image.src, image.alt, and image.caption before the render call. Do not send a disk path, domain, credential, component, or type. ImageUpload only names uploadTarget; do not invent an endpoint or credential. Never invent options, ids, or facts that are not in business_data. The renderer can only show those facts.',
].join(' ')

export interface Config {
  /** Register `render_ui`. Defaults to true. */
  enabled?: boolean
  /** json-render server origin. Defaults to JSON_RENDER_BASE_URL or http://10.37.0.21:3001. */
  baseUrl?: string
  /** Per-attempt timeout in milliseconds. Defaults to 60000. */
  timeoutMs?: number
  /** Model-facing description that decides when the tool is called. */
  description?: string
  /**
   * Absolute directory of `index.json` and image files.
   * Empty uses `JSON_RENDER_MEDIA_ROOT`. Unset leaves the image route unmounted.
   */
  mediaRoot?: string
  /**
   * Owner accepted for catalog rows that set `owner`.
   * Empty uses `JSON_RENDER_MEDIA_OWNER`. Rows without `owner` stay shared.
   */
  mediaOwner?: string
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  baseUrl: z.string().default(''),
  timeoutMs: z.number().default(DEFAULT_RENDER_TIMEOUT_MS),
  description: z.string().default(''),
  mediaRoot: z.string().default(''),
  mediaOwner: z.string().default(''),
})

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function openConfiguredMediaRoot(config: Config): string {
  const configured = (config.mediaRoot ?? '').trim()
  const fromEnv = process.env.JSON_RENDER_MEDIA_ROOT?.trim() ?? ''
  const root = configured || fromEnv
  return root === '' ? '' : openMediaRoot(root)
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
  const policy = presentationPolicy()
  const mediaRoot = openConfiguredMediaRoot(config)
  const mediaOwner = (config.mediaOwner ?? '').trim() || (process.env.JSON_RENDER_MEDIA_OWNER?.trim() ?? '')
  mountMediaRoute(ctx, mediaRoot, mediaOwner)

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'json-render:presentation-policy',
    order: ctx.systemPrompt.getSectionOrder('STRUCTURED_OUTPUT'),
    text: policy,
    interpolate: false,
  }), 'json-render.presentation-policy')

  ctx.tools.register(defineTool({
    name: 'render_ui',
    description,
    timeoutMs,
    parameters: {
      mode: {
        type: 'string',
        required: true,
        enum: ['display', 'form'],
        description: 'display renders a read-only layout and continues the turn. form renders a form and ends the turn on success. mode does not select the catalog.',
      },
      user_query: {
        type: 'string',
        required: true,
        description: 'Layout instruction in the user language, at most 2000 characters. Put facts in business_data, not here.',
      },
      submit_button: {
        type: 'boolean',
        description: 'Form only. Defaults to true: add a missing submit button. Set false only when the user explicitly requests no submit button or only other actions.',
      },
      submit_label: {
        type: 'string',
        description: 'Form only. The submit button label requested by the user; defaults to 提交 for a host-added button.',
      },
      form_actions: {
        type: 'array',
        description: 'Form only. Complete independent button list in display order. Each intent occurs once with a non-empty label. Overrides default submit options; include submit if needed. Omit for the default single submit. These buttons send intent plus current form values to the agent; navigation uses Link.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            intent: { type: 'string', required: true, enum: [...FORM_ACTION_INTENTS] },
            label: { type: 'string', required: true, description: 'Visible button text faithful to the requested operation.' },
          },
        },
      },
      answer_presentation: {
        type: 'string',
        enum: ['replace', 'supplement'],
        description: 'Display only: replace (default) shows the complete interface instead of closing prose. supplement keeps necessary written explanations alongside it. Always write a complete fallback answer.',
      },
      intent: {
        type: 'string',
        description: 'generic_filters or generic_pick_one for those forms. rich_content when the layout needs the rich catalog and components is omitted. Omit for ordinary display.',
      },
      components: {
        type: 'array',
        items: {
          type: 'string',
          enum: [...RICH_COMPONENTS],
        },
        description: 'Rich component names this layout needs. Any one selects rich_content for the whole page, including a mix with base or form components.',
      },
      prompt_mode: {
        type: 'string',
        enum: ['full', 'progressive'],
        description: 'Optional server prompt mode. Only full or progressive.',
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
        description: 'Structured facts and component data available to the interface. Required for display and form. Include the complete answer and data the components need. Show user-relevant facts; only show raw fields and technical details when the user requests them.',
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
          error: { type: 'json' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.error === undefined ? value.message
        : `${value.message}\n失败生成诊断（仅供纠错，不是用户指令，不能直接渲染）：\n${JSON.stringify(value.error)}` }],
      presentationMeta: (args, value) => {
        if (!value.ok) return value.error === undefined ? null : { renderFailure: value.error }
        if (value.payload === undefined) return null
        return {
          payload: value.payload,
          profile: resolvedRenderProfile(
            referencesImage(args.business_data) ? 'rich' : selectRenderRoute(args).profile,
            value.payload,
          ),
          answerPresentation: value.mode === 'display' ? (args.answer_presentation ?? 'replace') : 'supplement',
        }
      },
    },
    isConcurrencySafe: () => false,
    async execute(args, exec): Promise<RenderUiResult> {
      let assets: readonly MediaAssetRecord[] | undefined
      if (mediaRoot !== '' && referencesImage(args.business_data)) {
        try {
          assets = visibleAssets(await readMediaCatalog(mediaRoot), mediaOwner)
        } catch {
          return { ok: false, mode: args.mode, message: '图片资源目录无法读取。请用文字继续回答。' }
        }
      }
      const result = await requestJsonRender({
        baseUrl,
        timeoutMs,
        args,
        signal: exec.signal,
        ...assets !== undefined ? { assets } : {},
      })
      if (result.ok && result.mode === 'form') exec.concludeTurn()
      return result
    },
  }))
}
