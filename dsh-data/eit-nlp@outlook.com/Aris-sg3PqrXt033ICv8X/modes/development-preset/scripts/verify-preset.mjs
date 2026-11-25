import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const skillName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const requiredSkills = [
  'development-orchestrator',
  'flow-acceptance-handoff',
  'software-requirements',
  'test-driven-development',
  'systematic-debugging',
  'verification-before-completion',
  'ui-ux-pro-max',
  'webapp-testing',
  'ui-screenshots',
  'playwright-generate-test',
]
const requiredPlugins = [
  '@deepseek-ai/dsh-persona',
  '@deepseek-ai/dsh-tool-bash',
  '@deepseek-ai/dsh-tool-fs',
  '@deepseek-ai/dsh-tool-fs-search',
  '@deepseek-ai/dsh-skill-filesystem',
  '@deepseek-ai/dsh-tool-skill',
  '@deepseek-ai/dsh-tool-todo',
  '@deepseek-ai/dsh-tool-goal',
  '@deepseek-ai/dsh-tool-web',
]
const forbidden = [
  "@deepseek-ai/dsh-tool-ask-user",
  "@deepseek-ai/dsh-tool-subagent",
  "@deepseek-ai/dsh-plugin-manager/tools",
]

const failures = []

function fail(message) {
  failures.push(message)
}

const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
if (!patch.includes('id: development') || !patch.includes('name: 研发模式')) {
  fail('preset id or display name missing')
}
if (!patch.includes('includeDefaultRoots: false')) fail('skill roots are not isolated')
if (!patch.includes('allowParallelInProgress: false')) fail('todo progress must keep a single in_progress item')
const orchestrator = await readFile(join(root, 'skills/development-orchestrator/SKILL.md'), 'utf8')
if (!orchestrator.includes('todo_write') || !orchestrator.includes('passed` → `completed')) {
  fail('orchestrator does not mirror tasks.json into todo_write')
}
if (!orchestrator.includes('ACCEPTANCE_GATE') || !orchestrator.includes('AWAITING_ACCEPTANCE')) {
  fail('orchestrator missing ACCEPTANCE_GATE / AWAITING_ACCEPTANCE')
}
if (!orchestrator.includes('flow-acceptance-handoff')) {
  fail('orchestrator does not load flow-acceptance-handoff')
}
if (!patch.includes('AWAITING_ACCEPTANCE') || !patch.includes('ACCEPTANCE_GATE')) {
  fail('persona missing acceptance gate rules')
}
for (const name of requiredPlugins) {
  if (!patch.includes(name)) fail(`missing plugin ${name}`)
}
for (const name of forbidden) {
  if (patch.includes(name)) fail(`forbidden plugin mentioned: ${name}`)
}

const found = await readdir(join(root, 'skills'))
if (found.some(name => name.startsWith('openspec-'))) fail('OpenSpec skills must not be mounted')
for (const name of requiredSkills) {
  if (!found.includes(name)) {
    fail(`missing skill ${name}`)
    continue
  }
  const text = await readFile(join(root, 'skills', name, 'SKILL.md'), 'utf8')
  if (!text.startsWith('---\n')) fail(`${name} missing frontmatter`)
  const end = text.indexOf('\n---', 4)
  const frontmatter = text.slice(4, end)
  const declared = frontmatter.match(/^name:\s*['"]?([a-z0-9-]+)['"]?\s*$/m)?.[1]
  if (declared !== name || !skillName.test(name)) fail(`${name} frontmatter name is ${declared}`)
  if (!/^description:/m.test(frontmatter)) fail(`${name} missing description`)
}

for (const schema of ['prd-audit.schema.json', 'task-result.schema.json', 'verification.schema.json', 'final-result.schema.json']) {
  JSON.parse(await readFile(join(root, 'schemas', schema), 'utf8'))
}

const profile = JSON.parse(await readFile(join(root, '../../profiles/n8n-web/package.json'), 'utf8'))
const bundles = profile.dsh?.profile?.bundles ?? []
if (!bundles.includes('@local/dsh-development-preset')) fail('profile bundle list missing preset')
if (!bundles.includes('@local/dsh-aris-acceptance-preset')) fail('existing acceptance preset was dropped')

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log(`ok ${requiredSkills.length} skills, preset development, acceptance preset kept`)
