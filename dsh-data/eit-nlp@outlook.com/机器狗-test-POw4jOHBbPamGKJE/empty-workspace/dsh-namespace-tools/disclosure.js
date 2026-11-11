// Tool declarations belong to the provider, not PromptPresentation.
export function createDisclosure(ctx, config, ownsScope) {
  const managed = new Set(config.namespaces.flatMap(entry => entry.tools))
  const eager = new Set(config.eagerTools)
  const hidden = new Set(config.hiddenTools)
  const states = new Map()
  let updating = false
  let stopped = false
  function dispose(agent) {
    const state = states.get(agent)
    if (!state) return
    states.delete(agent)
    for (const remove of state.masks.values()) remove()
  }
  function sync(agent) {
    if (updating || stopped) return
    updating = true
    try {
      if (!ownsScope(agent)) { dispose(agent); return }
      let state = states.get(agent)
      if (!state) {
        state = { masks: new Map(), definitions: new Map(), revealed: new Set() }
        states.set(agent, state)
      }
      for (const definition of ctx.tools.definitions(agent)) {
        const name = definition.name
        if (managed.has(name)) state.definitions.set(name, definition)
        if (!hidden.has(name) && (!managed.has(name) || eager.has(name) || state.revealed.has(name))) continue
        if (!state.masks.has(name)) state.masks.set(name, agent.ctx.tools.restrict({ deny: [name] }))
      }
    } finally { updating = false }
  }
  return {
    sync,
    syncAll() {
      for (const agent of new Set([...states.keys(), ...ctx.agents.list()])) sync(agent)
    },
    candidates(agent, names) {
      sync(agent)
      const state = states.get(agent)
      return names.filter(name => state?.definitions.has(name))
    },
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
    assertReady(agent) {
      if (!states.has(agent)) throw new Error('NAMESPACE_NOT_READY: 请重载预设并新建会话。')
      for (const definition of ctx.tools.definitions(agent)) {
        const name = definition.name
        if (hidden.has(name) || (managed.has(name) && !eager.has(name) && !states.get(agent).revealed.has(name))) {
          throw new Error('NAMESPACE_SCOPE_UNSUPPORTED: 工具必须注册在 Agent 的祖先作用域。')
        }
      }
    },
    dispose,
    disposeAll() {
      stopped = true
      updating = true
      try { for (const agent of [...states.keys()]) dispose(agent) }
      finally { updating = false }
    },
  }
}
