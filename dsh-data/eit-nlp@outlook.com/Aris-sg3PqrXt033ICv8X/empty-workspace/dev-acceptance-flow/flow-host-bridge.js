/**
 * Cordis Host plugin: poll `.flow/` and deliver outbox actions through
 * in-process `sessionController.prompt`.
 *
 * Mount from a profile patch, for example:
 *
 * ```yaml
 * - insert:
 *     - id: flow-host-bridge
 *       name: '@local/dsh-dev-acceptance-flow/flow-host-bridge.js'
 *       config:
 *         enabled: true
 *         intervalMs: 2000
 *         projectRoots:
 *           - /path/to/project
 * ```
 */
import { createHostSessionControllerDriver } from './host-session-driver.js'
import { runHostCycle } from './outbox-consumer.js'

export const name = 'dev-acceptance-flow-host-bridge'
export const inject = ['sessionController']

/**
 * @param {import('cordis').Context} ctx
 * @param {object} config
 * @param {boolean} [config.enabled]
 * @param {number} [config.intervalMs]
 * @param {string[]} [config.projectRoots]
 * @param {boolean} [config.wait] unused; host prompt returns on admit
 */
export function apply(ctx, config = {}) {
  if (config.enabled === false) return

  const roots = Array.isArray(config.projectRoots)
    ? config.projectRoots.filter((root) => typeof root === 'string' && root.trim() !== '')
    : []
  if (roots.length === 0) {
    ctx.logger?.warn?.('flow-host-bridge: projectRoots 为空，跳过启动')
    return
  }

  const intervalMs = Number.isInteger(config.intervalMs) && config.intervalMs > 0
    ? config.intervalMs
    : 2000
  const driver = createHostSessionControllerDriver(ctx.sessionController)
  let chain = Promise.resolve()
  let stopped = false

  const tick = () => {
    if (stopped) return
    chain = chain.then(async () => {
      for (const projectRoot of roots) {
        try {
          await runHostCycle({
            projectRoot,
            driver,
            log: (message) => ctx.logger?.info?.(`[flow-host-bridge] ${message}`),
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
