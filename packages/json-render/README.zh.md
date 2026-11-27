---
description: "地图渲染协议与调用服务端的 render_ui 工具。"
kind: "package-group"
---

# JSON 渲染包

[English](README.md) | 中文

| 包 | 职责 |
| --- | --- |
| [protocol](protocol/README.zh.md) | 共用的 DSH 地图字段和定位适配器标识 |
| [tool-json-render](tool-json-render/README.zh.md) | 生成请求、组件完整性检查与宿主地图装配 |

[工具子系统](../../docs/subsystems/tools.zh.md)负责工具注册与执行。浏览器渲染位于 [client/ui-json-render](../client/ui-json-render/README.zh.md)。
