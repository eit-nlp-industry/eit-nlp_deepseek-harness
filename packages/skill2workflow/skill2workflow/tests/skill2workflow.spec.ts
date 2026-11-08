import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { resolveSkill2WorkflowConfig } from '@deepseek-ai/dsh-skill2workflow'

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
      /- id: skill2workflow\n      name: '@eit-nlp\/dsh-skill2workflow'\n      disabled: false/,
    )
    expect(cordis).not.toMatch(/\/home\/liangyijuan/)
    expect(cordis).not.toMatch(/repoRoot:/)
  })

  it('registers s2w_trace_to_skill', async () => {
    const src = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
    expect(src).toContain("name: 's2w_trace_to_skill'")
    expect(src).toContain('trace-to-skill')
  })

  it('auto-installs the CLI into DSH_HOME on first use', async () => {
    const src = await readFile(new URL('../src/cli.ts', import.meta.url), 'utf8')
    expect(src).toContain('ensureSkill2WorkflowPython')
    expect(src).toContain('skill2workflow')
    expect(src).toContain('venv')
  })
})
