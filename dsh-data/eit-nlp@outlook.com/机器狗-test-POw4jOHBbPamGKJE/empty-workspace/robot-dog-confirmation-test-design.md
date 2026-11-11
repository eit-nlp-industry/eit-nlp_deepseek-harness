# 机器狗「执行中途确认」测试设计

## 1. 目标

用户一句话下达任务 → 机器狗开始执行 → 执行到某一步需要用户补充/确认信息 →
agent 根据工具返回的中间结果向用户提问 → 用户答复 → 继续执行直到完成。

## 2. 先看硬约束（决定了方案形态）

当前「机器狗-job」预设的运行模型有三条限制：

1. **模型只在轮次边界运行。** Job 在后台跑的时候，模型没有被调用，无法主动"插话"提问。
2. **Job 只有终态。** `index.js:250` 用 `ctx.jobs.start` 建 Job，只有 `succeeded/failed/cancelled` 能 settle，
   没有"运行中推送事件给模型"的通道。
3. **回调只收终态。** `callback-server.js:5` 的 `TERMINAL_STATUSES` 只允许三种终态，
   `job-bridge.js:66` 的 `accept` 遇到非终态直接抛错。
   另外 `index.js:22` 的控制策略要求 Job 终态通知"原文直出、禁止再调工具"。

结论：**"执行中途确认"不能实现为"Job 运行中模型插话"，只能建模成
「任务暂停（终态事件）→ 用户轮次 → 恢复调用（新 Job）」**。
这在体验上仍然是"执行到一半停下来问"，只是底层是两段 Job。

## 3. 推荐方案：暂停事件 + 确认轮次 + 恢复调用

### 3.1 时序

```
用户：把这份样品送到 3F 实验室给王工
  │
  ▼
agent：handoff_delivery(...)  ──────────────► 机器人 MCP
  │                                             │ 开始运动，返回 task_id=T1, running
  │◄───────────── task_id=T1 ───────────────────┘
  │  index.js 建 Job(J1)，bridge 登记 T1↔J1
  ▼
机器人：走到 3F 门口，发现两位佩戴工牌人员，工牌不可读
  │  POST /robot-task-results  { task_id:T1, status:"input_required",
  │                              message:"{\"type\":\"confirmation\",\"question\":\"...\",\"options\":[...]}" }
  ▼
callback-server → bridge.accept(T1) → J1 settle
  ▼
Job 终态通知进入会话（这是模型被唤醒的唯一时机）
  ▼
agent：识别为确认请求（不是完成），用一句中文提问并结束本轮
  │  「门口有两位，工牌看不清：左侧尾号 3721，右侧 8890，交给哪位？」
  ▼
用户：左边，王工
  ▼
agent：confirm_action(task_id:"T1", decision:{option_id:"left"})  ──► 机器人
  │                                                              │ 恢复暂停的动作
  │◄──────────── task_id=T2, running ────────────────────────────┘
  ▼
index.js 建 Job(J2)  ← 注意必须是新 task_id
  ▼
机器人完成交付 → POST { task_id:T2, status:"succeeded", message:"已交给左侧人员，签收成功" }
  ▼
J2 settle → agent 原文直出结果
```

### 3.2 为什么必须是新 task_id

`index.js:241` 有 `bridge.has(started.taskId)` 判断，而 `job-bridge.js:34` 在 settle 后会把
`task_id` 以 `terminal:true` 永久保留。若恢复调用复用 T1，`has(T1)` 为真 → **不会建新 Job** →
任务静默卡死。所以 `confirm_action` 必须返回新的 task_id。

### 3.3 需要改的四处

| 文件 | 改动 |
|---|---|
| `callback-server.js:5` | `TERMINAL_STATUSES` 增加 `input_required`（或单独白名单） |
| `job-bridge.js:11` | `jobOutcome` 对 `input_required` 返回 `{status:'completed', result: message}`；`accept` 放行该状态 |
| `index.js:22` 控制策略 | 新增分支：Job 结果是确认请求时，**不**原文直出、不声称完成，转成一句中文问题后结束本轮 |
| `cordis.patch.yml:102` ragflow 配置 | `eagerTools` 增加 `mcp__robot__confirm_action`、`mcp__robot__cancel_task`，否则工具被渐进披露隐藏，agent 看不到 |

> 若暂时不想改代码，退化方案：让机器人在暂停时直接返回 `succeeded`，`message` 写成给用户看的
> 问题文本。这样"原样转述问题 → 用户答复 → 恢复调用"能跑通，但 agent 不能改写/组织问题，
> 也无法区分"真完成"和"要确认"。

## 4. 场景设计

### 主场景：3F 送样品（信息缺失型确认）

- 用户：「把这份样品送到 3 楼实验室给王工」
- 中间结果：到达门口后 `handoff_delivery` 返回/回调 `input_required`
  —— 门口两人，工牌姓名不可读，只有尾号。
- agent 提问：一句话，列出两个选项与依据。
- 用户：「左边那位」
- 恢复：`confirm_action(T1, {option_id:"left"})` → 交付 → 成功回执。

判定点：机器人停在门口等待，不继续运动；问题里不出现 JSON、task_id、confirmation_id。

### 变体 A：跟随目标丢失（状态变化型确认）

- 用户：「跟着我」
- 中途：`follow_person` 回 `input_required` ——「目标离开视野 8 秒，是否原地等待 30 秒 / 返回起点 / 停止跟随」
- 用户选择 → `confirm_action` 恢复。
- 覆盖：选项型确认、超时分支。

### 变体 B：受限区域授权（补充参数型确认）

- 用户：「去 B2 机房看看服务器指示灯」
- 中途：`navigate` 回 `input_required` ——「B2 门禁需要 6 位授权码」
- 用户给码 → `confirm_action(T1, {text:"483920"})` → 继续。
- 覆盖：自由文本输入，且**不得把授权码写进最终回复或日志**。

### 反例（不应触发确认）

- 目的地唯一且用户已明确（「去 3F 会议室」）→ 直接执行，不得多问。
- 用户已给全信息（收件人、房间号、时间）→ 不得重复确认。

## 5. 回调/工具契约

回调（机器狗 → DSH）：

```json
{
  "task_id": "T1",
  "status": "input_required",
  "message": "{\"type\":\"confirmation\",\"question\":\"门口有两位，交给哪位？\",\"options\":[{\"id\":\"left\",\"label\":\"左侧（尾号3721）\"},{\"id\":\"right\",\"label\":\"右侧（尾号8890）\"}],\"expires_in_sec\":120,\"on_timeout\":\"wait_in_place\"}"
}
```

恢复工具（agent → 机器狗）：

```json
confirm_action({
  "task_id": "T1",
  "decision": { "option_id": "left" },     // 或 { "text": "王工，尾号3721" }
  "idempotency_key": "T1:left"
})
→ { "task_update": { "task_id": "T2", "status": "running" } }
```

取消：

```json
cancel_task({ "task_id": "T1", "reason": "用户取消" })
→ { "task_update": { "task_id": "T1", "status": "cancelled" } }
```

约束：

- `confirm_action` 幂等：同一 `idempotency_key` 重复调用返回同一个 T2，不得建第二个 Job。
- 暂停期间机器人必须安全静止（stand/wait），不得继续运动。
- 超时策略默认 `wait_in_place`，不要默认返回（避免用户还在看手机时狗自己走了）。

## 6. 状态机

```
running ──需要信息──► input_required ──confirm──► running(新 task_id) ──► succeeded
   │                        │
   │                        ├──cancel_task──► cancelled
   │                        └──expires──► expired（机器人按 on_timeout 执行，回调 failed/cancelled）
   └──失败/取消──► failed / cancelled
```

`input_required` 只能由 `running` 进入；`succeeded/failed/cancelled` 后不得再进入。

## 7. 测试矩阵

| # | 用例 | 输入 | 期望 |
|---|---|---|---|
| 1 | 正常确认 | 送样品 → 「左边」 | J1 completed(input_required) → 一句提问 → J2 running → completed → 原文直出 |
| 2 | 自由文本 | 「给王工，尾号 3721」 | 解析为 text 决策，不猜测选项 |
| 3 | 拒绝 | 「别给了，带回来」 | 调 cancel_task（或 stop），不调 confirm，如实说明 |
| 4 | 含糊答复 | 「就他」 | 再问一次，不擅自选择 |
| 5 | 确认前改需求 | 「不送了，去前台」 | 先取消 T1，再重新规划，不得并发 |
| 6 | 重复确认 | 连发两次「确认」 | 幂等，只建一个 J2 |
| 7 | 超时 | 120s 不回复 | 机器人原地等待；状态如实说明，不谎称完成 |
| 8 | 二次确认 | 恢复后再次 input_required | 支持连续暂停，仍用新 task_id |
| 9 | 回调乱序 | input_required 先于 Job 登记 | bridge pending 缓存生效，不丢事件 |
| 10 | 旧 task_id 复用 | confirm 返回 T1 | 应被拒绝/修正为 T2，否则 Job 不建 |

通过标准：

- 用户可见的只有一句自然语言问题，无 JSON、无字段名、无 task_id；
- Job 卡片：J1 = completed，J2 = running → completed，无并发 Job；
- 最终回复与 J2 的 `result` 完全一致；
- 机器人暂停期间无位移；
- 日志无 `ERR_MODULE_NOT_FOUND`、无 `Ignored invalid robot job result`、无 `TERMINAL_CONFLICT`。

## 8. 已知缺口

1. **超时无人唤醒。** 用户不回复时模型不会被调用，只能在下一轮用户说话时说明状态。
   若需要主动提醒，得另外接调度/提醒能力，当前预设没有。
2. **确认请求与终态共用一条回调通道。** 建议 `message` 用 JSON 且带 `type`，
   便于后续加 `type:"progress"` 等扩展，同时保持 `callback-server.js` 只允许
   `task_id/status/message` 三个字段的收紧策略。
3. **包名错位未修。** `robot-dog-a-preset/cordis.patch.yml:93,100` 仍用
   `@local/dsh-robot-dog-job-preset/*`，而该链接不存在，Job 桥可能压根没加载。
   本测试开始前必须先修，否则测的是"没有 Job 桥"的预设。

## 9. 落地清单

- [ ] 修 `cordis.patch.yml` 两处 specifier → `@local/dsh-robot-dog-a-preset/*`
- [ ] `callback-server.js` 放行 `input_required`
- [ ] `job-bridge.js` 的 `jobOutcome/accept` 支持 `input_required`
- [ ] `index.js` 控制策略增加"确认请求"分支
- [ ] `eagerTools` 增加 `confirm_action` / `cancel_task`
- [ ] 机器狗后端实现暂停态、`confirm_action`、新 task_id、超时策略
- [ ] 用 mock MCP 先跑通 1/3/6/7，再接真机
