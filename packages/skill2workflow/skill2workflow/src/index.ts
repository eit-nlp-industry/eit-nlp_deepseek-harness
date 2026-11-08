/**
 * skill2workflow compile and self-evolution tools.
 * @module @deepseek-ai/dsh-skill2workflow
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  resolveSkill2WorkflowConfig,
  resolveSkillDir,
  runSkill2Workflow,
  type Skill2WorkflowConfig,
} from './cli.ts'

export const name = 'skill2workflow'
export const inject = ['tools']

export type Config = Skill2WorkflowConfig

export { resolveSkill2WorkflowConfig, resolveSkillDir } from './cli.ts'

const jsonOut = {
  schema: { type: 'string' as const },
  render(_args: unknown, value: string) {
    return [{ type: 'text' as const, text: value }]
  },
}

function skillDirProp() {
  return {
    type: 'string' as const,
    description: 'Skill folder name under skills/ (e.g. safety-interlocks) or an absolute path',
  }
}

/**
 * Register the s2w_* tools. Default is judge only; compile, live runs, and
 * trace-to-skill wait until the model sets apply / use_fixture / case_id.
 * @param ctx - host context carrying the tool registry.
 * @param config - optional checkout path and python executable.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveSkill2WorkflowConfig(config)

  ctx.tools.register(defineTool({
    name: 's2w_evolve_report',
    description:
      'skill2workflow self-evolution: compute the window metrics S/Var/C/Sim/Cov for one Skill. Does not change files except last_report.json.',
    parameters: {
      skill_dir: skillDirProp(),
    },
    output: jsonOut,
    timeoutMs: 60_000,
    execute(args) {
      return runSkill2Workflow(resolved, [
        'evolve-report',
        '--skill-dir',
        resolveSkillDir(resolved, args.skill_dir),
      ], 60_000)
    },
  }))

  ctx.tools.register(defineTool({
    name: 's2w_evolve_decide',
    description:
      'skill2workflow self-evolution: decide keep_skill / promote_to_workflow / one node edit. Default is judge only. Set apply=true only when the user asked to change the Skill or n8n graph.',
    parameters: {
      skill_dir: skillDirProp(),
      segment: { type: 'string', enum: ['A', 'B', 'auto'], description: 'Compare arm. Defaults to auto.' },
      apply: { type: 'boolean', description: 'If true, compile or edit. Default false.' },
      skip_n8n: { type: 'boolean', description: 'Skip n8n import even when apply is true.' },
    },
    output: jsonOut,
    timeoutMs: 300_000,
    execute(args) {
      const argv = [
        'evolve-decide',
        '--skill-dir',
        resolveSkillDir(resolved, args.skill_dir),
        '--segment',
        args.segment ?? 'auto',
        '--no-ask',
        '--skip-user-input',
      ]
      if (args.apply === true) {
        argv.push('--apply')
      }
      if (args.skip_n8n === true || args.apply !== true) {
        argv.push('--skip-n8n')
      }
      return runSkill2Workflow(resolved, argv, args.apply === true ? 300_000 : 60_000)
    },
  }))

  ctx.tools.register(defineTool({
    name: 's2w_evolve_retrieve',
    description:
      "skill2workflow self-evolution: find other Skills' evolution notes with similar metrics. Does not replace the gate.",
    parameters: {
      skill_dir: skillDirProp(),
      segment: { type: 'string', enum: ['A', 'B', 'auto'], description: 'Compare arm. Defaults to auto.' },
      k: { type: 'integer', description: 'How many notes to return. Defaults to 3.' },
    },
    output: jsonOut,
    timeoutMs: 60_000,
    execute(args) {
      return runSkill2Workflow(resolved, [
        'evolve-retrieve',
        '--skill-dir',
        resolveSkillDir(resolved, args.skill_dir),
        '--segment',
        args.segment ?? 'auto',
        '--k',
        String(args.k ?? 3),
      ], 60_000)
    },
  }))

  ctx.tools.register(defineTool({
    name: 's2w_evolve_ingest',
    description:
      'skill2workflow self-evolution: copy trajectory.json into evolution/runs/. No LLM.',
    parameters: {
      skill_dir: skillDirProp(),
    },
    output: jsonOut,
    timeoutMs: 60_000,
    execute(args) {
      return runSkill2Workflow(resolved, [
        'evolve-ingest',
        '--skill-dir',
        resolveSkillDir(resolved, args.skill_dir),
      ], 60_000)
    },
  }))

  ctx.tools.register(defineTool({
    name: 's2w_run_trajectory',
    description:
      'Run the Skill once inside dsh and write trajectory.json. Calls a model. Use only when the user asked to generate a live trajectory.',
    parameters: {
      skill_dir: skillDirProp(),
      case_id: { type: 'string', description: 'Held-out case id, if the Skill has one.' },
    },
    output: jsonOut,
    timeoutMs: 300_000,
    execute(args) {
      const argv = ['run-trajectory', '--skill-dir', resolveSkillDir(resolved, args.skill_dir)]
      if (args.case_id !== undefined) {
        argv.push('--case-id', args.case_id)
      }
      return runSkill2Workflow(resolved, argv, 300_000)
    },
  }))

  ctx.tools.register(defineTool({
    name: 's2w_trace_to_skill',
    description:
      'Turn one successful trajectory.json into SKILL.md via SkillClaw workflow. Calls a model. Pass the trajectory file path; do not invent a skill name. Use only when the user asked to distill a skill from a trace.',
    parameters: {
      trajectory: {
        type: 'string',
        description: 'Absolute or repo-relative path to trajectory.json',
      },
      out_dir: {
        type: 'string',
        description: 'Where to write SKILL.md. Defaults to the trajectory folder.',
      },
      hint: {
        type: 'string',
        description: 'Optional extraction hint for SkillClaw.',
      },
      skill_dir: {
        type: 'string',
        description: 'Optional shortcut: use <dir>/trajectory.json and write SKILL.md into <dir>.',
      },
      allow_failed: {
        type: 'boolean',
        description: 'Ingest even if the trajectory is labeled failed. Default false.',
      },
    },
    output: jsonOut,
    timeoutMs: 360_000,
    execute(args) {
      const argv = ['trace-to-skill']
      if (args.trajectory) {
        argv.push('--trajectory', resolveSkillDir(resolved, args.trajectory))
      }
      if (args.out_dir) {
        argv.push('--out-dir', resolveSkillDir(resolved, args.out_dir))
      }
      if (args.skill_dir) {
        argv.push('--skill-dir', resolveSkillDir(resolved, args.skill_dir))
      }
      if (args.hint) {
        argv.push('--hint', String(args.hint))
      }
      if (args.allow_failed === true) {
        argv.push('--allow-failed')
      }
      return runSkill2Workflow(resolved, argv, 360_000)
    },
  }))

  ctx.tools.register(defineTool({
    name: 's2w_compile',
    description:
      'Compile Skill+trajectory to an n8n workflow. Calls a model unless use_fixture is true. Use only when the user asked to compile.',
    parameters: {
      skill_dir: skillDirProp(),
      use_fixture: { type: 'boolean', description: 'Use a recorded fixture instead of calling a model.' },
      skip_n8n: { type: 'boolean', description: 'Skip n8n import. Defaults to true.' },
    },
    output: jsonOut,
    timeoutMs: 300_000,
    execute(args) {
      const argv = [
        'compile',
        '--skill-dir',
        resolveSkillDir(resolved, args.skill_dir),
        '--no-ask',
        '--skip-user-input',
      ]
      if (args.use_fixture === true) {
        argv.push('--use-fixture')
      }
      if (args.skip_n8n !== false) {
        argv.push('--skip-n8n')
      }
      return runSkill2Workflow(resolved, argv, 300_000)
    },
  }))
}
