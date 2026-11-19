import { describe, expect, it, vi } from 'vitest'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { JobId, JobOutcome } from '@deepseek-ai/dsh-jobs'
import { JobController } from '../src/index.ts'
import { harness, registerAgent, wait } from './host-harness.ts'

/** 建立真实 Job 注册表与 Remote 控制器，提供所属会话。 */
async function setup() {
  const ctx = await harness()
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(JobController, {})
  const agent = await registerAgent(ctx, 'complete-owner')
  return { ctx, agent, controller: ctx.jobController }
}

/** 读取操作抛出的 Remote 业务错误码；run 为待拒绝的请求。 */
function failureCode(run: () => unknown): string | undefined {
  try { run() } catch (error) { return remoteErrorOf(error)?.code }
  throw new Error('expected RemoteError')
}

describe('JobController.complete', () => {
  it('completes through the producer and retains its model-facing result', async () => {
    const { ctx, agent, controller } = await setup()
    let settle!: (outcome: JobOutcome) => void
    const id = ctx.jobs.start({ kind: 'bash', label: 'opted in', owner: agent.id, run: () => ({
      cancel() {}, complete: () => settle({ status: 'completed', result: '用户已手动确认任务完成。' }),
      done: new Promise<JobOutcome>((resolve) => { settle = resolve }),
    }) })
    expect(controller.complete({ sessionId: agent.id, jobId: id })).toEqual({ outcome: 'requested' })
    await wait(0)
    expect(ctx.jobs.read(id, agent.id).result).toBe('用户已手动确认任务完成。')
    expect(controller.complete({ sessionId: agent.id, jobId: id })).toEqual({ outcome: 'already-finished' })
  })

  it('rejects foreign, unknown, unsupported and stopping jobs', async () => {
    const { ctx, agent, controller } = await setup()
    const other = await registerAgent(ctx, 'other-owner')
    const complete = vi.fn()
    const id = ctx.jobs.start({ kind: 'bash', label: 'opted in', owner: agent.id, run: () => ({ cancel() {}, complete, done: new Promise(() => {}) }) })
    expect(failureCode(() => controller.complete({ sessionId: other.id, jobId: id }))).toBe('job/not-found')
    expect(failureCode(() => controller.complete({ sessionId: agent.id, jobId: 'missing' as JobId }))).toBe('job/not-found')
    const unsupported = ctx.jobs.start({ kind: 'bash', label: 'unsupported', run: () => ({ cancel() {}, done: new Promise(() => {}) }) })
    expect(failureCode(() => controller.complete({ sessionId: agent.id, jobId: unsupported }))).toBe('job/not-completable')
    ctx.jobs.kill(id, agent.id)
    expect(failureCode(() => controller.complete({ sessionId: agent.id, jobId: id }))).toBe('job/not-completable')
    expect(complete).not.toHaveBeenCalled()
  })

  it('propagates a producer failure without reporting a successful completion', async () => {
    const { ctx, agent, controller } = await setup()
    const id = ctx.jobs.start({ kind: 'bash', label: 'broken', owner: agent.id, run: () => ({
      cancel() {}, complete() { throw new Error('complete boom') }, done: new Promise(() => {}),
    }) })
    expect(() => controller.complete({ sessionId: agent.id, jobId: id })).toThrow('complete boom')
    expect(ctx.jobs.get(id, agent.id).status).toBe('running')
  })
})
