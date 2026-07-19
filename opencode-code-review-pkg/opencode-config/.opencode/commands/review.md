---
description: 审查当前分支的代码变更
agent: code-reviewer
subtask: true
---

## 代码审查任务

### 变更统计
!`git diff main...HEAD --stat`

### 详细变更
!`git diff main...HEAD`

### 审查要求
对每个文件中的变更进行审查，覆盖以下维度：

**安全性**：检查注入漏洞、认证缺陷、敏感数据暴露、不安全的依赖
**逻辑正确性**：边界条件、空值处理、错误处理、竞态条件
**性能**：N+1 查询、不必要的计算、内存泄漏、阻塞操作
**可维护性**：命名清晰度、函数复杂度、重复代码、缺少类型注解
**测试**：变更是否有对应的测试覆盖

### 输出格式
对每个发现，使用以下格式：
- **文件**: 路径:行号
- **严重程度**: Critical / High / Medium / Low
- **类别**: security / logic / performance / maintainability / test
- **问题描述**: 简洁描述
- **建议修复**: 具体的代码修改建议