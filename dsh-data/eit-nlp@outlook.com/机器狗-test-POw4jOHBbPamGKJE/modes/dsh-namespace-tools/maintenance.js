import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import { DEFAULT_URL, prepare, accept, publish, fetchRegistry } from './automation/workflow.js'
import { classify, ensure, selectTools } from './automation/core.js'
import { developerRoots, createProvenance } from './provenance.js'

export const name = 'namespace-maintenance'
export const inject = ['tools']

const reservedPresetTools = new Set(['load_namespace', 'namespace_maintenance', 'run_code'])

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

/**
 * 读取精确注册层的条目；layer 为 DSH 的 ToolLayer，不调用工具或条件回调。
 * alpha.2 的 NamedEntries 值为 { definition, when }，不是工具定义本身。
 */
function layerEntries(layer) {
  ensure(typeof layer?.tools?.entries === 'function', 'INVENTORY_UNSUPPORTED: 注册层不可读取')
  const entries = [...layer.tools.entries()]
  ensure(entries.every(entry => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string'),
    'INVENTORY_UNSUPPORTED: 注册条目格式不兼容')
  return new Map(entries)
}

/**
 * 复制纯 JSON 元数据，不读取 getter、不调用 toJSON；value 为名称、描述或 Schema 的数据节点。
 * 无损拒绝函数、undefined、稀疏数组及非普通对象，避免快照遗漏变化。
 */
function copyMetadata(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  ensure(value && typeof value === 'object' && !ancestors.has(value), 'PRESET_METADATA_INVALID: 元数据必须是无环纯 JSON')
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value)
  ensure(array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null,
    'PRESET_METADATA_INVALID: 元数据包含非普通对象')
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors)
  const next = new Set(ancestors).add(value), result = array ? [] : {}
  for (const key of keys) {
    if (array && key === 'length') continue
    const property = descriptors[key]
    ensure(typeof key === 'string' && property.enumerable && Object.hasOwn(property, 'value')
      && (!array || /^(0|[1-9][0-9]*)$/.test(key)), 'PRESET_METADATA_INVALID: 元数据包含访问器或非 JSON 属性')
    Object.defineProperty(result, key, { value: copyMetadata(property.value, next), enumerable: true, writable: true, configurable: true })
  }
  ensure(!array || keys.length - 1 === value.length, 'PRESET_METADATA_INVALID: 不支持稀疏数组')
  return result
}

/** 从 tool 的静态自有数据字段读取 key；fallback 用于缺少的可选描述，不触发 getter。 */
function metadataField(tool, key, fallback) {
  const property = Object.getOwnPropertyDescriptor(tool, key)
  ensure(property === undefined || Object.hasOwn(property, 'value'), 'PRESET_METADATA_INVALID: 工具元数据不能使用 getter')
  return property === undefined ? fallback : property.value
}

/**
 * 从维护工具所在的精确祖先层读取自定义工具，绕过展示隐藏但不解除任何限制。
 * @param ctx 维护插件宿主，用于读取注册层链。
 * @param agent 本轮调用 Agent，用来排除自身注册及更近作用域的同名覆盖。
 * @param definition 当前维护工具定义，以对象身份定位目标预设层。
 * @param base 实际配置，hiddenTools 中的工具保留原隐藏策略。
 * @param resolveOrigin 来源解析器，用注册 owner、实际调用模块和业务根判定来源。
 * @returns 工具元数据快照与目标层身份；不包含 execute、when 或其他可执行字段。
 */
function presetInventory(ctx, agent, definition, base, resolveOrigin) {
  const { manageableNames } = inventory(ctx, agent)
  ensure(typeof ctx.tools.layers.chainLayers === 'function', 'INVENTORY_UNSUPPORTED: 缺少作用域链接口')
  const layers = ctx.tools.layers.chainLayers(agent)
  ensure(Array.isArray(layers), 'INVENTORY_UNSUPPORTED: 作用域链格式不兼容')
  const entries = layers.map(layerEntries)
  const owners = entries.flatMap((entry, index) => entry.get(definition.name)?.definition === definition ? [index] : [])
  ensure(owners.length === 1 && layers[owners[0]] !== ctx.tools.layers.peek(agent),
    'PRESET_SCOPE_INVALID: 维护工具必须唯一注册在 Agent 的祖先预设层')
  const owner = owners[0], hidden = new Set(base.hiddenTools ?? [])
  const shadowed = new Set(entries.slice(owner + 1).flatMap(entry => [...entry.keys()]))
  const tools = [], sources = []
  for (const [runtimeName, registration] of entries[owner]) {
    if (runtimeName.startsWith('mcp__') || reservedPresetTools.has(runtimeName) || hidden.has(runtimeName)
      || shadowed.has(runtimeName) || !manageableNames.has(runtimeName)) continue
    const provenance = resolveOrigin(registration, runtimeName)
    sources.push(provenance)
    if (provenance.status !== 'custom') continue
    const tool = registration?.definition
    ensure(tool && typeof tool === 'object', 'INVENTORY_UNSUPPORTED: 注册条目缺少 definition')
    const description = metadataField(tool, 'description', '')
    ensure(metadataField(tool, 'name') === runtimeName && typeof description === 'string'
      && description.length <= 32768 && /^[A-Za-z0-9_.:-]+$/.test(runtimeName) && runtimeName.length <= 512,
    'PRESET_METADATA_INVALID: 自定义工具名称或描述不兼容')
    const input = metadataField(tool, 'parameters'), output = metadataField(tool, 'output')
    ensure(output && typeof output === 'object', 'PRESET_METADATA_INVALID: 缺少输出定义')
    const outputSchema = metadataField(output, 'schema')
    const schema = value => typeof value === 'boolean' || (value !== null && typeof value === 'object' && !Array.isArray(value))
    ensure(schema(input) && schema(outputSchema), 'PRESET_METADATA_INVALID: 自定义工具 Schema 不兼容')
    tools.push(copyMetadata({ tool_id: `preset:${runtimeName}`, source: 'preset', runtimeName, name: runtimeName,
      description, input_schema: input, output_schema: outputSchema, provenance }))
  }
  return { layer: layers[owner], tools: tools.sort((a, b) => a.tool_id.localeCompare(b.tool_id)),
    sources: sources.sort((a, b) => a.runtimeName.localeCompare(b.runtimeName)) }
}

/** 按部署配置在 ctx 安装维护工具，默认关闭；不读取模型提供的路径或 URL。 */
export function apply(ctx, config) {
  return createMaintenance(ctx, config)
}

/** 创建维护工具；options.fetchImpl 仅用于隔离测试的注册接口，不属于模型参数。 */
export function createMaintenance(ctx, config, options = {}) {
  ensure(!config || !Object.hasOwn(config, 'presetToolNames'),
    'PRESET_SOURCE_MIGRATION: 删除 presetToolNames，改用一次配置的 developerPluginRoots 并安装来源补丁')
  ensure(!config || (!Object.hasOwn(config, 'sourcePrefix') && !Object.hasOwn(config, 'runtimePrefix')),
    'MAPPING_CONFIG_MIGRATION: 删除 sourcePrefix/runtimePrefix；现正向核对 Harness 完整名称，需重新 prepare')
  ensure(config && typeof config === 'object' && !Array.isArray(config)
    && Object.keys(config).every(k => ['enabled', 'configPath', 'stateDir', 'registryUrl', 'developerPluginRoots'].includes(k))
    && (config.enabled === undefined || typeof config.enabled === 'boolean'), 'MAINTENANCE_CONFIG_INVALID')
  const roots = developerRoots(config.developerPluginRoots), resolveOrigin = createProvenance(roots)
  if (config.enabled !== true) return
  ensure(typeof config.configPath === 'string' && isAbsolute(config.configPath)
    && typeof config.stateDir === 'string' && isAbsolute(config.stateDir), 'MAINTENANCE_PATH_INVALID: 部署路径必须为绝对路径')
  const binding = { configPath: config.configPath, registryUrl: config.registryUrl ?? DEFAULT_URL,
    mappingMode: 'dsh-forward-name-v2+preset-provenance-v1', classificationMode: 'partial-v1',
    developerPluginRoots: roots, scopeToken: randomUUID() }
  const url = new URL(binding.registryUrl)
  ensure(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'SOURCE_URL_INVALID')
  /** 根据 tools 和 agent 当前全部注册/可纳管清单映射，先检测同名歧义再筛可纳管目标。 */
  function currentMapping(tools, agent) {
    const { knownNames, manageableNames } = inventory(ctx, agent)
    const mapped = mapTools(tools.filter(tool => tool.source !== 'preset'), knownNames, manageableNames)
    for (const tool of tools.filter(tool => tool.source === 'preset')) {
      ensure(manageableNames.has(tool.runtimeName), 'PRESET_SOURCE_CHANGED: 自定义工具已不可纳管')
      ensure(!Object.values(mapped.mapping).includes(tool.runtimeName), 'SOURCE_TARGET_COLLISION: 多个来源对应同一个工具')
      mapped.mapping[tool.tool_id] = tool.runtimeName
    }
    return mapped
  }
  let presetLayer
  /** 读取 agent 在 base 配置下的预设快照；同一维护实例不允许迁移注册层。 */
  function collectPreset(agent, base) {
    const snapshot = presetInventory(ctx, agent, definition, base, resolveOrigin)
    ensure(presetLayer === undefined || presetLayer === snapshot.layer, 'PRESET_SCOPE_CHANGED: 维护工具注册层已改变')
    presetLayer = snapshot.layer
    return { tools: snapshot.tools, sources: snapshot.sources }
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
    description: '按授权同步工具 namespace。先 prepare 读取 MCP 目录和当前预设来源已验证的业务工具注册定义并核对完整注册名，再 publish 提交覆盖本轮全部工具的分类。信息不足用 namespace:null，保留该工具原配置并发布其他项；全部待处理时只保存报告。配置发布后需 restart Harness 生效，不执行机器人动作。',
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
      ensure(ctx.tools.namespaceProvenanceVersion === 1,
        'PROVENANCE_COMPAT_REQUIRED: DSH tools 缺少已验证的注册来源补丁，不能假定预设来源已识别')
      inventory(ctx, exec.agent)
      // 合并宿主取消与抓取自身超时；只转发到固定注册目录的 GET，不发起业务请求。
      const fetchImpl = (target, init) => (options.fetchImpl ?? fetch)(target,
        { ...init, signal: exec.signal ? AbortSignal.any([init.signal, exec.signal]) : init.signal })
      const configPath = await realpath(binding.configPath)
      const actualBinding = { ...binding, configPath }
      if (args.action === 'prepare') {
        let presetSnapshot
        let prepared
        try {
          prepared = await prepare({ config: configPath, stateDir: config.stateDir, url: binding.registryUrl, fetchImpl,
            collectPresetTools: base => { presetSnapshot = collectPreset(exec.agent, base); return presetSnapshot.tools } })
        } catch (error) {
          // 有效空 MCP + 无已验证业务来源仍返回诊断，不创建可发布的空运行；网络/JSON 错误继续抛出。
          if (presetSnapshot && error.message.startsWith('SOURCE_EMPTY:')) return {
            ready: false, reason: 'NO_CLASSIFIABLE_TOOLS', selected: 0, tools: [], presetSources: presetSnapshot.sources,
            mapping: {}, unmatched: [], unsupportedRuntimeNames: [],
          }
          throw error
        }
        const task = await readJson(prepared.task)
        const mapping = currentMapping(task.tools, exec.agent)
        await writeOnce(join(prepared.run, 'maintenance.json'), { binding: actualBinding, mapping, presetSources: presetSnapshot.sources })
        return { runId: task.runId, selected: prepared.selected, excluded: prepared.excluded, ...mapping,
          tools: task.tools, presetSources: presetSnapshot.sources, existingNamespaces: task.existingNamespaces, previousAssignments: task.previousAssignments, eagerTools: task.eagerTools,
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
        const latest = selectTools(await fetchRegistry(binding.registryUrl, { fetchImpl }), { allowEmpty: true })
          .map(tool => ({ ...tool, source: 'mcp' }))
        ensure(isDeepStrictEqual(latest, task.tools.filter(tool => tool.source === 'mcp')), 'SOURCE_CHANGED: 符合筛选条件的工具信息已变化，请重新 prepare')
        const base = await readJson(configPath)
        const expectedPreset = { tools: task.tools.filter(tool => tool.source === 'preset'), sources: saved.presetSources }
        ensure(isDeepStrictEqual(collectPreset(exec.agent, base), expectedPreset),
          'PRESET_SOURCE_CHANGED: 预设工具元数据或注册作用域已变化，请重新 prepare')
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
          ensure(isDeepStrictEqual(collectPreset(exec.agent, base), expectedPreset),
            'PRESET_SOURCE_CHANGED: 发布前预设工具发生变化')
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
