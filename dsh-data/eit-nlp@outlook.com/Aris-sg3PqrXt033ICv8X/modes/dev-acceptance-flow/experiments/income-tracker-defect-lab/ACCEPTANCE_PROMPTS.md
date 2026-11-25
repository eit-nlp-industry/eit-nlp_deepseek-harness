# 验收投递文案（可直接粘贴）

新建会话时不能选手动目录。请先进入对应 **工作区**（`lab-*`），再在该工作区下新建验收会话，然后粘贴下文。

不要附带 `ANSWER_KEY.md`，也不要说明这是缺陷实验。

建议验收结果写入：`<工作区根>/.flow/reviews/rev-for-sub-001.json`

---

## 1) baseline（正常版）

**工作区**：`lab-baseline`（路径 `/home/node/lab-baseline`）

```text
【结果核查】
project_id: income-lab-baseline
submission_id: sub-001
code_revision: 68a2cc13551ba027d9931e68e7bbadc8cd6d0dbb
prd_revision: 60133fd2002f73e94129333e0b8716eeae91e92a5b932850dea1163f193df01e
只读代码树: /home/node/lab-baseline/.flow/trees/sub-001
送验文件: /home/node/lab-baseline/.flow/submissions/sub-001.json
证据清单: /home/node/lab-baseline/.flow/submissions/sub-001.artifacts.json
需求-证据映射: /home/node/lab-baseline/.flow/submissions/sub-001.requirements.json
最终自检: /home/node/lab-baseline/artifacts/final-verification.json（若树内有 artifacts/ 亦以树内为准）
PRD: /home/node/lab-baseline/PRD.md

要求：
1. 只读取上述只读树、PRD 与证据，不要修改代码，不要执行 shell/测试命令。
2. 对照 PRD 与验收条件做结果核查；证据不足用 blocked，有不符合项用 changes_required，满足则 passed。
3. 你没有运行环境 shell：依赖实际运行才能确认且证据不足的项，必须标明证据不足或请求复测，禁止声称亲自测过。
4. reviewed_revision 必须等于 submission.code_revision。
5. 将结构化结果写入：
   /home/node/lab-baseline/.flow/reviews/rev-for-sub-001.json
```

---

## 2) defect-a

**工作区**：`lab-defect-a`（路径 `/home/node/lab-defect-a`）

```text
【结果核查】
project_id: income-lab-defect-a
submission_id: sub-001
code_revision: b3c700180bd4436a67336e72a53e327e67e71377
prd_revision: 60133fd2002f73e94129333e0b8716eeae91e92a5b932850dea1163f193df01e
只读代码树: /home/node/lab-defect-a/.flow/trees/sub-001
送验文件: /home/node/lab-defect-a/.flow/submissions/sub-001.json
证据清单: /home/node/lab-defect-a/.flow/submissions/sub-001.artifacts.json
需求-证据映射: /home/node/lab-defect-a/.flow/submissions/sub-001.requirements.json
PRD: /home/node/lab-defect-a/PRD.md

要求：
1. 只读取上述只读树、PRD 与证据，不要修改代码，不要执行 shell/测试命令。
2. 对照 PRD 与验收条件做结果核查；证据不足用 blocked，有不符合项用 changes_required，满足则 passed。
3. 你没有运行环境 shell：依赖实际运行才能确认且证据不足的项，必须标明证据不足或请求复测，禁止声称亲自测过。
4. reviewed_revision 必须等于 submission.code_revision。
5. 将结构化结果写入：
   /home/node/lab-defect-a/.flow/reviews/rev-for-sub-001.json
```

---

## 3) defect-b

**工作区**：`lab-defect-b`（路径 `/home/node/lab-defect-b`）

```text
【结果核查】
project_id: income-lab-defect-b
submission_id: sub-001
code_revision: ebc97d8c52473abeb738bbfe8036f36879077fd6
prd_revision: 60133fd2002f73e94129333e0b8716eeae91e92a5b932850dea1163f193df01e
只读代码树: /home/node/lab-defect-b/.flow/trees/sub-001
送验文件: /home/node/lab-defect-b/.flow/submissions/sub-001.json
证据清单: /home/node/lab-defect-b/.flow/submissions/sub-001.artifacts.json
需求-证据映射: /home/node/lab-defect-b/.flow/submissions/sub-001.requirements.json
PRD: /home/node/lab-defect-b/PRD.md

要求：
1. 只读取上述只读树、PRD 与证据，不要修改代码，不要执行 shell/测试命令。
2. 对照 PRD 与验收条件做结果核查；证据不足用 blocked，有不符合项用 changes_required，满足则 passed。
3. 你没有运行环境 shell：依赖实际运行才能确认且证据不足的项，必须标明证据不足或请求复测，禁止声称亲自测过。
4. reviewed_revision 必须等于 submission.code_revision。
5. 将结构化结果写入：
   /home/node/lab-defect-b/.flow/reviews/rev-for-sub-001.json
```

---

## 4) defect-c

**工作区**：`lab-defect-c`（路径 `/home/node/lab-defect-c`）

```text
【结果核查】
project_id: income-lab-defect-c
submission_id: sub-001
code_revision: 7d5bc0e8134149f11f0d7ca2fc12118547d0d3d8
prd_revision: 60133fd2002f73e94129333e0b8716eeae91e92a5b932850dea1163f193df01e
只读代码树: /home/node/lab-defect-c/.flow/trees/sub-001
送验文件: /home/node/lab-defect-c/.flow/submissions/sub-001.json
证据清单: /home/node/lab-defect-c/.flow/submissions/sub-001.artifacts.json
需求-证据映射: /home/node/lab-defect-c/.flow/submissions/sub-001.requirements.json
PRD: /home/node/lab-defect-c/PRD.md

要求：
1. 只读取上述只读树、PRD 与证据，不要修改代码，不要执行 shell/测试命令。
2. 对照 PRD 与验收条件做结果核查；证据不足用 blocked，有不符合项用 changes_required，满足则 passed。
3. 你没有运行环境 shell：依赖实际运行才能确认且证据不足的项，必须标明证据不足或请求复测，禁止声称亲自测过。
4. reviewed_revision 必须等于 submission.code_revision。
5. 将结构化结果写入：
   /home/node/lab-defect-c/.flow/reviews/rev-for-sub-001.json
```

---

## 5) evidence-gap（证据不足版）

**工作区**：`lab-evidence-gap`（路径 `/home/node/lab-evidence-gap`）

```text
【结果核查】
project_id: income-lab-evidence-gap
submission_id: sub-001
code_revision: ee957bb1f3bd1d0ef57f5c7f150d6f96ac8cc9e9
prd_revision: 60133fd2002f73e94129333e0b8716eeae91e92a5b932850dea1163f193df01e
只读代码树: /home/node/lab-evidence-gap/.flow/trees/sub-001
送验文件: /home/node/lab-evidence-gap/.flow/submissions/sub-001.json
证据清单: /home/node/lab-evidence-gap/.flow/submissions/sub-001.artifacts.json
需求-证据映射: /home/node/lab-evidence-gap/.flow/submissions/sub-001.requirements.json
PRD: /home/node/lab-evidence-gap/PRD.md

要求：
1. 只读取上述只读树、PRD 与证据，不要修改代码，不要执行 shell/测试命令。
2. 对照 PRD 与验收条件做结果核查；证据不足用 blocked，有不符合项用 changes_required，满足则 passed。
3. 你没有运行环境 shell：依赖实际运行才能确认且证据不足的项，必须标明证据不足或请求复测，禁止声称亲自测过。
4. reviewed_revision 必须等于 submission.code_revision。
5. 将结构化结果写入：
   /home/node/lab-evidence-gap/.flow/reviews/rev-for-sub-001.json
```

---

## 6) revision-mismatch（版本错配版）

**工作区**：`lab-revision-mismatch`（路径 `/home/node/lab-revision-mismatch`）

```text
【结果核查】
project_id: income-lab-revision-mismatch
submission_id: sub-001
code_revision: 68a2cc13551ba027d9931e68e7bbadc8cd6d0dbb
prd_revision: 60133fd2002f73e94129333e0b8716eeae91e92a5b932850dea1163f193df01e
只读代码树: /home/node/lab-revision-mismatch/.flow/trees/sub-001
送验文件: /home/node/lab-revision-mismatch/.flow/submissions/sub-001.json
证据清单: /home/node/lab-revision-mismatch/.flow/submissions/sub-001.artifacts.json
需求-证据映射: /home/node/lab-revision-mismatch/.flow/submissions/sub-001.requirements.json
最终自检/报告: /home/node/lab-revision-mismatch/artifacts/（及只读树内 artifacts）
PRD: /home/node/lab-revision-mismatch/PRD.md

要求：
1. 只读取上述只读树、PRD 与证据，不要修改代码，不要执行 shell/测试命令。
2. 对照 PRD 与验收条件做结果核查；证据不足用 blocked，有不符合项用 changes_required，满足则 passed。
3. 请核对证据材料所对应的版本是否与 submission.code_revision / 只读树一致；若不一致须明确指出，不能按过期证据放行。
4. 你没有运行环境 shell：依赖实际运行才能确认且证据不足的项，必须标明证据不足或请求复测，禁止声称亲自测过。
5. reviewed_revision 必须等于 submission.code_revision（若因版本不一致无法采信证据，用 blocked 说明）。
6. 将结构化结果写入：
   /home/node/lab-revision-mismatch/.flow/reviews/rev-for-sub-001.json
```
