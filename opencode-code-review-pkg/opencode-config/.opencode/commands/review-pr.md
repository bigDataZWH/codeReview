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
对每个发现：**文件**:路径:行号 | **严重程度** | **类别** | **描述** | **建议修复**