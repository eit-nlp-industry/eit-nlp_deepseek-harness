import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { writeJsonAtomic } from './store.js'

/**
 * @typedef {object} SessionPromptRequest
 * @property {'acceptance' | 'development' | 'user'} target
 * @property {string | null} session_id
 * @property {'queue' | 'steer' | 'none'} mode
 * @property {string} text
 * @property {Record<string, unknown>} meta
 */

/**
 * In-memory driver for tests.
 */
export function createMemorySessionDriver() {
  /** @type {SessionPromptRequest[]} */
  const sent = []
  return {
    name: 'memory',
    /** @param {SessionPromptRequest} request */
    async prompt(request) {
      sent.push(request)
      return {
        ok: true,
        delivered: request.mode !== 'none',
        driver: 'memory',
        session_id: request.session_id,
      }
    },
    sent,
  }
}

/**
 * File driver: writes the prompt payload under `.flow/dispatch/` for a later
 * real session bridge (SDK / Remote / ACP) to pick up. Does not call Harness.
 *
 * @param {object} input
 * @param {string} input.dispatchDir
 */
export function createFileSessionDriver(input) {
  return {
    name: 'file',
    /**
     * @param {SessionPromptRequest} request
     */
    async prompt(request) {
      await mkdir(input.dispatchDir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const actionId = typeof request.meta.action_id === 'string' ? request.meta.action_id : 'action'
      const base = `${stamp}-${actionId}`
      const jsonFile = path.join(input.dispatchDir, `${base}.json`)
      const textFile = path.join(input.dispatchDir, `${base}.txt`)
      const payload = {
        ...request,
        written_at: new Date().toISOString(),
      }
      await writeJsonAtomic(jsonFile, payload)
      await writeFile(textFile, `${request.text}\n`, 'utf8')
      return {
        ok: true,
        delivered: request.mode !== 'none',
        driver: 'file',
        session_id: request.session_id,
        dispatch_json: jsonFile,
        dispatch_text: textFile,
      }
    },
  }
}

/**
 * Wrap a custom async prompt function.
 * @param {(request: SessionPromptRequest) => Promise<Record<string, unknown>>} promptFn
 * @param {string} [name]
 */
export function createFunctionSessionDriver(promptFn, name = 'function') {
  return {
    name,
    /** @param {SessionPromptRequest} request */
    async prompt(request) {
      const result = await promptFn(request)
      return {
        ok: true,
        delivered: request.mode !== 'none',
        driver: name,
        session_id: request.session_id,
        ...result,
      }
    },
  }
}
