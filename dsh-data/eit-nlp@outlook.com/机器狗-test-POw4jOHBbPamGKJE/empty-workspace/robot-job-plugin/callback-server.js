import { timingSafeEqual } from 'node:crypto'

import { createRobotJobBridge } from './job-bridge.js'

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled'])
const ALLOWED_FIELDS = new Set(['task_id', 'status', 'message'])
const DEFAULT_PATH = '/robot-task-results'
const DEFAULT_MAX_BODY_BYTES = 8 * 1024
const MAX_ID_LENGTH = 128
const MAX_MESSAGE_LENGTH = 4_000

export const name = 'robot-job-callback-server'
export const inject = ['webServer']

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function sameSecret(actual, expected) {
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length
    && timingSafeEqual(actualBytes, expectedBytes)
}

function validateResult(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('request body must be an object')
  }
  if (Object.keys(value).some(field => !ALLOWED_FIELDS.has(field))) {
    throw new TypeError('request body contains unsupported fields')
  }
  if (typeof value.task_id !== 'string'
    || value.task_id.length === 0
    || value.task_id.length > MAX_ID_LENGTH) {
    throw new TypeError('task_id is invalid')
  }
  if (!TERMINAL_STATUSES.has(value.status)) {
    throw new TypeError('status is invalid')
  }
  if (typeof value.message !== 'string'
    || value.message.length === 0
    || value.message.length > MAX_MESSAGE_LENGTH) {
    throw new TypeError('message is invalid')
  }

  return {
    task_id: value.task_id,
    status: value.status,
    message: value.message,
  }
}

export function createRobotCallbackHandler({ bridge, token }) {
  if (!bridge || typeof bridge.accept !== 'function') {
    throw new TypeError('bridge is required')
  }
  if (typeof token !== 'string' || token.length < 16) {
    throw new TypeError('callback token must contain at least 16 characters')
  }

  return async function handle(request) {
    if (request.method !== 'POST') {
      return new Response(null, { status: 405, headers: { allow: 'POST' } })
    }

    const authorization = request.headers.get('authorization') ?? ''
    if (!authorization.startsWith('Bearer ')
      || !sameSecret(authorization.slice('Bearer '.length), token)) {
      return jsonResponse(401, {
        error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' },
      })
    }
    if (!(request.headers.get('content-type') ?? '')
      .toLowerCase()
      .startsWith('application/json')) {
      return jsonResponse(415, {
        error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Expected application/json' },
      })
    }

    let result
    try {
      result = validateResult(await request.json())
    } catch {
      return jsonResponse(422, {
        error: { code: 'VALIDATION_ERROR', message: 'Invalid callback result' },
      })
    }

    const accepted = bridge.accept(result)
    if (accepted.outcome === 'conflict') {
      return jsonResponse(409, {
        error: { code: 'TERMINAL_CONFLICT', message: 'Conflicting final result' },
      })
    }
    if (accepted.outcome === 'unavailable') {
      return jsonResponse(503, {
        error: { code: 'CALLBACK_CAPACITY', message: 'Callback receiver is full' },
      })
    }

    return jsonResponse(accepted.outcome === 'pending' ? 202 : 200, {
      accepted: true,
      ...accepted,
    })
  }
}

async function nodeRequest(req, maxBodyBytes) {
  const declared = req.headers['content-length']
  if (declared !== undefined && Number(declared) > maxBodyBytes) {
    throw Object.assign(new Error('request body too large'), { statusCode: 413 })
  }

  const chunks = []
  let received = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    received += buffer.byteLength
    if (received > maxBodyBytes) {
      throw Object.assign(new Error('request body too large'), { statusCode: 413 })
    }
    chunks.push(buffer)
  }

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value)
    else if (Array.isArray(value)) headers.set(key, value.join(', '))
  }
  const method = req.method ?? 'GET'
  return new Request(new URL(req.url ?? DEFAULT_PATH, 'http://dsh.internal'), {
    method,
    headers,
    ...(chunks.length > 0 && method !== 'GET' && method !== 'HEAD'
      ? { body: Buffer.concat(chunks) }
      : {}),
  })
}

async function writeNodeResponse(res, response) {
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
  res.end(Buffer.from(await response.arrayBuffer()))
}

export function apply(ctx, config = {}) {
  const path = config.path ?? DEFAULT_PATH
  const token = config.token ?? process.env.ROBOT_CALLBACK_TOKEN
  const maxBodyBytes = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES

  if (typeof path !== 'string' || !path.startsWith('/') || path.endsWith('/')) {
    throw new TypeError('callback path must be an absolute path without a trailing slash')
  }
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new TypeError('maxBodyBytes must be a positive safe integer')
  }

  const bridge = createRobotJobBridge({ maxPending: config.maxPending ?? 64 })
  const handle = createRobotCallbackHandler({ bridge, token })
  ctx.root.provide('robotJobResultBridge', bridge)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      try {
        await writeNodeResponse(res, await handle(await nodeRequest(req, maxBodyBytes)))
      } catch (error) {
        const status = error?.statusCode === 413 ? 413 : 400
        if (!res.headersSent) {
          await writeNodeResponse(res, jsonResponse(status, {
            error: {
              code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
              message: status === 413 ? 'Request body is too large' : 'Invalid request',
            },
          }))
        } else {
          res.destroy()
        }
      }
    },
  }), 'robot-job-callback-server route')
}
