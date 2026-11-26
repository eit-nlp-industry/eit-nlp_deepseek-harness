// Publish a saved person photo into the shared json-render media catalog.
//
// Copies the record JPG into the preset target directory, then registers a
// path relative to catalogRoot (the host mediaRoot) so render_ui can load it.

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

export const name = 'person-media'
export const inject = ['tools']

export function apply(ctx, config = {}) {
  const personStoreDir = typeof config.personStoreDir === 'string' ? config.personStoreDir.trim() : ''
  const targetDir = typeof config.targetDir === 'string' ? config.targetDir.trim() : ''
  const catalogRoot = typeof config.catalogRoot === 'string' ? config.catalogRoot.trim() : ''
  if (personStoreDir === '' || targetDir === '' || catalogRoot === '') {
    throw new Error('person-media: personStoreDir, targetDir, and catalogRoot are required')
  }

  // One writer at a time so two publishes cannot lose each other's catalog entry.
  let queue = Promise.resolve()

  async function latestRecord(personId) {
    let directories
    try {
      directories = await readdir(personStoreDir, { withFileTypes: true })
    } catch {
      return null
    }
    let best = null
    for (const entry of directories) {
      if (!entry.isDirectory()) continue
      const directory = join(personStoreDir, entry.name)
      let files
      try {
        files = await readdir(directory)
      } catch {
        continue
      }
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        try {
          const meta = JSON.parse(await readFile(join(directory, file), 'utf8'))
          if (meta === null || typeof meta !== 'object' || meta.personId !== personId) continue
          const savedAt = typeof meta.savedAt === 'string' ? meta.savedAt : file
          if (best === null || savedAt > best.savedAt) {
            best = { jpegPath: join(directory, file.replace(/\.json$/, '.jpg')), meta, savedAt }
          }
        } catch {
          // A half-written record must not break the lookup.
        }
      }
    }
    return best
  }

  function publish(personId) {
    const run = async () => {
      const record = await latestRecord(personId)
      if (record === null) {
        throw new Error('人物库里没有这个人的保存记录')
      }
      const jpeg = await readFile(record.jpegPath)
      const id = `person-${randomUUID().slice(0, 8)}`
      const fileName = `${id}.jpg`
      await mkdir(targetDir, { recursive: true })
      const absolute = join(targetDir, fileName)
      await writeFile(absolute, jpeg)

      const file = relative(catalogRoot, resolve(absolute)).split('\\').join('/')
      if (file === '' || file.startsWith('..')) {
        throw new Error('person-media: published file is outside catalogRoot')
      }

      const indexPath = join(catalogRoot, 'index.json')
      let catalog = { assets: [] }
      try {
        const parsed = JSON.parse(await readFile(indexPath, 'utf8'))
        if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.assets)) catalog = parsed
      } catch {
        // A missing or malformed catalog starts a fresh one.
      }
      if (!catalog.assets.some(asset => asset !== null && typeof asset === 'object' && asset.id === id)) {
        catalog.assets.push({
          id,
          file,
          alt: typeof record.meta.name === 'string' && record.meta.name !== '' ? record.meta.name : '已登记人物',
        })
        const temporary = `${indexPath}.${process.pid}.tmp`
        await writeFile(temporary, JSON.stringify(catalog, null, 2) + '\n')
        await rename(temporary, indexPath)
      }
      return {
        ok: true,
        asset_id: id,
        person_id: personId,
        name: typeof record.meta.name === 'string' ? record.meta.name : undefined,
        path: absolute,
      }
    }
    queue = queue.then(run, run)
    return queue
  }

  ctx.tools.register({
    name: 'publish_person_image',
    description: [
      '把人物库里这个人保存的照片登记到渲染目录，返回 asset_id，用于用 render_ui 显示这张已保存的照片。',
      '只在认出人之后调用；只读人物库，不修改人物资料。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['personId'],
      properties: {
        personId: { type: 'string', description: 'get_person_references 返回的 person_id' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'asset_id', 'person_id', 'path'],
        properties: {
          ok: { type: 'boolean' },
          asset_id: { type: 'string' },
          person_id: { type: 'string' },
          name: { type: 'string' },
          path: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已准备人物照片：${value.name ?? value.person_id}\nasset_id：${value.asset_id}`,
      }],
    },
    async execute(args) {
      const personId = String(args?.personId ?? '').trim()
      if (personId === '') throw new Error('缺少 personId')
      return publish(personId)
    },
  })
}
