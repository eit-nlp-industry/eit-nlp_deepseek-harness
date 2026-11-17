# 纯图 / 说明 + 一帧

知识库或检索结果里**只有一张**可解析配图时用本配方（多张或多主题带图用 `tabs`）。

## 纯图（默认）

两件事都要有，不要互相替代：

1. **聊天里**：一两句短总结（到哪了、看到什么、满不满足、下一步等）——**必须写**，不能只出图不说话。
2. **`render_ui` 界面里**：**只出 Image**，不要再出现标题/说明文字块。

适用：现场/观察依据帧、锁定确认图，以及多数「给用户看一张图」。

- `mode`: `display`；`answer_presentation`: `supplement`（不要用 `replace` 把聊天总结盖掉）
- `components`: `["Image"]`
- `business_data`: **仅** `{"image":{"assetId":"<asset_id>"}}`  
  **禁止**加 `title`、`reason` 或其它字段（那会在图上方再长一块说明，和聊天重复）。

顺序：**先**写出聊天短总结，**再**调 `render_ui`。

## 说明 + 一帧（少用）

仅当知识库介绍需要「图旁固定标题/说明」、且聊天里不宜重复写时用。现场依据帧 / 锁定图 / 验收图**不要**用本小节。

- `mode`: `display`；`answer_presentation`: `supplement`
- `business_data`: `{"title":"<短标题>","reason":"<说明>","image":{"assetId":"<asset_id>"}}`
- `user_query`：标题与说明在上，Image 在下；src、alt 取自 `image`
