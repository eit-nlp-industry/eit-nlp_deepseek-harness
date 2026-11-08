/**
 * Spawn the skill2workflow Python CLI from a DeepSeek Harness tool.
 * @module @deepseek-ai/dsh-skill2workflow/cli
 */

import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** How the cordis row finds the Python CLI. */
export interface Skill2WorkflowConfig {
  /**
   * Optional git checkout of skill2workflow. Empty means the CLI is already
   * on PYTHONPATH (`pip install skill2workflow`) and paths are relative to cwd.
   */
  repoRoot?: string
  /** Python executable. Defaults to `python3`. */
  python?: string
}

/** Resolved command plus the workspace used for relative Skill paths. */
export interface ResolvedSkill2WorkflowConfig {
  readonly repoRoot: string
  readonly cwd: string
  readonly python: string
}

const pluginDir = dirname(fileURLToPath(import.meta.url))
const dshPythonSdk = resolve(pluginDir, '../../../../python/sdk/src')

const INSTALL_HINT =
  "pip install 'git+https://github.com/eit-nlp-industry/skill2workflow.git'"

/**
 * Fill the defaults used by the base-bundle row.
 * @param config - cordis config for the plugin entry.
 * @returns python, optional checkout, and the workspace cwd.
 */
export function resolveSkill2WorkflowConfig(
  config: Skill2WorkflowConfig = {},
): ResolvedSkill2WorkflowConfig {
  const repoRoot = config.repoRoot?.trim() || process.env.SKILL2WORKFLOW_ROOT?.trim() || ''
  return {
    repoRoot,
    cwd: process.cwd(),
    python: config.python?.trim() || process.env.SKILL2WORKFLOW_PYTHON?.trim() || 'python3',
  }
}

function isCheckout(root: string): boolean {
  return existsSync(resolve(root, 'skill2workflow', '__main__.py'))
}

/**
 * Resolve a Skill folder or trajectory relative to the user's workspace.
 * @param resolved - python, cwd, optional checkout.
 * @param skillDir - folder name under `skills/`, a relative path, or absolute.
 * @returns an absolute path.
 */
export function resolveSkillDir(resolved: ResolvedSkill2WorkflowConfig, skillDir?: string): string {
  const bases = [resolved.cwd]
  if (resolved.repoRoot && isCheckout(resolved.repoRoot)) {
    bases.push(resolved.repoRoot)
  }
  if (!skillDir) {
    for (const base of bases) {
      const fallback = resolve(base, 'skills/safety-interlocks')
      if (existsSync(fallback)) {
        return fallback
      }
    }
    return resolve(resolved.cwd, 'skills/safety-interlocks')
  }
  if (skillDir.startsWith('/')) {
    return skillDir
  }
  for (const base of bases) {
    const underSkills = resolve(base, 'skills', skillDir)
    if (existsSync(underSkills)) {
      return underSkills
    }
    const relative = resolve(base, skillDir)
    if (existsSync(relative)) {
      return relative
    }
  }
  return resolve(resolved.cwd, skillDir)
}

function venvSitePackages(repoRoot: string): string[] {
  const lib = resolve(repoRoot, '.venv/lib')
  if (!existsSync(lib)) {
    return []
  }
  try {
    return readdirSync(lib)
      .map(name => resolve(lib, name, 'site-packages'))
      .filter(dir => existsSync(dir))
  } catch {
    return []
  }
}

/**
 * PYTHONPATH so a git checkout still imports; pip installs need none of this.
 * @param repoRoot - optional skill2workflow checkout.
 * @returns a colon-separated path list, possibly empty.
 */
export function pythonPath(repoRoot: string): string {
  const parts: string[] = []
  if (repoRoot && isCheckout(repoRoot)) {
    parts.push(repoRoot)
    parts.push(...venvSitePackages(repoRoot))
    const siblingSdk = resolve(repoRoot, '../deepseek-harness/python/sdk/src')
    if (existsSync(siblingSdk)) {
      parts.push(siblingSdk)
    }
  }
  if (existsSync(dshPythonSdk)) {
    parts.push(dshPythonSdk)
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

function installHint(stderr: string, code: number | null): string | undefined {
  if (code === 0) {
    return undefined
  }
  if (/No module named ['"]skill2workflow['"]/.test(stderr) || /ModuleNotFoundError: skill2workflow/.test(stderr)) {
    return `skill2workflow is not installed for this python. ${INSTALL_HINT}`
  }
  return undefined
}

/**
 * Run `python3 -m skill2workflow …` and return a JSON string for the model.
 * @param resolved - python and workspace.
 * @param argv - arguments after `-m skill2workflow`.
 * @param timeoutMs - kill the child after this many milliseconds.
 * @returns a JSON string with `ok`, stdout payload, and a stderr tail.
 */
export function runSkill2Workflow(
  resolved: ResolvedSkill2WorkflowConfig,
  argv: readonly string[],
  timeoutMs = 120_000,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const env = { ...process.env }
    const extra = pythonPath(resolved.repoRoot)
    if (extra) {
      env.PYTHONPATH = extra
    }
    const child = spawn(resolved.python, ['-m', 'skill2workflow', ...argv], {
      cwd: resolved.cwd,
      env,
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
      const message = err instanceof Error ? err.message : String(err)
      resolvePromise(JSON.stringify({
        ok: false,
        error: message,
        hint: `Could not start ${resolved.python} -m skill2workflow. ${INSTALL_HINT}`,
      }))
    })
    child.on('close', code => {
      clearTimeout(timer)
      const hint = installHint(stderr, code)
      resolvePromise(JSON.stringify({
        ok: code === 0,
        code,
        argv,
        result: extractJson(stdout),
        stdout: stdout.trim(),
        stderr: stderr.trim().slice(-4000),
        ...hint ? { hint } : {},
      }))
    })
  })
}
