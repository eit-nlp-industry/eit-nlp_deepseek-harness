# WeKnora 媒体插件实施计划

已批准目标：n8n Harness 正常提问后显示知识库图片与可播放视频；保留普通问答与既有预设。

- 独立 Host provider 使用原 WeKnora 只读 preview 接口（已验证图片/视频 Range 206），不创建额外公开分享链接；复用 connection.requestRejection。
- 媒体工具只在所选预设挂载，验证文件类型和知识库范围；结果只持久化文件 ID/名称/类型，不保存密钥或签名链接。
- 独立 Client 插件在 conversation turnTail 中重放媒体记录，显示图片/放大/视频控制/重试；提供可本地化的加载与错误状态。
- 先验证 auth、范围、Range、历史元数据和原有工具，再构建动态 Client 并在 n8n 实际加载。
- 真正验收 naturalWidth>0、视频 readyState 与 currentTime、拖动播放、重新打开会话、未登录与越权。
- 更新截图报告，隔离提交，不提交凭据、测试数据、运行截图。与远端 master 合并后仅快进推送。
