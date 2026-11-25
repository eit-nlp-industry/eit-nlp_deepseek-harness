/**
 * Cordis Host plugin: poll `.flow/` and deliver outbox through
 * in-process `sessionController.prompt`.
 *
 * Hands-free path:
 * 1. User creates a `development` session in the UI and starts working.
 * 2. Bridge discovers that live session, writes `.flow`, registers the root.
 * 3. On first submission, lazily creates `aris-acceptance` and prompts review.
 *
 * Optional: `cli.js start` still works for offline / scripted registration.
 */
import { access } from 'node:fs/promises'
import { autoBindDevelopmentSessions } from './auto-bind-development.js'
import { ensureAcceptanceSession } from './ensure-acceptance-session.js'
import { createHostSessionControllerDriver } from './host-session-driver.js'
import { resolveProjectRoots } from './managed-roots.js'
import { runHostOnce } from './host-loop.js'
import { consumeOutboxOnce } from './outbox-consumer.js'
import { processPendingStart } from './start-project.js'
import { flowPaths } from './store.js'

export const name = 'dev-acceptance-flow-host-bridge'
export const inject = ['sessionController']

/**
 * @param {import('cordis').Context} ctx
 * @param {object} config
 * @param {boolean} [config.enabled]
 * @param {number} [config.intervalMs]
 * @param {string[]} [config.projectRoots]
 * @param {string} [config.managedRootsFile]
 * @param {string} [config.devPreset]
 * @param {boolean} [config.autoBindDevelopment]
 */
export function apply(ctx, config = {}) {
  if (config.enabled === false) return

  const configRoots = Array.isArray(config.projectRoots)
    ? config.projectRoots.filter((root) => typeof root === 'string' && root.trim() !== '')
    : []
  const managedRootsFile = typeof config.managedRootsFile === 'string'
    ? config.managedRootsFile
    : undefined
  const autoBind = config.autoBindDevelopment !== false
  const devPreset = typeof config.devPreset === 'string' ? config.devPreset : 'development'

  const intervalMs = Number.isInteger(config.intervalMs) && config.intervalMs > 0
    ? config.intervalMs
    : 2000
  const driver = createHostSessionControllerDriver(ctx.sessionController)
  let chain = Promise.resolve()
  let stopped = false

  const tick = () => {
    if (stopped) return
    chain = chain.then(async () => {
      const log = (message) => ctx.logger?.info?.(`[flow-host-bridge] ${message}`)

      /** @type {string[]} */
      let discovered = []
      if (autoBind) {
        try {
          const result = await autoBindDevelopmentSessions({
            sessions: ctx.get('sessions'),
            agentPresets: ctx.get('agentPresets'),
            devPreset,
            managedRootsFile,
            log,
          })
          discovered = result.roots ?? []
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          ctx.logger?.warn?.(`[flow-host-bridge] auto-bind: ${message}`)
        }
      }

      const roots = [...new Set([
        ...(await resolveProjectRoots(configRoots, managedRootsFile)),
        ...discovered,
      ])]
      if (roots.length === 0) return

      for (const projectRoot of roots) {
        try {
          await processPendingStart({
            projectRoot,
            sessionController: ctx.sessionController,
            log,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          ctx.logger?.warn?.(`[flow-host-bridge] start ${projectRoot}: ${message}`)
        }

        const flowFile = flowPaths(projectRoot).flow
        try {
          await access(flowFile)
        } catch {
          continue
        }

        try {
          await runHostOnce({ projectRoot, log })
          await ensureAcceptanceSession({
            projectRoot,
            sessionController: ctx.sessionController,
            workspaceRegistry: ctx.get('workspaceRegistry'),
            sessions: ctx.get('sessions'),
            agentPresets: ctx.get('agentPresets'),
            log,
          })
          await consumeOutboxOnce({
            projectRoot,
            driver,
            log,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          ctx.logger?.warn?.(`[flow-host-bridge] ${projectRoot}: ${message}`)
        }
      }
    })
  }

  tick()
  const timer = setInterval(tick, intervalMs)
  ctx.effect(() => () => {
    stopped = true
    clearInterval(timer)
  })
}
