# 宿主协调下的结构化验收输出

当消息来自宿主 `prompt_acceptance`（或等价投递）时，除账本工具外，还必须写入：

`<project_root>/.flow/reviews/<review_id>.json`

最小字段见 `../dev-acceptance-flow/schemas/review.schema.json`。

## verdict 与账本

| 协议 verdict | 账本 |
|---|---|
| `passed` | `acceptance_record` + `pass` |
| `changes_required` | blocking 项 → `fail` / `error_book_add` |
| `blocked` | **不**记违约 |

## 示例（changes_required）

```json
{
  "schemaVersion": 1,
  "review_id": "rev-001",
  "event_id": "evt-rev-001",
  "project_id": "todo-demo",
  "submission_id": "sub-001",
  "reviewed_revision": "abc1234",
  "prd_revision": "prd-sha-aaaa1111",
  "verdict": "changes_required",
  "summary": "刷新后完成状态丢失",
  "findings": [
    {
      "finding_id": "FIND-001",
      "requirement_id": "REQ-4",
      "category": "behavior_defect",
      "blocking": true,
      "description": "标记完成后刷新，任务回到未完成",
      "evidence_refs": [{ "kind": "test_report", "ref": "artifacts/ui-persistence.log" }],
      "acceptance_condition": "刷新后 completed 状态保持",
      "status": "open"
    }
  ],
  "out_of_scope_suggestions": [],
  "ledger_refs": [],
  "reviewed_at": "2026-11-23T02:10:00.000Z"
}
```
