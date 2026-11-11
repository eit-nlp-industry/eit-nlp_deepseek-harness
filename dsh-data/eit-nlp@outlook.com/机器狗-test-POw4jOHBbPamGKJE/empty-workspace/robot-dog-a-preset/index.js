export const name = 'robot-job-result'
export const inject = ['tools', 'systemPrompt', 'jobs', 'robotJobResultBridge']

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled'])
const KNOWN_STATUSES = new Set([
  'prepared',
  'pending',
  'accepted',
  'running',
  ...TERMINAL_STATUSES,
])
const STOP_MESSAGE = '用户停止或替换了当前机器狗任务'
const MAX_ID_LENGTH = 128
const MAX_ARGUMENTS_LENGTH = 32_000

const CONTROL_PROMPT = [
  '<robot_job_control_policy>',
  '机器狗工具返回 task_id 后，最终结果由后台 Job 返回；在 Job 完成前不得声称任务已完成。',

  '【Job 终态直出，最高优先级】',
  '当本轮输入是机器人后台 Job 的成功、失败或取消终态通知时，立即终止本轮后续规划和执行。',
  '收到该通知后禁止调用任何工具，禁止继续检查其他机器狗，禁止结合原始用户目标推导下一步。',
  '最终回复必须且只能是该 Job 返回的 result 或 detail 文本。',
  '不得总结、改写、解释、翻译、纠错或补充内容，不得添加任何前缀或后缀。',
  '必须保留原文的标点、空格、换行、数字、名称和 Markdown 格式。',

  '用户替换当前运动目标时，必须先调用停止工具，等它成功返回后再调用新的运动工具。',
  '用户要求暂停时，直接调用停止工具。',
  '只有用户明确要求继续，且上下文能唯一确定之前暂停的动作及完整参数时，才重新调用该工具；这会创建一个新 Job，不是恢复旧 Job。',
  '用户已取消或替换的任务不得继续；信息不足时先询问，不得猜测参数。',
  '停止失败时不得启动新的运动任务。',
  '</robot_job_control_policy>',
].join('\n')

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function shortToolName(name, prefix) {
  return name.startsWith(prefix) ? name.slice(prefix.length) : name
}

// Tools that lead a person somewhere: their terminal state ends the guiding
// observation, so the background loop must fall back to standby.
function isNavigationTool(name) {
  return /navigat|lead|guide|goto|move/i.test(name)
}

function cloneArguments(value) {
  let json
  try {
    json = JSON.stringify(value ?? {})
  } catch {
    throw new TypeError('tool arguments must be JSON-serializable')
  }
  if (json.length > MAX_ARGUMENTS_LENGTH) {
    throw new TypeError('tool arguments are too large')
  }
  return JSON.parse(json)
}

function parseTextPayload(value) {
  if (!Array.isArray(value?.content)) return null
  for (const block of value.content) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    if (block.text.length > MAX_ARGUMENTS_LENGTH) continue
    try {
      const parsed = JSON.parse(block.text)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed
      }
    } catch {
      // Ordinary text is not an asynchronous task result.
    }
  }
  return null
}

function taskCandidates(candidate) {
  if (candidate?.task && typeof candidate.task === 'object') {
    return [candidate.task]
  }
  if (Array.isArray(candidate?.tasks)) return candidate.tasks
  if (candidate?.tasks && typeof candidate.tasks === 'object') {
    return Object.entries(candidate.tasks).map(([taskId, task]) => ({
      ...task,
      task_id: task?.task_id ?? taskId,
    }))
  }
  return [candidate]
}

export function extractStartedTask(toolValue, callId) {
  if (toolValue === null || typeof toolValue !== 'object') return null
  const payload = toolValue.structuredContent
    ?? parseTextPayload(toolValue)
    ?? toolValue
  const candidate = payload?.task_update ?? payload

  for (const task of taskCandidates(candidate)) {
    if (task === null || typeof task !== 'object' || Array.isArray(task)) continue
    if (!KNOWN_STATUSES.has(task.status)) continue

    const taskId = task.invocation_id
      ?? task.task_id
      ?? task.socket_invocation_id
      ?? task.backend_invocation_id
      ?? callId
    if (typeof taskId !== 'string'
      || taskId.length === 0
      || taskId.length > MAX_ID_LENGTH) continue

    return { taskId, status: task.status }
  }
  return null
}

export function apply(ctx, config = {}) {
  const serverName = config.serverName ?? 'robot'
  const toolPrefix = `mcp__${serverName}__`
  const stopTools = new Set(config.stopTools ?? ['stop'])
  const noJobTools = new Set(config.noJobTools ?? [])
  const states = new WeakMap()
  const bridge = ctx.root?.get('robotJobResultBridge') ?? ctx.robotJobResultBridge

  if (!bridge) {
    throw new Error('robotJobResultBridge is unavailable in the root context')
  }

  // A finished navigation job ends the guiding observation; other job types
  // must not touch it.
  function releaseGuideObservation() {
    try {
      ctx.get('observation-hub')?.releaseMode?.('guide_follow')
    } catch {
      // Observation is optional for this preset.
    }
  }

  function stateFor(agent) {
    let state = states.get(agent)
    if (!state) {
      state = { current: null }
      states.set(agent, state)
    }
    return state
  }

  ctx.systemPrompt.section({
    name: 'robot-job-control',
    order: config.sectionOrder ?? 130,
    interpolate: false,
    text: CONTROL_PROMPT,
  })

  ctx.on('tools/result', (exec, result) => {
    const isRobotTool = typeof exec?.name === 'string'
      && exec.name.startsWith(toolPrefix)
    if (!exec?.agent || !isRobotTool) return

    try {
      const state = stateFor(exec.agent)
      const tool = shortToolName(exec.name, toolPrefix)

      // Sync tools already carry the final data in their own result: mirror
      // nothing, track no job, and touch no cancellation state.
      if (noJobTools.has(tool)) return

      if (stopTools.has(tool)) {
        if (!state.current) return
        if (result?.isError === true) return

        const stoppedTaskId = state.current.taskId
        const stoppedTool = state.current.tool
        bridge.accept({
          task_id: stoppedTaskId,
          status: 'cancelled',
          message: STOP_MESSAGE,
        })
        if (state.current?.taskId === stoppedTaskId) state.current = null
        if (isNavigationTool(stoppedTool)) releaseGuideObservation()
        return
      }

      if (result?.isError === true) return
      const started = extractStartedTask(result?.value, exec.callId)
      if (!started || TERMINAL_STATUSES.has(started.status) || bridge.has(started.taskId)) {
        return
      }
      if (typeof exec.agent.id !== 'string' || exec.agent.id.length === 0) {
        throw new TypeError('agent session id is required')
      }

      const completion = deferred()
      const argumentsCopy = cloneArguments(exec.arguments)
      const jobId = ctx.jobs.start({
        kind: 'robot',
        label: started.taskId,
        owner: exec.agent.id,
        outputLimitBytes: config.outputLimitBytes ?? 8_192,
        run() {
          return {
            done: completion.promise,
            cancel(reason) {
              bridge.stopTracking(started.taskId, reason)
            },
          }
        },
      })

      state.current = {
        taskId: started.taskId,
        jobId,
        tool,
        arguments: argumentsCopy,
      }

      bridge.register({
        taskId: started.taskId,
        jobId,
        onFinal() {
          if (state.current?.taskId === started.taskId) state.current = null
          if (isNavigationTool(tool)) releaseGuideObservation()
        },
        settle: completion.resolve,
      })
    } catch (error) {
      ctx.logger?.warn?.(
        `Ignored invalid robot job result: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })
}