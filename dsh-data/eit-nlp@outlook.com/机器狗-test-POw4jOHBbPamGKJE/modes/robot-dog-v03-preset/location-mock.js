// Mock place lookup for the v0.3 demo.
//
// MapPreview percentage space (y grows downward):
// - 起点：中间高度、地图最左侧（横向干道左端）
// - 自习室A/B：左下那栋楼（用户红框）的西北角 / 东南角
// Keep coordinates in sync with location-api track quiet-ab-01.
//
 // When both study rooms are returned, also emit render_ui_args: a known-good
// MapPreview-only payload (passes generation validation, no table/Steps).

export const name = 'location-mock'
export const inject = ['tools']

const TRACK_ID = 'quiet-ab-01'

const BUILDING = {
  id: 'mock-study-hall',
  label: '演示教学楼（自习区）',
  note: '演示坐标：起点(0,50)；自习室A(4,70)；自习室B(15,85)。不是真实语义地图点位。',
}

/** Mid-height, far-left start (user-specified). */
export const START_PLACE = Object.freeze({
  id: 'start',
  label: '起点',
  x: 0,
  y: 50,
})

const PLACES = Object.freeze([
  {
    id: 'study-room-a',
    label: '自习室A',
    aliases: ['自习室a', '自习室 A', 'study room a', 'study-a'],
    x: 4,
    y: 70,
    corner: '西北角',
  },
  {
    id: 'study-room-b',
    label: '自习室B',
    aliases: ['自习室b', '自习室 B', 'study room b', 'study-b'],
    x: 15,
    y: 85,
    corner: '东南角',
  },
])

// Verified against json-render: MapPreview only + /tracking/position binding.
const MAP_USER_QUERY = [
  '只渲染一个 MapPreview；',
  '展示 places 与 route；',
  'tracking 用 business_data.tracking（含 source、trackId、position）；',
  'position 绑定 {"$state":"/tracking/position"}；',
  '不要表格、Steps、卡片、标题或任何明细。',
].join('')

function normalizeQuery(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

const GENERIC_QUERIES = new Set(
  ['自习室', '自习', 'study', 'studyroom', '教学楼', '演示教学楼', '演示教学楼（自习区）']
    .map(value => normalizeQuery(value)),
)

const START_QUERIES = new Set(['起点', 'start', '出发点'].map(normalizeQuery))

function placeNames(place) {
  return [place.label, place.id, ...place.aliases].map(normalizeQuery)
}

function resolvePlaces(raw) {
  const query = normalizeQuery(raw)
  if (query === '' || GENERIC_QUERIES.has(query)) return [...PLACES]
  if (START_QUERIES.has(query)) return []

  const exact = PLACES.filter(place => placeNames(place).includes(query))
  if (exact.length > 0) return exact

  const hasA = /自习室a|studya|study-room-a|studyrooma/.test(query) || query.endsWith('a')
  const hasB = /自习室b|studyb|study-room-b|studyroomb/.test(query) || query.endsWith('b')
  if (hasA && !hasB) return PLACES.filter(place => place.id === 'study-room-a')
  if (hasB && !hasA) return PLACES.filter(place => place.id === 'study-room-b')

  const partial = PLACES.filter(place => placeNames(place).some(name => (
    name.includes(query) || query.includes(name)
  )))
  if (partial.length > 0) return partial
  return []
}

function toStart() {
  return {
    id: START_PLACE.id,
    label: START_PLACE.label,
    x: START_PLACE.x,
    y: START_PLACE.y,
  }
}

function toResult(place) {
  return {
    id: place.id,
    label: place.label,
    x: place.x,
    y: place.y,
    corner: place.corner,
    building_id: BUILDING.id,
    building_label: BUILDING.label,
  }
}

function buildRenderUiArgs(start, studyPlaces) {
  const places = [
    { id: start.id, label: start.label, x: start.x, y: start.y },
    ...studyPlaces.map(place => ({
      id: place.id,
      label: place.label,
      x: place.x,
      y: place.y,
    })),
  ]
  return {
    mode: 'display',
    components: ['MapPreview'],
    intent: 'rich_content',
    locale: 'zh-CN',
    user_query: MAP_USER_QUERY,
    business_data: {
      places,
      route: places.map(place => place.id),
      tracking: {
        source: 'robot-live',
        trackId: TRACK_ID,
        position: { x: start.x, y: start.y, status: 'idle' },
      },
    },
  }
}

const startSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label', 'x', 'y'],
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    x: { type: 'number' },
    y: { type: 'number' },
  },
}

const placeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label', 'x', 'y', 'corner', 'building_id', 'building_label'],
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    x: { type: 'number' },
    y: { type: 'number' },
    corner: { type: 'string' },
    building_id: { type: 'string' },
    building_label: { type: 'string' },
  },
}

const renderUiArgsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'components', 'intent', 'locale', 'user_query', 'business_data'],
  properties: {
    mode: { type: 'string', enum: ['display'] },
    components: { type: 'array', items: { type: 'string', enum: ['MapPreview'] } },
    intent: { type: 'string', enum: ['rich_content'] },
    locale: { type: 'string', enum: ['zh-CN'] },
    user_query: { type: 'string' },
    business_data: {
      type: 'object',
      additionalProperties: false,
      required: ['places', 'route', 'tracking'],
      properties: {
        places: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'label', 'x', 'y'],
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' },
            },
          },
        },
        route: { type: 'array', items: { type: 'string' } },
        tracking: {
          type: 'object',
          additionalProperties: false,
          required: ['source', 'trackId', 'position'],
          properties: {
            source: { type: 'string', enum: ['robot-live'] },
            trackId: { type: 'string' },
            position: {
              type: 'object',
              additionalProperties: false,
              required: ['x', 'y', 'status'],
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                status: { type: 'string', enum: ['idle', 'moving', 'arrived'] },
              },
            },
          },
        },
      },
    },
  },
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'query_place',
    description: [
      '演示用地点查询：返回校园示意坐标，并在查到自习室A+B时附带可直接调用的 render_ui_args。',
      '找安静地方出图时：先调本工具（name=「自习室」），再把返回的 render_ui_args 原样传给 render_ui，禁止改 user_query、禁止改 business_data、禁止自己拼地图参数。',
      '其他地点返回未找到，不要编造坐标。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: {
          type: 'string',
          description: '地点名称，例如「自习室A」「自习室B」或「自习室」；可省略以列出全部 mock 自习点',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'query', 'places', 'message'],
        properties: {
          ok: { type: 'boolean' },
          query: { type: 'string' },
          start: startSchema,
          building: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'label', 'note'],
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              note: { type: 'string' },
            },
          },
          places: { type: 'array', items: placeSchema },
          render_ui_args: renderUiArgsSchema,
          message: { type: 'string' },
        },
      },
      // Model-visible tool text must include render_ui_args; message-only hide it.
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const raw = typeof args?.name === 'string' ? args.name.trim() : ''
      const query = normalizeQuery(raw)

      if (START_QUERIES.has(query)) {
        const start = toStart()
        return {
          ok: true,
          query: raw,
          start,
          places: [],
          message: `查询成功（演示）：起点（x=${start.x}, y=${start.y}）。找安静地方请改查「自习室」以获取 render_ui_args。`,
        }
      }

      const matched = resolvePlaces(raw)
      if (matched.length === 0) {
        return {
          ok: false,
          query: raw,
          places: [],
          message: `未找到地点「${raw || '(空)'}」。演示库仅有：起点（中间最左侧）、自习室A（西北角）、自习室B（东南角）。`,
        }
      }

      const start = toStart()
      const places = matched.map(toResult)
      const listed = places
        .map(place => `${place.label}（${place.corner}，x=${place.x}, y=${place.y}）`)
        .join('；')

      const hasBoth = places.some(p => p.id === 'study-room-a')
        && places.some(p => p.id === 'study-room-b')
      const payload = {
        ok: true,
        query: raw,
        start,
        building: BUILDING,
        places,
        message: [
          `查询成功（演示）：起点（x=${start.x}, y=${start.y}）；${listed}。`,
          hasBoth
            ? '下一步：把本结果 JSON 里的 render_ui_args 原样传给 render_ui（不要改任何字段）。'
            : '未同时返回 A 与 B，无 render_ui_args；找安静地方请 name=「自习室」。',
        ].join(''),
      }
      if (hasBoth) {
        payload.render_ui_args = buildRenderUiArgs(start, places)
        // Also echo a one-line pointer so truncated UIs still show the key exists.
        payload.message += ` render_ui_args.trackId=${TRACK_ID}; places=${payload.render_ui_args.business_data.places.length}。`
      }
      return payload
    },
  })
}
