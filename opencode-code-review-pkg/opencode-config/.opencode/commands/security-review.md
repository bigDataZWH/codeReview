---
description: 安全专项代码审查
agent: security-reviewer
subtask: true
---

## 安全审查任务

### 变更内容
!`git diff main...HEAD`

### 三层分析方法论
1. **仓库上下文研究**：理解项目架构、认证机制、数据处理流程
2. **对比分析**：逐文件分析 diff，关注安全敏感变更
3. **漏洞评估**：评估每个发现的严重程度和可利用性

### 安全关注类别
- 注入攻击（SQL/NoSQL/Command/XSS/SSRF/LDAP）
- 认证与授权缺陷（硬编码凭证、缺少权限检查）
- 加密使用不当（弱算法、硬编码密钥、ECB 模式）
- 敏感数据暴露（日志泄漏、响应体泄漏）
- 不安全的反序列化
- 路径遍历
- SSRF
- 依赖安全（已知 CVE 的依赖引入）

### 输出格式
JSON 数组，每个 finding 包含 file, line, severity (critical/high/medium/low), category, description, recommendation, confidence (0-1)。