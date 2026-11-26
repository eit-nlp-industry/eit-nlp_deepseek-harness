# 按钮预设、回传与宿主支持

生成带操作按钮的表单时应用。本文件说明DSH的form_actions及已有事件；不增加业务执行权限。

## 独立按钮优先

用户要求多个操作时，使用render_ui的form_actions声明完整动作栏，按用户要求的顺序填写intent和label。DSH保留表单内容与链接，移除服务生成的Button，再统一添加每个声明对应的独立Button；按钮与主提交同级排列，窄屏可换行。不要让服务生成操作Select/Radio，也不要只声明一个默认提交而省略其他入口。未指定额外操作时可以省略form_actions，保留默认单提交。

form_actions仅用于mode=form，是完整列表，覆盖submit_button与submit_label；需要确认时须在列表中包含submit。每个intent只出现一次，label必须非空且忠实于职责。当前支持以下意图；它们统一交给Agent处理，不是各自的事件名或真实业务API。

|intent|文案示例|Agent收到后的职责|
|---|---|---|
|submit|确认草稿、提交申请|核对当前值，并按用户授权处理|
|save_draft|保存草稿|按明确的保存范围与实际可用能力保存；对话内接收不称永久存储|
|reset|恢复初始内容|先接收用户改后的当前草稿，再依据可靠初始快照生成恢复后的草稿；不先本地清空或恢复|
|skip|跳过本条|跳过明确范围，保留当前已知草稿；不表示确认、完成或取消整个业务|
|cancel|放弃当前草稿|处理这份未提交草稿；不推定撤销真实业务|
|submit_and_add|提交并继续新增|先处理本条，达到用户所需的接收/保存状态后再生成下一份草稿；不以只写“新增”的按钮隐含提交|

“恢复初始”与“清空本条”不同；初始值丢失时澄清，不猜测。纯本地增加条目、字段编辑、展开和页签切换不必唤起Agent，不冒充上述意图。查看详情/打开规则优先使用已有可信目标的Link，或在文字中给Markdown链接；Link在当前渲染目录不可用时使用文字链接。不要把导航塞进form_actions，也不为导航误提交草稿。

## 调用示例

完整业务字段放在business_data。下面仅演示render_ui参数中的动作列表，不是最终UI spec：

```json
{
  "mode": "form",
  "intent": "generic_filters",
  "user_query": "生成可编辑的活动物资草稿。只生成业务字段和说明，不生成操作选择字段或按钮；动作栏由宿主按form_actions添加。",
  "business_data": {
    "fields": [
      {"type": "inputNumber", "key": "quantity", "label": "数量", "value": 20},
      {"type": "input", "key": "contact", "label": "联系人", "value": "林晓"}
    ]
  },
  "form_actions": [
    {"intent": "reset", "label": "恢复初始内容"},
    {"intent": "submit", "label": "确认草稿"},
    {"intent": "skip", "label": "跳过本条"}
  ]
}
```

动作列表是宿主参数，不另传给渲染服务。布局说明要求只生成表单内容与必要链接，不生成Button、操作选择字段或本地重置逻辑。宿主直接组装动作栏，不需要内层模型猜测按钮事件，也不需要在business_data中增加虚构的业务操作字段。

## 意图与当前值一起回传

每个宿主按钮都绑定on.press action=form.submit，params.extra.form_action携带该按钮的固定{intent,label}。运行时自动收集当前/form数据，无需在extra里手动拼当前值。DSH将form_action和payload.form一起转成下一轮用户消息；意图与文案保持独立于业务字段。不要使用extra.form覆盖收集结果，也不要把初始business_data当作点击时的值。

例如，初始20把/林晓被用户改成30把/陈晨后点击“恢复初始内容”，事件是：

```json
{
  "event": {"name": "form.submit", "type": "submit"},
  "payload": {
    "form": {"quantity": 30, "contact": "陈晨"},
    "form_action": {"intent": "reset", "label": "恢复初始内容"}
  }
}
```

Agent先确认收到reset及30把/陈晨，再从原始可靠来源恢复为20把/林晓；收到事件前不宣称恢复完成。初始快照及恢复范围来自用户材料/可靠上下文，不因按钮存在而自动持久化。附件和对象关联须保留在当前表单值或可靠上下文中。跳过、重置、放弃允许回传不完整草稿，业务提交所需完整性由Agent按实际意图判断；不造必填值、不把发送数据等同于批准业务。

发送中不重复处理同卡片点击；发送失败保留编辑，可重试。发送成功等待Agent继续，Agent按实际意图生成后续草稿或结果。保存、取消或业务提交是否成功取自真实业务回执；仅在对话演示时明确是草稿处理。

## 旧表单与降级

没有form_actions的旧表单继续使用默认提交；宿主只保证缺失的默认Button被补齐，不保证任意自定义按钮已接通。Button文案不是动作协议，on.press是绑定位置；不要自造form.reset、form.confirm、form.skip或link.open等事件。当前DSH续接form.submit、workflow.save和route.order.apply；form.cancel或其他事件不自动等于Agent收到取消。多个按钮共用form.submit不受事件名数量限制。

仅在当前工具schema缺少form_actions，或明确的不支持/校验失败无法修正时，才采用“操作选择字段+一个提交按钮”或原生选择。说明限制并保留全部必需意图；成功表单会结束回合时，替代说明也要进入可见界面。旧兼容方案的action_choice放进payload.form内；任意外层字段不会自动转发。新通路仅明确识别form_action，不默认转发所有extra字段。

不要用emit.event在嵌套payload.form内拼$state来替代宿主动作栏：当前参数解析只处理顶层状态引用，不保证嵌套引用得到当前值。没有工具返回或点击证据时，不声称每个按钮已实际验证。

源码位置：packages/json-render/tool-json-render/src/form-actions.ts（动作清单与组装）、src/request.ts（请求与默认提交）、packages/client/ui-json-render/src/client/submit.ts（意图与值转发）、JsonRenderCard.tsx（发送与反馈）。
