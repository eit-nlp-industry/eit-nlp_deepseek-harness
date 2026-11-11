import { readFileSync } from 'node:fs'
import { apply as applyShared } from './index.js'

export { inject } from './index.js'
export const name = 'ragflow-tools-preset-entry'

export function apply(ctx, overrides = {}) {
  const defaults = JSON.parse(readFileSync(new URL('./config.local.json', import.meta.url), 'utf8'))
  return applyShared(ctx, { ...defaults, ...overrides })
}
