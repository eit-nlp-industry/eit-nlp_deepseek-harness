import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { install } from './index.js'
import { normalizeConfig } from './config.js'
import { createMaintenance } from './maintenance.js'

export { inject } from './index.js'
export const name = 'namespace-tools-preset-entry'

/**
 * 安装时读取并校验唯一配置文件一次；修改文件后需 restart Harness 才会采用。
 * @param ctx DSH 预设上下文。
 * @param overrides 允许 enabled、绝对 configPath 及默认关闭的 maintenance；namespace 策略来自文件。
 */
export function apply(ctx, overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)
    || Object.keys(overrides).some(key => !['enabled', 'configPath', 'maintenance'].includes(key))) {
    throw new Error('CONFIG_OVERRIDE_FORBIDDEN: 预设只允许 enabled/configPath/maintenance，分组与可见性策略由文件维护')
  }
  const path = overrides.configPath ?? fileURLToPath(new URL('./config.json', import.meta.url))
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('CONFIG_PATH_INVALID: configPath 必须是绝对路径')
  const input = { ...JSON.parse(readFileSync(path, 'utf8')),
    ...(Object.hasOwn(overrides, 'enabled') ? { enabled: overrides.enabled } : {}) }
  normalizeConfig(input)
  if (Object.hasOwn(overrides, 'maintenance')) {
    const maintenance = overrides.maintenance
    if (!maintenance || typeof maintenance !== 'object' || Array.isArray(maintenance) || Object.hasOwn(maintenance, 'configPath')) {
      throw new Error('MAINTENANCE_CONFIG_INVALID: 维护配置必须继承入口的实际 configPath')
    }
    if (input.enabled === true) createMaintenance(ctx, { ...maintenance, configPath: path })
  }
  return install(ctx, input)
}
