// Publish annotated target frames into the json-render media catalog.
//
// `annotate_target` saves a boxed JPG under the target directory, but the
// render_ui Image component can only show assets listed in that directory's
// index.json. This interceptor appends the new file to the catalog after a
// successful annotation and hands the model the asset id, so the
// remember-person skill can display the framed picture with render_ui instead
// of a generic file card.

import { readFile, rename, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export const name = 'annotate-media'
export const inject = ['tools']

export function apply(ctx, config = {}) {
  const targetDir = typeof config.targetDir === 'string' ? config.targetDir.trim() : ''
  if (targetDir === '') {
    throw new Error('annotate-media: targetDir is required')
  }

  // One writer at a time: two annotations must not lose each other's entry.
  let queue = Promise.resolve()

  function publish(filePath) {
    const run = async () => {
      const file = basename(filePath)
      const id = file.replace(/\.[^.]+$/, '')
      const indexPath = join(targetDir, 'index.json')
      let catalog = { assets: [] }
      try {
        const parsed = JSON.parse(await readFile(indexPath, 'utf8'))
        if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.assets)) {
          catalog = parsed
        }
      } catch {
        // A missing or malformed catalog starts a fresh one.
      }
      if (catalog.assets.some(asset => asset !== null && typeof asset === 'object' && asset.id === id)) {
        return id
      }
      catalog.assets.push({ id, file, alt: '记人确认图' })
      const temporary = `${indexPath}.${process.pid}.tmp`
      await writeFile(temporary, JSON.stringify(catalog, null, 2))
      await rename(temporary, indexPath)
      return id
    }
    queue = queue.then(run, run)
    return queue
  }

  ctx.on('tools/execute', async (exec, next) => {
    const result = await next()
    if (exec?.name !== 'annotate_target') return result
    if (result?.isError === true) return result
    const path = result?.value?.path
    if (typeof path !== 'string' || path === '') return result
    try {
      const assetId = await publish(path)
      return {
        ...result,
        content: [{
          type: 'text',
          text: `已暂存图片：${path}\nasset_id：${assetId}\n下一步必须用 render_ui 显示这张图：components=["Image"]，business_data 只放 {"image":{"assetId":"${assetId}"}}，answer_presentation 用 supplement；不要用 present。`,
        }],
      }
    } catch {
      return result
    }
  })
}
