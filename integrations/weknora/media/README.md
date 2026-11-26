# WeKnora 媒体组件

本组件让 n8n 内的 DSH 对话显示知识库图片、放大原图，并使用原生视频控件播放与拖动视频。它是可选扩展，不修改普通 Markdown 或其他预设。

## 组件与数据流

- @eit-nlp/dsh-weknora-media：Host provider，保存服务端配置，注册受 connection.requestRejection 保护的 /api/weknora-media/:knowledge_id。
- @eit-nlp/dsh-weknora-media-tools：仅在指定预设中注册 weknora_get_media；它查验实际文件 ID、类型和知识库范围，生成媒体卡片元信息。
- @eit-nlp/dsh-weknora-media-view：独立 Client 插件，在回答下方展示媒体卡片，支持历史重放、图片放大及加载重试；不接收 API Key。

模型先用已有检索工具找到文件，再调用 weknora_get_media。工具只返回文件 ID、标题、媒体类型和 MIME；presentationMeta 持久化相同的稳定事实。图片、视频字节经同源受保护路由流式传输，不发送给模型，也不写入会话 JSON。

Host 在每次加载时重新访问 WeKnora GET /api/v1/knowledge/:id 和 GET /api/v1/knowledge/:id/preview，沿用后端权限，并执行管理员配置的知识库范围限制。视频原有只读预览已经支持 Range，因此不创建公开分享链接、不需要让浏览器持有 WeKnora Key、不需要额外复制到本地或改变 MinIO 存储。会话中不保存会过期的签名播放地址；历史卡片重新打开时重新鉴权。

## 在 profile 中启用

先使用目标 profile 的包管理流程安装三个本地包，路径按运行环境填写：

```json
{
  "dependencies": {
    "@eit-nlp/dsh-weknora-media": "file:/opt/deepseek-harness/integrations/weknora/media",
    "@eit-nlp/dsh-weknora-media-tools": "file:/opt/deepseek-harness/integrations/weknora/media/tool",
    "@eit-nlp/dsh-weknora-media-view": "file:/opt/deepseek-harness/integrations/weknora/media/view"
  }
}
```

在 dsh.profile.bundles 追加 @eit-nlp/dsh-weknora-media，会插入 Host provider 与 Client view。不要再手动重复插入同样的 provider/view。服务端读取 WEKNORA_BASE_URL、WEKNORA_API_KEY、可选 WEKNORA_TENANT_ID、WEKNORA_KNOWLEDGE_BASE_IDS。

在需要媒体能力的预设 plugins 数组中插入 preset-tool.example.yml 的插件行，并将 instructions.zh.txt 的规则加入该预设现有 persona。媒体工具不放在顶层，避免自动提供给其他预设。需要与其他工具区分时，两端可配置相同 toolPrefix，默认 weknora。

n8n 的自定义 profile 配置应在 n8n-managed workspace directory 管理段之前。容器内的依赖链接必须指向容器可见的 /opt/deepseek-harness 路径，而不是宿主机独有的目录。加载新包后从 n8n 重载该工作空间的 Harness，其他服务不需要重启。

一个 profile 当前支持一个 WeKnora 媒体 provider。多租户采用各自的 profile 和 Key，不要以本组件共享管理员凭据替代用户隔离。

## 用户怎么用

选择已启用媒体的 WeKnora 知识助手，直接说：

- 显示某张图纸（提供文件名或型号）。
- 播放某个视频（提供名称）。
- 同时展示图片和视频。

用户不需要工具名、内部 ID、路径或播放地址。找到多个无法区分的候选时先选文件。图片在回答下方显示，可查看大图；视频显示原生播放控件，可暂停、拖动和全屏。重新加载按钮会重新请求受保护资源。播放是用户在卡片中的操作，助手不能将“卡片已附上”说成“用户已看完”。

## 支持范围与权限

支持 PNG/JPEG/GIF/WebP/AVIF/BMP 图片及 MP4/WebM/Ogg 视频，具体视频编解码能力取决于浏览器。本组件不做视频转码、内容识别或字幕生成；按文件名入库的视频也可以播放。SVG/HTML 和其他文档不由媒体路由提供，避免把主动内容当图片展示。

仅接收 UUID 文件 ID，不接收外部 URL、本地路径或任意请求头。浏览器认证和知识库权限校验发生在读取字节之前；未登录返回401，范围外返回403。HTTP 响应为 private, no-store 和 nosniff，转发单段 Range、Content-Range 与 Content-Length。流传输遵循背压，客户端断开会取消上游请求。

knowledgeBaseIds 同时限制媒体 prepare 与实际加载；为空时访问范围依赖部署 Key 的服务端权限。撤销后端权限后，历史卡片也无法再加载。不要向拥有更少权限的用户分配一个权限过大的共享 Key。

## 构建与检查

此处是仓库内可选外部插件，不参加默认 profile 或根工作区的包扫描。动态 Client 使用仓库标准 clientBundle 构建器，lib/client.js 必须在部署时存在。从仓库运行：

```sh
cd integrations/weknora/media/view
../../../../node_modules/.bin/tsdown --config tsdown.config.ts
cd ../../../..
node --test integrations/weknora/media/tests/*.test.mjs integrations/weknora/media/view/tests/*.test.mjs
```

提交中保留构建后的 Client 文件，生产启用不需要在 n8n 容器里重新构建全部前端。修改 Client 源码后必须重建，不能只修改源码期待浏览器自动编译。

验证应覆盖实际像素加载、图片放大、视频时间推进与 seek、历史重开、未登录和范围外访问。卡片准备成功不能替代播放测试。媒体卡片不增加图像/视频字节的模型 token；只增加一个工具定义、短元信息与正常文字检索。模型多轮检索仍可能产生额外 token。

禁用时先从预设移除媒体工具，再移除 provider 与 view；会话文字保持，历史卡片在未启用 view 时不展示。未开启本组件的预设与知识库流程保持原状。
