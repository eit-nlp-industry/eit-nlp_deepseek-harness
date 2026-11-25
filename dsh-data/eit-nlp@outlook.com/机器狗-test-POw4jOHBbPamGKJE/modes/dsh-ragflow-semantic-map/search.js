import { prepareMap } from './map-render.js'

class SearchError extends Error {
  constructor(code) {
    super(code + ': 语义地图检索未完成，请检查配置或稍后重试。')
    this.code = code
  }
}
const failure = code => new SearchError(code)

async function readJson(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel()
    throw failure('SEARCH_RESPONSE_TOO_LARGE')
  }
  const reader = response.body?.getReader()
  if (!reader) throw failure('SEARCH_RESPONSE_INVALID')
  let size = 0
  const parts = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw failure('SEARCH_RESPONSE_TOO_LARGE')
      }
      parts.push(value)
    }
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')) }
  catch { throw failure('SEARCH_RESPONSE_INVALID') }
}

const arrayField = value => value ? value.split('；').map(item => item.trim()).filter(Boolean) : []
const coordinateNumber = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?'
const coordinatePattern = new RegExp(`^(?:([^，=]+)，)?x=(${coordinateNumber})，y=(${coordinateNumber})(?:，z=(${coordinateNumber}))?$`)
function parsePosition(value) {
  if (value === undefined) return null
  const match = coordinatePattern.exec(value)
  if (!match) throw failure('SEARCH_RESPONSE_INVALID')
  const [, frame, x, y, z] = match
  const position = { frame_id: frame?.trim() || null, x: Number(x), y: Number(y), z: z === undefined ? null : Number(z) }
  if (![position.x, position.y, ...(position.z === null ? [] : [position.z])].every(Number.isFinite)) {
    throw failure('SEARCH_RESPONSE_INVALID')
  }
  return position
}

function parseLocation(content, documentName) {
  if (typeof content !== 'string' || !content.trim() || content.length > 50000) throw failure('SEARCH_RESPONSE_INVALID')
  const fields = new Map()
  for (const row of content.split('\n')) {
    const index = row.indexOf('：')
    if (index < 1) continue
    const name = row.slice(0, index).trim(), value = row.slice(index + 1).trim()
    if ((name === '地图坐标' || name === '场景局部坐标') && !value) throw failure('SEARCH_RESPONSE_INVALID')
    if (value && fields.has(name)) throw failure('SEARCH_RESPONSE_INVALID')
    if (value) fields.set(name, value)
  }
  const prefix = 'semantic_anchor__', suffix = '.txt'
  if (typeof documentName !== 'string' || !documentName.startsWith(prefix) || !documentName.endsWith(suffix)) throw failure('SEARCH_RESPONSE_INVALID')
  let fileAnchor
  try { fileAnchor = decodeURIComponent(documentName.slice(prefix.length, -suffix.length)) }
  catch { throw failure('SEARCH_RESPONSE_INVALID') }
  const anchor_id = fields.get('地点ID'), canonical_name = fields.get('地点名称'), scene_id = fields.get('场景ID')
  const eligible = fields.get('destination_eligible')
  if (!anchor_id || anchor_id !== fileAnchor || !canonical_name || !scene_id || !['true', 'false'].includes(eligible)) throw failure('SEARCH_RESPONSE_INVALID')
  return {
    anchor_id, canonical_name, scene_id: scene_id === 'null' ? null : scene_id,
    spatial: {
      unit: 'm',
      position_local: parsePosition(fields.get('场景局部坐标')),
      position_atlas: parsePosition(fields.get('地图坐标')),
    },
    explicit_attributes: {
      functions: arrayField(fields.get('明确功能')), objects: arrayField(fields.get('明确设施')),
      people: arrayField(fields.get('明确人物')), notes: arrayField(fields.get('原始备注')),
      access_rules: arrayField(fields.get('访问限制')),
    },
    inferred_attributes: {
      likely_objects: arrayField(fields.get('推测可能存在的设施')),
      likely_tasks: arrayField(fields.get('推测可能支持的用途')),
      reason: fields.get('推测原因') ?? '',
    },
  }
}

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const isMapDocument = name => typeof name === 'string' && name.startsWith('semantic_anchor__') && name.endsWith('.txt')

async function listPages(request, path, key, limit, onItem, validatePage = () => {}) {
  const seen = new Set()
  let total
  for (let page = 1; ; page++) {
    const data = await request(path + (path.includes('?') ? '&' : '?') + 'page=' + page + '&page_size=100')
    if (!Number.isInteger(data.total) || data.total < 0 || !Array.isArray(data[key])) throw failure('SEARCH_RESPONSE_INVALID')
    if (data.total > limit) throw failure('SEARCH_ALL_LIMIT')
    if (total !== undefined && data.total !== total) throw failure('SEARCH_INCOMPLETE')
    total = data.total
    validatePage(data)
    if (!data[key].length && seen.size < total) throw failure('SEARCH_INCOMPLETE')
    for (const item of data[key]) {
      if (!item || !validId(item.id)) throw failure('SEARCH_RESPONSE_INVALID')
      if (seen.has(item.id) || seen.size >= total) throw failure('SEARCH_INCOMPLETE')
      seen.add(item.id)
      onItem(item)
    }
    if (seen.size === total) return total
  }
}

function assertResultSize(result, maxBytes) {
  // Count each render separately so repeated omission lists cannot create one huge JSON string.
  let bytes = Buffer.byteLength(JSON.stringify({ ...result, renders: [] }))
  if (bytes > maxBytes) throw failure('SEARCH_RESULT_TOO_LARGE')
  for (const [index, render] of result.renders.entries()) {
    bytes += Buffer.byteLength(JSON.stringify(render)) + (index ? 1 : 0)
    if (bytes > maxBytes) throw failure('SEARCH_RESULT_TOO_LARGE')
  }
}

export function createSearchClient(config, { fetch = globalThis.fetch, env = process.env } = {}) {
  async function run(timeoutMs, signal, action) {
    if (signal?.aborted) throw failure('SEARCH_CANCELLED')
    const key = config.apiKey ?? env[config.apiKeyEnv]
    if (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key)) throw failure('SEARCH_KEY_MISSING')
    const controller = new AbortController()
    const cancel = () => controller.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    try {
      const request = async (path, body) => {
        if (controller.signal.aborted) throw failure('SEARCH_CANCELLED')
        const response = await fetch(config.baseUrl + path, {
          method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: controller.signal,
          headers: { Authorization: 'Bearer ' + key.trim(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        if (!response.ok) {
          await response.body?.cancel()
          throw failure('SEARCH_HTTP_ERROR')
        }
        const envelope = await readJson(response, config.maxResponseBytes)
        if (!envelope || envelope.code !== 0 || !envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) {
          throw failure('SEARCH_REMOTE_ERROR')
        }
        return envelope.data
      }
      const result = await action(request)
      if (controller.signal.aborted) throw failure('SEARCH_CANCELLED')
      return result
    } catch (error) {
      if (signal?.aborted) throw failure('SEARCH_CANCELLED')
      if (timedOut) throw failure('SEARCH_TIMEOUT')
      if (error instanceof SearchError) throw error
      throw failure('SEARCH_UNAVAILABLE')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
    }
  }
  return {
    async retrieve(query, signal) {
      if (typeof query !== 'string' || !query.trim() || query.length > 500) throw failure('SEARCH_QUERY_INVALID')
      return run(config.timeoutMs, signal, async request => {
        const data = await request('/api/v1/retrieval', {
            question: query.trim(), dataset_ids: [config.datasetId], page: 1,
            page_size: config.candidateLimit, similarity_threshold: config.minScore,
            vector_similarity_weight: config.vectorWeight, highlight: false,
        })
        if (!Array.isArray(data.chunks)) throw failure('SEARCH_REMOTE_ERROR')
        const candidates = [], seen = new Set()
        for (const chunk of data.chunks) {
          if (!chunk || chunk.dataset_id !== config.datasetId || typeof chunk.id !== 'string'
            || typeof chunk.document_id !== 'string' || !Number.isFinite(chunk.similarity)) throw failure('SEARCH_RESPONSE_INVALID')
          if (chunk.similarity < config.minScore) continue
          const candidate = parseLocation(chunk.content, chunk.document_keyword)
          if (seen.has(candidate.anchor_id)) throw failure('SEARCH_RESPONSE_INVALID')
          seen.add(candidate.anchor_id)
          candidates.push({ ...candidate, similarity: chunk.similarity })
        }
        return candidates.sort((a, b) => b.similarity - a.similarity).slice(0, config.topK)
      })
    },
    async retrieveAll(signal) {
      return run(config.allTimeoutMs, signal, async request => {
        const documents = [], anchors = new Map(), chunkIds = new Set()
        let skipped_document_count = 0, chunkCount = 0, candidateBytes = 0
        const base = '/api/v1/datasets/' + encodeURIComponent(config.datasetId) + '/documents'
        await listPages(request, base + '?orderby=create_time&desc=false', 'docs', 5000, doc => {
          if (doc.dataset_id !== config.datasetId || typeof doc.name !== 'string' || !doc.name) throw failure('SEARCH_RESPONSE_INVALID')
          if (isMapDocument(doc.name)) documents.push(doc)
          else skipped_document_count++
        })
        for (const doc of documents) {
          const count = await listPages(request, base + '/' + encodeURIComponent(doc.id) + '/chunks', 'chunks', 10000 - chunkCount, chunk => {
            if (chunk.dataset_id !== config.datasetId || chunk.document_id !== doc.id || chunk.docnm_kwd !== doc.name) {
              throw failure('SEARCH_RESPONSE_INVALID')
            }
            if (chunkIds.has(chunk.id)) throw failure('SEARCH_INCOMPLETE')
            chunkIds.add(chunk.id)
            const candidate = { ...parseLocation(chunk.content, doc.name), similarity: null }
            const encoded = JSON.stringify(candidate), previous = anchors.get(candidate.anchor_id)
            if (previous) {
              if (JSON.stringify(previous) !== encoded) throw failure('SEARCH_RECORD_CONFLICT')
              return
            }
            candidateBytes += Buffer.byteLength(encoded)
            if (candidateBytes > config.maxResponseBytes) throw failure('SEARCH_RESULT_TOO_LARGE')
            anchors.set(candidate.anchor_id, candidate)
          }, data => {
            if (!data.doc || data.doc.id !== doc.id || data.doc.name !== doc.name || data.doc.dataset_id !== config.datasetId) {
              throw failure('SEARCH_RESPONSE_INVALID')
            }
          })
          if (!count) throw failure('SEARCH_INCOMPLETE')
          chunkCount += count
        }
        const candidates = [...anchors.values()]
        const result = { candidates, complete: true, skipped_document_count, ...prepareMap(candidates) }
        assertResultSize(result, config.maxResponseBytes)
        return result
      })
    },
  }
}
