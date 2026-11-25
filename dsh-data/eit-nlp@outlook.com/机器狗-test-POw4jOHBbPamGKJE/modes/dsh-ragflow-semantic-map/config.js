export function normalizeConfig(input) {
  const fail = () => { throw new Error('CONFIG_INVALID: 请检查RAGFlow地址、Dataset及参数；配置值不会回显。') }
  if (!input || typeof input !== 'object') fail()
  if (Object.hasOwn(input, 'apiKey') && (typeof input.apiKey !== 'string'
    || !input.apiKey.trim() || input.apiKey.length > 8192 || /[\r\n]/.test(input.apiKey))) fail()
  let url
  try { url = new URL(input.baseUrl) } catch { fail() }
  if (!['https:', ...(input.allowHttp === true ? ['http:'] : [])].includes(url.protocol)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') fail()
  const config = {
    ...input, baseUrl: url.origin, apiKeyEnv: input.apiKeyEnv ?? 'RAGFLOW_API_KEY',
    topK: input.topK ?? 5, candidateLimit: input.candidateLimit ?? 5,
    minScore: input.minScore ?? 0.1, vectorWeight: input.vectorWeight ?? 1,
    timeoutMs: input.timeoutMs ?? 10000, maxResponseBytes: input.maxResponseBytes ?? 1048576,
    allTimeoutMs: input.allTimeoutMs ?? 60000,
  }
  for (const [key, min, max] of [['topK', 1, 20], ['candidateLimit', 1, 100],
    ['timeoutMs', 1, 60000], ['allTimeoutMs', 1, 300000], ['maxResponseBytes', 1024, 4194304]]) {
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) fail()
  }
  if (config.candidateLimit < config.topK || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.apiKeyEnv)
    || !/^[0-9a-f]{32}$/.test(config.datasetId)) fail()
  for (const key of ['minScore', 'vectorWeight']) {
    if (!Number.isFinite(config[key]) || config[key] < 0 || config[key] > 1) fail()
  }
  return Object.freeze(config)
}
