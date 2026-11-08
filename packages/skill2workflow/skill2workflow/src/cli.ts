/**
 * Spawn the skill2workflow CLI. First call installs it into DSH_HOME, like npx -y.
 * @module @deepseek-ai/dsh-skill2workflow/cli
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** How the cordis row finds the Python CLI. */
export interface Skill2WorkflowConfig {
  /** Optional git checkout. Empty means auto-install into DSH_HOME. */
  repoRoot?: string
  /** Python executable. Defaults to `python3`, then the managed venv. */
  python?: string
}

/** Resolved command plus the workspace used for relative Skill paths. */
export interface ResolvedSkill2WorkflowConfig {
  repoRoot: string
  readonly cwd: string
  python: string
}

const pluginDir = dirname(fileURLToPath(import.meta.url))
const dshPythonSdk = resolve(pluginDir, '../../../../python/sdk/src')

export const SKILL2WORKFLOW_PIP_SPEC =
  'git+https://github.com/eit-nlp-industry/skill2workflow.git@f728e1f9b67170476fcb1cbacc0e582e6e17b1a0'
const CLI_REV = '2026-11-09-drop-if-merge'

let ensureChain: Promise<string> | undefined

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

/**
 * Bind the plugin to the session workspace (the folder dsh opened), not the
 * Node process launch directory.
 */
export function withSessionCwd(
  resolved: ResolvedSkill2WorkflowConfig,
  exec?: { agent?: { session?: { header?: { cwd?: string } } } },
): ResolvedSkill2WorkflowConfig {
  const cwd = exec?.agent?.session?.header?.cwd?.trim()
  return cwd ? { ...resolved, cwd } : resolved
}

function isCheckout(root: string): boolean {
  return existsSync(resolve(root, 'pyproject.toml'))
    && existsSync(resolve(root, 'skill2workflow', '__main__.py'))
}

function dshHome(): string {
  const env = process.env.DSH_HOME?.trim()
  return env ? resolve(env) : resolve(homedir(), '.dsh')
}

function venvDir(): string {
  return resolve(dshHome(), 'skill2workflow', 'venv')
}

function venvPython(): string {
  return process.platform === 'win32'
    ? resolve(venvDir(), 'Scripts', 'python.exe')
    : resolve(venvDir(), 'bin', 'python')
}

function cliRevPath(): string {
  return resolve(dshHome(), 'skill2workflow', 'cli-rev')
}

function installedCliRev(): string {
  const path = cliRevPath()
  if (!existsSync(path)) {
    return ''
  }
  return readFileSync(path, 'utf8').trim()
}

function writeCliRev(): void {
  mkdirSync(resolve(dshHome(), 'skill2workflow'), { recursive: true })
  writeFileSync(cliRevPath(), `${CLI_REV}\n`)
}

function importOk(python: string): boolean {
  const probe = spawnSync(python, ['-c', 'import skill2workflow'], {
    encoding: 'utf8',
    timeout: 15_000,
  })
  return probe.status === 0
}

function runSync(python: string, args: readonly string[], timeoutMs: number): { status: number | null, stderr: string } {
  const result = spawnSync(python, args, { encoding: 'utf8', timeout: timeoutMs })
  return { status: result.status, stderr: `${result.stderr ?? ''}${result.error?.message ?? ''}` }
}

function pipInstallTarget(repoRoot: string): string[] {
  if (repoRoot && isCheckout(repoRoot)) {
    return ['-e', repoRoot]
  }
  return ['-U', SKILL2WORKFLOW_PIP_SPEC]
}

/**
 * Return a python that can `import skill2workflow`, installing into DSH_HOME if needed.
 * Same idea as `npx -y`: the plugin starts the dependency, the user does not pip.
 * @param resolved - current python / optional checkout.
 * @returns an executable path or `python3`.
 */
export async function ensureSkill2WorkflowPython(
  resolved: ResolvedSkill2WorkflowConfig = resolveSkill2WorkflowConfig(),
): Promise<string> {
  if (ensureChain) {
    return ensureChain
  }
  ensureChain = (async () => {
    const fresh = installedCliRev() === CLI_REV
    if (fresh) {
      const candidates = [resolved.python, 'python3', venvPython()]
      for (const python of candidates) {
        if (python && importOk(python)) {
          resolved.python = python
          return python
        }
      }
    }
    const dir = venvDir()
    mkdirSync(dir, { recursive: true })
    const py = venvPython()
    if (!existsSync(py)) {
      const venv = runSync('python3', ['-m', 'venv', dir], 60_000)
      if (venv.status !== 0 || !existsSync(py)) {
        throw new Error(`Could not create ${dir}: ${venv.stderr.slice(-2000)}`)
      }
    }
    const install = await new Promise<{ status: number | null, stderr: string }>((ok, err) => {
      const child = spawn(py, ['-m', 'pip', 'install', ...pipInstallTarget(resolved.repoRoot)], {
        env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1' },
      })
      let stderr = ''
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        err(new Error('pip install skill2workflow timed out'))
      }, 180_000)
      child.stderr.on('data', chunk => {
        stderr += chunk.toString()
      })
      child.on('error', error => {
        clearTimeout(timer)
        err(error)
      })
      child.on('close', status => {
        clearTimeout(timer)
        ok({ status, stderr })
      })
    })
    if (install.status !== 0 || !importOk(py)) {
      throw new Error(`Could not install skill2workflow into ${dir}: ${install.stderr.slice(-2000)}`)
    }
    writeCliRev()
    resolved.python = py
    return py
  })()
  try {
    return await ensureChain
  } catch (error) {
    ensureChain = undefined
    throw error
  }
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
  const rel = (base: string, name: string) => [
    resolve(base, '.dsh/skills', name),
    resolve(base, 'skills', name),
  ]
  if (!skillDir) {
    return resolve(resolved.cwd, '.dsh/skills')
  }
  if (skillDir.startsWith('/')) {
    return skillDir
  }
  for (const base of bases) {
    for (const candidate of rel(base, skillDir)) {
      if (existsSync(candidate)) {
        return candidate
      }
    }
    const relative = resolve(base, skillDir)
    if (existsSync(relative)) {
      return relative
    }
  }
  return resolve(resolved.cwd, '.dsh/skills', skillDir)
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
 * PYTHONPATH so a git checkout still imports; a managed venv needs none of this.
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

/**
 * Run `python -m skill2workflow …` and return a JSON string for the model.
 * @param resolved - python and workspace.
 * @param argv - arguments after `-m skill2workflow`.
 * @param timeoutMs - kill the child after this many milliseconds.
 * @returns a JSON string with `ok`, stdout payload, and a stderr tail.
 */
export async function runSkill2Workflow(
  resolved: ResolvedSkill2WorkflowConfig,
  argv: readonly string[],
  timeoutMs = 120_000,
): Promise<string> {
  let python: string
  try {
    python = await ensureSkill2WorkflowPython(resolved)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return JSON.stringify({
      ok: false,
      error: message,
      hint: `The plugin installs ${SKILL2WORKFLOW_PIP_SPEC} into ${join(dshHome(), 'skill2workflow', 'venv')} on first use.`,
    })
  }
  return new Promise(resolvePromise => {
    const env = { ...process.env }
    const extra = pythonPath(resolved.repoRoot)
    if (extra) {
      env.PYTHONPATH = extra
    }
    const child = spawn(python, ['-m', 'skill2workflow', ...argv], {
      cwd: resolved.cwd,
      env,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolvePromise(JSON.stringify({
        ok: false,
        error: `skill2workflow timed out: ${argv.join(' ')}`,
      }))
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
      }))
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
