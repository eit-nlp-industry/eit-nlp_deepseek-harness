# 服务器图片展示：部署操作

[English](deploying-json-render-images.md) | 中文

目标：用户要求查看图片时，Agent 选择服务器中的真实图片，通过 Image 组件展示。

## 1. 发布代码

合并到主分支后，后端按原有流程安装、构建并部署完整的 Host 和 Client 产物，不能只更新源码后继续使用旧的 lib/。json-render Server 需兼容当前 v0.2.4 组件包并支持 rich Image。

本指南和 `scripts/prepare-json-render-media.mjs` 随代码发布；不要使用 Git 忽略的 `.artifacts/` 本地测试配置或截图 ID。

## 2. 配置服务器

在 DSH 服务的运行环境设置：

```sh
export JSON_RENDER_MEDIA_ROOT='/srv/apps/n8n/dsh-data/eit-nlp@outlook.com/机器狗-test-POw4jOHBbPamGKJE/empty-workspace/robot-dog-v03-preset/data/target-frames'
export JSON_RENDER_BASE_URL='http://10.37.0.21:3001'
```

若生成服务地址不同，修改第二项。现有显式 mediaRoot/baseUrl 配置优先于环境变量，需移除本地测试覆盖。Docker 中使用容器内可读路径并挂载目录；systemd 中将变量写入服务环境，而非只在终端 export。

## 3. 登记图片并重启

在项目根目录、DSH 可见的运行环境执行：

```sh
node scripts/prepare-json-render-media.mjs --root "$JSON_RENDER_MEDIA_ROOT"
```

脚本递归登记 PNG、JPEG、GIF、WebP，生成 index.json，并输出资源 ID 和图片地址。扫描需要目录遍历、图片读取和清单写入权限；DSH 需要目录遍历和读取权限。然后按原方式重启 DSH，保留原有登录、域名和代理参数。

反向代理需将同源 `/api/media/` 转发到 DSH，保留登录 cookie 和正确 Host，不能转到 json-render Server。页面位于子路径时，另行检查根路径 `/api/media/` 的转发和 cookie 作用域。

## 4. 告诉 Agent 如何选图

将以下规则追加到机器人已有指令或工作区 AGENTS.md，并允许 Agent 读取图片目录的 index.json：

```text
图片目录：/srv/apps/n8n/dsh-data/eit-nlp@outlook.com/机器狗-test-POw4jOHBbPamGKJE/empty-workspace/robot-dog-v03-preset/data/target-frames
用户要求查看图片时，先读取该目录的 index.json，根据文件名或已有业务信息选择真实资源；无法确定时询问用户，不猜测 ID 或图片内容。
调用 render_ui：mode="display"，components=["Image"]，intent="rich_content"，locale="zh-CN"。
business_data={"image":{"assetId":"清单中的真实ID"}}。
user_query 要求 Image.props.src 读取宿主提供的 image.src 字符串，alt 读取 image.alt；不修改地址，不把整个 image 对象赋给 src。
必须以实际工具结果为准，失败时不要声称图片已显示。
```

仅配置目录不会自动让 Agent 知道图片清单。按目标或时间选图需要文件名或业务数据提供对应关系，扫描脚本不识别图片内容或拍摄时间。

## 5. 上线验证

1. 登录部署后的 DSH，在同一浏览器打开 `/api/media/<服务器清单中的真实ID>/content`，确认显示正确图片且返回 200。
2. 新建对话，发送“请调用 render_ui，使用 Image 展示 assetId 为 <真实ID> 的已登记图片”，确认有实际工具调用且页面显示图片。
3. 再新建对话，发送“请展示目标帧图片 <具体文件名>”，确认 Agent 选择了对应资源并显示正确图片。只回复“已展示”不算通过。

接口 401 检查登录，403 检查权限/Host/owner，404 或返回 HTML 检查目录/ID/代理，413/415 检查大小与格式，500 检查清单读取。接口能看图但生成失败时，启用 JSON_RENDER_DEBUG=1、重启 DSH，再根据 requestId 查生成服务校验日志。

## 后续新增图片

每批图片写入完成后、Agent 查询前重跑登记脚本，将这一步接入采集流程；不会自动登记新文件。目录不变通常无需重启 DSH。删除或移动图片后同步修正旧清单记录，避免并发更新清单；源文件删除后历史图片也会失效。图片上限为 20 MiB，文件扩展名和真实格式须一致。

真实服务器的权限、网络和自然语言验收由后端在部署后执行；本地验证不替代上线验收。
