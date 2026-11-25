// Publish annotated target frames into the shared json-render media catalog.
//
// `annotate_target` saves a boxed JPG under the preset target directory, but
// render_ui only reads mediaRoot/index.json. This interceptor appends a
// relative path under catalogRoot and returns the asset id.

import { readFile, rename, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'

export const name = 'annotate-media'
export const inject = ['tools']

export function apply(ctx, config = {}) {
  const catalogRoot = typeof config.catalogRoot === 'string' ? config.catalogRoot.trim() : ''
  if (catalogRoot === '') {
    throw new Error('annotate-media: catalogRoot is required')
  }

  // One writer at a time: two annotations must not lose each other's entry.
  let queue = Promise.resolve()

  function publish(filePath) {
    const run = async () => {
      const absolute = resolve(filePath)
      const file = relative(catalogRoot, absolute).split('\\').join('/')
      if (file === '' || file.startsWith('..')) {
        throw new Error('annotate-media: annotated file is outside catalogRoot')
      }
      const stemId = basename(absolute).replace(/\.[^.]+$/, '')
      const indexPath = join(catalogRoot, 'index.json')
      let catalog = { assets: [] }
      try {
        const parsed = JSON.parse(await readFile(indexPath, 'utf8'))
        if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.assets)) {
          catalog = parsed
        }
      } catch {
        // A missing or malformed catalog starts a fresh one.
      }
      // Prefer an existing row for the same file (e.g. historical frame-* ids) so
      // old chat cards and new annotate results resolve the same /api/media id.
      const byFile = catalog.assets.find(asset => (
        asset !== null && typeof asset === 'object' && asset.file === file && typeof asset.id === 'string'
      ))
      if (byFile !== undefined) return byFile.id
      const byId = catalog.assets.find(asset => (
        asset !== null && typeof asset === 'object' && asset.id === stemId
      ))
      if (byId !== undefined) return stemId
      catalog.assets.push({ id: stemId, file, alt: '现场确认图' })
      const temporary = `${indexPath}.${process.pid}.tmp`
      await writeFile(temporary, JSON.stringify(catalog, null, 2) + '\n')
      await rename(temporary, indexPath)
      return stemId
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
      const value = {
        ...(result.value !== null && typeof result.value === 'object' ? result.value : {}),
        asset_id: assetId,
      }
      return {
        ...result,
        value,
        content: [{
          type: 'text',
          text: [
            `已暂存图片并登记媒体目录。`,
            `asset_id：${assetId}`,
            `render_ui 的 business_data.image.assetId 必须用上面的 asset_id 短串，禁止把 path 或绝对路径当作 assetId。`,
            `示例：components=["Image"]，business_data={"image":{"assetId":"${assetId}"}}，answer_presentation 用 supplement。`,
          ].join('\n'),
        }],
      }
    } catch {
      return result
    }
  })
}
