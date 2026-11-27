# 研发—验收自动串通：方法、实现与问题记录

- **范围**：`modes/dev-acceptance-flow` 宿主协调层（非模型对话本身）
- **更新日期**：2026-11-27
- **权威细则**：同目录 `README.md`、`TRANSITIONS.md`
- **复盘（耗时点 / 可复用经验）**：同目录 `LESSONS.md`

## 一句话

研发与验收是两个独立 Agent 会话，不能靠聊天口令交接。宿主在项目根维护一份 `.flow` 账本：研发写送验 JSON，验收写评审 JSON，宿主校验后改状态，再通过 outbox 自动把提示投进对方会话，形成闭环。

| 要点 | 说明 |
|---|---|
| 文件账本 | `.flow` 为唯一协调源；会话 id 只是关联 |
| 双预设 | `development`（研发）+ `aris-acceptance`（验收） |
| Outbox | 跨会话自动投递的「信使」 |
| 粘性绑定 | 中途不抢研发/验收会话；进行中不换 PRD |

---

## 1. 怎么串通：端到端链路

### 1.1 角色分工

| 角色 | 做什么 | 不做什么 |
|---|---|---|
| 研发会话 | 按 PRD 实现、自检；到门禁写 `.flow/submissions/*.json` | 不直接改 `flow_status`；通过前不进 PACKAGE |
| 验收会话 | 对照 `flow.prd_relpath` 核查；写 `.flow/reviews/*.json` | 不靠口头「通过」放行；blocked 不记账本违约 |
| 宿主 bridge | 轮询账本、校验、迁移状态、创建/绑定会话、投递 outbox | 不替代两边写业务代码 |
| 验收账本 `acceptance-data` | 审计轨迹 | **不驱动**宿主放行 |

### 1.2 宿主每轮（约 2 秒）

`flow-host-bridge` 同进程挂在 Harness 上，顺序是：

```
auto-bind 研发会话
    → 消费 pending-start（可选 CLI 开工）
    → runHostOnce（扫 submissions / reviews，做状态迁移，写 outbox）
    → ensureAcceptanceSession（需要时才建/绑验收会话）
    → consumeOutbox（把提示 prompt 进对应会话）
```

投递用 `sessionController.prompt`（Web UI 同进程），避免外部 SDK 抢会话写锁。

### 1.3 一次完整闭环（串通时序）

```
用户开 development 会话（cwd=项目根，可选 .active-prd）
        │
        ▼
auto-bind：写 .flow/flow.json
  flow_status=developing
  development_session_id=<该会话>
  acceptance_session_id=null
  prd_relpath=选定 PRD
        │
        ▼
研发实现 + 自检 → 写出 submission（kind=initial）
        │
        ▼
宿主采纳 submission
  flow_status=awaiting_acceptance
  outbox ← prompt_acceptance
        │
        ▼
ensureAcceptance：创建/绑定 aris-acceptance
  投递「请按 submission 核查」到验收会话
        │
        ▼
验收写出 review
  ├─ passed           → acceptance_passed
  │                     outbox ← prompt_development_delivery → 研发可 PACKAGE
  ├─ changes_required → remediating
  │                     outbox ← prompt_development_remediation → 原研发会话整改
  │                     整改后再写 kind=remediation submission → 再验收
  └─ blocked          → awaiting_user（补材料后必须重新送验）
```

**串通的关键点只有三处文件交接：**

1. 研发 → 宿主：`.flow/submissions/<id>.json`
2. 宿主 → 验收：outbox `prompt_acceptance`（投进验收会话）
3. 验收 → 宿主 → 研发：`.flow/reviews/<id>.json` → outbox 整改/交付提示（投进研发会话）

禁止用聊天里的「通过」「完成」驱动迁移。合法迁移只认校验通过的 submission/review，且 `review.submission_id === flow.active_submission_id`、`reviewed_revision === code_revision`。

### 1.4 Outbox 动作表

| 动作 | 何时写入 | 投向 |
|---|---|---|
| `prompt_development_start` | 新绑定 / 换 PRD bootstrap | 研发 |
| `prompt_acceptance` | submission 被采纳 | 验收 |
| `prompt_development_remediation` | review = changes_required | 研发 |
| `prompt_development_delivery` | review = passed | 研发 |

投递解析：`prompt-templates.resolveSessionId` **优先 outbox 里非占位的 session id**，其次才用 `flow` 上的绑定，避免中途重绑把整改送到错误会话。

### 1.5 模块对照

| 模块 | 职责 |
|---|---|
| `flow-host-bridge.js` | Cordis 插件入口；定时跑整条链路 |
| `auto-bind-development.js` | 发现 live 研发会话、bootstrap/重绑、PRD 切换归档 |
| `ensure-acceptance-session.js` | 懒创建验收；粘性保活；标题按 PRD stem |
| `host-loop.js` + `transitions.js` + `validate.js` | 扫盘、结构校验、合法状态迁移 |
| `outbox-consumer.js` + `prompt-templates.js` | 读 outbox、生成文案、投递、归档到 outbox-done |
| `active-prd.js` + `store.js` | PRD 选择与 `.flow` 读写/归档 |
| `start-project.js` / `cli.js` | 脚本化开工；`--force` 先归档再开 |

### 1.6 落盘

```
<project_root>/
  .active-prd                 # 单行指针：当前要用的 PRD 相对路径
  .flow/
    flow.json                 # 当前协调状态（覆盖写）
    submissions/              # 送验（只追加）
    reviews/                  # 验收结果（只追加）
    findings.json             # finding 生命周期
    outbox/  outbox-done/     # 待投递 / 已投递
    host-journal.jsonl        # 宿主处理日志
  .flow-archive-<时间戳>/     # 换 PRD 或 force 时整份归档
  .development/               # 研发自身状态（本协议不复制 tasks）
```

宿主重启后以 `flow_status` + `active_submission_id` 恢复；会话 id 不单独充当状态源。

---

## 2. 状态机（摘要）

```
bootstrapping → developing → awaiting_acceptance
                    │
        ┌───────────┼───────────┐
        │           │           │
     blocked   changes_required  passed
        │           │           │
 awaiting_user  remediating  acceptance_passed
 / failed_*         │           │
                    │      delivering → delivery_completed
                    └─(再送验)─┘
              超轮次 → needs_manual
```

**硬约束**：送验只允许从 `developing` / `remediating` /（部分）`awaiting_user` 出发；**不能**从 `acceptance_passed` 再送 `initial`。重复 `event_id` 忽略；旧 submission 的 `passed` 不能放行新的 `active_submission_id`。

---

## 3. 会话粘性与多 PRD

| 规则 | 条件 | 效果 |
|---|---|---|
| 研发会话粘性 | 送验/整改/待确认/已通过/交付/需人工等 | 不把 `development_session_id` 抢给同目录新开会话 |
| 验收会话粘性 | 已绑定 id 且会话仍存活 | 不按「更优」排序改绑，也不新建第二个验收 |
| 无送验不预绑验收 | `developing` 且无 acceptance outbox | 不把旧验收会话提前绑进新周期 |
| Outbox 投递优先 | action 上非占位 session id | 整改/验收跟原目标 |
| PRD 切换自动归档 | 进行中（送验/整改/待确认/交付）拒绝 | 空闲或已通过等：`.flow` → `.flow-archive-*`，再按 `.active-prd` bootstrap |

### 同目录多 PRD = 串行，不是并行

- 多份 PRD 文件可并存；**同一时间只有一份活跃 `.flow`**
- 选择源：`--prd` → `flow.prd_relpath` → `.active-prd` → `PRD.md`
- `project_id` 默认带 PRD 后缀（`PRD.md` 除外），如 `test3` + `PRD-travel.md` → `test3-prd-travel`
- 要并行两套验收：用两个目录，或将来改成 per-PRD `.flow`（当前未做）
- 改「以前某 PRD 做出的程序」：代码/git 还在；把 `.active-prd` 指回那份 PRD（必要时 checkout 旧提交）开新一轮即可，不必复活旧状态机

---

## 4. 遇到过的问题与解决（实战记录）

### 问题 A2：换 PRD 新开会话后，旧研发会话也收到「宿主协调：新项目开工」

**现象（test3）**
新开会话保存 `PRD-test.md` 并写入 `.active-prd` 后开工；旧的旅行 PRD 研发会话里也出现一条 `prompt_development_start`（project_id=`test3-prd-test`）。journal 显示 kickoff 投到了旧 id `session-a1d9baaf…`。

**原因**
PRD 切换归档后，auto-bind 按 `sessions.list()` 顺序遍历，先碰到仍存活的旧会话就用它 bootstrap，并把开工 outbox 打给它。

**解决**
同目录多个 live 研发会话时，`preferDevelopmentSession`：优先绑定「不是上一轮 development_session_id」的对等会话，再按 `createdAt` 取最新；旧会话记为 `prd_switch_bound_to_peer`，不再收开工提示。

### 问题 A：整改提示进了另一个研发会话，原会话停住；随后又新开验收

**现象**
第一轮研发已送验；验收结果/整改却落到同目录后开的第二个研发会话；原会话不再继续；验收侧出现多个「验收 · …」会话。

**原因**
1. auto-bind 在原研发会话短暂不在 `sessions.list()` 时，把 `development_session_id` 抢绑到新会话。
2. 投递当时优先读 `flow` 上的 session id，flow 被改写后 outbox 也跟错人。
3. ensureAcceptance 按「人类标题 / workspace」排名，会从已绑定的 live 验收改绑到「更优」会话，或重复 create。

**解决**
- `STICKY_DEVELOPMENT_FLOW_STATUSES`：协调中途禁止抢绑研发会话。
- 验收：已绑定且仍 live → `already_bound_live`，绝不改绑/新建；仅当原 id 消失才收养其它 live。
- `resolveSessionId`：优先 outbox 非占位 id；研发重绑时 patch development outbox。
- developing 且尚无送验需求时，不预绑验收（避免重置后立刻绑回旧验收）。

### 问题 B：`不能从 acceptance_passed 送验`（换 PRD 后写 sub-002 被拒）

**现象（test3）**
上一轮 `PRD.md` 已 `acceptance_passed`；改 `.active-prd` 为 `PRD-travel.md` 并开发完成后写 `sub-002`，宿主拒绝：`TRANSITION_REJECTED`，`from=acceptance_passed`。

**原因**
一个项目根只有一份活跃 `.flow`。改指针不会自动开新周期；状态机不允许从「已通过」再送 `initial`。这不是「不能多 PRD」，而是「串行切换时账本还停在旧轮」。

**解决**
1. 手工：归档/重置 `.flow`，再按新 PRD 送验（曾对 test3 做过）。
2. 自动化：auto-bind 发现 `.active-prd` ≠ `flow.prd_relpath`，且不在保护态（送验/整改/待确认/交付）时，调用 `archiveFlowRoot` 归档整份 `.flow`，再 bootstrap；`cli start --force` 同样先归档。
3. 新轮 `project_id` 带 PRD 后缀；送验必须写当前 `flow.project_id`。

### 问题 C：同目录多 PRD 时会话列表混乱、绑错验收

**现象**
多个「验收 · test-prd」并存；workspace 分组不准；提示打到占位或错误会话。

**解决**
- 验收标题按 PRD stem：`验收 · travel-prd`。
- 创建时优先挂同一 Workspace（避免「未分组」）。
- 懒创建：首次送验才建验收；粘性绑定减少克隆。

### 问题 D：schema/review 格式不稳导致采纳失败

**现象**
验收写出的 review 字段类型/枚举与 schema 不完全一致，宿主拒收或无法迁移。

**解决**
`validateReview` 侧做必要的规范化/容错（字符串枚举、finding 字段等）；仍以 schema 为准，非法结构继续失败并记 journal。

### 问题 E：预览旅行程序端口本机打不开

**现象**
容器内 Vite 已起，但 `10.37.0.21:15173` 浏览器无法访问。

**原因**
临时端口不在已映射/放行集合里；`n8n.home:443` 未配该反向代理且改 Caddy 需提权。

**解决**
改绑到已映射端口（如容器 `13186` → 主机 `10.37.0.21:13186`）；用毕停掉 Vite/转发。

---

## 5. 运维与观察点

```sh
node modes/dev-acceptance-flow/cli.js start --project-root … [--prd …] [--force]
node modes/dev-acceptance-flow/cli.js status --project-root …
node modes/dev-acceptance-flow/cli.js once|cycle|watch --project-root …
npm test --prefix modes/dev-acceptance-flow
```

| 看什么 | 说明 |
|---|---|
| `flow_status` + `active_submission_id` | 当前处在哪一环 |
| `prd_relpath` / `.active-prd` | 本轮认哪份 PRD |
| `development_session_id` / `acceptance_session_id` | 是否粘在正确会话 |
| `host-journal.jsonl` | accepted / rejected / rebound / archive |
| `outbox` → `outbox-done` | 提示是否投递成功 |
| 会话标题 | `研发 · …` / `验收 · <prd stem>` |

---

## 附录：verdict → 验收账本

| 协议 verdict | 账本 |
|---|---|
| `passed` | `acceptance_record` + pass，不写错题 |
| `changes_required` | 每条 blocking finding → fail / error_book_add |
| `blocked` | **不得**记违约 fail；只写 review |

本报告描述已落地行为与实战问题记录，不替代 `TRANSITIONS.md` 硬校验条文。独立阅读可用同目录 `REPORT.html`（浏览器打开；打印可另存 PDF）。
