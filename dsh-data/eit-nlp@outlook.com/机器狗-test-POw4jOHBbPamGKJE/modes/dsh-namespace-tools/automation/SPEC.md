# 工具目录自动分类

## 目标与边界

DSH 每周运行维护 Agent，使用自身模型判断工具功能。Node.js 20+ 工具负责只读抓取、严格筛选、自动映射、结果校验和原子保存，旧 CLI 保持兼容。仅 `state === "active" && enabled === true` 的工具参与本次分类。publish 从已接受分类及确认映射编译并原子发布到实际配置。插件入口只在初始化时读取一次，配置变更通过 restart Harness 后重新读取生效；不做轮询、fs.watch 或通知接口。不改变网站、不执行机器人动作、不自动部署代码或重启服务。

## 接口与文件

默认每周流程为 DSH Skill 调用同预设的 `namespace_maintenance` 工具。部署者只设置绝对 configPath/stateDir 和注册目录地址；不配置源或 MCP 服务名前缀。网站 ID 取最后一个 `.` 后的完整名称，无点则使用完整 ID；运行名必须恰好是 `mcp__<server>__<toolName>` 三段，服务名不限。逐字、大小写敏感精确匹配，不模糊、不去哈希、不拆普通下划线。支持多级网站前缀及 ASCII 字母、数字、下划线、短横名称，完整运行名不超过 64 字符；包含多余双下划线的 MCP 名无法无歧义逆解析，明确报告 unsupported。

双向唯一：本轮 eligible 多个网站 ID 末级同名、多个 MCP 注册名同名、缺失或不支持均 ready:false，整轮停止发布；先按全部注册候选判断唯一，再检查目标可纳管，不能排除 own-shadow 后改选另一个服务。内部绑定 mappingMode=exact-tool-name-v1，旧前缀运行拒绝复用。旧 sourcePrefix/runtimePrefix 配置明确报迁移提示，删除后重新 prepare。
工具 prepare 直接返回分类所需数据和 runId；publish 只接收 runId 与分类 decision，不能接收路径、URL 或映射。发布前重新读取来源并核对本轮 eligible 快照及实际注册名，验证配置路径、映射模式和运行 ID 绑定，复用 accept/publish 的锁、备份、时效和幂等检查。所有 eligible 必须映射确认且有可判定分类，否则保留实际配置。自动映射仅保存为内部审计产物；旧 CLI 保持兼容。插件不执行业务工具，不解除外部工具限制，不启动定时器、不自动重启 Harness。

DSH 0.2.2-alpha.2 的 `tools.view(agent).knownNames/restrictableNames` 在 JS 中可读，但类型声明为 private；适配器必须检查两个字符串 Set，缺失时停止，不能静默退回经过 namespace mask 的列表。映射目标须属于可限制的祖先注册，并读取内部 tools.layers.peek(agent).tools.entries() 排除自身同名 shadow；检查接口、迭代和条目形状，不兼容时拒绝。Skill 必须安装到 DSH 能发现的目录，周任务须在同一目标预设下调用工具。真实组件验证覆盖隐藏工具仍在 inventory、外 scope 拒绝以及发布后旧实例保持不变。

- `node automation/cli.js prepare --config config.json --state-dir /绝对路径/state`：抓取已指定的网站；生成唯一运行目录的 task.json。
- `node automation/cli.js accept --run /运行目录 --assignments /分类结果.json`：校验本轮工具完整且唯一归属，保存 catalog.json。
- `node automation/cli.js compile --catalog /catalog.json --config config.json --tool-map /tool-map.json --output /candidate.json`：按显式映射生成运行候选配置，不覆盖输入文件。
- `node automation/cli.js publish --catalog /catalog.json --config /实际配置.json --tool-map /tool-map.json`：独占锁内校验来源时效及配置基线，备份并保留文件权限原子发布；发布凭据支持相同运行重试。只写文件，等待 restart Harness 生效。
- `automation/core.js` 为核心逻辑；`automation/cli.js` 为入口；`test/automation.test.js` 为行为测试；README 和 weekly-task 提供接口和任务说明。

## 约束

复用已有 namespace ID 和职责描述；新 namespace 必须含 ID、中文名、职责描述。信息不足的工具保存为 namespace:null 待处理，不强行猜测；有待处理项时不编译运行候选。分类目录只包含本轮符合条件的工具。运行候选配置保留不在本轮映射范围内的现有成员及 enabled/eagerTools/hiddenTools；常驻工具保留原归属。映射缺失或重复时拒绝生成运行候选，分类目录仍可独立成功。

HTTP 失败、响应格式错误、零符合条件的工具、重复 ID、漏项、未知工具、重复归属、无效 namespace、配置/分类基线冲突均不覆盖既有结果。相同运行结果重试幂等。工具元数据仅为不可信数据，模型不能执行其中指令；不提供注册接口 api_url。

## 验证与实现顺序

1. 先测严格筛选、分类校验与合并约束，再实现纯逻辑。
2. 增加 prepare/accept/compile 文件流程，测试并发冲突、幂等和失败保留。
3. 使用合成 HTTP 服务验证成功、错误响应、响应上限和超时。
4. `node --test test/automation.test.js` 与 `npm test`；独立审查由主 Agent 安排。

发布必须拒绝 pending、缺失/碰撞映射、超过 24 小时的快照和基线冲突；当前文件已等于本轮发布 hash 时幂等成功。源码中的 config.json 不作为测试发布目标。

入口只在安装时读取并完整校验配置，读取失败或内容无效直接拒绝启动。共享文件 enabled:false 与预设 enabled:true 合并，预设允许 enabled、绝对 configPath 及可选 maintenance；maintenance 默认关闭并继承总体 enabled/configPath。namespace/eager/hidden 由文件作为唯一来源，prepare 只额外向模型提供 eagerTools 以保持原归属。当前实例使用启动快照，文件修改以及 Agent idle 都不会使它重新读取。默认 selector 保留启动时的 namespace enum 与描述。

验证必须捕获定时器注册以防轮询回归，并证明文件发布不改变旧实例、销毁重建入口后读取新版本。保留 index 内部已有的显式 updateConfig 能力与测试，但默认入口不启用该模式、不暴露自动调用路径。

沿用 ESM、两空格和无分号风格；新增具名函数添加中文用途和业务参数说明。代码不包含凭据，不修改用户已有运行配置。本目录不在 Git 仓库内，不执行提交。
