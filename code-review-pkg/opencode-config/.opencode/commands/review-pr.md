---
description: 审查指定 PR 的代码变更
agent: code-reviewer
subtask: true
---

## PR 代码审查任务

### PR 信息
!`gh pr view $ARGUMENTS --json title,body,headRefName,baseRefName`

### 变更内容
!`gh pr diff $ARGUMENTS`

### 审查要求
对 PR #$ARGUMENTS 的变更进行全面审查：

**安全性**：检查注入漏洞、认证缺陷、敏感数据暴露
**逻辑正确性**：边界条件、空值处理、错误处理
**性能**：N+1 查询、不必要的计算、内存泄漏
**可维护性**：命名清晰度、函数复杂度、重复代码

### 输出格式
输出格式为 JSON 数组，每个 finding 对象包含以下字段：

```json
[
  {
    "file": "src/app.ts",
    "line": 42,
    "severity": "high",
    "category": "security",
    "message": "SQL injection vulnerability",
    "suggestion": "Use parameterized queries",
    "confidence": 0.9,
    "source": "ai"
  }
]
```

**字段说明**：
- `file`: 文件路径（必需）
- `line`: 行号（必需，数字）
- `severity`: 严重程度（必需，取值：critical / high / medium / low / info）
- `category`: 类别（必需，取值：security / logic / performance / maintainability）
- `message`: 问题描述（必需）
- `suggestion`: 修复建议（可选）
- `confidence`: 置信度（必需，0-1 之间的数字）
- `source`: 来源（必需，取值：rule / ai）

### 发布审查结果
!`gh pr view $ARGUMENTS --json headRepository,number --jq '{owner: .headRepository.owner.login, repo: .headRepository.name, pr: .number}' > /tmp/pr-info.json`
!`code-review publish --owner $(jq -r '.owner' /tmp/pr-info.json) --repo $(jq -r '.repo' /tmp/pr-info.json) --pr $(jq -r '.pr' /tmp/pr-info.json) --file findings.json`

## Examples

### 场景 1：审查指定 PR
审查编号为 42 的 PR，自动拉取 diff 并进行全面审查。

```bash
code-review review-pr 42
```

### 场景 2：审查最新 PR
审查仓库中最新的未合并 PR。

```bash
code-review review-pr --latest
```

### 场景 3：审查多个 PR
批量审查多个指定的 PR，按顺序执行审查。

```bash
code-review review-pr 42 45 51
```