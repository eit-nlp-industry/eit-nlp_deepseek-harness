import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { isAbsolute } from 'node:path'
import { realpathSync } from 'node:fs'

/**
 * 记录受信本地插件的实际注册调用点；不是代码作者或权限证明。
 * @param ownerFiber 调用 tools.register 的 Cordis 插件实例，供维护时核对 loader 身份。
 * @param registerModule tools 模块的 import.meta.url，用于精确跳过自身及 Cordis 反射桥。
 * 采集失败只记录空调用点，不能阻断原工具注册；不保存整条堆栈。
 */
export function captureRegistrationOrigin(ownerFiber, registerModule) {
  let callerFile = null
  const descriptor = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace')
  let replaced = false
  try {
    const require = createRequire(registerModule)
    const ignored = new Set([realpathSync(fileURLToPath(registerModule)), realpathSync(require.resolve('@deepseek-ai/cordis'))])
    Object.defineProperty(Error, 'prepareStackTrace', { value: (_error, sites) => sites, configurable: true, writable: true })
    replaced = true
    const error = {}
    Error.captureStackTrace(error, captureRegistrationOrigin)
    const sites = error.stack
    if (Array.isArray(sites)) for (const site of sites) {
      // eval/无真实文件不能越过去借用更远调用者的身份。
      const filename = site.getFileName()
      if (site.isEval() || typeof filename !== 'string') break
      const path = filename.startsWith('file:') ? fileURLToPath(filename) : filename
      if (!isAbsolute(path)) break
      const canonical = realpathSync(path)
      if (ignored.has(canonical)) continue
      callerFile = canonical
      break
    }
  } catch {
    callerFile = null
  } finally {
    if (replaced) {
      if (descriptor) Object.defineProperty(Error, 'prepareStackTrace', descriptor)
      else delete Error.prepareStackTrace
    }
  }
  return Object.freeze({ version: 1, ownerFiber, callerFile })
}
