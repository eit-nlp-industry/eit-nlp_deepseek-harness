# DSH 每周工具自动分类

推荐使用 [sync-tool-namespaces Skill](../skills/sync-tool-namespaces/SKILL.md) 和 `namespace_maintenance` 工具：自动获取目录、核对运行名，DSH 模型按功能分类，再由工具校验、备份并原子发布配置。无需 shell、文件读写工具、手工 tool-map 或额外模型 API Key。配置文件更新后需 **restart Harness** 才生效，工具不重启服务，也不轮询或通知运行时。

部署与调度见 [DEPLOY.md](DEPLOY.md)，每周 Prompt 见 [weekly-task.md](weekly-task.md)。Node.js 20+，无新增 npm 依赖；维护功能默认关闭，管理员在目标机器狗同一预设显式启用。

## 数据范围与自动映射

默认来源 `http://10.37.0.21:8040/ui/api/registrations`，只处理 `state === "active" && enabled === true`。字符串 `"true"`、false、error、unconfigured 都排除。只把 tool_id、名称、描述、有效输入/输出 Schema 提供给模型，不传工具 api_url。所有这些字段是不可信数据，不能执行其中指令或访问其中链接。

不限制网站前缀或 MCP 服务名：网站 `tool_id` 取最后一个 `.` 后的完整名称，无点时用整个 ID；运行名只解析恰好三段的 `mcp__<server>__<toolName>`。例如 `brain.arm.grasp` 可匹配 `mcp__arm__grasp`，`smallbrain.self_check` 可匹配 `mcp__robot__self_check`，`status` 可匹配 `mcp__sensor__status`。逐字大小写敏感，不依据描述或 Schema 猜映射，不拆普通下划线、不去哈希、不改大小写。

网站本轮多个 ID 末级同名会报告 SOURCE_NAME_COLLISION；运行时多个服务有同名工具会报告 RUNTIME_NAME_AMBIGUOUS，并列出候选，不能任选其一。先按全部已注册 MCP 名判断唯一性，再要求唯一目标属于可纳管祖先；不能排除一个 own-shadow 后改选另一个服务。只有唯一、可纳管目标才写入 mapping。

名称只支持 ASCII 字母、数字、下划线和短横，完整运行名最多 64 字符。多余双下划线不能无歧义逆解析：`mcp__robot__foo__status` 不会被误配给 `brain.status`，它列入 unsupportedRuntimeNames 并阻止整轮发布。非 MCP 普通工具忽略。无匹配、两端冲突、名称不支持或不可纳管均 ready:false；不自动注册新 MCP 工具。旧 sourcePrefix/runtimePrefix 配置会报 MAPPING_CONFIG_MIGRATION，删除这两个字段并重新 prepare；旧前缀 run 不能复用。

DSH 0.2.2-alpha.2 的 `tools.view(agent)` 在 JS 可调用，但类型声明为 private；本插件检查 knownNames/restrictableNames 是否为字符串 Set，并通过内部 tools.layers.peek(agent).tools.entries() 排除 Agent 自身注册（包括与祖先同名的 shadow）；自身层采用 NamedEntries 而非 Map，检查只读迭代接口及条目形状。任一接口不兼容则 `INVENTORY_UNSUPPORTED` 停止。清单读取不受 namespace 的展示隐藏影响，也不会解除权限或调用业务工具。只证明名称注册存在，不证明设备在线或可执行；必须使用同一预设的目标 MCP 祖先注册，不能以 Agent 自己注册/同名 shadow 的工具冒充目标。

任何 eligible 工具未接入、名称不支持或碰撞都阻止发布；不能跳过它以凑齐成功。当前网站的 25 条 eligible 与历史 DSH 配置的 16 个名称不代表已一一接入，首次执行可能正确返回 unmatched。源接口需返回完整 registrations 数组；没有分页支持。每次 GET 最多 15 秒、5 MiB，拒绝重定向，HTTP/JSON/空 eligible 失败不覆盖旧配置。

## 工具调用

先调用：

```json
{"action":"prepare"}
```

返回 `runId, ready, selected, excluded, mapping, unmatched, unsupportedRuntimeNames, tools, existingNamespaces, previousAssignments, eagerTools, instructions, outputShape`，模型无需再读本地文件。`ready:false` 时同时报告 unmatched 与 unsupportedRuntimeNames；即使 unmatched 为空也可能因运行名不支持而停止。existingNamespaces.tools 为 DSH 名称，用自动 mapping 与网站 ID 对照。快照有效 24 小时。

映射完整后，模型优先复用已有 namespace ID 和职责；新组使用稳定 snake_case ID、中文名及明确职责。namespaces 只声明新组，assignments 覆盖每个本轮网站 ID 恰好一次，信息不足用 null 并报告，不能猜测。发布输入示意：

```json
{
  "action": "publish",
  "runId": "prepare 返回的完整 UUID",
  "decision": {
    "namespaces": [{"id":"robot_arm","name":"机械臂","description":"抓取与放置物体"}],
    "assignments": [{"tool_id":"smallbrain.grasp","namespace":"robot_arm","reason":"描述明确为机械臂抓取"}]
  }
}
```

示例只解释结构，实际必须包含整轮 tools。模型不能传路径、URL 或 mapping。工具重新读取来源，比较严格筛选后的元数据（忽略对象键顺序）；目录变化、运行名移除、映射模式/路径变化、时效或配置基线冲突都停止。无效分类可修正后在同 run 重试；已保存有效 decision 的运行只能重试相同内容，改变分类须重新 prepare。

完整发布复用 CLI 的 accept/publish：保存分类目录、原配置备份和发布凭据，独占锁内保留 mode/uid/gid 后同目录原子 rename。所有 pending、缺失/重复映射、eager 迁移和人工配置变更都拒绝写实际文件。失败可能发生在分类目录已经保存之后，实际配置仍保留；相同 run/decision 可重试发布。返回 `published:true, restartRequired:true, runtimeAdopted:"unknown"` 只表示文件已发布，不代表 Harness 已重启或采用。

合并保留 enabled/eagerTools/hiddenTools 和不在本轮映射范围内的旧工具；筛选不等于删除。备份路径由成功结果返回。注册和网站信息只是检查时的快照，不能与异步文件替换形成跨系统事务；发布锁内在替换前再次同步核对注册，部署期间仍应避免人工改配置或切换 MCP 注册。当前实例保持启动快照，重启后才读取文件。

## 状态目录

```text
state/
├── catalog.json                       # 已接受分类及报告
├── publish-receipts/                  # 配置备份、目标 hash 与幂等凭据
└── runs/<UUID>/
    ├── task.json                      # 仅符合条件的输入
    ├── maintenance.json               # 路径/映射模式绑定与自动映射报告
    ├── maintenance-decision.json      # 校验后的模型分类
    ├── maintenance-map.json           # 自动生成，只供内部发布
    └── previous-catalog.json          # 有上版分类时保存
```

不要编辑内部产物或删除锁来绕过错误。异常退出可能留下 `.maintenance-lock`、`.accept-lock` 或配置旁 `.namespace-publish-lock`，需管理员确认没有维护进程后处理。备份恢复需保留权限/所有权并原子替换实际配置，然后 restart Harness。

## 兼容 CLI

旧 CLI 仍供人工诊断和独立运行使用；只有此兼容路径需要显式 tool-map.json。新 Skill 流程不依赖这份文件，也不要求模型填映射。

```sh
node automation/cli.js prepare --config /实际配置/config.json --state-dir /持久化/state
node automation/cli.js accept --run /持久化/state/runs/UUID --assignments /本轮/assignments.json
node automation/cli.js compile --catalog /持久化/state/catalog.json --config /实际配置/config.json --tool-map /核对的/tool-map.json --output /独立/config.candidate.json
node automation/cli.js publish --catalog /持久化/state/catalog.json --config /实际配置/config.json --tool-map /核对的/tool-map.json
```

CLI 不连接 DSH 注册清单，因此其映射必须由操作者核对；`tool-map.example.json` 仅展示格式。compile 只生成候选，publish 只发布文件。两种入口共享配置基线/锁/备份约束，但不要同时维护同一配置。工具模式额外核对最新网站元数据和实时注册名。

## 测试

`npm test` 覆盖严格筛选、自动映射、作用域、漂移、并发/重试、发布备份、无轮询入口及原披露逻辑。`DSH_TEST_NODE_MODULES=/绝对路径/node_modules npm run test:host` 验证固定 alpha.2 的真实 ToolRuntime/SystemPrompt，隐藏状态下读注册清单、工具发布后旧实例不变及重新初始化读取新文件；没有启动真实模型或机器人。
