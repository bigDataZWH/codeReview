---
description: 查询代码审查审计日志，按用户、命令、结果、时间范围过滤历史操作记录
agent: code-reviewer
subtask: true
params:
  - name: file
    type: string
    description: 审计日志文件路径（JSON Lines 格式），默认 .code-review-audit.log
    optional: true
  - name: user
    type: string
    description: 按用户过滤
    optional: true
  - name: action
    type: string
    description: 按命令精确过滤（如 review / scan / rules disable）
    optional: true
  - name: result
    type: string
    description: 按执行结果过滤
    enum:
      - success
      - failure
      - denied
    optional: true
  - name: limit
    type: number
    description: 限制返回条数（默认 100）
    optional: true
---

## 审计日志查询任务

### 任务目标
从审计日志文件中查询历史操作记录，支持按用户、命令、结果、时间范围等多维度过滤。
审计日志用于追踪所有代码审查相关操作，满足企业级合规与可追溯性要求。

### 审计日志条目结构

每条审计日志记录以下字段：

```json
{
  "id": "audit-xxx",
  "timestamp": 1717171200000,
  "user": "alice",
  "role": "admin",
  "action": "review",
  "args": ["--incremental"],
  "result": "success",
  "durationMs": 1234,
  "findingsCount": 3,
  "error": null,
  "metadata": {}
}
```

**字段说明**：
- `id`: 审计日志唯一 ID
- `timestamp`: 时间戳（ms）
- `user`: 执行用户（未指定时为 'anonymous'）
- `role`: 用户角色（可选）
- `action`: 执行的命令（如 'review' / 'rules disable'）
- `args`: 命令参数数组
- `result`: 执行结果（'success' / 'failure' / 'denied'）
- `durationMs`: 执行耗时（ms，可选）
- `findingsCount`: 关联的 findings 数量
- `error`: 错误信息（result 为 failure/denied 时填充）
- `metadata`: 额外元数据（如 PR 编号、规则 ID 等）

### 使用方式

```bash
# 查询全部审计日志
code-review audit --file .code-review-audit.log

# 按用户过滤
code-review audit --file .code-review-audit.log --user alice

# 按命令过滤
code-review audit --file .code-review-audit.log --action review

# 按结果过滤
code-review audit --file .code-review-audit.log --result denied

# 限制返回条数
code-review audit --file .code-review-audit.log --limit 50
```

### 输出格式
输出为 JSON 数组，包含匹配的审计日志条目（按时间倒序，最新在前）：

```json
[
  {
    "id": "audit-xxx",
    "timestamp": 1717171200000,
    "user": "alice",
    "action": "review",
    "args": ["--incremental"],
    "result": "success",
    "findingsCount": 3
  }
]
```

### 审计场景

1. **权限审计**：追踪 RBAC 权限校验失败记录（result=denied），识别异常访问尝试
2. **操作追踪**：记录每次代码审查的执行用户、命令、参数与结果
3. **故障排查**：通过 result=failure 过滤失败的审查操作，快速定位问题
4. **合规报告**：导出指定时间范围内的审计日志，用于合规审计

## Examples

### 场景 1：查看所有审计日志
查询全部审计日志记录，了解最近的操作历史。

```bash
code-review audit --file .code-review-audit.log
```

### 场景 2：按用户过滤
查看特定用户的操作记录，例如查看 alice 的所有操作。

```bash
code-review audit --file .code-review-audit.log --user alice
```

### 场景 3：按结果过滤
查看所有被拒绝的操作（result=denied），用于安全审计。

```bash
code-review audit --file .code-review-audit.log --result denied
```

### 场景 4：按命令过滤
查看所有规则变更操作（rules disable / enable / override）。

```bash
code-review audit --file .code-review-audit.log --action "rules disable"
```
