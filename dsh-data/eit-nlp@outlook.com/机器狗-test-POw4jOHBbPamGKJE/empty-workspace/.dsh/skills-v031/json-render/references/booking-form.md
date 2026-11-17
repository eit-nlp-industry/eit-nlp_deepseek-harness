# 通用预约草稿（确定性）

出或更新**场地 / 访客预约**草稿时用本文件。字段 `key` 与提交流程对齐。

不负责：询问须知、真正提交（由 `errands` 提交档调 `submit_booking`）。

宿主只收集 `/form/<key>` 下的值，且 DynamicForm 的 select 从 `value.options` 读候选项。所以本配方固定为：**一个 Collapsible，折叠内容里必须同时有「一个 DynamicForm」和「一个提交 Button」**（DynamicForm 只管字段，**不会**自带提交键；少了 Button 草稿就无法点提交）。不要拆成零散控件或绑到 `/_ui`、`/fields`（否则界面有值、提交却是 `{}`，或下拉 No data）。

访校往往不止一小时，时段拆成**开始时间**与**结束时间**两个下拉，不要再用单一的 `16:00-17:00` 档。

## 固定字段

| key | 含义 | 必填 | 说明 |
|-----|------|------|------|
| `venue` | 场地 | 是 | 如「校园访客」「图书馆研讨室」「四明书院」 |
| `date` | 日期 | 是 | 如 `2026-11-21` |
| `start` | 开始时间 | 是 | 整点下拉；见下 |
| `end` | 结束时间 | 是 | 整点下拉；须晚于 `start` |
| `people` | 人数 | 否 | 数字 |
| `note` | 用途 / 备注 | 否 | 行程、不去馆等计划细节 |
| `name` | 预约人姓名 | 否 | 未知留空，不编造 |
| `phone` | 联系电话 | 否 | 未知留空，不编造 |

已知值写入字段；未知不填、不猜。

`start` / `end` 只在用户说出**具体钟点**时预填（如「16 点到、18 点走」→ start `16:00`、end `18:00`）。只说了到校时间则只预填 `start`，`end` 留空。仅有「上午 / 下午」时两个都留空。

### 起止候选项（早 9～晚 6，整点）

- **开始** `start`：`09:00`、`10:00`、`11:00`、`12:00`、`13:00`、`14:00`、`15:00`、`16:00`、`17:00`
- **结束** `end`：`10:00`、`11:00`、`12:00`、`13:00`、`14:00`、`15:00`、`16:00`、`17:00`、`18:00`

写入各自的 `value.options`。结束必须晚于开始（跨至少 1 小时）。失败改约时若工具返回 `alternatives`，用返回的 `start`/`end` 建议预填或收窄选项；其余情况用完整列表。

## render_ui 参数

- `mode`: `form`；`intent`: `generic_filters`
- `components`: **只能** `["Collapsible"]`  
  （`DynamicForm` / `Button` **不能**写进 `components`：工具枚举里没有这两项，写了会直接参数校验失败。它们由生成器在 Collapsible 内容里画出，靠 `business_data` + `user_query` 要求，不要点名进 `components`。）
- `answer_presentation`: `supplement`；`locale`: `zh-CN`

### business_data

只替换 `title` 与已知字段值；`start` / `end` 的 `value` 必须是 `{ default, options }`（options 在 value 内）：

```json
{
  "title": "<日期或事由> 预约草稿",
  "defaultOpen": false,
  "submitLabel": "确认后提交预约",
  "fields": [
    { "key": "venue", "label": "场地", "type": "input", "value": "<已知或空>" },
    { "key": "date", "label": "日期", "type": "date", "value": "<已知或空>" },
    {
      "key": "start",
      "label": "开始时间",
      "type": "select",
      "value": {
        "default": "<仅具体钟点时填，否则空字符串>",
        "options": [
          { "label": "09:00", "value": "09:00" },
          { "label": "10:00", "value": "10:00" },
          { "label": "11:00", "value": "11:00" },
          { "label": "12:00", "value": "12:00" },
          { "label": "13:00", "value": "13:00" },
          { "label": "14:00", "value": "14:00" },
          { "label": "15:00", "value": "15:00" },
          { "label": "16:00", "value": "16:00" },
          { "label": "17:00", "value": "17:00" }
        ]
      }
    },
    {
      "key": "end",
      "label": "结束时间",
      "type": "select",
      "value": {
        "default": "<仅具体钟点时填，否则空字符串>",
        "options": [
          { "label": "10:00", "value": "10:00" },
          { "label": "11:00", "value": "11:00" },
          { "label": "12:00", "value": "12:00" },
          { "label": "13:00", "value": "13:00" },
          { "label": "14:00", "value": "14:00" },
          { "label": "15:00", "value": "15:00" },
          { "label": "16:00", "value": "16:00" },
          { "label": "17:00", "value": "17:00" },
          { "label": "18:00", "value": "18:00" }
        ]
      }
    },
    { "key": "people", "label": "人数", "type": "input", "value": "<已知或空>" },
    { "key": "note", "label": "备注", "type": "input", "value": "<已知或空>" },
    { "key": "name", "label": "姓名", "type": "input", "value": "<已知或空>" },
    { "key": "phone", "label": "电话", "type": "input", "value": "<已知或空>" }
  ]
}
```

### 提交按钮（必有，与 DynamicForm 并列）

折叠内容顺序：先 `DynamicForm`，再一个 `Button`。宿主**只认**事件名 `form.submit`；其它名字会点了没反应。`Button` 必须带 `on.press`，不能只有文案。

整段照抄（`label` 可用 `submitLabel`）：

```json
{
  "type": "Button",
  "props": { "label": "确认后提交预约" },
  "on": {
    "press": { "action": "form.submit" }
  }
}
```

也允许：

```json
"press": { "action": "form.submit", "params": { "eventName": "form.submit" } }
```

禁止：省略 `on` / `on.press`；`emit.event`；`params.eventName` 写成非 `form.submit` 的任何字符串。

点后应出现「已提交，等待继续回答」；回传后由 `errands` 提交档调 `submit_booking`。

### user_query（末尾原样追加）

> 根节点只渲染一个 Collapsible。折叠内容必须有一个 DynamicForm 和一个 Button。时段拆成 start（开始时间）与 end（结束时间）两个 select，各自 value 为 {default, options}；禁止再用单一的 16:00-17:00 时段字段。结束须晚于开始。Button 必须是 {"type":"Button","props":{"label":"<submitLabel>"},"on":{"press":{"action":"form.submit"}}}。禁止没有 on.press，禁止 emit.event，禁止自定义 eventName。页面不要再生成说明文字或折叠规则文案。

## 书面总结

`mode: form` 成功会结束本轮。先在聊天写一两句业务要点，再 `render_ui`；界面内不要再写说明。

示例：

> 已按你说的周六整理访客预约草稿：16 点到校、计划逛到晚饭前后，3 人、本人陪同、不进图书馆。开始/结束时间请在草稿里确认。

## 提交对齐

用户确认或表单回传后，由 `errands` 调用 `submit_booking`。必传 `campus_visit`：**访校 / 校园访客预约为 `true`（演示一律成功）**，其它场地为 `false`（按工具概率成败）。回传缺 `start`/`end` 或结束不晚于开始时，回到起草说明并重出草稿。失败且带 `alternatives` 时：用返回的起止建议更新草稿后再确认；转告成败以工具原文为准。
