# 多个信息点 / 多图（Tabs）

知识库或检索结果里**多张图**，或多个主题各自带图时用本配方（一张图用 `image`，不要 Tabs）。

- 一次调用；`components`: `["Tabs","Image"]`（某项无图时该项省略 `image` 即可，仍可用 `["Tabs","Image"]`）；`scene`: `kb`；`answer_presentation`: `replace`
- `business_data`: `{"items":[{"title":"…","content":"…","image":{"src":"/api/media/<id>/content","alt":"…"}}]}`
- 有配图的项才带 `image`；`src` / `alt` 为固定字符串，由资料里的图片链接按 `assets` 解析出的 id 与 alt
- 含图的条目用带 Image 的 items，而不是纯图 Card；不要只用 Markdown 罗列多张图
