import { access, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { emptyFindingsLedger, validateFindingsLedger } from './findings.js'
import { bootstrapFlow } from './transitions.js'
import { validateFlow } from './validate.js'

/**
 * @param {string} projectRoot
 */
export function flowPaths(projectRoot) {
  const root = path.resolve(projectRoot)
  const flowRoot = path.join(root, '.flow')
  return {
    projectRoot: root,
    flowRoot,
    flow: path.join(flowRoot, 'flow.json'),
    findings: path.join(flowRoot, 'findings.json'),
    submissions: path.join(flowRoot, 'submissions'),
    reviews: path.join(flowRoot, 'reviews'),
    outbox: path.join(flowRoot, 'outbox'),
    outboxDone: path.join(flowRoot, 'outbox-done'),
    dispatch: path.join(flowRoot, 'dispatch'),
    journal: path.join(flowRoot, 'host-journal.jsonl'),
  }
}

/**
 * @param {string} file
 * @param {unknown} value
 */
export async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  const body = `${JSON.stringify(value, null, 2)}\n`
  await writeFile(temporary, body, 'utf8')
  await rename(temporary, file)
}

/**
 * @param {string} file
 */
export async function readJson(file) {
  const text = await readFile(file, 'utf8')
  return JSON.parse(text)
}

/**
 * @param {string} file
 * @param {unknown} [fallback]
 */
export async function readJsonIfExists(file, fallback = null) {
  try {
    return await readJson(file)
  } catch (error) {
    if (error && /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return fallback
    throw error
  }
}

/**
 * @param {ReturnType<typeof flowPaths>} paths
 */
export async function ensureFlowDirs(paths) {
  await mkdir(paths.submissions, { recursive: true })
  await mkdir(paths.reviews, { recursive: true })
  await mkdir(paths.outbox, { recursive: true })
  await mkdir(paths.outboxDone, { recursive: true })
  await mkdir(paths.dispatch, { recursive: true })
}

/**
 * Rename `.flow/` aside so a new PRD cycle can bootstrap cleanly.
 * Leaves submissions/reviews/journal intact under the archive directory.
 *
 * @param {string} projectRoot
 * @returns {Promise<{ archived: boolean, archive_dir?: string, reason?: string }>}
 */
export async function archiveFlowRoot(projectRoot) {
  const paths = flowPaths(projectRoot)
  try {
    await access(paths.flowRoot)
  } catch (error) {
    if (error && /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      return { archived: false, reason: 'no_flow' }
    }
    throw error
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const archiveDir = path.join(paths.projectRoot, `.flow-archive-${stamp}`)
  await rename(paths.flowRoot, archiveDir)
  return { archived: true, archive_dir: archiveDir }
}

/**
 * @param {object} input
 * @param {string} input.projectRoot
 * @param {string} input.project_id
 * @param {string} input.development_session_id
 * @param {string | null} [input.acceptance_session_id]
 * @param {string} [input.prd_relpath]
 * @param {number} [input.max_remediation_rounds]
 * @param {string} [input.event_id]
 * @param {string} [input.at]
 * @param {boolean} [input.force]
 */
export async function initFlowStore(input) {
  const paths = flowPaths(input.projectRoot)
  await ensureFlowDirs(paths)

  const existing = await readJsonIfExists(paths.flow)
  if (existing && !input.force) {
    const checked = validateFlow(existing)
    if (!checked.ok) throw new Error(`${checked.code}: ${checked.message}`)
    const findings = await readJsonIfExists(paths.findings, emptyFindingsLedger(input.project_id))
    return { paths, flow: existing, findings, created: false }
  }

  const boot = bootstrapFlow({
    project_id: input.project_id,
    project_root: paths.projectRoot,
    development_session_id: input.development_session_id,
    acceptance_session_id: input.acceptance_session_id ?? null,
    prd_relpath: input.prd_relpath,
    max_remediation_rounds: input.max_remediation_rounds,
    event_id: input.event_id,
    at: input.at,
  })
  if (!boot.ok) throw new Error(`${boot.code}: ${boot.message}`)

  await writeJsonAtomic(paths.flow, boot.flow)
  await writeJsonAtomic(paths.findings, boot.findings)
  await appendJournal(paths, {
    at: boot.flow.updated_at,
    kind: 'bootstrap',
    action: boot.action,
    flow_status: boot.flow.flow_status,
  })

  return { paths, flow: boot.flow, findings: boot.findings, created: true }
}

/**
 * @param {string | ReturnType<typeof flowPaths>} projectRootOrPaths
 */
export async function loadFlowStore(projectRootOrPaths) {
  const paths = typeof projectRootOrPaths === 'string'
    ? flowPaths(projectRootOrPaths)
    : projectRootOrPaths
  const flow = await readJson(paths.flow)
  const flowCheck = validateFlow(flow)
  if (!flowCheck.ok) throw new Error(`${flowCheck.code}: ${flowCheck.message}`)

  const findingsRaw = await readJsonIfExists(
    paths.findings,
    emptyFindingsLedger(/** @type {string} */ (flow.project_id)),
  )
  const findingsCheck = validateFindingsLedger(findingsRaw)
  if (!findingsCheck.ok) throw new Error(`${findingsCheck.code}: ${findingsCheck.message}`)

  return {
    paths,
    flow: /** @type {Record<string, unknown>} */ (flow),
    findings: /** @type {Record<string, unknown>} */ (findingsCheck.value),
  }
}

/**
 * @param {ReturnType<typeof flowPaths>} paths
 * @param {Record<string, unknown>} flow
 * @param {Record<string, unknown>} findings
 */
export async function saveFlowState(paths, flow, findings) {
  await ensureFlowDirs(paths)
  await writeJsonAtomic(paths.flow, flow)
  await writeJsonAtomic(paths.findings, findings)
}

/**
 * @param {ReturnType<typeof flowPaths>} paths
 * @param {Record<string, unknown>} entry
 */
export async function appendJournal(paths, entry) {
  await mkdir(paths.flowRoot, { recursive: true })
  const { appendFile } = await import('node:fs/promises')
  await appendFile(paths.journal, `${JSON.stringify(entry)}\n`, 'utf8')
}

/**
 * @param {ReturnType<typeof flowPaths>} paths
 * @param {Record<string, unknown>} action
 */
export async function writeOutboxAction(paths, action) {
  await mkdir(paths.outbox, { recursive: true })
  const id = typeof action.id === 'string' ? action.id : `action-${Date.now()}`
  const file = path.join(paths.outbox, `${id}.json`)
  await writeJsonAtomic(file, action)
  return file
}

/**
 * @param {string} dir
 * @returns {Promise<string[]>} absolute paths sorted by name
 */
export async function listJsonFiles(dir) {
  try {
    const names = await readdir(dir)
    return names
      .filter((name) => name.endsWith('.json') && !name.endsWith('.tmp'))
      .sort()
      .map((name) => path.join(dir, name))
  } catch (error) {
    if (error && /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return []
    throw error
  }
}

/**
 * Immutable artifact write. Refuses overwrite of an existing different body.
 * @param {string} file
 * @param {unknown} value
 */
export async function writeImmutableJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const body = `${JSON.stringify(value, null, 2)}\n`
  try {
    const existing = await readFile(file, 'utf8')
    if (existing === body) return { written: false, file }
    throw new Error(`IMMUTABLE_CONFLICT: 拒绝覆盖已有文件 ${file}`)
  } catch (error) {
    if (error && /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      await writeJsonAtomic(file, value)
      return { written: true, file }
    }
    throw error
  }
}
