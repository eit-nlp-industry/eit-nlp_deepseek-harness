---
name: event-site-inspection
description: 在用户要求活动开场准备检查、会场布置检查或整改复核时使用。先用语义地图与导航到会场，场内用移动工具逐点到位后再依据环境观察帧做结构化判定；发现问题后出待处理工单，确认整改后再移动复核并生成报告。演示可用视频推流模拟到场画面，聊天中不点名视频文件。
---

# 活动开场准备检查

## 职责与边界

依据宿主任务配置，指挥机器狗**先到会场、再场内逐点移动**，
对到位后的现场画面做有证据的观察；由宿主更新业务状态、推进检查项，并生成工单与报告。

适用于：
- 活动开场前准备检查 / 会场布置检查。
- 指示牌、签到台、通道等现场布置检查。
- 整改反馈确认后的复核。

不用于普通场景描述、找人找物、带路或跟随（那些走对应 skill）。

演示约定：
- 到馆与场内移动必须调用真实挂载的导航/移动工具（mock Job 亦可）；**禁止**口头宣称「已走到」却不调工具。
- 推流画面只作到场后的视觉证据；每点 `move_to` 到达后由操作员切换该点对应片段（配置里的 `demoClip`/`recheckClip`）。聊天表述为「现场画面」，**禁止**点名视频文件名或「请播放某某.mp4」。
- 不把模拟检查结果表述为真实现场验收或消防/结构认证。

## 工具职责

参数与返回字段以工具 schema 为准。

### 机器狗运动（必须用上）

- search_semantic_map（或当前挂载的语义地图工具）：检索会场锚点；`explicit_name` 用用户说的地点，未说则用宿主 `venueQuery`（默认「图书馆」）。
- navigate / goto（名称含 navigate/goto 的导航工具）：按语义地图结果去会场；参数按 schema，不编造锚点。
- move_to（或同名场内移动工具）：会场内语义地图没有的点位之间切换；目标用宿主当前项的 `moveHint` / 检查项名称。
- stop：移动中需中断时使用。
- observation_no_action：等 Job / 无新观察时静默结束本轮。

### 检查宿主

- start_inspection / get_inspection_status
- submit_inspection_observation / annotate_target
- render_inspection_card / render_ui
- ack_remediation / begin_recheck / finalize_inspection_report

必要工具不可用时说明受影响步骤；不虚构调用、证据或状态。

## Job 与等待（与 find-target 一致）

- 导航/移动返回 `running` 并带 task_id 是正常的；结果以后台 **Job 终态通知**为准（演示侧用 task-result 回调 mock「已完成」）。
- **同一时间只允许 1 个** 进行中的 navigate/move_to；未收到该 Job「已完成/失败/取消」前：
  - **禁止**再调下一个 move_to / navigate；
  - **禁止** `annotate_target` / `submit_inspection_observation` / 出检查结论；
  - 本轮只调 `observation_no_action`，不催促、不说「开始检查」。
- 会话里出现「收到执行请求」但还没看到对应 task 的「已完成」→ 视为未到位。
- Job 终态轮：按全局规则原文输出、通常不调工具；下一步（start_inspection / 看帧 / 再移动）放在**随后**观察轮。
- 同一轮已调用 navigate / move_to / annotate_target / render_ui / submit 等真实工具后，**不要再叠** `observation_no_action`。
- **不要**调 `wait`/`sleep` 来空等。

## 任务配置

检查项、顺序、通过条件、会场名、`moveHint` 以宿主返回为准。

- `venueQuery` / `venueName`：语义地图检索用会场名。
- 每项 `moveHint`：场内 `move_to` 的自然语言目标（语义地图通常没有这些室内点）。

不得写死活动名/检查项 ID/视频文件名；不得仅凭播放顺序判定通过。

## 状态与观察上下文

宿主是唯一业务状态来源。

提交时原样使用：taskId、checkpointId、inspectionRound、streamId、frameId。
checkpointId 是期望点位，**不代表已经 move_to 到位**。
复核新 round 必须用新证据，禁止复用初检帧关闭问题。

## 工作流程

### 0. 到会场（必须先做）

用户要求去某地做开场/会场检查时：

1. 可能已有检查任务时先 `get_inspection_status`；已在检查中则不要重复导航创建任务。
2. 用语义地图检索会场：`explicit_name` = 用户说的地点；未说则用宿主/配置的 `venueQuery`（默认「图书馆」）。
3. 调用导航工具去该锚点；简短告知「正在前往××」。
4. **等导航 Job 到达**后再进入下一步；未到达前不对现场下结论。
5. 到达后调用 `start_inspection`，说明检查范围（指示牌、签到台、通道等）。

未到会场前不要 start_inspection 后的场内判定。

### 1. 场内逐点：先移动，再观察（位置切换必须口头提示）

对宿主给出的**当前**检查项：

1. 读取 `moveHint`（或检查项名称），调用 `move_to`；**同时对用户说**：「现在前往××」（如「现在前往签到台」）。
2. 等移动 Job 完成（未完成前只 `observation_no_action`，不再发下一个 move、不检查）。
3. Job 完成后**先说**：「已到达××，开始检查」（复核则说「开始复核」），再看【环境观察】：
   - location_matches / view_complete / image_readable（不因 checkpointId 已填就自动 true）。
4. 可判定时：`annotate_target`（短 `asset_id`）→ `submit_inspection_observation`。
5. 宿主返回 `checkpoint_advance` / 推进到下一项时：按宿主 message **先告知将前往下一点**，再 `move_to`；不能沿用上一点画面直接判下一项。

位置播报固定句式（可微调，但必须有）：
- 出发：`现在前往{检查项名称}`
- 到达：`已到达{检查项名称}，开始检查`（复核：`…，开始复核`）

禁止：不调 move_to 就假装已在签到台/通道；禁止静默换点；禁止说「请播放下一段视频」。

### 2. 判定规则

verdict：`met` / `not_met` / `uncertain`。

- **met**：位置匹配、范围完整、证据清晰，通过条件全部满足。
- **not_met**：须有清晰证据，并用 evidence_kind：
  - absence：完整判定区域清楚才可证缺失；view_complete 必须 true。
  - clear_anomaly：已清楚看到异常及必要空间关系即可。
- **uncertain**：点位未确认、视野不足、模糊遮挡、证据冲突等。
  「未看到」≠「没有」。

移动途中的模糊/局部视野不能直接当缺项；途中已见清晰明确异常可提交。

### 3. 证据

- evidence_asset_id 必须用 annotate_target 返回的**短 asset_id**，禁止 path/绝对路径。
- 原因用可核对事实，例如「完整桌面可见，未见签到牌和签到表」。

### 4. 静默、播报与 UI

**必须说话**：出发前往下一点、Job 到达、宿主 `checkpoint_advance` / 初检汇总 / 工单 / 复核汇总。
**保持静默**：仅在「等 Job 途中」或「重复/无新观察」时用 `observation_no_action`。

A. 等 Job / 无新观察 → `observation_no_action`（不输出「还在走」之类废话）。
B. 有新观察 → `submit_inspection_observation`：
   - `notify.speak=true`（含 `checkpoint_advance`）：用宿主 message 对用户说明，并立刻发起下一次 `move_to`（若提示前往下一点）。
   - 中途仅记结果且无下一点提示时：可少说话，但换点时不能省。
   - `update_ui=true` 且有 `render_ui_args`：原样 `render_ui`。

禁止在第一个缺陷出现后立刻出工单导致后续点位来不及移动检查。

### 5. 初检结束与待处理工单

全部初检项结束后（`initial_summary` / `awaiting_remediation`）：
- 一次性汇总；再出**一张**待处理工单（待处理事项 1/2… + 证据 Tabs）。
- 出工单后宿主会暂停推流，等待用户提交。

用户点击「确认已整改」会发来「用户提交了 json-render 表单…」消息，**立刻**：

1. `ack_remediation`（note 可用表单 handler/note）；
2. 同一轮 `begin_recheck`；
3. 告知开始复核——不能仅凭表单判通过。

口头「已整改 / 开始复核」同样 ack → begin_recheck。

### 6. 复核

每个待复核项：**先 move_to（用该项 moveHint）→ 等 Job → 再看新画面判定**。
宿主通过后会切到下一项；继续先移动再观察。
不要让用户去「后台切任务」。
全部满足后 `finalize_inspection_report` + 原样 `render_ui`（简洁 Tabs 报告）。

### 7. 报告

一行整体结果 + Tabs（名称·通过/已整改通过）+ 短初检/复核说明；不要长篇 Markdown、不要证据 URL 列表。

## 表达规则

位置切换示例（必说）：
- 「现在前往签到台。」
- 「已到达签到台，开始检查。」
- 「现在前往入口通道。」
- 「已到达入口通道，开始复核。」

其他可说：「正在前往图书馆」「已到会场，开始开场检查」「签到台缺用品，已登记」「现场确认已处理，开始复核」。

禁止：
- 点名 mp4 或「请播放…」；
- 换点时完全不提示；
- 「应该没问题」「用户说好了所以通过」；
- 「我已经在签到台了」但尚未收到对应 move_to/navigate Job 完成通知。

## 硬约束

- 到会场必须语义地图 + 导航；场内点间必须 move_to。
- 检查标准与业务状态以宿主为准。
- 不混用任务、检查项、轮次、流和帧。
- 工单提交仅作演示 mock 整改完成，不向第三方真实派单。
