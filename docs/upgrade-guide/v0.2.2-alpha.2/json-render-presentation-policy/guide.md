---
kind: upgrade-guide
description: "The json-render tool requires systemPrompt and supplies shared presentation instructions before tool selection."
---

# json-render requires the system prompt service

English | [中文](guide.zh.md)

## Change

The enabled `@deepseek-ai/dsh-tool-json-render` plugin requires `systemPrompt` in addition to `tools`. It adds shared presentation instructions before any tool call. The package includes the canonical Skill and its references; loading does not depend on a personal Skill installation or an agent's file tools.

## Migration

1. Custom compositions must mount `@deepseek-ai/dsh-system-prompt` before this plugin. Shipped profiles already provide it.
2. Deploy the whole package, including `skills/`, and restart the host. Maintain the [packaged Skill](../../../../packages/json-render/tool-json-render/skills/select-dsh-presentation/SKILL.md) rather than copying the rules into each ordinary preset.
3. Inspect a new model request under an ordinary preset and confirm that its system prompt contains `DSH 呈现选型` before a `render_ui` call. `complete: true` intentionally suppresses other sections; use an ordinary persona override to inherit the shared rules, or include the desired rules in the complete prompt.
