export const isBlocked = name => typeof name === 'string' && /(?:^|__|\.)get_task_status$/.test(name)

export function normalizeConfig(input) {
  const fail = () => { throw new Error('CONFIG_INVALID: 请检查 MCP 地址、Token、工具映射及参数；配置值不会回显。') }
  if (!input || typeof input !== 'object') fail()
  if (Object.hasOwn(input, 'mcpToken') && (typeof input.mcpToken !== 'string'
    || !input.mcpToken.trim() || input.mcpToken.length > 8192 || /[\r\n]/.test(input.mcpToken))) fail()

  let url
  try { url = new URL(input.mcpUrl) } catch { fail() }
  if (!['https:', ...(input.allowHttp === true ? ['http:'] : [])].includes(url.protocol)
    || url.username || url.password || url.search || url.hash
    || !['/mcp', '/mcp/'].includes(url.pathname)) fail()

  const config = {
    ...input,
    mcpUrl: `${url.origin}/mcp/`,
    mcpTokenEnv: input.mcpTokenEnv ?? 'RAG_MCP_TOKEN',
    topK: input.topK ?? 3,
    candidateLimit: input.candidateLimit ?? 20,
    minScore: input.minScore ?? 0.3,
    timeoutMs: input.timeoutMs ?? 10000,
    maxResponseBytes: input.maxResponseBytes ?? 1048576,
    eagerTools: input.eagerTools ?? [],
    hiddenTools: input.hiddenTools ?? [],
  }

  for (const [key, min, max] of [
    ['topK', 1, 20],
    ['candidateLimit', 1, 20],
    ['timeoutMs', 1, 60000],
    ['maxResponseBytes', 1024, 4194304],
  ]) {
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) fail()
  }
  if (config.candidateLimit < config.topK
    || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.mcpTokenEnv)) fail()
  if (!Number.isFinite(config.minScore) || config.minScore < 0 || config.minScore > 1) fail()

  const validString = value => typeof value === 'string'
    && value.trim() === value && value.length > 0 && value.length <= 256
  if (!validString(config.datasetId) || !Array.isArray(config.toolMap) || !config.toolMap.length) fail()

  const names = new Set()
  const sourceNames = new Set()
  config.toolMap = config.toolMap.map(entry => {
    if (!entry || !validString(entry.name)
      || !/^[A-Za-z0-9_-]+$/.test(entry.name)
      || ['search_tools', 'run_code'].includes(entry.name)
      || isBlocked(entry.name) || names.has(entry.name)) fail()
    const sourceName = `${entry.name.split('__').at(-1)}.txt`
    if (sourceNames.has(sourceName)) fail()
    names.add(entry.name)
    sourceNames.add(sourceName)
    return Object.freeze({ name: entry.name })
  })

  if (!Array.isArray(config.eagerTools)
    || config.eagerTools.some(name => !validString(name) || isBlocked(name))) fail()
  if (!Array.isArray(config.hiddenTools) || new Set(config.hiddenTools).size !== config.hiddenTools.length
    || config.hiddenTools.some(name => !validString(name) || name === 'search_tools'
      || names.has(name) || config.eagerTools.includes(name))) fail()

  return Object.freeze({
    ...config,
    toolMap: Object.freeze(config.toolMap),
    eagerTools: Object.freeze([...config.eagerTools]),
    hiddenTools: Object.freeze([...config.hiddenTools]),
  })
}
