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

基础 bundle 默认打开这一行。npm 里只有 JS：会话里模型调用工具时，本机执行 `python3 -m skill2workflow`。CLI 用 pip 装，不要 export 别人机器上的路径：

```bash
pip install 'git+https://github.com/eit-nlp-industry/skill2workflow.git'
python3 -c "import pathlib, shutil, skill2workflow; shutil.copy(pathlib.Path(skill2workflow.__file__).with_name('env.example'), '.env')"
# 填自己的 LLM_API_KEY 和 N8N_* ，不要抄别人的家目录
```

`.env` 放在当前工作区，或 `~/.skill2workflow/.env`。n8n 也是各人自己的实例。开发者若在 git checkout 里改 CLI，可以设 `SKILL2WORKFLOW_ROOT`；其他人不必设。

## 模型体验

### 自进化工具

#### 模型看到什么

七个工具。report、decide、retrieve、ingest 不调模型。带 `apply=true` 的 decide、`s2w_compile`、`s2w_run_trajectory`、`s2w_trace_to_skill` 会调。

#### Token 影响

工具结果是 Python CLI 标准输出的 JSON 字符串。未调用的工具不加 token。

#### KV Cache 影响

这一行不插入常驻提示词。只有之后的工具结果会改请求后缀。

## 已知限制与延期工作

Python 不进 npm。本机 python 里没有 `skill2workflow` 时，工具会提示上面那条 pip 命令。n8n 地址写在各人自己的 `.env`。

### 开发备注

<details>
<summary>给维护者的工作上下文 — 点击展开</summary>

这一行写在 `packages/bundle/base/cordis.patch.yml` 里，紧挨 Hindsight。

</details>
