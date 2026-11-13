#!/usr/bin/env node
/**
 * WeKnora 原始片段 MCP 桥。
 *
 * 上游：WeKnora 内置 MCP Server 端点（Streamable HTTP，Bearer 端点令牌）。
 * 对外：stdio MCP Server，只暴露「原始 chunk」工具。
 *
 * 与直连 WeKnora 的差别：
 *   - 丢弃 chunk_type = summary / image_caption / image_vector（模型生成的内容），
 *     只保留 text / image_ocr，可用 WEKNORA_KEEP_CHUNK_TYPES 覆盖；
 *   - 去掉 match_snippet 等与正文重复的字段，正文只出现一次；
 *   - 不暴露 ask（模型成稿）和 wiki_*（模型生成页面）；
 *   - list_documents 默认不返回 LLM 写的 description；
 *   - 工具名带领域前缀、描述写明「什么时候该用」，让 agent 能自行判断是否检索。
 *
 * 环境变量：
 *   WEKNORA_MCP_URL          端点地址，默认见 DEFAULTS
 *   WEKNORA_MCP_TOKEN        端点令牌（Bearer）
 *   WEKNORA_KEEP_CHUNK_TYPES 逗号分隔，默认 "text,image_ocr"
 *   WEKNORA_TOOL_PREFIX      工具名前缀，默认 "eit_kb"
 *   WEKNORA_SCOPE            工具描述与指令里用的知识库范围说法
 */

const DEFAULTS = {
  url: 'http://10.37.0.21:18081/mcp/0012f748-d647-441a-9c38-d2c6b23bb35d',
  token: 'mcp_QQUNenvg4F2nvqYbnq7UUXup7sdei0bsGj7rksOfajk',
  keep: ['text', 'image_ocr'],
  prefix: 'eit_kb',
  scope:
    '宁波东方理工大学（EIT）的校内资料：招生简章与招生工作手册、本科专业介绍、培养模式、学费与奖助、四明书院、校园场馆与访问预约',
}

const URL_ = process.env.WEKNORA_MCP_URL || DEFAULTS.url
const TOKEN = process.env.WEKNORA_MCP_TOKEN || DEFAULTS.token
const PREFIX = process.env.WEKNORA_TOOL_PREFIX || DEFAULTS.prefix
const SCOPE = process.env.WEKNORA_SCOPE || DEFAULTS.scope
const KEEP = new Set(
  (process.env.WEKNORA_KEEP_CHUNK_TYPES || DEFAULTS.keep.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)

let upstreamReady = false

/** 调一次上游 MCP 端点，返回 structuredContent（或 text 解析结果）。 */
async function upstream(name, args) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${TOKEN}`,
  }
  const post = async (body) => {
    const res = await fetch(URL_, { method: 'POST', headers, body: JSON.stringify(body) })
    const text = await res.text()
    if (!res.ok) throw new Error(`upstream HTTP ${res.status}: ${text.slice(0, 300)}`)
    if (res.status === 202 || text.trim() === '') return null
    const payload = text.includes('data:') ? text.split('data:').pop().trim() : text
    return JSON.parse(payload)
  }

  if (!upstreamReady) {
    await post({
      jsonrpc: '2.0',
      id: 'init',
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'weknora-raw-bridge', version: '1.1.0' } },
    })
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    upstreamReady = true
  }

  const reply = await post({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } })
  if (!reply) throw new Error('upstream returned no body')
  if (reply.error) throw new Error(reply.error.message || JSON.stringify(reply.error))
  const result = reply.result ?? {}
  if (result.isError) {
    const detail = result.content?.find((c) => c.type === 'text')?.text ?? 'upstream tool error'
    throw new Error(detail.slice(0, 500))
  }
  if (result.structuredContent) return result.structuredContent
  const text = result.content?.find((c) => c.type === 'text')?.text
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { _text: text }
  }
}

/** 只留原始片段，去掉模型生成的内容和重复字段。 */
function cleanSearchHit(hit) {
  return {
    chunk_id: hit.chunk_id,
    chunk_index: hit.chunk_index,
    chunk_type: hit.chunk_type ?? '',
    score: hit.score,
    document_id: hit.knowledge_id,
    document_title: hit.knowledge_title,
    knowledge_base_id: hit.knowledge_base_id,
    content: hit.content,
  }
}

function filterHits(hits = []) {
  const kept = []
  let dropped = 0
  for (const hit of hits) {
    if (KEEP.has(hit.chunk_type ?? '')) kept.push(cleanSearchHit(hit))
    else dropped += 1
  }
  return { kept, dropped }
}

function cleanReadChunk(chunk) {
  return {
    chunk_id: chunk.chunk_id,
    chunk_index: chunk.chunk_index,
    chunk_type: chunk.chunk_type ?? '',
    seq: chunk.seq,
    content: chunk.content,
  }
}

const TOOLS = [
  {
    name: `${PREFIX}_search`,
    description:
      `在 ${SCOPE} 中做语义/关键词检索，只返回原文片段（模型摘要已剔除）。` +
      'document_title 是要写进回答的材料名；chunk_index、score、chunk_id 只用于定位，不要出现在回答里。' +
      '当用户问题涉及该校的招生政策、报名与考试安排、学费奖助、专业与课程、培养模式、书院、校园或场馆、访问预约，' +
      '或用户提到「知识库/资料/手册/简章里怎么写」时先调用它；' +
      '与该校无关的通用问题、代码问题、本地文件问题不要调用。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '问题、主题或原词。中文短语比长句更容易命中条款。' },
        mode: { type: 'string', enum: ['hybrid', 'semantic', 'keyword'], description: 'hybrid（默认）混合；keyword 适合编号、条款、专有名词。' },
        limit: { type: 'number', description: '过滤后返回的片段数，默认 8，上限 30。' },
        knowledge_base_ids: { type: 'array', items: { type: 'string' }, description: '限定知识库（id 或名称）。只有一个库时可省略。' },
        knowledge_ids: { type: 'array', items: { type: 'string' }, description: '限定到具体文档 id。' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: `${PREFIX}_grep`,
    description:
      `在 ${SCOPE} 的片段文本上做不区分大小写的正则匹配，只返回命中原文。` +
      '适合找编号、条款号、精确数字、错误码等关键词检索不稳定的目标。' +
      `候选在上游被截断（最多 30 条），结果不保证穷尽；要穷尽单篇请用 ${PREFIX}_read_document。`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'POSIX 正则；非法正则按字面匹配。' },
        limit: { type: 'number', description: '返回片段数，默认 8，上限 30。' },
        knowledge_base_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: `${PREFIX}_read_document`,
    description:
      '按阅读顺序读取单篇文档的原文片段（摘要已剔除），可翻页。' +
      '检索命中但需要完整上下文、精确条款或长段落引用时使用；也可以用它按关键词顺序扫完整篇文档。',
    inputSchema: {
      type: 'object',
      properties: {
        knowledge_id: { type: 'string', description: '文档 id，来自搜索结果或 list_documents。' },
        offset: { type: 'number', description: '阅读顺序中的 0 基位置，默认 0；上次返回的 next_offset 可直接复用。' },
        limit: { type: 'number', description: '每次片段数，默认 20，上限 100。' },
        query: { type: 'string', description: '可选关键词，按空白分词，同一片段必须包含全部词。' },
      },
      required: ['knowledge_id'],
      additionalProperties: false,
    },
  },
  {
    name: `${PREFIX}_list_documents`,
    description: '列出知识库里的文档（只有元数据，不含模型写的摘要）。用于确认「库里到底有哪些材料」，一般不需要在每次检索前调用。',
    inputSchema: {
      type: 'object',
      properties: {
        knowledge_base_id: { type: 'string', description: '知识库 id 或名称。' },
        keyword: { type: 'string', description: '可选，按标题子串过滤。' },
        page: { type: 'number', description: '页码，默认 1。' },
        page_size: { type: 'number', description: '每页条数，默认 20，上限 100。' },
        include_description: { type: 'boolean', description: '是否附带 LLM 生成的文档描述，默认 false。' },
      },
      required: ['knowledge_base_id'],
      additionalProperties: false,
    },
  },
  {
    name: `${PREFIX}_list_knowledge_bases`,
    description: '列出这个端点能访问的知识库及其检索能力。只在不确定有哪些库时调用；已知只有一个库时跳过它，直接检索。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

const CALLABLE = new Set(TOOLS.map((t) => t.name))

async function callTool(name, args = {}) {
  if (!CALLABLE.has(name)) throw new Error(`unknown tool: ${name}`)

  if (name === `${PREFIX}_list_knowledge_bases`) {
    const data = await upstream('list_knowledge_bases', {})
    return { knowledge_bases: data.knowledge_bases ?? [], total: data.total }
  }

  if (name === `${PREFIX}_search` || name === `${PREFIX}_grep`) {
    const want = Math.min(30, Math.max(1, args.limit ?? 8))
    const upstreamArgs = {
      query: args.query,
      limit: Math.min(30, want * 3),
      ...(args.knowledge_base_ids ? { knowledge_base_ids: args.knowledge_base_ids } : {}),
    }
    if (name === `${PREFIX}_search`) {
      if (args.mode) upstreamArgs.mode = args.mode
      if (args.knowledge_ids) upstreamArgs.knowledge_ids = args.knowledge_ids
    }
    const data = await upstream(name === `${PREFIX}_search` ? 'search_knowledge' : 'grep_chunks', upstreamArgs)
    const { kept, dropped } = filterHits(data.results)
    return {
      query: args.query,
      mode: data.mode ?? args.mode ?? 'hybrid',
      returned: Math.min(want, kept.length),
      filtered_out: dropped,
      chunks: kept.slice(0, want),
    }
  }

  if (name === `${PREFIX}_read_document`) {
    const limit = Math.min(100, Math.max(1, args.limit ?? 20))
    const data = await upstream('read_document', {
      knowledge_id: args.knowledge_id,
      offset: args.offset ?? 0,
      ...(args.query ? { query: args.query } : { limit }),
    })
    const raw = data.chunks ?? []
    const kept = raw.filter((c) => KEEP.has(c.chunk_type ?? '')).map(cleanReadChunk)
    const fetched = data.fetched_chunks ?? raw.length
    return {
      document: {
        id: data.document?.id,
        title: data.document?.title,
        file_name: data.document?.file_name,
        file_type: data.document?.file_type,
        parse_status: data.document?.parse_status,
      },
      offset: data.offset ?? 0,
      total_chunks: data.total_chunks,
      fetched_chunks: fetched,
      returned: kept.length,
      filtered_out: raw.length - kept.length,
      next_offset: (data.offset ?? 0) + fetched,
      done: fetched < limit,
      chunks: kept,
    }
  }

  if (name === `${PREFIX}_list_documents`) {
    const data = await upstream('list_documents', {
      knowledge_base_id: args.knowledge_base_id,
      ...(args.keyword ? { keyword: args.keyword } : {}),
      page: args.page ?? 1,
      page_size: Math.min(100, Math.max(1, args.page_size ?? 20)),
    })
    const documents = (data.documents ?? []).map((d) => ({
      id: d.id,
      title: d.title,
      file_name: d.file_name,
      file_type: d.file_type,
      parse_status: d.parse_status,
      ...(args.include_description ? { description: d.description } : {}),
    }))
    return { knowledge_base_id: data.knowledge_base_id, total: data.total, page: data.page, page_size: data.page_size, documents }
  }

  throw new Error(`unknown tool: ${name}`)
}

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function replyError(id, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } })}\n`)
}

async function handle(message) {
  const { id, method } = message
  if (method === 'initialize') {
    reply(id, {
      protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'weknora-raw', version: '1.1.0' },
      instructions:
        `这是一个只读知识库，收录 ${SCOPE}。工具返回的都是原文片段，模型生成的摘要已被剔除。\n` +
        '何时检索（自行判断，不需要用户点名）：\n' +
        '- 问题涉及该校的招生政策、报名/初审/测试时间、学费与奖助、专业设置与课程、培养模式、书院、校园场馆、访问预约；\n' +
        '- 用户说「知识库里」「资料里」「手册/简章里怎么写」；\n' +
        '- 需要给校方事实做引用，或你正要用「我记得/一般来说」来回答校内信息时，先检索再回答。\n' +
        '何时不要检索：通用知识、编程与调试、本地文件操作、与该校无关的闲聊；也不要为了「保险」对每个问题都检索。\n' +
        `怎么用：先用 ${PREFIX}_search（编号/条款用 keyword 模式或 ${PREFIX}_grep），命中不足或需要完整上下文时用 ${PREFIX}_read_document 补读原文。\n` +
        '引用规则：不要写「知识库中」「根据知识库」「第N段」「片段」这类内部口径，也不要报 chunk_id / chunk_index / score；'
        + '直接给材料与章节，例如「依据《2026年浙江省“三位一体”综合评价招生简章》的“五、时间安排”」。'
        + '文件名是 .docx / .pdf 时去掉扩展名，能说出材料全称或章节标题就写全称；没有明确出处时正常回答，不要强行标注。'
        + '不要用记忆补充校方事实，也不要把摘要当原文。',
    })
    return
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return
  if (method === 'ping') return reply(id, {})
  if (method === 'tools/list') return reply(id, { tools: TOOLS })
  if (method === 'tools/call') {
    try {
      const result = await callTool(message.params?.name, message.params?.arguments ?? {})
      const text = JSON.stringify(result, null, 1)
      reply(id, { content: [{ type: 'text', text }], structuredContent: result })
    } catch (error) {
      reply(id, { content: [{ type: 'text', text: String(error?.message ?? error) }], isError: true })
    }
    return
  }
  if (id !== undefined) replyError(id, `unsupported method: ${method}`)
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      process.stderr.write(`bad json: ${line.slice(0, 120)}\n`)
      continue
    }
    handle(message).catch((error) => {
      if (message.id !== undefined) replyError(message.id, String(error?.message ?? error))
    })
  }
})
process.stdin.on('end', () => process.exit(0))
