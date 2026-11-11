# 阶段数据的存储位置与恢复时必须保留的数据

## 结论：向导**没有自有数据库**，阶段数据全部落在会话日志里

每一次阶段写入都是一次 `wizard_stage` 工具调用，作为 `tool/call` 事件提交进会话日志。
`/api/wizard/state` 只是把这些事件折叠成状态（见 `1-plugin/state.js` 的 `foldWizardState`），
不写任何独立文件。

因此：**恢复向导 = 恢复插件代码 + 保留承载向导的会话日志（可选，取决于是否需要历史阶段）。**

## 必须保留（如需保留历史向导）

```
<DSH_HOME>/sessions/<转义后的工作目录>/<session-id>/
    session.v4.jsonl.zstd      ← 必须保留（含 wizard_stage 的 tool/call 事件）
    session.lock               ← 可保留；空文件，运行时锁
```

导出时的实际位置：

```
<DSH_HOME>/sessions/--data-dsh-eit-nlp~0040outlook.com-test-cdt-VDe1vpITgGDI6TXV-empty-workspace--/<session-id>/
```

- `<转义后的工作目录>` 由会话的 cwd 转义得到（`/`→`-`、`@`→`~0040` 等）
- 向导状态与该会话的 `wizardId` 绑定；换一个会话目录就读不到原来的向导

## 可以重建（不必备份）

```
<DSH_HOME>/storages/session_projcache/    ← 派生投影缓存，删除后按日志重建
```

## 不需要备份

- 插件目录下的 `node_modules`（本插件没有运行时依赖）
- `.credentials.yaml`、`.anonymous-user-id`、任何 token / 密钥（**本包已排除**）

## 恢复后的行为

- 直接打开会话 → 向导页签按日志里的最新 `wizard_stage` 记录渲染
- 若只恢复插件、不恢复会话：向导页签会显示“这个会话还没有向导阶段”
- `wizard_stage` 是普通工具调用，日志缺失不会导致插件加载失败

## 校验建议

```sh
# 会话日志里是否含向导记录（zstd 需先解压）
zstd -dc session.v4.jsonl.zstd | grep -c '"wizard_stage"'
```

导出时该会话的日志大小约 **2.7 MB**（未纳入本包，属会话数据而非插件资产）。
