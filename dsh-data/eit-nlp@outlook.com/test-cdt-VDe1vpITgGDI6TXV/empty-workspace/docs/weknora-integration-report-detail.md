# WeKnora 知识库接入 DSH 实施报告

> 版本：v1.0（2026-11-12）
> 范围：把 WeKnora 上的「EIT知识库」接入 DeepSeek Harness Web 会话，让 agent 能按场景自主检索，并只取原文片段。
> 状态：已上线可用；待补图片见文末第 9 节。

---

## 1. 目标与结论

**目标**：让本会话里的 agent 在讨论宁波东方理工大学（EIT）的招生、专业、学费、书院、校园场馆、访问预约等话题时，能自己去查校方资料，并给出可核对的出处；不需要用户每次点名"查知识库"。

**结论**：可以接，且不需要改 WeKnora、不需要写检索逻辑。做法是在两者之间加一层**领域定制的 MCP 桥**，用 WeKnora 自带的「发布集成 → MCP Server」能力对接。

| 项目 | 结果 |
|---|---|
| 接入方式 | WeKnora 内置 MCP Server（Streamable HTTP）+ 本地 stdio MCP 桥 + DSH `dsh-mcp-client` |
| 改动范围 | WeKnora 侧：建一个只读 MCP 端点；DSH 侧：1 个 profile 配置条目 + 1 个桥接脚本 |
| WeKnora 代码改动 | 无 |
| 对外工具数 | 5 个（上游 9 个中裁掉模型生成类） |
| 返回内容 | 仅原文片段（`text` / `image_ocr`），模型摘要等已过滤 |
| 生效方式 | HMR 热加载，无需重启服务 |
| 验证 | 检索、分页、过滤、引用规范均实测通过（见第 7 节） |

---

## 2. 接入方式选型

WeKnora 能对外提供知识库能力的路径有三条，我们用的是第二条。

| 方案 | 做法 | 优点 | 问题 | 结论 |
|---|---|---|---|---|
| A. 直连 WeKnora MCP 端点 | DSH 里配 `transport: streamable-http` 指向 `/mcp/<id>` | 最省事，零代码 | 会返回模型生成的摘要片段、`ask` 成稿、wiki 页面；命中率被摘要挤占 | 弃用（曾短暂使用） |
| **B. 加一层本地 MCP 桥**（当前方案） | 桥接进程对外是 stdio MCP Server，对内是 `/mcp/<id>` 的客户端 | 可过滤、可裁剪字段、可控工具名与描述、可注入判定与引用规则 | 多一个进程、脚本要跟着维护 | **采用** |
| C. 走 REST API | 用 `X-API-Key` 调 `/api/v1/knowledge-search` | 无 MCP 依赖，参数最全（可 rerank、parent aggregation） | 需要空间 API Key（权限更大）；要自己实现工具层 | 备选 |

选 B 的关键理由：**检索结果里混着模型生成的内容**。WeKnora 会把每篇文档的摘要作为一个 `chunk_type=summary` 的片段放进索引，语义检索时它经常排在前列（实测第 2 名就是摘要）。直接透传等于把"二手转述"当原文交给 agent。方案 C 也没有现成的 `chunk_type` 过滤参数，一样要在客户端筛。

![图 1  WeKnora「设置 → 发布集成 → MCP Server」入口](images/fig-01-mcp-server-entry.png)

---

## 3. 总体架构

```
┌────────────────────┐   ① 业务问题（无需点名"查知识库"）
│  用户（Web GUI）    │ ───────────────────────────────┐
└────────────────────┘                                │
                                                      ▼
                                        ┌──────────────────────────┐
                                        │  DSH Agent（本会话）      │
                                        │  依 server instructions   │
                                        │  自行判断是否检索          │
                                        └────────────┬─────────────┘
                          ② tools/call mcp__weknora__eit_kb_search
                                                     ▼
                                     ┌───────────────────────────────┐
                                     │  dsh-mcp-client（profile 配置） │
                                     │  transport: stdio              │
                                     └────────────┬──────────────────┘
                          ③ stdio JSON-RPC（子进程，随插件生命周期启停）
                                                  ▼
                                     ┌───────────────────────────────┐
                                     │  tools/weknora-raw-mcp.mjs    │
                                     │  · 过采样 limit×3（≤30）       │
                                     │  · 过滤 summary/caption/vector │
                                     │  · 字段裁剪（去掉重复 snippet） │
                                     └────────────┬──────────────────┘
                          ④ Streamable HTTP + Bearer 端点令牌
                                                  ▼
                                     ┌───────────────────────────────┐
                                     │  WeKnora 内置 MCP Server       │
                                     │  /mcp/0012f748-…               │
                                     │  只读工具组，限定 EIT知识库      │
                                     └────────────┬──────────────────┘
                          ⑤ 向量/关键词混合召回 + rerank
                                                  ▼
                                     ┌───────────────────────────────┐
                                     │  EIT知识库（5 篇文档）          │
                                     └───────────────────────────────┘
```

要点：

- 桥接进程是 DSH 插件的子进程，随插件启停，失败自动重连；
- 桥接对外**只暴露原文类工具**，模型成稿（`ask`）与生成页面（`wiki_*`）不暴露；
- 令牌只给端点级权限（限定知识库 + 只读能力），不是空间 API Key。

---

## 4. WeKnora 侧配置

### 4.1 环境

| 项 | 值 |
|---|---|
| 访问地址 | `http://10.37.0.21:18081/`（Web UI，反代到后端 `/api/` 与 `/mcp/`） |
| 版本特征 | 提供 `POST /api/v1/mcp-endpoints`；`/mcp/` 未带令牌返回 401（端点存在） |
| 部署位置 | 独立主机（本机 8080 无监听），DSH 所在机器可直连 |

### 4.2 端点

在「设置 → 发布集成 → MCP Server」新建端点，配置：

| 字段 | 取值 | 说明 |
|---|---|---|
| 名称 | 例如 `DSH-EIT` | 仅标识用 |
| 知识库范围 | `EIT知识库`（`7c73b646-d2d9-4189-8310-28f30151a53b`） | 留空=全部；建议显式勾选 |
| 工具组 | 只勾「检索与阅读」 | 写入组（`add/update/delete_document`）默认关闭，保持只读 |
| 地址 | `/mcp/0012f748-d647-441a-9c38-d2c6b23bb35d` | 创建后生成 |
| 令牌 | `mcp_QQUN…Ofajk`（Bearer） | **只在创建时展示一次**，需当场保存 |

![图 2  端点创建结果页（地址、一次性令牌、客户端配置片段）](images/fig-02-endpoint-created.png)

端点令牌的权限边界：等价于一把只含 retrieve/chat 能力、且限定到所选知识库的 API Key。轮换只需在端点页重置，DSH 侧改一处令牌即可。

---

## 5. DSH 侧实现

### 5.1 配置条目

文件：`$DSH_HOME/profiles/n8n-web/cordis.patch.yml`（本机路径 `/data/dsh/eit-nlp@outlook.com/test-cdt-VDe1vpITgGDI6TXV/profiles/n8n-web/cordis.patch.yml`，第 11–32 行）

```yaml
- insert:
    - id: mcp-weknora
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: weknora
        transport: stdio
        command: node
        args:
          - "/data/dsh/…/empty-workspace/tools/weknora-raw-mcp.mjs"
        env:
          WEKNORA_MCP_URL: "http://10.37.0.21:18081/mcp/0012f748-…"
          WEKNORA_MCP_TOKEN: "mcp_QQUN…Ofajk"
        # 回答里的引用格式：给材料名与章节，不暴露内部片段口径
        clientInstructions: |
          引用知识库内容时，直接写出处材料与章节（例如「依据《…简章》的“五、时间安排”」），
          不要出现「知识库中」「第N段」「片段」「chunk」或 chunk_id、score 等内部字段；
          没有明确出处时正常回答，不必强行标注。
        toolCallTimeoutMs: 180000
        failOnStartupError: false
```

三个字段值得说明：

- **必须写成 `- insert:` 包裹**。patch 层里平铺一行 `- id: xxx` 会被当成"按 id 覆盖已有条目"，新条目静默不生效（本项目踩过）。
- `failOnStartupError: false`：WeKnora 挂了也不拖垮 DSH 启动，工具消失而已。
- `toolCallTimeoutMs: 180000`：知识库检索走向量+关键词+rerank，默认 60s 偏紧。

### 5.2 桥接脚本

文件：`empty-workspace/tools/weknora-raw-mcp.mjs`（353 行，零依赖，Node 内置 `fetch`）。

职责分四块：

**① 对内实现 MCP Server（stdio，逐行 JSON-RPC）**

支持 `initialize` / `tools/list` / `tools/call` / `ping` / `notifications/initialized`；响应体同时给 `content[0].text`（人读）和 `structuredContent`（程序读）。

**② 对外是 WeKnora 端点客户端**

```js
// 首次调用前握手一次，之后复用（端点是无状态模式，不需要 session id）
await post({ jsonrpc:'2.0', id:'init', method:'initialize', … })
await post({ jsonrpc:'2.0', method:'notifications/initialized' })
// 调用：tools/call → 取 structuredContent
```

**③ 过滤 + 过采样**

```js
const KEEP = new Set(['text', 'image_ocr'])          // 保留：原文、图片 OCR
// 丢弃：summary（文档摘要）、image_caption（模型写的图注）、image_vector（图向量）

const want = Math.min(30, Math.max(1, args.limit ?? 8))
const upstreamArgs = { query, limit: Math.min(30, want * 3) }   // 过采样 3 倍
const { kept, dropped } = filterHits(data.results)               // 再筛，最多返回 want 条
```

为什么要过采样：摘要片段会占名额。`limit=4` 时若只取 4 条，可能 2 条是摘要，用户只拿到 2 条真片段。取 `limit×3` 再筛，才能在过滤后仍凑满需要的条数。

**④ 字段裁剪**

上游 `search_knowledge` 每条片段同时返回 `content` 和 `match_snippet`，两者内容基本重复。桥接只保留一份正文，并去掉了 `knowledge_metadata`、`source_query`、`query_type` 等对回答无用的字段，单条体积大约减半。

### 5.3 数据契约

`eit_kb_search` 返回：

| 字段 | 含义 |
|---|---|
| `query` / `mode` | 回显查询与检索模式 |
| `returned` | 过滤后实际返回条数 |
| `filtered_out` | 被过滤掉的条数（摘要等），用于自查过滤是否生效 |
| `chunks[]` | 片段数组，见下 |

`chunks[]` 每项：

| 字段 | 用途 |
|---|---|
| `chunk_id` | 片段唯一 id |
| `chunk_index` | 片段在文档中的序号，**仅用于定位，不应写进回答** |
| `chunk_type` | `text` / `image_ocr` |
| `score` | 相关性分数，同上，不对外引用 |
| `document_id` / `document_title` | 文档标识与材料名，**`document_title` 才是写进回答的** |
| `knowledge_base_id` | 所属知识库 |
| `content` | 片段正文（原文） |

`eit_kb_read_document` 额外返回 `offset` / `next_offset` / `fetched_chunks` / `done`，用于分页读完整篇。

### 5.4 工具清单

对外 5 个，名字统一带 `eit_kb_` 前缀（可用 `WEKNORA_TOOL_PREFIX` 改）：

| 工具 | 全名 | 用途 |
|---|---|---|
| `eit_kb_search` | `mcp__weknora__eit_kb_search` | 语义/关键词检索，主入口 |
| `eit_kb_grep` | `mcp__weknora__eit_kb_grep` | 正则找编号、条款、精确数字 |
| `eit_kb_read_document` | `mcp__weknora__eit_kb_read_document` | 按阅读顺序分页读原文 |
| `eit_kb_list_documents` | `mcp__weknora__eit_kb_list_documents` | 文档清单（默认不含 LLM 摘要） |
| `eit_kb_list_knowledge_bases` | `mcp__weknora__eit_kb_list_knowledge_bases` | 库清单（通常无需先调） |

上游 9 个工具中被裁掉的 4 个：`ask`（Agent 成稿）、`wiki_index` / `wiki_search` / `wiki_read_page`（生成的 Wiki 页面）。理由：这三类都是模型加工过的内容，与"只给原文"的目标冲突。

---

## 6. 行为设计：自主检索与引用

### 6.1 为什么 agent 会"自己想到"要查

不是靠中间件强推，而是让模型每一轮都能看到三处信号：

| 信号 | 位置 | 作用 |
|---|---|---|
| 工具名 | `eit_kb_*` | 名字自带领域信息，比 `search` 更易被正确选择 |
| 工具描述 | 每个工具的 `description` | 明写触发条件（招生/学费/书院/场馆/预约）与不触发条件（代码、本地文件、通用知识） |
| Server instructions | 桥接 `initialize` 返回 | 每轮作为"MCP server: weknora"段进系统提示，给判断规则与引用要求 |

### 6.2 判定规则（写进 instructions 的部分）

**该查**：

- 涉及该校招生政策、报名/初审/测试时间、学费与奖助、专业与课程、培养模式、书院、校园场馆、访问预约；
- 用户说"知识库里""资料里""手册/简章里怎么写"；
- 需要为校方事实给出处，或模型正打算用"我记得/一般来说"回答校内信息。

**不该查**：通用知识、编程调试、本地文件操作、与该校无关的闲聊；也不为"保险"对每个问题都查。

**怎么用**：先 `eit_kb_search`（编号/条款用 `keyword` 模式或 `eit_kb_grep`），命中不足或需完整上下文再 `eit_kb_read_document`。

### 6.3 引用规范

目标样式是**给材料与章节**，不是给内部位置：

- ✅ 「依据《2026年浙江省"三位一体"综合评价招生简章》的"五、时间安排"」
- ❌ 「知识库中《图书馆四明书院介绍.docx》第 2 段原文：…」

规则写在两处（冗余）：桥接的 server instructions，以及 profile 的 `clientInstructions`。禁用词：`知识库中`、`根据知识库`、`第N段`、`片段`、`chunk_id`、`chunk_index`、`score`。没有明确出处时正常回答，不强行标注。

![图 3  引用样式对比：左为旧样式（知识库中…第 N 段），右为新样式（依据《…》的章节）](images/fig-03-citation-style.png)

---

## 7. 验证记录

| # | 验证项 | 方法 | 结果 |
|---|---|---|---|
| 1 | 端点可达 | `HTTP GET /mcp/` | 401（端点存在，需令牌），非 404 |
| 2 | 握手与工具发现 | 手工 `initialize` + `tools/list` | 返回 9 个工具，`serverInfo.name = weknora` |
| 3 | 知识库范围 | `list_knowledge_bases` | 1 个库「EIT知识库」，能力 semantic / keyword / wiki |
| 4 | 文档清单 | `list_documents` | 5 篇，全部 `parse_status=completed` |
| 5 | 语义检索 | `search_chunks("图书馆 四明书院 食堂 图片 预约")` | 返回 4 条，`filtered_out: 1`（摘要被滤） |
| 6 | 摘要过滤 | 同上，检查 `chunk_type` | 返回项全为 `text`，无 `summary` |
| 7 | 分页读取 | `read_document(limit=10)` | 2 条，`done: true`，`next_offset: 2` |
| 8 | 端到端问答 | 问「校园访问预约 需要提前多久」 | 命中《校园访问介绍》"需要提前网上预约" |
| 9 | 热加载 | 改配置后观察工具表 | 工具名从 `search_chunks` 切到 `eit_kb_search`，未重启服务 |

库内 5 篇文档：

1. `专业介绍_easy.xlsx` — 8 个本科专业的课程、师资、培养模式
2. `招生_本科招生_202605.docx` — 2026 招生宣传与政策（含"三位一体"简章全文）
3. `2026年招生工作手册0508.pdf` — 内部招生工作手册（政策解读、话术、FAQ）
4. `校园访问介绍.docx` — 校园访问需提前网上预约
5. `图书馆四明书院介绍.docx` — 图书馆/研讨室/四明书院/食堂说明与图片路径

> 注：库内容的实际口径以 WeKnora 中的最新版本为准，本文档只记录接入方式与验证结果。

![图 4  DSH 会话中的工具调用卡片（mcp__weknora__eit_kb_search 及其返回）](images/fig-04-tool-call.png)

---

## 8. 运维

### 8.1 令牌

- 令牌出现在两处：桥接脚本的 `DEFAULTS`、profile 的 `env.WEKNORA_MCP_TOKEN`；建议删掉脚本默认值，只留环境变量，轮换时只改一处。
- 轮换流程：WeKnora 端点页重置令牌 → 改 profile 的 `env.WEKNORA_MCP_TOKEN` → 保存即热加载。

### 8.2 修改桥接脚本后如何生效

`dsh-mcp-client` 只在**配置变化**时重建 stdio 子进程，改脚本本身不会触发重启。操作办法：随便改一个配置字段（例如把 `toolCallTimeoutMs` 从 180000 调到 200000）保存，即可让新脚本被加载。判断有没有生效：看会话系统提示里 "MCP server: weknora" 段落是否为新文案。

### 8.3 已知风险：环境快照回滚

本环境出现过一次**整体回滚**：2026-11-12 13:16:35，`$DSH_HOME/empty-workspace` 下的所有文件（含未改动的 `probe/`、`wizard-bundle/`）与 profile 配置的 mtime 同时变成同一秒，此前几分钟的修改被覆盖回旧版。表现是：配置看着没变，但会话里的引用突然又变成"知识库中…第 N 段"。

回滚后的重放清单（三步）：

1. 重新给 `tools/weknora-raw-mcp.mjs` 打引用规则补丁（`引用规则` 字样应存在）；
2. 重新在 `cordis.patch.yml` 加 `clientInstructions` 段；
3. 保存后确认会话系统提示出现「引用规则」与「MCP client instructions」两段。

若再次发生，先检查这两个文件的 mtime 是否被批量重置，再决定是重放还是排查上游同步。

### 8.4 可调参数

| 参数 | 位置 | 默认 | 说明 |
|---|---|---|---|
| `WEKNORA_KEEP_CHUNK_TYPES` | 脚本 env | `text,image_ocr` | 想连 OCR 也不要就改成 `text` |
| `WEKNORA_TOOL_PREFIX` | 脚本 env | `eit_kb` | 工具名前缀 |
| `WEKNORA_SCOPE` | 脚本 env | EIT 资料清单 | 进工具描述与指令的范围说法 |
| `toolCallTimeoutMs` | profile | `180000` | 单次调用超时 |
| `limit`（调用参数） | — | `8`（上限 30） | 过滤后返回条数 |

---

## 9. 需要补充的图片

报告里已按编号留好占位。请按下表补图，文件名保持一致即可直接生效（建议放 `docs/images/`，宽度 1200–1600px，PNG）。

| 编号 | 文件名 | 出现位置 | 建议截什么 | 备注 |
|---|---|---|---|---|
| 图 1 | `images/fig-01-mcp-server-entry.png` | 第 2 节末 | WeKnora「设置 → 发布集成 → MCP Server」页面，能看出入口与端点列表 | 证明"能力在 WeKnora 侧现成" |
| 图 2 | `images/fig-02-endpoint-created.png` | 第 4.2 节 | 端点创建成功页：地址 `/mcp/<id>`、一次性令牌、客户端配置片段 | **令牌需打码**，只保留前 8 位 |
| 图 3 | `images/fig-03-citation-style.png` | 第 6.3 节 | 同一问题的两种回答截图，左右拼接或上下拼接 | 现成素材：你已提供两张对比图 |
| 图 4 | `images/fig-04-tool-call.png` | 第 7 节末 | DSH 会话里展开的工具调用卡片，含 `eit_kb_search` 与返回 JSON 头部 | 证明"确实是检索来的" |
| 图 5 | `images/fig-05-architecture.png` | 第 3 节 | 可选：把 ASCII 架构图重绘为流程图（draw.io / Excalidraw） | 不补也可用当前 ASCII 图 |
| 图 6 | `images/fig-06-doc-list.png` | 第 7 节文档清单旁 | WeKnora 知识库文档列表（5 篇、解析状态已完成） | 与正文清单对应 |
| 图 7 | `images/fig-07-profile-patch.png` | 第 5.1 节 | `cordis.patch.yml` 中 `mcp-weknora` 条目的编辑器截图 | **令牌打码** |
| 图 8 | `images/fig-08-filter-proof.png` | 第 5.2 节③ | 一次检索返回里 `returned` 与 `filtered_out` 两个字段 | 直观说明摘要被过滤 |

补图注意事项：

- 所有截图统一打码 `mcp_` 开头的令牌、内网 IP 如需对外可一并打码；
- 图 3 建议加箭头或红框标出"知识库中/第 N 段"与"依据《…》"的差别；
- 图 5 若重绘，保留 ①–⑤ 五个编号，与正文架构说明逐条对应。

---

## 10. 已知限制

1. **检索是软约束**：自主决定依赖提示，不保证 100% 必查；要硬约束需在具体场景的 preset persona 里写死规则。
2. **片段粒度**：返回的是 chunk，不是整篇；需要连续上下文要用 `read_document` 分页读。
3. **`grep_chunks` 有召回上限**：上游候选最多 30 条，不保证穷尽；穷尽单篇请用 `read_document` 的 `query` 模式。
4. **无知识图谱**：WeKnora 的 `graph-search` 接口存在，但端点未暴露对应工具。
5. **图片**：只有与文档绑定的图片资源会转成 `/r/<token>` 直链；正文里手写的本地路径（如 `…/Siming Academy.jpg`）仍是纯文本，不可访问。
6. **写入能力未开**：端点只勾了只读工具组，agent 不能改知识库。
