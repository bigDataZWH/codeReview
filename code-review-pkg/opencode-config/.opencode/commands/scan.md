---
description: 全量扫描指定目录的代码问题
agent: code-reviewer
subtask: true
---

## 全量代码扫描任务

### 扫描目标
$ARGUMENTS

### 扫描内容
!`find $ARGUMENTS -type f \( -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.java" \) | head -20`

### 扫描要求
对指定目录中的代码进行全面审查：
1. 安全漏洞
2. 代码质量问题
3. 架构和设计问题
4. 性能问题
5. 测试覆盖不足

### 注意
- 仅关注高价值发现（Medium 及以上）
- 给出具体的文件路径和行号
- 每个发现附带修复建议