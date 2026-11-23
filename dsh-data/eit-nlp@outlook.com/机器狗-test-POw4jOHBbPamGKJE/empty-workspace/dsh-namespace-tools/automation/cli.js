import { parseArgs } from 'node:util'
import { prepare, accept, compile, publish } from './workflow.js'

const help = `工具目录自动分类（Node.js 20+）

node automation/cli.js prepare --config config.json --state-dir /绝对路径/state [--url http://10.37.0.21:8040/ui/api/registrations]
node automation/cli.js accept --run /绝对路径/state/runs/运行ID --assignments /绝对路径/assignments.json
node automation/cli.js compile --catalog /绝对路径/state/catalog.json --config config.json --tool-map /绝对路径/tool-map.json --output /绝对路径/candidate.json
node automation/cli.js publish --catalog /绝对路径/state/catalog.json --config /实际配置.json --tool-map /绝对路径/tool-map.json

prepare 仅准备模型输入；DSH Agent 读取 task.json 后写分类 JSON，再 accept。
compile 仅生成候选；publish 只原子更新实际配置，需 restart Harness 后采用。详见 automation/README.md。
`

/** 解析命令行并执行单步任务；失败时打印错误且返回非零退出码。 */
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true,
    options: Object.fromEntries(['config', 'state-dir', 'url', 'run', 'assignments', 'catalog', 'tool-map', 'output']
      .map(name => [name, { type: 'string' }]).concat([['help', { type: 'boolean', short: 'h' }]])) })
  if (values.help || positionals.length === 0) { console.log(help); return }
  const command = positionals[0]
  const required = { prepare: ['config', 'state-dir'], accept: ['run', 'assignments'], compile: ['catalog', 'config', 'tool-map', 'output'], publish: ['catalog', 'config', 'tool-map'] }
  if (positionals.length !== 1 || !Object.hasOwn(required, command)) throw new Error('COMMAND_INVALID: 使用 --help 查看命令')
  for (const name of required[command]) if (!values[name]) throw new Error(`ARGUMENT_REQUIRED: --${name}`)
  const allowed = new Set([...required[command], ...(command === 'prepare' ? ['url'] : [])])
  for (const name of Object.keys(values)) if (!allowed.has(name)) throw new Error(`ARGUMENT_UNEXPECTED: --${name}`)
  const result = command === 'prepare'
    ? await prepare({ config: values.config, stateDir: values['state-dir'], url: values.url })
    : command === 'accept' ? await accept({ run: values.run, assignments: values.assignments })
      : await (command === 'publish' ? publish : compile)({ catalog: values.catalog, config: values.config, toolMap: values['tool-map'], output: values.output })
  console.log(JSON.stringify(result, null, 2))
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
