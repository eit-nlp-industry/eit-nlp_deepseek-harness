# 研发模式

Preset ID：`development`。显示名称：研发模式。

这是 Aris 这个 home 的 profile bundle，不是仓库自带的 standard preset，也不改动已有的「监管与验收」预设。当前 DeepSeek Harness 不再读取 `$DSH_HOME/.agent-presets/`。本目录通过 `cordis.patch.yml` 插入一条 `@deepseek-ai/dsh-agent-preset` 声明，并由 `profiles/n8n-web/package.json` 的 `dsh.profile.bundles` 挂上。

## 选择

重启该 home 的 Harness 后，在新会话的模式列表里选择「研发模式」。已打开的旧会话不会改挂这个预设。

## 卸载

从 `profiles/n8n-web/package.json` 去掉 `@local/dsh-development-preset` 的依赖和 bundle 项，删掉 `node_modules/@local/dsh-development-preset` 链接，再重启 Harness。本目录可以整份删除。不要动 `aris-acceptance-preset`。

## 挂载的插件

persona、time-context、tool-bash、tool-pwsh、tool-fs、tool-fs-search、skill-filesystem、tool-skill、command-goal、tool-goal、tool-todo、tool-web、compaction。

没有 ask_user、审批、子 Agent、插件管理器。Skill 只从本目录 `skills/` 加载（`includeDefaultRoots: false`）。Git 通过 shell。这个 profile 没有 Playwright MCP；Web 验证使用目标项目自己的 Playwright，否则把缺口写入最终报告。

PRD 是唯一规格。预设不安装 OpenSpec，也不在目标项目创建 `openspec/`。任务和追踪写在 `.development/`，审查和验证结果写在 `artifacts/`。界面进度是 `tasks.json` 的全量 `todo_write` 镜像，同时只有一项 `in_progress`。

## 验收闸门

`FINAL_VERIFICATION` 之后进入 `ACCEPTANCE_GATE`（`status=AWAITING_ACCEPTANCE`），写出 `.flow/submissions/` 后停止；**未获宿主验收放行前不得 `PACKAGE`**。
交接细节见 skill `flow-acceptance-handoff`。宿主协调协议见 `../dev-acceptance-flow/`。
`AWAITING_ACCEPTANCE` 不是人工审批，与禁止的 `WAITING_FOR_APPROVAL` 不同。
