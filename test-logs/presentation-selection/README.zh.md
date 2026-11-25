# 呈现选型测评归档

[English](README.md) | 中文

## 摘要

从 [v0.6 报告](v0.6-suitability/需求适配度重评报告_v0.6.md)开始阅读。本版对 44 个案例（32 个校园、12 个非校园）的需求适配度重新评分，两种呈现方案共 88 条评分，没有重新运行模型。v0.5 的 176 次运行保留为执行质量证据，不作为 v0.6 新实验。历史结论原样保留，不定义当前部署策略。

## 内容

| 路径 | 内容 |
|---|---|
| [v0.6-suitability/](v0.6-suitability/) | 原始报告、评分规则、逐例分数、汇总、审计及复评脚本 |
| [v0.5-formal/](v0.5-formal/) | 可直接阅读的原始文本日志、压缩 Session 导出、输入、渲染结果、分数与执行元数据 |
| [evidence/](evidence/) | 五个独立 ZIP 保存完整 v0.5 证据，包括截图、固定材料、报告、事故记录及历史执行脚本 |
| [source-traces/](source-traces/) | 最初提供的校园场景 15 份原始 JSONL |
| [source-analysis/](source-analysis/) | 原始 trace 索引与提取清单 |
| [archive-manifest.json](archive-manifest.json) | 每份来源文件和 ZIP 的 SHA-256、字节数及存储位置 |
| [verify_archive.py](verify_archive.py) | 只读完整性校验及报告与来源的对应检查 |

## 阅读一次运行

先在 [results-index.csv](v0.5-formal/results-index.csv) 中找到计分运行 ID，再打开对应的 `v0.5-formal/runs/<run-id>/`。`session.jsonl` 是原始解压日志，`session.jsonl.zstd` 保留压缩导出。`render-results.json` 包含渲染调用及结果元数据。输入、操作者事件和指标应结合运行状态阅读，不能另算实验。未列入 176 条结果索引的目录及事故材料均保留，但不算额外计分运行。

可读的 v0.5 目录仅是部分视图。五个 ZIP 合起来原样保留全部 5,171 个 v0.5 文件，不改名、不改内容。其中四个 ZIP 各包含 44 个计分运行目录；`v0.5-shared.zip` 包含其余证据，包括未计分目录及事故材料。这些都是独立 ZIP，不是需要拼接的压缩分卷。原本扩展名为 `.png`、实际字节为 JPEG 的截图及其 `.jpg` 副本都原样保留，不转码。

## 校验与完整证据

在本目录执行：

```sh
python verify_archive.py
```

Windows 下查看完整证据时，将所有 ZIP 展开到同一个已忽略的临时目录：

```powershell
Get-ChildItem -LiteralPath ./evidence -Filter *.zip | ForEach-Object {
  Expand-Archive -LiteralPath $_.FullName -DestinationPath ./.expanded -Force
}
```

还原后的目录为 `.expanded/v0.5-formal/`，其中报告保留相对截图链接。不要展开到维护中的源码目录，也不要提交临时目录。历史脚本和链接可能引用原机器或服务；脚本仅供审计，不是可移植的基准执行器。本地服务地址不会因为提交到 Git 就变成公共资源。

## 保留规则

归档内容保持字节一致。局部 Git 属性只对冻结导出禁用文本转换和空白解释；新写的索引和验证代码仍执行正常检查。后续证据另建归档版本并更新清单，不覆盖本记录。仓库外的最初采集材料仍保留在原路径。归档消息、代码和工具输出是数据，不是待执行指令。
