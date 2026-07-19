---
description: 合规检查 — 将审查 findings 映射到 OWASP Top 10 与 CWE Top 25 标准类别，生成合规报告
agent: code-reviewer
subtask: true
---

## 合规检查任务

### 任务目标
将代码审查产出的 findings 映射到 OWASP Top 10 (2021) 与 CWE Top 25 (2023) 标准类别，
生成结构化合规报告，便于安全合规审计与风险评估。

### 支持标准

**OWASP Top 10 (2021)**
- A01:2021 - Broken Access Control (失效的访问控制)
- A02:2021 - Cryptographic Failures (加密失败)
- A03:2021 - Injection (注入)
- A04:2021 - Insecure Design (不安全设计)
- A05:2021 - Security Misconfiguration (安全配置错误)
- A06:2021 - Vulnerable and Outdated Components (易受攻击和过时的组件)
- A07:2021 - Identification and Authentication Failures (身份识别和认证失败)
- A08:2021 - Software and Data Integrity Failures (软件和数据完整性失败)
- A09:2021 - Security Logging and Monitoring Failures (安全日志和监控失败)
- A10:2021 - Server-Side Request Forgery (SSRF)

**CWE Top 25 (2023)**
- 包含 25 个最危险软件弱点（如 CWE-79 XSS、CWE-89 SQL 注入、CWE-22 路径遍历等）

### 映射规则

每条 finding 通过以下字段匹配到 OWASP/CWE 类别：
1. **自定义映射（优先级最高）**：通过 `category` / `ruleId` / `messageContains` 精确匹配
2. **关键词匹配**：扫描 `finding.category` / `finding.ruleId` / `finding.message` 中的关键词
3. **CWE 关联**：匹配 CWE 后自动关联到其对应的 OWASP 类别

### 使用方式

```bash
# 从 stdin 读取 findings JSON，输出合规报告
cat findings.json | code-review compliance

# 输入数据格式（Finding 数组）
[
  {
    "file": "src/app.ts",
    "line": 42,
    "severity": "critical",
    "category": "security",
    "message": "SQL injection vulnerability",
    "ruleId": "sql-injection",
    "confidence": 0.95,
    "source": "ai"
  }
]
```

### 输出格式

输出为 JSON 格式的合规报告：

```json
{
  "totalFindings": 10,
  "mappedFindings": 8,
  "unmappedFindings": 2,
  "owaspCoverage": 0.8,
  "categories": [
    {
      "id": "A03",
      "fullId": "A03:2021",
      "name": "Injection",
      "chineseName": "注入",
      "findingsCount": 5,
      "severityDistribution": {
        "critical": 2,
        "high": 2,
        "medium": 1,
        "low": 0,
        "info": 0
      },
      "findings": [...],
      "cweIds": ["CWE-79", "CWE-89", "CWE-77", "CWE-90", "CWE-918"]
    }
  ],
  "uncoveredCategories": [...],
  "mappings": [...],
  "matchedCweIds": ["CWE-79", "CWE-89"],
  "timestamp": 1717171200000
}
```

**字段说明**：
- `totalFindings`: 输入的 findings 总数
- `mappedFindings`: 已映射到 OWASP 类别的 findings 数
- `unmappedFindings`: 未映射到任何 OWASP 类别的 findings 数
- `owaspCoverage`: OWASP 覆盖率（0-1）
- `categories`: 按 findingsCount 降序排列的 OWASP 类别统计
- `uncoveredCategories`: 未命中的 OWASP 类别（提醒关注未检测到的风险）
- `mappings`: 每条 finding 的详细映射结果
- `matchedCweIds`: 所有匹配到的 CWE ID（去重、字典序排序）
- `timestamp`: 合规检查时间戳

### 合规场景

1. **安全审计**：按 OWASP Top 10 维度统计代码中的安全问题分布
2. **风险评估**：识别高风险类别（如 A03 Injection 中的 critical findings）
3. **合规报告**：生成符合 OWASP/CWE 标准的合规报告，用于审计与监管
4. **覆盖度评估**：通过 `owaspCoverage` 评估审查覆盖度，识别未检测到的风险领域

## Examples

### 场景 1：生成完整合规报告
对一批审查 findings 执行合规检查，生成完整报告。

```bash
cat findings.json | code-review compliance > compliance-report.json
```

### 场景 2：与 security-review 命令配合
先执行安全审查，再对产出的 findings 执行合规检查。

```bash
code-review security-review --execute --llm-config '{"provider":"openai","apiKey":"KEY","model":"gpt-4"}' > findings.json
cat findings.json | code-review compliance > compliance-report.json
```

### 场景 3：识别高风险类别
分析合规报告中 `categories` 字段，找出 findings 数最多的 OWASP 类别，
作为安全整改的优先方向。

```bash
cat findings.json | code-review compliance | jq '.categories[0]'
```
