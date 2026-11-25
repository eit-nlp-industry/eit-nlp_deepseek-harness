// Mock text-to-speech for the v0.3.1 demo.
// Accepts text and always reports success; does not synthesize real audio.

export const name = 'speech-mock'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register({
    name: 'text_to_speech',
    description: [
      '把一段文本转成语音并播放（演示用，不会真正合成或外放）。',
      '需要对用户口头播报短句时调用；传入要说的完整中文即可。',
      '成功时 ok 为 true；按返回原文转告，不要假装已听到声音。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: {
        text: {
          type: 'string',
          description: '要转换为语音的文本',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'text', 'message'],
        properties: {
          ok: { type: 'boolean' },
          text: { type: 'string' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      const text = typeof args?.text === 'string' ? args.text.trim() : ''
      if (!text) {
        return {
          ok: false,
          text: '',
          message: '未提供要转换的文本。',
        }
      }
      return {
        ok: true,
        text,
        message: `已接收播报文本（演示，未真实播放）：${text}`,
      }
    },
  })
}
