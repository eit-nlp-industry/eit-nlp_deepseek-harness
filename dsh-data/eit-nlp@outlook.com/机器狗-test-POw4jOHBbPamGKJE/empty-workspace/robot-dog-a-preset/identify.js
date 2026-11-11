// Face identification shared by the observe loop and the identify_person tool.
//
// Demo scope: PersonMemory holds one person, so one vision call answers
// "same person or not". No embeddings, no multi-candidate ranking.

import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Newest face image of the single known person, or null when empty. */
export async function referenceFace(personsDir) {
  if (typeof personsDir !== 'string') return null
  const entries = await readdir(personsDir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const directory = join(personsDir, entry.name)
    const files = await readdir(directory).catch(() => [])
    const face = files.filter(name => name.endsWith('.jpg')).sort().at(-1)
    if (face === undefined) continue
    return { name: entry.name, jpeg: await readFile(join(directory, face)) }
  }
  return null
}

function userMessage(text, extra) {
  return {
    id: randomUUID(),
    role: 'user',
    source: { kind: 'identify_person' },
    content: [{ type: 'text', text }, ...extra],
  }
}

/**
 * Compare the current face against the single reference.
 * @returns {{status:'ok', match:boolean, name:string}
 *   | {status:'no-reference'}
 *   | {status:'unavailable', reason:string}}
 */
export async function identifyFace(options) {
  const {
    llm, attachments, personsDir, provider, model, jpeg, bbox, cropFace,
  } = options
  if (llm === undefined || attachments === undefined) {
    return { status: 'unavailable', reason: 'LLM 或附件服务未加载' }
  }

  const reference = await referenceFace(personsDir)
  if (reference === null) return { status: 'no-reference' }

  let face = jpeg
  if (bbox !== undefined && bbox !== null && typeof cropFace === 'function') {
    const width = Number(bbox.width)
    const height = Number(bbox.height)
    const x = Math.max(0, Math.round(Number(bbox.x) * width))
    const y = Math.max(0, Math.round(Number(bbox.y) * height))
    const w = Math.min(width - x, Math.round(Number(bbox.w) * width))
    const h = Math.min(height - y, Math.round(Number(bbox.h) * height))
    if (w > 0 && h > 0) face = await cropFace(jpeg, { x, y, w, h })
  }

  const current = await attachments.saveImage({ data: face, mediaType: 'image/jpeg', name: 'identify.jpg' })
  const known = await attachments.saveImage({ data: reference.jpeg, mediaType: 'image/jpeg', name: 'reference.jpg' })

  const message = userMessage(
    `第一张是当前画面里的人，第二张是已记录的「${reference.name}」。是同一个人吗？`
      + '只输出 JSON：{"match": true} 或 {"match": false}',
    [{ type: 'image', attachment: current }, { type: 'image', attachment: known }],
  )

  let text = ''
  for await (const chunk of llm.stream({
    provider, model, messages: [message], maxTokens: 200, reasoningEffort: 'off',
  })) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
  }

  return { status: 'ok', match: /"match"\s*:\s*true/.test(text), name: reference.name }
}
