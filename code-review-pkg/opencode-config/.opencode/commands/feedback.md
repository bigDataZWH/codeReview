---
description: 对 finding 提交反馈，支持标记误报或接受建议
agent: code-reviewer
subtask: true
params:
  - name: findingId
    type: string
    description: finding 的唯一标识符
  - name: action
    type: string
    description: 反馈动作，可选值：false-positive（标记误报）、accept（接受建议）
    enum:
      - false-positive
      - accept
  - name: reason
    type: string
    description: 反馈原因（可选）
    optional: true
---

## Finding 反馈任务

### 反馈信息
- **Finding ID**: $findingId
- **反馈动作**: $action
- **反馈原因**: $reason

### 执行反馈

根据提供的参数对 finding 执行反馈操作：

1. **false-positive**: 调用 `markFalsePositive` 将 finding 标记为误报，记录 reject 反馈
2. **accept**: 记录 accept 反馈，表示接受该建议

### 反馈结果

反馈记录将包含：
- findingId: 关联的 finding ID
- action: 反馈动作（reject 或 accept）
- reason: 反馈原因
- timestamp: 反馈时间戳

### 输出格式

```json
{
  "id": "fb-xxx",
  "findingId": "$findingId",
  "action": "reject|accept",
  "reason": "$reason",
  "timestamp": 1234567890,
  "ignoreRule": {
    "category": "xxx",
    "ruleId": "xxx",
    "filePattern": "xxx",
    "severity": "xxx"
  }
}
```

### 注意
- false-positive 操作会自动生成忽略规则，便于后续自动过滤
- 同一 findingId 多次反馈会覆盖旧记录（只保留最新）

## Examples

### 场景 1：标记误报
将误报的 finding 标记为 false-positive，并提供原因。

```bash
code-review feedback --finding-id fb-123 --action false-positive --reason "使用了参数化查询，非 SQL 注入"
```

### 场景 2：接受建议
接受审查建议，表示已修复或计划修复该问题。

```bash
code-review feedback --finding-id fb-456 --action accept
```

### 场景 3：批量反馈
批量处理多个 findings 的反馈，提高效率。

```bash
code-review feedback --batch '[{"findingId":"fb-123","action":"false-positive"},{"findingId":"fb-456","action":"accept"}]'
```