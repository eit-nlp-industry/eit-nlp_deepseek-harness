---
name: development-orchestrator
description: 研发模式总控。以 PRD 为唯一规格，恢复 .development 状态，并按阶段调用审查、TDD、调试、UI、验证与验收交接 skill。处理研发任务、继续未完成项目、宿主整改/放行投递或用户回复澄清时加载。
---

# 研发模式总控

本 skill 只调度阶段、状态和其它 skill。PRD 写法、TDD、调试、UI、测试和验收交接步骤以对应 skill 为准，不要在这里重写。

PRD 是唯一规格来源。不要引入 OpenSpec，不要创建 `openspec/`，不要另写 proposal、specs 或 design 来代替 PRD。预设只在目标项目生成任务、追踪和验证工件。

这些文件在目标项目，不在本预设：

- 规格：`PRD.md`
- 实现：`src/`、`tests/`
- 任务和追踪：`.development/tasks.json`、`state.json`、`assumptions.md`、`decisions.md`、`deviations.md`、`execution-log.jsonl`
- 验证：`artifacts/prd-audit.json`、`artifacts/verification-report.json`、`artifacts/final-result.json`
- 验收交接：`.flow/submissions/`、`.flow/findings.json`（由宿主协调；本模式只写 submission，不写 review）

不要把 `skills/` 复制到目标项目。

## 界面进度

输入框上方的进度只统计 `todo_write`。`tasks.json` 尚未写出时不要调用它，阶段名不是任务。

`tasks.json` 每次新增、改状态或追加修复项之后，立刻用全部任务整表调用一次 `todo_write`。`content` 用 `{id} {一句话}`，全文唯一。对照关系：

- `passed` → `completed`
- `state.json` 的 `currentTask` → `in_progress`，同时只能有这一项
- 其它 `pending` 和 `failed` → `pending`

修复失败项时，那一项就是 `currentTask`。验证通过之前保持 `pending` 或 `in_progress`，不要先标 `completed`。漏掉已通过的项会让进度倒退。

## 状态

`state.json` 至少包含 `schemaVersion`（1）、`status`、`phase`、`prdHash`、`currentTask`、`completedTasks`、`failedTasks`、`assumptions`、`deviations`、`retryCounts`、`pendingQuestion`、`resumePhase`、`lastVerifiedCommit`、`activeSubmissionId`。

阶段顺序：`BOOTSTRAP` → `PRD_AUDIT` → `TASK_PREPARATION` → `IMPLEMENTATION` → `UI_VERIFICATION` → `PRD_VERIFICATION` → `FINAL_VERIFICATION` → `ACCEPTANCE_GATE` → `PACKAGE` → `DEPLOYMENT` → `COMPLETED`。

`status` 只用 `RUNNING`、`NEEDS_CLARIFICATION`、`AWAITING_ACCEPTANCE`、`REJECTED_PRD`、`FAILED_TERMINAL`、`COMPLETED`。禁止 `PENDING_APPROVAL` 和 `WAITING_FOR_APPROVAL`。`AWAITING_ACCEPTANCE` 只表示等待宿主协调的验收结果，不是人工审批。

每进入一个阶段或一次重试，向 `execution-log.jsonl` 追加一行：时间、阶段、动作、命令、退出码。

已有 `state.json` 时从 `phase` 恢复。若读到旧阶段名 `SPEC_PREPARATION`，当作 `TASK_PREPARATION`；`SPEC_VERIFICATION` 当作 `PRD_VERIFICATION`。`status` 为 `NEEDS_CLARIFICATION` 时，把用户最新普通消息关联到 `pendingQuestion.id`，写入 `decisions.md`，清空 `pendingQuestion`，把 `status` 设回 `RUNNING`，从 `resumePhase` 继续。`status` 为 `AWAITING_ACCEPTANCE` 时不要自动进入 `PACKAGE`；仅当收到宿主「整改」或「验收已通过，请继续交付」类投递后，按下方 `ACCEPTANCE_GATE` 规则继续。

## 阶段

`BOOTSTRAP`：确认目标项目路径和 `PRD.md`。没有 PRD 就用普通中文说明缺什么，设 `NEEDS_CLARIFICATION`，不要开工。计算 PRD 内容哈希写入 `prdHash`。哈希变化时记录偏差并重新审查，不要静默沿用旧审查。

`PRD_AUDIT`：加载 `software-requirements`，只用它的 Requirements Review Mode。检查需求内部一致、需求与架构、需求与 UI、架构与 UI、数据模型、API 可实现性、外部依赖、非功能要求、权限与安全、核心需求可测试性、数据丢失、不可逆操作、验收标准。结果写入 `artifacts/prd-audit.json`，字段为 `decision`（`ACCEPTED`、`NEEDS_CLARIFICATION`、`REJECTED_PRD`）、`score`、`blockingFindings`、`questions`、`assumptions`、`normalizedRequirements`。

- Critical 且明确不可实现或根本矛盾：`REJECTED_PRD`，不编码，用中文说明阻塞和修改建议。
- Major 且必须由用户消除矛盾：`NEEDS_CLARIFICATION`。
- Major 但有不改变核心语义的安全默认：写入 `assumptions.md` 并继续。
- Minor 或 Info：记录并继续。

`TASK_PREPARATION`：只根据 PRD 和已记录的假设，写 `.development/tasks.json`。每一项包含 `id`、`requirementIds`、`status`、`verification`，并按可独立验证的垂直切片拆分。`requirementIds` 指向 PRD 里的需求编号或章节，不改写需求正文。做完内部一致性检查后继续，不请求人工审批。

`IMPLEMENTATION`：按 `tasks.json` 实现，并把当前项写入 `state.json` 的 `currentTask`。每个功能和缺陷修复先加载 `test-driven-development`：先写失败测试并实际运行确认失败，再写最小实现、再运行、再重构、再跑相关测试。失败时加载 `systematic-debugging`，按复现、证据、根因、单一假设、最小验证、回归测试、修复、再验证进行。没有证据不要连改。实现与 PRD 不一致时写入 `deviations.md`，不要另起一份规格。

UI 任务加载 `ui-ux-pro-max`。PRD 里的 UI 示例优先。不要重做已明确的页面，不要无依据换视觉风格。可以补 Loading、Empty、Error、Disabled、响应式、键盘操作、可访问性和未定义的边缘状态。UI 与需求或架构有实质矛盾且不能安全推断时，进入 `NEEDS_CLARIFICATION`。

`UI_VERIFICATION`：Web 项目加载 `webapp-testing`、`ui-screenshots`、`playwright-generate-test`。启动本地应用，检查页面、主流程、表单、错误态、Loading、Empty、响应式、控制台错误、失败请求和基本可访问性，并补 Playwright 测试。不要用表单请用户确认截图。本 profile 没有 Playwright MCP。目标项目已有 Playwright 时用它的 CLI 和配置。两者都没有时，不要安装浏览器自动化依赖；把未验证范围写入最终报告，功能和结构验证仍要做。不能做图像对比时，不要声称视觉一致性已验证。非 Web 项目把 UI 标为 `not_applicable`。

`PRD_VERIFICATION`：对照 `PRD.md` 和 `tasks.json`，不对照另一套规格。检查每个需求是否有实现、每个任务是否完成、UI 是否覆盖 PRD 页面、验收标准是否遗漏、是否有无依据的多余功能、架构偏差是否已写入 `deviations.md`。结果写入 `artifacts/verification-report.json`。失败则把发现追加为修复任务，回到 `IMPLEMENTATION`。

`FINAL_VERIFICATION`：加载 `verification-before-completion`。按仓库实际执行 format、lint、typecheck、单元测试、集成测试、端到端测试、build、迁移和依赖检查。保存命令、退出码和摘要。未执行的项标 `not_configured` 或 `not_applicable`，不能标 `passed`。必需门禁都通过后进入 `ACCEPTANCE_GATE`，**不得**直接进入 `PACKAGE`。

`ACCEPTANCE_GATE`：加载 `flow-acceptance-handoff`。固定代码版本、写出 `.flow/submissions/<submission_id>.json`，将 `phase` 设为 `ACCEPTANCE_GATE`，`status` 设为 `AWAITING_ACCEPTANCE`，写入 `activeSubmissionId` 与 `lastVerifiedCommit`。然后停止主动推进，用中文简短说明已送验并等待验收。禁止在此阶段整理最终交付为“已完成”，禁止进入 `PACKAGE`。

- 收到宿主整改投递（或读到 `.flow/findings.json` 中仍开放的 blocking finding）：把问题映射进 `tasks.json`，`status` 改回 `RUNNING`，`phase` 回到 `IMPLEMENTATION`，按 TDD/调试修复并再跑验证，然后再次经 `ACCEPTANCE_GATE` 送出 `kind=remediation` 的新 submission。
- 收到宿主“验收已通过，请继续交付”投递：确认对应 `submission_id` 后，`status` 改回 `RUNNING`，进入 `PACKAGE`。
- 自检未通过时不要假装送验成功；写明阻塞原因，`status` 用 `FAILED_TERMINAL` 或 `NEEDS_CLARIFICATION`。

`PACKAGE`：仅在验收放行后整理 `artifacts/final-result.json` 和关键路径。不另造发布平台。聊天中区分“验收通过”与“交付完成”。

`DEPLOYMENT`：仅当 PRD 明确要求部署或仓库已有部署配置，且目标、命令、环境中的凭据和健康检查都已存在时，才按现有流程部署、做冒烟和健康检查。失败且已有回滚则回滚；没有回滚则 `FAILED_TERMINAL`。没有部署配置时不要询问云平台，不要注册服务，不要安装新部署平台；`deployment.status` 为 `not_configured`，其它门禁通过后可以 `COMPLETED`。验收通过不构成新增部署授权。

## 重试

读取本预设根目录的 `policies/retry-policy.yaml`（从本 skill 目录看是 `../../policies/retry-policy.yaml`）。JSON 或 schema 输出失败最多 2 次；单个测试、构建、PRD 对照最多修 3 次；UI 验证最多修 2 次；部署最多重试 1 次；总修复循环最多 8 次。错误指纹是阶段、命令、退出码、错误类型和主要错误信息。同一指纹连续出现 2 次就停止盲试。超过上限时 `FAILED_TERMINAL`，用中文列出已完成任务、剩余任务和已尝试的修复。

## 结束时的聊天

机器可读结果写入 `artifacts/final-result.json`，字段见 `schemas/final-result.schema.json`。聊天里用中文给简短摘要和关键路径，不要把整份 JSON 倒给用户。
