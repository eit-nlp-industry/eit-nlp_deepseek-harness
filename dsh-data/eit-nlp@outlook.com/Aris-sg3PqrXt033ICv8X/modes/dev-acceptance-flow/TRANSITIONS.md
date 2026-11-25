# 合法状态迁移

宿主只允许下表迁移。其它组合一律拒绝并保留原 `flow_status`。

| 从 | 到 | 触发条件 |
|---|---|---|
| `bootstrapping` | `developing` | 研发会话创建成功，`project_id` 与 `project_root` 已写入；`acceptance_session_id` 可为 null |
| `developing` / `remediating` → 首次/再次送验前 | （不改 status） | 宿主在采纳 submission 后懒创建验收会话并写入 `acceptance_session_id` |
| `developing` | `awaiting_user` | 研发进入澄清；`waiting_reason=prd_clarification` |
| `awaiting_user` | `developing` | 用户普通消息已投递研发，且非验收阻塞补充 |
| `developing` | `awaiting_acceptance` | 新 `submission` 校验通过且 `self_check_status=passed` |
| `developing` | `failed_terminal` | 研发 `FAILED_TERMINAL` / 自检 blocked 且不可恢复 |
| `awaiting_acceptance` | `acceptance_passed` | `review.verdict=passed` 且 revision 匹配 active submission |
| `awaiting_acceptance` | `remediating` | `review.verdict=changes_required` 且未超 `max_remediation_rounds` |
| `awaiting_acceptance` | `needs_manual` | `changes_required` 且 `remediation_round >= max_remediation_rounds` |
| `awaiting_acceptance` | `awaiting_user` | `review.verdict=blocked`；`waiting_reason=acceptance_blocked` |
| `awaiting_acceptance` | `failed_terminal` | 不可恢复的协议/环境失败 |
| `remediating` | `awaiting_acceptance` | 新的 `kind=remediation` submission 校验通过 |
| `remediating` | `awaiting_user` | 整改中需要澄清 |
| `remediating` | `failed_terminal` | 整改失败不可恢复 |
| `awaiting_user` | `awaiting_acceptance` | 阻塞材料补齐后，**必须重新送验**（新 submission），不得沿用旧 review |
| `acceptance_passed` | `delivering` | 宿主通知研发继续 PACKAGE/已授权交付 |
| `delivering` | `delivery_completed` | 研发交付阶段完成（部署可为 `not_configured`） |
| `delivering` | `failed_terminal` | 交付失败且无回滚/不可恢复 |
| `*` | `*` | 重复 `event_id` → 忽略，不迁移 |

## 硬校验（每次采纳 submission / review）

1. `project_id` 与 `flow.project_id` 完全一致。
2. `review.submission_id === flow.active_submission_id`。
3. `review.reviewed_revision === submission.code_revision`。
4. 旧 submission 的 `passed` 不能放行新 `active_submission_id`。
5. `passed` 的 review 不得含 `blocking=true` finding。
6. `out_of_scope_suggestions` 永不写入整改任务，也不阻止 `passed`。
7. `blocked` 不调用验收账本的违约 `fail` 路径。
