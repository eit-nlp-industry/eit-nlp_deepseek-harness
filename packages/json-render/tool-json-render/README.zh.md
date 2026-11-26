---
description: "全局 render_ui 工具，向运行中的 json-render 服务请求展示界面或表单。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-json-render

[English](README.md) | 中文

## 概述

通过运行中的 v0.2.8 服务，使用 `render_ui` 展示完整内容或可编辑表单。展示调用继续当前回合，成功表单等待用户操作。表单支持默认提交或声明的一组独立操作按钮。共享呈现 Skill 在普通 Agent 选择工具前提供指引。生成失败保留文字兜底，并提供纠错诊断。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 components 中列出 Chart，为柱状图、折线图或环形图选择 rich_content。Chart 需要 labels 和具名 series，各组 values 的数量须与 labels 一致。

将插件挂载在宿主，而非某个 Agent 预设内。Agent 继承工具，预设可通过 `tools.restrict` 移除它。修改 `description` 可改变模型调用工具的时机。

启用的宿主挂载还会在任何工具调用前提供共享呈现指引。普通预设即使替换人设也会继承，无需个人安装 Skill 或逐预设编写提示词。在本包内维护权威[呈现 Skill](skills/select-dsh-presentation/SKILL.md) 及其参考文档；这些资源随包发布并一同进入提示，因此 Agent 无需 `skill` 或文件工具即可读取。安装新包或修改资源后须重启宿主。可用能力仍以工具说明及 schema 为准。限制 `render_ui` 不会授予其他渲染通路；共享指引要求 Agent 只使用可用工具。禁用本插件会同时移除工具与指引。

共享规则涵盖文字、原生提问、动态表单、浏览、排序、流程、阶段切换和表单按钮，但不实现按钮处理器。设为 `complete: true` 的预设会刻意替换其他全部系统提示段，包括这些规则；作者须将需要的规则纳入完整提示，或改用普通人设覆盖。

```yaml
- id: tool-json-render
  name: '@deepseek-ai/dsh-tool-json-render'
  config:
    baseUrl: http://10.37.0.21:3001
    description: Call render_ui only for comparison tables.
```

当 `baseUrl` 为空时使用 `JSON_RENDER_BASE_URL`。每次尝试的超时为 `timeoutMs`（默认 60000）。工具最多尝试三次，HTTP 400 不重试。`MODEL_OUTPUT_INVALID` 等生成失败在收到响应后停止。图片 GET 的 401、403 或 404 属于独立浏览器请求，不会再次调用渲染服务。

将 `mediaRoot` 设为绝对目录，或在其为空时设置 `JSON_RENDER_MEDIA_ROOT`。目录包含 `index.json` 及其引用的图片。每行有 `id`、`file`、`alt`，可带 `caption` 和 `owner`。`file` 是目录内的相对路径。只有 `business_data.image` 含 `assetId`、`id` 或 `src` 的调用才读取目录，然后发送 `image.src`、`image.alt` 和 `image.caption`。`src` 为 `/api/media/<id>/content`，id 原样保留。不会发送磁盘路径、令牌、`component` 或 `type`。含 `owner` 的行仅在其与 `mediaOwner` 或 `JSON_RENDER_MEDIA_OWNER` 相等时可见；无 `owner` 的行由已认证操作者共享。未知图片在请求渲染前被拒绝。

设置 `mediaRoot` 且存在 Web 服务时，插件在页面同源注册 `GET /api/media/<id>/content`。读取文件前，连接服务应用与其他 `/api` 路由相同的登录 Cookie 及 Host/Origin 校验。响应为图片字节和图片 `Content-Type`，或简短的文字状态。PNG、JPEG、GIF、WebP 只有在扩展名与开头字节一致时才被接受。处理器解析真实路径，拒绝目录穿越和离开目录的链接，且不接受查询字符串中的路径。`/api/file` 仍是独立的认证文件路由，不是 Image 的 `src`。已将 `/api` 代理到本宿主的部署覆盖此媒体路径；前后端异源部署须将 `GET /api/media/` 代理到同一宿主，使浏览器能发送登录 Cookie。不要将 bearer token 放入 URL。

json-render 服务须已运行 v0.2.8，与安装的 `@eit/json-render-*` 包版本一致。本包调用 `POST /v1/render`，发送 `format` 为 `json-render-v1`、`user_query`、`business_data`、可选 `prompt_mode`（`full` 或 `progressive`），以及 `context.locale` / `context.intent`。不会发送 `mode`、`profile`、`catalog` 或 `framework`。普通展示省略 `intent` 以使用 base；`generic_filters` 和 `generic_pick_one` 选择表单目录。在 `components` 中列出 `Image`、`ImageUpload`、`Tabs`、`MapPreview`、`SortableSequence`、`Collapsible`、`CodeBlock` 或 `Workflow`，会为整页选择 `rich_content`，并将请求的组件名加入 `user_query`。直接调用 Generation SDK 时，使用 `baseRenderProfile`、`formsRenderProfile` 或 `richRenderProfile` 做同样选择，不复用 HTTP 字段。图片调用发送 `context.intent` 为 `rich_content`、`context.locale` 为 `zh-CN`。`image.src` 原样取自已存入 `business_data` 的目录路径，不加域名或编码。`ImageUpload` 只指定 `uploadTarget`。

展示调用默认使用 `answer_presentation: replace`，界面须包含完整答案。必要解释留在文字中时使用 `supplement`。模型仍生成完整的文字兜底，浏览器依据持久化结果元数据选择可见答案。表单始终作为补充。失败调用不会声明替换。

没有 `form_actions` 时，宿主保留可触达且启用的 `form.submit` Button，缺失时按 `submit_label` 补齐（默认“提交”）。仅在用户明确不要提交时设置 `submit_button=false`，这会禁用宿主补齐并要求服务省略默认按钮。这些选项不是服务 API 字段。

表单需要多个操作时，按展示顺序传入完整的 `form_actions` 列表，每个按钮填写唯一的 `intent` 和非空 `label`。支持 `submit`、`save_draft`、`reset`、`skip`、`cancel`、`submit_and_add`。列表覆盖 `submit_button` 与 `submit_label`；需要确认时须包含 `submit`。宿主移除服务生成的 Button，保留字段与链接，并添加声明的并列动作栏；同时要求服务不要生成 Button 或操作选择字段。仅布局说明发给渲染服务，`form_actions` 是宿主选项。按钮通过 `form.submit` 收集当前值，并附带 `{ form_action: { intent, label } }`；不会在本地重置字段或执行业务。须部署配套客户端，才能把意图与值一起交给 Agent。空列表、重复意图、空文案或在展示模式使用会在 HTTP 请求前被拒绝。省略此参数保留已有默认单提交行为。

<a id="model-experience"></a>
## 模型体验

### render_ui

#### 模型看到的内容

工具说明为配置的 `description`，或提及 `render_ui`、`display`、`form`、`business_data`、`generic_filters`、`generic_pick_one`、`rich_content`、`components`、`Image`、`assetId`、`ask_user_question` 的默认说明。展示和表单都需要包含详细事实的 `business_data`。图片使用 `business_data.image.assetId`，不编造 URL。成功结果是一句“界面已附上”，不包含 payload。兼容服务的生成校验失败返回结构化 `error`，包含错误码、requestId、stage 和字段 issues。解析失败保留 `rawOutput`；校验失败还保留被拒绝的 `invalidPayload`。原生结果附加这些诊断 JSON 供纠错，并保存到 `renderFailure` 元数据；被拒绝的数据不是成功 UI payload，不能渲染。模型可做一次修正调用或继续文字回答，不得重复相同请求或向用户暴露诊断 JSON。其他失败要求继续文字回答或补充事实。成功 payload 与服务 profile 只保存为结果元数据。调试模式记录 `format`、`intent`、`prompt_mode`、错误 `code`、`requestId` 和安全诊断，省略提示词、业务数据、秘密及资源地址。

#### Token 影响

每个继承 `render_ui` 的 Agent 增加一个工具 schema。启用挂载会将完整的随包 Skill 正文和三份参考文档加入普通系统提示，即使最终只用文字或原生提问；不会单独调用 Skill 加载。成功结果只增加不含界面 JSON 的短句。失败诊断包含被拒绝的输出，因此会相应增加结果 token。

#### KV Cache 影响

工具说明与共享指引在挂载期间固定。更新随包指引会在重新挂载或重启后改变提示前缀。结果短句扩展对话，不改写该前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 服务须单独启动 v0.2.8，本工具不会启动它。旧服务没有 `rich_content` 目录，Image 及其他富组件会生成失败。
- 只有 `mediaRoot` 或 `JSON_RENDER_MEDIA_ROOT` 指向绝对目录时才挂载图片路由。内置 Web profile 的页面和 API 同源；分离前端须携带登录 Cookie 代理 `GET /api/media/`。图片加载失败留在浏览器中。
- 表单选项为 `generic_filters` 和 `generic_pick_one`。富布局使用 `rich_content`，已包含基础及表单组件。
- 程序化工具调用接收包含成功 payload 或结构化失败的完整结果；原生函数调用接收短句和可用的失败诊断 JSON。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者说明</summary>

无。

</details>
