// Standby observation: periodically look at the latest frame and tell the main
// agent when someone stays in view.
//
// Sample -> analyse (one vision call) -> dwell state machine -> agent.steer().
// Only one analysis runs at a time; a newer frame simply replaces the pending
// one, so slow vision calls never build a backlog.

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { identifyFace } from './identify.js'

export const name = 'observation'
export const inject = ['tools', 'attachments']

const PROMPT = [
  '你在看机器狗摄像头的一帧画面。判断画面里有没有人、是否正面面对镜头。',
  '只输出 JSON，不要解释：',
  '{"person": true 或 false, "face": {"x":0.4,"y":0.2,"w":0.1,"h":0.1} 或 null, "moving": false}',
  'face 用 0~1 的归一化坐标（相对图片宽高），看不清人脸时为 null。',
  '只有一帧无法判断是否在移动，moving 固定输出 false。',
].join('\n')

// Motion needs two frames: a single still cannot tell walking from standing.
const PROMPT_PAIR = [
  '给你两张连续的画面：第一张是上一帧，第二张是当前帧（相隔约一秒）。',
  '注意：机器狗自己也在移动，不要只看人在画面里的绝对位置——画面整体位移可能来自狗在走。',
  '判断：',
  '1. 当前帧（第二张）里有没有人、人脸位置；',
  '2. 以墙面、门框、地面等**静止背景**为参照，这个人相对背景有没有明显位移：',
  '   - 相对背景的位置基本没变，只是画面整体在移动 → 没跟上变化，判为 false；',
  '   - 相对背景明显前进/后退/横向走动，或者在画面里明显变小（走远）、变大（靠近）→ 判为 true。',
  '只输出 JSON，不要解释：',
  '{"person": true 或 false, "face": {"x":0.4,"y":0.2,"w":0.1,"h":0.1} 或 null, "moving": true 或 false}',
  'face 用当前帧的 0~1 归一化坐标，看不清人脸时为 null。',
  '判定口径：只有相对背景的位置变化才算 moving。原地晃身体、摆手、摆臂、转头、变换姿势都不算；',
  '拿不准或者两帧里人相对背景几乎没动时，输出 moving: false；没有人时也为 false。',
].join('\n')

/** Minimal user message shape the LLM service and the agent inbox accept. */
function userMessage(text, extra = []) {
  return {
    id: randomUUID(),
    role: 'user',
    source: { kind: 'observation' },
    content: [{ type: 'text', text }, ...extra],
  }
}

function parseAnalysis(text) {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let end = -1
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) { end = index; break }
    }
  }
  if (end < 0) return null
  try {
    const value = JSON.parse(text.slice(start, end + 1))
    return {
      person: value?.person === true,
      face: value?.face ?? null,
      moving: value?.moving === true,
    }
  } catch {
    return null
  }
}

export function apply(ctx, config = {}) {
  const provider = config.provider
  const model = config.model
  const personsDir = typeof config.personsDir === 'string' ? config.personsDir : null
  const intervalMs = config.intervalMs ?? 1_500
  const dwellFrames = config.dwellFrames ?? 3
  const absenceFrames = config.absenceFrames ?? 3
  const cooldownMs = config.cooldownMs ?? 5 * 60 * 1000
  // Temporary debugging: when set, every analysed frame pair is written here
  // together with the raw model answer.
  const debugDir = typeof config.debugDir === 'string' && config.debugDir.startsWith('/')
    ? config.debugDir
    : null
  // Only dump frames for the mode being debugged, so standby sampling stays
  // out of the way.
  const debugMode = typeof config.debugMode === 'string' ? config.debugMode : 'guide_follow'
  // Observation answers are one tiny JSON object; reasoning only burns the
  // token budget and can starve the text channel entirely.
  const reasoningEffort = config.reasoningEffort ?? 'off'
  const maxTokens = config.maxTokens ?? 400

  // mode -> strategy. The shared counters are seen/missing; each mode owns its
  // own idle state name and thresholds.
  const STRATEGIES = {
    standby_person: {
      interval: intervalMs, dwell: dwellFrames, absence: absenceFrames, quiet: false, state: 'WATCHING',
    },
    // The agent is already driving the capture; keep sampling dense but stay
    // silent about stays.
    enrolling: {
      interval: Math.min(intervalMs, 800), dwell: 1, absence: absenceFrames, quiet: true, state: 'ENROLLING',
    },
    // Leading someone: only the person-visible transitions matter.
    guide_follow: {
      interval: 1_000, dwell: 1, absence: absenceFrames, quiet: false, guide: true, state: 'SEARCHING',
      stopFrames: 5, resumeFrames: 3, eventCooldownMs: 4_000,
    },
  }

  const state = {
    running: false,
    phase: 'WATCHING',
    seen: 0,
    missing: 0,
    still: 0,
    recovering: false,
    movingWindow: [],
    lastGuideAt: 0,
    prevRef: null,
    prevJpeg: null,
    lastSeq: -1,
    lastVideoSeconds: null,
    looped: false,
    lastError: null,
    lastAnalysisAt: null,
    lastNotifyAt: 0,
    stopReason: null,
    lastActiveSessionId: null,
    boundSessionId: null,
    requirement: null,
    stack: [],
    agent: null,
  }

  let requirementSeq = 0

  function currentMode() {
    return state.requirement?.mode ?? 'standby_person'
  }

  function currentStrategy() {
    return STRATEGIES[currentMode()] ?? STRATEGIES.standby_person
  }

  function requirementAgent() {
    return state.agent
  }

  let debugSeq = 0
  // Debug only: keep the two compared frames and the raw model answer on disk.
  async function writeDebugPair(previous, current, raw, parsed, meta) {
    if (debugDir === null || currentMode() !== debugMode) return
    try {
      await mkdir(debugDir, { recursive: true })
      const seq = String(++debugSeq).padStart(4, '0')
      if (previous !== null) await writeFile(join(debugDir, `${seq}-prev.jpg`), previous)
      await writeFile(join(debugDir, `${seq}-cur.jpg`), current)
      await writeFile(join(debugDir, `${seq}.json`), JSON.stringify({
        seq,
        at: new Date().toISOString(),
        mode: currentMode(),
        frameSeq: meta?.seq ?? null,
        videoSeconds: typeof meta?.videoSeconds === 'number'
          ? Number(meta.videoSeconds.toFixed(2))
          : null,
        videoEnded: meta?.videoEnded === true,
        parsed,
        raw,
      }, null, 2))
    } catch (error) {
      state.lastError = `debug write failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  // "Most recent" means most recently active, not most recently created: a
  // background session created later must not steal the observation events.
  ctx.on('agent/inbox/claimed', ({ agent }) => {
    if (agent?.id !== undefined) state.lastActiveSessionId = agent.id
  })

  async function analyse(jpeg, meta = null) {
    const attachments = ctx.get('attachments')
    const llm = ctx.get('llm')
    if (attachments === undefined) throw new Error('附件存储未加载')
    if (llm === undefined) throw new Error('LLM 服务未加载')
    if (typeof provider !== 'string' || typeof model !== 'string') {
      throw new Error('observation 未配置 provider / model')
    }

    const ref = await attachments.saveImage({ data: jpeg, mediaType: 'image/jpeg', name: 'observe.jpg' })
    const hasPrevious = state.prevRef !== null
    const previousJpeg = state.prevJpeg
    const images = []
    if (hasPrevious) images.push({ type: 'image', attachment: state.prevRef })
    images.push({ type: 'image', attachment: ref })
    state.prevRef = ref
    state.prevJpeg = jpeg
    const message = userMessage(hasPrevious ? PROMPT_PAIR : PROMPT, images)

    let text = ''
    let blockText = ''
    const seen = []
    for await (const chunk of llm.stream({
      provider,
      model,
      messages: [message],
      maxTokens,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    })) {
      if (seen.length < 8) seen.push(chunk?.type)
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      else if (chunk?.type === 'block-end' && chunk.block?.type === 'text') blockText += chunk.block.text ?? ''
    }
    // Adapters that stream deltas also repeat the same text in block-end; only
    // fall back to the block text when no delta ever arrived.
    if (text.length === 0) text = blockText
    if (text.length === 0) {
      throw new Error(`模型没有返回文本；chunks=${JSON.stringify(seen)}`)
    }
    const parsed = parseAnalysis(text)
    if (parsed === null) {
      throw new Error(`无法解析观察结果（${text.length} 字符）: ${JSON.stringify(text.slice(0, 120))}`)
    }
    await writeDebugPair(previousJpeg, jpeg, text, parsed, meta)
    return parsed
  }

  async function tick() {
    if (state.requirement !== null && Date.now() > state.requirement.expiresAt) {
      releaseRequirement(state.requirement.id)
    }
    const camera = ctx.get('camera')
    const frame = camera?.latest?.()
    if (frame === null || frame === undefined) return
    if (frame.seq === state.lastSeq) return
    state.lastSeq = frame.seq

    const strategy = currentStrategy()
    // The clip played to the end and is not replaying: for guiding purposes the
    // target counts as still following, no vision call is made.
    const videoEnded = camera?.status?.()?.finished === true
    if (strategy.guide && videoEnded) {
      trackFollowing({ person: true, moving: true, face: null }, strategy)
      return
    }

    // One full pass of the clip is enough for the demo: after it wraps, stop
    // paying for vision and treat every frame as "still following" until a
    // manual reset rewinds the clip.
    const wrapped = state.lastVideoSeconds !== null
      && typeof frame.videoSeconds === 'number'
      && frame.videoSeconds + 0.5 < state.lastVideoSeconds
    if (typeof frame.videoSeconds === 'number') state.lastVideoSeconds = frame.videoSeconds
    if (wrapped) state.looped = true
    if (strategy.guide && state.looped) {
      trackFollowing({ person: true, moving: true, face: null }, strategy)
      return
    }

    const result = await analyse(frame.jpeg, { ...frame, videoEnded })
    state.lastAnalysisAt = new Date().toISOString()
    if (result === null) {
      state.lastError = '无法解析观察结果'
      return
    }
    state.lastError = null

    if (strategy.guide) {
      trackFollowing(result, strategy)
      return
    }

    // Presence tracking is mode-independent: switching modes never resurrects
    // an already-greeted stay. Only the standby mode actually notifies.
    if (result.person) {
      state.seen += 1
      state.missing = 0
      if (state.phase === 'WATCHING' && state.seen >= strategy.dwell) {
        state.phase = 'STAYED'
        if (strategy.quiet) {
          state.phase = 'HANDLED'
        } else {
          const identity = await identify(frame.jpeg)
          await notify(result, identity)
        }
      }
      return
    }

    state.seen = 0
    if (state.phase === 'WATCHING') return
    state.missing += 1
    if (state.missing >= strategy.absence) {
      state.phase = 'WATCHING'
      state.missing = 0
    }
  }

  async function identify(jpeg) {
    if (personsDir === null) return { status: 'no-reference' }
    try {
      return await identifyFace({
        llm: ctx.get('llm'),
        attachments: ctx.get('attachments'),
        personsDir,
        provider,
        model,
        jpeg,
        bbox: null,
      })
    } catch (error) {
      return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) }
    }
  }

  function steer(text) {
    requirementAgent()?.steer?.(userMessage(text))
  }

  function guideEvent(text, strategy) {
    const now = Date.now()
    if (now - state.lastGuideAt < (strategy.eventCooldownMs ?? 4_000)) return
    state.lastGuideAt = now
    steer(text)
  }

  // Leading someone: the follower "falls behind" when they stop moving, not
  // when they vanish. SEARCHING -> TRACKING -> STOPPED, plus LOST as a fallback.
  function trackFollowing(result, strategy) {
    if (!result.person) {
      state.seen = 0
      state.still = 0
      state.movingWindow = []
      if (state.phase === 'SEARCHING' || state.phase === 'LOST') return
      state.missing += 1
      if (state.missing >= strategy.absence) {
        state.missing = 0
        state.phase = 'LOST'
        guideEvent('[观察] 目标已离开画面，暂停导航。', strategy)
      }
      return
    }

    state.missing = 0
    // Majority over the recent frames: one misread must not flip the state.
    state.movingWindow.push(result.moving)
    if (state.movingWindow.length > 5) state.movingWindow.shift()
    const moving = state.movingWindow.filter(Boolean).length * 2 > state.movingWindow.length

    // Seeing the target again is silent: the agent only needs to hear about
    // falling behind, not about every recovery.
    if (state.phase === 'SEARCHING' || state.phase === 'LOST') {
      state.phase = 'TRACKING'
      state.seen = 1
      state.still = 0
      state.recovering = false
      return
    }

    if (state.phase === 'TRACKING') {
      if (moving) {
        state.seen += 1
        state.still = 0
        state.recovering = false
        return
      }
      state.seen = 0
      state.still += 1
      if (state.still >= (strategy.stopFrames ?? 3)) {
        state.phase = 'STOPPED'
        guideEvent('[观察] 目标停下了，暂停导航，向目标靠近。', strategy)
      }
      return
    }

    // STOPPED: resume silently; only a fresh stop is worth a message.
    if (moving) {
      state.seen += 1
      if (state.seen >= (strategy.resumeFrames ?? 3)) {
        state.phase = 'TRACKING'
        state.still = 0
        state.recovering = false
      }
      return
    }

    state.seen = 0
    state.still += 1
  }

  async function notify(result, identity) {
    // State advances whether or not the cooldown actually sends a message;
    // otherwise a suppressed notify would pin the phase at STAYED forever.
    state.phase = 'HANDLED'

    const now = Date.now()
    if (now - state.lastNotifyAt < cooldownMs) return
    state.lastNotifyAt = now

    const agent = requirementAgent()
    if (agent === null) return

    let who = '一位访客'
    let hint = '请询问是否需要帮助，不要问姓名；需要画面时调用 get_camera_frame。'
    if (identity?.status === 'ok') {
      if (identity.match) {
        who = `已认出是「${identity.name}」`
        hint = '可以直接打招呼；需要画面时调用 get_camera_frame。'
      } else {
        who = `一位访客（不是已记录的「${identity.name}」）`
      }
    } else if (identity?.status === 'no-reference') {
      who = '一位访客（还没有任何人脸记录）'
    }

    const face = result.face === null
      ? '人脸不可见'
      : `人脸位置约 x=${result.face.x}, y=${result.face.y}, w=${result.face.w}, h=${result.face.h}（归一化）`
    const strategy = currentStrategy()
    agent.steer(userMessage(
      `[观察] ${who}，在画面中停留了约 ${Math.round((strategy.dwell * strategy.interval) / 1000)} 秒，${face}。${hint}`,
    ))
  }

  // A token invalidates every timer chained by a previous run, so start/stop
  // in quick succession can never leave two loops alive.
  let loopToken = 0

  function beginLoop() {
    const token = ++loopToken
    const run = () => {
      if (!state.running || token !== loopToken) return
      tick()
        .catch(error => { state.lastError = error instanceof Error ? error.message : String(error) })
        .finally(() => {
          if (state.running && token === loopToken) setTimeout(run, currentStrategy().interval)
        })
    }
    run()
  }

  async function start(sessionId) {
    if (state.running) return { running: true, intervalMs }
    if (ctx.get('camera') === undefined) throw new Error('视频源未启用，无法启动观察')
    const agents = ctx.get('agents')
    const explicit = typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null
    // Opening a session registers a fresh agent, so "most recently opened" is
    // the newest top-level registration. A session that merely sent messages
    // earlier must not outrank it.
    let agent = explicit === null ? undefined : agents?.get?.(explicit)
    if (agent === undefined) agent = agents?.roots?.().at(-1)
    if (agent === undefined && state.lastActiveSessionId !== null) {
      agent = agents?.get?.(state.lastActiveSessionId)
    }
    if (agent === undefined) agent = agents?.list?.().at(-1)
    if (agent === undefined) throw new Error('没有活跃的 agent，无法启动观察')
    state.boundSessionId = agent.id

    state.agent = agent
    state.running = true
    state.phase = 'WATCHING'
    state.seen = 0
    state.missing = 0
    state.stopReason = null
    state.requirement = null
    state.stack = []
    // A manual start is a fresh intent to observe: the cooldown only guards
    // repeated notifications inside one run, not across restarts.
    state.lastNotifyAt = 0
    state.prevRef = null
    state.prevJpeg = null
    state.lastVideoSeconds = null
    state.looped = false

    try {
      ctx.get('camera')?.resume?.()
    } catch {
      // Camera resume is best effort.
    }
    beginLoop()
    return { running: true, intervalMs }
  }

  function stop(reason = 'user') {
    state.running = false
    loopToken += 1
    state.phase = 'WATCHING'
    state.seen = 0
    state.missing = 0
    state.stopReason = reason
    // Stopping ends every requirement; the next start begins from standby.
    state.requirement = null
    state.stack = []
    return { running: false, stopReason: reason }
  }

  // The observation belongs to the session that started it: releasing that
  // session ends the loop instead of steering a dead agent.
  ctx.on('agent/disposed', ({ agent }) => {
    if (state.running && agent?.id === state.boundSessionId) stop('session-disposed')
  })

  // Manual reset for testing: clear every derived state without touching the
  // running loop, so the next frame starts a clean episode.
  function reset() {
    state.phase = 'WATCHING'
    state.seen = 0
    state.missing = 0
    state.still = 0
    state.recovering = false
    state.movingWindow = []
    state.lastGuideAt = 0
    state.lastNotifyAt = 0
    state.prevRef = null
    state.prevJpeg = null
    state.looped = false
    state.requirement = null
    state.stack = []
    state.stopReason = null
    state.lastError = null
    // Reset rewinds the decoder as well: it keeps running from the clip's
    // first frame, so the counters restart at zero immediately.
    let cameraRestarted = false
    try {
      const camera = ctx.get('camera') ?? ctx.root?.get?.('camera')
      cameraRestarted = camera?.restart?.()?.restarted === true
    } catch {
      // The camera is optional; the observation state is reset regardless.
    }
    // Cleared after the rewind so the next frame is not mistaken for a wrap.
    state.lastVideoSeconds = null
    return { reset: true, running: state.running, cameraRestarted }
  }

  function requireRequirement(mode, ttlMs) {
    if (STRATEGIES[mode] === undefined) {
      throw new Error(`不支持的观察模式: ${String(mode)}（可用: ${Object.keys(STRATEGIES).join(' / ')}）`)
    }
    const requirement = {
      id: `req-${++requirementSeq}`,
      mode,
      expiresAt: Date.now() + (Number.isFinite(ttlMs) ? ttlMs : 10 * 60 * 1000),
    }
    if (state.requirement !== null) state.stack.push(state.requirement)
    state.requirement = requirement
    if (STRATEGIES[mode].guide) {
      state.phase = STRATEGIES[mode].state
      state.still = 0
      state.recovering = false
      state.movingWindow = []
      state.lastGuideAt = 0
      state.prevRef = null
      state.prevJpeg = null
      state.lastVideoSeconds = null
      state.looped = false
    }
    return requirement
  }

  function releaseRequirement(id) {
    const current = state.requirement
    if (current === null) return { released: false }
    if (id !== undefined && current.id !== id) {
      const index = state.stack.findIndex(item => item.id === id)
      if (index < 0) return { released: false }
      state.stack.splice(index, 1)
      return { released: true }
    }
    state.requirement = state.stack.pop() ?? null
    return { released: true, back: currentMode() }
  }

  ctx.tools.register({
    name: 'observation_require',
    description: '登记一个临时的观察需求，接管当前观察（例如记人时锁定目标）。需求入栈，结束时用 observation_release 出栈，'
      + `或到期自动释放。可用模式：${Object.keys(STRATEGIES).join(' / ')}。`,
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: '观察模式，例如 enrolling' },
        ttlMs: { type: 'integer', description: '有效期毫秒，默认 600000' },
      },
      required: ['mode'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['requirementId', 'mode', 'expiresAt'],
        properties: {
          requirementId: { type: 'string' },
          mode: { type: 'string' },
          expiresAt: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `观察模式已切换到 ${value.mode}（${value.requirementId}），到期 ${value.expiresAt}`,
      }],
    },
    async execute(args, exec) {
      if (exec?.agent === undefined) throw new Error('缺少会话上下文，无法登记观察需求')
      const requirement = requireRequirement(args?.mode, args?.ttlMs)
      return {
        requirementId: requirement.id,
        mode: requirement.mode,
        expiresAt: new Date(requirement.expiresAt).toISOString(),
      }
    },
  })

  ctx.tools.register({
    name: 'observation_release',
    description: '结束一个观察需求并回落到上一个（默认栈顶）。',
    parameters: {
      type: 'object',
      properties: {
        requirementId: { type: 'string', description: '要释放的需求 id，省略则释放栈顶' },
      },
      required: [],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['released'],
        properties: {
          released: { type: 'boolean' },
          back: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.released ? `已释放，回到 ${value.back ?? '无需求'}` : '没有可释放的需求',
      }],
    },
    async execute(args) {
      const result = releaseRequirement(args?.requirementId)
      return {
        released: result.released,
        ...(typeof result.back === 'string' ? { back: result.back } : {}),
      }
    },
  })

  ctx.tools.register({
    name: 'observation_start',
    description: '开始持续观察摄像头（待机观察）。系统会自动判断是否有人停留，并在有人停留时通知你。',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['running', 'intervalMs'],
        properties: {
          running: { type: 'boolean' },
          intervalMs: { type: 'integer' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `观察已启动，采样间隔 ${value.intervalMs}ms` }],
    },
    async execute(_args, exec) {
      return start(exec?.agent?.id)
    },
  })

  ctx.tools.register({
    name: 'observation_stop',
    description: '停止持续观察。',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['running'],
        properties: { running: { type: 'boolean' } },
      },
      render: () => [{ type: 'text', text: '观察已停止' }],
    },
    async execute() {
      return stop()
    },
  })

  ctx.tools.register({
    name: 'observation_status',
    description: '查看观察状态（调试用）。',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['running', 'mode', 'state', 'seen', 'missing', 'still'],
        properties: {
          running: { type: 'boolean' },
          mode: { type: 'string' },
          state: { type: 'string' },
          seen: { type: 'integer', description: 'standby: 连续有人帧数；guide: 连续判定在动的帧数' },
          missing: { type: 'integer', description: '连续没看到人的帧数' },
          still: { type: 'integer', description: 'guide: 连续判定没动的帧数' },
          stopReason: { type: 'string' },
          lastError: { type: 'string' },
          lastAnalysisAt: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `running=${value.running} mode=${value.mode} state=${value.state}`
          + ` seen=${value.seen} still=${value.still} missing=${value.missing}`
          + (value.stopReason ? ` stop=${value.stopReason}` : '')
          + (value.lastError ? ` error=${value.lastError}` : ''),
      }],
    },
    async execute() {
      return {
        running: state.running,
        mode: currentMode(),
        state: state.phase,
        seen: state.seen,
        still: state.still,
        missing: state.missing,
        ...(state.stopReason === null ? {} : { stopReason: state.stopReason }),
        ...(state.lastError === null ? {} : { lastError: state.lastError }),
        ...(state.lastAnalysisAt === null ? {} : { lastAnalysisAt: state.lastAnalysisAt }),
      }
    },
  })

  // This instance lives inside the robot-dog preset, so it registers itself
  // with the host hub instead of providing a global service.
  const handle = {
    start: sessionId => start(sessionId),
    stop: () => stop(),
    reset: () => reset(),
    status: () => ({
      running: state.running,
      mode: currentMode(),
      state: state.phase,
      seen: state.seen,
      still: state.still,
      missing: state.missing,
      intervalMs: currentStrategy().interval,
      stopReason: state.stopReason,
      lastError: state.lastError,
      lastAnalysisAt: state.lastAnalysisAt,
      videoSeconds: ctx.get('camera')?.latest?.()?.videoSeconds ?? null,
      durationSec: ctx.get('camera')?.status?.()?.durationSec ?? null,
    }),
    releaseMode(mode) {
      if (state.requirement === null || state.requirement.mode !== mode) return false
      releaseRequirement(state.requirement.id)
      return true
    },
  }

  ctx.effect(() => {
    const unregister = ctx.get('observation-hub')?.register?.(handle)
    return () => { unregister?.() }
  }, 'observation: hub registration')
}
