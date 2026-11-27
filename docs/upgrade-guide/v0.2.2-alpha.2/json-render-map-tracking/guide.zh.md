---
kind: upgrade-guide
description: "显式 MapPreview 请求需要有效地点和路线，追踪需要真实初始坐标，并要求响应包含地图组件。"
---

# 提供有效地图数据

[English](guide.md) | 中文

## 变更

对 `components` 明确包含 `MapPreview` 的请求，`render_ui` 会在联系渲染服务前拒绝缺少有效初始坐标的实时追踪。指向自身的 `business_data.tracking.position: {$state: '/tracking/position'}` 不是坐标。宿主根据提供的事实装配地图追踪，并将渲染位置绑定固定为 `/tracking/position`。缺少明确指定 MapPreview 的 HTTP 200 响应现在会返回生成校验失败，不再作为成功展示。

## 迁移

静态和实时请求都须提供非空的 `business_data.places: [{id, label, x, y}]`，ID 唯一且坐标位于 0–100。`route` 使用已有地点 ID 的有序数组。宿主也接受 `points`/`name` 和 `route.pointOrder`，但会在 HTTP 前拒绝别名冲突或事实缺失，将改变的原始结构保留在 business_data.map_source 供其他组件使用，同名字段冲突会被拒绝，并使用这些已校验事实替换返回的地图数据。降级响应保留有长度限制的服务端校验详情，仍作为失败处理。

1. 更新集成，提供 `business_data.tracking: {source, trackId, position: {x, y, status?}}`，坐标须由位置提供方给出且位于 0–100。使用 `robot-live` 和真实轨迹 ID；本地演示使用 `robot-demo` 和 `campus-route`。也接受已提供的顶层 `business_data.position` 作为初始坐标。
2. 无法获取初始位置时，省略 `tracking`，请求静态路线，并说明实时位置不可用。不要编造坐标，也不要用绑定表达式替代坐标。
3. 在 `components` 中明确声明 `MapPreview` 才启用地图处理；数据或描述本身不启用。其他组件保持原有验收规则。即使渲染 HTTP 响应为 200，也要处理 `ok: false`；不要声称文字替代已完成地图请求。修正请求时查看返回的校验问题。
4. 确认实时响应包含 `MapPreview.props.position: {$state: '/tracking/position'}`、提供的追踪标识，以及 `state.initial.tracking.position` 中的真实坐标。结构化服务端要求与部署见[包参考](../../../../packages/json-render/tool-json-render/README.zh.md)。
