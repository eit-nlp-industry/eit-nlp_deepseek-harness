import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

it('creates distinct v4 UUIDs when HTTP exposes random bytes without randomUUID', async () => {
  const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
  vi.stubGlobal('crypto', { getRandomValues })
  vi.resetModules()
  const { randomFillSync, randomUUID } = await import('../src/client/crypto-shim.ts')
  const ids = Array.from({ length: 32 }, () => randomUUID())
  for (const id of ids) expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/)
  expect(new Set(ids).size).toBe(ids.length)
  const bytes = new Uint8Array(16)
  expect(randomFillSync(bytes)).toBe(bytes)
  expect(bytes.some(byte => byte !== 0)).toBe(true)
})
