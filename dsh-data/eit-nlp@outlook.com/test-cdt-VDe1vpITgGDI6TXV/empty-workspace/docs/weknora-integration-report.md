# WeKnora 知识库接入 DSH — 周报

**周期**：2026-11-10 ~ 11-12　**状态**：已上线可用　**改动面**：WeKnora 零改动；DSH 侧 1 条配置 + 1 个桥接脚本

## 本周完成

把 WeKnora 上的「EIT知识库」（5 篇招生简章、专业介绍、校园场馆资料）接进了 DSH 会话。agent 遇到 EIT 相关问题时自行检索，返回原文片段并给出处；写代码、改文案这类无关问题不触发检索。

## 接入方式

用 WeKnora 自带的「设置 → 发布集成 → MCP Server」建一个只读端点（限定 EIT知识库，拿到 `Bearer` 令牌），DSH 侧通过 `dsh-mcp-client` 以 stdio 方式连一个本地桥接进程。

没有选直连，是因为 WeKnora 的检索结果里混着模型生成的**文档摘要**（实测常排在第 2 名），直连会把二手转述当原文交给模型；而且 `ask`、`wiki_*` 这类加工结果的工具也该裁掉。桥接脚本 353 行、零依赖，负责过滤与字段裁剪。

![图 1　接入架构：用户 → Agent → dsh-mcp-client → 桥接脚本 → WeKnora MCP 端点 → 知识库](images/fig-01-architecture.png)

## 实现要点

- **过滤**：只留 `text` / `image_ocr`，丢掉 `summary` / `image_caption` / `image_vector`；返回带 `filtered_out` 字段便于自查。
- **过采样**：按 `limit×3`（上限 30）取再筛，避免摘要占名额导致条数不够；同时去掉与正文重复的 `match_snippet`。
- **工具收敛**：上游 9 个只暴露 5 个（search / grep / read_document / list_documents / list_kb），名字统一 `eit_kb_` 前缀。
- **自主判断**：靠三处信号——工具名带领域、描述写明"什么时候该用/不该用"、instructions 每轮进系统提示。引用规范要求写「依据《材料》的章节」，不写"知识库中""第 N 段"。
- **生效**：profile 改动 HMR 热加载，未重启服务。

![图 2　DSH 会话中的工具调用卡片（mcp__weknora__eit_kb_search）与返回](images/fig-02-tool-call.png)

## 验证

| 项 | 结果 |
|---|---|
| 检索 | 问「校园访问预约要提前多久」→ 命中《校园访问介绍》原文"需要提前网上预约" |
| 过滤 | 同一查询返回 4 条，`filtered_out: 1`（一条摘要被滤掉） |
| 分页 | `read_document` 2 段读完，`done: true` |
| 热加载 | 工具名从 `search_chunks` 切到 `eit_kb_search`，服务未重启 |

![图 3　引用样式对比：旧「知识库中…第 N 段」与新「依据《…》的章节」](images/fig-03-citation-style.png)

## 问题与风险

1. **环境回滚**：11-12 13:16:35，整个 workspace 与 profile 被快照回滚，当天两处修改被覆盖，导致一次测试仍输出旧引用样式。已重放，重放步骤见详细版第 8.3 节。
2. **软约束**：自主检索依赖提示，不保证 100% 必查；要变硬规则，得在具体 preset 的 persona 里写死。

## 下周计划

- 给三个 preset（校园预约 / 活动筹备 / 文案审稿）各加一条"校内事实必须先查库"的规则
- 视情况删掉返回里的 `chunk_index` / `score`，从结构上杜绝"第 N 段"表述
- 补齐下列截图

## 待补图片

| 编号 | 文件 | 截什么 |
|---|---|---|
| 图 1 | `images/fig-01-architecture.png` | 架构流程图（可把现有 ASCII 图重绘）；不补则用文字描述 |
| 图 2 | `images/fig-02-tool-call.png` | 会话里展开的工具卡片 + 返回 JSON 头部 |
| 图 3 | `images/fig-03-citation-style.png` | 同一问题两种引用样式的对比截图 |
| 图 4 | `images/fig-04-endpoint.png` | WeKnora 端点创建页（地址 + 令牌，**令牌务必打码**） |

> 完整版（含选型对比、数据契约、回滚重放清单、8 张图位）见 [weknora-integration-report-detail.md](weknora-integration-report-detail.md)。
