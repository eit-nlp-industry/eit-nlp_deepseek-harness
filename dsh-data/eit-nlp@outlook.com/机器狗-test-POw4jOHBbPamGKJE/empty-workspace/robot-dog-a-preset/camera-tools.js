// get_camera_frame: freeze the current video frame for the model.
//
// The provider keeps a rolling latest frame; this tool copies it into a durable
// attachment and returns a short frame id, so the model can look at one frame
// and a later tool can crop exactly those bytes.

import { putView } from './views.js'

export const name = 'frame-tools'
export const inject = ['tools', 'attachments']

const IMAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attachmentId: { type: 'string' },
    mediaType: { type: 'string' },
    bytes: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
  },
}

export function apply(ctx, config = {}) {
  ctx.tools.register({
    name: 'get_camera_frame',
    description: '取摄像头当前最新的一帧（原子快照，之后画面变化也不会影响这一帧）。返回 frame_id 和图片；'
      + '需要裁人时把 frame_id 交给 remember_person，不要重新取帧。',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['frame_id', 'captured_at', 'width', 'height', 'image'],
        properties: {
          frame_id: { type: 'string' },
          captured_at: { type: 'string' },
          width: { type: 'integer' },
          height: { type: 'integer' },
          image: IMAGE_SCHEMA,
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: `frame_id=${value.frame_id}（${value.width}×${value.height}，采集于 ${value.captured_at}）`,
        },
        { type: 'image', attachment: value.image },
      ],
    },
    async execute() {
      const camera = ctx.get('camera')
      if (camera === undefined) throw new Error('视频源未启用（camera-provider 已禁用）')
      const frame = camera.latest?.()
      if (frame === null || frame === undefined) throw new Error('视频源当前没有可用画面')

      const attachments = ctx.get('attachments')
      if (attachments === undefined) throw new Error('附件存储未加载，无法固化画面')

      const ref = await attachments.saveImage({
        data: frame.jpeg,
        mediaType: 'image/jpeg',
        name: `frame-${frame.seq}.jpg`,
      })
      const image = {
        attachmentId: ref.attachmentId,
        mediaType: ref.mediaType,
        bytes: ref.bytes,
        width: ref.width,
        height: ref.height,
      }
      return {
        frame_id: putView(image),
        captured_at: new Date(frame.capturedAt).toISOString(),
        width: image.width,
        height: image.height,
        image,
      }
    },
  })
}
