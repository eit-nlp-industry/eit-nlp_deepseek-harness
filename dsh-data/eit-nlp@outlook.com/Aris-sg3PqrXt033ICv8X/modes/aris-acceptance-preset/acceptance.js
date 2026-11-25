import path from 'node:path'
import { createAcceptanceStore, acceptancePhases, acceptanceVerdicts, violationSeverities } from './store.js'

export const name = 'aris-acceptance'
export const inject = ['tools', 'systemPrompt']

function textOutput() {
  return {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

function objectSchema(required, properties) {
  return { type: 'object', additionalProperties: false, required, properties }
}

function dataRoot(config) {
  if (typeof config?.dataDir === 'string' && config.dataDir.trim() !== '') return config.dataDir.trim()
  const home = process.env.DSH_HOME
  if (!home) throw new Error('DSH_HOME is required for the acceptance ledger')
  return path.join(home, 'acceptance-data')
}

export function apply(ctx, config) {
  const store = createAcceptanceStore(dataRoot(config))
  const phaseSchema = { type: 'string', enum: acceptancePhases, description: 'process_supervision 过程监督，result_check 结果核查，rectification 整改，retest 复测。' }
  const projectSchema = { type: 'string', description: '项目标识。只读写这个项目自己的验收账和错题本。' }

  ctx.tools.register({
    name: 'acceptance_record',
    description: '为指定项目写入一条独立验收记录。verdict 为 fail 时同时写入该项目的错题本并累加违约计数；不通知上级。',
    parameters: objectSchema(
      ['project_id', 'phase', 'verdict', 'constraint', 'summary'],
      {
        project_id: projectSchema,
        phase: phaseSchema,
        verdict: { type: 'string', enum: acceptanceVerdicts },
        constraint: { type: 'string', description: '被核查的约束，例如验收条件、业务规则或执行步骤。' },
        summary: { type: 'string', description: '本条验收结论。未通过时这段文字进入错题本。' },
        evidence: { type: 'string', description: '证据位置或摘录。' },
        severity: { type: 'string', enum: violationSeverities, description: '未通过时的严重程度，默认 medium。' },
      },
    ),
    output: textOutput(),
    async execute(args) {
      const result = await store.recordAcceptance({
        projectId: args.project_id,
        phase: args.phase,
        verdict: args.verdict,
        constraint: args.constraint,
        summary: args.summary,
        evidence: args.evidence,
        severity: args.severity,
      })
      return {
        projectId: result.acceptance.projectId,
        acceptance: result.acceptance,
        error: result.error,
        alert: result.alert,
      }
    },
  })

  ctx.tools.register({
    name: 'error_book_add',
    description: '向指定项目的错题本追加一条违约记录，并累加该项目的预留告警计数。不读取、不写入其他项目。',
    parameters: objectSchema(
      ['project_id', 'phase', 'constraint', 'violation'],
      {
        project_id: projectSchema,
        phase: phaseSchema,
        constraint: { type: 'string' },
        violation: { type: 'string', description: '违反了什么，以及和证据不一致的地方。' },
        evidence: { type: 'string' },
        severity: { type: 'string', enum: violationSeverities },
      },
    ),
    output: textOutput(),
    async execute(args) {
      const result = await store.addError({
        projectId: args.project_id,
        phase: args.phase,
        constraint: args.constraint,
        violation: args.violation,
        evidence: args.evidence,
        severity: args.severity,
      })
      return { projectId: result.error.projectId, error: result.error, alert: result.alert }
    },
  })

  ctx.tools.register({
    name: 'acceptance_list',
    description: '只列出指定项目的验收记录。',
    parameters: objectSchema(['project_id'], {
      project_id: projectSchema,
      limit: { type: 'integer', description: '返回最近的条数，最多 200。' },
    }),
    output: textOutput(),
    async execute(args) {
      return store.listAcceptance(args.project_id, args.limit)
    },
  })

  ctx.tools.register({
    name: 'error_book_list',
    description: '只列出指定项目的错题本。',
    parameters: objectSchema(['project_id'], {
      project_id: projectSchema,
      limit: { type: 'integer' },
    }),
    output: textOutput(),
    async execute(args) {
      return store.listErrors(args.project_id, args.limit)
    },
  })

  ctx.tools.register({
    name: 'violation_alert_status',
    description: '读取指定项目已落盘的违约计数和预留告警。delivered 与 parentNotified 恒为未外发；当前没有上级 agent，本工具不发送通知。',
    parameters: objectSchema(['project_id'], { project_id: projectSchema }),
    output: textOutput(),
    async execute(args) {
      return store.alertStatus(args.project_id)
    },
  })

  ctx.systemPrompt.section({
    name: 'aris-acceptance:isolation',
    order: 460,
    interpolate: false,
    text: '监管与验收按 project_id 隔离。验收记录、错题本和违约计数只属于当前项目。缺少 project_id 时先询问，不得写入默认账本，也不得用其他项目的记录下结论。违约告警目前只落盘计数，parentNotified 为 false，不要声称已经通知上级。',
  })
}
