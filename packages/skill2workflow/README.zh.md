---
description: "调用 skill2workflow Python CLI 做编译和自进化的 DeepSeek Harness 组合行。"
kind: "package-group"
---

# skill2workflow/ — 编译与自进化

[English](README.md) | 中文

## 概述

这些行注册进程内 Cordis 工具。把 `SKILL2WORKFLOW_ROOT` 指到本机 skill2workflow 目录。第一次调用会把该目录 pip 装进 `$DSH_HOME/s2w-cli/venv`。插件不会从 GitHub 下载。

## 目录

- [软件包](#软件包)
- [相关文档](#相关文档)
- [开发备注](#开发备注)

## 软件包

| 软件包 | 作用 |
|---|---|
| [`skill2workflow/`](skill2workflow/README.zh.md) | 给模型用的 s2w_* 编译和自进化工具 |

## 相关文档

- [Skill 子系统说明](../../docs/subsystems/skills.md) — 这些工具编译或保留的 Skill 文件。
- Python CLI 就是 `SKILL2WORKFLOW_ROOT` 指向的本机目录。

## 开发备注

<details>
<summary>给维护者的工作上下文 — 点击展开</summary>

这是 lyj 的 dsh 分支上的一等公民叠加，不是上游 DeepSeek bundle。

</details>
