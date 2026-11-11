// Vision console — host half.
//
// Owns one video decoder and one push loop, both controlled from the Web page
// instead of from an agent preset. That decoupling is the point: a session can be
// chosen at runtime, the loop can be started and stopped live, and nothing here
// depends on the robot-dog-test preset being mounted or healthy.
//
// Sampling and delivery are separate, mirroring the design:
//   - every `intervalMs` (default 1 Hz) the newest decoded frame enters a ring
//     buffer capped at `windowSize` (default 3), evicting the oldest;
//   - when the target Agent is genuinely idle, the whole buffered window is sent
//     as one message (1–3 images, oldest→newest) and the buffer is cleared;
//   - while the Agent is busy nothing is queued for later delivery: the window
//     keeps sliding and the next idle moment sends whatever is newest.
//
// Routes (same origin as the Web page):
//   GET  /vision/state        -> decoder + push status, plus targetable sessions
//   POST /vision/start        -> { sessionId, intervalMs, video } start pushing
//   POST /vision/stop         -> stop pushing and release the decoder
//   POST /vision/select       -> { video } switch the decoded file by filename
//   GET  /vision/frame.jpg    -> newest complete frame, for the preview <img>

import { readdirSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { createCamera } from './camera.js'
import { clearSession, getFrame, putFrame, sweep } from './frames.js'
import { drawBox, safeName, savePerson } from './person-store.js'

export const name = 'vision-console'
export const inject = ['webServer', 'agents', 'attachments']

const DEFAULTS = {
  videoPath: '',
  videoDir: '',
  videoExtensions: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'flv', 'ts', 'mpeg', 'mpg'],
  ffmpegPath: 'ffmpeg',
  captureFps: 2,
  maxWidth: 960,
  jpegQuality: 70,
  loop: true,
  defaultIntervalMs: 1000,
  minIntervalMs: 500,
  maxIntervalMs: 60000,
  windowSize: 3,
  maxPushedWindows: 600,
  frameViewTtlMs: 600000,
  targetPreset: 'robot-dog-test',
  personStoreDir: '',
  boxColor: 'red',
  boxThickness: 6,
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(payload.byteLength),
  })
  res.end(payload)
}

async function readJson(req, limit = 8192) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (total === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function basename(path) {
  if (typeof path !== 'string' || path.length === 0) return '?'
  const parts = path.split('/').filter(Boolean)
  return parts.at(-1) ?? path
}

function clockOf(createdAt) {
  if (!Number.isFinite(createdAt)) return '?'
  const date = new Date(createdAt)
  const pad = value => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function apply(ctx, rawConfig) {
  const config = { ...DEFAULTS, ...(rawConfig ?? {}) }
  if (typeof config.personStoreDir !== 'string' || config.personStoreDir.length === 0) {
    // Default next to this bundle so the records stay with the console, not the
    // shared profile home.
    config.personStoreDir = fileURLToPath(new URL('./data/person-store/', import.meta.url))
  }
  const camera = createCamera(config, ctx.logger)

  /** @type {Array<{ jpeg: Buffer, sequence: number, capturedAt: number }>} */
  const buffer = []
  let lastSequence = 0

  const videoExtensions = new Set(
    (Array.isArray(config.videoExtensions) ? config.videoExtensions : [])
      .map(extension => String(extension).replace(/^\./, '').toLowerCase())
      .filter(extension => extension.length > 0),
  )

  /**
   * Videos are chosen by filename. They are listed from `videoDir`, or from the
   * configured clip's own folder, so dropping a file beside it is enough.
   */
  function videoDir() {
    const configured = typeof config.videoDir === 'string' ? config.videoDir.trim() : ''
    return configured.length > 0 ? configured : dirname(config.videoPath)
  }

  function listVideos() {
    let entries
    try {
      entries = readdirSync(videoDir(), { withFileTypes: true })
    } catch {
      return []
    }
    return entries
      .filter(entry => entry.isFile() && videoExtensions.has(extname(entry.name).slice(1).toLowerCase()))
      .map(entry => entry.name)
      .sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true }))
  }

  /** Resolve one listed filename to a path; traversal and unknown names are rejected. */
  function resolveVideo(name) {
    const value = typeof name === 'string' ? name.trim() : ''
    if (value.length === 0) throw new Error('请选择视频文件')
    if (value.includes('/') || value.includes('\\') || value === '.' || value === '..') {
      throw new Error('只能按文件名选择视频')
    }
    if (!listVideos().includes(value)) throw new Error(`视频不存在：${value}`)
    return join(videoDir(), value)
  }

  /**
   * Switch the decoder source. Frames captured from the previous file must not
   * join the next pushed window, so the buffer is dropped.
   */
  function selectVideo(name) {
    const value = typeof name === 'string' ? name.trim() : ''
    if (value.length > 0 && value === basename(config.videoPath)) {
      buffer.length = 0
      return
    }
    camera.setVideoPath(resolveVideo(value))
    buffer.length = 0
  }

  const state = {
    running: false,
    sessionId: null,
    intervalMs: config.defaultIntervalMs,
    pushed: 0,
    skipped: 0,
    sampled: 0,
    dropped: 0,
    lastPushAt: null,
    lastError: '',
    busy: false,
  }

  let timer = null
  /** Tools are per-Agent and outlive a push session, so the catalog never churns mid-turn. */
  /** @type {Map<string, Array<() => void>>} */
  const agentTools = new Map()

  const BBOX_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['x', 'y', 'w', 'h'],
    properties: {
      x: { type: 'number', description: '左边界，占图宽的比例 0~1' },
      y: { type: 'number', description: '上边界，占图高的比例 0~1' },
      w: { type: 'number', description: '框宽，占图宽的比例 0~1' },
      h: { type: 'number', description: '框高，占图高的比例 0~1' },
    },
  }

  /**
   * Tools exist only inside the target session's own scope, so starting a push
   * adds them and stopping removes them. Nothing leaks into other presets.
   */
  function ensureTools(agent) {
    // Tools live in the robot-dog-test preset now (`observation-tools.js`).
    // Registering them here as well would duplicate the names in one scope.
    return
    const agentId = String(agent?.id ?? '')
    if (agentId === '') return
    if (agentTools.has(agentId)) return
    const disposers = []
    try {
      disposers.push(agent.ctx.tools.register({
        name: 'observation_no_action',
        description: '环境观察回合不需要任何行动时调用：表示这组画面没有值得回应或处理的变化，并立即结束本轮。调用前不要输出任何文字。',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['ok'],
            properties: { ok: { type: 'boolean' } },
          },
          render: () => [{ type: 'text', text: 'ok' }],
        },
        async execute(_args, exec) {
          exec.concludeTurn()
          return { ok: true }
        },
      }))

      disposers.push(agent.ctx.tools.register({
        name: 'remember_person',
        description: [
          '记住当前观察画面里的一个人：保存整张画面，并在你给出的 bbox 区域画一个矩形框（不裁剪）。',
          'frame_id 必须原样照抄【环境观察】消息里的那一帧；bbox 用 0~1 的比例坐标（相对这张图的宽高）。',
          '只记录用户明确说过的信息；不要编造姓名、不要记录外观衣着。',
        ].join(''),
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['frame_id', 'bbox'],
          properties: {
            frame_id: { type: 'string', description: '环境观察消息里的 frame_id，例如 frame_101' },
            bbox: BBOX_SCHEMA,
            name: { type: 'string', description: '人物名字或临时称呼，用于目录名' },
            facts: {
              type: 'array',
              items: { type: 'string' },
              description: '用户自述的稳定信息，逐条记录，尽量保留原话',
            },
            note: { type: 'string', description: '其他备注，可选' },
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['saved', 'personId', 'path'],
            properties: {
              saved: { type: 'boolean' },
              personId: { type: 'string' },
              path: { type: 'string' },
            },
          },
          render: (_args, value) => [{
            type: 'text',
            text: value.saved ? `已保存人物照片：${value.path}` : '未保存',
          }],
        },
        async execute(args, exec) {
          const attachments = ctx.get('attachments')
          if (attachments === undefined) throw new Error('附件存储未加载')
          const sessionId = String(exec?.agent?.id ?? state.sessionId ?? '')
          const frameId = typeof args?.frame_id === 'string' ? args.frame_id.trim() : ''
          if (frameId.length === 0) throw new Error('缺少 frame_id')

          const frame = getFrame(sessionId, frameId)
          if (frame === null) {
            throw new Error(`帧 ${frameId} 不存在或已过期（${Math.round(config.frameViewTtlMs / 60000)} 分钟内有效）；请等待下一次观察窗口`)
          }

          const bbox = args?.bbox ?? {}
          const values = [bbox.x, bbox.y, bbox.w, bbox.h].map(Number)
          if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
            throw new Error('bbox 必须是 0~1 的比例（占图片宽高的比例）')
          }
          if (values[2] <= 0 || values[3] <= 0) throw new Error('bbox 的 w/h 必须大于 0')

          const stored = await attachments.readImage(frame.ref)
          const width = Number(stored?.ref?.width ?? frame.ref?.width)
          const height = Number(stored?.ref?.height ?? frame.ref?.height)
          if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
            throw new Error('无法确定图片尺寸')
          }

          const pixels = {
            x: values[0] * width,
            y: values[1] * height,
            w: Math.min(values[2] * width, width - values[0] * width),
            h: Math.min(values[3] * height, height - values[1] * height),
          }
          const boxed = await drawBox(config.ffmpegPath, Buffer.from(stored.data), pixels, {
            color: config.boxColor,
            thickness: config.boxThickness,
          })

          const personId = `${safeName(args?.name, 'person')}-${randomUUID().slice(0, 8)}`
          const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
          const facts = Array.isArray(args?.facts)
            ? args.facts.filter(item => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
            : []
          const saved = await savePerson({
            dir: config.personStoreDir,
            jpeg: boxed,
            box: { x: values[0], y: values[1], w: values[2], h: values[3] },
            personId,
            stamp,
            meta: {
              name: typeof args?.name === 'string' ? args.name : null,
              facts,
              note: typeof args?.note === 'string' ? args.note : null,
              frameId,
              capturedAt: frame.capturedAt,
              sessionId,
              sourceAttachmentId: frame.ref?.attachmentId ?? null,
              image: { width, height },
              boxStyle: { color: config.boxColor, thickness: config.boxThickness, mode: 'full-frame' },
              savedAt: new Date().toISOString(),
            },
          })

          return { saved: true, personId, path: saved.path }
        },
      }))
      agentTools.set(agentId, disposers)
    } catch (error) {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // already released
        }
      }
      state.lastError = `注册观察工具失败：${errorText(error)}`
    }
  }

  function releaseTools(agentId) {
    const key = String(agentId)
    const disposers = agentTools.get(key)
    if (disposers === undefined) return
    agentTools.delete(key)
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // already released
      }
    }
  }

  /** Observation tools belong to the robot-dog-test agents only. */
  function usesThisPreset(agent) {
    const presets = ctx.get('agentPresets')
    try {
      const composed = presets?.composedPreset?.(agent.ctx)
      return composed === undefined ? false : composed === config.targetPreset
    } catch {
      return false
    }
  }

  function clampInterval(value) {
    const number = Number(value)
    if (!Number.isFinite(number)) return config.defaultIntervalMs
    return Math.min(config.maxIntervalMs, Math.max(config.minIntervalMs, Math.round(number)))
  }

  function sessions() {
    const agents = ctx.get('agents')
    const presets = ctx.get('agentPresets')
    const projections = ctx.get('sessionProjections')
    const list = agents?.list?.() ?? []
    return list.map(agent => {
      let preset = null
      try {
        preset = presets?.composedPreset?.(agent.ctx) ?? null
      } catch {
        preset = null
      }
      // The sidebar shows the session's projected Chinese title; match it.
      let title = null
      try {
        title = projections?.snapshot?.(agent.session, ['title'])?.values?.title ?? null
      } catch {
        title = null
      }
      const header = agent.session?.header ?? {}
      return {
        id: String(agent.id),
        preset,
        title,
        busy: (agent.inbox?.nextTurn?.length ?? 0) > 0 || (agent.inbox?.nextStep?.length ?? 0) > 0,
        createdAt: header.createdAt ?? null,
        cwd: header.cwd ?? null,
        label: `${preset ?? '无预设'} · ${title ?? '未命名'}`,
      }
    })
  }

  function snapshot() {
    const latest = camera.latest()
    return {
      running: state.running,
      sessionId: state.sessionId,
      intervalMs: state.intervalMs,
      pushed: state.pushed,
      skipped: state.skipped,
      sampled: state.sampled,
      dropped: state.dropped,
      bufferedFrames: buffer.length,
      lastPushAt: state.lastPushAt,
      lastError: state.lastError,
      camera: camera.status(),
      frameSequence: latest?.sequence ?? null,
      frameAt: latest?.capturedAt ?? null,
      sessions: sessions(),
      videoPath: config.videoPath,
      videoName: basename(config.videoPath),
      videoDir: videoDir(),
      videos: listVideos(),
      ffmpegPath: config.ffmpegPath,
      windowSize: config.windowSize,
      personStoreDir: config.personStoreDir,
      tools: agentTools.size,
    }
  }

  function buildMessage(refs, window) {
    const header = window.length === 1
      ? '本次窗口包含 1 张图片。'
      : `本次窗口包含 ${window.length} 张图片，按采集时间从早到晚排列。`
    const content = [{
      type: 'text',
      text: [
        '【环境观察】',
        '这是系统周期性采集的摄像头画面，不是用户的新指令。',
        header,
      ].join('\n'),
    }]
    for (let index = 0; index < window.length; index += 1) {
      content.push({
        type: 'text',
        text: [
          '',
          `frame_id: frame_${window[index].sequence}`,
          `captured_at: ${clockOf(window[index].capturedAt)}`,
          `[图片 ${index + 1}]`,
        ].join('\n'),
      })
      content.push({ type: 'image', attachment: refs[index] })
    }
    return {
      id: randomUUID(),
      role: 'user',
      content,
      source: {
        kind: 'camera-observation',
        observationId: randomUUID(),
        frames: window.map(frame => ({
          frameId: `frame_${frame.sequence}`,
          sequence: frame.sequence,
          capturedAt: frame.capturedAt,
        })),
      },
    }
  }

  /** 1 Hz sampling: newest frame in, oldest evicted. Never touches the Agent. */
  function sample() {
    if (!state.running) return
    const frame = camera.latest()
    if (frame === null) return
    if (frame.sequence === lastSequence) return
    lastSequence = frame.sequence
    state.sampled += 1
    buffer.push({ jpeg: frame.jpeg, sequence: frame.sequence, capturedAt: frame.capturedAt })
    while (buffer.length > config.windowSize) {
      buffer.shift()
      state.dropped += 1
    }
  }

  /** Deliver the whole buffered window when (and only when) the Agent is idle. */
  async function tryPush() {
    if (!state.running || state.busy) return
    if (buffer.length === 0) return

    const agents = ctx.get('agents')
    const agent = agents?.get?.(state.sessionId)
    if (agent === undefined) {
      state.lastError = `目标会话不存在：${state.sessionId ?? ''}`
      return
    }
    if ((agent.inbox?.nextTurn?.length ?? 0) > 0 || (agent.inbox?.nextStep?.length ?? 0) > 0) {
      state.skipped += 1
      return
    }

    state.busy = true
    const window = buffer.splice(0, buffer.length)
    try {
      const attachments = ctx.get('attachments')
      if (attachments === undefined) throw new Error('attachment store is not available')
      const refs = await attachments.saveImages(window.map(frame => ({
        data: frame.jpeg,
        mediaType: 'image/jpeg',
        name: `console-${frame.sequence}.jpg`,
      })))
      // Register frame_id → attachment so later tools (remember_person) resolve
      // exactly the bytes the model just saw.
      for (let index = 0; index < window.length; index += 1) {
        putFrame(state.sessionId, `frame_${window[index].sequence}`, refs[index], window[index].capturedAt, config.frameViewTtlMs)
      }
      sweep()

      let delivered = false
      try {
        if (usesThisPreset(agent)) ensureTools(agent)
        agent.runMaintenance(() => {
          if ((agent.inbox?.nextTurn?.length ?? 0) > 0 || (agent.inbox?.nextStep?.length ?? 0) > 0) {
            return Promise.resolve()
          }
          agent.steer(buildMessage(refs, window))
          delivered = true
          return Promise.resolve()
        }).catch(error => { state.lastError = `maintenance failed: ${errorText(error)}` })
      } catch (error) {
        // A running Agent is the normal case between two model turns, not a
        // failure: count it as a skip and keep the window for the next idle slot.
        const message = errorText(error)
        if (/not idle|active work|already/i.test(message)) state.skipped += 1
        else state.lastError = message
      }

      if (delivered) {
        state.pushed += 1
        state.lastPushAt = Date.now()
        state.lastError = ''
        if (state.pushed >= config.maxPushedWindows) stop()
      } else {
        // The window is still worth showing: put it back, newest frames win.
        buffer.unshift(...window.slice(-config.windowSize + buffer.length))
        state.skipped += 1
      }
    } catch (error) {
      state.lastError = errorText(error)
      buffer.unshift(...window)
      while (buffer.length > config.windowSize) buffer.shift()
    } finally {
      state.busy = false
    }
  }

  function start(sessionId, intervalMs, video) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('sessionId is required')
    }
    if (typeof video === 'string' && video.trim().length > 0) selectVideo(video)
    state.sessionId = sessionId
    state.intervalMs = clampInterval(intervalMs ?? state.intervalMs)
    if (timer !== null) clearInterval(timer)
    camera.start()
    state.running = true
    state.pushed = 0
    state.skipped = 0
    state.sampled = 0
    state.dropped = 0
    state.lastError = ''
    buffer.length = 0
    lastSequence = 0
    {
      // The target is explicit: register here instead of guessing the preset at
      // agent/created, where composedPreset may not be resolvable yet.
      const agent = ctx.get('agents')?.get?.(sessionId)
      if (agent !== undefined) ensureTools(agent)
    }
    timer = setInterval(() => {
      sample()
      void tryPush()
    }, state.intervalMs)
    timer.unref?.()
    sample()
    void tryPush()
    return snapshot()
  }

  function stop() {
    state.running = false
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    buffer.length = 0
    camera.stop()
    return snapshot()
  }

  // Tools follow the Agent, not the push switch: they are registered once per
  // robot-dog-test session and removed only when that session goes away, so the
  // catalog cannot change in the middle of a turn.
  ctx.on('agent/created', payload => {
    const agent = payload?.agent
    if (agent !== undefined && usesThisPreset(agent)) ensureTools(agent)
  })
  for (const agent of ctx.get('agents')?.list?.() ?? []) {
    if (usesThisPreset(agent)) ensureTools(agent)
  }

  // A disposed session can no longer resolve its frames or keep its tools.
  ctx.on('agent/disposed', payload => {
    const id = payload?.agent?.id
    if (id === undefined) return
    releaseTools(String(id))
    clearSession(String(id))
  })

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({
        kind: 'exact',
        path: '/vision/state',
        handler: async (_req, res) => sendJson(res, 200, snapshot()),
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/vision/frame.jpg',
        handler: async (_req, res) => {
          const frame = camera.latest()
          if (frame === null) {
            res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
            res.end('no frame')
            return
          }
          res.writeHead(200, {
            'content-type': 'image/jpeg',
            'cache-control': 'no-store',
            'content-length': String(frame.jpeg.length),
          })
          res.end(frame.jpeg)
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/vision/start',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'use POST' })
            return
          }
          try {
            const body = await readJson(req)
            sendJson(res, 200, start(body?.sessionId, body?.intervalMs, body?.video))
          } catch (error) {
            sendJson(res, 400, { error: errorText(error) })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/vision/select',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'use POST' })
            return
          }
          try {
            const body = await readJson(req)
            selectVideo(body?.video)
            sendJson(res, 200, snapshot())
          } catch (error) {
            sendJson(res, 400, { error: errorText(error) })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/vision/stop',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'use POST' })
            return
          }
          sendJson(res, 200, stop())
        },
      }),
    ]
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // already released
        }
      }
      stop()
    }
  }, 'vision-console routes')
}
