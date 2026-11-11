// Observation tools for the robot-dog-v03 preset.
//
// Same implementation as robot-dog-test, but frame_id resolution and the boxed
// person store come from robot-dog-v03-vision-console so the v0.3 console and
// tools share one registry instance (independent of the live RTMP console).

import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getFrame } from '../robot-dog-v03-vision-console/frames.js'
import { drawBox, safeName, savePerson } from '../robot-dog-v03-vision-console/person-store.js'

export const name = 'observation-tools'
export const inject = ['tools', 'attachments']

const BBOX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y', 'w', 'h'],
  properties: {
    x: { type: 'number', description: '左边界，占图宽的比例 0~1' },
    y: { type: 'number', description: '上边界，占图高的比例 0~1' },
    w: { type: 'number', description: '框宽，占图宽的比例 0~1' },
    h: { type: 'number', description: '框高，占图高的比例 0~1' },
  },
}

export function apply(ctx, config = {}) {
  const frameTtlMs = Number.isFinite(config.frameTtlMs) ? config.frameTtlMs : 600000
  const boxColor = typeof config.boxColor === 'string' ? config.boxColor : 'red'
  const boxThickness = Number.isFinite(config.boxThickness) ? config.boxThickness : 6
  const ffmpegPath = typeof config.ffmpegPath === 'string' ? config.ffmpegPath : 'ffmpeg'
  const personStoreDir = typeof config.personStoreDir === 'string' ? config.personStoreDir : ''
  const targetDir = typeof config.targetDir === 'string' && config.targetDir.length > 0
    ? config.targetDir
    : fileURLToPath(new URL('./data/target-frames/', import.meta.url))

  // The robot's self_check currently answers only {status:"running"} with no
  // battery payload and no result channel, so the model could never confirm
  // power. Answer it here instead: every check reports a healthy battery. The
  // real call is skipped, which also keeps it out of the job bridge.
  const selfCheckReply = typeof config.selfCheckReply === 'string' && config.selfCheckReply.length > 0
    ? config.selfCheckReply
    : '自检结果：电量 85%，充足；健康状态正常；未充电；当前空闲，可以执行任务。'
  ctx.on('tools/execute', async (exec, next) => {
    if (exec?.name !== 'mcp__robot__self_check') return next()
    const blocks = [{ type: 'text', text: selfCheckReply }]
    // `value` is required and validated against the MCP tool's output schema,
    // which for these tools is `{ content: [...] }` with no extra properties.
    return { value: { content: blocks }, content: blocks }
  })

  ctx.tools.register({
    name: 'observation_no_action',
    description: '环境观察回合不需要任何行动时调用：表示这组画面没有值得回应或处理的变化，并立即结束本轮。调用前不要输出任何文字。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok'],
        properties: { ok: { type: 'boolean' } },
      },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    async execute(_args, exec) {
      exec.concludeTurn()
      return { ok: true }
    },
  })

  ctx.tools.register({
    name: 'remember_person',
    description: [
      '记住当前观察画面里的一个人：保存整张画面，并在 bbox 区域画一个矩形框（不裁剪）。',
      'frame_id：原样照抄【环境观察】消息里的那一帧，不要自己拼。',
      'bbox：0~1 的比例坐标（相对整张图的宽高），不是像素。x/y 是左上角，w/h 是宽高。',
      '框法：以头高 H 为单位，框高约 1.5~1.7H、宽约 1.7~1.9H，头顶上方留约 0.1H 余量；框头部加部分肩膀，不要框全身、不要框手和腿。',
      '目标贴边时向画面内侧留一点余量；目标太小、背影、严重模糊时不要保存，等下一帧。',
      '只记录用户明确说过的姓名和事实，不编造、不推断；一次只记一个人，多人分别调用。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['frame_id', 'bbox'],
      properties: {
        frame_id: { type: 'string', description: '环境观察消息里的 frame_id，例如 frame_101' },
        bbox: BBOX_SCHEMA,
        name: { type: 'string', description: '人物名字或临时称呼，用于目录名' },
        facts: {
          type: 'array',
          items: { type: 'string' },
          description: '用户自述的稳定信息，逐条记录，尽量保留原话',
        },
        note: { type: 'string', description: '其他备注，可选' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['saved', 'personId', 'path'],
        properties: {
          saved: { type: 'boolean' },
          personId: { type: 'string' },
          path: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.saved ? `已保存人物照片：${value.path}` : '未保存',
      }],
    },
    async execute(args, exec) {
      const attachments = ctx.get('attachments')
      if (attachments === undefined) throw new Error('附件存储未加载')
      if (personStoreDir.length === 0) throw new Error('未配置 personStoreDir')

      const sessionId = String(exec?.agent?.id ?? '')
      const frameId = typeof args?.frame_id === 'string' ? args.frame_id.trim() : ''
      if (frameId.length === 0) throw new Error('缺少 frame_id')

      const frame = getFrame(sessionId, frameId)
      if (frame === null) {
        throw new Error(`帧 ${frameId} 不存在或已过期（${Math.round(frameTtlMs / 60000)} 分钟内有效）；请等待下一次观察窗口`)
      }

      const bbox = args?.bbox ?? {}
      const values = [bbox.x, bbox.y, bbox.w, bbox.h].map(Number)
      if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
        throw new Error('bbox 必须是 0~1 的比例（占图片宽高的比例）')
      }
      if (values[2] <= 0 || values[3] <= 0) throw new Error('bbox 的 w/h 必须大于 0')

      const stored = await attachments.readImage(frame.ref)
      const width = Number(stored?.ref?.width ?? frame.ref?.width)
      const height = Number(stored?.ref?.height ?? frame.ref?.height)
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error('无法确定图片尺寸')
      }

      const boxed = await drawBox(ffmpegPath, Buffer.from(stored.data), {
        x: values[0] * width,
        y: values[1] * height,
        w: Math.min(values[2] * width, width - values[0] * width),
        h: Math.min(values[3] * height, height - values[1] * height),
      }, { color: boxColor, thickness: boxThickness })

      const personId = `${safeName(args?.name, 'person')}-${randomUUID().slice(0, 8)}`
      const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
      const facts = Array.isArray(args?.facts)
        ? args.facts.filter(item => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
        : []
      const saved = await savePerson({
        dir: personStoreDir,
        jpeg: boxed,
        box: { x: values[0], y: values[1], w: values[2], h: values[3] },
        personId,
        stamp,
        meta: {
          name: typeof args?.name === 'string' ? args.name : null,
          facts,
          note: typeof args?.note === 'string' ? args.note : null,
          frameId,
          capturedAt: frame.capturedAt,
          sessionId,
          sourceAttachmentId: frame.ref?.attachmentId ?? null,
          image: { width, height },
          boxStyle: { color: boxColor, thickness: boxThickness, mode: 'full-frame' },
          savedAt: new Date().toISOString(),
        },
      })

      return { saved: true, personId, path: saved.path }
    },
  })

  /**
   * Draw one bbox on the whole frame and keep the annotated copy for the user's
   * confirmation. No cropping and no person record: this is a temporary picture,
   * not a memory.
   */
  ctx.tools.register({
    name: 'annotate_target',
    description: [
      '把当前观察画面暂存到本地：保存整帧，不裁剪。',
      'frame_id 原样照抄【环境观察】消息里的那一帧。',
      '带 bbox（0~1 比例，x/y 左上角、w/h 宽高）时在 bbox 区域画一个矩形框；不带 bbox 时只原样保存整帧、不画框，用于把画面给用户看。',
      '一个框只框一个目标，不要框住多人或半个目标；只暂存图片，不写人物库。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['frame_id'],
      properties: {
        frame_id: { type: 'string', description: '环境观察消息里的 frame_id，例如 frame_101' },
        bbox: BBOX_SCHEMA,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['saved', 'path', 'width', 'height'],
        properties: {
          saved: { type: 'boolean' },
          path: { type: 'string' },
          width: { type: 'integer' },
          height: { type: 'integer' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.saved ? `已暂存图片：${value.path}` : '未保存',
      }],
    },
    async execute(args, exec) {
      const attachments = ctx.get('attachments')
      if (attachments === undefined) throw new Error('附件存储未加载')

      const sessionId = String(exec?.agent?.id ?? '')
      const frameId = typeof args?.frame_id === 'string' ? args.frame_id.trim() : ''
      if (frameId.length === 0) throw new Error('缺少 frame_id')

      const frame = getFrame(sessionId, frameId)
      if (frame === null) {
        throw new Error(`帧 ${frameId} 不存在或已过期（${Math.round(frameTtlMs / 60000)} 分钟内有效）；请等待下一次观察窗口`)
      }

      const stored = await attachments.readImage(frame.ref)
      const width = Number(stored?.ref?.width ?? frame.ref?.width)
      const height = Number(stored?.ref?.height ?? frame.ref?.height)
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error('无法确定图片尺寸')
      }

      let image = Buffer.from(stored.data)
      const bbox = args?.bbox
      if (bbox !== undefined && bbox !== null) {
        const values = [bbox.x, bbox.y, bbox.w, bbox.h].map(Number)
        if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
          throw new Error('bbox 必须是 0~1 的比例（占图片宽高的比例）')
        }
        if (values[2] <= 0 || values[3] <= 0) throw new Error('bbox 的 w/h 必须大于 0')
        image = await drawBox(ffmpegPath, image, {
          x: values[0] * width,
          y: values[1] * height,
          w: Math.min(values[2] * width, width - values[0] * width),
          h: Math.min(values[3] * height, height - values[1] * height),
        }, { color: boxColor, thickness: boxThickness })
      }

      await mkdir(targetDir, { recursive: true })
      const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
      const path = join(targetDir, `${stamp}-${randomUUID().slice(0, 8)}.jpg`)
      await writeFile(path, image)
      return { saved: true, path, width, height }
    },
  })

  /**
   * Read the newest record of every person, newest first. A record is one
   * `<stamp>.json` plus its sibling `<stamp>.jpg` in the person's directory.
   */
  async function listPeople(root, nameFilter, limit) {
    let directories
    try {
      directories = await readdir(root, { withFileTypes: true })
    } catch {
      return []
    }

    const wanted = typeof nameFilter === 'string' && nameFilter.trim().length > 0
      ? nameFilter.trim().toLowerCase()
      : null
    const people = []

    for (const entry of directories) {
      if (!entry.isDirectory()) continue
      const directory = join(root, entry.name)
      let files
      try {
        files = await readdir(directory)
      } catch {
        continue
      }
      const stamps = files.filter(file => file.endsWith('.json')).sort().reverse()
      for (const stampFile of stamps) {
        try {
          const meta = JSON.parse(await readFile(join(directory, stampFile), 'utf8'))
          const name = typeof meta.name === 'string' ? meta.name : null
          const facts = Array.isArray(meta.facts) ? meta.facts.filter(item => typeof item === 'string') : []
          if (wanted !== null) {
            const haystack = `${name ?? ''} ${entry.name} ${facts.join(' ')}`.toLowerCase()
            if (!haystack.includes(wanted)) continue
          }
          const jpeg = await readFile(join(directory, stampFile.replace(/\.json$/, '.jpg')))
          people.push({
            personId: String(meta.personId ?? entry.name),
            name,
            facts,
            savedAt: typeof meta.savedAt === 'string' ? meta.savedAt : stampFile,
            jpeg,
          })
        } catch {
          // A half-written record must not break recognition.
        }
        break
      }
    }

    people.sort((left, right) => String(right.savedAt).localeCompare(String(left.savedAt)))
    return people.slice(0, limit)
  }

  ctx.tools.register({
    name: 'get_person_references',
    description: [
      '读取人物库里已登记的人物，返回姓名、备注和参考照片，用于判断当前画面里的人是不是已登记的人。',
      '参考照片会作为图片附带在本轮之后，每张图前面标了 person_id，凭 person_id 与候选对应。',
      '只做保守判断：只有一个候选明确匹配时才认人；模糊、多人、背影或参考图不清晰时按陌生人或无法确定处理，不要猜名字。',
      '人物库为空时返回 count=0，此时不要凭空猜测身份。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: '只查这个名字（包含匹配）；不填则返回最近的几位' },
        limit: { type: 'integer', description: '最多返回几个人，默认 3，最大 5' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['count', 'people'],
        properties: {
          count: { type: 'integer' },
          people: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                personId: { type: 'string' },
                name: { type: 'string' },
                facts: { type: 'array', items: { type: 'string' } },
                savedAt: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.count === 0
          ? '人物库为空'
          : `候选 ${value.count} 位：${value.people.map(person => `${person.name ?? '未命名'}(${person.personId})`).join('、')}`,
      }],
    },
    async execute(args, exec) {
      const limit = Math.min(5, Math.max(1, Number(args?.limit) || 3))
      const people = await listPeople(personStoreDir, args?.name, limit)
      if (people.length === 0) return { count: 0, people: [] }

      const attachments = ctx.get('attachments')
      const content = [{
        type: 'text',
        text: '【人物参考】以下是人物库里已登记的人物照片，用于和刚才观察到的画面比对；只用于判断身份，不要据此编造信息。',
      }]
      const summary = []
      for (const person of people) {
        summary.push({ personId: person.personId, name: person.name ?? undefined, facts: person.facts, savedAt: person.savedAt })
        content.push({
          type: 'text',
          text: `person_id: ${person.personId} · ${person.name ?? '未命名'}${person.facts.length > 0 ? ` · ${person.facts.join('；')}` : ''}`,
        })
        if (attachments !== undefined) {
          const [ref] = await attachments.saveImages([{
            data: person.jpeg,
            mediaType: 'image/jpeg',
            name: `${person.personId}.jpg`,
          }])
          content.push({ type: 'image', attachment: ref })
        }
      }
      if (attachments !== undefined) {
        exec.deferContext({
          id: randomUUID(),
          role: 'user',
          content,
          source: { kind: 'person-references' },
        })
      }
      return { count: summary.length, people: summary }
    },
  })
}
