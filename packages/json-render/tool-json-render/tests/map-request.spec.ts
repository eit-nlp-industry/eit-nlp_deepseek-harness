import { expect, it, vi } from 'vitest'
import { requestJsonRender, type RenderUiArgs } from '../src/request.ts'

const places = [{ id: 'start', label: '起点', x: 0, y: 50 }, { id: 'gate', label: '大门', x: 0, y: 100 }]
const position = { x: 0, y: 50, status: 'idle' }
const tracking = { source: 'robot-live', trackId: 'escort-test', position }
const data = { places, route: ['start', 'gate'], tracking }
const map = { type: 'MapPreview', props: { places, route: ['start', 'gate'] } }
const payload = { format: 'json-render-v1', spec: { root: 'map', elements: { map } } }

function requestText(body: BodyInit | null | undefined): string {
  if (typeof body !== 'string') throw new Error('Expected JSON request text')
  return body
}

async function call(businessData: unknown, response: unknown = payload, overrides: Partial<RenderUiArgs> = {}) {
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response), {
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-map-host' },
  }))
  const result = await requestJsonRender({ baseUrl: 'http://render.test', timeoutMs: 1000,
    args: { mode: 'display', user_query: '展示地图', components: ['MapPreview'], business_data: businessData, ...overrides },
    signal: new AbortController().signal, fetchImpl })
  return { result, fetchImpl }
}

it.each([
  { ...tracking, position: { $state: '/tracking/position' } },
  { source: 'robot-live', trackId: 'escort-test' },
  { ...tracking, position: { x: 101, y: 50 } },
  { ...tracking, position: { x: 0, y: 50, status: 'unknown' } },
  { ...tracking, source: 'invented' },
  { ...tracking, trackId: '' },
])('rejects invalid tracking facts before HTTP: %j', async (invalid) => {
  const { result, fetchImpl } = await call({ ...data, tracking: invalid })
  expect(result.ok).toBe(false)
  expect(result.message).toContain('地图')
  expect(fetchImpl).not.toHaveBeenCalled()
})

it('assembles live configuration from supplied facts even when the model omits tracking', async () => {
  const { result, fetchImpl } = await call(data)
  expect(result).toMatchObject({ ok: true, payload: { state: { initial: { tracking } }, spec: { elements: { map: {
    props: { tracking: { source: 'robot-live', trackId: 'escort-test' }, position: { $state: '/tracking/position' } },
  } } } } })
  const body = JSON.parse(requestText(fetchImpl.mock.calls[0]?.[1]?.body)) as { user_query: string }
  expect(body.user_query).toContain('不要生成 position 和 tracking')
  expect(body).toMatchObject({ required_components: ['MapPreview'], map_binding: {
    positionPath: '/tracking/position', tracking: { source: 'robot-live', trackId: 'escort-test' },
  } })
})

it('replaces generated paths, identifiers and coordinates while preserving unrelated state', async () => {
  const response = { ...payload, state: { initial: { _ui: { active: 'one' }, tracking: { position: { x: 99, y: 99 } } } },
    spec: { ...payload.spec, elements: { map: { ...map, props: { ...map.props,
      position: { $state: '/_ui/position' }, tracking: { source: 'robot-live', trackId: 'invented' },
    } } } } }
  const { result } = await call(data, response)
  expect(result).toMatchObject({ ok: true, payload: { state: { initial: { _ui: { active: 'one' }, tracking } }, spec: { elements: { map: {
    props: { tracking: { source: 'robot-live', trackId: 'escort-test' }, position: { $state: '/tracking/position' } },
  } } } } })
})

it('accepts a supplied top-level coordinate as the initial tracking position', async () => {
  const { result, fetchImpl } = await call({ ...data, tracking: { source: tracking.source, trackId: tracking.trackId }, position })
  expect(result).toMatchObject({ ok: true, payload: { state: { initial: { tracking } } } })
  const body = JSON.parse(requestText(fetchImpl.mock.calls[0]?.[1]?.body)) as { business_data: unknown }
  expect(body.business_data).toMatchObject({ tracking })
})

it('keeps static maps static when generated tracking was not requested', async () => {
  const response = { ...payload, spec: { ...payload.spec, elements: { map: { ...map, props: { ...map.props,
    tracking: { source: 'robot-live', trackId: 'invented' }, position: { $state: '/_ui/position' },
  } } } } }
  const { result } = await call({ places, route: data.route }, response)
  expect(result).toMatchObject({ ok: true, payload: { spec: { elements: { map } } } })
  if (!result.ok) throw new Error(result.message)
  expect(JSON.stringify(result.payload)).not.toContain('invented')
})

it('rejects HTTP 200 without the explicitly requested map, without retrying', async () => {
  const response = { format: 'json-render-v1', spec: { root: 'notice', elements: { notice: { type: 'Text', props: { content: '降级内容' } } } } }
  const { result, fetchImpl } = await call(data, response)
  expect(result).toMatchObject({ ok: false, error: { code: 'MODEL_OUTPUT_INVALID', stage: 'validation', requestId: 'req-map-host',
    diagnostics: { issues: [{ code: 'missing_requested_component' }] },
  } })
  expect(result.message).toContain('MapPreview')
  expect(fetchImpl).toHaveBeenCalledOnce()
})

it('does not count unreachable or explicitly hidden map elements as fulfillment', async () => {
  for (const hidden of [false, true]) {
    const response = { ...payload, spec: { root: 'notice', elements: { map: { ...map, visible: false },
      notice: { type: 'Stack', children: hidden ? ['map'] : [] },
    } } }
    const { result } = await call(data, response)
    expect(result.ok).toBe(false)
  }
})

it('rejects invalid generated presentation props rather than publishing a broken panel', async () => {
  const response = { ...payload, spec: { ...payload.spec, elements: { map: { ...map, props: {
    places, markerSize: 1000,
  } } } } }
  const { result, fetchImpl } = await call(data, response)
  expect(result.ok).toBe(false)
  if (result.ok || result.error === undefined) throw new Error('Expected invalid map')
  expect(result.error.diagnostics.issues.find(issue => issue.code === 'invalid_map')?.message).toContain('MapPreview')
  expect(fetchImpl).toHaveBeenCalledOnce()
})

it('normalizes the recorded points/name and route.pointOrder input before generation', async () => {
  const source = {
    points: places.map(({ label, ...place }) => ({ ...place, name: label, role: '站点' })),
    route: { pointOrder: data.route, legs: [{ from: 'start', to: 'gate' }] }, title: '示意地图',
  }
  const { result, fetchImpl } = await call(source)
  expect(result.ok).toBe(true)
  const body = JSON.parse(requestText(fetchImpl.mock.calls[0]?.[1]?.body)) as { business_data: unknown; user_query: string }
  expect(body.business_data).toMatchObject({ places, route: data.route, title: '示意地图' })
  expect(body.user_query).toContain('business_data.places')
  expect(body.user_query).toContain('business_data.route')
  expect(source.route).toEqual({ pointOrder: data.route, legs: [{ from: 'start', to: 'gate' }] })
})

it('retains original map details for mixed layouts when standardizing map facts', async () => {
  const source = { places: places.map(place => ({ ...place, note: '无障碍入口' })), route: {
    name: '无障碍路线', pointOrder: data.route, legs: [{ from: 'start', to: 'gate', instruction: '乘电梯' }],
  } }
  const { result, fetchImpl } = await call(source, payload, { components: ['MapPreview', 'CodeBlock'] })
  expect(result.ok).toBe(true)
  const body = JSON.parse(requestText(fetchImpl.mock.calls[0]?.[1]?.body)) as { business_data: unknown }
  expect(body.business_data).toMatchObject({ places, route: data.route, map_source: source })
})

it('rejects a conflicting caller-owned map_source rather than overwriting it', async () => {
  const { result, fetchImpl } = await call({ points: places, map_source: { note: '必须保留' } })
  expect(result.ok).toBe(false)
  expect(result.message).toContain('map_source')
  expect(fetchImpl).not.toHaveBeenCalled()
})

it('keeps standardized map input idempotent with its preserved source', async () => {
  const source = { points: places, route: { pointOrder: data.route } }
  const first = await call(source)
  const body = JSON.parse(requestText(first.fetchImpl.mock.calls[0]?.[1]?.body)) as { business_data: unknown }
  const second = await call(body.business_data)
  expect(second.result.ok).toBe(true)
  expect(JSON.parse(requestText(second.fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({ business_data: body.business_data })
})

it('filters SDK errors containing sensitive generated element identities without accepting the map', async () => {
  const id = 'https://internal.example/?api_key=private'
  const response = { ...payload, spec: { root: id, elements: { [id]: { ...map, props: { places, markerSize: 1000 } } } } }
  const { result } = await call({ places }, response)
  expect(result.ok).toBe(false)
  expect(result.message).not.toContain('internal.example')
  expect(result.message).not.toContain('api_key')
  if (result.ok || result.error === undefined) throw new Error('Expected invalid map')
  expect(result.error.diagnostics.issues.length).toBeGreaterThan(0)
  expect(JSON.stringify(result.error)).not.toContain('internal.example')
})

it.each([
  {},
  { places: [] },
  { places: [{ id: 'start', label: '起点', x: 101, y: 50 }] },
  { places: [{ id: 'start', label: '起点', x: 0 }] },
  { places: [places[0], places[0]] },
  { places, route: ['start', 'unknown'] },
  { places, route: { legs: [{ from: 'start', to: 'gate' }] } },
  { places: [{ ...places[0], name: '矛盾名称' }] },
  { places, points: [{ id: 'other', name: '其他地点', x: 0, y: 0 }] },
  { places, route: { pointOrder: data.route, legs: [{ from: 'gate', to: 'start' }] } },
])('rejects incomplete or conflicting map facts before HTTP: %j', async (source) => {
  const { result, fetchImpl } = await call(source)
  expect(result.ok).toBe(false)
  expect(result.message).toContain('地图')
  expect(fetchImpl).not.toHaveBeenCalled()
})

it('assembles map facts from the request when generated props are missing or incorrect', async () => {
  const response = { ...payload, state: { initial: { _ui: { selected: 'kept' } } }, spec: { ...payload.spec,
    elements: { map: { type: 'MapPreview', props: { places: { $state: '/missing' }, route: ['invented'], caption: '示意图' } } },
  } }
  const { result } = await call({ places, route: data.route }, response)
  expect(result).toMatchObject({ ok: true, payload: {
    spec: { elements: { map: { props: { places, route: data.route, caption: '示意图' } } } },
    state: { initial: { _ui: { selected: 'kept' } } },
  } })
})

it('keeps the service failure details when a map is degraded', async () => {
  const response = { ...payload, meta: { extensions: { generation: {
    outcome: 'degraded', failure: 'retry_exhausted', issues: [{ code: 'invalid_props',
      message: 'Invalid MapPreview at map/props/places: Invalid input', path: '/elements/map/props/places' }],
  } } } }
  const { result, fetchImpl } = await call({ places }, response)
  expect(result.ok).toBe(false)
  if (result.ok || result.error === undefined) throw new Error('Expected degraded map')
  expect(result.error.diagnostics.issues.find(issue => issue.code === 'render_degraded')?.message).toContain('retry_exhausted')
  expect(result.error.diagnostics.issues).toContainEqual({ code: 'invalid_props',
    message: 'Invalid MapPreview at map/props/places: Invalid input', path: '/elements/map/props/places',
  })
  expect(fetchImpl).toHaveBeenCalledOnce()
})

it('does not infer MapPreview from rich_content, places or tracking without an explicit component', async () => {
  const response = { format: 'json-render-v1', spec: { root: 'notice', elements: { notice: { type: 'Text', props: { content: '文字' } } } } }
  const { result, fetchImpl } = await call({ ...data, tracking: { source: 'unknown' } }, response, { components: [], intent: 'rich_content' })
  expect(result).toMatchObject({ ok: true, payload: response })
  const body = JSON.parse(requestText(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
  expect(body).not.toHaveProperty('required_components')
  expect(body).not.toHaveProperty('map_binding')
})

it('assembles the supported campus demo without requiring a real robot', async () => {
  const demo = { ...tracking, source: 'robot-demo', trackId: 'campus-route' }
  const { result } = await call({ ...data, tracking: demo })
  expect(result).toMatchObject({ ok: true, payload: { state: { initial: { tracking: demo } }, spec: { elements: { map: {
    props: { tracking: { source: 'robot-demo', trackId: 'campus-route' }, position: { $state: '/tracking/position' } },
  } } } } })
})

it('removes tracking from hidden and unreachable maps to prevent unwanted subscriptions', async () => {
  const extra = { ...map, props: { ...map.props, tracking: { source: 'robot-live', trackId: 'invented' }, position: { $state: '/tracking/position' } } }
  const response = { ...payload, spec: { root: 'root', elements: {
    root: { type: 'Stack', children: ['map', 'hidden'] }, map,
    hidden: { ...extra, visible: false }, orphan: extra,
  } } }
  const { result } = await call(data, response)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  expect(JSON.stringify(result.payload)).not.toContain('invented')
  expect(result.payload).toMatchObject({ spec: { elements: { map: { props: { tracking: { trackId: 'escort-test' } } } } } })
})

it('rejects an explicitly degraded service response for an explicit map request', async () => {
  const response = { ...payload, meta: { extensions: { generation: { outcome: 'degraded' } } } }
  const { result, fetchImpl } = await call(data, response)
  expect(result).toMatchObject({ ok: false, error: { diagnostics: { issues: [{ code: 'render_degraded' }] } } })
  expect(fetchImpl).toHaveBeenCalledOnce()
})

it('does not infer a map from unrelated data when the caller explicitly requests a chart', async () => {
  const response = { format: 'json-render-v1', spec: { root: 'chart', elements: { chart: { type: 'Chart', props: {} } } } }
  const { result, fetchImpl } = await call(data, response, { components: ['Chart'], intent: 'rich_content' })
  expect(result.ok).toBe(true)
  const body = JSON.parse(requestText(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
  expect(body).not.toHaveProperty('required_components')
  expect(body).not.toHaveProperty('map_binding')
})

it.each(['Chart', 'Image', 'Tabs', 'Workflow'])('preserves the previous acceptance behavior for %s', async (component) => {
  const response = { format: 'json-render-v1', spec: { root: 'notice', elements: { notice: { type: 'Text', props: { content: '既有结果' } } } } }
  const { result, fetchImpl } = await call(data, response, { components: [component], intent: 'rich_content' })
  expect(result).toMatchObject({ ok: true, payload: response })
  const body = JSON.parse(requestText(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
  expect(body).not.toHaveProperty('required_components')
  expect(body).not.toHaveProperty('map_binding')
  expect(body.user_query).toContain(component)
})

it('only enforces MapPreview in a mixed component request', async () => {
  const { result, fetchImpl } = await call(data, payload, { components: ['MapPreview', 'Chart'] })
  expect(result.ok).toBe(true)
  const body = JSON.parse(requestText(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
  expect(body.required_components).toEqual(['MapPreview'])
})

it('does not apply the new response guards to non-map results', async () => {
  const response = { format: 'json-render-v1', spec: { root: 'missing', elements: {} }, meta: { extensions: { generation: { outcome: 'degraded' } } } }
  const { result } = await call({ name: 'demo' }, response, { components: [] })
  expect(result).toMatchObject({ ok: true, payload: response })
})
