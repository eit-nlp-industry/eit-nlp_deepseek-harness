import { randomUUID } from 'node:crypto'
import { createFunctionSessionDriver } from './session-driver.js'

/**
 * In-process driver for the Host `sessionController.prompt` API
 * (same process as n8n-web / dsh web). This is the reliable path when the UI
 * already owns the Session writer lock.
 *
 * @param {object} sessionController
 * @param {(request: object, signal: AbortSignal) => Promise<unknown>} sessionController.prompt
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs]
 */
export function createHostSessionControllerDriver(sessionController, options = {}) {
  if (!sessionController || typeof sessionController.prompt !== 'function') {
    throw new Error('createHostSessionControllerDriver 需要带 prompt() 的 sessionController')
  }

  return createFunctionSessionDriver(async (request) => {
    if (request.mode === 'none' || !request.session_id) {
      return { delivered: false, reason: 'notice_only', protocol: 'sessionController.prompt' }
    }

    const requestId = randomUUID()
    const signal = options.signal
      ?? AbortSignal.timeout(options.timeoutMs ?? 120_000)

    await sessionController.prompt({
      requestId,
      sessionId: request.session_id,
      mode: request.mode === 'steer' ? 'steer' : 'queue',
      content: [{ type: 'text', text: request.text }],
    }, signal)

    return {
      delivered: true,
      protocol: 'sessionController.prompt',
      session_id: request.session_id,
      requestId,
    }
  }, 'host-session-controller')
}
