---
name: process-summary
description: 用户要求记住或总结一个固定流程、步骤时使用：用 render 的 Workflow 把流程渲染出来，请他确认；用户改流程或步骤后再重新渲染；直到他确认。
---

# 流程总结

## 什么时候用

用户要把一件事的做法记下来、或者让你总结步骤（「记住这个流程」「以后按这个来」「把步骤列一下」）时用。

## 怎么排

- 从用户的话里拆出按顺序的步骤，一步一行，不合并、不跳步；用户没说的不要补。
- 有条件判断的（「如果老师在就领，不在就通知我」）用 `condition` + 分支，不要拆成两串并列步骤。
- 条件、时间、负责人这类信息写进对应步骤的标题或说明。
- 用户没给顺序、又分不出先后时，先问一句再排。

## 渲染

- `mode` 用 `display`，`components` 用 `["Workflow"]`，`intent` 用 `rich_content`，`locale` 用 `zh-CN`，`prompt_mode` 用 `full`
- `answer_presentation` 用 `supplement`（旁边还要问确认）
- `business_data`：

```json
{"workflow":{"version":"workflow-v1","id":"<英文短名>","title":"<流程名>","steps":[
  {"id":"s1","type":"step","title":"<步骤>"},
  {"id":"s2","type":"condition","title":"<判断>","branches":[
    {"id":"b1","label":"<条件一>","steps":[{"id":"s2a","type":"step","title":"<步骤>"}]},
    {"id":"b2","label":"<条件二>","steps":[{"id":"s2b","type":"step","title":"<步骤>"}]}
  ]},
  {"id":"s3","type":"step","title":"<步骤>"}
]}}
```

- 普通步骤用 `type:"step"`；判断用 `type:"condition"`，至少两个 `branches`，每个分支里再放步骤。分支走完自动汇合，继续外层后面的步骤。
- 文档要保持 `workflow-v1` 的原始结构：`id` 唯一、判断至少两个分支、分支里的步骤放在 `branches[].steps`；不要加 `nodes`、`edges`、坐标或额外的汇合节点——分支会自动汇合。文档不合法时组件会直接提示「流程数据无效」。
- `user_query` 用固定写法：

> 使用 Workflow 编辑 business_data.workflow。将文档初始化到 /_ui/workflow，value 使用 {"$bindState":"/_ui/workflow"}，组件 mode="edit"。分支自动汇合后继续后面的步骤。不增加 nodes、edges、坐标或独立汇合节点。不要用 CodeBlock、Steps 或表格替代。

渲染后一句话问「流程对吗？要改直接说」。

## 用户要改

加步骤、删步骤、改判断或分支、改顺序，都按新内容重新渲染同一个 Workflow，保留没改的部分，别只回文字；改完再问一次。

## 确认之后

- 用户说「对」「可以」「就这样」：确认这份流程，回一句「好，按这个走」。
- 这次确认只保存在对话里；没有可用的长期记忆工具，用户要长期保存时说明需要他那边保存，不谎称已经存到系统里。
- 后面用户说「按刚才的流程做」时，按这份步骤来；每一步涉及动作的，走对应技能。

## 注意

- 渲染只是展示流程，不代表执行。
- 步骤以用户为准，不要自己加戏。
- 不要用 CodeBlock、Steps 或表格替代 Workflow。
