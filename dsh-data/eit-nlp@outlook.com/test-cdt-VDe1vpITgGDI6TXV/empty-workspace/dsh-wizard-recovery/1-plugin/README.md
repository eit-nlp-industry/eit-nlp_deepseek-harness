# @local/dsh-wizard · 向导视图（MVP）

会话级「向导」页签：所有阶段在同一容器内原位切换；Chat 与轨迹保持原样。

## 入口

- 视图页签：会话头部 `Chat / 向导 / 轨迹` 中的 **向导**（`conversation.view`，id `wizard`，order 5）。
- 模型工具：`wizard_stage`（本轮已注册可用）。
- 状态路由：`GET /api/wizard/state?sessionId=<id>`，与页面同源、需要登录态。

## 阶段数据模型

每次阶段都是一个已提交的 `wizard_stage` 工具调用，参数：

| 字段 | 说明 |
|---|---|
| `wizardId` | 向导标识，如 `campus-2026` |
| `stageId` | 阶段标识，如 `needs` / `preview` / `done` |
| `version` | 同一阶段重新生成时 +1；**只允许单调递增** |
| `kind` | `form`（可编辑） / `preview`（只读+返回修改/确认） / `done` |
| `title` | 阶段标题 |
| `data` | `form`: `{fields:[{key,label,type,value}]}`；`preview|done`: `{summary:[{label,value}]}` |
| `invalidates` | 被本阶段改变的后续阶段 id，列表内阶段标记「需要更新」 |

阶段身份只来自这些字段，不读卡片标题或聊天文字。

## 状态与恢复

- 会话日志是唯一事实来源：`/api/wizard/state` 折叠 `wizard_stage` 调用得到
  `{wizardId, stages[], currentStageId, revision}`。
- 切换 Chat / 向导、刷新页面、重新打开会话：已提交阶段从会话记录恢复。
- 迟到保护：同一 `stageId` 只接受更大的 `version`；旧请求晚到不会覆盖新结果。
- 只有通过结构校验的响应才会替换页面；校验失败保留当前页面并提示。

## 未提交草稿

- 仅 `kind: form` 阶段保存草稿，写入 `localStorage`：
  `dsh.wizard.draft.v1:<sessionId>:<wizardId>:<stageId>:v<version>`。
- 有效期 24 小时；提交并观察到新阶段后自动删除；**已提交阶段不恢复旧快照**。
- 返回修改时携带的是各阶段**最新已提交数据**，不是本地草稿。

## 交互约束

- 提交后按钮禁用、显示「已提交…等待新阶段」，页面与输入保持不变；120 秒无新阶段提示超时。
- 失败与超时都提供「重试」，重试复用同一条提交文本。
- 容器 `flex` 纵向布局，正文 `overflow-y: auto`，宽屏上限 880px；Workflow 类内容不会被挤进窄栏。

## 测试

```sh
node --test test/state.test.mjs test/client-wiring.test.mjs
```

覆盖：折叠与忽略无效记录、版本单调、迟到记录丢弃、失效标记与重新生成、客户端 Slot 注册。

## 回退

```text
plugin_manager set_plugin target=include:dsh-wizard enabled=false
```

彻底移除：

```text
plugin_manager remove_bundle target=@local/dsh-wizard
```

回退后 Chat / 轨迹不受影响；`wizard_stage` 工具随插件一起注销。

## 已知限制

- 客户端视图注册后需要刷新页面一次才会出现页签。
- 文案暂为中文硬编码，未接入 Client locale 服务。
- 状态采用 1.2s 轮询，不是事件推送。

## 五步流程映射

| 步 | stageId | kind | 内容 |
|---|---|---|---|
| 1 | `needs` | form | 活动需求：名称/日期/时间/人数/预算/品类 + 场地状态、雨天方案（下拉） |
| 2 | `plan` | form | 方案选择：A 室内 / B 室外，各自要点写在 note |
| 3 | `prep` | form | 筹备：物料数量、单价、负责人 |
| 4 | `flow` | form | 执行流程：每行一步，分支行用缩进 |
| 5 | `final` | preview | 完整方案 + 未解决事项，确认后 → `done` |

字段类型：`text` / `number` / `textarea` / `select`（`options: [{value,label}]`）。
预览与终态支持 `data.summary`（键值行）与 `data.steps`（`{text, indent, note}` 流程行）。

每次返回修改都用最新已提交数据重发当前阶段（`version+1`），并把已存在的下游阶段列入 `invalidates`。
不同 `wizardId` 之间互不干扰：出现新 wizardId 时阶段集合重置。

## 提交即写回（约定）

表单提交后，**先把提交值以 `version+1` 写回该阶段**，再写下一阶段。
否则阶段记录会停留在默认值，`返回修改` 会把陈旧快照当成最新数据（已出现过该缺陷）。
返回修改时同样先写回目标阶段的最新值，再把已存在的下游阶段列入 `invalidates`。

## 每一步都有「返回修改」

| 当前阶段 | 按钮 | 我方处理 |
|---|---|---|
| needs（第 1 步） | 无（没有上一步） | — |
| plan | 返回修改 | 重写 needs（version+1） |
| prep | 返回修改 | 重写 plan（version+1） |
| flow | 返回修改 | 重写 prep（version+1） |
| final（预览） | 返回修改 | 重写 flow（version+1） |
| done（已确认） | 返回修改 | 重写 flow（version+1） |

返回时不复用旧快照：目标阶段按**最新已提交数据**重写，并把其后的阶段列入 `invalidates`。
`data.back === false` 或 `data.step === 1` 的卡片不显示该按钮。

## 顶部步骤条可直接跳转

步骤条中的每个阶段是可点击按钮（当前阶段除外，提交中禁用）。

- 点击后发送 `action=goto target=<stageId>`，携带各阶段最新已提交数据。
- 我方用**该步骤最新已提交内容**重写它（version+1），并把其后的阶段全部列入 `invalidates`。
- 固定顺序：`needs → plan → prep → flow → final → done`；“其后”按此顺序判定。
- 往前跳（例如从 needs 跳到 final）会得到一个上游待更新的预览，属预期行为，继续往下走会逐级重建。
