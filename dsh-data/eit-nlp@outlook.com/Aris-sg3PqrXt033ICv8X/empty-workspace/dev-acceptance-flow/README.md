# 研发—验收协作协议（草案 v1）

本目录定义宿主协调层的最小 JSON 协议与状态机。权威交接数据在此协议中；`aris-acceptance` 账本仅作按项目审计轨迹，不驱动宿主放行。

## 落盘约定

相对目标项目根目录（`project_root`）：

| 路径 | 内容 |
|---|---|
| `.flow/flow.json` | 当前协调状态（单文件覆盖写） |
| `.flow/submissions/<submission_id>.json` | 送验记录（不可变；只追加新文件） |
| `.flow/reviews/<review_id>.json` | 验收结果（不可变；只追加新文件） |
| `.flow/findings.json` | 稳定 finding 生命周期表（可更新） |
| `.flow/outbox/<action>.json` | 宿主循环写出的下一步动作（如 `prompt_acceptance`） |
| `.flow/outbox-done/` | 已投递的 outbox 归档 |
| `.flow/dispatch/` | file driver 写出的待发送 prompt（json + txt） |
| `.flow/host-journal.jsonl` | 宿主处理日志 |
| `.flow/host-seen.json` | 已拒绝 event 去重 |
| `.development/` | 研发既有状态，本协议不复制 tasks |
| `acceptance-data/projects/<project_id>/` | 验收账本审计，由验收工具写入 |

宿主重启后以 `.flow/flow.json` 的 `flow_status` + `active_submission_id` 恢复；会话 id 仅作关联，不单独充当状态源。

## 状态机

```
                    ┌──────────────────────┐
                    │     bootstrapping    │
                    └──────────┬───────────┘
                               │ 会话与 project_id 就绪
                               ▼
                    ┌──────────────────────┐
           ┌───────►│      developing      │◄──────────────┐
           │        └──────────┬───────────┘               │
           │                   │ 研发需用户澄清              │ 用户已回复
           │                   ▼                           │
           │        ┌──────────────────────┐               │
           │        │    awaiting_user     │───────────────┘
           │        └──────────────────────┘
           │                   │ 最终自检通过并写出 submission
           │                   ▼
           │        ┌──────────────────────┐
           │        │ awaiting_acceptance  │
           │        └──────────┬───────────┘
           │         ┌─────────┼─────────┐
           │         │         │         │
           │    blocked   changes_   passed
           │         │    required       │
           │         ▼         ▼         ▼
           │  awaiting_user  remediating  acceptance_passed
           │  或 failed_     │                │
           │  terminal       │ 新 submission   │ 宿主放行 PACKAGE
           │                 └──────┐         ▼
           │                        │    delivering
           │                        │         │
           │                        │         ▼
           │                        │  delivery_completed
           │                        │
           │     超 max_remediation_rounds
           │                        ▼
           │                 needs_manual
           └──── 未超轮次且继续开发 ─┘
```

`acceptance_passed` 与 `delivery_completed` 必须分开展示；验收通过不等于部署成功。

禁止用聊天里的「通过」「完成」驱动迁移。合法迁移只认：

1. 校验通过的 `submission` / `review` JSON；
2. `review.submission_id === flow.active_submission_id`；
3. `review.reviewed_revision === submission.code_revision`。

## 与研发 / 验收契约的衔接

研发（`development`）已落地等待验收能力：

- `state.phase = ACCEPTANCE_GATE`
- `state.status = AWAITING_ACCEPTANCE`
- skill：`flow-acceptance-handoff`

在写出合法 `submission` 之前不得进入 `PACKAGE`。
不要复用已禁止的 `WAITING_FOR_APPROVAL`。验收侧需写 `.flow/reviews/<id>.json`（见 `aris-acceptance-preset/FLOW-REVIEW.md`）。


验收（`aris-acceptance`）账本映射：

| 协议 `verdict` | 账本调用 |
|---|---|
| `passed` | `acceptance_record` + `verdict=pass`，不写错题 |
| `changes_required` | 每条 blocking finding → `acceptance_record` `fail` 或 `error_book_add` |
| `blocked` | **不得**记为违约 `fail`；只写 review，必要时普通说明 |

## Schema 文件

- `schemas/flow.schema.json`
- `schemas/submission.schema.json`
- `schemas/review.schema.json`
- `schemas/findings.schema.json`
- `schemas/defs.schema.json`（共用定义）

## 宿主校验器

可执行守卫在本目录纯 JS 模块中，**不含**会话创建 / `prompt` / 落盘；调用方负责 I/O。

| 模块 | 职责 |
|---|---|
| `validate.js` | flow / submission / review 结构校验；`ledgerPolicyForVerdict` |
| `transitions.js` | 合法迁移：`bootstrapFlow`、`applySubmission`、`applyReview` 等 |
| `findings.js` | 稳定 finding 生命周期合并 |
| `index.js` | 对外导出 |

```js
import {
  bootstrapFlow,
  applySubmission,
  applyReview,
  applyStartDelivery,
  applyDeliveryCompleted,
} from '@local/dsh-dev-acceptance-flow'

const boot = bootstrapFlow({
  project_id: 'todo-demo',
  project_root: '/projects/todo-demo',
  development_session_id: 'sess-dev',
  acceptance_session_id: 'sess-acc',
})

const submitted = applySubmission({
  flow: boot.flow,
  submission, // 已按 schema 写出的对象
  findings: boot.findings,
})
if (!submitted.ok) throw new Error(submitted.message)

const reviewed = applyReview({
  flow: submitted.flow,
  submission,
  review,
  findings: submitted.findings,
})
// reviewed.action: acceptance_passed | remediating | acceptance_blocked | needs_manual
// reviewed.ledgerPolicy: 是否允许写验收账本违约
```

重复 `event_id` 返回 `{ ok: true, ignored: true }`，不改状态。
旧 `submission_id` 的通过结果对着新 `active_submission_id` 会得到 `STALE_OR_FOREIGN_SUBMISSION`。

```sh
npm test --prefix empty-workspace/dev-acceptance-flow
```

## 最小宿主循环

`store.js` 负责 `.flow/` 读写；`host-loop.js` 扫描/轮询 `submissions/` 与 `reviews/`，调用校验器并写回状态与 outbox。
**本层仍不创建会话、不 `prompt`**；会话驱动应消费 `.flow/outbox/`。

```sh
# 初始化协调状态
node empty-workspace/dev-acceptance-flow/cli.js init \
  --project-root /path/to/todo-demo \
  --project-id todo-demo \
  --dev-session sess-dev \
  --acc-session sess-acc

# 研发写出 .flow/submissions/sub-001.json 后扫一次
node empty-workspace/dev-acceptance-flow/cli.js once --project-root /path/to/todo-demo

# 持续监听
node empty-workspace/dev-acceptance-flow/cli.js watch --project-root /path/to/todo-demo

# 查看状态
node empty-workspace/dev-acceptance-flow/cli.js status --project-root /path/to/todo-demo
```

成功送验后 outbox 典型动作：`prompt_acceptance`。
验收 `passed` 后：`prompt_development_delivery`；`changes_required` 后：`prompt_development_remediation`。

## Outbox 消费器

`outbox-consumer.js` 读取 outbox，用 `prompt-templates.js` 生成投递文案，经可注入的 SessionDriver 发送：

| Driver | 行为 |
|---|---|
| `file`（默认） | 写入 `.flow/dispatch/*.json` + `.txt` |
| `memory` | 测试用 |
| `stdout` | CLI 调试打印 |
| `sdk` | 子进程 Harness，真实 JSON-RPC `session/prompt` |
| `createHostSessionControllerDriver` | 同进程 `sessionController.prompt`（Web UI 持锁时用） |

```sh
# 校验交接 + 投递 outbox（file driver）
node empty-workspace/dev-acceptance-flow/cli.js cycle --project-root /path/to/project

# 真实 session/prompt（需 DSH_HOME；profile 默认 n8n-web）
DSH_HOME=/data/dsh/eit-nlp@outlook.com/Aris-sg3PqrXt033ICv8X \
  node empty-workspace/dev-acceptance-flow/cli.js cycle \
  --project-root /path/to/project \
  --driver sdk

# 投递后等待 agent idle
node empty-workspace/dev-acceptance-flow/cli.js outbox --project-root /path/to/project --driver sdk --wait-idle
```

```js
import {
  createSdkSessionDriver,
  createHostSessionControllerDriver,
  runHostCycle,
} from '@local/dsh-dev-acceptance-flow'

// A. 自动化：SDK 子进程 → session/prompt
const sdk = createSdkSessionDriver({
  dshHome: process.env.DSH_HOME,
  profile: 'n8n-web',
  cwd: projectRoot,
})
await runHostCycle({ projectRoot, driver: sdk })
await sdk.close()

// B. Web 同进程：Cordis 里注入 sessionController
const host = createHostSessionControllerDriver(ctx.sessionController)
await runHostCycle({ projectRoot, driver: host })
```

Web UI 已打开同一 Session 时，外部 SDK `resume` 可能遇到 writer lock；此时应挂载 `flow-host-bridge`（`createHostSessionControllerDriver`），不要用第二个进程抢锁。
