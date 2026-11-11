/**
 * Host half of the wizard bundle: one structured stage tool plus a read-only
 * state route. The tool call is the record; the route only folds committed
 * session events, so a reload, a fork, or another tab reads the same state.
 *
 * No dependency on shipped Harness packages: the tool is a plain definition, so
 * the bundle imports only its own pure fold.
 * @module @local/dsh-wizard
 */

import { foldWizardState, validateStage, WIZARD_TOOL } from './state.js'

export const name = 'dsh-wizard'

export const inject = ['tools', 'sessions', 'webServer', 'connection']

const STATE_PATH = '/api/wizard/state'

const DESCRIPTION = [
  'Record one wizard stage so the session-scoped 向导 view can render it in place.',
  'Call it exactly once per produced stage, and never describe a stage only in prose.',
  'Identity is explicit: wizardId names the wizard, stageId names the stage, and version increases by one every time the SAME stage is produced again.',
  'kind "form" renders editable fields, "preview" renders a read-only summary with 返回修改/确认, "done" renders the closed result.',
  'data.fields is [{key,label,type:"text"|"number"|"textarea",value}] for a form; data.summary is [{label,value}] for preview/done.',
  'invalidates lists stage ids whose content this stage changed, so they show as 需要更新.',
].join(' ')

const PARAMETERS = {
  type: 'object',
  properties: {
    wizardId: { type: 'string', description: 'Stable wizard id, e.g. campus-2026.' },
    stageId: { type: 'string', description: 'Stable stage id, e.g. needs / preview / done.' },
    version: { type: 'integer', minimum: 1, description: 'Increase by one whenever this stage is produced again.' },
    kind: { type: 'string', enum: ['form', 'preview', 'done'] },
    title: { type: 'string' },
    data: { type: 'object', description: 'Stage content: fields for form, summary for preview/done.' },
    invalidates: { type: 'array', items: { type: 'string' }, description: 'Downstream stage ids this stage changed.' },
  },
  required: ['wizardId', 'stageId', 'version', 'kind', 'title', 'data'],
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, message: { type: 'string' } },
  required: ['ok', 'message'],
}

export function apply(ctx) {
  ctx.tools.register({
    name: WIZARD_TOOL,
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: String(value?.message ?? '') }],
    },
    async execute(args) {
      if (validateStage(args, 0) === null) {
        throw new Error('wizard_stage 参数无效：需要 wizardId、stageId、version（整数≥1）、kind（form|preview|done）、title 与 data 对象。')
      }
      return {
        ok: true,
        message: `向导阶段已记录：${args.wizardId} / ${args.stageId} / v${args.version}（${args.kind}）`,
      }
    },
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/api/wizard',
    handler: (req, res) => {
      const rejection = ctx.connection.requestRejection({ headers: req.headers })
      if (rejection !== undefined) {
        res.statusCode = rejection
        res.end('unauthorized')
        return
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname !== STATE_PATH) {
        res.statusCode = 404
        res.end('not found')
        return
      }
      const sessionId = url.searchParams.get('sessionId') ?? ''
      const session = sessionId === '' ? undefined : ctx.sessions.get(sessionId)
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      if (session === undefined) {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'unknown session' }))
        return
      }
      res.end(JSON.stringify(foldWizardState(session.snapshotEvents())))
    },
  }))
}
