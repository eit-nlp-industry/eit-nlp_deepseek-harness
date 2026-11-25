// remember_person: crop one person out of the image camera_look returned.
//
// The image is already persisted by the attachment store, so this tool crops
// exactly the bytes the model saw — no re-projection, no frame cache. Pass the
// image reference back verbatim plus a bbox in that image's pixel coordinates.

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { resolveFfmpeg } from './ffmpeg.js'
import { getView } from './views.js'

export const name = 'person-tools'
export const inject = ['tools']

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

const IMAGE_REF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
  properties: {
    attachmentId: { type: 'string', description: 'camera_look 返回的 image.attachmentId' },
    mediaType: { type: 'string' },
    bytes: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
  },
}

const BBOX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y', 'w', 'h'],
  properties: {
    x: { type: 'number', description: '左边界，占图宽的比例 0~1' },
    y: { type: 'number', description: '上边界，占图高的比例 0~1' },
    w: { type: 'number', description: '宽度，占图宽的比例 0~1' },
    h: { type: 'number', description: '高度，占图高的比例 0~1' },
  },
}

function safeName(name, fallback) {
  if (typeof name !== 'string') return fallback
  const trimmed = name.trim().slice(0, 64)
  return /^[\p{L}\p{N}_-]+$/u.test(trimmed) ? trimmed : fallback
}

function ffmpegCrop(ffmpeg, jpeg, crop) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'jpeg_pipe', '-i', 'pipe:0',
      '-vf', `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`,
      '-frames:v', '1',
      '-c:v', 'mjpeg', '-q:v', '2',
      '-f', 'image2pipe',
      '-',
    ]
    const proc = spawn(ffmpeg, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = []
    const errors = []
    let total = 0
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('ffmpeg crop timed out'))
    }, 5_000)
    proc.stdout.on('data', chunk => {
      total += chunk.length
      if (total > MAX_OUTPUT_BYTES) {
        proc.kill('SIGKILL')
        reject(new Error('crop output exceeded the size limit'))
        return
      }
      chunks.push(chunk)
    })
    proc.stderr.on('data', chunk => errors.push(chunk))
    proc.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    proc.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(errors.join('').trim() || `ffmpeg exited with ${code}`))
        return
      }
      resolve(Buffer.concat(chunks))
    })
    proc.stdin.on('error', () => {})
    proc.stdin.end(jpeg)
  })
}

export function apply(ctx, config = {}) {
  const ffmpeg = resolveFfmpeg(config.ffmpegPath)
  const personsDir = typeof config.personsDir === 'string' && config.personsDir.startsWith('/')
    ? config.personsDir
    : null

  ctx.tools.register({
    name: 'remember_person',
    description: '裁剪并保存 camera_look 返回的某张视图里的一个人。优先用 view_id（形如 v3），'
      + '也接受完整的 image 引用对象；bbox 用 0~1 的比例坐标（占图宽/图高），工具内部换算成像素后裁剪。',
    parameters: {
      type: 'object',
      properties: {
        view_id: { type: 'string', description: 'camera_look / get_camera_frame 返回的短 id，例如 v3' },
        frame_id: { type: 'string', description: 'get_camera_frame 返回的 frame_id，与 view_id 等价' },
        image: IMAGE_REF_SCHEMA,
        bbox: BBOX_SCHEMA,
        name: { type: 'string', description: '人物名字或临时称呼，用于目录名' },
        facts: {
          type: 'array',
          items: { type: 'string' },
          description: '用户自述的稳定信息，逐条记录，尽量保留原话（例如“做机器狗的”“喜欢喝美式”）',
        },
        note: { type: 'string', description: '其他备注，可选' },
      },
      required: ['bbox'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['saved', 'path', 'crop'],
        properties: {
          saved: { type: 'boolean' },
          path: { type: 'string' },
          crop: BBOX_SCHEMA,
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已保存人物照片：${value.path}`,
      }],
    },
    async execute(args) {
      if (personsDir === null) throw new Error('未配置 personsDir，无法保存人物照片')
      const attachments = ctx.get('attachments')
      if (attachments === undefined) throw new Error('附件存储未加载')

      const frameRef = typeof args?.view_id === 'string' && args.view_id.length > 0
        ? args.view_id
        : (typeof args?.frame_id === 'string' ? args.frame_id : null)
      let image = null
      if (frameRef !== null && frameRef.length > 0) {
        image = getView(frameRef)
        if (image === null) {
          throw new Error(`帧 ${frameRef} 不存在或已过期（10 分钟内有效）；请重新调用 get_camera_frame 取一张`)
        }
      } else if (args?.image !== null && typeof args?.image === 'object'
        && typeof args.image.attachmentId === 'string' && args.image.attachmentId.length > 0) {
        image = args.image
      } else {
        throw new Error('缺少 view_id 或 image；请传 camera_look 返回的 view_id（例如 v3）')
      }

      const stored = await attachments.readImage(image)
      const jpeg = Buffer.from(stored.data)
      const width = Number(stored.ref?.width ?? image.width)
      const height = Number(stored.ref?.height ?? image.height)
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error('无法确定图片尺寸')
      }

      const bbox = args?.bbox ?? {}
      const nx = Number(bbox.x)
      const ny = Number(bbox.y)
      const nw = Number(bbox.w)
      const nh = Number(bbox.h)
      for (const [key, value] of [['x', nx], ['y', ny], ['w', nw], ['h', nh]]) {
        if (!Number.isFinite(value) || value < 0 || value > 1) {
          throw new Error(`bbox.${key} 必须是 0~1 的比例（占图片宽高的百分比）`)
        }
      }
      if (nw <= 0 || nh <= 0) throw new Error('bbox 的 w/h 必须大于 0')

      const x = Math.max(0, Math.round(nx * width))
      const y = Math.max(0, Math.round(ny * height))
      const w = Math.min(width - x, Math.round(nw * width))
      const h = Math.min(height - y, Math.round(nh * height))
      if (w <= 0 || h <= 0) throw new Error('bbox 超出图片范围')

      const crop = await ffmpegCrop(ffmpeg, jpeg, { x, y, w, h })

      const dirName = safeName(args?.name, `person-${Date.now()}`)
      const directory = join(personsDir, dirName)
      await mkdir(directory, { recursive: true })
      const stamp = new Date().toISOString().replaceAll(':', '-')
      const file = join(directory, `${stamp}.jpg`)
      await writeFile(file, crop)
      const facts = Array.isArray(args?.facts)
        ? args.facts.filter(item => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
        : []
      await writeFile(`${file}.json`, JSON.stringify({
        name: args?.name ?? null,
        facts,
        note: args?.note ?? null,
        savedAt: new Date().toISOString(),
        image: { attachmentId: image.attachmentId, width, height },
        bbox: { x, y, w, h },
        originalBbox: bbox,
      }, null, 2))

      return { saved: true, path: file, crop: { x, y, w, h } }
    },
  })
}
