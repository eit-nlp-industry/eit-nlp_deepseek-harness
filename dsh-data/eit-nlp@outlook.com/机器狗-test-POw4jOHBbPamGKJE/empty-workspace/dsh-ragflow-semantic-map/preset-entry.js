import { readFileSync } from 'node:fs'
import { apply as applyShared } from './index.js'

export { inject } from './index.js'
export const name = 'ragflow-semantic-map-preset-entry'

function filled(name) {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function apply(ctx, overrides = {}) {
  const defaults = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'))
  const fromEnv = {}
  const baseUrl = filled('RAGFLOW_BASE_URL')
  const datasetId = filled('RAGFLOW_DATASET_ID')
  if (baseUrl) fromEnv.baseUrl = baseUrl
  if (datasetId) fromEnv.datasetId = datasetId
  return applyShared(ctx, { ...defaults, ...fromEnv, ...overrides })
}
