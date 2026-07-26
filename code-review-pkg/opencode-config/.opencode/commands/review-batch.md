---
description: 批量并发代码检视多个 MR
agent: code-reviewer
subtask: true
---

## 批量并发检视

对以下 MR 进行并发检视：$ARGUMENTS

每个 MR 独立执行审查流程，并发度由系统自动调优（基于 CPU 核数与 IO 特征）。

### 执行步骤
1. 获取每个 MR 的 diff（通过 CodeHub API）
2. 并发执行审查（rule-engine + code-reviewer + security-reviewer 并行）
3. 每个 MR 审查完成后保存报告为本地 Markdown
4. 可选：将结果提为 CodeHub Issue

### 并发执行

!`code-review codehub-batch --mr-iids $ARGUMENTS --concurrent --save-report --output-dir .code-review-reports/`

### 可选：批量提 Issue

如需将每个 MR 的检视结果自动提为 CodeHub Issue：

!`code-review codehub-batch --mr-iids $ARGUMENTS --concurrent --save-report --create-issues --output-dir .code-review-reports/`

## Examples

### 场景 1：并发检视多个 MR
并发检视 IID 为 1、2、3 的三个 MR，自动保存报告。

```bash
code-review review-batch 1,2,3
```

### 场景 2：并发检视并自动提 Issue
并发检视多个 MR，保存报告并自动将检视结果提为 CodeHub Issue。

```bash
code-review review-batch 5,8,12 --create-issues
```
