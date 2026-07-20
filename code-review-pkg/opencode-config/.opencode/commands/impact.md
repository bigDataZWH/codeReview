---
description: 变更影响范围分析
agent: impact-analyzer
subtask: true
---

## 变更影响分析任务

### 变更统计
!`git diff main...HEAD --stat`

### 详细变更
!`git diff main...HEAD`

### 分析要求
分析代码变更的影响范围，覆盖以下维度：

**直接影响文件**：列出所有直接修改的文件
**间接影响文件**：列出被修改函数调用的文件、调用修改函数的文件
**测试覆盖状态**：受影响代码的测试覆盖情况
**风险评分**：从 0-10 的风险评估

### 输出格式
JSON 数组，每个 finding 包含：
- affectedFiles: 受影响文件列表
- indirectAffectedFiles: 间接影响文件列表
- testCoverage: 测试覆盖状态
- riskScore: 0-10 的风险评分
- description: 影响描述

## Examples

### 场景 1：核心模块变更影响分析
分析数据库连接模块变更对整个系统的影响范围。

```bash
code-review impact --target src/db/connection.ts
```

### 场景 2：跨模块调用影响分析
分析 API 路由变更对下游服务和前端组件的间接影响。

```bash
code-review impact --deep
```

### 场景 3：测试覆盖影响分析
评估变更代码的测试覆盖情况，识别测试缺失的高风险区域。

```bash
code-review impact --test-coverage
```
