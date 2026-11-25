---
name: safety-interlocks
description: 控制回路的过限保护与安全联锁：给定 case.json（measurement、command、max_limit、min_output、max_output）要求算出安全输出，或要求在做开环测试、标定前加限幅、联锁检查时使用；先判过限（最高优先级）再钳位输出，并汇报 safety_triggered 与 output。
---

# 控制回路安全联锁

## 何时使用

- 任务给出一份控制用例（`case.json` / 类似结构），要求计算安全输出。
- 要求在下发控制量前做过限保护、输出钳位、联锁事件记录。
- 开环测试、标定激励阶段需要盯住安全限值。

## 输入约定

```json
{
  "id": "eq-100",
  "measurement": 100,
  "command": 40,
  "max_limit": 100,
  "min_output": 0,
  "max_output": 100
}
```

字段含义：`measurement` 当前测量值，`command` 期望输出，`max_limit` 安全上限，`min_output`/`max_output` 输出允许范围。字段缺失时先补齐再计算，不要猜默认上限。

## 步骤

1. 读取用例文件，取出上述字段。
2. **过限判定最高优先级**：`measurement >= max_limit` 时立即 `command = min_output`，并记 `safety_triggered = true`（紧急切断，不执行原期望输出）。
3. **钳位**：`command = max(min_output, min(max_output, command))`，保证输出落在合法区间。
4. 汇报结果，固定两行：

   ```
   safety_triggered= True
   output= 0
   ```

5. 说明触发原因（哪条限值、前后输出值），并把事件写进安全日志。

## 参考实现

```python
def apply_safety_limits(measurement, command, max_limit, min_limit, max_output, min_output):
    safety_triggered = False

    # 过限优先，最高优先级
    if measurement >= max_limit:
        command = min_output      # 紧急切断
        safety_triggered = True

    # 钳位到合法区间
    command = max(min_output, min(max_output, command))
    return command, safety_triggered
```

集成进控制回路时同样先判安全，再算正常控制量：

```python
class SafeController:
    def __init__(self, controller, max_limit, min_output=0.0, max_output=100.0):
        self.controller = controller
        self.max_limit = max_limit
        self.min_output = min_output
        self.max_output = max_output
        self.safety_events = []

    def compute(self, measurement, dt):
        if measurement >= self.max_limit:
            self.safety_events.append({
                "measurement": measurement,
                "action": "emergency_cutoff",
            })
            return self.min_output
        output = self.controller.compute(measurement, dt)
        return max(self.min_output, min(self.max_output, output))
```

## 开环测试中的安全

没有反馈时更要主动切断输入：

```python
def run_test_with_safety(system, input_value, duration, dt, max_limit):
    data, current_input = [], input_value
    for _ in range(int(duration / dt)):
        result = system.step(current_input)
        data.append(result)
        if result["output"] >= max_limit:
            current_input = 0.0   # 切断输入
    return data
```

## 安全日志

```python
safety_log = {"limit": max_limit, "events": []}
if measurement >= max_limit:
    safety_log["events"].append({
        "time": current_time,
        "measurement": measurement,
        "command_before": command,
        "command_after": 0.0,
        "event_type": "limit_exceeded",
    })
```

## 执行前检查

1. 测量值合理：非 NaN/Inf，处于物理范围内。
2. 初始条件正确：测量值在预期起点，初始输出为安全值。
3. 限值已配置：`max_limit` 存在，输出钳位生效。

```python
def pre_control_checks(measurement, config):
    assert not np.isnan(measurement), "Measurement is NaN"
    assert config.get("max_limit") is not None, "Safety limit not configured"
    return True
```

## 要点

- 先安全后控制，过限判定永远排在正常控制之前。
- 拿不准就减输出（fail safe）。
- 安全事件全量记录，不得条件性关闭或绕过联锁。
- 正常投运前先验证联锁确实生效。
