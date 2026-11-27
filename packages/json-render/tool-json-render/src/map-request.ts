/** Host-owned map facts, request validation, and tracking assembly. */
import { isJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import { isDeepStrictEqual } from 'node:util'
import { validateCatalogPayload } from '@eit/json-render-catalog'
import { richRenderProfile } from '@eit/json-render-catalog/experimental'
import { MAP_POSITION_PATH, MAP_COORDINATE_MIN, MAP_COORDINATE_MAX, LIVE_MAP_SOURCE, DEMO_MAP_SOURCE, CAMPUS_DEMO_TRACK_ID, parseMapPosition, type MapPosition } from '@deepseek-ai/dsh-json-render-protocol'
import { safeDiagnosticText, type RenderLayout, type RenderValidationIssue } from './response-validation.ts'
import type { RenderUiArgs } from './request.ts'

type JsonObject = { [key: string]: JsonValue }

/** Validated map facts and optional provider-owned tracking configuration. */
export type MapRequest = { places: JsonObject[]; route?: string[] } & (
  { tracking: JsonObject; position: MapPosition } | { tracking?: undefined; position?: undefined }
)

function object(value: JsonValue | undefined): value is JsonObject {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
}

function canonicalPlaces(value: JsonValue | undefined): JsonObject[] | undefined {
  if (!Array.isArray(value)) return undefined
  const places: JsonObject[] = []
  for (const point of value) {
    if (!object(point)) return undefined
    const label = point.label ?? point.name
    const coordinate = parseMapPosition({ x: point.x, y: point.y })
    if (typeof point.id !== 'string' || point.id.trim() === '' || typeof label !== 'string' || label.trim() === ''
      || (point.label !== undefined && point.name !== undefined && point.label !== point.name) || coordinate === undefined) return undefined
    places.push({ id: point.id, label, x: coordinate.x, y: coordinate.y })
  }
  return places
}

function mapFacts(data: JsonObject): { ok: true; facts: { places: JsonObject[]; route?: string[] } } | { ok: false; message: string } {
  const places = canonicalPlaces(data.places ?? data.points)
  if (places === undefined) return { ok: false, message: '地图地点无效：business_data.places 须为包含 id、label、x、y 的数组；也支持 points/name 别名。请补充已有地点坐标，不要猜测。' }
  if (data.places !== undefined && data.points !== undefined
    && !isDeepStrictEqual(places, canonicalPlaces(data.points))) {
    return { ok: false, message: '地图地点冲突：places 与 points 不一致，请保留一份明确的地点数据。' }
  }
  const routeInput = object(data.route) ? data.route.pointOrder : data.route
  if (data.route !== undefined && (!Array.isArray(routeInput) || !routeInput.every(id => typeof id === 'string'))) {
    return { ok: false, message: '地图路线无效：business_data.route 须为按顺序排列的地点 id 数组，也支持 route.pointOrder；不能仅提供 legs。' }
  }
  const route = Array.isArray(routeInput) && routeInput.every((id): id is string => typeof id === 'string') ? routeInput : undefined
  if (object(data.route) && data.route.legs !== undefined) {
    const legs = data.route.legs
    if (route === undefined || !Array.isArray(legs) || legs.length !== Math.max(0, route.length - 1)
      || legs.some((leg, index) => !object(leg) || leg.from !== route[index] || leg.to !== route[index + 1])) {
      return { ok: false, message: '地图路线冲突：route.legs 与 pointOrder 的相邻地点不一致，请明确真实路线顺序。' }
    }
  }
  const facts = { places, ...route === undefined ? {} : { route } }
  const checked = validateCatalogPayload(richRenderProfile.catalog, {
    format: 'json-render-v1', spec: { root: 'map', elements: { map: { type: 'MapPreview', props: facts } } },
  })
  if (!checked.success) return { ok: false, message: `地图数据无效：${checked.issues.slice(0, 8).map(safeDiagnosticText).filter(issue => issue !== undefined).join('；')}。请修正地点、坐标或路线引用后再调用。` }
  return { ok: true, facts }
}

/**
 * Resolve an explicitly declared MapPreview request before generation.
 * @param args - Model-supplied tool arguments with optional map facts at the business-data root.
 * @returns Unchanged arguments for other requests; normalized map facts or an actionable coordinate error for maps.
 */
export function prepareMapRequest(args: RenderUiArgs):
  | { ok: true; args: RenderUiArgs; map?: MapRequest }
  | { ok: false; message: string } {
  if (!args.components?.includes('MapPreview')) return { ok: true, args }
  const businessData = args.business_data
  const json = isJsonValue(businessData) ? businessData as JsonValue : undefined
  const data = object(json) ? json : {}
  const resolved = mapFacts(data)
  if (!resolved.ok) return resolved
  const changed = !isDeepStrictEqual(data.places, resolved.facts.places) || !isDeepStrictEqual(data.route, resolved.facts.route)
  const source = {
    ...data.places === undefined ? {} : { places: data.places },
    ...data.points === undefined ? {} : { points: data.points },
    ...data.route === undefined ? {} : { route: data.route },
  }
  if (changed && data.map_source !== undefined && !isDeepStrictEqual(data.map_source, source)) {
    return { ok: false, message: '地图原始数据字段 map_source 冲突，请将已有同名业务字段另行命名；宿主不会覆盖其内容。' }
  }
  const normalized = { ...args, business_data: { ...data, ...resolved.facts, ...changed ? { map_source: source } : {} } }
  if (data.tracking === undefined) return { ok: true, args: normalized, map: resolved.facts }
  const tracking = data.tracking
  if (!object(tracking) || (tracking.source !== LIVE_MAP_SOURCE && tracking.source !== DEMO_MAP_SOURCE)
    || typeof tracking.trackId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(tracking.trackId)
    || (tracking.source === DEMO_MAP_SOURCE && tracking.trackId !== CAMPUS_DEMO_TRACK_ID)) {
    return { ok: false, message: `地图追踪信息无效。请使用机器人服务提供的 source 和 trackId；本地演示使用 ${DEMO_MAP_SOURCE} / ${CAMPUS_DEMO_TRACK_ID}。不要猜测追踪标识。` }
  }
  const position = parseMapPosition(tracking.position) ?? parseMapPosition(data.position)
  if (position === undefined) {
    return { ok: false, message: `地图实时追踪缺少有效初始坐标。请在 business_data.tracking.position 提供真实的 x、y（${MAP_COORDINATE_MIN}–${MAP_COORDINATE_MAX}）及可选状态，不要填写指向自身的 $state。无法获取位置时，移除 tracking，仅展示静态路线并说明位置暂不可用。` }
  }
  const initial = position
  const metadata = { source: tracking.source, trackId: tracking.trackId }
  return { ok: true, args: { ...normalized,
    business_data: { ...normalized.business_data, tracking: { ...metadata, position: initial } },
  }, map: { ...resolved.facts, tracking: metadata, position: initial } }
}

/**
 * Assemble map data and metadata from validated caller facts, then validate remaining props.
 * @param layout - Inspected layout and its reachable element identities.
 * @param map - Validated places, route, and optional tracking facts.
 * @returns The assembled payload or bounded map validation issues.
 */
export function assembleMapPayload(layout: RenderLayout, map: MapRequest):
  | { ok: true; payload: JsonValue }
  | { ok: false; issues: RenderValidationIssue[] } {
  const { payload, spec, reachable } = layout
  const elements = { ...layout.elements }
  for (const [id, element] of Object.entries(elements)) {
    if (!object(element) || element.type !== 'MapPreview') continue
    const props = object(element.props) ? { ...element.props } : {}
    delete props.tracking
    delete props.position
    if (reachable.has(id) && element.visible !== false) {
      props.places = map.places
      delete props.route
      if (map.route !== undefined) props.route = map.route
    }
    if (map.tracking !== undefined && reachable.has(id) && element.visible !== false) {
      props.tracking = map.tracking
      props.position = { $state: MAP_POSITION_PATH }
    }
    elements[id] = { ...element, props }
  }
  const state = object(payload.state) ? payload.state : {}
  const initial = object(state.initial) ? state.initial : {}
  const completed = { ...payload, spec: { ...spec, elements },
    ...(map.tracking === undefined ? {} : { state: { ...state, initial: {
      ...initial, tracking: { ...map.tracking, position: map.position },
    } } }),
  }
  // Only maps are checked here; other component validation remains server-owned.
  for (const id of reachable) {
    const element = elements[id]
    if (!object(element) || element.type !== 'MapPreview' || element.visible === false) continue
    const checked = validateCatalogPayload(richRenderProfile.catalog, { ...completed,
      spec: { root: id, elements: { [id]: element } },
    })
    if (!checked.success) {
      const messages = checked.issues.slice(0, 8).map(safeDiagnosticText).filter(message => message !== undefined)
      return { ok: false, issues: (messages.length > 0 ? messages : ['MapPreview properties are invalid; sensitive diagnostic details were omitted.'])
        .map(message => ({ code: 'invalid_map', message })) }
    }
  }
  return { ok: true, payload: completed }
}
