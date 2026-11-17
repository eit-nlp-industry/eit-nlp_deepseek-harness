/**
 * Plan store for the 校园活动筹备助手 preset.
 * Each confirmed plan is written as Markdown with YAML front matter carrying its
 * scene, venue and time window, so later plans can be checked for venue clashes.
 * Pure helpers are exported so they can be exercised without the harness.
 * @module @local/dsh-campus-activity-preset/plan-store
 */

import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute path of the bundle directory (this file's folder). */
export const BUNDLE_DIR = dirname(fileURLToPath(import.meta.url))

/** Folder that holds every saved plan. */
export const RUNTIME_DIR = join(BUNDLE_DIR, 'runtime')

/** The only agent preset allowed to use these tools. */
export const ALLOWED_PRESET = 'campus-activity'

/** Stored plan file names: <yyyymmdd-hhmmss>-<slug>.md */
const STORED = /^\d{8}-\d{6}-[a-z0-9-]{1,60}\.md$/

/** Turn a title into a filesystem-safe, sortable id. */
export function makeId(title, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  const slug = String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${stamp}-${slug.length > 0 ? slug : 'plan'}`
}

/** One-line value for front matter. */
function oneLine(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim()
}

/** Parse YYYY-MM-DD HH:mm / ISO into epoch ms, or null. */
export function parseTime(value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  const text = value.trim().replace(' ', 'T')
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? ms : null
}

/** Two windows overlap when each starts before the other ends. */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

/**
 * Find saved plans that clash with a venue + time window.
 * @param plans - listPlans() output.
 * @param probe - { venue, start, end }
 * @returns conflicting plans.
 */
export function findConflicts(plans, probe) {
  const venue = String(probe?.venue ?? '').trim().toLowerCase()
  const start = parseTime(probe?.start)
  const end = parseTime(probe?.end)
  if (venue === '' || start === null || end === null || end <= start) return []
  return plans.filter(plan => {
    if (String(plan.venue ?? '').trim().toLowerCase() !== venue) return false
    const planStart = parseTime(plan.start)
    const planEnd = parseTime(plan.end)
    if (planStart === null || planEnd === null) return false
    return overlaps(start, end, planStart, planEnd)
  })
}

/**
 * Persist one plan snapshot with its scene, venue, window and mock booking.
 * @param {{ title: string, scene?: string, venue?: string, start?: string, end?: string, content: string, booking?: string }} input
 */
export async function savePlan(input) {
  const title = oneLine(input?.title)
  const content = typeof input?.content === 'string' ? input.content : ''
  if (title === '') throw new Error('plan_save 需要非空 title')
  if (content.trim() === '') throw new Error('plan_save 需要非空 content')

  const scene = oneLine(input?.scene)
  const venue = oneLine(input?.venue)
  const start = oneLine(input?.start)
  const end = oneLine(input?.end)
  const booking = oneLine(input?.booking) || (venue === '' ? '' : '模拟预约成功（mock，未真实预约）')

  const existing = await listPlans()
  const conflicts = findConflicts(existing, { venue, start, end })

  const base = makeId(title)
  let id = base
  let suffix = 2
  await mkdir(RUNTIME_DIR, { recursive: true })
  while (existsSync(join(RUNTIME_DIR, `${id}.md`))) {
    id = `${base}-${String(suffix)}`
    suffix += 1
  }
  const front = [
    '---',
    `id: ${id}`,
    `title: ${title}`,
    `scene: ${scene}`,
    `venue: ${venue}`,
    `start: ${start}`,
    `end: ${end}`,
    `booking: ${booking}`,
    `savedAt: ${new Date().toISOString()}`,
    '---',
    '',
  ].join('\n')
  const body = `${front}# ${title}\n\n${content.trim()}\n`
  const path = join(RUNTIME_DIR, `${id}.md`)
  await writeFile(path, body, 'utf8')
  return {
    id,
    path,
    bytes: Buffer.byteLength(body),
    conflicts: conflicts.map(plan => ({ id: plan.id, title: plan.title, venue: plan.venue, start: plan.start, end: plan.end })),
  }
}

/** Parse the YAML front matter of one stored file. */
export function parseFront(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text)
  const meta = {}
  if (match === null) return meta
  for (const line of match[1].split('\n')) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    meta[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return meta
}

/** List stored plans, newest first, with scene/venue/window. */
export async function listPlans() {
  let names
  try {
    names = await readdir(RUNTIME_DIR)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const files = names.filter(name => STORED.test(name)).sort().reverse()
  const plans = []
  for (const file of files) {
    const text = await readFile(join(RUNTIME_DIR, file), 'utf8')
    const meta = parseFront(text)
    plans.push({
      id: file.slice(0, -3),
      file,
      title: meta.title ?? '',
      scene: meta.scene ?? '',
      venue: meta.venue ?? '',
      start: meta.start ?? '',
      end: meta.end ?? '',
      booking: meta.booking ?? '',
    })
  }
  return plans
}

/** Read one stored plan. */
export async function readPlan(id) {
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(id)) throw new Error(`无效的方案编号：${id}`)
  return { id, content: await readFile(join(RUNTIME_DIR, `${id}.md`), 'utf8') }
}

/** Refuse the call unless the running session uses the activity preset. */
export function assertPreset(ctx, exec) {
  const session = exec?.agent?.session
  // The header records the preset chosen at creation and never changes; the live
  // selection is the session projection the registry owns.
  const live = session === undefined ? null : ctx?.agentPresets?.presetForSession(session) ?? null
  const preset = live ?? session?.header?.agentPreset ?? null
  if (preset !== ALLOWED_PRESET) {
    throw new Error(`plan_save / plan_list / plan_get / plan_check 仅用于「校园活动筹备助手」预设（当前预设：${preset ?? '未知'}）。请在该预设的会话里使用。`)
  }
}

/** Required services. */
export const inject = ['tools', 'agentPresets']

function text(value) {
  return [{ type: 'text', text: String(value) }]
}

function conflictLine(conflicts) {
  if (conflicts.length === 0) return ''
  return `\n⚠️ 场地冲突：${conflicts.map(c => `${c.id}（${c.venue} ${c.start}–${c.end}）`).join('、')}`
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'plan_save',
    description: '保存已确认的活动方案：记录活动场景、场地、时间段与模拟预约结果，写入预设目录下的 runtime 文件夹。用户确认方案后调用一次。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '方案标题，例如“班级读书会 · 已确认方案”。' },
        scene: { type: 'string', description: '活动场景/类型，例如“班级读书会”“社团招新”“夜跑”。' },
        venue: { type: 'string', description: '场地名称，例如“教学楼 302 教室”。用于冲突检查。' },
        start: { type: 'string', description: '开始时间，YYYY-MM-DD HH:mm。' },
        end: { type: 'string', description: '结束时间，YYYY-MM-DD HH:mm。' },
        booking: { type: 'string', description: '场地预约结果；默认写模拟结果，不要写成真实预约。' },
        content: { type: 'string', description: '完整方案正文（Markdown）。' },
      },
      required: ['title', 'content'],
    },
    output: {
      schema: {
        type: 'object',
        properties: { id: { type: 'string' }, path: { type: 'string' }, conflicts: { type: 'array' } },
        required: ['id', 'path'],
      },
      render: (_args, value) => text(`方案已保存：${value.id}${conflictLine(value.conflicts ?? [])}`),
    },
    async execute(args, exec) {
      assertPreset(ctx, exec)
      const saved = await savePlan(args)
      return { id: saved.id, path: saved.path, conflicts: saved.conflicts }
    },
  })

  ctx.tools.register({
    name: 'plan_list',
    description: '列出已保存的活动方案（含活动场景、场地、时间段、预约状态），按时间倒序。',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'object', properties: { plans: { type: 'array' } }, required: ['plans'] },
      render: (_args, value) => text(
        value.plans.length === 0
          ? '还没有保存过方案。'
          : value.plans.map(p => `- ${p.id}｜${p.scene || '未标注场景'}｜${p.venue || '未标注场地'}｜${p.start || '?'}–${p.end || '?'}｜${p.booking || '无预约记录'}`).join('\n'),
      ),
    },
    async execute(_args, exec) {
      assertPreset(ctx, exec)
      return { plans: await listPlans() }
    },
  })

  ctx.tools.register({
    name: 'plan_check',
    description: '检查某个场地在指定时间段是否与已保存方案冲突。生成新方案前调用，避免场地撞车。',
    parameters: {
      type: 'object',
      properties: {
        venue: { type: 'string', description: '场地名称。' },
        start: { type: 'string', description: '开始时间 YYYY-MM-DD HH:mm。' },
        end: { type: 'string', description: '结束时间 YYYY-MM-DD HH:mm。' },
      },
      required: ['venue', 'start', 'end'],
    },
    output: {
      schema: { type: 'object', properties: { conflicts: { type: 'array' } }, required: ['conflicts'] },
      render: (_args, value) => text(
        value.conflicts.length === 0
          ? '该场地在这个时间段没有冲突。'
          : `检测到 ${value.conflicts.length} 个冲突：\n${value.conflicts.map(c => `- ${c.id}｜${c.venue}｜${c.start}–${c.end}`).join('\n')}`,
      ),
    },
    async execute(args, exec) {
      assertPreset(ctx, exec)
      const plans = await listPlans()
      return { conflicts: findConflicts(plans, args).map(c => ({ id: c.id, venue: c.venue, start: c.start, end: c.end })) }
    },
  })

  ctx.tools.register({
    name: 'plan_get',
    description: '按编号读取一个已保存方案的完整内容。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'plan_list 返回的编号。' } },
      required: ['id'],
    },
    output: {
      schema: { type: 'object', properties: { id: { type: 'string' }, content: { type: 'string' } }, required: ['id', 'content'] },
      render: (_args, value) => text(value.content),
    },
    async execute(args, exec) {
      assertPreset(ctx, exec)
      return await readPlan(args.id)
    },
  })
}
