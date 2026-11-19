const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled'])
const DEFAULT_MAX_PENDING = 64

function fingerprint(result) {
  return JSON.stringify({
    status: result.status,
    message: result.message,
  })
}

function jobOutcome(result) {
  if (result.status === 'succeeded') {
    return { status: 'completed', result: result.message }
  }
  if (result.status === 'cancelled') {
    return { status: 'killed', detail: result.message }
  }
  return { status: 'failed', detail: result.message }
}

export function createRobotJobBridge({ maxPending = DEFAULT_MAX_PENDING } = {}) {
  if (!Number.isSafeInteger(maxPending) || maxPending < 1) {
    throw new TypeError('maxPending must be a positive safe integer')
  }

  const links = new Map()
  const pending = new Map()

  function deliver(link, result) {
    const key = fingerprint(result)

    link.onFinal(result)
    link.settle(jobOutcome(result))
    links.set(result.task_id, {
      jobId: link.jobId,
      terminal: true,
      fingerprint: key,
    })

    return { outcome: 'completed' }
  }

  return {
    has(taskId) {
      return links.has(taskId)
    },

    register({ taskId, jobId, onFinal, settle }) {
      if (links.has(taskId)) return { registered: false }
      if (typeof onFinal !== 'function' || typeof settle !== 'function') {
        throw new TypeError('onFinal and settle must be functions')
      }

      const link = { taskId, jobId, onFinal, settle, terminal: false }
      links.set(taskId, link)

      const early = pending.get(taskId)
      if (early !== undefined) {
        pending.delete(taskId)
        deliver(link, early)
        return { registered: true, pendingApplied: true }
      }
      return { registered: true, pendingApplied: false }
    },

    accept(result) {
      if (!TERMINAL_STATUSES.has(result?.status)) {
        throw new TypeError(`unsupported terminal status: ${String(result?.status)}`)
      }

      const key = fingerprint(result)
      const link = links.get(result.task_id)

      if (link?.terminal === true) {
        return link.fingerprint === key
          ? { outcome: 'duplicate' }
          : { outcome: 'conflict' }
      }

      if (link === undefined) {
        const early = pending.get(result.task_id)
        if (early !== undefined) {
          return fingerprint(early) === key
            ? { outcome: 'pending' }
            : { outcome: 'conflict' }
        }
        if (pending.size >= maxPending) return { outcome: 'unavailable' }

        pending.set(result.task_id, result)
        return { outcome: 'pending' }
      }

      return deliver(link, result)
    },

    stopTracking(taskId, message = '已停止跟踪机器狗任务') {
      const link = links.get(taskId)
      if (link === undefined || link.terminal === true) return false

      const detail = String(message).slice(0, 4_000)
      link.onFinal({ task_id: taskId, status: 'cancelled', message: detail })
      link.settle({ status: 'killed', detail })
      links.set(taskId, {
        jobId: link.jobId,
        terminal: true,
        fingerprint: fingerprint({ status: 'cancelled', message: detail }),
      })
      return true
    },
  }
}
