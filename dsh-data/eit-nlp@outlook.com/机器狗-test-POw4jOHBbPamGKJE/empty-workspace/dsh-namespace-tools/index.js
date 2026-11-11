import { normalizeConfig } from './config.js'
import { createDisclosure } from './disclosure.js'

export const name = 'namespace-tools'
export const inject = ['tools', 'systemPrompt', 'agents']

export function apply(ctx, config) {
  return install(ctx, config)
}

export function install(ctx, input) {
  if (input && typeof input === 'object' && !Array.isArray(input)
    && Object.hasOwn(input, 'enabled') && typeof input.enabled !== 'boolean') normalizeConfig(input)
  if (input?.enabled !== true) return
  const config = normalizeConfig(input)
  const pending = new WeakMap()
  const isAgent = agent => agent !== null && typeof agent === 'object' && typeof agent.id === 'string'
  const ownsScope = agent => isAgent(agent) && ctx.tools.get('load_namespace', agent) === definition
  const disclosure = createDisclosure(ctx, config, ownsScope)
  const description = ['按任务需要加载一个工具 namespace。成功后，该 namespace 中当前可用的原工具将在下一轮完整披露；本工具不执行机器人动作。',
    ...config.namespaces.map(namespace => `${namespace.id}（${namespace.name}）：${namespace.description}`)].join('\n')

  const definition = {
    name: 'load_namespace',
    description,
    parameters: {
      type: 'object', additionalProperties: false, required: ['namespace'],
      properties: { namespace: { type: 'string', enum: config.namespaces.map(entry => entry.id),
        description: '需要加载的工具 namespace。' } },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, required: ['namespace', 'tools'],
        properties: {
          namespace: { type: 'string' },
          tools: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (!ownsScope(exec.agent)) throw new Error('NAMESPACE_SCOPE_INVALID: 需要所属 Agent 的执行上下文。')
      if (ctx.tools.get('run_code', exec.agent)) throw new Error('NATIVE_ONLY: namespace 工具披露插件只支持 Native。')
      if (!args || typeof args !== 'object' || Array.isArray(args)
        || Object.keys(args).length !== 1 || !Object.hasOwn(args, 'namespace')
        || typeof args.namespace !== 'string') {
        throw new Error('NAMESPACE_ARGUMENT_INVALID: 只接受 namespace 字段。')
      }
      const namespace = Object.hasOwn(config.namespaceById, args.namespace) ? config.namespaceById[args.namespace] : undefined
      if (!namespace) throw new Error('NAMESPACE_NOT_FOUND: 未配置该 namespace。')
      const tools = disclosure.candidates(exec.agent, namespace.tools)
      pending.set(exec, { agent: exec.agent, namespace: namespace.id, names: new Set(tools) })
      return { namespace: namespace.id, tools }
    },
  }

  ctx.tools.register(definition)
  ctx.systemPrompt.section({
    name: 'namespace-tools:discovery', order: 450, interpolate: false,
    text: '若任务需要的原工具尚未出现在当前工具列表，调用 load_namespace 选择最匹配的 namespace。加载只披露工具，不执行任务；随后直接调用披露后的原工具。',
  })
  ctx.on('tools/result', (exec, result) => {
    const accepted = pending.get(exec)
    pending.delete(exec)
    if (!accepted || exec.name !== 'load_namespace' || accepted.agent !== exec.agent
      || !ownsScope(exec.agent) || result.isError || exec.signal?.aborted
      || result.value?.namespace !== accepted.namespace || !Array.isArray(result.value?.tools)) return
    if (result.value.tools.some(name => typeof name !== 'string')
      || result.value.tools.length !== accepted.names.size) return
    const returned = new Set(result.value.tools)
    if (returned.size !== accepted.names.size
      || [...accepted.names].some(name => !returned.has(name))) return
    disclosure.reveal(exec.agent, [...accepted.names])
  })
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    if (!ownsScope(context.scope)) return assembly
    if (ctx.tools.get('run_code', context.scope)
      || assembly.sections?.some(section => section.name === 'tools:sdk' && section.text)) {
      throw new Error('NATIVE_ONLY: namespace 工具披露插件只支持 Native。')
    }
    disclosure.assertReady(context.scope)
    return assembly
  }, { prepend: true })
  ctx.on('agent/created', ({ agent }) => disclosure.sync(agent))
  ctx.on('agent/disposed', ({ agent }) => disclosure.dispose(agent))
  ctx.on('tools/change', () => disclosure.syncAll())
  ctx.effect(() => () => disclosure.disposeAll())
  disclosure.syncAll()
}
