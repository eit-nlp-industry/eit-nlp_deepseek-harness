// Mock venue booking for the v0.3 demo.
//
// The reservation form only collects information; this tool turns the
// submitted values into a fake booking result so the conversation can show a
// confirmation number. Every venue succeeds except 四明书院 in the evening,
// which always reports the slot as taken (the demo's failure case).

export const name = 'booking-mock'
export const inject = ['tools']

let sequence = 0

function eveningSlot(slot) {
  const hours = (slot.match(/\d{1,2}/g) ?? []).map(Number)
  return hours.some(hour => hour === 20 || hour === 21)
    || (hours.includes(8) && hours.includes(9))
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'submit_booking',
    description: [
      '提交一条场地预约（演示用，不会真的占用场地）。',
      '用户提交预约表单后调用；venue 填场地名，date 填日期，slot 填时段，people 填人数，note 填用途和备注。',
      '成功时返回预约编号，失败时返回原因。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['venue', 'date', 'slot'],
      properties: {
        venue: { type: 'string', description: '场地名，例如「图书馆研讨室」「四明书院」' },
        date: { type: 'string', description: '日期，例如 2026-11-05' },
        slot: { type: 'string', description: '时段，例如 20:00-21:00' },
        people: { type: 'number', description: '人数' },
        note: { type: 'string', description: '用途和备注' },
        name: { type: 'string', description: '预约人姓名' },
        phone: { type: 'string', description: '联系电话' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'venue', 'date', 'slot', 'message'],
        properties: {
          ok: { type: 'boolean' },
          booking_id: { type: 'string' },
          venue: { type: 'string' },
          date: { type: 'string' },
          slot: { type: 'string' },
          people: { type: 'number' },
          alternatives: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['date', 'slot'],
              properties: {
                date: { type: 'string' },
                slot: { type: 'string' },
              },
            },
          },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      const venue = String(args?.venue ?? '').trim()
      const date = String(args?.date ?? '').trim()
      const slot = String(args?.slot ?? '').trim()
      const people = Number.isFinite(args?.people) ? Number(args.people) : undefined
      const note = typeof args?.note === 'string' ? args.note.trim() : ''
      if (venue === '' || date === '' || slot === '') {
        throw new Error('提交预约需要场地、日期和时段')
      }

      if (venue.includes('四明书院') && eveningSlot(slot)) {
        const alternatives = [
          { date, slot: '14:00-15:00' },
          { date, slot: '16:00-17:00' },
        ]
        const listed = alternatives.map(item => `${item.date} ${item.slot}`).join('；')
        return {
          ok: false,
          venue,
          date,
          slot,
          people,
          alternatives,
          message: `预约失败：四明书院 ${slot} 已经约满。可改约：${listed}。请用这些时段重出同一场地的改约表单（已填的姓名、手机号、人数、备注沿用），不要自己换场地。`,
        }
      }

      sequence += 1
      const stamp = date.replace(/\D/g, '') || '00000000'
      const bookingId = `BK-${stamp}-${String(sequence).padStart(3, '0')}`
      const parts = [`预约成功（演示）：${bookingId}`, `场地：${venue}`, `日期：${date}`, `时段：${slot}`]
      if (people !== undefined) parts.push(`人数：${people}`)
      if (note !== '') parts.push(`备注：${note}`)
      parts.push('这是演示预约，不会真的占用场地。')
      return {
        ok: true,
        booking_id: bookingId,
        venue,
        date,
        slot,
        people,
        message: parts.join('；'),
      }
    },
  })
}
