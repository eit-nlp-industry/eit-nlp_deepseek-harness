# 取得 asset_id

仅在主 Skill 判定「配图有助于回答」或业务要求出示现场图时才解析并出图。chunk 里顺带有图片链接但问题只需文字事实时，跳过本文件。需要出图时按下面取得短 `id`，再 `render_ui`（一张 → `image`，多张 → `tabs`）。

1. **现场画面**：`annotate_target` 成功后用返回值里的 **`asset_id`（短串）**。`path` / 绝对路径仅供调试，**禁止**当作 `business_data.image.assetId`。若暂时只有路径，可取文件名去掉扩展名作为 id（须已在媒体目录登记）。
2. **资料配图**：从原文图片链接取到扩展名为止，以路径最后一段为文件名。读取**当前媒体根目录**下的 `index.json`（`mediaRoot` / `catalogRoot`；`file` 为相对该根的路径），在 `assets` 里用文件名末段对应，得到 `id` 与 `alt`。常用 id：`library`、`seminar-room`、`siming-academy`、`canteen`。

图片写入 `business_data`：

- **仅顶层一张图**（`business_data.image`）：可用 `{"assetId":"<id>"}`，由 host 补全 `src` / `alt`。
- **出现在列表或嵌套里的图**（如 `items[].image`、`images[]`）：直接写  
  `{"src":"/api/media/<id>/content","alt":"<alt>"}`。

链接解析不到 id、或没有短 `asset_id` 时，用文字说明即可，不要伪造 id，也不要把 `/data/.../*.jpg` 整路径塞进 `assetId`。
