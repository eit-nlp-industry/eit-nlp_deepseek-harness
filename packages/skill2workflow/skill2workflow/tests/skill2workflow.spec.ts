import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { resolveSkill2WorkflowConfig, resolveSkillDir, withSessionCwd } from '@deepseek-ai/dsh-skill2workflow'

describe('dsh-skill2workflow', () => {
  it('defaults python3, cwd, and no checkout path', () => {
    const previous = process.env.SKILL2WORKFLOW_ROOT
    delete process.env.SKILL2WORKFLOW_ROOT
    try {
      expect(resolveSkill2WorkflowConfig()).toEqual({
        repoRoot: '',
        cwd: process.cwd(),
        python: 'python3',
      })
    } finally {
      if (previous === undefined) {
        delete process.env.SKILL2WORKFLOW_ROOT
      } else {
        process.env.SKILL2WORKFLOW_ROOT = previous
      }
    }
  })

  it('ships the skill2workflow row in the base bundle without a machine path', async () => {
    const cordis = await readFile(new URL('../../../bundle/base/cordis.patch.yml', import.meta.url), 'utf8')
    expect(cordis).toMatch(
      /- id: skill2workflow\n      name: '@deepseek-ai\/dsh-skill2workflow'\n      disabled: false/,
    )
    expect(cordis).not.toMatch(/\/home\/liangyijuan/)
    expect(cordis).not.toMatch(/repoRoot:/)
  })

  it('registers s2w_trace_to_skill', async () => {
    const src = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
    expect(src).toContain("name: 's2w_trace_to_skill'")
    expect(src).toContain('trace-to-skill')
  })

  it('imports to n8n unless skip_n8n is true', async () => {
    const src = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
    expect(src).toContain('if (args.skip_n8n === true)')
    expect(src).not.toContain('if (args.skip_n8n !== false)')
  })

  it('binds python cwd to the session workspace, not process.cwd', () => {
    const resolved = resolveSkill2WorkflowConfig()
    const bound = withSessionCwd(resolved, {
      agent: { session: { header: { cwd: '/tmp/opened-project' } } },
    })
    expect(bound.cwd).toBe('/tmp/opened-project')
    expect(resolveSkillDir(bound, 'demo')).toBe('/tmp/opened-project/.dsh/skills/demo')
  })

  it('auto-installs the CLI into DSH_HOME on first use', async () => {
    const src = await readFile(new URL('../src/cli.ts', import.meta.url), 'utf8')
    expect(src).toContain('ensureSkill2WorkflowPython')
    expect(src).toContain('skill2workflow')
    expect(src).toContain('venv')
  })
})
