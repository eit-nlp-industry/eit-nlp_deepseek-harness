import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import { DEFAULT_URL, prepare, accept, publish, fetchRegistry } from './automation/workflow.js'
import { classify, ensure, selectTools } from './automation/core.js'

export const name = 'namespace-maintenance'
export const inject = ['tools']

/**
 * 正向生成 DSH 的完整 MCP 名，不从规范化名称逆猜；哈希保留原始名称字节。
 * @param server 原始 MCP 服务名。
 * @param raw 上游原始工具名（或旧接入的兼容末级原名）。
 * 使用 JS 字符串长度/截断，与 Harness tools.ts 的 64 字符和 12 位哈希规则一致。
 */
export function dshToolName(server, raw) {
  const joined = `mcp__${server}__${raw}`, normalized = joined.replace(/[^A-Za-z0-9_-]/g, '_')
  if (normalized === joined && joined.length <= 64) return joined
  const suffix = createHash('sha256').update(server + '\0' + raw).digest('hex').slice(0, 12)
  return normalized.slice(0, 51) + '_' + suffix
}

/**
 * 生成完整网站 ID 和兼容末级名的 DSH 候选，再与实际注册名精确核对，不 strip 哈希。
 * @param tools 本轮 eligible 记录；不同源必须最终指向不同目标。
 * @param knownNames 当前作用域全部注册名，先检测所有服务及 raw/leaf 候选歧义。
 * @param manageableNames 可由 namespace 限制的祖先注册名，排除 own-shadow；默认供纯逻辑调用。
 */
export function mapTools(tools, knownNames, manageableNames = knownNames) {
  const servers = new Set(), unsupportedRuntimeNames = []
  for (const name of [...knownNames].sort()) {
    if (!name.startsWith('mcp__')) continue
    const parts = name.split('__')
    if (parts.length !== 3 || !parts.slice(1).every(part => /^[A-Za-z0-9_-]+$/.test(part)) || name.length > 64) {
      unsupportedRuntimeNames.push(name)
      continue
    }
    servers.add(parts[1])
  }
  const matched = [], unmatched = [], owners = new Map()
  for (const tool of tools) {
    const id = tool.tool_id, leaf = id.slice(id.lastIndexOf('.') + 1), candidates = new Set()
    for (const raw of new Set([id, leaf].filter(Boolean))) {
      for (const server of servers) {
        const candidate = dshToolName(server, raw)
        if (knownNames.has(candidate)) candidates.add(candidate)
      }
    }
    const targets = [...candidates].sort()
    const record = { tool_id: id, toolName: leaf, candidates: targets }
    if (targets.length > 1) unmatched.push({ ...record, reason: 'RUNTIME_NAME_AMBIGUOUS' })
    else if (targets.length === 0) unmatched.push({ ...record, reason: 'NOT_REGISTERED' })
    else if (!manageableNames.has(targets[0])) unmatched.push({ ...record, reason: 'NOT_MANAGEABLE' })
    else {
      matched.push(record)
      owners.set(targets[0], [...(owners.get(targets[0]) ?? []), id])
    }
  }
  const mapping = []
  for (const record of matched) {
    const target = record.candidates[0], sourceIds = owners.get(target)
    if (sourceIds.length > 1) unmatched.push({ ...record, reason: 'SOURCE_TARGET_COLLISION', conflictingToolIds: sourceIds })
    else mapping.push([record.tool_id, target])
  }
  return { ready: unmatched.length === 0 && unsupportedRuntimeNames.length === 0,
    mapping: Object.fromEntries(mapping), unmatched, unsupportedRuntimeNames }
}

/** 读取 alpha.2 内部视图和 agent 自身注册；ctx 的兼容 API 不完整时停止，不改限制或执行工具。 */
function inventory(ctx, agent) {
  ensure(typeof ctx.tools.view === 'function' && typeof ctx.tools.layers?.peek === 'function',
    'INVENTORY_UNSUPPORTED: 宿主缺少已验证的工具清单接口')
  const view = ctx.tools.view(agent), names = view?.knownNames, restrictable = view?.restrictableNames
  ensure(names instanceof Set && restrictable instanceof Set && [...names, ...restrictable].every(n => typeof n === 'string'),
    'INVENTORY_UNSUPPORTED: 注册名清单格式不兼容')
  const own = ctx.tools.layers.peek(agent)
  ensure(own === undefined || typeof own?.tools?.entries === 'function',
    'INVENTORY_UNSUPPORTED: Agent 自身注册层格式不兼容')
  // alpha.2 的 tools 是 NamedEntries 而非 Map；只使用只读 entries 接口并检查其条目形状。
  const entries = own === undefined ? [] : own.tools.entries()
  ensure(entries && typeof entries[Symbol.iterator] === 'function', 'INVENTORY_UNSUPPORTED: 自身注册条目不可迭代')
  const registrations = [...entries]
  ensure(registrations.every(entry => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string'),
    'INVENTORY_UNSUPPORTED: 自身注册名称格式不兼容')
  const ownNames = new Set(registrations.map(([toolName]) => toolName))
  // 同名 own shadow 也会出现在 restrictableNames 中，必须查实际 own 层排除，避免错误纳管。
  return { knownNames: names, manageableNames: new Set([...names].filter(n => restrictable.has(n) && !ownNames.has(n))) }
}

/** 按部署配置在 ctx 安装维护工具，默认关闭；不读取模型提供的路径或 URL。 */
export function apply(ctx, config) {
  return createMaintenance(ctx, config)
}

/** 创建维护工具；options.fetchImpl 仅用于隔离测试的注册接口，不属于模型参数。 */
export function createMaintenance(ctx, config, options = {}) {
  ensure(!config || (!Object.hasOwn(config, 'sourcePrefix') && !Object.hasOwn(config, 'runtimePrefix')),
    'MAPPING_CONFIG_MIGRATION: 删除 sourcePrefix/runtimePrefix；现正向核对 Harness 完整名称，需重新 prepare')
  ensure(config && typeof config === 'object' && !Array.isArray(config)
    && Object.keys(config).every(k => ['enabled', 'configPath', 'stateDir', 'registryUrl'].includes(k))
    && (config.enabled === undefined || typeof config.enabled === 'boolean'), 'MAINTENANCE_CONFIG_INVALID')
  if (config.enabled !== true) return
  ensure(typeof config.configPath === 'string' && isAbsolute(config.configPath)
    && typeof config.stateDir === 'string' && isAbsolute(config.stateDir), 'MAINTENANCE_PATH_INVALID: 部署路径必须为绝对路径')
  const binding = { configPath: config.configPath, registryUrl: config.registryUrl ?? DEFAULT_URL,
    mappingMode: 'dsh-forward-name-v2', classificationMode: 'partial-v1' }
  const url = new URL(binding.registryUrl)
  ensure(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'SOURCE_URL_INVALID')
  /** 根据 tools 和 agent 当前全部注册/可纳管清单映射，先检测同名歧义再筛可纳管目标。 */
  function currentMapping(tools, agent) {
    const { knownNames, manageableNames } = inventory(ctx, agent)
    return mapTools(tools, knownNames, manageableNames)
  }
  /** 将 path 中的内部 JSON 读回；路径只能由工具自身构造。 */
  const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
  /** 以独占方式保存 path/value；相同内容可重试，不同决策不能覆盖已有运行产物。 */
  async function writeOnce(path, value) {
    const text = JSON.stringify(value, null, 2) + '\n'
    try { await writeFile(path, text, { flag: 'wx', mode: 0o600 }) }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      ensure(await readFile(path, 'utf8') === text, 'RUN_INPUT_CONFLICT: 本轮已有不同输入，请重新 prepare')
    }
  }
  const definition = {
    name: 'namespace_maintenance',
    description: '按授权同步工具 namespace。先 prepare 读取目录并核对 Harness 完整工具名，再 publish 提交覆盖本轮全部工具的分类。信息不足用 namespace:null，保留该工具原配置并发布其他项；全部待处理时只保存报告。配置发布后需 restart Harness 生效，不执行机器人动作。',
    parameters: { type: 'object', additionalProperties: false, required: ['action'], properties: {
      action: { type: 'string', enum: ['prepare', 'publish'] },
      runId: { type: 'string', description: 'publish 必须使用 prepare 返回的原始 runId。' },
      decision: { type: 'object', additionalProperties: false, required: ['namespaces', 'assignments'], properties: {
        namespaces: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'description'],
          properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' } } } },
        assignments: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['tool_id', 'namespace', 'reason'],
          properties: { tool_id: { type: 'string' }, namespace: { type: ['string', 'null'] }, reason: { type: 'string' } } } },
      } },
    } },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    /** 处理 args.action；exec.agent 必须属于安装作用域，exec.signal 取消时停止后续步骤。 */
    async execute(args, exec) {
      ensure(exec?.agent && ctx.tools.get(definition.name, exec.agent) === definition, 'MAINTENANCE_SCOPE_INVALID')
      ensure(args && typeof args === 'object' && !Array.isArray(args)
        && (args.action === 'prepare' ? Object.keys(args).length === 1
          : args.action === 'publish' && Object.keys(args).length === 3 && Object.hasOwn(args, 'runId') && Object.hasOwn(args, 'decision')),
      'MAINTENANCE_ARGUMENT_INVALID: 仅接受 prepare 或 publish(runId, decision)')
      exec.signal?.throwIfAborted()
      inventory(ctx, exec.agent)
      // 合并宿主取消与抓取自身超时；只转发到固定注册目录的 GET，不发起业务请求。
      const fetchImpl = (target, init) => (options.fetchImpl ?? fetch)(target,
        { ...init, signal: exec.signal ? AbortSignal.any([init.signal, exec.signal]) : init.signal })
      const configPath = await realpath(binding.configPath)
      const actualBinding = { ...binding, configPath }
      if (args.action === 'prepare') {
        const prepared = await prepare({ config: configPath, stateDir: config.stateDir, url: binding.registryUrl, fetchImpl })
        const task = await readJson(prepared.task)
        const mapping = currentMapping(task.tools, exec.agent)
        await writeOnce(join(prepared.run, 'maintenance.json'), { binding: actualBinding, mapping })
        return { runId: task.runId, selected: prepared.selected, excluded: prepared.excluded, ...mapping,
          tools: task.tools, existingNamespaces: task.existingNamespaces, previousAssignments: task.previousAssignments, eagerTools: task.eagerTools,
          instructions: task.instructions, outputShape: task.outputShape }
      }
      ensure(typeof args.runId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(args.runId), 'RUN_INVALID')
      const state = await realpath(config.stateDir), run = join(state, 'runs', args.runId)
      ensure(await realpath(run) === run, 'RUN_INVALID: 运行目录不能指向其他目录')
      const lock = join(state, '.maintenance-lock')
      try { await mkdir(lock) }
      catch (error) { if (error.code === 'EEXIST') throw new Error('MAINTENANCE_LOCKED: 另一维护发布正在运行'); throw error }
      try {
        const task = await readJson(join(run, 'task.json')), saved = await readJson(join(run, 'maintenance.json'))
        ensure(task.version === 1 && task.runId === args.runId && task.configPath === configPath
          && task.sourceUrl === binding.registryUrl && JSON.stringify(saved.binding) === JSON.stringify(actualBinding), 'RUN_BINDING_CONFLICT')
        const age = Date.now() - Date.parse(task.preparedAt)
        ensure(Number.isFinite(age) && age >= -60000 && age <= 86400000, 'RUN_EXPIRED: 请重新 prepare')
        const latest = selectTools(await fetchRegistry(binding.registryUrl, { fetchImpl }))
        ensure(isDeepStrictEqual(latest, task.tools), 'SOURCE_CHANGED: 符合筛选条件的工具信息已变化，请重新 prepare')
        const mapping = currentMapping(task.tools, exec.agent)
        ensure(mapping.ready && saved.mapping.ready, 'MAPPING_INCOMPLETE: 有工具尚未确认运行名，请重新 prepare')
        ensure(JSON.stringify(mapping.mapping) === JSON.stringify(saved.mapping.mapping), 'MAPPING_CHANGED')
        // 先完整校验，避免一份可修正的非法模型响应占住本轮不可变 decision 文件。
        classify(task.tools, task.existingNamespaces, args.decision)
        exec.signal?.throwIfAborted()
        const assignments = join(run, 'maintenance-decision.json'), toolMap = join(run, 'maintenance-map.json')
        await writeOnce(assignments, args.decision)
        await writeOnce(toolMap, mapping.mapping)
        const accepted = await accept({ run, assignments })
        /** 在发布锁内尽量靠近替换点复查作用域注册和取消状态；不会解除限制。 */
        const beforeWrite = () => {
          exec.signal?.throwIfAborted()
          ensure(ctx.tools.get(definition.name, exec.agent) === definition, 'MAINTENANCE_SCOPE_INVALID')
          const current = currentMapping(task.tools, exec.agent)
          ensure(current.ready && isDeepStrictEqual(current.mapping, mapping.mapping), 'MAPPING_CHANGED: 发布前注册清单发生变化')
        }
        const result = await publish({ catalog: accepted.catalog, config: configPath, toolMap, expectedRunId: args.runId, beforeWrite })
        return { ...result, runId: args.runId, restartRequired: result.published, report: accepted }
      } finally { await rm(lock, { recursive: true }) }
    },
  }
  ctx.tools.register(definition)
  return definition
}
