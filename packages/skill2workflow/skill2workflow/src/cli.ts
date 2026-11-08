/**
 * Spawn the skill2workflow Python CLI from a DeepSeek Harness tool.
 * @module @deepseek-ai/dsh-skill2workflow/cli
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** How the cordis row finds the Python repo. */
export interface Skill2WorkflowConfig {
  /** Absolute path to the skill2workflow checkout. */
  repoRoot?: string
  /** Python executable. Defaults to `python3`. */
  python?: string
}

/** Resolved command plus the Python workspace. */
export interface ResolvedSkill2WorkflowConfig {
  readonly repoRoot: string
  readonly python: string
}

const pluginDir = dirname(fileURLToPath(import.meta.url))
const dshPythonSdk = resolve(pluginDir, '../../../../python/sdk/src')

/**
 * Fill the defaults used by the base-bundle row.
 * @param config - cordis config for the plugin entry.
 * @returns the Python repo and executable, with an empty repo when unset.
 */
export function resolveSkill2WorkflowConfig(
  config: Skill2WorkflowConfig = {},
): ResolvedSkill2WorkflowConfig {
  return {
    repoRoot: config.repoRoot?.trim() || process.env.SKILL2WORKFLOW_ROOT?.trim() || '',
    python: config.python?.trim() || process.env.SKILL2WORKFLOW_PYTHON?.trim() || 'python3',
  }
}

/**
 * Resolve a Skill folder relative to the Python repo.
 * @param resolved - Python repo and executable.
 * @param skillDir - folder name under `skills/` or an absolute path.
 * @returns an absolute Skill directory.
 */
export function resolveSkillDir(resolved: ResolvedSkill2WorkflowConfig, skillDir?: string): string {
  if (!skillDir) {
    return resolve(resolved.repoRoot, 'skills/safety-interlocks')
  }
  if (skillDir.startsWith('/')) {
    return skillDir
  }
  const underSkills = resolve(resolved.repoRoot, 'skills', skillDir)
  if (existsSync(underSkills)) {
    return underSkills
  }
  return resolve(resolved.repoRoot, skillDir)
}

/**
 * PYTHONPATH so `python3 -m skill2workflow` can import the repo and the dsh SDK.
 * @param repoRoot - skill2workflow checkout.
 * @returns a colon-separated path list.
 */
export function pythonPath(repoRoot: string): string {
  const parts = [repoRoot]
  const siblingSdk = resolve(repoRoot, '../deepseek-harness/python/sdk/src')
  if (existsSync(siblingSdk)) {
    parts.push(siblingSdk)
  }
  if (existsSync(dshPythonSdk)) {
    parts.push(dshPythonSdk)
  }
  const venvSite = resolve(repoRoot, '.venv/lib/python3.10/site-packages')
  if (existsSync(venvSite)) {
    parts.push(venvSite)
  }
  if (process.env.PYTHONPATH) {
    parts.push(process.env.PYTHONPATH)
  }
  return parts.join(':')
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return { raw: text.trim() }
  }
  const slice = text.slice(start, end + 1)
  try {
    return JSON.parse(slice) as unknown
  } catch {
    return { raw: slice }
  }
}

/**
 * Run `python3 -m skill2workflow …` and return a JSON string for the model.
 * @param resolved - Python repo and executable.
 * @param argv - arguments after `-m skill2workflow`.
 * @param timeoutMs - kill the child after this many milliseconds.
 * @returns a JSON string with `ok`, stdout payload, and a stderr tail.
 */
export function runSkill2Workflow(
  resolved: ResolvedSkill2WorkflowConfig,
  argv: readonly string[],
  timeoutMs = 120_000,
): Promise<string> {
  if (resolved.repoRoot.length === 0) {
    return Promise.resolve(JSON.stringify({
      ok: false,
      error: 'SKILL2WORKFLOW_ROOT is empty. Set it on the skill2workflow cordis row or in the environment.',
    }))
  }
  return new Promise((resolvePromise, reject) => {
    const child = spawn(resolved.python, ['-m', 'skill2workflow', ...argv], {
      cwd: resolved.repoRoot,
      env: { ...process.env, PYTHONPATH: pythonPath(resolved.repoRoot) },
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`skill2workflow timed out: ${argv.join(' ')}`))
    }, timeoutMs)
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', err => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolvePromise(JSON.stringify({
        ok: code === 0,
        code,
        argv,
        result: extractJson(stdout),
        stdout: stdout.trim(),
        stderr: stderr.trim().slice(-4000),
      }))
    })
  })
}
