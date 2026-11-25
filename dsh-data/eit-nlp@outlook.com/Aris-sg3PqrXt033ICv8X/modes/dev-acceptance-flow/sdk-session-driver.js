import { createFunctionSessionDriver } from './session-driver.js'

/**
 * @typedef {object} SdkPromptClient
 * @property {(sessionId: string) => Promise<void>} [resumeSession]
 * @property {(sessionId: string, contentBlocks: unknown[]) => Promise<string>} prompt
 * @property {(method: string, params?: object) => Promise<unknown>} [request]
 */

/**
 * Resolve and start a DeepSeekHarness client that speaks real `session/prompt`.
 * @param {object} options
 * @param {string} [options.sdkModule]
 * @param {string} [options.dshHome]
 * @param {string} [options.profile]
 * @param {string} [options.cwd]
 * @param {string} [options.provider]
 * @param {string} [options.model]
 * @param {SdkPromptClient} [options.client] inject a fake/real client (skips spawn)
 * @returns {Promise<{ client: SdkPromptClient, close: () => Promise<void> }>}
 */
export async function openSdkPromptClient(options = {}) {
  if (options.client) {
    return {
      client: options.client,
      close: async () => {},
    }
  }

  const moduleSpec = options.sdkModule
    ?? process.env.DSH_SDK_CLIENT_MODULE
    ?? '@deepseek-ai/dsh-sdk-client'
  let mod
  try {
    mod = await import(moduleSpec)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `无法加载 SDK 客户端模块 ${moduleSpec}: ${message}。可设置 DSH_SDK_CLIENT_MODULE 为绝对路径。`,
    )
  }
  if (typeof mod.DeepSeekHarness !== 'function') {
    throw new Error(`${moduleSpec} 未导出 DeepSeekHarness`)
  }

  const dshHome = options.dshHome ?? process.env.DSH_HOME
  if (typeof dshHome !== 'string' || dshHome.trim() === '') {
    throw new Error('SDK driver 需要 dshHome 或环境变量 DSH_HOME')
  }

  const harness = new mod.DeepSeekHarness({
    dshHome,
    profile: options.profile ?? process.env.DSH_PROFILE ?? 'n8n-web',
    cwd: options.cwd ?? process.cwd(),
    provider: options.provider ?? process.env.DSH_PROVIDER ?? 'deepseek-official',
    model: options.model ?? process.env.DSH_MODEL ?? 'deepseek-flash',
  })
  await harness.start()
  return {
    client: harness.client,
    close: () => harness.close(),
  }
}

/**
 * SessionDriver that enqueues text via real JSON-RPC `session/prompt`.
 *
 * Prefer this for automation-owned sessions (init flow with SDK-created ids).
 * If the Web UI already holds the same Session writer lock, resume/prompt will fail —
 * use {@link createHostSessionControllerDriver} inside the same Host process instead.
 *
 * @param {object} [options]
 * @param {SdkPromptClient} [options.client]
 * @param {string} [options.sdkModule]
 * @param {string} [options.dshHome]
 * @param {string} [options.profile]
 * @param {string} [options.cwd]
 * @param {string} [options.provider]
 * @param {string} [options.model]
 * @param {boolean} [options.waitForIdle] after prompt, call session/wait
 * @param {boolean} [options.resume] try session/resume before prompt (default true)
 */
export function createSdkSessionDriver(options = {}) {
  /** @type {Promise<{ client: SdkPromptClient, close: () => Promise<void> }> | null} */
  let opened = null
  const resume = options.resume !== false
  const waitForIdle = options.waitForIdle === true

  const getOpened = () => {
    opened ??= openSdkPromptClient(options)
    return opened
  }

  const driver = createFunctionSessionDriver(async (request) => {
    if (request.mode === 'none' || !request.session_id) {
      return { delivered: false, reason: 'notice_only', protocol: 'session/prompt' }
    }

    const { client } = await getOpened()

    if (resume && typeof client.resumeSession === 'function') {
      try {
        await client.resumeSession(request.session_id)
      } catch {
        // Live-in-this-runtime sessions, or first prompt will create/bind; keep going.
      }
    }

    const messageId = await client.prompt(request.session_id, [
      { type: 'text', text: request.text },
    ])

    if (waitForIdle && typeof client.request === 'function') {
      await client.request('session/wait', { sessionId: request.session_id })
    }

    return {
      delivered: true,
      protocol: 'session/prompt',
      session_id: request.session_id,
      messageId,
      waited: waitForIdle,
    }
  }, 'sdk')

  return {
    ...driver,
    name: 'sdk',
    async close() {
      if (!opened) return
      const handle = await opened
      opened = null
      await handle.close()
    },
  }
}
