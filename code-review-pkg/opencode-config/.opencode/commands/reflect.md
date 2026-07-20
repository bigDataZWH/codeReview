---
description: 对审查发现进行置信度评估
agent: reflector
subtask: true
---

## 置信度评估任务

### 审查发现
$ARGUMENTS

### 评估要求
对每个发现进行置信度评估，判断其是否为真阳性或假阳性。

### 输出格式
JSON 数组，每个元素包含 id 和 confidence（0-1 之间的浮点数）：
[{"id": 0, "confidence": 0.9}, {"id": 1, "confidence": 0.3}, ...]

置信度标准：
- 1.0 = 确定为真阳性，高价值发现
- 0.5 = 不确定，保持默认
- 0.0 = 确定为假阳性

## Examples

### 场景 1：评估单个 finding 置信度
对单个 security 类别的 finding 进行置信度评估。

```bash
code-review reflect --finding '{"file":"src/app.ts","line":42,"severity":"high","category":"security","message":"SQL injection"}'
```

### 场景 2：批量评估多个 findings
对审查过程中产生的所有 findings 进行批量置信度评估。

```bash
code-review reflect --input findings.json
```

### 场景 3：高风险 findings 重点评估
仅对 critical 和 high 级别的 findings 进行深度置信度评估。

```bash
code-review reflect --severity critical --severity high
```