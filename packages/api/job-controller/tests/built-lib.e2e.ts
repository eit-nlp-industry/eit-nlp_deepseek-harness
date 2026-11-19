import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Built-artifact smoke for the generated job Remote codecs. This package's
 * program compiles only the `JobKindMap` merges it can see (`bash`,
 * `subagent`), while the Host registers `pwsh`, `pty-send`, and every other
 * producer kind, so the wire projection's `kind` must reach the codec as an
 * open string rather than the literal union this program observes.
 */

const artifact = join(fileURLToPath(new URL('..', import.meta.url)), 'lib/typert.host.js')

interface BuiltCodec {
  create(): { safeParse(value: unknown): { success: boolean; data?: unknown } }
}

interface BuiltInvocation {
  readonly method: string
  readonly parameters: readonly { readonly codec: BuiltCodec }[]
  readonly result: BuiltCodec
}

const row = {
  id: 'pty-send-1',
  kind: 'pty-send',
  label: 'send',
  status: 'running',
  startedAt: 1,
  output: { total: 0, earliest: 0 },
}

describe.skipIf(!existsSync(artifact))('job Remote built codecs', () => {
  it('accept a row whose kind this program never compiled, and still reject a status outside the lifecycle', async () => {
    const { TYPERT } = await import(pathToFileURL(artifact).href) as { TYPERT: { invocations: readonly BuiltInvocation[] } }
    const schemaOf = (method: string): ReturnType<BuiltInvocation['result']['create']> => {
      const invocation = TYPERT.invocations.find(candidate => candidate.method === method)
      if (invocation === undefined) throw new Error(`no generated job.${method} invocation`)
      return invocation.result.create()
    }
    expect(schemaOf('list').safeParse({ type: 'rows', jobs: [row] }).success).toBe(true)
    expect(schemaOf('follow').safeParse({ type: 'opened', job: row, from: 0 }).success).toBe(true)
    expect(schemaOf('follow').safeParse({ type: 'status', job: { ...row, status: 'paused' } }).success).toBe(false)
  })
})


describe.skipIf(!existsSync(artifact))('manual completion built codecs', () => {
  it('exposes complete and validates its request and admission response', async () => {
    const { TYPERT } = await import(pathToFileURL(artifact).href) as { TYPERT: { invocations: readonly BuiltInvocation[] } }
    const invocation = TYPERT.invocations.find(candidate => candidate.method === 'complete')
    expect(invocation).toBeDefined()
    if (invocation === undefined) throw new Error('no generated job.complete invocation')
    const request = invocation.parameters[0]!.codec.create()
    expect(request.safeParse({ sessionId: 'session-1', jobId: 'robot-1' })).toMatchObject({
      success: true, data: { sessionId: 'session-1', jobId: 'robot-1' },
    })
    expect(request.safeParse({ jobId: 'robot-1' }).success).toBe(false)
    expect(request.safeParse({ sessionId: 'session-1', jobId: 1 }).success).toBe(false)
    expect(invocation.result.create().safeParse({ outcome: 'requested' }).success).toBe(true)
    expect(invocation.result.create().safeParse({ outcome: 'already-finished' }).success).toBe(true)
  })

  it('retains the opt-in capability through list and follow result codecs', async () => {
    const { TYPERT } = await import(pathToFileURL(artifact).href) as { TYPERT: { invocations: readonly BuiltInvocation[] } }
    const enabled = { ...row, kind: 'robot', canComplete: true }
    for (const [method, value] of [
      ['list', { type: 'rows', jobs: [enabled] }],
      ['follow', { type: 'opened', job: enabled, from: 0 }],
    ] as const) {
      const invocation = TYPERT.invocations.find(candidate => candidate.method === method)
      if (invocation === undefined) throw new Error(`no generated job.${method} invocation`)
      // 检查解析后的 data，防止旧 codec 接受响应却剥除 canComplete。
      expect(invocation.result.create().safeParse(value)).toMatchObject({ success: true, data: value })
    }
  })
})
