/**
 * Plan store for the 校园活动筹备助手 preset.
 * Writes each confirmed plan as a Markdown snapshot under <bundle>/runtime.
 * Pure helpers are exported so they can be exercised without the harness.
 * @module @local/dsh-campus-activity-preset/plan-store
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute path of the bundle directory (this file's folder). */
export const BUNDLE_DIR = dirname(fileURLToPath(import.meta.url))

/** Folder that holds every saved plan. */
export const RUNTIME_DIR = join(BUNDLE_DIR, 'runtime')

const ID = /^[a-z0-9][a-z0-9-]{2,80}$/

/** Turn a title into a filesystem-safe, sortable id. */
export function makeId(title, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  // Keep ids ASCII so they are safe in URLs, shells and the id validator.
  const slug = String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const safeSlug = slug.length > 0 ? slug : 'plan'
  return `${stamp}-${safeSlug}`
}

/**
 * Persist one plan snapshot.
 * @param {{ title: string, content: string, meta?: object }} input
 * @returns the stored record { id, path, bytes }.
 */
export async function savePlan(input) {
  const title = typeof input?.title === 'string' ? input.title.trim() : ''
  const content = typeof input?.content === 'string' ? input.content : ''
  if (title === '') throw new Error('plan_save 需要非空 title')
  if (content.trim() === '') throw new Error('plan_save 需要非空 content')
  const id = makeId(title)
  await mkdir(RUNTIME_DIR, { recursive: true })
  const header = `# ${title}\n\n- 保存时间：${new Date().toISOString()}\n- 编号：${id}\n\n---\n\n`
  const body = `${header}${content.trim()}\n`
  const path = join(RUNTIME_DIR, `${id}.md`)
  await writeFile(path, body, 'utf8')
  return { id, path, bytes: Buffer.byteLength(body) }
}

/** List stored plans, newest first. */
export async function listPlans() {
  let names
  try {
    names = await readdir(RUNTIME_DIR)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  // Only ids this module produced: <yyyymmdd-hhmmss>-<slug>.md
  const STORED = /^\d{8}-\d{6}-[a-z0-9-]{1,60}\.md$/
  return names
    .filter(name => STORED.test(name))
    .sort()
    .reverse()
    .map(name => ({ id: name.slice(0, -3), file: name }))
}

/** Read one stored plan. */
export async function readPlan(id) {
  if (!ID.test(id)) throw new Error(`无效的方案编号：${id}`)
  const path = join(RUNTIME_DIR, `${id}.md`)
  return { id, content: await readFile(path, 'utf8') }
}

/** Required services: the tool registry. */
export const inject = ['tools']

function text(value) {
  return [{ type: 'text', text: String(value) }]
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'plan_save',
    description: '把已确认的活动方案保存为本地快照，写入预设目录下的 runtime 文件夹。用户确认方案后调用一次。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '方案标题，例如“社团招新宣讲 · 已确认方案”。' },
        content: { type: 'string', description: '完整方案正文（Markdown）：需求、方案、预算、分工、流程、待办。' },
      },
      required: ['title', 'content'],
    },
    output: {
      schema: {
        type: 'object',
        properties: { id: { type: 'string' }, path: { type: 'string' } },
        required: ['id', 'path'],
      },
      render: (_args, value) => text(`方案已保存：${value.id}`),
    },
    async execute(args) {
      const saved = await savePlan(args)
      return { id: saved.id, path: saved.path }
    },
  })

  ctx.tools.register({
    name: 'plan_list',
    description: '列出已保存的活动方案快照（按时间倒序）。用户问“有哪些方案”“之前保存的方案”时调用。',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: {
        type: 'object',
        properties: { plans: { type: 'array' } },
        required: ['plans'],
      },
      render: (_args, value) => text(
        value.plans.length === 0
          ? '还没有保存过方案。'
          : `已保存 ${value.plans.length} 个方案：\n${value.plans.map(p => `- ${p.id}`).join('\n')}`,
      ),
    },
    async execute() {
      return { plans: await listPlans() }
    },
  })

  ctx.tools.register({
    name: 'plan_get',
    description: '按编号读取一个已保存方案的完整内容。用户指定要看某个方案时调用。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'plan_list 返回的编号。' } },
      required: ['id'],
    },
    output: {
      schema: {
        type: 'object',
        properties: { id: { type: 'string' }, content: { type: 'string' } },
        required: ['id', 'content'],
      },
      render: (_args, value) => text(value.content),
    },
    async execute(args) {
      return await readPlan(args.id)
    },
  })
}
