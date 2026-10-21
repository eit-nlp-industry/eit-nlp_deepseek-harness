---
description: "在浏览器中渲染 render_ui 结果，并将表单提交发送回会话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-json-render

[English](README.md) | 中文

## 概述

将最新的成功 `render_ui` 结果作为最终答案展示，或与文字一起展示。后续渲染失败时，移除先前卡片并保留文字回答。工具行保留简短状态。表单提交会排队成为下一条用户消息。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将本包加入 Web 客户端组合。声明 `answer_presentation: replace` 的成功展示结果会替换已完成的收尾回答；该回答须包含一个文本块，并可附带推理块。结果缺失、格式无效、组件不受支持或调用失败时，保留文字回答。渲染异常时恢复原始 Markdown 及其链接和操作控件。文字回答仍保存在会话中，供复制和导出。补充展示、表单、未显式声明展示方式的历史结果，以及包含其他块布局的回答，显示在文字下方。工具行只报告状态。

渲染器将 Ant Design CSS 变量映射到宿主的语义主题变量。每个结果都有圆角和轻阴影容器，包括以 Stack 或 DynamicForm 为根的布局；根 Card 或带边框的 Section 共用该容器，不叠加第二层外框。卡片、表格、指标、步骤、提示和表单控件跟随宿主的明暗配色与字体设置。表单标签位于控件上方；字段保留自然高度，卡片内容有明确间距。下拉面板保留在主题容器内，宽表格独立滚动。窄屏下网格改为单列；减少动态效果的系统偏好会禁用局部动画。样式仅作用于本渲染器，无需修改已保存的界面数据或渲染服务。

<a id="model-experience"></a>
## 模型体验

通过宿主的 `render_ui` 工具间接影响模型；模型可见的文本由该工具拥有。

#### KV Cache effect

工具行仅读取已记录的工具结果，不改变提示词前缀。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- 工具行渲染稳定的基础与表单组件目录。当前服务不会生成知识库业务组件。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
