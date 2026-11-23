---
name: flow-acceptance-handoff
description: 研发与宿主验收协调的交接。FINAL_VERIFICATION 通过后送验、接收整改单、验收放行后继续交付时加载。
---

# 验收交接

本 skill 只处理与 `.flow/` 宿主协调协议的交接。阶段调度仍以 `development-orchestrator` 为准。

协议权威在目标项目旁的协调实现（`dev-acceptance-flow` schemas）。本模式**只写 submission**，不写 review，不直接改验收账本。

## 何时送验

仅当 `FINAL_VERIFICATION` 必需门禁已通过，且真实命令/退出码已写入验证工件。

不要在门禁失败时写出 `self_check_status=passed` 的 submission。

## 送验步骤

1. 确保工作区变更已 `git add` 并 `git commit`（信息遵循项目规范；无规范时 Conventional Commits + 中文描述）。
2. 记录 `code_revision=$(git rev-parse HEAD)`，写入 `state.json.lastVerifiedCommit`。
3. 导出只读树（任选其一，优先 worktree）：
   - `git worktree add --detach .flow/trees/<submission_id> <code_revision>`
   - 或把该 commit 的树导出到 `.flow/trees/<submission_id>/`，保证验收读到的不是可写工作区。
4. 写出证据清单 `.flow/submissions/<submission_id>.artifacts.json`（命令、日志、报告路径）。
5. 写出需求-证据映射 `.flow/submissions/<submission_id>.requirements.json`。
6. 写出 submission 文件 `.flow/submissions/<submission_id>.json`，字段至少包括：

```json
{
  "schemaVersion": 1,
  "submission_id": "sub-001",
  "event_id": "evt-sub-001",
  "project_id": "<与宿主 flow.project_id 相同>",
  "kind": "initial",
  "prd_revision": "<state.prdHash>",
  "code_revision": "<git sha>",
  "readonly_tree_ref": ".flow/trees/sub-001",
  "artifact_manifest_ref": ".flow/submissions/sub-001.artifacts.json",
  "requirement_evidence_map_ref": ".flow/submissions/sub-001.requirements.json",
  "previous_submission_id": null,
  "remediation_summary_ref": null,
  "addresses_finding_ids": [],
  "self_check_status": "passed",
  "self_check_summary": "简述",
  "final_verification_ref": "artifacts/verification-report.json",
  "submitted_at": "<ISO8601>"
}
```

7. 更新 `state.json`：`phase=ACCEPTANCE_GATE`，`status=AWAITING_ACCEPTANCE`，`activeSubmissionId=<submission_id>`。
8. 同步 `todo_write`（验证通过前不要把未验收项标 `completed`）。
9. 用中文告知已送验，然后停止；等待宿主/验收结果。不要进入 `PACKAGE`。

`project_id` 必须与宿主 `.flow/flow.json` 一致。若项目尚未 init flow，用普通中文说明缺少协调状态，设 `NEEDS_CLARIFICATION`，不要自造其它项目的 id。

## 整改 intake

当消息明确是宿主整改投递，或需要处理验收失败时：

1. 读取 `.flow/findings.json` 与对应 review（若消息给出路径/编号）。
2. 只把 `blocking=true` 且状态为 `open` / `retested_failed` 的 finding 追加为修复任务；`out_of_scope_suggestions` 永不进任务列表。
3. `status=RUNNING`，`phase=IMPLEMENTATION`，按 finding 修复并回归。
4. 再跑 `FINAL_VERIFICATION` → `ACCEPTANCE_GATE`。
5. 新 submission 使用 `kind=remediation`，`previous_submission_id` 等于上一份被驳回的 id，`addresses_finding_ids` 列出已处理编号，并写 `remediation_summary_ref`。

## 验收放行后

仅当消息明确验收已通过并要求继续交付，且 `submission_id` 与 `activeSubmissionId` 一致：

1. `status=RUNNING`
2. 进入 `PACKAGE`，再按 orchestrator 规则处理 `DEPLOYMENT`
3. 聊天区分“验收通过”和“交付完成”

旧 submission 的通过消息若与当前 `activeSubmissionId` 不一致，忽略并说明原因，不要打包。

## 禁止

- 用自然语言“应该通过了”代替 submission 文件
- 在 `AWAITING_ACCEPTANCE` 时继续改代码却不重新送验
- 修改 `.flow/reviews/` 或验收账本
- 降低测试标准以换取验收通过
