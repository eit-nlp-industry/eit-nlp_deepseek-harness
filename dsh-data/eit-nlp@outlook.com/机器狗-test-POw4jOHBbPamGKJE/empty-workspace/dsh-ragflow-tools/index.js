import { normalizeConfig } from './config.js'
import { createDisclosure } from './disclosure.js'
import { createSearchClient } from './search.js'

export const name = 'ragflow-tools'
export const inject = ['tools', 'systemPrompt']

export function apply(ctx, config) {
  return install(ctx, config)
}

// Dependencies are injectable only for local tests, not model arguments/config.
export function install(ctx, input, dependencies) {
  if (input?.enabled === false) return
  const config = normalizeConfig(input)
  const client = createSearchClient(config, dependencies)
  const disclosure = createDisclosure(config)
  const pending = new WeakMap()
  const isAgent = agent => agent !== null && typeof agent === 'object' && typeof agent.id === 'string'
  const ownsScope = agent => isAgent(agent) && ctx.tools.get('search_tools', agent) === definition
  const available = agent => config.toolMap.filter(entry => ctx.tools.get(entry.name, agent))

  const definition = {
    name: 'search_tools',
    description: '根据任务描述搜索可用工具。成功后匹配工具将在下一轮披露；请直接调用披露后的原工具完成任务。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['query'],
      properties: { query: { type: 'string', description: '要完成的任务、动作或目标。' } },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, required: ['matches'],
        properties: {
          matches: { type: 'array', items: {
            type: 'object', additionalProperties: false, required: ['name', 'description', 'score'],
            properties: { name: { type: 'string' }, description: { type: 'string' }, score: { type: 'number' } },
          } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (!ownsScope(exec.agent)) throw new Error('SEARCH_SCOPE_INVALID: 需要所属 Agent 的执行上下文。')
      if (ctx.tools.get('run_code', exec.agent)) throw new Error('NATIVE_ONLY: 此插件首版仅支持 Native。')
      if (!args || typeof args !== 'object' || Array.isArray(args)
        || Object.keys(args).length !== 1 || !Object.hasOwn(args, 'query')) {
        throw new Error('SEARCH_QUERY_INVALID: 只接受 query 字段。')
      }
      const found = await client.retrieve(args.query, available(exec.agent), exec.signal)
      if (!ownsScope(exec.agent)) throw new Error('SEARCH_SCOPE_INVALID: 工具作用域已改变。')
      const matches = found.filter(match => ctx.tools.get(match.name, exec.agent))
        .slice(0, config.topK).map(match => ({ ...match,
          description: String(ctx.tools.get(match.name, exec.agent).description ?? '').slice(0, 240),
        }))
      pending.set(exec, { agent: exec.agent, names: new Set(matches.map(match => match.name)) })
      return { matches }
    },
  }

  ctx.tools.register(definition)
  ctx.systemPrompt.section({
    name: 'ragflow-tools:discovery', order: 450, interpolate: false,
    text: '若任务需要的工具未出现在当前工具列表，先调用 search_tools。搜索只披露工具，不执行任务；随后直接调用原工具。搜索无匹配时不要猜测工具名。',
  })
  ctx.on('tools/result', (exec, result) => {
    const accepted = pending.get(exec)
    pending.delete(exec)
    if (!accepted || exec.name !== 'search_tools' || accepted.agent !== exec.agent
      || !ownsScope(exec.agent) || result.isError || exec.signal?.aborted
      || !Array.isArray(result.value?.matches)) return
    disclosure.reveal(exec.agent, result.value.matches
      .filter(match => match && accepted.names.has(match.name) && ctx.tools.get(match.name, exec.agent))
      .map(match => match.name))
  })
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    if (!ownsScope(context.scope)) return assembly
    if (ctx.tools.get('run_code', context.scope)) throw new Error('NATIVE_ONLY: 此插件首版仅支持 Native。')
    return disclosure.filter(assembly, context.scope)
  }, { prepend: true })
}
