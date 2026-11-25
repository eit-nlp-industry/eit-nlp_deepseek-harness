// Mock booking for the v0.3.1 demo.
//
// `campus_visit: true` → always success (校园访客预约).
// Otherwise → 50% success / 50% failure with alternative start/end windows.

export const name = 'booking-mock'
export const inject = ['tools']

let sequence = 0

/** Failure alternatives as start/end pairs (not single-hour slot strings). */
const ALTERNATIVE_WINDOWS = Object.freeze([
  { start: '14:00', end: '16:00' },
  { start: '15:00', end: '17:00' },
])

/** Probability of success when not a campus-visit booking (0–1). */
const SUCCESS_PROBABILITY = 0.5

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'submit_booking',
    description: [
      '提交预约（演示用，不会真的占用场地）。',
      '仅在用户确认预约草稿后调用。',
      '入参 campus_visit：是否为访校 / 校园访客预约。',
      'campus_visit 为 true 时一律预约成功；否则按概率成功或失败。',
      '失败时 alternatives 为建议的开始/结束时间对（可跨多小时），不是单小时档。',
      '访校预约（场地为校园访客等）传 campus_visit=true；其它场地预约传 false。',
      '按工具返回原文转告，不要编造成功或失败。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['campus_visit'],
      properties: {
        campus_visit: {
          type: 'boolean',
          description: '是否为访校 / 校园访客预约。true 一律成功；false 走随机成败。',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'message'],
        properties: {
          ok: { type: 'boolean' },
          booking_id: { type: 'string' },
          alternatives: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['start', 'end'],
              properties: {
                start: { type: 'string' },
                end: { type: 'string' },
              },
            },
          },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      const campusVisit = isRecord(args) && args.campus_visit === true
      if (campusVisit || Math.random() < SUCCESS_PROBABILITY) {
        sequence += 1
        const bookingId = `BK-DEMO-${String(sequence).padStart(3, '0')}`
        const kind = campusVisit ? '访校预约' : '预约'
        return {
          ok: true,
          booking_id: bookingId,
          message: `${kind}成功（演示）：${bookingId}。这是演示预约，不会真的占用场地。`,
        }
      }

      const alternatives = ALTERNATIVE_WINDOWS.map(window => ({ ...window }))
      const listed = ALTERNATIVE_WINDOWS.map(window => `${window.start}-${window.end}`).join('、')
      return {
        ok: false,
        alternatives,
        message: `预约失败：当前起止时间不可用。可选时段：${listed}。可改约到上述起止后再试。`,
      }
    },
  })
}
