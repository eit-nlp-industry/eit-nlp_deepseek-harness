class SearchError extends Error {
  constructor(code) {
    super(`${code}: 工具检索未完成，请检查配置或稍后重试。`)
    this.code = code
  }
}

const failure = code => new SearchError(code)

async function readText(response, maxBytes) {
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
  return Buffer.concat(parts).toString('utf8')
}

function parseJson(value) {
  try { return JSON.parse(value) }
  catch { throw failure('SEARCH_RESPONSE_INVALID') }
}

function parseEnvelope(text, expectedId) {
  let envelope
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    envelope = parseJson(trimmed)
  } else {
    const events = text.replaceAll('\r\n', '\n').split(/\n\n+/)
    for (const event of events) {
      const data = event.split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).replace(/^ /, ''))
        .join('\n')
      if (!data) continue
      const candidate = parseJson(data)
      if (candidate && typeof candidate === 'object' && candidate.id === expectedId) {
        envelope = candidate
        break
      }
    }
  }

  if (!envelope || typeof envelope !== 'object'
    || envelope.jsonrpc !== '2.0' || envelope.id !== expectedId) {
    throw failure('SEARCH_RESPONSE_INVALID')
  }
  if (envelope.error && typeof envelope.error === 'object') throw failure('SEARCH_REMOTE_ERROR')

  const result = envelope.result
  if (!result || typeof result !== 'object') throw failure('SEARCH_RESPONSE_INVALID')
  if (result.isError === true) throw failure('SEARCH_REMOTE_ERROR')
  if (!Array.isArray(result.content)) throw failure('SEARCH_RESPONSE_INVALID')
  const content = result.content.find(item => item?.type === 'text' && typeof item.text === 'string')
  if (!content) throw failure('SEARCH_RESPONSE_INVALID')

  const payload = parseJson(content.text)
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.chunks)) {
    throw failure('SEARCH_RESPONSE_INVALID')
  }
  return payload.chunks
}

export function createSearchClient(config, { fetch = globalThis.fetch, env = process.env } = {}) {
  let requestId = 0
  return {
    async retrieve(query, allowedEntries, signal) {
      if (typeof query !== 'string' || !query.trim() || query.length > 500) {
        throw failure('SEARCH_QUERY_INVALID')
      }
      if (signal?.aborted) throw failure('SEARCH_CANCELLED')
      if (!allowedEntries.length) return []

      const token = config.mcpToken ?? env[config.mcpTokenEnv]
      if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) {
        throw failure('SEARCH_TOKEN_MISSING')
      }

      const id = ++requestId
      const controller = new AbortController()
      const cancel = () => controller.abort()
      signal?.addEventListener('abort', cancel, { once: true })
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, config.timeoutMs)

      try {
        const response = await fetch(config.mcpUrl, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${token.trim()}`,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'MCP-Protocol-Version': '2025-03-26',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id,
            method: 'tools/call',
            params: {
              name: 'search',
              arguments: {
                query: query.trim(),
                top_k: config.candidateLimit,
                exclude_ids: [],
                dataset_selection_mode: 'all',
                dataset_names: config.datasetId,
              },
            },
          }),
        })
        if (!response.ok) {
          await response.body?.cancel()
          throw failure('SEARCH_HTTP_ERROR')
        }

        const chunks = parseEnvelope(await readText(response, config.maxResponseBytes), id)
        const bySourceName = new Map(allowedEntries.map(entry => [
          `${entry.name.split('__').at(-1)}.txt`, entry,
        ]))
        const matches = new Map()
        for (const chunk of chunks) {
          if (!chunk || typeof chunk !== 'object') continue
          const entry = bySourceName.get(chunk.source_name)
          if (!entry || !Number.isFinite(chunk.score) || chunk.score < config.minScore) continue
          matches.set(entry.name, Math.max(matches.get(entry.name) ?? -Infinity, chunk.score))
        }
        if (controller.signal.aborted) throw failure('SEARCH_CANCELLED')
        return [...matches]
          .map(([name, score]) => ({ name, score }))
          .sort((a, b) => b.score - a.score)
      } catch (error) {
        if (signal?.aborted) throw failure('SEARCH_CANCELLED')
        if (timedOut) throw failure('SEARCH_TIMEOUT')
        if (error instanceof SearchError) throw error
        throw failure('SEARCH_UNAVAILABLE')
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
      }
    },
  }
}
