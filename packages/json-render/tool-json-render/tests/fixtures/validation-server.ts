/** Loopback render service used by the recorded generation-error scenario. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { Context } from '@deepseek-ai/cordis'
import * as jsonRender from '../../src/index.ts'

export const name = 'json-render-validation-fixture'
export const inject = ['tools']

/** Select the structured failure response for its dedicated replay scenario. */
export interface Config {
  includeFailureDetails?: boolean
  /** Return a deterministic editable draft for the multi-action Session replay. */
  formDraft?: boolean
  /** Return a layout without tracking, or a text substitution, for map assembly replay. */
  mapDraft?: boolean
  /** Return incorrect generated map data so the host must use the supplied facts. */
  corruptMapData?: boolean
}

/**
 * Mount the real tool against an owner-local generation failure service.
 * @param ctx - Profile context that owns the listener and tool registration.
 * @param config - Whether to return a failed candidate as diagnostic data.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const server = createServer((request, response) => {
    if (config.mapDraft) {
      let text = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { text += chunk })
      request.on('end', () => {
        const body = JSON.parse(text) as { business_data: { places: unknown; route: unknown; responseKind?: string } }
        const data = body.business_data
        response.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'req-map-assembly' })
        response.end(JSON.stringify({ format: 'json-render-v1', spec: data.responseKind === 'text' || data.responseKind === 'degraded'
          ? { root: 'notice', elements: { notice: { type: 'Text', props: { content: '地图暂不可用' } } } }
          : { root: 'map', elements: { map: { type: 'MapPreview', props: config.corruptMapData
            ? { places: [{ id: 'invented', label: '错误生成地点', x: 101, y: 0 }], route: ['invented'] }
            : { places: data.places, route: data.route } } } },
        ...data.responseKind === 'degraded' ? { meta: { extensions: { generation: { outcome: 'degraded' } } } } : {},
        }))
      })
      return
    }
    request.resume()
    if (config.formDraft) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ format: 'json-render-v1', spec: { root: 'draft', elements: {
        draft: { type: 'Card', props: { title: '活动物资草稿' }, children: ['fields'] },
        fields: { type: 'DynamicForm', props: { fields: [
          { type: 'inputNumber', key: 'quantity', label: '数量', value: 20 },
          { type: 'input', key: 'contact', label: '联系人', value: '林晓' },
        ] } },
      } } }))
      return
    }
    response.writeHead(502, { 'content-type': 'application/json' })
    const failure = {
      code: 'MODEL_OUTPUT_INVALID', requestId: 'req-validation', stage: 'validation',
      diagnostics: { issues: [{ code: 'invalid_props', path: '/elements/main/props/content', message: 'Expected scalar text' }] },
      rawOutput: [
        '{"op":"add","path":"/root","value":"main"}',
        '{"op":"add","path":"/elements/main","value":{"type":"Text","props":{"content":{}}}}',
      ].join('\n'),
      invalidPayload: { format: 'json-render-v1', spec: { root: 'main', elements: { main: { type: 'Text', props: { content: {} } } } } },
    }
    response.end(JSON.stringify({ error: config.includeFailureDetails ? failure : {
      code: 'MODEL_OUTPUT_INVALID', requestId: 'req-map',
      diagnostics: { issues: [{ code: 'invalid_props', path: '/elements/map/props/places/2/x', message: 'Expected number' }] },
    } }))
  })
  ctx.effect(() => {
    server.listen(0, '127.0.0.1')
    return () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  })
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Render fixture has no loopback address')
  await ctx.plugin(jsonRender, { baseUrl: `http://127.0.0.1:${address.port}` })
}
