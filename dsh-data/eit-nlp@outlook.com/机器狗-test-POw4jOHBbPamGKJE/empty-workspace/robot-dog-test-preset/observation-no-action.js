// observation_no_action — the model's silent way to end an observation turn.
//
// A camera-observation turn usually needs no user-visible answer. Returning an
// empty assistant text would be an empty model response (which the DeepSeek
// adapter treats as an error), so the model calls this tool instead;
// `concludeTurn()` marks the successful result as terminal for the turn.

export const name = 'observation-no-action'
export const inject = ['tools']

const DESCRIPTION = [
  '环境观察回合不需要任何行动时调用：表示本次画面没有值得回应或处理的变化，并立即结束本轮。',
  '调用前不要输出任何 Assistant 文字；这个工具没有副作用，只用于结束观察回合。',
].join('')

export function apply(ctx) {
  ctx.tools.register({
    name: 'observation_no_action',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok'],
        properties: {
          ok: { type: 'boolean' },
        },
      },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    async execute(_args, exec) {
      exec.concludeTurn()
      return { ok: true }
    },
  })
}
