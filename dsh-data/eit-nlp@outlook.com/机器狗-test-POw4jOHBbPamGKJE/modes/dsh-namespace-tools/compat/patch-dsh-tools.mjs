import { createHash } from 'node:crypto'
import { readFile, writeFile, rename, access, stat, chmod, chown, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const expectedHash = '1889cbf718d64518dd83245d4dba1e1f080b2c5326259c3ed5b1be7a7666a2bd'
const helperName = 'namespace-registration-origin.js'
const marker = "import { captureRegistrationOrigin } from './namespace-registration-origin.js';\n"

/** 计算 text 的摘要，用来拒绝未验证的 DSH 编译产物。 */
function hash(text) { return createHash('sha256').update(text).digest('hex') }

/** 从 original 生成唯一已验证的补丁；不会覆盖未知源码。 */
function patch(original) {
  if (hash(original) !== expectedHash) throw new Error('DSH_SOURCE_UNSUPPORTED: 原始文件摘要不匹配')
  return marker + original
    .replace('var ToolsService = class extends Service {', 'var ToolsService = class extends Service {\n\tnamespaceProvenanceVersion = 1;')
    .replace('return this.layers.effect(this.ctx, (layer) => layer.tools.insert(name, {',
      'const namespaceOrigin = captureRegistrationOrigin(this.ctx.fiber, import.meta.url);\n\t\treturn this.layers.effect(this.ctx, (layer) => layer.tools.insert(name, {')
    .replace('when: options.when\n\t\t}), { label: "tools.register()" });',
      'when: options.when,\n\t\t\tnamespaceOrigin\n\t\t}), { label: "tools.register()" });')
}

/** 新建 path 并保留原模块的权限与所有权；text 为待写内容，original 为原文件 stat。 */
async function writePreserving(path, text, original) {
  let created = false
  try {
    await writeFile(path, text, { flag: 'wx', mode: original.mode })
    created = true
    const actual = await stat(path)
    if (actual.uid !== original.uid || actual.gid !== original.gid) await chown(path, original.uid, original.gid)
    await chmod(path, original.mode)
  } catch (error) {
    if (created) await rm(path, { force: true })
    throw error
  }
}

/**
 * 验证并可选应用固定 alpha.2 补丁；argv 为 --module-dir 路径及可选 --apply。
 * 默认只检查；显式应用时备份原文件、保留 mode，再原子替换入口。
 */
async function main(argv) {
  const apply = argv.includes('--apply'), args = argv.filter(arg => arg !== '--apply')
  if (args.length !== 2 || args[0] !== '--module-dir' || argv.filter(arg => arg === '--apply').length > 1) {
    throw new Error('usage: node compat/patch-dsh-tools.mjs --module-dir /absolute/node_modules [--apply]')
  }
  const directory = resolve(args[1], '@deepseek-ai/dsh-tools'), entry = join(directory, 'lib/index.js')
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-tools' || manifest.version !== '0.2.2-alpha.2') throw new Error('DSH_VERSION_UNSUPPORTED')
  const current = await readFile(entry, 'utf8'), backup = entry + '.namespace-origin.original'
  const helper = await readFile(new URL('./registration-origin.js', import.meta.url), 'utf8')
  const helperPath = join(directory, 'lib', helperName)
  if (current.startsWith(marker)) {
    const original = await readFile(backup, 'utf8')
    if (current !== patch(original) || await readFile(helperPath, 'utf8') !== helper) throw new Error('DSH_PATCH_CONFLICT')
    console.log('ALREADY_APPLIED: verified namespace origin patch')
    return
  }
  const candidate = patch(current)
  for (const path of [backup, helperPath]) {
    try { await access(path); throw new Error('DSH_PATCH_CONFLICT: target artifact already exists') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  if (!apply) { console.log('DRY_RUN_OK: verified alpha.2 source; no files changed'); return }
  const originalStat = await stat(entry), temporary = entry + '.namespace-origin.tmp'
  const created = []
  try {
    for (const [path, content] of [[backup, current], [helperPath, helper], [temporary, candidate]]) {
      await writePreserving(path, content, originalStat)
      created.push(path)
    }
    // 再次校验入口，拒绝准备期间发生的并发替换。
    if (await readFile(entry, 'utf8') !== current) throw new Error('DSH_PATCH_CONFLICT: source changed during apply')
    await rename(temporary, entry)
  } catch (error) {
    for (const path of created.reverse()) await rm(path, { force: true })
    throw error
  }
  console.log('APPLIED: backup at ' + backup)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
