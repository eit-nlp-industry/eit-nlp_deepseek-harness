# Server image display: deployment steps

English | [中文](deploying-json-render-images.zh.md)

Goal: when a user requests an image, the Agent selects a real server image and displays it with Image.

## 1. Release code

After merging to master, use the existing release process to install, build, and deploy complete Host and Client artifacts, rather than retaining old lib/ after updating source. The json-render Server must support rich Image and be compatible with the current v0.2.3 packages.

Publish this guide and `scripts/prepare-json-render-media.mjs` with the code; do not deploy Git-ignored `.artifacts/` test configuration or screenshot IDs.

## 2. Configure the server

Set these in the DSH service environment:

```sh
export JSON_RENDER_MEDIA_ROOT='/srv/apps/n8n/deepseek-harness/dsh-data/eit-nlp@outlook.com/机器狗-test-POw4jOHBbPamGKJE/runtime_data/robot-dog-v03/target-frames'
export JSON_RENDER_BASE_URL='http://10.37.0.21:3001'
```

Change the second value if the generation service address differs. Explicit mediaRoot/baseUrl settings override environment variables; remove local test overrides. Docker needs a mounted, container-readable directory; systemd needs variables in the service environment, not merely an interactive export.

## 3. Register images and restart

From the repository root in the runtime filesystem visible to DSH, run:

```sh
node scripts/prepare-json-render-media.mjs --root "$JSON_RENDER_MEDIA_ROOT"
```

The script recursively registers PNG, JPEG, GIF, and WebP, writes index.json, and prints IDs and image paths. Scanning needs directory traversal, image reading, and catalog writing; DSH needs traversal and reading. Restart DSH normally, preserving authentication, domain, and proxy settings.

Proxy same-origin `/api/media/` to DSH with its login cookie and correct Host, not to the json-render Server. Subpath deployments must separately check root `/api/media/` routing and cookie scope.

## 4. Tell the Agent how to select images

Append the following rules to existing robot instructions or workspace AGENTS.md, and permit the Agent to read index.json in the image directory:

```text
图片目录：/srv/apps/n8n/deepseek-harness/dsh-data/eit-nlp@outlook.com/机器狗-test-POw4jOHBbPamGKJE/runtime_data/robot-dog-v03/target-frames
用户要求查看图片时，先读取该目录的 index.json，根据文件名或已有业务信息选择真实资源；无法确定时询问用户，不猜测 ID 或图片内容。
调用 render_ui：mode="display"，components=["Image"]，intent="rich_content"，locale="zh-CN"。
business_data={"image":{"assetId":"清单中的真实ID"}}。
user_query 要求 Image.props.src 读取宿主提供的 image.src 字符串，alt 读取 image.alt；不修改地址，不把整个 image 对象赋给 src。
必须以实际工具结果为准，失败时不要声称图片已显示。
```

Directory configuration alone does not expose the catalog to the Agent. Target/time selection needs filename or business-data mappings; the scanner does not recognize image contents or capture times.

## 5. Verify deployment

1. Log into DSH and open `/api/media/<real server catalog ID>/content` in the same browser. Confirm the correct image and HTTP 200.
2. In a new conversation, ask to call render_ui and display a registered image with Image using its real assetId. Confirm an actual tool call and image display.
3. In another new conversation, ask to show a target frame by a specific filename. Confirm correct resource selection and image display. A text claim of success is insufficient.

For 401 check login; 403 permissions/Host/owner; 404 or HTML directory/ID/proxy; 413/415 size and format; 500 catalog reading. If the endpoint displays the image but generation fails, enable JSON_RENDER_DEBUG=1, restart DSH, and correlate requestId with generation validation logs.

## Subsequent images

Rerun registration after each batch finishes writing and before Agent queries; add this step to capture processing because new files are not registered automatically. An unchanged directory normally needs no DSH restart. Correct old catalog entries after deleting or moving images, avoid concurrent catalog updates, and expect deleted source images to break historical displays. Images are limited to 20 MiB and must match their filename format.

Backend engineers verify actual server permissions, networking, and natural-language acceptance after deployment; local verification does not replace deployment acceptance.
