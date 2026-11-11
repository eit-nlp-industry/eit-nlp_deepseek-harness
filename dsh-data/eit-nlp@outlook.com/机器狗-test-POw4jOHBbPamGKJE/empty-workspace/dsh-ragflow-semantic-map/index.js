import { normalizeConfig } from './config.js'
import { createSearchClient } from './search.js'

export const name = 'ragflow-semantic-map'
export const inject = ['tools']

export function apply(ctx, config) {
  return install(ctx, config)
}

const stringArray = { type: 'array', items: { type: 'string' } }
const attributes = properties => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties,
})
const position = {
  oneOf: [attributes({
    frame_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    x: { type: 'number' }, y: { type: 'number' },
    z: { oneOf: [{ type: 'number' }, { type: 'null' }] },
  }), { type: 'null' }],
}
const count = { type: 'integer' }
const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }] }
const omitted = { type: 'array', items: attributes({
  id: { type: 'string' }, label: { type: 'string' }, reason: { type: 'string' },
}) }
const renderArguments = {
  type: 'object', additionalProperties: false,
  required: ['mode', 'components', 'locale', 'user_query', 'business_data'],
  properties: {
    mode: { type: 'string', enum: ['display'] },
    components: { type: 'array', items: { type: 'string', enum: ['MapPreview'] } },
    locale: { type: 'string', enum: ['zh-CN'] },
    answer_presentation: { type: 'string', enum: ['supplement'] },
    user_query: { type: 'string' },
    business_data: attributes({
      scene_id: nullableString, frame_id: { type: 'string' }, unit: { type: 'string', enum: ['m'] },
      total_count: count, displayed_count: count, group_count: count,
      coordinate_note: { type: 'string' },
      places: { type: 'array', items: attributes({
        id: { type: 'string' }, label: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
      }) },
      source_coordinates: { type: 'array', items: attributes({
        ...position.oneOf[0].properties, id: { type: 'string' }, label: { type: 'string' },
      }) },
      omitted,
    }),
  },
}

export function install(ctx, input, dependencies) {
  if (input?.enabled === false) return
  const config = normalizeConfig(input)
  const client = createSearchClient(config, dependencies)
  ctx.tools.register({
    name: 'search_ragflow_semantic_map',
    description: '只读RAGFlow语义地图工具。默认mode=search，传query检索候选及原始spatial米制坐标，不能当作完整地图。展示全部地图时传{mode:"all"}且不传query：分页读取配置Dataset中全部semantic_anchor__*.txt文档及Chunk，不按相关性或可导航性筛选；成功返回complete=true、去重candidates、数量、遗漏原因及可直接逐项传给render_ui的renders。all的similarity=null；不同scene_id或frame_id分图，局部XY已缩放至5–95并翻转Y，不要再次转换。缺少局部坐标的候选仍保留但不绘点。知识库可能保留旧导入记录，完整列表不保证是最新源地图快照。返回坐标不保证是导航停靠点，不执行机器人动作。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        mode: { type: 'string', enum: ['search', 'all'], description: '省略为search。all读取全部语义地图且禁止传query。' },
        query: { type: 'string', description: 'search模式必填：地点名称或地点需求，最多500字符；all模式不传。' },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, required: ['candidates'],
        properties: {
          candidates: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              required: ['anchor_id', 'canonical_name', 'scene_id', 'spatial',
                'similarity', 'explicit_attributes', 'inferred_attributes'],
              properties: {
                anchor_id: { type: 'string' }, canonical_name: { type: 'string' },
                scene_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                similarity: { oneOf: [{ type: 'number' }, { type: 'null' }] },
                spatial: attributes({
                  unit: { type: 'string', enum: ['m'] },
                  position_local: position, position_atlas: position,
                }),
                explicit_attributes: attributes({
                  functions: stringArray, objects: stringArray, people: stringArray,
                  notes: stringArray, access_rules: stringArray,
                }),
                inferred_attributes: attributes({
                  likely_objects: stringArray, likely_tasks: stringArray, reason: { type: 'string' },
                }),
              },
            },
          },
          complete: { type: 'boolean', enum: [true] },
          skipped_document_count: count,
          total_count: count, displayed_count: count, omitted,
          renders: { type: 'array', items: renderArguments },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (!args || typeof args !== 'object' || Array.isArray(args)
        || Object.keys(args).some(key => !['mode', 'query'].includes(key))) {
        throw new Error('SEARCH_QUERY_INVALID: 只接受mode和query字段。')
      }
      const mode = Object.hasOwn(args, 'mode') ? args.mode : 'search'
      if (mode === 'all' && !Object.hasOwn(args, 'query')) return client.retrieveAll(exec.signal)
      if (mode !== 'search' || !Object.hasOwn(args, 'query')) {
        throw new Error('SEARCH_QUERY_INVALID: search需要query；all禁止query。')
      }
      return { candidates: await client.retrieve(args.query, exec.signal) }
    },
  })
}
