---
kind: upgrade-guide
description: "json-render 工具需要 systemPrompt，并在工具选择前提供共享呈现指引。"
---

# json-render 需要系统提示服务

[English](guide.md) | 中文

## 变更

启用的 `@deepseek-ai/dsh-tool-json-render` 插件除 `tools` 外还需要 `systemPrompt`。它在任何工具调用前加入共享呈现指引。包中包含权威 Skill 及其参考文档；加载不依赖个人安装的 Skill 或 Agent 的文件工具。

## 迁移

1. 自定义组合必须在本插件前挂载 `@deepseek-ai/dsh-system-prompt`。内置 profile 已提供该服务。
2. 部署包含 `skills/` 的完整包并重启宿主。维护[随包 Skill](../../../../packages/json-render/tool-json-render/skills/select-dsh-presentation/SKILL.md)，不再向每个普通预设复制规则。
3. 检查普通预设的一次新模型请求，确认在调用 `render_ui` 前，系统提示已包含 `DSH 呈现选型`。`complete: true` 会刻意屏蔽其他提示段；改用普通人设覆盖以继承共享规则，或在完整提示中包含所需规则。
