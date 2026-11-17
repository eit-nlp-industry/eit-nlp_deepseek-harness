// Mock phone GPS for the v0.3.1 demo.
// Returns planar map coords (for MapPreview) and a demo anchor_id (for navigate).
// Live-map trackId belongs to motion tracking, not here.

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
      '从用户手机读取当前定位（演示用，不会访问真实设备）。',
      '需要用户位置或「叫狗过来」时调用；不要向用户追问坐标。',
      '同时返回：平面示意坐标 x、y（供 MapPreview 的「你」）；以及 anchor_id（供 navigate 接人）。',
      '去用户身边用返回的 anchor_id 调用 navigate；地图展示只用 x、y，二者不混用、不换算。',
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
          `已通过手机定位取得位置（演示）：平面 x=${x}, y=${y}；`,
          `navigate 用 anchor_id=${anchorId}（${placeName}）。`,
        ].join(''),
      }
    },
  })
}
