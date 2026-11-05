---
description: "在浏览器中渲染 render_ui 结果，并将表单、流程和路线排序确认发送回会话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-json-render

[English](README.md) | 中文

## 概述

将最新的成功 `render_ui` 结果作为最终答案展示，或与文字一起展示。后续渲染失败时，移除先前卡片并保留文字回答。工具行保留简短状态。表单提交、流程保存或应用路线排序会排队成为下一条用户消息。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将本包加入 Web 客户端组合。声明 `answer_presentation: replace` 的成功展示结果会替换已完成的收尾回答；该回答须包含一个文本块，并可附带推理块。结果缺失、格式无效、组件不受支持或调用失败时，保留文字回答。渲染异常时恢复原始 Markdown 及其链接和操作控件。文字回答仍保存在会话中，供复制和导出。补充展示、表单、未显式声明展示方式的历史结果，以及包含其他块布局的回答，显示在文字下方。工具行只报告状态。

基础和表单结果使用稳定的 Ant Design registry。rich 的 profile diagnostic 使用公开的 experimental registry，其中包含 Image、ImageUpload 和 Workflow。Workflow 支持本地编辑和撤销/重做。workflow.save 将编辑后的流程和参数整理为中文提纲，作为用户消息排队发送，并请 Agent 在下一条回复中渲染更新后的可编辑 Workflow。对话气泡只显示提交确认。route.order.apply 将提交的 ID 顺序与原始 payload 或该次调用 business_data 中的完整条目一起排队发送。workflow.change、workflow.select 和 route.order.change 不发送。保存或应用正在进行时，再次点击会被忽略；失败后编辑结果仍留在界面上，可以重试。workflow.execute 仍不接入，刷新后不保留编辑。上传目标来自宿主 adapter；payload 只写 `uploadTarget`。Vue 宿主使用同一 v0.2.0-rc.6 版本的 Vue adapter，而不是这些 React 组件。渲染器将 Ant Design CSS 变量映射到宿主的语义主题变量。包含 Image 或 Workflow 元素的结果没有外层背景、边框或内边距。内容区仅含一个 Image 的 Card 和带边框的 Section 也不显示外框和水平内边距，并保留标题。其他结果使用圆角和轻阴影容器；根 Card 或带边框的 Section 共用该容器，不叠加第二层外框。TabContent 的直接子 Card 和带边框的 Section 也不显示外框。Tab 内的网格若将 Text 与 Card 或带边框的 Section 作为直接子项混排，则按数据顺序使用单列；纯卡片网格保留原有列数。卡片、表格、指标、步骤、提示和表单控件跟随宿主的明暗配色与字体设置。表单标签位于控件上方；字段保留自然高度，卡片内容有明确间距。下拉面板保留在主题容器内，宽表格独立滚动。窄屏下网格改为单列；减少动态效果的系统偏好会禁用局部动画。样式仅作用于本渲染器，无需修改已保存的界面数据或渲染服务。

<a id="model-experience"></a>
## 模型体验

通过宿主的 `render_ui` 工具间接影响模型。确认后的表单、流程和路线排序作为下一条用户消息排队，不作为系统指令。

#### KV Cache effect

工具行仅读取已记录的工具结果，不改变提示词前缀。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- 当前服务不会生成知识库业务组件。相对 Image `src` 使用页面源上的 `/api/media/<资源 ID>/content`。浏览器携带登录 cookie 加载该地址，不发送 Authorization。图片请求失败不会再次调用渲染服务。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
