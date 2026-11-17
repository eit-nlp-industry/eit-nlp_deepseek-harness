---
name: json-render
description: 需要在聊天里用 render_ui 出图、卡片、地图或表单草稿时加载。知识库配图仅在图有助于回答时出（介绍外观/多主题带图等）；chunk 里顺带有图片链接但问题只需文字事实（如开放时间）时不要出图。其它 Skill 只声明要展示的内容；参数与配方以本 Skill 为准。表单一律 Collapsible 草稿；须先写聊天业务短总结再调 render_ui，勿复述折叠规则。
---

# JSON Render

把图片或结构化内容交给用户看、确认时，用 `render_ui`。其它 Skill 说明展示意图；**怎么调、参数怎么填，以本 Skill 与下方按需细则为准。**

## 原则

1. **公共字段**：`locale` 用 `zh-CN`；展示类 `intent` 用 `rich_content`，表单用 `generic_filters`；现场相关 `scene` 用 `dog`，校园资料用 `kb`。组件 props 必须是 `business_data` 里的固定字符串。
2. **知识库配图（按需，非见链就出）**：只有图**有助于回答**时才 `render_ui` 出图——例如介绍某处长什么样、多地点/多主题导览且各项有配图。一张用 `image`，多张或多主题带图用 `tabs`。若用户只问文字事实（几点开门、几点晚饭、能不能进、要不要预约等），即使 chunk 里顺带有图片链接，也**只用文字答**，不要为链接强制出图。如何解析 `asset_id` 见 `assets`。
3. **先写聊天业务总结，再出界面**：一两句结论或进度（到哪、看到什么、办什么等），再调 `render_ui`。聊天总结与界面内容分工：总结留在对话里；单图界面默认不要再塞 `title`/`reason`（见 `image`）。不要只出图不说话，也不要只剩空卡片。`mode: form` 成功会结束本轮，调用后再写无效。
4. **收集信息的表单**：`mode: form`、`components: ["Collapsible"]`、`defaultOpen: false`。整份界面只能有一个 Collapsible（标题用 `title`）；禁止在它外面再生成 Text / 标题 / 操作说明。字段与提交按钮只在折叠内容里，优先一个 `DynamicForm`（值须在 `/form` 下，否则提交为空）。预约 / 改约再读确定性字段细则。
5. **提交按钮**：必须是带 `on.press` 的 `Button`；`press.action` 为字面量 `form.submit`（若写 `params.eventName` 也只能是 `"form.submit"`）。只有文案、没有 `on.press`，或 `emit.event` / 自定义名，都会点了没反应。预约细则有可照抄片段。
6. **现成参数**：工具结果若带完整 `render_ui_args`，原样传给 `render_ui`，不要重拼。
7. **失败**：渲染未成功时用文字说清要点；图片未出现时如实说明。

## 按需细则

相关时再读（细则可随模型变强整文件删掉）：

- 取图与 `asset_id`：[references/assets.md](references/assets.md)
- 单图（默认纯图；现场依据帧不要 title/reason）：[references/image.md](references/image.md)
- 多信息点 / 多图 Tabs：[references/tabs.md](references/tabs.md)
- 实时地图（仅 `navigate` 前）：[references/map-preview.md](references/map-preview.md)
- **通用预约草稿（确定性字段）**：[references/booking-form.md](references/booking-form.md)
