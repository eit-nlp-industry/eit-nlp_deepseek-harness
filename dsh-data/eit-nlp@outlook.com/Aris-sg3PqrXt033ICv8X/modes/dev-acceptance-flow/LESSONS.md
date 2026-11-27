# 研发—验收自动串通：最耗时点与可复用经验

- **场景**：把 `development` / `aris-acceptance` 两个独立会话，用宿主 bridge + `.flow` 账本自动串成闭环
- **配套**：机制说明见 `REPORT.md`；状态机见 `TRANSITIONS.md`
- **日期**：2026-11-27

---

## 1. 时间都花在哪（按耗时大致排序）

### ① 会话「绑错人」——占比最高

**表现**
- 整改提示进了另一个研发会话，原会话停住
- 换 PRD 新开会话后，旧会话也收到「宿主协调：新项目开工」
- 验收会话越开越多、越绑越乱

**为什么耗时**
- 表面上是「提示发错了」，根因在三层叠加：`auto-bind` 抢绑、`ensureAcceptance` 排名改绑、`resolveSessionId` 优先读了被改写的 `flow`
- 必须对照 `host-journal`、`outbox-done` 里的 `session_id`，和 UI 里实际会话 id 对齐，才能定责
- 修一处不够：只 sticky 研发、或只改投递优先级，都会漏一种漂移

**可复用结论**
> 凡「跨会话自动传话」系统：绑定、投递、创建 必须同一套粘性策略；排障时以 journal 里的 session_id 为准，不要只看聊天内容。

---

### ② 同目录多 PRD vs 单份 `.flow`——理解成本高

**表现**
- 以为「多 PRD」= 能并行；实际是串行 + 一份活跃账本
- 换 PRD 后送验被拒：`不能从 acceptance_passed 送验`
- 纠结要不要「每 PRD 一份 `.flow`」

**为什么耗时**
- 产品语义和实现约定不一致时，会反复试：改 `.active-prd`、重开会话、再送验，仍撞同一状态机硬墙
- 需要先讲清「代码还在 / 协调账本只有一份 / 换轮要归档」，再谈自动化

**可复用结论**
> 先写清「一个协调根同一时间几份账本」；多规格若共享同一 cwd，默认串行。换规格 = 换活跃账本（归档或 per-spec 目录），不能只改指针文件。

---

### ③ 放行语义：口头 vs 文件协议

**表现**
- 容易对外说成「验收说通过就行」
- 实际放行只认 `.flow/reviews/*.json` 且字段对齐 active submission

**为什么耗时（偏沟通）**
- 解释不清时，联调双方会在聊天里「通过」却永远不迁状态，误以为 bridge 坏了

**可复用结论**
> 双 Agent 交接一律「落盘 JSON + 宿主校验」；聊天只做人机沟通，不做人机状态机。对外一句话：放行 = 写出合法 review，不是口头通过。

---

### ④ 运行环境干扰（端口、进程、Caddy）

**表现**
- 容器内 Vite 已起，本机浏览器打不开
- 为加载修复手动占 Harness 端口，导致 UI「Could not restart」

**为什么耗时**
- 和应用逻辑无关，但会打断验证闭环；权限不够改 Caddy 时只能绕到已映射端口

**可复用结论**
> 预览优先走已映射端口；不要长期手拉 Harness 同端口进程。改插件后让用户从 UI 重启，避免抢 `EADDRINUSE`。

---

### ⑤ 真正「写状态机/协议」反而不是最久的

schema、transitions、outbox 模板一次设计清楚后，单测能挡住大部分回归。
**最久的是运行时绑定与多会话并发假设**，不是纯函数迁移表。

---

## 2. 可复用经验（短版）

已收成个人 Skill，其它类似「多会话 + 文件账本 + 宿主传话」场景可直接唤起：

`~/.cursor/skills/multi-agent-ledger-bridge/SKILL.md`
（Skill 名：`multi-agent-ledger-bridge`）

要点：

1. **排障**：`flow` → journal → `outbox-done` 的 `session_id`，再改代码；「双会话 + 换规格」回归。
2. **粘性三件套**：绑定 / 投递 / 创建 同一套策略。
3. **换规格**：选新会话 + 归档整份账本，不要只改指针、不要按列表顺序绑。
4. **放行**：合法结果 JSON，不是口头通过。

---

## 3. 本任务已落地的关键修复（索引）

| 问题 | 关键改动位置 |
|---|---|
| 研发中途被抢绑 | `auto-bind-development.js` → `STICKY_DEVELOPMENT_FLOW_STATUSES` |
| 换 PRD 开工打到旧会话 | `preferDevelopmentSession` + 按 root 成组绑定 |
| 换 PRD 仍停在 acceptance_passed | `archiveFlowRoot` + 非保护态自动归档 |
| 验收重复创建/改绑 | `ensure-acceptance-session.js` 粘性；无送验不预绑 |
| 投递跟错 flow | `prompt-templates.js` → `resolveSessionId` 优先 action |

更完整的现象/原因/对策叙述见 `REPORT.md` 第 4 节。
