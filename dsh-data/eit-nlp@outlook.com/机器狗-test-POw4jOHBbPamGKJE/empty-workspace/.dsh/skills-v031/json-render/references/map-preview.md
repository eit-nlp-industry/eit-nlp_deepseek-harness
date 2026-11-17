# 实时地图（MapPreview）

**仅在 `navigate` 开跑前使用**（由 `locomotion` 触发）。`move_to` 等不出 MapPreview。

MapPreview 只用平面示意坐标（0–100）：`query_place`、`get_phone_location` 的 `x,y`、`get_motion_track`。语义地图 / `get_phone_location` 的 `anchor_id` 留给 `navigate`，不填进本图。

用户要看的是**一张能走的图**：狗用实时图标表示；不要在图上标「起点」，也不要在地图下面再挂地点表 / 路线说明 / 跟踪字段。

## 自拼示意地图

- `mode`: `display`；`components`: `["MapPreview"]`；`intent`: `rich_content`；`scene`: `dog`
- 整页**只渲染一个 MapPreview**；不要 Stack / Card / Table / Text 再列 `places`、`route`、`tracking`
- `business_data.places`：仅用户、目的地等**需要文字的地点钉** `{id, label, x, y}`（0–100）
- **禁止**把狗的出发点写成地点钉（不要 `start` / `起点` / 「狗起点」）；狗的位置只走跟踪图标
- 可选 `title` / `status`
- 可选 `route`：只能是 places 的 id 字符串数组（如 `["you","library"]`）；狗的走位不进 `route`；有 route 也只作为 MapPreview 的 props，不要为此再渲文字或表
- props 为固定值

## 实时跟踪（狗在图上移动）

- 用 `get_motion_track`（传入本段狗的起终点）取 `track_id` 与 `start`；用户平面坐标用 `get_phone_location` 的 `x,y`；目的地示意坐标用 `query_place`（或本轮已有平面结果）
- `places`：只放「你」「图书馆」这类目标钉；**不要**放起点钉
- **狗要在图上可见**：靠 `tracking.position` 画机器狗图标（可动、无文字标）。`start` 坐标只用于 `tracking.position` 初值，不要再做成 places 旗标
- `business_data.tracking`：`{"source":"robot-live","trackId":"<track_id>","position":{"x":<start.x>,"y":<start.y>,"status":"idle"}}`（`position` 初值必须是狗的 `start`，与用户点分开）
- MapPreview：`tracking` 用上式；`position`：`{"$state":"/tracking/position"}`

### user_query（末尾原样追加）

> 整页只渲染一个 MapPreview，不要再生成地点表、路线说明、跟踪字段或其它文字块。places 里不要放起点/start；狗只通过 tracking 图标显示，position 绑定 {"$state":"/tracking/position"}。
