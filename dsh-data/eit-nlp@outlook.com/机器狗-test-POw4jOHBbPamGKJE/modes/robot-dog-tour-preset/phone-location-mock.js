// Mock phone GPS for the tour demo (test-only).
// Returns planar map coords (for MapPreview) and a demo anchor_id.
// This is NOT a real visitor location: never use it to start real pickup navigation.
// Not registered in cordis.patch.yml; kept as a test fixture only.

export const name = 'phone-location-mock'
export const inject = ['tools']

export function apply(ctx, config = {}) {
  const x = Number.isFinite(config.x) ? Number(config.x) : 0
  const y = Number.isFinite(config.y) ? Number(config.y) : 0
  const anchorId = typeof config.anchorId === 'string' && config.anchorId.trim()
    ? config.anchorId.trim()
    : 'note_20260817_140936_571'
  const placeName = typeof config.placeName === 'string' && config.placeName.trim()
    ? config.placeName.trim()
    : '用户位置'

  ctx.tools.register({
    name: 'get_phone_location',
    description: [
      '【演示模拟定位，不是真实游客位置】返回固定的演示坐标和 anchor_id，不会访问真实设备，也不代表用户实际位置。',
      '仅用于隔离测试和 MapPreview 演示；第一阶段不得用它启动真实接人导航。',
      '真实接人/导航地点必须使用 search_ragflow_semantic_map 返回的锚点；不要向用户追问坐标。',
      '返回：平面示意坐标 x、y（供 MapPreview 的「你」）；以及演示 anchor_id。x、y 只用于地图展示，不用于导航。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'x', 'y', 'anchor_id', 'place_name', 'source', 'message'],
        properties: {
          ok: { type: 'boolean' },
          x: { type: 'number' },
          y: { type: 'number' },
          anchor_id: { type: 'string' },
          place_name: { type: 'string' },
          source: { type: 'string' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute() {
      return {
        ok: true,
        x,
        y,
        anchor_id: anchorId,
        place_name: placeName,
        source: 'phone_mock',
        message: [
          `【演示模拟定位，不是真实位置】平面 x=${x}, y=${y}；`,
          `演示 anchor_id=${anchorId}（${placeName}）；真实接人导航请改用语义地图锚点。`,
        ].join(''),
      }
    },
  })
}
