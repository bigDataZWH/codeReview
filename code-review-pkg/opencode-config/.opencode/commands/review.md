---
description: 审查当前分支的代码变更，按 DAG 顺序编排多个审查 Agent
agent: code-reviewer
subtask: true
---

## 代码审查任务（DAG 编排）

### DAG 执行顺序
审查流程按以下 DAG（有向无环图）顺序执行：

```
┌─────────────────────────────────────────┐
│           第一层（并行执行）             │
│  ┌─────────────┐ ┌─────────────┐       │
│  │ rule-engine │ │code-reviewer│       │
│  └─────────────┘ └─────────────┘       │
│           ┌─────────────┐              │
│           │security-rev │              │
│           └─────────────┘              │
└─────────────────────────────────────────┘
                  ↓ 所有完成后
┌─────────────────────────────────────────┐
│           第二层（串行执行）             │
│         ┌─────────────┐                │
│         │impact-analy │                │
│         └─────────────┘                │
└─────────────────────────────────────────┘
                  ↓ 完成后
┌─────────────────────────────────────────┐
│           第三层（串行执行）             │
│         ┌─────────────┐                │
│         │  reflector  │                │
│         └─────────────┘                │
└─────────────────────────────────────────┘
```

### 阶段说明

**第一层 - 并行审查**（无依赖，同时执行）
- `rule-engine`：规则引擎，执行静态规则匹配
- `code-reviewer`：代码审查，关注质量/逻辑/性能/可维护性
- `security-reviewer`：安全审查，关注安全漏洞和风险

**第二层 - 影响分析**（依赖第一层全部完成）
- `impact-analyzer`：分析变更的影响范围和风险评分

**第三层 - 置信度评估**（依赖第二层完成）
- `reflector`：对所有 findings 进行统一置信度评估，过滤假阳性

### 变更统计
!`git diff main...HEAD --stat`

### 详细变更
!`git diff main...HEAD`

### 分批处理检测
当 PR 涉及文件数超过 30 个时，系统将自动触发分批处理模式：
- 每批处理 10 个文件
- 高风险文件优先处理（含 critical/high 标注的文件）
- 各批次并行执行以提升效率
- 最终合并所有批次的 findings

### 增量审查（--incremental）
当 `--incremental` 标志启用时，审查流程仅对自上次审查以来发生变更的文件执行审查：

1. **加载上次审查状态**：从状态文件（默认 `.code-review-incremental.json`，可通过 `--state-file` 自定义）读取上次审查保存的文件哈希和 findings
2. **计算增量 diff**：对当前 diff 中的每个文件计算内容哈希，与上次审查的哈希对比，识别变更 / 未变更 / 新增 / 删除文件
3. **仅审查变更文件**：将变更文件的 diff 序列化后传入审查管道，未变更文件直接复用上次审查的 findings
4. **合并 findings**：丢弃变更文件的旧 findings（已被本次审查结果替换），保留未变更文件的旧 findings，追加本次审查的新 findings
5. **保存新状态**：将当前文件哈希和合并后的 findings 写回状态文件，供下次增量审查使用

使用场景：
- 重复审查同一 PR 的新增提交时跳过未变更文件
- 大型 PR 多轮迭代审查时复用上次结果降低 LLM 调用成本

```bash
# 增量审查：仅审查变更文件
code-review review --incremental

# 指定状态文件路径
code-review review --incremental --state-file /tmp/review-state.json

# 增量审查 + 端到端执行（合并新旧 findings 输出 JSON）
code-review review --incremental --execute --llm-config '{"provider":"openai","apiKey":"KEY","model":"gpt-4"}'
```

### 审查要求
对每个文件中的变更进行审查，覆盖以下维度：

**安全性**：检查注入漏洞、认证缺陷、敏感数据暴露、不安全的依赖
**逻辑正确性**：边界条件、空值处理、错误处理、竞态条件
**性能**：N+1 查询、不必要的计算、内存泄漏、阻塞操作
**可维护性**：命名清晰度、函数复杂度、重复代码、缺少类型注解
**测试**：变更是否有对应的测试覆盖

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
- `category`: 类别（必需，取值：security / logic / performance / maintainability / test）
- `message`: 问题描述（必需）
- `suggestion`: 修复建议（可选）
- `confidence`: 置信度（必需，0-1 之间的数字）
- `source`: 来源（必需，取值：rule / ai）

### 子任务调用

执行以下子任务并汇总结果：

1. **安全审查** → `@agent:security-reviewer`
2. **影响分析** → `@agent:impact-analyzer`
3. **置信度评估** → `@agent:reflector`

### 结果合并
合并所有 Agent 的 findings，按以下规则解决冲突：
- 相同 file+line 的 findings，只保留最高 severity 的
- 最高 severity 相同时，保留所有类别
- reflector 输出的置信度覆盖原始置信度

## Examples

### 场景 1：常规代码审查
审查当前分支相对于 main 的所有代码变更，自动执行完整的 DAG 审查流程。

```bash
code-review review
```

### 场景 2：紧急修复审查
快速审查 Hotfix 分支的代码变更，重点关注安全性和逻辑正确性。

```bash
code-review review --branch hotfix/login-fix
```

### 场景 3：多模块变更审查
当变更涉及多个模块时，审查流程会并行运行规则引擎、代码审查和安全审查，然后串行执行影响分析和置信度评估。

```bash
code-review review --target main...feature/multi-module-refactor
```
