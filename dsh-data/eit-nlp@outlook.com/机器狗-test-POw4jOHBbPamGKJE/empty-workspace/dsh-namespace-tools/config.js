const fail = () => { throw new Error('CONFIG_INVALID: 请检查 namespace、工具成员及可见性配置。') }
const validText = (value, max = 512) => typeof value === 'string' && value.trim() === value
  && value.length > 0 && value.length <= max
const validToolName = value => validText(value) && /^[A-Za-z0-9_.:-]+$/.test(value)

export function normalizeConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || (Object.hasOwn(input, 'enabled') && typeof input.enabled !== 'boolean')
    || !Array.isArray(input.namespaces) || input.namespaces.length === 0) fail()

  const namespaceIds = new Set(), toolNames = new Set()
  const namespaces = input.namespaces.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || !validText(entry.id, 64) || !/^[a-z][a-z0-9_]*$/.test(entry.id)
      || !validText(entry.name, 128) || !validText(entry.description, 1024)
      || !Array.isArray(entry.tools) || entry.tools.length === 0
      || namespaceIds.has(entry.id)) fail()
    namespaceIds.add(entry.id)
    const tools = entry.tools.map(name => {
      if (!validToolName(name) || ['load_namespace', 'run_code'].includes(name) || toolNames.has(name)) fail()
      toolNames.add(name)
      return name
    })
    return Object.freeze({ id: entry.id, name: entry.name, description: entry.description,
      tools: Object.freeze(tools) })
  })

  const eagerTools = input.eagerTools ?? []
  const hiddenTools = input.hiddenTools ?? []
  if (!Array.isArray(eagerTools) || new Set(eagerTools).size !== eagerTools.length
    || eagerTools.some(name => !validToolName(name) || !toolNames.has(name))) fail()
  if (!Array.isArray(hiddenTools) || new Set(hiddenTools).size !== hiddenTools.length
    || hiddenTools.some(name => !validToolName(name) || name === 'load_namespace'
      || toolNames.has(name) || eagerTools.includes(name))) fail()

  const namespaceById = Object.freeze(Object.fromEntries(namespaces.map(entry => [entry.id, entry])))
  return Object.freeze({
    enabled: input.enabled === true,
    namespaces: Object.freeze(namespaces),
    namespaceById,
    eagerTools: Object.freeze([...eagerTools]),
    hiddenTools: Object.freeze([...hiddenTools]),
  })
}
