import { normalizeConfig } from './config.js'
import { createDisclosure } from './disclosure.js'

export const name = 'namespace-tools'
export const inject = ['tools', 'systemPrompt', 'agents']

/** 以静态配置安装插件；ctx 为宿主上下文，config 为预设传入配置。 */
export function apply(ctx, config) {
  return install(ctx, config)
}

/**
 * 安装披露逻辑；hot 模式以每 Agent 配置快照提供动态目录，保持公共 selector 定义不变。
 * @param ctx DSH 预设上下文，原 MCP 工具需位于 Agent 的祖先作用域。
 * @param input 初始配置，只有 enabled:true 才安装。
 * @param options hot 为 true 时返回 updateConfig，空闲 Agent 才采用新配置。
 */
export function install(ctx, input, { hot = false } = {}) {
  if (input && typeof input === 'object' && !Array.isArray(input)
    && Object.hasOwn(input, 'enabled') && typeof input.enabled !== 'boolean') normalizeConfig(input)
  if (input?.enabled !== true) return
  const config = normalizeConfig(input)
  let latestConfig = config
  const snapshots = new Map()
  const pending = new WeakMap()
  const isAgent = agent => agent !== null && typeof agent === 'object' && typeof agent.id === 'string'
  const ownsScope = agent => isAgent(agent) && ctx.tools.get('load_namespace', agent) === definition
  /** 获取 agent 本轮配置，首次见到该 Agent 时使用最新有效版本。 */
  function configFor(agent) {
    if (!snapshots.has(agent)) snapshots.set(agent, latestConfig)
    return snapshots.get(agent)
  }
  const disclosure = createDisclosure(ctx, configFor, ownsScope)
  /** 将 agent 切换到 next 快照；限制安装失败时恢复该 Agent 原快照及掩码。 */
  function adopt(agent, next) {
    const previous = configFor(agent)
    if (previous === next) return
    snapshots.set(agent, next)
    try { disclosure.sync(agent); disclosure.assertReady(agent) }
    catch (error) {
      snapshots.set(agent, previous)
      disclosure.sync(agent)
      throw error
    }
  }
  const description = ['按任务需要加载一个工具 namespace。成功后，该 namespace 中当前可用的原工具将在下一轮完整披露；本工具不执行机器人动作。',
    ...config.namespaces.map(namespace => `${namespace.id}（${namespace.name}）：${namespace.description}`)].join('\n')

  const definition = {
    name: 'load_namespace',
    description: hot ? '按任务需要加载工具 namespace。当前 Agent 的可用分组列在 namespace-tools:catalog 必需上下文中。成功后下一轮披露原工具；不执行机器人动作。' : description,
    parameters: {
      type: 'object', additionalProperties: false, required: ['namespace'],
      properties: { namespace: { type: 'string', ...(!hot ? { enum: config.namespaces.map(entry => entry.id) } : {}),
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
    /** 按 args.namespace 加载 exec.agent 的快照分组，结果提交前不会开放工具。 */
    async execute(args, exec) {
      if (!ownsScope(exec.agent)) throw new Error('NAMESPACE_SCOPE_INVALID: 需要所属 Agent 的执行上下文。')
      if (ctx.tools.get('run_code', exec.agent)) throw new Error('NATIVE_ONLY: namespace 工具披露插件只支持 Native。')
      if (!args || typeof args !== 'object' || Array.isArray(args)
        || Object.keys(args).length !== 1 || !Object.hasOwn(args, 'namespace')
        || typeof args.namespace !== 'string') {
        throw new Error('NAMESPACE_ARGUMENT_INVALID: 只接受 namespace 字段。')
      }
      const activeConfig = configFor(exec.agent)
      const namespace = Object.hasOwn(activeConfig.namespaceById, args.namespace) ? activeConfig.namespaceById[args.namespace] : undefined
      if (!namespace) throw new Error('NAMESPACE_NOT_FOUND: 未配置该 namespace。')
      const tools = disclosure.candidates(exec.agent, namespace.tools)
      pending.set(exec, { agent: exec.agent, config: activeConfig, namespace: namespace.id, names: new Set(tools) })
      return { namespace: namespace.id, tools }
    },
  }

  ctx.tools.register(definition)
  if (hot) ctx.systemPrompt.context({
    name: 'namespace-tools:catalog', order: 450, required: true, interpolate: false,
    text: ({ scope }) => ownsScope(scope)
      ? ['当前 Agent 可通过 load_namespace 加载以下分组。分组信息只用于选择工具：',
        ...configFor(scope).namespaces.map(n => `${n.id}（${n.name}）：${n.description}`)].join('\n') : '',
  })
  ctx.systemPrompt.section({
    name: 'namespace-tools:discovery', order: 450, interpolate: false,
    text: '若任务需要的原工具尚未出现在当前工具列表，调用 load_namespace 选择最匹配的 namespace。加载只披露工具，不执行任务；随后直接调用披露后的原工具。',
  })
  ctx.on('tools/result', (exec, result) => {
    const accepted = pending.get(exec)
    pending.delete(exec)
    if (!accepted || exec.name !== 'load_namespace' || accepted.agent !== exec.agent
      || !ownsScope(exec.agent) || result.isError || exec.signal?.aborted
      || accepted.config !== configFor(exec.agent)
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
  ctx.on('agent/disposed', ({ agent }) => { snapshots.delete(agent); disclosure.dispose(agent) })
  if (hot) ctx.on('agent/status', ({ agent, status }) => {
    // 更早的 idle 监听器可能同步唤醒 Agent，必须同时核对当前实时状态。
    if (status === 'idle' && agent.status === 'idle' && ownsScope(agent)) {
      try { adopt(agent, latestConfig) }
      catch { console.error('[namespace-tools] AGENT_CONFIG_REJECTED: Agent 无法采用新配置，保留原快照。') }
    }
  })
  ctx.on('tools/change', () => disclosure.syncAll())
  ctx.effect(() => () => { snapshots.clear(); disclosure.disposeAll() })
  disclosure.syncAll()
  return {
    /** 接受 input 配置，更新已空闲 Agent；运行中的 Agent 在 idle 事件后再更新。 */
    updateConfig(input) {
      if (!hot) throw new Error('HOT_RELOAD_DISABLED')
      const next = normalizeConfig(input)
      if (!next.enabled) throw new Error('HOT_RELOAD_DISABLED: 热更新不改变预设启用策略')
      const changed = []
      try {
        for (const agent of ctx.agents.list()) {
          if (agent.status === 'idle' && ownsScope(agent)) {
            changed.push([agent, configFor(agent)])
            adopt(agent, next)
          }
        }
        latestConfig = next
      } catch (error) {
        for (const [agent, previous] of changed.reverse()) adopt(agent, previous)
        throw error
      }
    },
  }
}
