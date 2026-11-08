---
description: "基础 bundle 行：把 skill2workflow 的编译和自进化挂成 DeepSeek Harness 工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-skill2workflow

[English](README.md) | 中文

## 概述

这个包增加一行组合配置。Agent 可以调用 `s2w_evolve_report`、`s2w_evolve_decide`、`s2w_evolve_retrieve`、`s2w_evolve_ingest`、`s2w_run_trajectory`、`s2w_trace_to_skill`、`s2w_compile`。默认只判定。编译、真跑和轨迹蒸馏要等模型设置 `apply`、`use_fixture`、`case_id` 或 `trajectory`。

## 目录

- [使用本包](#使用本包)
- [模型体验](#模型体验)
- [已知限制与延期工作](#已知限制与延期工作)
- [开发备注](#开发备注)

## 使用本包

基础 bundle 默认打开这一行。**npm 包里只有 JS 胶水**（spawn `python3 -m skill2workflow`）。真正的 CLI、SkillClaw、n8n 导入都在独立 Python 仓库里，每台机器自己 clone：

```bash
git clone git@github.com:eit-nlp-industry/skill2workflow.git
export SKILL2WORKFLOW_ROOT=/那台机器上的/skill2workflow
```

```yaml
- id: skill2workflow
  name: '@deepseek-ai/dsh-skill2workflow'
  disabled: false
  config:
    repoRoot: !!js process.env.SKILL2WORKFLOW_ROOT || ''
```

未设置时工具会回 `SKILL2WORKFLOW_ROOT is empty`。该目录必须能跑 `python3 -m skill2workflow`。n8n 也是各人自己的实例（本机用 `.env` 里的 `N8N_BASE_URL`）。

## 模型体验

### 自进化工具

#### 模型看到什么

七个工具。report、decide、retrieve、ingest 不调模型。带 `apply=true` 的 decide、`s2w_compile`、`s2w_run_trajectory`、`s2w_trace_to_skill` 会调。

#### Token 影响

工具结果是 Python CLI 标准输出的 JSON 字符串。未调用的工具不加 token。

#### KV Cache 影响

这一行不插入常驻提示词。只有之后的工具结果会改请求后缀。

## 已知限制与延期工作

Python 仓库不在这个包里。n8n 容器必须挂上或拷进去，否则工具会回 `SKILL2WORKFLOW_ROOT is empty`。

### 开发备注

<details>
<summary>给维护者的工作上下文 — 点击展开</summary>

这一行写在 `packages/bundle/base/cordis.patch.yml` 里，紧挨 Hindsight。

</details>
