# render_ui / json-render 改进建议（开发交接稿）

作者：使用者侧反馈（通过一个校园场景的连续实验得出，不是代码评审）。
目的：给后续接手的人一份可复现、可判断优先级的材料。每条都写了背景、复现方式、证据、影响和建议，**已确认**和**推测**分开标注。

---

## 0. 环境与版本

| 项 | 值 |
| --- | --- |
| DSH checkout | `/opt/deepseek-harness` |
| `@deepseek-ai/dsh-tool-json-render` | 0.2.1-alpha.2 |
| `@deepseek-ai/dsh-client-ui-json-render` | 0.2.1-alpha.2 |
| `@eit/json-render-catalog` | 0.2.0（base/forms 标注 stable，rich 走 experimental） |
| 渲染服务 | `JSON_RENDER_BASE_URL=http://10.37.0.21:3001`（README 要求 v0.2.3） |
| 运行 profile / preset | `n8n-web`；会话 preset 用过 `campus` 与 `standard` |
| 挂载点 | `packages/bundle/base/cordis.patch.yml:500` 的 `tool-json-render`，宿主级、所有 preset 继承 |
| 关键源码 | `packages/client/ui-json-render/src/client/submit.ts`、`JsonRenderCard.tsx` |

实验方式：写 7 个 skill（`.dsh/skills/`），用校园场景跑多轮（订房、奶茶、车票、接驳车、排课、邮件、余额定时），观察卡片行为。

---

## 1. 表单的「确定」按钮会消失（P0）

**背景**：所有 skill 都依赖 `render_ui` 的 `mode: form` 收值。用户在新会话里遇到“选项能选，但没有确定按钮，只能打字回复”。

**复现**：任意 `mode: form` + `intent: generic_pick_one` 的调用，观察底部是否总有提交按钮。同一份 business_data 重跑，按钮时有时无。

**已确认的事实**：提交按钮不是固定控件，而是生成 payload 里的一个 Button（`on.press` → `form.submit`）。客户端 `submit.ts` 只处理收到的事件（`decideJsonRenderSubmit`），不会补按钮。所以生成器漏掉按钮时，表单就是不能提交的死卡。

**推测**：生成概率性遗漏，与 business_data 的形状、选项数量相关（选项多、字段杂乱时更容易漏）。

**影响**：skill 层只能写“没按钮就直接回编号”的降级规则，体验断裂。

**建议**：渲染端对 `DynamicForm` 兜底注入一个 submit 按钮；或 forms profile 的初始 state 固定提供 `form.submit` 动作。

**验收**：任何 form 卡片都必须有且只有一个提交按钮。

---

## 2. `MapPreview` 基本不可用，且失败不做降级（P0）

**背景**：接驳车场景想要“地图 + 车辆位置 + 用户位置 + 预计时间”。

**复现**：`mode: display`，`components: ["MapPreview"]`，business_data 给 5 个站点（x=10/30/50/70/90, y=50）、两辆车（x=63,y=45；x=55,y=55）、用户位置。

**现象**：连续 3 次 `MODEL_OUTPUT_INVALID`，整张卡不生成。改成纯字段卡后一次成功。

**推测**：rich catalog 的 `validateCatalogPayload` 对 `places/route` 的坐标结构、唯一 ID、数量校验很严，business_data 里的 `x/y` 需要映射成 `position`，生成器经常猜错；失败后没有局部降级，直接整卡作废。

**影响**：地图类需求只能退回文本列表；每次失败还要消耗 2–3 次生成时间。

**建议**：
- 给出可复制的 `MapPreview` 最小示例（字段名、坐标范围、数量上限）。
- 坐标缺失时自动布局（按顺序横排），而不是校验失败。
- 失败时降级为 `Steps` / 列表，保留信息。

**验收**：同一份 business_data 至少能稳定产出降级卡。

---

## 3. 生成失败信息不可诊断（P0）

**现象**：只返回 `MODEL_OUTPUT_INVALID` 或 `INTERNAL_ERROR: Internal server error`，连续 3 次后工具让模型“改用文字”。模型不知道哪个字段不合法，只能盲目重试。

**影响**：模型无法自我修正；对用户表现为“卡片突然变成一段文字”。

**建议**：失败时回传校验路径与原因（如 `places[2].position: expected number`），并给模型一次带诊断的重试机会。工具层保留错误码，界面不展示给用户。

**验收**：模型能根据诊断修一次 payload 并成功。

---

## 4. 多字段表单缺失（P1）

**背景**：选讨论室需要「房间 + 人数 + 时段」；点奶茶需要「糖度 + 冰量 + 备注」。现在只能一卡一字段，串成 3–4 轮。

**已确认**：`@eit/json-render-catalog` 里 `DynamicForm / FormField / Input / InputNumber / DateInput / DateRange / Select / Checkbox / Switch / ChoiceGroup / TextArea` 都在；但 `render_ui` 只开放 `generic_filters` 与 `generic_pick_one` 两个意图。

**建议**：新增 `intent: generic_form`，business_data 声明 `fields: [{name, type, options?, required?}]`；提交回传结构化对象。

**验收**：一次提交回传 `{"room":"B 馆 208","people":6,"slot":"19:00-21:00"}`，模型无需再问。

**注意**：这与“一轮一张卡”的现状叠加，会让多轮更短但更依赖单卡能力，建议和 #6 一起做。

---

## 5. 提交回传是带 UI 文案的字符串（P1）

**已确认**：本会话收到的提交内容是 `{"selected_id":"B 馆 208 · 研讨间"}`、`{"selected_option":"5 杯半糖少冰：最稳的搭配，不齁不凉"}`。值和展示文案混在一起。

**影响**：skill 只能按字符串匹配，改文案就断；多字段时无法解析。

**建议**：回传 `{id, label}` 分离的 JSON；多选回传数组；多字段回传对象。保留旧字段做兼容。

**验收**：skill 用 id 判断分支，不依赖中文文案。

---

## 6. 一轮只能显示一张卡（P1）

**已确认（用户侧）**：同一轮出多张卡时只显示最后一张。

**推断**：客户端按“最新一次成功渲染结果”展示（README 写的是保留 latest successful result），历史卡被替换。

**影响**：本轮我们被迫在 7 个 skill 里写“一回合一张卡 + 交互拆轮 + 展示合并”，并付出了轮次成本（两封邮件从 1 轮变 3 轮）。

**建议**：一轮 payload 支持卡数组纵向排列；或保留历史卡，按 message id 存。

**验收**：一轮两张卡同时可见，滚动能看全。

---

## 7. 卡片不持久（P1）

**背景**：日程、余额这类卡片，用户会回头翻。

**现象**：刷新页面卡片消失，只剩文字。

**建议**：按 message id 持久化 payload，重放会话时还原；或缓存 business_data → payload 的渲染结果。

---

## 8. 定时任务无法真正静默（P2）

**背景**：校园卡 12:00 / 17:00 检查，要求“余额 ≥ 20 时什么都不发”。

**已确认**：`schedule_*` 的投递是一条 user message 进入会话，因此这一轮必然可见；模型只能做到“不产出内容”，做不到“不留痕”。

**建议**：schedule 增加 `silent` 选项，或空输出不落 user-visible message（但保留审计记录）。

**验收**：余额充足时，会话里不出现任何痕迹。

---

## 9. 无法判断模型是否真的用了 skill / 工具（P2）

**背景**：另一个会话里模型读了 skill，但整轮只用文字、耗时 4 秒（render_ui 一次通常十几秒），用户无法确认卡片流程是否执行。

**建议**：每轮记录使用过的工具（skill 名、render_ui 次数、耗时），在工具行或详情里可见。

**价值**：这是排障的第一步，也方便给 skill 做回归。

---

## 10. 生成延迟与重复渲染（P2）

**背景**：每次卡片 10–40 秒；同一份 business_data 反复生成（刷新、重放、重试）。

**建议**：按 `business_data + profile + locale` 哈希缓存；或允许调用方直接提交已验证的 payload（skill 声明“模板卡”）。

---

## 11. 卡片配方（模板）缺失（P2）

**背景**：结构由模型自由生成，方差大（同一需求有时表格、有时列表、有时缺字段）。

**建议**：提供模板 id（时间块表、邮件草稿、路线列表、余额提醒），模型只填字段。等价于把“生成结构”的不确定性关掉。

---

## 12. skill 缺少回归评估（P2）

**背景**：skill 是自然语言，改一句话就改行为，目前无回归保障。我们这次就是靠人工跑多轮才发现“模型跳过卡片”。

**建议**：每个 skill 配一份验收清单（输入提示词 → 期望卡片字段），跑一遍给分。仓库里 `story-script.md` 可作为样例：8 轮、每轮列了应出现的字段和验收点。

---

## 附：三条一次性看到全部问题的复现路径

1. 用 `mode: form` 出 4 选项单选卡，看有没有确定按钮；
2. 用 `components: ["MapPreview"]` 出接驳车卡，看是否 3 次失败；
3. 同一轮调两次 `render_ui`，看是否只剩最后一张。

前两条在 2026-11-16 ~ 11-18 的实验里各复现过 1–3 次，第三条来自用户实测。
