// File-backed inspection task store for robot-dog-v03.

import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * @param {string} rootDir
 */
export function createInspectionStore(rootDir) {
  const dir = rootDir

  function taskPath(taskId) {
    return join(dir, `${safeId(taskId)}.json`)
  }

  function sessionPath(sessionId) {
    return join(dir, `session-${safeId(sessionId)}.json`)
  }

  function safeId(value) {
    return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120)
  }

  function readJsonSync(path) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return null
      }
      return null
    }
  }

  async function ensureDir() {
    await mkdir(dir, { recursive: true })
  }

  /**
   * @param {string} taskId
   */
  async function load(taskId) {
    try {
      const text = await readFile(taskPath(taskId), 'utf8')
      return JSON.parse(text)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return null
      }
      throw error
    }
  }

  /**
   * Sync load for vision push path (must not await).
   * @param {string} taskId
   */
  function loadSync(taskId) {
    return readJsonSync(taskPath(taskId))
  }

  /**
   * @param {object} task
   */
  async function save(task) {
    await ensureDir()
    const path = taskPath(task.taskId)
    await mkdir(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    await writeFile(tmp, `${JSON.stringify(task, null, 2)}\n`, 'utf8')
    await writeFile(path, `${JSON.stringify(task, null, 2)}\n`, 'utf8')
  }

  /**
   * @param {string} sessionId
   */
  async function loadSessionPointer(sessionId) {
    try {
      const text = await readFile(sessionPath(sessionId), 'utf8')
      return JSON.parse(text)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return null
      }
      throw error
    }
  }

  /**
   * @param {string} sessionId
   */
  function loadSessionPointerSync(sessionId) {
    return readJsonSync(sessionPath(sessionId))
  }

  /**
   * @param {string} sessionId
   * @param {string} taskId
   */
  async function bindSession(sessionId, taskId) {
    await ensureDir()
    const path = sessionPath(sessionId)
    await writeFile(path, `${JSON.stringify({ sessionId, taskId, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
  }

  return {
    load,
    loadSync,
    save,
    loadSessionPointer,
    loadSessionPointerSync,
    bindSession,
    rootDir: dir,
  }
}
