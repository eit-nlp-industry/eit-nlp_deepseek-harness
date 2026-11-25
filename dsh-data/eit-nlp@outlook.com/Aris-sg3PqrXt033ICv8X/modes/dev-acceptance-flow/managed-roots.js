import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/**
 * Path of the additive project-root list consumed by flow-host-bridge.
 * Override with `DSH_FLOW_MANAGED_ROOTS`.
 * @param {string} [explicit]
 */
export function managedRootsPath(explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') return path.resolve(explicit)
  if (typeof process.env.DSH_FLOW_MANAGED_ROOTS === 'string' && process.env.DSH_FLOW_MANAGED_ROOTS.trim() !== '') {
    return path.resolve(process.env.DSH_FLOW_MANAGED_ROOTS)
  }
  return path.join(HERE, 'managed-project-roots.json')
}

/**
 * @param {string} [file]
 * @returns {Promise<string[]>}
 */
export async function loadManagedRoots(file) {
  const target = managedRootsPath(file)
  try {
    const raw = JSON.parse(await readFile(target, 'utf8'))
    if (!Array.isArray(raw)) return []
    return [...new Set(
      raw
        .filter((item) => typeof item === 'string' && item.trim() !== '')
        .map((item) => path.resolve(item)),
    )]
  } catch (error) {
    if (error && /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return []
    throw error
  }
}

/**
 * @param {string[]} roots
 * @param {string} [file]
 */
export async function saveManagedRoots(roots, file) {
  const target = managedRootsPath(file)
  await mkdir(path.dirname(target), { recursive: true })
  const normalized = [...new Set(
    roots
      .filter((item) => typeof item === 'string' && item.trim() !== '')
      .map((item) => path.resolve(item)),
  )].sort()
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  await rename(temporary, target)
  return normalized
}

/**
 * @param {string} projectRoot
 * @param {string} [file]
 */
export async function addManagedRoot(projectRoot, file) {
  const roots = await loadManagedRoots(file)
  const resolved = path.resolve(projectRoot)
  if (!roots.includes(resolved)) roots.push(resolved)
  return saveManagedRoots(roots, file)
}

/**
 * @param {string[]} configRoots
 * @param {string} [file]
 */
export async function resolveProjectRoots(configRoots = [], file) {
  const managed = await loadManagedRoots(file)
  const fromConfig = Array.isArray(configRoots)
    ? configRoots.filter((root) => typeof root === 'string' && root.trim() !== '')
    : []
  return [...new Set([...fromConfig.map((root) => path.resolve(root)), ...managed])]
}
