// Host-owned event-site inspection state machine for robot-dog-v03.
//
// Skill/Harness only submit structured observations; this plugin validates
// transitions, stores evidence, gates chat events, and builds render_ui args.

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseObservation } from './inspection-schema.js'
import { createInspectionStore } from './inspection-store.js'

export const name = 'inspection-task'
export const inject = ['tools']

const DEFAULT_CONFIG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  './campus-open-day.json',
)

const DEFAULT_STORE_DIR = '/data/dsh/eit-nlp@outlook.com/机器狗-test-POw4jOHBbPamGKJE/runtime_data/robot-dog-v03/inspection'

/** @type {Map<string, object>} */
const liveBySession = new Map()

function nowIso() {
  return new Date().toISOString()
}

function newStreamId(prefix = 'stream') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * @param {object} template
 * @param {string} sessionId
 */
function createTaskFromTemplate(template, sessionId) {
  const taskId = `insp-${randomUUID().slice(0, 8)}`
  const checkpoints = (template.checkpoints ?? []).map((item, index) => ({
    id: item.id,
    name: item.name,
    passCriteria: item.passCriteria,
    requiredItems: Array.isArray(item.requiredItems) ? item.requiredItems : [],
    requiredReadableText: Array.isArray(item.requiredReadableText) ? item.requiredReadableText : [],
    forbiddenItems: Array.isArray(item.forbiddenItems) ? item.forbiddenItems : [],
    viewScope: typeof item.viewScope === 'string' ? item.viewScope : '',
    evidenceKindHint: typeof item.evidenceKindHint === 'string' ? item.evidenceKindHint : '',
    moveHint: typeof item.moveHint === 'string' && item.moveHint.trim()
      ? item.moveHint.trim()
      : (typeof item.name === 'string' ? `${item.name}前` : ''),
    demoClip: typeof item.demoClip === 'string' ? item.demoClip : '',
    recheckClip: typeof item.recheckClip === 'string' ? item.recheckClip : '',
    status: index === 0 ? 'checking' : 'pending',
    issue: null,
    uncertainCount: 0,
    initialEvidence: null,
    recheckEvidence: null,
    lastObservationKey: null,
    updatedAt: nowIso(),
  }))
  return {
    taskId,
    sessionId,
    templateId: template.taskTemplateId ?? 'campus-open-day',
    activityName: template.activityName ?? '活动检查',
    location: template.location ?? '',
    title: template.title ?? '开场准备检查',
    venueName: typeof template.venueName === 'string' && template.venueName.trim()
      ? template.venueName.trim()
      : (typeof template.venueQuery === 'string' && template.venueQuery.trim()
        ? template.venueQuery.trim()
        : '图书馆'),
    venueQuery: typeof template.venueQuery === 'string' && template.venueQuery.trim()
      ? template.venueQuery.trim()
      : (typeof template.venueName === 'string' && template.venueName.trim()
        ? template.venueName.trim()
        : '图书馆'),
    simulatedSite: template.simulatedSite !== false,
    uncertainLimit: Number.isFinite(template.uncertainLimit) ? template.uncertainLimit : 5,
    demoClips: Array.isArray(template.demoClips) ? template.demoClips : [],
    notes: typeof template.notes === 'string' ? template.notes : '',
    checkpoints,
    currentCheckpointId: checkpoints[0]?.id ?? null,
    inspectionRound: 1,
    streamId: newStreamId('clip'),
    phase: 'initial',
    eventsNotified: {
      unclear: {},
      met: {},
      issue: {},
      initialSummary: false,
      remediationAck: false,
      recheckResult: false,
      report: false,
    },
    remediationNote: null,
    remediationScope: null,
    report: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
}

function checkpointOf(task, checkpointId) {
  return task.checkpoints.find(item => item.id === checkpointId) ?? null
}

function counts(task) {
  const total = task.checkpoints.length
  let met = 0
  let needsFix = 0
  let uncertain = 0
  let checked = 0
  for (const item of task.checkpoints) {
    if (item.status === 'pending') continue
    checked += 1
    if (item.status === 'met') met += 1
    else if (item.status === 'needs_fix' || item.status === 'remediating' || item.status === 'recheck_pending') needsFix += 1
    else if (item.status === 'uncertain') uncertain += 1
  }
  return { total, checked, met, needsFix, uncertain }
}

function observationKey(observation) {
  return [
    observation.checkpoint_id,
    observation.inspection_round,
    observation.verdict,
    observation.reason,
    (observation.observations ?? []).join('|'),
  ].join('::')
}

function nextPendingCheckpoint(task) {
  return task.checkpoints.find(item => item.status === 'pending' || item.status === 'checking' || item.status === 'uncertain')
    ?? null
}

function allInitialSettled(task) {
  return task.checkpoints.every(item => (
    item.status === 'met'
    || item.status === 'needs_fix'
    || item.status === 'remediating'
    || item.status === 'recheck_pending'
    || (item.status === 'uncertain' && item.uncertainCount >= task.uncertainLimit)
  ))
}

function openIssues(task) {
  return task.checkpoints.filter(item => (
    item.status === 'needs_fix'
    || item.status === 'remediating'
    || item.status === 'recheck_pending'
    || item.status === 'rechecking'
    || (item.status === 'uncertain' && item.uncertainCount >= task.uncertainLimit)
  ))
}

/**
 * render_ui /api/media only accepts catalog short ids (file stem), not absolute
 * paths. Models sometimes paste annotate_target path into evidence_asset_id.
 */
function normalizeEvidenceAssetId(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text === '') return ''
  // Already a short catalog id.
  if (!text.includes('/') && !text.includes('\\') && !text.includes('.')) return text
  const base = text.split(/[/\\]/).pop() || text
  return base.replace(/\.[^.]+$/, '')
}

function mediaSrc(assetId) {
  const id = normalizeEvidenceAssetId(assetId)
  if (!id) return null
  // Prefer assetId so json-render resolves through the media catalog.
  return { assetId: id, src: `/api/media/${id}/content`, alt: id }
}

function resolveSessionId(args, exec) {
  const fromArgs = typeof args?.session_id === 'string' ? args.session_id.trim() : ''
  if (fromArgs) return fromArgs
  const fromExec = String(
    exec?.sessionId
    ?? exec?.session?.id
    ?? exec?.agent?.id
    ?? '',
  ).trim()
  return fromExec
}

function currentMoveHint(task, checkpoint = null) {
  const item = checkpoint ?? checkpointOf(task, task.currentCheckpointId)
  if (!item) return ''
  if (typeof item.moveHint === 'string' && item.moveHint.trim()) return item.moveHint.trim()
  return item.name ? `${item.name}前` : ''
}

function observationContext(task) {
  const current = checkpointOf(task, task.currentCheckpointId)
  const moveHint = currentMoveHint(task, current)
  return {
    taskId: task.taskId,
    checkpointId: task.currentCheckpointId,
    checkpointName: current?.name ?? '',
    inspectionRound: task.inspectionRound,
    streamId: task.streamId,
    phase: task.phase,
    venueName: task.venueName ?? '',
    venueQuery: task.venueQuery ?? '',
    moveHint,
    passCriteria: current?.passCriteria ?? '',
    viewScope: current?.viewScope ?? '',
    requiredItems: current?.requiredItems ?? [],
    requiredReadableText: current?.requiredReadableText ?? [],
    forbiddenItems: current?.forbiddenItems ?? [],
    evidenceKindHint: current?.evidenceKindHint ?? '',
    operatorHint: operatorHint(task),
  }
}

/**
 * User-safe next-step text. Prefer move_to hints; never mention video filenames.
 */
function operatorHint(task) {
  if (task.phase === 'awaiting_remediation') {
    return '待处理事项已登记，请确认现场整改后再复核。'
  }
  if (task.phase === 'rechecking' || task.phase === 'recheck_pending') {
    const current = checkpointOf(task, task.currentCheckpointId)
    const hint = currentMoveHint(task, current)
    const open = openIssues(task).map(item => item.name).join('、')
    if (hint) return `正在复核「${current?.name || open || '待复核项'}」：请先 move_to 到「${hint}」，到位后再观察。`
    return `正在复核：${current?.name || open || '待复核项'}。请先移动到该点再观察。`
  }
  if (task.phase === 'report_ready' || task.phase === 'completed') {
    return '可生成最终检查报告。'
  }
  const current = checkpointOf(task, task.currentCheckpointId)
  if (!current) {
    const venue = task.venueQuery || task.venueName || '会场'
    return `检查任务已就绪。若尚未到会场，请先语义地图检索「${venue}」并 navigate 到达后再检查。`
  }
  const hint = currentMoveHint(task, current)
  return `当前检查「${current.name}」：请先 move_to 到「${hint || current.name}」，到位后再根据现场画面判定。`
}

/**
 * Work-order form matching the demo card:
 * title → hint → 地点 → 待处理事项 1/2/…（每项一栏）→ 证据 Tabs（一项一图）→ 处理人/整改说明。
 */
function buildWorkOrderArgs(task) {
  const issues = openIssues(task)
  const numbered = issues.map((item, index) => {
    const no = index + 1
    const reason = item.issue?.reason || item.status
    const assetId = normalizeEvidenceAssetId(
      item.initialEvidence?.assetId || item.recheckEvidence?.assetId || '',
    )
    const fieldLabel = `待处理事项 ${no}`
    const fieldValue = `${item.name}：${reason}`
    return {
      no,
      id: item.id,
      name: item.name,
      reason,
      fieldLabel,
      fieldValue,
      fieldName: `issue_${no}`,
      tabTitle: fieldLabel,
      assetId,
    }
  })

  const issueFields = numbered.map(item => ({
    name: item.fieldName,
    label: item.fieldLabel,
    type: 'text',
    value: item.fieldValue,
  }))

  const evidenceImages = numbered
    .filter(item => item.assetId)
    .map(item => ({
      assetId: item.assetId,
      src: `/api/media/${item.assetId}/content`,
      alt: `${item.fieldLabel}·${item.name}现场证据`,
      title: item.tabTitle,
      caption: item.fieldValue,
    }))

  const items = numbered.map(item => ({
    title: item.tabTitle,
    content: item.fieldValue,
    ...(item.assetId ? { image: mediaSrc(item.assetId) } : {}),
  }))

  const hasImages = evidenceImages.length > 0
  const hint = '请补全处理人与整改说明后确认整改'
  const fields = [
    { name: 'location', label: '地点', type: 'text', value: task.location },
    ...issueFields,
    // Prefill so empty required checks do not block form.submit.
    { name: 'handler', label: '处理人', type: 'text', value: '小陈' },
    { name: 'note', label: '整改说明', type: 'text', value: '上述待处理事项均已完成整改，请开始复核。' },
  ]

  return {
    mode: 'form',
    answer_presentation: 'replace',
    intent: 'rich_content',
    locale: 'zh-CN',
    scene: 'dog',
    components: hasImages ? ['Tabs', 'Image'] : ['Card'],
    business_data: {
      title: `${task.activityName} · 待处理事项`,
      location: task.location,
      content: hint,
      hint,
      images: evidenceImages,
      items,
      submitLabel: '确认已整改',
      fields,
    },
    user_query: hasImages
      ? [
        '用 Card 展示：标题用 title；标题下用 content/hint 写一句「请补全处理人与整改说明后确认整改」。',
        '中间放 Tabs：items/images 每一项一个 Tab，Tab 标题必须是「待处理事项 1」「待处理事项 2」这种标号；',
        '每个 Tab 内先写该条 content（如「签到台：…」），再放一张 Image。',
        'Image 优先用该条 image.assetId（短 id，不要用磁盘绝对路径）；若只有 src 则用 image.src 字符串。',
        '一项一图，不要合并，不要改写 assetId。',
        '下面 DynamicForm 按 fields 原样渲染：地点、待处理事项 1、待处理事项 2…、处理人、整改说明；',
        '待处理事项各栏只展示预填内容、不要改写标号或合并成一栏；提交按钮写「确认已整改」。',
      ].join('')
      : [
        '用 Card 展示：标题用 title；标题下用 content/hint 写一句「请补全处理人与整改说明后确认整改」。',
        'DynamicForm 按 fields 原样渲染：地点、待处理事项 1、待处理事项 2…、处理人、整改说明；',
        '每一项待处理事项单独一栏并保留标号，不要合并；提交按钮写「确认已整改」。',
      ].join(''),
  }
}

function uiArgsForTask(task) {
  if (task.phase === 'awaiting_remediation' && openIssues(task).length > 0) {
    return buildWorkOrderArgs(task)
  }
  return buildCardArgs(task)
}

function buildCardArgs(task) {
  const summary = counts(task)
  const rows = task.checkpoints.map(item => {
    const evidence = normalizeEvidenceAssetId(
      item.recheckEvidence?.assetId || item.initialEvidence?.assetId || '',
    )
    const result = item.issue?.reason
      || (item.status === 'met' ? '已满足' : item.status === 'uncertain' ? '无法确认' : item.status)
    return {
      name: item.name,
      status: item.status,
      criteria: item.passCriteria,
      result,
      evidenceAssetId: evidence,
    }
  })
  const lines = rows.map(row => {
    const mark = row.status === 'met' ? '✓' : (row.status === 'needs_fix' || row.status === 'remediating' || row.status === 'recheck_pending' ? '!' : '·')
    return `${mark} ${row.name}${row.result && row.status !== 'met' ? `：${row.result}` : ''}`
  })
  const title = `${task.activityName} · ${task.title}`
  const body = [
    `地点：${task.location}`,
    `轮次：${task.inspectionRound === 1 ? '初检' : `复核 #${task.inspectionRound}`}`,
    `已检查 ${summary.checked}/${summary.total} 项`,
    `已满足 ${summary.met} 项 · 待整改 ${summary.needsFix} 项 · 无法确认 ${summary.uncertain} 项`,
    '',
    ...lines,
    '',
    operatorHint(task),
    task.simulatedSite ? '（视频模拟现场，非真实活动）' : '',
  ].filter(Boolean).join('\n')

  const images = []
  for (const row of rows) {
    if (!row.evidenceAssetId) continue
    images.push({
      title: row.name,
      content: row.result || row.criteria,
      image: mediaSrc(row.evidenceAssetId),
    })
  }

  const businessData = {
    title,
    content: body,
    items: images.length > 0
      ? images
      : rows.map(row => ({ title: row.name, content: `${row.status}\n${row.criteria}\n${row.result || ''}` })),
  }

  return {
    mode: 'display',
    answer_presentation: 'replace',
    intent: 'rich_content',
    locale: 'zh-CN',
    scene: 'dog',
    components: images.length > 0 ? ['Tabs', 'Image'] : ['Card'],
    business_data: businessData,
    user_query: images.length > 0
      ? '用 Tabs 展示检查项；有证据图的项显示 Image。标题与正文取 items 的 title/content/image。'
      : '用一张 Card 展示 title 与 content，不要额外组件。',
  }
}

function reportStatusLabel(item) {
  if (item.status === 'met') {
    const hadIssue = Boolean(item.initialEvidence?.verdict === 'not_met' || item.recheckEvidence)
    return hadIssue ? '已整改通过' : '通过'
  }
  if (item.status === 'uncertain') return '无法确认'
  if (item.status === 'needs_fix' || item.status === 'remediating' || item.status === 'recheck_pending' || item.status === 'rechecking') {
    return '待整改'
  }
  return item.status
}

function reportItemDetail(item, index) {
  const label = reportStatusLabel(item)
  const initialReason = item.initialEvidence?.reason
    || (item.initialEvidence?.verdict === 'met' ? '符合检查标准。' : '')
  const recheckReason = item.recheckEvidence?.reason
    || (item.status === 'met' && item.recheckEvidence ? '复核已满足检查标准。' : '')
  const lines = [`${index + 1}. ${item.name}·${label}`]
  if (initialReason) lines.push(`初检：${initialReason}`)
  else if (item.status === 'met' && !item.recheckEvidence) lines.push('初检：通过。')
  if (recheckReason) lines.push(`复核：${recheckReason}`)
  else if (item.status === 'met' && item.initialEvidence?.verdict === 'not_met') {
    lines.push('复核：已通过。')
  }
  if (item.status !== 'met' && item.issue?.reason) {
    lines.push(`现状：${item.issue.reason}`)
  }
  return lines.join('\n')
}

/** Concise final report card: summary + one tab per checkpoint. */
function buildReportArgs(task) {
  const summary = counts(task)
  const initialIssueCount = task.checkpoints.filter(item => (
    item.initialEvidence?.verdict === 'not_met'
  )).length
  const unresolved = openIssues(task)
  const allPassed = summary.met === summary.total && unresolved.length === 0
  const headline = allPassed
    ? `整体结果：${summary.met}/${summary.total} 项通过，待整改 0 项，无法确认 ${summary.uncertain} 项。${
      initialIssueCount > 0
        ? `初检发现 ${initialIssueCount} 项问题，整改后第 ${Math.max(1, task.inspectionRound)} 轮复核全部通过。`
        : '初检全部通过。'
    }`
    : `整体结果：已通过 ${summary.met}/${summary.total} 项，待整改 ${summary.needsFix} 项，无法确认 ${summary.uncertain} 项。`

  const items = task.checkpoints.map((item, index) => {
    const label = reportStatusLabel(item)
    const evidenceAssetId = normalizeEvidenceAssetId(
      item.recheckEvidence?.assetId || item.initialEvidence?.assetId || '',
    )
    return {
      title: `${item.name}·${label}`,
      content: reportItemDetail(item, index),
      ...(evidenceAssetId ? { image: mediaSrc(evidenceAssetId) } : {}),
    }
  })
  const hasImages = items.some(item => item.image)

  return {
    mode: 'display',
    answer_presentation: 'replace',
    intent: 'rich_content',
    locale: 'zh-CN',
    scene: 'dog',
    components: hasImages ? ['Tabs', 'Image'] : ['Tabs'],
    business_data: {
      title: `${task.activityName}·${task.title}报告`,
      content: headline,
      items,
    },
    user_query: [
      '生成一张简洁报告卡片：',
      '顶部用 title；其下用 content 作为一行整体结果摘要，不要长篇 Markdown。',
      '再用 Tabs：items 每一项一个 Tab，Tab 标题用 title（如「签到台·已整改通过」）；',
      'Tab 内正文用 content（含「初检：…」「复核：…」短句）；若有 image 则在正文下显示一张 Image。',
      '不要额外章节、不要证据 URL 列表、不要重复汇总表格。',
    ].join(''),
  }
}

function publicTask(task) {
  const summary = counts(task)
  const current = checkpointOf(task, task.currentCheckpointId)
  return {
    taskId: task.taskId,
    activityName: task.activityName,
    location: task.location,
    title: task.title,
    venueName: task.venueName ?? '',
    venueQuery: task.venueQuery ?? '',
    phase: task.phase,
    inspectionRound: task.inspectionRound,
    streamId: task.streamId,
    currentCheckpointId: task.currentCheckpointId,
    currentCheckpoint: current,
    currentMoveHint: currentMoveHint(task, current),
    config: {
      activityName: task.activityName,
      location: task.location,
      title: task.title,
      venueName: task.venueName ?? '',
      venueQuery: task.venueQuery ?? '',
      simulatedSite: task.simulatedSite,
      uncertainLimit: task.uncertainLimit,
      notes: task.notes,
      checkpoints: task.checkpoints.map(item => ({
        id: item.id,
        name: item.name,
        passCriteria: item.passCriteria,
        requiredItems: item.requiredItems,
        requiredReadableText: item.requiredReadableText,
        forbiddenItems: item.forbiddenItems,
        viewScope: item.viewScope,
        evidenceKindHint: item.evidenceKindHint,
        moveHint: item.moveHint || '',
        status: item.status,
      })),
    },
    observationContext: observationContext(task),
    summary,
    checkpoints: task.checkpoints,
    operatorHint: operatorHint(task),
    simulatedSite: task.simulatedSite,
    remediationNote: task.remediationNote,
    remediationScope: task.remediationScope,
  }
}

/**
 * @param {import('cordis').Context} ctx
 * @param {Record<string, unknown>} config
 */
export function apply(ctx, config = {}) {
  const configPath = typeof config.configPath === 'string' && config.configPath.length > 0
    ? config.configPath
    : DEFAULT_CONFIG_PATH
  const storeDir = typeof config.storeDir === 'string' && config.storeDir.length > 0
    ? config.storeDir
    : DEFAULT_STORE_DIR
  const store = createInspectionStore(storeDir)

  /** @type {object | null} */
  let templateCache = null

  async function loadTemplate() {
    if (templateCache) return templateCache
    const text = await readFile(configPath, 'utf8')
    templateCache = JSON.parse(text)
    return templateCache
  }

  async function persist(task) {
    task.updatedAt = nowIso()
    liveBySession.set(task.sessionId, task)
    await store.save(task)
    await store.bindSession(task.sessionId, task.taskId)
    ctx.root.emit?.('inspection/updated', {
      sessionId: task.sessionId,
      taskId: task.taskId,
      streamId: task.streamId,
      currentCheckpointId: task.currentCheckpointId,
      inspectionRound: task.inspectionRound,
    })
    const hub = ctx.root.get?.('inspection-hub')
    hub?.publish?.(task)
  }

  async function resolveTask(sessionId, taskId) {
    if (taskId) {
      const fromDisk = await store.load(taskId)
      if (fromDisk) {
        liveBySession.set(fromDisk.sessionId, fromDisk)
        return fromDisk
      }
    }
    if (sessionId && liveBySession.has(sessionId)) return liveBySession.get(sessionId)
    if (sessionId) {
      const pointer = await store.loadSessionPointer(sessionId)
      if (pointer?.taskId) {
        const fromDisk = await store.load(pointer.taskId)
        if (fromDisk) {
          liveBySession.set(sessionId, fromDisk)
          return fromDisk
        }
      }
    }
    return null
  }

  function bumpStream(task, reason) {
    task.streamId = newStreamId(reason || 'stream')
  }

  /**
   * @param {object} task
   * @param {object} observation
   */
  function applyObservation(task, observation) {
    const notify = {
      speak: false,
      kind: 'none',
      message: '',
    }
    if (observation.stream_id !== task.streamId) {
      return { ok: false, error: 'stale stream_id; discarded', notify, task: publicTask(task) }
    }
    if (observation.inspection_round !== task.inspectionRound) {
      return { ok: false, error: 'stale inspection_round; discarded', notify, task: publicTask(task) }
    }
    if (observation.checkpoint_id !== task.currentCheckpointId) {
      return { ok: false, error: 'checkpoint_id is not the current expected checkpoint', notify, task: publicTask(task) }
    }

    const item = checkpointOf(task, observation.checkpoint_id)
    if (!item) return { ok: false, error: 'unknown checkpoint', notify, task: publicTask(task) }

    const key = observationKey(observation)
    if (item.lastObservationKey === key) {
      return {
        ok: true,
        duplicate: true,
        changed: false,
        notify: { speak: false, kind: 'duplicate', message: '' },
        task: publicTask(task),
      }
    }
    item.lastObservationKey = key

    const evidence = {
      frameId: observation.evidence_frame_id || `frame_${observation.frame_id}`,
      assetId: normalizeEvidenceAssetId(observation.evidence_asset_id || ''),
      streamId: observation.stream_id,
      capturedAt: nowIso(),
      observations: observation.observations,
      reason: observation.reason,
      verdict: observation.verdict,
    }

    if (task.inspectionRound === 1) {
      if (item.status === 'pending') item.status = 'checking'
      if (observation.verdict === 'uncertain') {
        item.uncertainCount += 1
        item.status = 'uncertain'
        if (!item.initialEvidence) item.initialEvidence = evidence
        // Mid-patrol: record only. Do not speak/render — continuous push would
        // miss later checkpoints while the model is busy on a work order.
        const firstUnclear = !task.eventsNotified.unclear[item.id]
        if (firstUnclear) {
          task.eventsNotified.unclear[item.id] = true
          notify.speak = false
          notify.kind = 'unclear'
          notify.message = `「${item.name}」暂时无法确认：${observation.reason || '画面不清晰或不完整'}。`
        }
        if (item.uncertainCount >= task.uncertainLimit) {
          item.issue = {
            reason: observation.reason || '多次无法确认，转人工确认',
            observations: observation.observations,
          }
          notify.speak = false
          notify.kind = 'uncertain_limit'
          notify.message = `「${item.name}」已连续无法确认 ${item.uncertainCount} 次。`
        }
      } else if (observation.verdict === 'met') {
        item.status = 'met'
        item.issue = null
        item.initialEvidence = evidence
        if (!task.eventsNotified.met[item.id]) {
          task.eventsNotified.met[item.id] = true
          notify.speak = false
          notify.kind = 'met'
          notify.message = `「${item.name}」已满足检查标准。`
        }
      } else if (observation.verdict === 'not_met') {
        item.status = 'needs_fix'
        item.issue = {
          reason: observation.reason || '不满足检查标准',
          observations: observation.observations,
        }
        item.initialEvidence = evidence
        if (!task.eventsNotified.issue[item.id]) {
          task.eventsNotified.issue[item.id] = true
          notify.speak = false
          notify.kind = 'issue'
          notify.message = `「${item.name}」待整改：${item.issue.reason}`
        }
      }
    } else {
      // Recheck: same rule — settle quietly; speak only on recheck_done summary.
      item.status = 'rechecking'
      if (observation.verdict === 'uncertain') {
        item.uncertainCount += 1
        item.status = 'uncertain'
        notify.speak = false
      } else if (observation.verdict === 'met') {
        item.status = 'met'
        item.issue = null
        item.recheckEvidence = evidence
        notify.speak = false
        notify.kind = 'recheck_met'
        notify.message = `复核通过：「${item.name}」`
      } else {
        item.status = 'needs_fix'
        item.issue = {
          reason: observation.reason || '复核仍未满足',
          observations: observation.observations,
        }
        item.recheckEvidence = evidence
        notify.speak = false
        notify.kind = 'recheck_issue'
        notify.message = `复核仍有问题：「${item.name}」：${item.issue.reason}`
      }
    }

    // Advance to next pending checkpoint after a settled initial result.
    if (task.inspectionRound === 1 && (item.status === 'met' || item.status === 'needs_fix'
      || (item.status === 'uncertain' && item.uncertainCount >= task.uncertainLimit))) {
      const orderedNext = task.checkpoints.find(candidate => candidate.status === 'pending')
      if (orderedNext) {
        // Same patrol push may cover multiple checkpoints; do not mint a new
        // streamId here or in-flight frames become stale mid-video.
        orderedNext.status = 'checking'
        task.currentCheckpointId = orderedNext.id
        const dest = orderedNext.moveHint || orderedNext.name
        notify.speak = true
        notify.kind = 'checkpoint_advance'
        notify.message = [
          `「${item.name}」本项已记录。`,
          `接下来前往「${orderedNext.name}」：请 move_to「${dest}」，并对用户说「现在前往${orderedNext.name}」。`,
          `移动 Job 完成后说「已到达${orderedNext.name}，开始检查」，再观察画面。`,
        ].join('')
      } else {
        const retryUncertain = task.checkpoints.find(candidate => (
          candidate.status === 'uncertain' && candidate.uncertainCount < task.uncertainLimit
        ))
        task.currentCheckpointId = retryUncertain?.id ?? item.id
      }
    }

    if (task.inspectionRound === 1 && allInitialSettled(task)) {
      task.phase = openIssues(task).length > 0 ? 'awaiting_remediation' : 'report_ready'
      if (!task.eventsNotified.initialSummary) {
        task.eventsNotified.initialSummary = true
        const summary = counts(task)
        notify.speak = true
        notify.kind = 'initial_summary'
        notify.message = openIssues(task).length > 0
          ? [
            `初检完成：已检查 ${summary.checked}/${summary.total} 项，已满足 ${summary.met}，待处理 ${summary.needsFix}，无法确认 ${summary.uncertain}。`,
            '请展示待处理工单：事项按 1. 2. 3. 标号列出，每项尽量附一张证据图；等待现场确认整改后再复核。',
          ].join('\n')
          : [
            `初检完成：已检查 ${summary.checked}/${summary.total} 项，全部满足。`,
            '可生成最终检查报告。',
          ].join('\n')
      }
    }

    if (task.inspectionRound > 1) {
      const stillOpen = openIssues(task)
      if (stillOpen.length === 0) {
        task.phase = 'report_ready'
        if (!task.eventsNotified.recheckResult) {
          task.eventsNotified.recheckResult = true
          notify.speak = true
          notify.kind = 'recheck_done'
          notify.message = '复核完成，所有检查项已满足。可生成最终报告。'
        }
      } else if (observation.verdict !== 'uncertain' && item.status === 'met') {
        // Advance to the next open recheck target. Prefer recheck_pending; also
        // recover if begin_recheck previously marked several items rechecking.
        const pending = task.checkpoints.find(candidate => candidate.status === 'recheck_pending')
        const alreadyOpen = task.checkpoints.find(candidate => (
          candidate.id !== item.id
          && (candidate.status === 'rechecking' || candidate.status === 'needs_fix')
        ))
        const next = pending || alreadyOpen
        if (next) {
          next.status = 'rechecking'
          task.currentCheckpointId = next.id
          const dest = next.moveHint || next.name
          notify.speak = true
          notify.kind = 'checkpoint_advance'
          notify.message = [
            `「${item.name}」复核通过。`,
            `接下来前往「${next.name}」复核：请 move_to「${dest}」，并对用户说「现在前往${next.name}」。`,
            `到达后说「已到达${next.name}，开始复核」，再观察。`,
          ].join('')
        }
      } else if (item.status === 'needs_fix') {
        task.phase = 'awaiting_remediation'
      }
    }

    item.updatedAt = nowIso()
    if (notify.speak) {
      const hint = operatorHint(task)
      if (hint && !notify.message.includes(hint)) {
        notify.message = `${notify.message}\n${hint}`
      }
    }
    return { ok: true, duplicate: false, changed: true, notify, task: publicTask(task), observation }
  }

  function ensureLiveTask(sessionId) {
    if (!sessionId) return null
    const cached = liveBySession.get(sessionId)
    if (cached) return cached
    const pointer = store.loadSessionPointerSync?.(sessionId) ?? null
    if (!pointer?.taskId) return null
    const fromDisk = store.loadSync?.(pointer.taskId) ?? null
    if (!fromDisk) return null
    liveBySession.set(sessionId, fromDisk)
    return fromDisk
  }

  // In-process hub so vision console can read current bind context.
  // Provided once on root; later v0.3 sessions reuse the same handle.
  const hubApi = {
    getBySession(sessionId) {
      return ensureLiveTask(sessionId)
    },
    getFrameContext(sessionId) {
      const task = ensureLiveTask(sessionId)
      if (!task) return null
      return {
        taskId: String(task.taskId ?? ''),
        checkpointId: task.currentCheckpointId == null ? '' : String(task.currentCheckpointId),
        inspectionRound: Number(task.inspectionRound) || 1,
        streamId: String(task.streamId ?? ''),
        phase: String(task.phase ?? ''),
      }
    },
    /**
     * Bind an external push stream to the active task without clearing accepted
     * history. Vision console should call this after switching clips.
     */
    bindStream(sessionId, streamId, reason = 'bind') {
      const task = ensureLiveTask(sessionId)
      if (!task) return null
      const next = String(streamId ?? '').trim()
      if (next === '') return null
      if (task.streamId !== next) {
        task.streamId = next
        task.updatedAt = nowIso()
        void persist(task)
      }
      return {
        streamId: task.streamId,
        reason,
        observationContext: observationContext(task),
      }
    },
    invalidateStream(sessionId, reason) {
      const task = ensureLiveTask(sessionId)
      if (!task) return null
      bumpStream(task, reason || 'external')
      void persist(task)
      return task.streamId
    },
    publish(task) {
      liveBySession.set(task.sessionId, task)
    },
  }
  try {
    const existing = ctx.root.get?.('inspection-hub')
    if (existing == null) {
      ctx.root.provide('inspection-hub', hubApi)
    } else {
      // Hot-reload: keep the same provided object but refresh closures so
      // disk restore / bindStream stay current after plugin re-apply.
      Object.assign(existing, hubApi)
    }
  } catch {
    // Already provided by another session of this preset.
  }

  ctx.tools.register({
    name: 'start_inspection',
    description: [
      '开始一次活动开场准备检查任务（宿主保存状态）。',
      '用户要求检查活动现场、开场准备、指示牌/签到台/入口通道时调用。',
      '可选 session_id；缺省时用当前会话。返回 taskId、当前检查项与 streamId。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        session_id: { type: 'string', description: '目标会话 id；可省略' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        required: ['ok', 'task'],
        properties: {
          ok: { type: 'boolean' },
          task: { type: 'object', additionalProperties: true },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message || JSON.stringify(value.task) }],
    },
    async execute(args, exec) {
      const sessionId = resolveSessionId(args, exec)
      if (sessionId === '') throw new Error('start_inspection 需要会话上下文或 session_id')
      const existing = await resolveTask(sessionId, '')
      if (existing && existing.phase !== 'completed') {
        const published = publicTask(existing)
        return {
          ok: true,
          task: published,
          observationContext: published.observationContext,
          message: `已有进行中的检查任务 ${existing.taskId}。${published.operatorHint}`,
        }
      }
      const template = await loadTemplate()
      const task = createTaskFromTemplate(template, sessionId)
      await persist(task)
      const published = publicTask(task)
      return {
        ok: true,
        task: published,
        observationContext: published.observationContext,
        message: [
          `已开始「${task.activityName} · ${task.title}」。`,
          `会场：${task.venueName || task.venueQuery || task.location}（语义地图查询可用 venueQuery=${task.venueQuery || '图书馆'}）。`,
          `检查范围：${task.checkpoints.map(item => item.name).join('、')}。`,
          `当前项「${task.checkpoints[0]?.name || ''}」：请先 move_to 到「${task.checkpoints[0]?.moveHint || task.checkpoints[0]?.name || ''}」，到位后再观察。`,
          '场内点位之间必须用移动工具切换；发现问题会登记待处理事项。',
          `有效 streamId=${task.streamId}`,
        ].join('\n'),
      }
    },
  })

  ctx.tools.register({
    name: 'submit_inspection_observation',
    description: [
      '提交一条结构化现场检查观察结果。宿主校验后才更新状态。',
      'verdict 只能是 met / not_met / uncertain。',
      'view_complete=false 时不得用 not_met 证明缺项。',
      'stream_id、inspection_round、checkpoint_id 必须与当前任务期望一致，否则结果被丢弃。',
      '同一结论重复提交不会重复创建问题或通知。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: [
        'checkpoint_id',
        'inspection_round',
        'stream_id',
        'frame_id',
        'location_matches',
        'view_complete',
        'image_readable',
        'verdict',
      ],
      properties: {
        checkpoint_id: { type: 'string' },
        inspection_round: { type: 'number' },
        stream_id: { type: 'string' },
        frame_id: { type: 'number' },
        location_matches: { type: 'boolean' },
        view_complete: { type: 'boolean' },
        image_readable: { type: 'boolean' },
        verdict: { type: 'string', enum: ['met', 'not_met', 'uncertain'] },
        observations: { type: 'array', items: { type: 'string' } },
        reason: { type: 'string' },
        suggested_action: { type: 'string' },
        evidence_kind: {
          type: 'string',
          enum: ['absence', 'clear_anomaly', 'other'],
          description: 'not_met 时标明证据类型：absence 需完整判定区域；clear_anomaly 可为局部但足够的异常画面',
        },
        evidence_asset_id: {
          type: 'string',
          description: 'annotate_target 返回的短 asset_id（不要填 path/绝对路径）',
        },
        evidence_frame_id: { type: 'string' },
        session_id: { type: 'string' },
        task_id: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        required: ['ok'],
        properties: {
          ok: { type: 'boolean' },
          error: { type: 'string' },
          duplicate: { type: 'boolean' },
          changed: { type: 'boolean' },
          notify: { type: 'object', additionalProperties: true },
          task: { type: 'object', additionalProperties: true },
          observationContext: { type: 'object', additionalProperties: true },
          render_ui_args: { type: 'object', additionalProperties: true },
          update_ui: { type: 'boolean' },
          message: { type: 'string' },
        },
      },
      // Model only sees render(); include render_ui_args so it can call render_ui.
      render: (_args, value) => [{
        type: 'text',
        text: JSON.stringify({
          ok: value.ok,
          error: value.error,
          duplicate: value.duplicate,
          changed: value.changed,
          update_ui: value.update_ui,
          ui_kind: value.ui_kind,
          message: value.message,
          notify: value.notify,
          observationContext: value.observationContext,
          ...(value.render_ui_args ? { render_ui_args: value.render_ui_args } : {}),
        }),
      }],
    },
    async execute(args, exec) {
      const parsed = parseObservation(args)
      if (!parsed.ok) {
        return {
          ok: false,
          error: parsed.error,
          message: `观察未采纳：${parsed.error}`,
        }
      }
      const sessionId = resolveSessionId(args, exec)
      const task = await resolveTask(sessionId, String(args?.task_id ?? ''))
      if (!task) {
        return { ok: false, error: 'no active inspection task', message: '没有进行中的检查任务，请先 start_inspection。' }
      }
      const result = applyObservation(task, parsed.value)
      if (result.ok && result.changed) await persist(task)
      const kind = result.notify?.kind || ''
      // Only stage summaries may trigger UI. checkpoint_advance speaks but no card.
      const updateUi = Boolean(
        result.ok
        && result.changed
        && (kind === 'initial_summary' || kind === 'recheck_done'),
      )
      const uiKind = !updateUi
        ? 'none'
        : (task.phase === 'awaiting_remediation' ? 'work_order' : 'inspection_card')
      const message = result.ok
        ? (result.notify?.speak
          ? result.notify.message
          : (result.duplicate
            ? '重复观察，已忽略。继续看后续巡逻画面。'
            : '已记录，继续巡逻观察，暂不渲染工单。'))
        : `观察未采纳：${result.error}`
      return {
        ...result,
        observationContext: observationContext(task),
        ...(updateUi ? { render_ui_args: uiArgsForTask(task) } : {}),
        update_ui: updateUi,
        ui_kind: uiKind,
        message,
      }
    },
  })

  ctx.tools.register({
    name: 'ack_remediation',
    description: [
      '记录用户「已完成整改」反馈。只能把待整改项推进到待复核，不能直接标记通过。',
      '当用户消息以「用户提交了 json-render 表单」开头时，视为工单已提交：立即调用本工具（note 可用表单里的 note/handler），再 begin_recheck，不要再让用户打字确认。',
      '可重复调用；不会重复创建复核任务。',
      '若用户只声明部分检查项已整改，用 checkpoint_ids 限定范围，不要扩大成全部。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        note: { type: 'string', description: '整改说明' },
        checkpoint_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '可选；仅这些检查项进入待复核。省略则处理全部待整改项。',
        },
        session_id: { type: 'string' },
        task_id: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        required: ['ok', 'task', 'message'],
        properties: {
          ok: { type: 'boolean' },
          task: { type: 'object', additionalProperties: true },
          message: { type: 'string' },
          render_ui_args: { type: 'object', additionalProperties: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: JSON.stringify({
          ok: value.ok,
          message: value.message,
          observationContext: value.observationContext,
          ...(value.render_ui_args ? { render_ui_args: value.render_ui_args } : {}),
        }),
      }],
    },
    async execute(args, exec) {
      const sessionId = resolveSessionId(args, exec)
      const task = await resolveTask(sessionId, String(args?.task_id ?? ''))
      if (!task) throw new Error('没有进行中的检查任务')
      const note = typeof args?.note === 'string' && args.note.trim() ? args.note.trim() : '用户确认已完成整改'
      const scoped = Array.isArray(args?.checkpoint_ids)
        ? new Set(args.checkpoint_ids.map(id => String(id).trim()).filter(Boolean))
        : null
      const targets = task.checkpoints.filter(item => {
        const eligible = item.status === 'needs_fix' || item.status === 'remediating' || item.status === 'uncertain'
        if (!eligible) return false
        if (scoped && scoped.size > 0) return scoped.has(item.id)
        return true
      })
      if (targets.length === 0 && task.phase !== 'awaiting_remediation') {
        return {
          ok: true,
          task: publicTask(task),
          observationContext: observationContext(task),
          message: '当前没有待整改项，或已进入复核。',
          render_ui_args: buildCardArgs(task),
        }
      }
      for (const item of targets) {
        if (item.status === 'needs_fix' || item.status === 'uncertain' || item.status === 'remediating') {
          item.status = 'recheck_pending'
        }
      }
      task.remediationNote = note
      task.remediationScope = targets.map(item => item.id)
      task.phase = 'recheck_pending'
      const first = task.checkpoints.find(item => item.status === 'recheck_pending')
      if (first) {
        first.status = 'rechecking'
        task.currentCheckpointId = first.id
      }
      const already = task.eventsNotified.remediationAck
      task.eventsNotified.remediationAck = true
      task.eventsNotified.recheckResult = false
      await persist(task)
      const ctxNow = observationContext(task)
      const names = targets.map(item => item.name).join('、')
      return {
        ok: true,
        task: publicTask(task),
        observationContext: ctxNow,
        message: already
          ? `已再次确认整改反馈（${names || '相关项'}）。请 begin_recheck，然后依据新的巡逻画面复核。`
          : `现场反馈：${names || '相关项'}已处理。请 begin_recheck，等待复核画面后再判定，不要直接判通过。`,
        render_ui_args: buildCardArgs(task),
      }
    },
  })

  ctx.tools.register({
    name: 'begin_recheck',
    description: '开始复核：提升 inspectionRound，刷新 streamId，使旧分析结果失效。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        session_id: { type: 'string' },
        task_id: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        required: ['ok', 'task', 'message'],
        properties: {
          ok: { type: 'boolean' },
          task: { type: 'object', additionalProperties: true },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args, exec) {
      const sessionId = resolveSessionId(args, exec)
      const task = await resolveTask(sessionId, String(args?.task_id ?? ''))
      if (!task) throw new Error('没有进行中的检查任务')
      // Only the first open item is "rechecking"; the rest stay recheck_pending
      // so a successful met can advance currentCheckpointId automatically.
      for (const item of task.checkpoints) {
        if (item.status === 'recheck_pending' || item.status === 'needs_fix' || item.status === 'remediating' || item.status === 'rechecking') {
          item.status = 'recheck_pending'
          item.uncertainCount = 0
          item.lastObservationKey = null
        }
      }
      const first = task.checkpoints.find(item => item.status === 'recheck_pending')
      if (!first) {
        return { ok: true, task: publicTask(task), message: '没有需要复核的检查项。' }
      }
      first.status = 'rechecking'
      task.currentCheckpointId = first.id
      if (task.phase !== 'rechecking') {
        task.inspectionRound = Math.max(2, (task.inspectionRound || 1) + 1)
      } else if (task.inspectionRound < 2) {
        task.inspectionRound = 2
      }
      bumpStream(task, 'recheck')
      task.phase = 'rechecking'
      await persist(task)
      const ctxNow = observationContext(task)
      return {
        ok: true,
        task: publicTask(task),
        observationContext: ctxNow,
        message: [
          `已开始复核 round=${task.inspectionRound}，当前「${first.name}」。`,
          `请先 move_to 到「${first.moveHint || first.name}」，到位后再观察；不要引用初检证据。`,
          `有效 streamId=${task.streamId}（旧流迟到结果将被丢弃；已接受的历史结论保留）。`,
          '不要向用户点名推流文件。',
        ].join('\n'),
      }
    },
  })

  ctx.tools.register({
    name: 'get_inspection_status',
    description: '读取当前检查任务状态、任务配置、有效观察上下文与操作提示。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        session_id: { type: 'string' },
        task_id: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        required: ['ok'],
        properties: {
          ok: { type: 'boolean' },
          task: { type: 'object', additionalProperties: true },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message || JSON.stringify(value.task) }],
    },
    async execute(args, exec) {
      const sessionId = resolveSessionId(args, exec)
      const task = await resolveTask(sessionId, String(args?.task_id ?? ''))
      if (!task) return { ok: false, message: '没有进行中的检查任务' }
      const published = publicTask(task)
      return {
        ok: true,
        task: published,
        observationContext: published.observationContext,
        message: published.operatorHint,
      }
    },
  })

  ctx.tools.register({
    name: 'render_inspection_card',
    description: '根据宿主已保存状态生成检查卡或待处理工单的 render_ui_args；原样传给 render_ui，不要改写。待整改阶段返回工单表单。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        session_id: { type: 'string' },
        task_id: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        required: ['ok', 'render_ui_args'],
        properties: {
          ok: { type: 'boolean' },
          render_ui_args: { type: 'object', additionalProperties: true },
          ui_kind: { type: 'string' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: JSON.stringify({
          ok: value.ok,
          message: value.message,
          ui_kind: value.ui_kind,
          render_ui_args: value.render_ui_args,
        }),
      }],
    },
    async execute(args, exec) {
      const sessionId = resolveSessionId(args, exec)
      const task = await resolveTask(sessionId, String(args?.task_id ?? ''))
      if (!task) throw new Error('没有进行中的检查任务')
      const uiKind = task.phase === 'awaiting_remediation' ? 'work_order' : 'inspection_card'
      return {
        ok: true,
        ui_kind: uiKind,
        render_ui_args: uiArgsForTask(task),
        message: uiKind === 'work_order'
          ? '已生成待处理工单参数，请原样调用 render_ui；用户提交后视为整改反馈。'
          : '已生成检查卡参数，请原样调用 render_ui。',
      }
    },
  })

  ctx.tools.register({
    name: 'finalize_inspection_report',
    description: '基于已保存状态与证据生成最终报告（不由模型重新猜测结论）。返回 render_ui_args。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        session_id: { type: 'string' },
        task_id: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        required: ['ok', 'render_ui_args', 'report'],
        properties: {
          ok: { type: 'boolean' },
          render_ui_args: { type: 'object', additionalProperties: true },
          report: { type: 'object', additionalProperties: true },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: JSON.stringify({
          ok: value.ok,
          message: value.message,
          report: value.report,
          render_ui_args: value.render_ui_args,
        }),
      }],
    },
    async execute(args, exec) {
      const sessionId = resolveSessionId(args, exec)
      const task = await resolveTask(sessionId, String(args?.task_id ?? ''))
      if (!task) throw new Error('没有进行中的检查任务')
      const report = {
        taskId: task.taskId,
        activityName: task.activityName,
        location: task.location,
        simulatedSite: task.simulatedSite,
        summary: counts(task),
        checkpoints: task.checkpoints.map(item => ({
          id: item.id,
          name: item.name,
          status: item.status,
          issue: item.issue,
          initialEvidence: item.initialEvidence,
          recheckEvidence: item.recheckEvidence,
        })),
        remediationNote: task.remediationNote,
        generatedAt: nowIso(),
      }
      task.report = report
      task.phase = 'completed'
      task.eventsNotified.report = true
      await persist(task)
      return {
        ok: true,
        report,
        render_ui_args: buildReportArgs(task),
        message: '报告已生成。请将 render_ui_args 原样传给 render_ui。',
      }
    },
  })
}
