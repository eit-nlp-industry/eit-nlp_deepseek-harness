---
description: "供 DSH 渲染工具与客户端共用的地图位置解析和定位适配器标识。"
kind: "package-library"
---

# @deepseek-ai/dsh-json-render-protocol

[English](README.md) | 中文

## 概述

渲染工具与浏览器客户端通过本包共用地图位置路径、坐标范围、运动状态和定位适配器标识。`parseMapPosition` 解析真实坐标，不编造初始位置。本包不依赖框架、网络或模型。

## 目录

- [使用本包](#use-this-package)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

装配或订阅实时地图时导入 `MAP_POSITION_PATH`。通过 `parseMapPosition` 解析位置提供方的坐标；坐标、状态、朝向或进度无效时返回 `undefined`，有效时返回规范字段。无关流字段会被丢弃。工具负责拒绝无效请求，浏览器负责帧顺序和订阅清理。

实时与校园演示来源标识对应现有 DSH 适配器。其他渲染宿主通过 eit-json-render 的结构化地图绑定请求提供自己的路径和追踪标识；该 SDK 不导入本包。请求与失败处理见[渲染工具](../tool-json-render/README.zh.md)。

## 已知限制与后续工作

- 当前 DSH 订阅适配器在每个渲染 payload 中使用一个共享位置路径。独立位置存储需要同时扩展消费方协议。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
