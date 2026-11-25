import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const PHASES = ['process_supervision', 'result_check', 'rectification', 'retest']
const VERDICTS = ['pass', 'fail']
const SEVERITIES = ['low', 'medium', 'high']

const chains = new Map()

function lock(key, fn) {
  const prev = chains.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  chains.set(key, run.then(() => {}, () => {}))
  return run
}

export function assertProjectId(projectId) {
  const id = typeof projectId === 'string' ? projectId.trim() : ''
  if (!id || id.length > 120 || id === '.' || id === '..' || /[\\/\0]/.test(id)) {
    throw new Error('PROJECT_ID_INVALID: 项目标识只能是不含斜杠的 1–120 个字符，不同项目的账本不会共用。')
  }
  return id
}

function projectDirectory(root, projectId) {
  const id = assertProjectId(projectId)
  const projects = path.resolve(root, 'projects')
  const dir = path.resolve(projects, id)
  if (dir !== path.join(projects, id)) {
    throw new Error('PROJECT_ID_INVALID: 项目标识不能逃出本账本目录。')
  }
  return { id, dir }
}

async function readJsonl(file) {
  try {
    const text = await readFile(file, 'utf8')
    const records = []
    let skipped = 0
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        records.push(JSON.parse(trimmed))
      } catch {
        skipped += 1
      }
    }
    return { records, skipped }
  } catch (error) {
    if (error && error.code === 'ENOENT') return { records: [], skipped: 0 }
    throw error
  }
}

async function appendJsonl(file, record) {
  await mkdir(path.dirname(file), { recursive: true })
  await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8')
}

async function readAlert(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.pending)) {
      return { count: 0, pending: [] }
    }
    return {
      count: Number.isInteger(parsed.count) && parsed.count >= 0 ? parsed.count : 0,
      pending: parsed.pending,
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') return { count: 0, pending: [] }
    throw error
  }
}

async function writeAlert(file, alert) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(alert, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
}

function oneOf(value, allowed, code) {
  if (!allowed.includes(value)) throw new Error(`${code}: 取值必须是 ${allowed.join('、')}。`)
  return value
}

function requiredText(value, code, max = 4000) {
  if (typeof value !== 'string' || value.trim() === '' || value.trim().length > max) {
    throw new Error(`${code}: 需要 1–${max} 个字符的文本。`)
  }
  return value.trim()
}

function tail(records, limit) {
  const size = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50
  return records.slice(-size)
}

export function createAcceptanceStore(root) {
  if (typeof root !== 'string' || root.trim() === '') {
    throw new Error('DATA_DIR_INVALID: 验收账本目录未配置。')
  }
  const base = path.resolve(root)

  async function noteViolation(dir, entry) {
    const record = {
      id: randomUUID(),
      projectId: entry.projectId,
      at: new Date().toISOString(),
      phase: entry.phase,
      constraint: entry.constraint,
      violation: entry.violation,
      evidence: entry.evidence ?? '',
      severity: entry.severity,
    }
    await appendJsonl(path.join(dir, 'error-book.jsonl'), record)
    const alertFile = path.join(dir, 'alert-reserve.json')
    const alert = await readAlert(alertFile)
    const pending = {
      id: randomUUID(),
      at: record.at,
      errorId: record.id,
      count: alert.count + 1,
      reason: record.violation,
      channel: 'reserved',
      delivered: false,
      parentNotified: false,
    }
    await writeAlert(alertFile, {
      projectId: entry.projectId,
      count: pending.count,
      pending: [...alert.pending, pending],
      delivery: 'reserved',
    })
    return { error: record, alert: pending }
  }

  return {
    async recordAcceptance(input) {
      const { id, dir } = projectDirectory(base, input.projectId)
      const phase = oneOf(input.phase, PHASES, 'PHASE_INVALID')
      const verdict = oneOf(input.verdict, VERDICTS, 'VERDICT_INVALID')
      const record = {
        id: randomUUID(),
        projectId: id,
        at: new Date().toISOString(),
        phase,
        verdict,
        constraint: requiredText(input.constraint, 'CONSTRAINT_INVALID'),
        summary: requiredText(input.summary, 'SUMMARY_INVALID'),
        evidence: typeof input.evidence === 'string' ? input.evidence.trim().slice(0, 4000) : '',
      }
      return lock(id, async () => {
        await appendJsonl(path.join(dir, 'acceptance.jsonl'), record)
        if (verdict !== 'fail') return { acceptance: record, error: null, alert: null }
        const noted = await noteViolation(dir, {
          projectId: id,
          phase,
          constraint: record.constraint,
          violation: record.summary,
          evidence: record.evidence,
          severity: oneOf(input.severity ?? 'medium', SEVERITIES, 'SEVERITY_INVALID'),
        })
        return { acceptance: record, error: noted.error, alert: noted.alert }
      })
    },

    async addError(input) {
      const { id, dir } = projectDirectory(base, input.projectId)
      const entry = {
        projectId: id,
        phase: oneOf(input.phase, PHASES, 'PHASE_INVALID'),
        constraint: requiredText(input.constraint, 'CONSTRAINT_INVALID'),
        violation: requiredText(input.violation, 'VIOLATION_INVALID'),
        evidence: typeof input.evidence === 'string' ? input.evidence.trim().slice(0, 4000) : '',
        severity: oneOf(input.severity ?? 'medium', SEVERITIES, 'SEVERITY_INVALID'),
      }
      return lock(id, async () => noteViolation(dir, entry))
    },

    async listAcceptance(projectId, limit) {
      const { id, dir } = projectDirectory(base, projectId)
      const { records, skipped } = await readJsonl(path.join(dir, 'acceptance.jsonl'))
      const own = records.filter((record) => record.projectId === id)
      return { projectId: id, total: own.length, skipped, records: tail(own, limit) }
    },

    async listErrors(projectId, limit) {
      const { id, dir } = projectDirectory(base, projectId)
      const { records, skipped } = await readJsonl(path.join(dir, 'error-book.jsonl'))
      const own = records.filter((record) => record.projectId === id)
      return { projectId: id, total: own.length, skipped, records: tail(own, limit) }
    },

    async alertStatus(projectId) {
      const { id, dir } = projectDirectory(base, projectId)
      const alert = await readAlert(path.join(dir, 'alert-reserve.json'))
      return {
        projectId: id,
        count: alert.count,
        delivery: 'reserved',
        parentNotified: false,
        pending: alert.pending.filter((item) => item && item.parentNotified === false),
      }
    },
  }
}

export const acceptancePhases = PHASES
export const acceptanceVerdicts = VERDICTS
export const violationSeverities = SEVERITIES
