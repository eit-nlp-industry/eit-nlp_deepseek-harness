import { realpathSync, readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, isAbsolute, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensure } from './automation/core.js'

/**
 * 校验并冻结部署者声明的业务源码根目录；input 的元素是绝对目录，不是工具/插件名称。
 * realpath 将符号链接归一化，后续以路径边界而非字符串前缀判断来源。
 */
export function developerRoots(input = []) {
  ensure(Array.isArray(input) && Array.from(input).every(path => typeof path === 'string' && isAbsolute(path)),
    'DEVELOPER_ROOTS_INVALID: developerPluginRoots 必须是绝对目录数组')
  let roots
  try {
    roots = input.map(path => {
      const canonical = realpathSync(path)
      ensure(statSync(canonical).isDirectory(), 'DEVELOPER_ROOTS_INVALID: 业务根必须是目录')
      return canonical
    }).sort()
  } catch { throw new Error('DEVELOPER_ROOTS_INVALID: 业务根目录不存在或不可读取') }
  ensure(new Set(roots).size === roots.length, 'DEVELOPER_ROOTS_INVALID: 业务根目录重复')
  return Object.freeze(roots)
}

/** 读取 callerFile 最近 package.json 的名称和版本；不能读取时由调用者报告 unknown。 */
function packageOwner(callerFile) {
  let directory = dirname(callerFile)
  while (true) {
    const file = join(directory, 'package.json')
    if (existsSync(file)) {
      const manifest = JSON.parse(readFileSync(file, 'utf8'))
      ensure(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'PACKAGE_INVALID')
      const name = manifest.name ?? null, version = manifest.version ?? null
      ensure((name === null || typeof name === 'string') && (version === null || typeof version === 'string'), 'PACKAGE_INVALID')
      return { packageName: name, packageVersion: version, packageFile: realpathSync(file) }
    }
    const parent = dirname(directory)
    if (parent === directory) return { packageName: null, packageVersion: null, packageFile: null }
    directory = parent
  }
}

/** 判断 file 是否位于 root 的真实目录边界内，禁止前缀相似目录和根内 node_modules 混入。 */
function insideRoot(file, root) {
  const path = relative(root, file)
  return path !== '..' && !path.startsWith('../') && !isAbsolute(path) && !path.split(/[\\/]/).includes('node_modules')
}

/**
 * 创建维护实例的来源解析器；roots 是已归一化业务源码目录，元素来自一次部署配置。
 * UUID 仅标识进程内 owner/注册实例，不把 fiber 对象、插件配置或整条堆栈序列化。
 */
export function createProvenance(roots) {
  const identities = new WeakMap()
  /** 为 object 分配稳定的本实例身份，用于发现卸载重建和重新注册。 */
  const identity = object => {
    if (!identities.has(object)) identities.set(object, randomUUID())
    return identities.get(object)
  }
  /** 解析 registration 的受信来源事实；runtimeName 用于诊断，不参与 builtin/custom 推断。 */
  return function resolveOrigin(registration, runtimeName) {
    const report = { runtimeName, status: 'unknown', reason: 'ORIGIN_MISSING' }
    const origin = registration?.namespaceOrigin
    if (origin?.version !== 1) return report
    const owner = origin.ownerFiber
    if (!owner || typeof owner !== 'object') return report
    report.ownerId = identity(owner)
    report.registrationId = identity(registration)
    const entry = owner.entry
    if (!entry || owner.uid === null || entry.fiber?.ctx?.fiber !== owner || !entry.moduleNamespace) {
      return { ...report, reason: 'DIRECT_LOADER_OWNER_UNVERIFIED' }
    }
    try {
      const callback = owner.ctx.registry.resolve(entry.loader.unwrapExports(entry.moduleNamespace))
      if (callback !== owner.runtime?.callback) return { ...report, reason: 'LOADER_CALLBACK_MISMATCH' }
      ensure(typeof entry.options?.name === 'string' && typeof entry.id === 'string', 'LOADER_METADATA_INVALID')
      report.pluginEntryId = entry.id
      report.pluginSpecifier = entry.options.name
    } catch { return { ...report, reason: 'LOADER_METADATA_UNAVAILABLE' } }
    if (typeof origin.callerFile !== 'string' || !isAbsolute(origin.callerFile)) return { ...report, reason: 'CALLSITE_UNAVAILABLE' }
    try {
      report.callerFile = realpathSync(origin.callerFile)
      ensure(statSync(report.callerFile).isFile(), 'CALLSITE_NOT_FILE')
      Object.assign(report, packageOwner(report.callerFile))
    } catch { return { ...report, reason: 'CALLSITE_PACKAGE_UNAVAILABLE' } }
    if (report.packageName?.startsWith('@deepseek-ai/')) return { ...report, status: 'builtin', reason: 'HARNESS_PACKAGE' }
    if (!roots.some(root => insideRoot(report.callerFile, root))) return { ...report, reason: 'OUTSIDE_DEVELOPER_ROOTS' }
    return { ...report, status: 'custom', reason: 'VERIFIED_DEVELOPER_SOURCE' }
  }
}
