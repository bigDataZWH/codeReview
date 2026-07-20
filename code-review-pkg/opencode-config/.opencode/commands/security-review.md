---
description: 安全专项代码审查
agent: security-reviewer
subtask: true
---

## 安全审查任务

### 变更内容
!`git diff main...HEAD`

### 分批处理检测
当 PR 涉及文件数超过 30 个时，系统将自动触发分批处理模式：
- 每批处理 10 个文件
- 高风险文件优先处理（含 critical/high 标注的文件）
- 各批次并行执行以提升效率
- 最终合并所有批次的 findings

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
输出格式为 JSON 数组，每个 finding 对象包含以下字段：

```json
[
  {
    "file": "src/app.ts",
    "line": 42,
    "severity": "critical",
    "category": "security",
    "message": "SQL injection vulnerability",
    "suggestion": "Use parameterized queries",
    "confidence": 0.95,
    "source": "ai"
  }
]
```

**字段说明**：
- `file`: 文件路径（必需）
- `line`: 行号（必需，数字）
- `severity`: 严重程度（必需，取值：critical / high / medium / low / info）
- `category`: 类别（必需，取值：security / authentication / encryption / data-exposure / deserialization / path-traversal / ssrf）
- `message`: 问题描述（必需）
- `suggestion`: 修复建议（可选）
- `confidence`: 置信度（必需，0-1 之间的数字）
- `source`: 来源（必需，取值：rule / ai）

## Examples

### 场景 1：API 接口安全审查
审查新增或修改的 API 接口，检测注入攻击、认证缺陷和敏感数据暴露。

```bash
code-review security-review
```

### 场景 2：认证模块安全审查
针对用户认证相关代码进行深度安全分析，关注硬编码凭证、会话管理和权限控制。

```bash
code-review security-review --filter "src/auth/**/*.ts"
```

### 场景 3：第三方依赖安全审查
审查新引入的依赖包，检测已知 CVE 漏洞和不安全的依赖版本。

```bash
code-review security-review --focus-dependencies
```