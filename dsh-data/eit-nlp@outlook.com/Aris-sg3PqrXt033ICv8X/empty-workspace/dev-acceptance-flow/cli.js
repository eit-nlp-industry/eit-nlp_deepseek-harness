#!/usr/bin/env node
import path from 'node:path'
import { consumeOutboxOnce, runHostCycle } from './outbox-consumer.js'
import { runHostOnce, startHostLoop } from './host-loop.js'
import { createSdkSessionDriver } from './sdk-session-driver.js'
import { createFileSessionDriver, createFunctionSessionDriver } from './session-driver.js'
import { flowPaths, initFlowStore, loadFlowStore } from './store.js'

function usage() {
  return `用法:
  node cli.js init --project-root <dir> --project-id <id> --dev-session <id> --acc-session <id> [--max-rounds 3] [--force]
  node cli.js once --project-root <dir>
  node cli.js cycle --project-root <dir> [--driver file|stdout|sdk] [--wait-idle]
  node cli.js outbox --project-root <dir> [--driver file|stdout|sdk] [--wait-idle]
  node cli.js watch --project-root <dir> [--interval-ms 1000] [--deliver-outbox] [--driver file|stdout|sdk]
  node cli.js status --project-root <dir>

SDK driver 需要 DSH_HOME（或 --dsh-home），可选 DSH_PROFILE（默认 n8n-web）。
`
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = { _: argv[0] ?? '' }
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      out[key] = true
    } else {
      out[key] = next
      i += 1
    }
  }
  return out
}

/**
 * @param {string | boolean | undefined} value
 * @param {string} name
 */
function required(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`缺少参数 --${name}`)
  }
  return value
}

/**
 * @param {string} projectRoot
 * @param {string | boolean | undefined} driverName
 * @param {Record<string, string | boolean>} args
 */
function resolveDriver(projectRoot, driverName, args = {}) {
  const name = typeof driverName === 'string' ? driverName : 'file'
  if (name === 'file') {
    return createFileSessionDriver({ dispatchDir: flowPaths(projectRoot).dispatch })
  }
  if (name === 'stdout') {
    return createFunctionSessionDriver(async (request) => {
      console.error(`--- prompt → ${request.target} ${request.session_id ?? ''} ---`)
      console.error(request.text)
      return { printed: true }
    }, 'stdout')
  }
  if (name === 'sdk') {
    const dshHome = typeof args['dsh-home'] === 'string'
      ? args['dsh-home']
      : process.env.DSH_HOME
    return createSdkSessionDriver({
      dshHome,
      profile: typeof args.profile === 'string' ? args.profile : undefined,
      cwd: projectRoot,
      waitForIdle: args['wait-idle'] === true,
      sdkModule: typeof args['sdk-module'] === 'string' ? args['sdk-module'] : undefined,
    })
  }
  throw new Error(`未知 driver: ${name}（支持 file、stdout、sdk）`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const command = typeof args._ === 'string' ? args._ : ''

  if (command === 'init') {
    const result = await initFlowStore({
      projectRoot: path.resolve(required(args['project-root'], 'project-root')),
      project_id: required(args['project-id'], 'project-id'),
      development_session_id: required(args['dev-session'], 'dev-session'),
      acceptance_session_id: required(args['acc-session'], 'acc-session'),
      max_remediation_rounds: args['max-rounds'] ? Number(args['max-rounds']) : 3,
      force: args.force === true,
    })
    console.log(JSON.stringify({
      created: result.created,
      flow_status: result.flow.flow_status,
      flow: result.paths.flow,
    }, null, 2))
    return
  }

  if (command === 'once') {
    const projectRoot = path.resolve(required(args['project-root'], 'project-root'))
    const result = await runHostOnce({
      projectRoot,
      log: (message) => console.error(message),
    })
    console.log(JSON.stringify({
      flow_status: result.flow.flow_status,
      active_submission_id: result.flow.active_submission_id,
      outcomes: result.outcomes,
    }, null, 2))
    return
  }

  if (command === 'cycle') {
    const projectRoot = path.resolve(required(args['project-root'], 'project-root'))
    const driver = resolveDriver(projectRoot, args.driver, args)
    try {
      const result = await runHostCycle({
        projectRoot,
        driver,
        log: (message) => console.error(message),
      })
      console.log(JSON.stringify({
        flow_status: result.flow.flow_status,
        host_outcomes: result.host.outcomes,
        outbox_outcomes: result.outbox.outcomes.map((row) => ({
          action_id: row.action_id,
          ok: row.ok,
          target: row.target,
          session_id: row.session_id,
          delivery: row.delivery ?? null,
          error: row.error ?? null,
        })),
      }, null, 2))
    } finally {
      if (driver && typeof driver.close === 'function') await driver.close()
    }
    return
  }

  if (command === 'outbox') {
    const projectRoot = path.resolve(required(args['project-root'], 'project-root'))
    const driver = resolveDriver(projectRoot, args.driver, args)
    try {
      const result = await consumeOutboxOnce({
        projectRoot,
        driver,
        log: (message) => console.error(message),
      })
      console.log(JSON.stringify({
        driver: result.driver,
        outcomes: result.outcomes.map((row) => ({
          action_id: row.action_id,
          ok: row.ok,
          skipped: row.skipped ?? false,
          target: row.target,
          session_id: row.session_id,
          delivery: row.delivery ?? null,
          error: row.error ?? null,
        })),
      }, null, 2))
    } finally {
      if (driver && typeof driver.close === 'function') await driver.close()
    }
    return
  }

  if (command === 'watch') {
    const projectRoot = path.resolve(required(args['project-root'], 'project-root'))
    const intervalMs = args['interval-ms'] ? Number(args['interval-ms']) : 1000
    const deliverOutbox = args['deliver-outbox'] === true
    const driver = deliverOutbox ? resolveDriver(projectRoot, args.driver, args) : null
    const controller = new AbortController()
    const stop = async () => {
      if (driver && typeof driver.close === 'function') await driver.close()
      controller.abort()
      process.exit(0)
    }
    process.on('SIGINT', () => { void stop() })
    process.on('SIGTERM', () => { void stop() })
    console.error(`host-loop watching ${projectRoot} (interval ${intervalMs}ms, deliver-outbox=${deliverOutbox})`)

    const log = (message) => console.error(message)
    await startHostLoop({
      projectRoot,
      intervalMs,
      signal: controller.signal,
      log,
    })

    if (deliverOutbox && driver) {
      const deliver = async () => {
        try {
          await consumeOutboxOnce({ projectRoot, driver, log })
        } catch (error) {
          console.error(error instanceof Error ? error.message : error)
        }
      }
      const timer = setInterval(() => { void deliver() }, intervalMs)
      if (typeof timer.unref === 'function') timer.unref()
      controller.signal.addEventListener('abort', () => clearInterval(timer), { once: true })
      await deliver()
    }

    await new Promise(() => {})
    return
  }

  if (command === 'status') {
    const projectRoot = path.resolve(required(args['project-root'], 'project-root'))
    const store = await loadFlowStore(projectRoot)
    console.log(JSON.stringify({
      flow_status: store.flow.flow_status,
      active_submission_id: store.flow.active_submission_id,
      active_review_id: store.flow.active_review_id,
      remediation_round: store.flow.remediation_round,
      waiting_reason: store.flow.waiting_reason,
      findings: store.findings.items.length,
      updated_at: store.flow.updated_at,
    }, null, 2))
    return
  }

  console.error(usage())
  process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
