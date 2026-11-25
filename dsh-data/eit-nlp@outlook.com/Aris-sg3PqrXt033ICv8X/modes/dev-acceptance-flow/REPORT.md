# 研发—验收自动串通：方法与实现报告

- **范围**：`modes/dev-acceptance-flow` 宿主协调层（非模型对话本身）
- **日期**：2026-11-24
- **权威细则**：同目录 `README.md`、`TRANSITIONS.md`

## 一句话

研发与验收不靠聊天口令交接；宿主用项目根下的 `.flow` 账本做状态机，用 outbox 把提示自动投进对应会话，实现「送验 → 验收 → 整改/交付」闭环。

| 要点 | 说明 |
|---|---|
| 文件账本 | `.flow` 为唯一协调源 |
| 双预设 | `development` + `aris-acceptance` |
| Outbox | 跨会话自动投递 |
| 粘性绑定 | 中途不抢会话；进行中不换 PRD |

---

## 1. 方法：为什么这样串通

两边是独立 Agent 会话，不能共享内存。协调信息全部落在项目目录的 JSON 上：

- 研发只写 `submissions`
- 验收只写 `reviews`
- 宿主只根据**校验通过**的事件迁移状态，并决定下一步要 prompt 谁

验收账本（`acceptance-data`）仅作审计，**不驱动**放行。

### 研发侧契约

- 预设 `development`；phase 到 `ACCEPTANCE_GATE`
- 写出合法 `.flow/submissions/*.json` 才算送验
- 通过前不得进入 `PACKAGE`
- 整改认 finding id + `remediation` submission

### 验收侧契约

- 预设 `aris-acceptance`；对照 `flow.prd_relpath`
- 写出 `.flow/reviews/*.json`（verdict + findings）
- verdict：`passed` / `changes_required` / `blocked`
- `blocked` 不得记账本违约 `fail`

---

## 2. 状态机

禁止用聊天里的「通过」「完成」驱动。重复 `event_id` 忽略；旧 submission 的 `passed` 不能放行新的 `active_submission_id`。

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

**硬约束**：送验仅允许从 `developing` / `remediating` /（部分）`awaiting_user` 出发；**不能**从 `acceptance_passed` 再送 `initial`。

---

## 3. 实现：宿主每轮做什么

`flow-host-bridge`（Cordis 插件）约每 2s 一轮：

`auto-bind → pending-start → runHostOnce → ensureAcceptance → consumeOutbox`

| 模块 | 职责 | 要点 |
|---|---|---|
| `flow-host-bridge.js` | 宿主插件入口 | 上述循环；同进程 `sessionController.prompt` |
| `auto-bind-development.js` | 发现并绑定研发会话 | cwd + `development` 预设写 `.flow`；PRD 切换归档；中途钉死会话 |
| `ensure-acceptance-session.js` | 懒创建 / 粘性验收 | 仅送验需要时绑定或创建；已绑定且存活则不改绑、不新建 |
| `host-loop.js` + `transitions.js` | 状态机与校验 | 扫描 submissions/reviews，合法迁移才改状态并写 outbox |
| `outbox-consumer.js` + `prompt-templates.js` | 跨会话投递 | 动作 → 文案 → 投到研发或验收会话 |
| `active-prd.js` + `store.js` | 多 PRD 与落盘 | `.active-prd` / `prd_relpath`；`archiveFlowRoot` |

### 推荐上手路径

1. Web UI 用 `development` 预设开会话，cwd = 项目根；可选写 `.active-prd`
2. bridge auto-bind：bootstrap `.flow`（`acceptance_session_id=null`）
3. 研发实现与自检，到 `ACCEPTANCE_GATE` 写出 submission
4. 宿主采纳 → `awaiting_acceptance`，outbox 写 `prompt_acceptance`
5. `ensureAcceptanceSession` 创建/绑定验收并投递核查提示
6. 验收写 review：`passed` → 交付提示；`changes_required` → remediating + 整改提示
7. 整改后再送验；通过后 PACKAGE / delivering

---

## 4. Outbox：串通的「信使」

状态迁移成功后，宿主只往 `.flow/outbox` 写动作；consumer 生成文案并投递。Web UI 持锁时用同进程 driver，避免 SDK 抢 writer lock。

| 动作 | 触发 | 投向 |
|---|---|---|
| `prompt_development_start` | 新绑定 / 换 PRD bootstrap | 研发 |
| `prompt_acceptance` | submission 被采纳 | 验收 |
| `prompt_development_remediation` | review = changes_required | 研发 |
| `prompt_development_delivery` | review = passed | 研发 |

**投递目标**：优先 outbox 里记下的非占位 session id，其次才用 flow 上的绑定，防止中途重绑把整改送到错误会话。

---

## 5. 会话粘性与多 PRD

| 规则 | 保护条件 | 效果 |
|---|---|---|
| 研发会话粘性 | 送验/整改/待确认/已通过/交付/需人工等 | 不把 `development_session_id` 抢绑到同目录新开会话 |
| 验收会话粘性 | 已写入的 `acceptance_session_id` 且会话仍存活 | 不按「更优」排序改绑，也不再创建第二个验收 |
| Outbox 投递优先 | action 上非占位的 session id | 整改/验收提示跟原目标 |
| PRD 切换自动归档 | 送验/整改/待确认/交付**进行中**则拒绝 | 空闲或已通过等：归档 `.flow` → `.flow-archive-<时间戳>`，按 `.active-prd` 新开一轮 |

### 同目录多 PRD（串行，非并行）

- 多份 PRD 文件可并存；每轮只认一份
- 选择源：显式 `--prd` → `flow.prd_relpath` → `.active-prd` → `PRD.md`
- `project_id` 默认带 PRD 后缀（`PRD.md` 除外），例如 `test3` + `PRD-travel.md` → `test3-prd-travel`
- **不支持**同一 `.flow` 并行两套验收；要并行请用两个目录

### 落盘关键路径

```
.flow/flow.json
.flow/submissions/
.flow/reviews/
.flow/outbox/  .flow/outbox-done/
.flow/host-journal.jsonl
.active-prd
.flow-archive-<timestamp>/
```

---

## 6. 已知故障模式与对策

| 现象 | 根因 | 处理 |
|---|---|---|
| `不能从 acceptance_passed 送验` | 同目录上一轮未结束/未归档，又写了新 PRD 的 submission | 改 `.active-prd` 后由 auto-bind 归档，或 `start --force`；勿在旧周期硬塞 initial |
| 整改进了另一个研发会话 | 中途 auto-rebind / 投递用了被改写的 flow.session | 粘性状态 + outbox 优先 action.session_id（已落地） |
| 验收会话越开越多 | 每次 ensure 按排名改绑或重复 create | 已绑定且存活则 sticky；developing 且无送验需求时不预绑验收 |
| `project_id` 不一致被拒 | 换 PRD 后 id 带后缀，submission 仍写旧 id | 送验必须与当前 `flow.project_id` 一致 |

---

## 7. 运维与验证

### CLI

```sh
node modes/dev-acceptance-flow/cli.js start --project-root … [--prd …] [--force]
node modes/dev-acceptance-flow/cli.js status --project-root …
node modes/dev-acceptance-flow/cli.js once|cycle|watch --project-root …
npm test --prefix modes/dev-acceptance-flow
```

### 观察点

- `flow_status` + `active_submission_id`
- `host-journal`：accepted / rejected / rebound / archive
- `outbox-done`：是否投递成功
- 会话标题：`研发 · …` / `验收 · <prd stem>`

---

## 附录：与验收账本的 verdict 映射

| 协议 verdict | 账本 |
|---|---|
| `passed` | `acceptance_record` + `verdict=pass`，不写错题 |
| `changes_required` | 每条 blocking finding → fail / error_book_add |
| `blocked` | **不得**记违约 fail；只写 review |

本报告描述当前已落地行为（含会话粘性与 PRD 自动归档），不替代 `TRANSITIONS.md` 中的硬校验条文。
