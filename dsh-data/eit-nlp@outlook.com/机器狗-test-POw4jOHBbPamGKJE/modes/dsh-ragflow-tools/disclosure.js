import { isBlocked } from './config.js'

export function createDisclosure(config) {
  const managed = new Set(config.toolMap.map(entry => entry.name))
  const eager = new Set(config.eagerTools)
  const hidden = new Set(config.hiddenTools)
  const revealed = new WeakMap()
  return {
    reveal(agent, names) {
      const current = revealed.get(agent) ?? new Set()
      for (const name of names) if (managed.has(name) && !isBlocked(name)) current.add(name)
      revealed.set(agent, current)
    },
    filter(assembly, agent) {
      if (!agent) return assembly
      if (assembly.tools.some(tool => tool.name === 'run_code')
        || assembly.sections?.some(section => section.name === 'tools:sdk' && section.text)) {
        throw new Error('NATIVE_ONLY: 此插件首版不支持 PTC，请在 Native profile 使用。')
      }
      return {
        ...assembly,
        tools: assembly.tools.filter(tool => !isBlocked(tool.name) && !hidden.has(tool.name)
          && (!managed.has(tool.name) || eager.has(tool.name) || revealed.get(agent)?.has(tool.name))),
      }
    },
  }
}
