# 你只需要做的事（无需终端）

Web UI **新建会话时不能选手动工作目录**——会话会自动用「当前工作区」的路径。
所以正确做法是：**先进入对应工作区，再在该工作区下新建会话**。

## 验收（第一轮）

1. 刷新 Web 页面（若侧边栏还没有下面这些，见文末「备选」）。
2. 在工作区列表点开其中一个：
   - `lab-baseline`
   - `lab-defect-a`
   - `lab-defect-b`
   - `lab-defect-c`
   - `lab-evidence-gap`
   - `lab-revision-mismatch`
3. 在该工作区下 **新建会话**，预设选 **验收 / aris-acceptance**（不要选研发）。
4. 打开 `ACCEPTANCE_PROMPTS.md`，复制对应段落粘贴发送。

建议顺序：baseline → A → B → C → evidence-gap → revision-mismatch。
做完对照 `ANSWER_KEY.md`（不要把答案发给验收）。

## 整改闭环（验收给出 changes_required 之后）

和正式项目一样，宿主会自动把整改单投给研发：

1. 仍在**同一工作区**（例如 `lab-defect-a`）下 **新建研发会话**（预设 `development`）。
2. 等几秒：宿主会绑定该会话，并自动投递「请整改并重新送验」。
3. 让研发按 FIND 编号修复、重新送验（写出新的 `kind=remediation` submission）。
4. 再用验收会话（或新建验收）对**新 submission** 复测。

你不需要复制 findings 粘贴；也不要在别的工作区开研发会话。

## 不要做

- 第一轮验收时不要开研发会话修这些副本
- 不要告诉验收「这是缺陷实验」
- 不需要进容器或跑命令

## 备选：侧边栏没有 lab-* 时

用 UI 的 **添加工作区**（文件夹选择器，不是创建会话时选）：

| 显示名建议 | 选择路径 |
|---|---|
| lab-baseline | `/home/node/lab-baseline` |
| lab-defect-a | `/home/node/lab-defect-a` |
| lab-defect-b | `/home/node/lab-defect-b` |
| lab-defect-c | `/home/node/lab-defect-c` |
| lab-evidence-gap | `/home/node/lab-evidence-gap` |
| lab-revision-mismatch | `/home/node/lab-revision-mismatch` |

添加后，再在该工作区下新建会话即可。
