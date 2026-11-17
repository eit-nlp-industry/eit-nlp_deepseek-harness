/**
 * 管理每个 Agent 的自有隐藏掩码，保留外部限制与已披露状态。
 * @param ctx 宿主上下文。
 * @param getConfig 根据 Agent 返回冻结的当前配置快照。
 * @param ownsScope 判断 Agent 当前是否使用本插件 selector。
 */
export function createDisclosure(ctx, getConfig, ownsScope) {
  const states = new Map()
  let updating = false
  let stopped = false
  /** 移除 agent 的本插件掩码，不触碰其他插件限制。 */
  function dispose(agent) {
    const state = states.get(agent)
    if (!state) return
    states.delete(agent)
    for (const remove of state.masks.values()) remove()
  }
  /** 根据 agent 的当前快照增量更新掩码；未被新配置管理的旧掩码会解除。 */
  function sync(agent) {
    if (updating || stopped) return
    updating = true
    try {
      if (!ownsScope(agent)) { dispose(agent); return }
      const config = getConfig(agent)
      const managed = new Set(config.namespaces.flatMap(entry => entry.tools))
      const eager = new Set(config.eagerTools), hidden = new Set(config.hiddenTools)
      let state = states.get(agent)
      if (!state) {
        state = { masks: new Map(), definitions: new Map(), revealed: new Set() }
        states.set(agent, state)
      }
      const shouldHide = name => hidden.has(name) || (managed.has(name) && !eager.has(name) && !state.revealed.has(name))
      for (const [name, remove] of state.masks) {
        if (shouldHide(name)) continue
        state.masks.delete(name)
        remove()
      }
      for (const definition of ctx.tools.definitions(agent)) {
        const name = definition.name
        if (managed.has(name)) state.definitions.set(name, definition)
        if (!shouldHide(name)) continue
        if (!state.masks.has(name)) state.masks.set(name, agent.ctx.tools.restrict({ deny: [name] }))
      }
    } finally { updating = false }
  }
  return {
    sync,
    /** 将所有已知 Agent 的工具注册变化同步到各自快照，不升级运行中配置。 */
    syncAll() {
      for (const agent of new Set([...states.keys(), ...ctx.agents.list()])) sync(agent)
    },
    /** 从 names 中选取 agent 曾观察到的原工具，供最终结果提交校验。 */
    candidates(agent, names) {
      sync(agent)
      const state = states.get(agent)
      return names.filter(name => state?.definitions.has(name))
    },
    /** 最终成功后解除 agent 对 names 的自有掩码；权限已撤销时不重新开放。 */
    reveal(agent, names) {
      const state = states.get(agent)
      if (!state) return
      updating = true
      try {
        for (const name of names) {
          const remove = state.masks.get(name)
          state.masks.delete(name)
          remove?.()
          const current = ctx.tools.get(name, agent)
          if (current) {
            state.definitions.set(name, current)
            state.revealed.add(name)
          } else if (remove) {
            try { state.masks.set(name, agent.ctx.tools.restrict({ deny: [name] })) }
            catch (error) {
              // A removed MCP registration cannot be restricted until it returns.
              if (!String(error.message).includes('names unknown global tool')) throw error
              state.definitions.delete(name)
            }
          }
        }
      } finally { updating = false }
    },
    /** 校验 agent 的原工具已按快照隐藏，防止 Agent 自身工具绕过祖先限制契约。 */
    assertReady(agent) {
      const config = getConfig(agent)
      const managed = new Set(config.namespaces.flatMap(entry => entry.tools))
      const eager = new Set(config.eagerTools), hidden = new Set(config.hiddenTools)
      if (!states.has(agent)) throw new Error('NAMESPACE_NOT_READY: 请重载预设并新建会话。')
      for (const definition of ctx.tools.definitions(agent)) {
        const name = definition.name
        if (hidden.has(name) || (managed.has(name) && !eager.has(name) && !states.get(agent).revealed.has(name))) {
          throw new Error('NAMESPACE_SCOPE_UNSUPPORTED: 工具必须注册在 Agent 的祖先作用域。')
        }
      }
    },
    dispose,
    /** 插件卸载时解除全部自有掩码。 */
    disposeAll() {
      stopped = true
      updating = true
      try { for (const agent of [...states.keys()]) dispose(agent) }
      finally { updating = false }
    },
  }
}
