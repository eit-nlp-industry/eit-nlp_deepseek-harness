# 服务器部署与 DSH 每周任务

本版本由 Skill + `namespace_maintenance` 自动获取、映射、分类和更新配置，不需要每个工具手工维护 tool-map。首次启用新代码需 restart Harness；此后每周自动写配置，每次写入后仍需 restart Harness 才生效。没有轮询、通知或自动重启。

## 1. 备份并放置完整代码

先沿现有 `namespace-tools.js` 的 import 找到实际插件目录与实际配置。以下都是示例路径，必须改成 **DSH 进程内部可见的绝对路径**；若 DSH 在容器中，宿主路径不一定相同。

上传 `namespace-automation-skill-suffix-20261116.tar.gz` 后，先解压到独立目录，不能直接覆盖服务器的现有 config.json：

```sh
mkdir -p /data/dsh/namespace-maintenance-release
tar -xzf /tmp/namespace-automation-skill-suffix-20261116.tar.gz -C /data/dsh/namespace-maintenance-release --strip-components=1
```

备份运行时代码。把新版 package.json、index.js、config.js、disclosure.js、preset-entry.js、maintenance.js 以及 automation/ 整个目录同步至实际插件代码目录，保留原服务器配置。maintenance.js 依赖 automation/core.js 和 workflow.js，不能只替换入口。Node.js 20+，不需要 npm install。

代码、state 与配置都应持久化。**配置挂载整个目录，不能只 bind mount 单个 config.json**：发布依赖同目录临时文件及 rename，单文件挂载可能报 EBUSY 或继续读取旧 inode。DSH 用户需要 state 和实际配置父目录的写权限；publish 保留 mode/uid/gid，不能保留时会拒绝替换。容器中 docker cp 本身不是持久化方案。

桥接必须导出新版 preset-entry.js；直接导出 index.js 不读取实际文件，也不安装维护工具：

```js
export { apply, inject, name } from '/实际插件目录/dsh-namespace-tools/preset-entry.js'
```

## 2. 启用维护工具

在当前机器狗同一预设的 namespace 插件配置中加入：

```yaml
config:
  enabled: true
  configPath: /实际持久化目录/config.json
  maintenance:
    enabled: true
    stateDir: /data/dsh/namespace-maintenance/state
    registryUrl: http://10.37.0.21:8040/ui/api/registrations
```

- `maintenance` 默认关闭，总体 enabled:false 时也不注册维护工具。启用后同预设会话具备写 namespace 配置能力；仅按已授权维护请求或周任务使用。
- `maintenance` 继承顶层 configPath，不可重复指定另一个配置。没有 configPath 时仍读取 preset-entry 同目录文件，建议部署显式配置。
- 无需配置前缀：网站 ID 取最后一个点后的完整名称（无点用全 ID），与任意 MCP 服务的工具名逐字、大小写敏感匹配。运行名必须恰好是 mcp__服务名__工具名 三段；不拆普通下划线、不去哈希。旧 sourcePrefix/runtimePrefix 字段需删除，否则明确报迁移错误，旧 run 需重新 prepare。
- namespace/eagerTools/hiddenTools 必须以实际配置文件为唯一来源，删除预设里这些重复覆盖；保留原文件的 enabled/eager/hidden 策略。
- 目标 MCP 工具必须注册在同一机器狗预设或其祖先作用域；维护工具通过当前 Agent 的完整注册名清单核对，不看模型初始可见列表。不要放在看不到目标 MCP 的其他维护预设，不支持 Agent 自己注册或同名 shadow 的目标工具。
- 仅支持合法 ASCII 名称和完整运行名不超过 64 字符；网站多 ID 末级同名、多个 MCP 服务同工具名、未注册或不可纳管目标都阻止发布。多余双下划线运行名列入 unsupportedRuntimeNames，也停止整轮；例如 mcp__robot__foo__status 不会被当作 status。网站 25 条 eligible 并不证明 DSH 全部接入；首次 unmatched 是需要处理的接入缺口，不能删掉条目或猜名绕过。

维护适配器已验证 DSH 0.2.2-alpha.2。tools.view 及 tools.layers.peek 的自身注册读取都依赖内部 API；view 声明为 private，同名 own shadow 会被排除，升级 DSH 前应跑 test:host；接口不兼容时会报 INVENTORY_UNSUPPORTED，不静默退回不完整列表。注册核对不等于设备在线、权限可用或业务成功。

## 3. 安装 DSH Skill 并重启一次

将包内 `skills/sync-tool-namespaces/SKILL.md` 复制到 **目标机器狗预设工作区**：

```text
<projectRoot>/.dsh/skills/sync-tool-namespaces/SKILL.md
```

projectRoot 通常是最近的 .git 祖先，否则为工作目录；为避免工作区判断偏差，也可通过服务器现有 Skill filesystem 的 customSkillDirs 显式指向本包的 skills 目录；不要安装到 Codex 的用户 skills 目录。DSH 需启用 Skill registry、filesystem 来源与 tool-skill，当前目标预设应能使用 `skill` 工具。代码加载和 Skill 发现的具体路径以服务器配置为准。

在无活动机器人任务、Goal 或子 Agent 的维护窗口，按服务器现有方式 restart Harness。本文未验证线上启动命令，不提供猜测的 restart 命令，也不自动重启 n8n 容器。

重启后在目标预设新会话中请求“加载 sync-tool-namespaces，只执行 prepare 并报告结果”。确认真实调用 namespace_maintenance，输出 selected/excluded、mapping、unmatched 和 unsupportedRuntimeNames；冲突报告带候选名。无需 bash/read/write，不需要导出 ROBOT_MCP_TOKEN，不访问 /proc，也不执行业务接口。若 ready:false，先处理未接入工具；若有描述不足，先补描述再重新准备。

完整可用后运行一次 Skill。只有 published:true 才表示已写入实际配置，返回备份路径。文件发布后旧实例目录应保持不变；另行 restart Harness，再用新会话检查 selector enum 和 load_namespace 的披露即可，无需机器人动作。

## 4. 创建 DSH 每周任务

在已经能加载 Skill 和调用维护工具的**目标机器狗预设会话**中，附上 [weekly-task.md](weekly-task.md) 分隔线后的全文，发送：

> 请创建“同步工具 namespace 分类”每周自动任务，时区 Asia/Shanghai，每周一 03:00，使用当前工作区和当前预设，目标选“创建一个会话并重复使用”（new_once）。每次执行附上的完整任务正文。创建后显示任务 ID、下次时间和所用预设，确认不是一次性任务。

任务 Prompt 无路径占位，也不含手工映射步骤。它先加载 sync-tool-namespaces，再 prepare → DSH 模型分类 → publish。已授权每周维护，不需每周重复询问批准；失败报告错误和缺口，不绕过检查。

也可在自动任务界面手动设置每周一 03:00、Asia/Shanghai、创建一个会话并重复使用，但要核对该界面默认使用的预设确实包含维护工具及目标 MCP。不要换到只有 shell 的 standard 预设。schedule_create 的 rrule 使用 RRULE，不能填 Cron 字符串；不同版本以实际工具 Schema 为准。

保存后点击“立即运行”，检查真实 prepare/publish 结果与备份；调度已投递不代表模型已完成。报告必须写“配置文件已发布，等待 restart Harness 生效”，不能声称已自动重启或生效。DSH Host 必须持续运行，调度及 state 都应持久化。

Host 需要 `@deepseek-ai/dsh-schedule`，通过对话创建还需要目标预设有 `@deepseek-ai/dsh-tool-schedule` 并实际出现 schedule_create；缺少 Skill/调度插件时先核对当前版本，不直接套用存储文件。

## 5. 失败、重试和回滚

待分类信息不足、映射未确认、源快照变化、超过 24 小时、映射模式/路径变化、配置基线冲突都会拒绝实际配置覆盖。未入选的旧运行工具会保留，不按网站筛选自动删除。已接受同轮分类可在时效内用相同 decision 重试；人工改过实际配置则重新 prepare。锁目录遗留时先确认没有维护进程，不让模型自行删锁。

成功输出 `published:true`、`restartRequired:true`、`runtimeAdopted:unknown`。注册检查仅代表检查时刻，无法与其他进程的 MCP 变动或人工文件操作形成跨系统事务，应避开并行部署。回滚使用结果返回的备份，保留权限/所有权地原子恢复到实际 configPath，然后 restart Harness。

旧 CLI/tool-map 仅作为人工兼容方式保留，见 [README.md](README.md)。新自动任务不读取用户维护的 tool-map.json；其映射由工具保存在本轮内部产物中。

参考：
- [DSH 调度指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/schedule.md)
- [模型调度工具](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/schedule/tool-schedule/README.md)
- [Skill filesystem](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/skill/skill-filesystem)
