# 校园活动筹备向导 · 独立恢复包

`@local/dsh-wizard` v0.1.0 —— 会话级「向导」视图插件（Host 工具 + 浏览器视图）。

> **重要：向导里的流程图是自绘的临时版本（`WorkflowTree`），只复用 `workflow-v1` 数据模型，
> 不是 `@eit/json-render-react` 的 `Workflow` 组件。** 不要把它描述为“已接入原组件”。

## 目录

```
dsh-wizard-recovery/
├── README.md                     ← 本文件
├── metadata.json                 ← 版本矩阵与文件清单
├── MANIFEST.sha256               ← 归档内文件校验
├── 1-plugin/                     ← 插件本体（真实文件，非软链）
│   ├── package.json              ← dsh.bundle + dsh.client 声明
│   ├── cordis.patch.yml          ← 自动插入 loader 行
│   ├── index.js                  ← Host：wizard_stage 工具 + GET /api/wizard/state
│   ├── state.js                  ← 纯函数：会话事件 → 向导状态
│   ├── client.js                 ← 浏览器：conversation.view id=wizard
│   ├── icon.svg, locale/{zh,en}.json
│   ├── README.md                 ← 插件自身文档（含回退命令）
│   └── test/*.mjs                ← 8 个 node:test 用例（折叠逻辑 + 槽位接线）
├── 2-profile/                    ← 加载配置片段
│   ├── profile-fragment.json
│   └── README.md                 ← 依赖声明、bundles 追加、软链、验证
└── 3-data/
    └── restore-data.md           ← 阶段数据落在会话日志的说明
```

## 版本矩阵

| 项 | 值 |
|---|---|
| 插件 | `@local/dsh-wizard@0.1.0` |
| Harness | `0.2.2-alpha.2`，commit `a7e43d45fafe582d26a296610dfaaa04c2e48e33`（`dsh-v0.2.2-alpha.2-409-ga7e43d45fa`） |
| Node | v26.7.0（`engines.node: >=24.9.0`） |
| pnpm | 11.28.5（仅用于 profile 依赖链接，非本插件必需） |
| JSON Render SDK | **无依赖**（不引用 `@eit/*`，也不需要 `render_ui`） |
| 浏览器依赖 | 平台静态表提供的 `react`；无额外 npm 包 |

## 放置与启用

1. 把 `1-plugin/` 解压到 `<DSH_HOME>/empty-workspace/wizard-bundle`（或任意目录）
2. 按 `2-profile/README.md` 修改 profile 的 `package.json`：
   - `dependencies` 增加 `"@local/dsh-wizard": "link:<WIZARD_DIR>"`
   - `dsh.profile.bundles` **追加** `"@local/dsh-wizard"`
3. 确保 `<DSH_HOME>/profiles/<profile>/node_modules/@local/dsh-wizard` 指向该目录
4. 重启 Harness

**不需要**：安装依赖、构建客户端、修改 `cordis.patch.yml`。
`client.js` 就是浏览器产物（手写 ESM，供 `window.__ModuleLoader__` 注册），
`index.js` 直接由 Node 加载，均无编译步骤。

## 启用后的验收

- 工具表出现 `wizard_stage`
- 会话头部出现「向导」页签（`conversation.view` id `wizard`，order 5）
- `GET /api/wizard/state?sessionId=<id>`：登录态下返回 JSON；未知会话返回 `404 {"error":"unknown session"}`
- 自检：`node --test 1-plugin/test/state.test.mjs 1-plugin/test/client-wiring.test.mjs`（离线可跑，8/8）

## 历史阶段数据

向导状态来自会话日志中的 `wizard_stage` 调用，**没有独立存储**。
需要保留历史时，请一并保留 `3-data/restore-data.md` 中列出的会话目录。

## 回退

```
plugin_manager set_plugin target=include:dsh-wizard enabled=false
```

或在 profile 的 `package.json` 中移除 `@local/dsh-wizard` 并从 `bundles` 删除，
然后重启即可；删除插件目录不影响会话日志。

## 本包未包含

- `node_modules`（插件无运行时依赖）
- 任何凭据、token、`.credentials.yaml`、`.anonymous-user-id`
- 会话日志本体（属用户数据，按 `3-data/` 的说明单独保留）
