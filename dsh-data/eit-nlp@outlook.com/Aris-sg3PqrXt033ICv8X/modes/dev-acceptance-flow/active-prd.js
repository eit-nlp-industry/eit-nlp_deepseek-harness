import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { flowPaths, readJsonIfExists } from './store.js'

export const ACTIVE_PRD_FILENAME = '.active-prd'
export const DEFAULT_PRD_RELPATH = 'PRD.md'

/**
 * @param {string} projectRoot
 * @param {string} relativeOrAbsolute
 */
export function resolvePrdCandidate(projectRoot, relativeOrAbsolute) {
  const root = path.resolve(projectRoot)
  const candidate = path.isAbsolute(relativeOrAbsolute)
    ? path.resolve(relativeOrAbsolute)
    : path.resolve(root, relativeOrAbsolute)
  const rel = path.relative(root, candidate)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`PRD_OUTSIDE_ROOT: ${relativeOrAbsolute} 必须位于项目目录内`)
  }
  return {
    project_root: root,
    prd_path: candidate,
    prd_relpath: rel.split(path.sep).join('/'),
  }
}

/**
 * Stable slug for project_id suffix. `PRD.md` → null (no suffix).
 * @param {string} [prdRelpath]
 */
export function prdIdSuffix(prdRelpath) {
  const rel = typeof prdRelpath === 'string' && prdRelpath.trim() !== ''
    ? prdRelpath.trim().replace(/\\/g, '/')
    : DEFAULT_PRD_RELPATH
  const base = path.posix.basename(rel, path.posix.extname(rel))
  const slug = base
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  if (!slug || slug === 'prd') return null
  return slug
}

/**
 * Read plain-text `.active-prd` (one relative path, `#` comments / blank lines ignored).
 * @param {string} projectRoot
 * @returns {Promise<string | null>}
 */
export async function readActivePrdFile(projectRoot) {
  const file = path.join(path.resolve(projectRoot), ACTIVE_PRD_FILENAME)
  try {
    const text = await readFile(file, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      return trimmed
    }
    return null
  } catch (error) {
    if (error && /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null
    throw error
  }
}

/**
 * Resolve which PRD file this project run should use.
 *
 * Precedence:
 * 1. explicit `prd` argument
 * 2. existing `.flow/flow.json` → `prd_relpath`
 * 3. project-root `.active-prd`
 * 4. default `PRD.md`
 *
 * @param {object} input
 * @param {string} input.projectRoot
 * @param {string} [input.prd]
 * @param {boolean} [input.requireExists=true]
 */
export async function resolveActivePrd(input) {
  const projectRoot = path.resolve(input.projectRoot)
  const requireExists = input.requireExists !== false

  /** @type {string | null} */
  let chosen = null
  /** @type {string} */
  let source = 'default'

  if (typeof input.prd === 'string' && input.prd.trim() !== '') {
    chosen = input.prd.trim()
    source = 'explicit'
  }

  if (!chosen) {
    const flow = await readJsonIfExists(flowPaths(projectRoot).flow, null)
    if (flow && typeof flow.prd_relpath === 'string' && flow.prd_relpath.trim() !== '') {
      chosen = flow.prd_relpath.trim()
      source = 'flow'
    }
  }

  if (!chosen) {
    const fromFile = await readActivePrdFile(projectRoot)
    if (fromFile) {
      chosen = fromFile
      source = 'active_prd_file'
    }
  }

  if (!chosen) {
    chosen = DEFAULT_PRD_RELPATH
    source = 'default'
  }

  const resolved = resolvePrdCandidate(projectRoot, chosen)
  if (requireExists) {
    await access(resolved.prd_path)
  }
  return {
    ...resolved,
    source,
  }
}
