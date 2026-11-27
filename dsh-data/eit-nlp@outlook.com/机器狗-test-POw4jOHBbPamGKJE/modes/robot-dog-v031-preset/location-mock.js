// Mock place lookup for the v0.3.1 demo.
//
// MapPreview percentage space (y grows downward):
// - 起点：中间高度、地图最左侧 (0,50)
// - 自习室A/B：左下楼西北角 / 东南角（与 location-api quiet-ab-01 一致）
// - 图书馆：示意 (40,0)
// - 学校大门：示意 (0,100)
//
// Returns demo coordinates. Live trackId is allocated by get_motion_track,
// not baked into render_ui_args.

export const name = 'location-mock'
export const inject = ['tools']

const STUDY_BUILDING = {
  id: 'mock-study-hall',
  label: '演示教学楼（自习区）',
  note: '演示坐标：起点(0,50)；自习室A(4,70)；自习室B(15,85)；图书馆(40,0)；学校大门(0,100)。不是真实语义地图点位。',
}

const LIBRARY_BUILDING = {
  id: 'mock-library',
  label: '演示图书馆',
  note: '演示示意坐标 (40,0)；真机行动请另用语义地图取 anchor_id。',
}

const GATE_BUILDING = {
  id: 'mock-school-gate',
  label: '演示学校大门',
  note: '演示示意坐标 (0,100)；真机行动请另用语义地图取 anchor_id。',
}

/** Mid-height, far-left start (user-specified). */
export const START_PLACE = Object.freeze({
  id: 'start',
  label: '起点',
  x: 0,
  y: 50,
})

const STUDY_PLACES = Object.freeze([
  {
    id: 'study-room-a',
    label: '自习室A',
    aliases: ['自习室a', '自习室 A', 'study room a', 'study-a'],
    x: 4,
    y: 70,
    corner: '西北角',
    building: STUDY_BUILDING,
  },
  {
    id: 'study-room-b',
    label: '自习室B',
    aliases: ['自习室b', '自习室 B', 'study room b', 'study-b'],
    x: 15,
    y: 85,
    corner: '东南角',
    building: STUDY_BUILDING,
  },
])

const LIBRARY_PLACE = Object.freeze({
  id: 'library',
  label: '图书馆',
  aliases: ['library', 'lib', '校园图书馆', '学校图书馆'],
  x: 40,
  y: 0,
  corner: '示意点',
  building: LIBRARY_BUILDING,
})

const GATE_PLACE = Object.freeze({
  id: 'school-gate',
  label: '学校大门',
  aliases: ['校门', '大门', '学校入口', '校园大门', 'school gate', 'gate', 'main gate'],
  x: 0,
  y: 100,
  corner: '示意点',
  building: GATE_BUILDING,
})

const PLACES = Object.freeze([...STUDY_PLACES, LIBRARY_PLACE, GATE_PLACE])

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
  if (query === '') return [...PLACES]
  if (GENERIC_QUERIES.has(query)) return [...STUDY_PLACES]
  if (START_QUERIES.has(query)) return []

  const exact = PLACES.filter(place => placeNames(place).includes(query))
  if (exact.length > 0) return exact

  const hasA = /自习室a|studya|study-room-a|studyrooma/.test(query)
  const hasB = /自习室b|studyb|study-room-b|studyroomb/.test(query)
  if (hasA && !hasB) return STUDY_PLACES.filter(place => place.id === 'study-room-a')
  if (hasB && !hasA) return STUDY_PLACES.filter(place => place.id === 'study-room-b')

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
    building_id: place.building.id,
    building_label: place.building.label,
  }
}

function buildRenderUiArgs(start, destinations) {
  const places = [
    { id: start.id, label: start.label, x: start.x, y: start.y },
    ...destinations.map(place => ({
      id: place.id,
      label: place.label,
      x: place.x,
      y: place.y,
    })),
  ]
  return {
    mode: 'display',
    answer_presentation: 'supplement',
    components: ['MapPreview'],
    intent: 'rich_content',
    locale: 'zh-CN',
    scene: 'dog',
    user_query: MAP_USER_QUERY,
    business_data: {
      places,
      route: places.map(place => place.id),
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
  required: ['mode', 'answer_presentation', 'components', 'intent', 'locale', 'user_query', 'business_data'],
  properties: {
    mode: { type: 'string', enum: ['display'] },
    answer_presentation: { type: 'string', enum: ['supplement'] },
    components: { type: 'array', items: { type: 'string', enum: ['MapPreview'] } },
    intent: { type: 'string', enum: ['rich_content'] },
    locale: { type: 'string', enum: ['zh-CN'] },
    scene: { type: 'string', enum: ['dog'] },
    user_query: { type: 'string' },
    business_data: {
      type: 'object',
      additionalProperties: false,
      required: ['places', 'route'],
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
      },
    },
  },
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'query_place',
    description: [
      '演示用地点查询：返回校园示意平面坐标（0–100），供 MapPreview 展示。',
      '按已定地点名查示意平面坐标；例如「图书馆」「学校大门」「自习室A/B」「自习室」「起点」。坐标以本工具返回为准。',
      '查到地点时附带 MapPreview 的 render_ui_args：places 是演示起点加上查到的地点。这些点的坐标不要改、不要另编。',
      '这一段的起点或终点如果不是这条 places（例如先去用户身边），用已返回的坐标改写 places 和 route，使地图只含这一段。',
      '要让机器狗在图上移动时，先 get_motion_track，再把返回的 track_id 写入 business_data.tracking。',
      '真机行动的命名锚点用语义地图检索；用户身边用 get_phone_location 的 anchor_id 做 navigate。平面坐标仅供 MapPreview。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: {
          type: 'string',
          description: '已选定的地点名称，例如「图书馆」「学校大门」「自习室A」「自习室B」或「自习室」；可省略以列出全部演示点',
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
          message: `查询成功（演示）：起点（x=${start.x}, y=${start.y}）。`,
        }
      }

      const matched = resolvePlaces(raw)
      if (matched.length === 0) {
        return {
          ok: false,
          query: raw,
          places: [],
          message: `未找到地点「${raw || '(空)'}」。演示库仅有：起点、图书馆(40,0)、学校大门(0,100)、自习室A(4,70)、自习室B(15,85)。`,
        }
      }

      const start = toStart()
      const places = matched.map(toResult)
      const listed = places
        .map(place => `${place.label}（${place.corner}，x=${place.x}, y=${place.y}）`)
        .join('；')

      const onlyStudy = matched.every(place => place.id.startsWith('study-room-'))
      const building = onlyStudy ? STUDY_BUILDING : matched[0].building
      const renderUiArgs = buildRenderUiArgs(start, places)
      return {
        ok: true,
        query: raw,
        start,
        building,
        places,
        render_ui_args: renderUiArgs,
        message: [
          `查询成功（演示）：起点（x=${start.x}, y=${start.y}）；${listed}。`,
          '静态示意地图：把本结果 JSON 里的 render_ui_args 原样传给 render_ui。',
          '平面坐标只用于这张图；navigate 仍用语义地图或 get_phone_location 的 anchor_id。',
          `places=${renderUiArgs.business_data.places.length}。`,
        ].join(''),
      }
    },
  })
}
