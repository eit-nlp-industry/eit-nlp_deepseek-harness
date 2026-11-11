# Profile 接线说明

向导是一个 **bundle 插件**，加载它需要两处改动，都在 profile 目录：

```
<DSH_HOME>/profiles/<profile>/package.json
```

## 1. 声明本地依赖

在 `dependencies` 中加入（`link:` 指向解压后的 `1-plugin` 绝对路径）：

```json
"@local/dsh-wizard": "link:/path/to/1-plugin"
```

## 2. 加入 profile 的 bundle 列表

```json
"dsh": { "profile": { "bundles": [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "@local/dsh-wizard"
] } }
```

> 这是**追加**，不要替换原有条目。

## 3. 建立包链接

```
<DSH_HOME>/profiles/<profile>/node_modules/@local/dsh-wizard
  -> ../../../../empty-workspace/wizard-bundle
```

（相对层级取决于你把 `1-plugin` 放在 `<DSH_HOME>/empty-workspace/` 下的约定；
放别处就用绝对路径的 `link:`，并相应更新该软链。）

## 4. 不需要额外的 patch 行

插件自带的 `1-plugin/cordis.patch.yml` 会插入自己的 loader 行：

```yaml
- insert:
    - id: dsh-wizard
      name: '@local/dsh-wizard'
```

因此**不要**再往 profile 的 `cordis.patch.yml` 里手工加同名行。

## 5. 启用与验证

重启（或让平台重新加载）后：

- 工具表出现 `wizard_stage`
- 会话头部视图页签出现「向导」（`conversation.view` id=`wizard`）
- `GET /api/wizard/state?sessionId=<id>` 返回 JSON（未登录 401；未知会话 404 `{"error":"unknown session"}`）

## 当前 profile 的实际片段（导出时的原值，仅参考）

```json
"@local/dsh-wizard": "link:/data/dsh/eit-nlp@outlook.com/test-cdt-VDe1vpITgGDI6TXV/empty-workspace/wizard-bundle"
```

该片段同时把 `@local/dsh-wizard` 排在 `bundles` 的最后一项。
