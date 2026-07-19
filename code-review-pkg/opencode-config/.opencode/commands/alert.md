---
description: 发送告警通知到 Slack / Email / PagerDuty 等多渠道，按 severity 路由分发
agent: code-reviewer
subtask: true
params:
  - name: severity
    type: string
    description: 告警严重度
    enum:
      - critical
      - high
      - medium
      - low
      - info
    optional: true
  - name: message
    type: string
    description: 告警消息内容
    optional: true
  - name: title
    type: string
    description: 告警标题（默认 'Code Review Alert'）
    optional: true
  - name: source
    type: string
    description: 告警来源标识（如 'code-review' / 'security-review'）
    optional: true
  - name: slack-url
    type: string
    description: Slack Incoming Webhook URL
    optional: true
  - name: email-to
    type: string
    description: 收件人邮箱（多个用逗号分隔）
    optional: true
  - name: email-from
    type: string
    description: 发件人邮箱（默认 'code-review@example.com'）
    optional: true
  - name: email-api-url
    type: string
    description: 邮件 API endpoint（SendGrid v3 兼容，如 https://api.sendgrid.com/v3/mail/send）
    optional: true
  - name: email-api-key
    type: string
    description: 邮件 API key（Bearer token）
    optional: true
  - name: pagerduty-key
    type: string
    description: PagerDuty Events API v2 integration key
    optional: true
  - name: file
    type: string
    description: 关联的文件路径
    optional: true
  - name: line
    type: number
    description: 关联的行号
    optional: true
  - name: pr-number
    type: number
    description: 关联的 PR 编号
    optional: true
  - name: repository
    type: string
    description: 关联的仓库名称
    optional: true
---

## 告警通知任务

### 任务目标
将代码审查过程中产生的关键事件（如 critical finding、规则违反、扫描失败等）以告警形式发送到 Slack / Email / PagerDuty 等多渠道，确保关键问题能被及时感知并处理。告警按 severity 自动路由：高严重度触发所有渠道（含 PagerDuty），中严重度触发 Slack + Email，低严重度仅触发 Slack。

### 渠道与严重度路由策略

| Severity | Slack | Email | PagerDuty |
|----------|-------|-------|-----------|
| critical | ✅ | ✅ | ✅ |
| high     | ✅ | ✅ | ✅ |
| medium   | ✅ | ✅ | ❌ |
| low      | ❌ | ❌ | ❌ |
| info     | ❌ | ❌ | ❌ |

> 路由阈值可配置：`--slack-min-severity` / `--email-min-severity` / `--pagerduty-min-severity`

### 渠道实现

1. **Slack**：使用 Slack Incoming Webhook（`POST <webhook-url>`），消息包含彩色 attachment（critical=红 / high=橙 / medium=黄 / low=蓝 / info=灰）
2. **Email**：通过 HTTP API 发送（兼容 SendGrid v3 `/mail/send`），邮件正文为纯文本，主题格式 `[Code Review Alert] [SEVERITY] <title>`
3. **PagerDuty**：使用 Events API v2（`POST https://events.pagerduty.com/v2/enqueue`），自动生成 `dedup_key` 用于事件去重

### 使用方式

```bash
# 发送 critical 告警到所有渠道
code-review alert \
  --severity critical \
  --message "SQL injection detected in src/db.ts:42" \
  --title "Critical Security Finding" \
  --source security-review \
  --file src/db.ts --line 42 \
  --slack-url https://hooks.slack.com/services/T0/B0/xxx \
  --email-to alice@example.com,bob@example.com \
  --email-api-url https://api.sendgrid.com/v3/mail/send \
  --email-api-key SG.xxx \
  --pagerduty-key abc123def456

# 仅发送 Slack 告警（low severity 也会被忽略，需 medium 以上）
code-review alert --severity medium --message "Found 3 medium issues" --slack-url https://hooks.slack.com/...

# 自定义路由阈值
code-review alert --severity low --message "Low severity issue" \
  --slack-url https://hooks.slack.com/... \
  --slack-min-severity low
```

### 输出格式

输出为 JSON 数组，包含每个渠道的发送结果：

```json
[
  {
    "channel": "slack",
    "ok": true,
    "status": 200,
    "target": "https://hooks.slack.com/services/...",
    "alertId": "alert_1717171200000_abc12345"
  },
  {
    "channel": "pagerduty",
    "ok": false,
    "status": 400,
    "error": "HTTP 400 Bad Request",
    "target": "https://events.pagerduty.com/v2/enqueue",
    "alertId": "alert_1717171200000_abc12345"
  }
]
```

### 重试策略

- 网络错误 / 5xx 状态码 / 429：自动重试（指数退避，默认重试 1 次）
- 4xx 状态码（非 429）：不重试，直接返回失败结果
- 单个渠道失败不影响其他渠道

### 告警场景

1. **Critical Finding**：审查发现 critical 级别安全漏洞（SQL 注入 / RCE / 越权），立即触发 PagerDuty 唤醒值班工程师
2. **扫描失败**：扫描管道因配置错误 / 依赖缺失失败，通过 Email 通知所有维护者
3. **合规违规**：发现违反 OWASP Top 10 / CWE Top 25 的问题，通过 Slack 通知安全团队
4. **大 PR 警告**：检测到超大 PR（超过阈值），通过 Slack 提醒 reviewer 拆分

## Examples

### 场景 1：发送 critical 安全告警
当安全审查发现 critical 级别 SQL 注入时，触发所有渠道告警。

```bash
code-review alert \
  --severity critical \
  --title "SQL Injection in src/db.ts" \
  --message "Unparameterized SQL query detected at src/db.ts:42" \
  --source security-review \
  --file src/db.ts --line 42 \
  --slack-url https://hooks.slack.com/services/T0/B0/xxx \
  --email-to security@example.com \
  --email-api-url https://api.sendgrid.com/v3/mail/send \
  --email-api-key SG.xxx \
  --pagerduty-key abc123def456
```

### 场景 2：仅发送 Slack 告警
当发现 medium 级别问题时，仅通知 Slack（PagerDuty 不触发，Email 不触发除非显式配置）。

```bash
code-review alert \
  --severity medium \
  --message "Found 3 medium issues in PR #42" \
  --slack-url https://hooks.slack.com/services/T0/B0/xxx \
  --pr-number 42
```

### 场景 3：低严重度自定义阈值
默认 low/info 不触发任何渠道，但可通过 `--slack-min-severity low` 覆盖阈值。

```bash
code-review alert \
  --severity low \
  --message "Low severity style issue" \
  --slack-url https://hooks.slack.com/services/T0/B0/xxx \
  --slack-min-severity low
```
