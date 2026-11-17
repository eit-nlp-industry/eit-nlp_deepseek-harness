// Allocates a unique one-shot robot-live track via motionTrackRegistry.
// Caller supplies start/end in map space (0–100). No fixed escort legs.

export const name = 'motion-track-mock'
export const inject = ['tools', 'motionTrackRegistry']

function readPoint(prefix, args) {
  const x = Number(args?.[`${prefix}_x`])
  const y = Number(args?.[`${prefix}_y`])
  if (!Number.isFinite(x) || x < 0 || x > 100 || !Number.isFinite(y) || y < 0 || y > 100) {
    return null
  }
  return { x, y }
}

export function apply(ctx) {
  const registry = ctx.motionTrackRegistry
  if (!registry || typeof registry.allocateOneShot !== 'function') {
    throw new TypeError('motionTrackRegistry.allocateOneShot is required')
  }

  ctx.tools.register({
    name: 'get_motion_track',
    description: [
      '为本段机器狗示意运动分配一条唯一实时轨迹（演示用）。',
      '传入本段狗的起点与终点示意坐标（0–100）；返回 track_id，并注册到 /api/location。',
      '出带机器狗移动的 MapPreview 前调用；start 写入 tracking.position 初值。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['start_x', 'start_y', 'end_x', 'end_y'],
      properties: {
        start_x: { type: 'number', description: '狗起点 x（0–100）' },
        start_y: { type: 'number', description: '狗起点 y（0–100）' },
        end_x: { type: 'number', description: '狗终点 x（0–100）' },
        end_y: { type: 'number', description: '狗终点 y（0–100）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'track_id', 'start', 'end', 'message'],
        properties: {
          ok: { type: 'boolean' },
          track_id: { type: 'string' },
          start: {
            type: 'object',
            additionalProperties: false,
            required: ['x', 'y'],
            properties: { x: { type: 'number' }, y: { type: 'number' } },
          },
          end: {
            type: 'object',
            additionalProperties: false,
            required: ['x', 'y'],
            properties: { x: { type: 'number' }, y: { type: 'number' } },
          },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      const start = readPoint('start', args)
      const end = readPoint('end', args)
      if (!start || !end) {
        return {
          ok: false,
          track_id: '',
          start: { x: 0, y: 0 },
          end: { x: 0, y: 0 },
          message: '需要有效的 start_x/start_y/end_x/end_y（均为 0–100 有限数）。',
        }
      }
      const allocated = registry.allocateOneShot({ start, end })
      return {
        ok: true,
        track_id: allocated.track_id,
        start: allocated.start,
        end: allocated.end,
        message: `运动轨迹（演示）：track_id=${allocated.track_id}；狗 ${allocated.start.x},${allocated.start.y} → ${allocated.end.x},${allocated.end.y}。`,
      }
    },
  })
}
