# OpenCode 快速集成指南

本指南面向首次使用 `code-review` 的 OpenCode 用户，5 分钟完成集成并触发首次代码审查。

## 前置条件

| 项 | 最低 | 推荐 |
|---|---|---|
| Node.js | 18.0 | 20 LTS |
| OpenCode CLI | 0.1+ | 最新版 |
| Git | 2.30+ | 2.40+ |
| Anthropic API Key | — | 必填（用于 Agent 调用） |

OpenCode 安装参考：<https://opencode.ai/docs>

## Step 1：安装 code-review

```bash
# 全局安装（推荐）
npm install -g code-review

# 验证
code-review --version
# 或查看帮助
code-review
```

## Step 2：在项目中生成配置

```bash
cd your-project
code-review init
```

交互式向导会问：

1. 项目语言（typescript / javascript / python / go / rust / java / cpp / c）
2. 审查强度（lenient 宽松 / standard 标准 / strict 严格）
3. 是否启用安全审查（Y/n）
4. 部署方式（cli / github-actions）

完成后会在当前目录生成：

```
opencode.jsonc                       # OpenCode 主配置（顶层 model + agent 定义）
.opencode/agents/*.md                # 4 个 Agent 定义
.opencode/commands/*.md              # 4 个自定义命令（/review、/security-review、/scan、/review-pr）
review-rules/security.json           # 安全规则
review-rules/quality.json            # 质量规则
.github/workflows/code-review.yml    # 仅当选择 github-actions 部署
```

## Step 3：配置 Anthropic API Key

```bash
# 方式 1：环境变量（推荐）
export ANTHROPIC_API_KEY=sk-ant-...
```

或写入 OpenCode 全局配置 `~/.config/opencode/opencode.json`：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "anthropic": {
      "apikey": "sk-ant-..."
    }
  }
}
```

## Step 4：在 OpenCode IDE 中触发审查

### 4.1 启动 OpenCode

```bash
opencode
```

### 4.2 触发 /review 命令

在 OpenCode 会话中输入：

```
/review
```

OpenCode 会自动执行：

1. `git diff main...HEAD --stat` —— 变更统计
2. `git diff main...HEAD` —— 详细 diff
3. 调用 `code-reviewer` Agent 审查并输出 findings

### 4.3 触发其他命令

```
/security-review    # 安全专项审查（需在 init 时启用）
/scan               # 全量扫描指定目录
/review-pr 42       # 审查指定 PR（需要 gh CLI）
```

## Step 5：查看审查结果

OpenCode 会在会话中直接显示 Agent 输出的 findings，格式如：

```json
[
  {
    "file": "src/app.ts",
    "line": 42,
    "severity": "high",
    "category": "security",
    "description": "检测到 SQL 字符串拼接",
    "suggestion": "改用参数化查询"
  }
]
```

## 常见场景

### 场景 A：本地开发时随手审查

```bash
git add -p                                              # 暂存改动
git diff --cached | code-review review > review-prompt.txt
```

把 `review-prompt.txt` 内容粘贴到 OpenCode 会话，或直接 `/review`。

### 场景 B：在 PR 中自动审查

1. `init` 时选择 `github-actions` 部署
2. 推送分支后自动触发 `.github/workflows/code-review.yml`
3. PR 中会自动出现 inline 评论

### 场景 C：安全专项审查

```bash
# 针对包含敏感逻辑的变更
git diff main...HEAD | code-review security-review
```

或在 OpenCode 中 `/security-review`。

### 场景 D：全量扫描指定路径

```bash
# 注意：scan 读 stdin，需先构造 diff
code-review scan
```

或在 OpenCode 中 `/scan src/`。

### 场景 E：发布 findings 到 PR

```bash
code-review publish \
  --owner your-name \
  --repo your-repo \
  --pr 42 \
  --file findings.json \
  --token "$GITHUB_TOKEN" \
  --mode incremental
```

## 进阶配置

### 自定义审查规则

编辑 `review-rules/security.json` 和 `review-rules/quality.json`，添加自定义规则：

```json
{
  "id": "no-console-log",
  "name": "禁止 console.log",
  "severity": "low",
  "category": "quality",
  "patterns": [
    { "type": "regex", "pattern": "console\\.log\\(", "message": "生产代码不应使用 console.log" }
  ]
}
```

### 启用知识图谱 MCP（可选）

把 `opencode.jsonc` 中 `mcp.code-review-graph.enabled` 改为 `true`：

```bash
npm install -g code-review-graph
code-review-graph serve &
```

启用后 Agent 可查询调用链与爆炸半径，提升审查精度。不可用时自动降级为 grep。

### 切换模型

修改 `opencode.jsonc` 顶层 `model` 字段：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-opus-4-1-20250805",
  "agent": { "..." : "..." }
}
```

所有 Agent 自动继承顶层主模型。如需某个 Agent 用不同模型，在该 agent 内单独声明 `model` 覆盖。

## 故障排查

| 症状 | 原因 | 解决 |
|---|---|---|
| `LLM config is invalid` | API Key 未配置 | 检查 `ANTHROPIC_API_KEY` 环境变量 |
| Agent 输出为空 | diff 为空 | 确认 `git diff main...HEAD` 有内容 |
| `/review` 命令未触发 | OpenCode 未识别配置 | 重启 OpenCode，或检查 `opencode.jsonc` 语法 |
| MCP 不可用降级 grep | `code-review-graph` 未安装 | `npm install -g code-review-graph` 后重启 |
| 中文乱码 | Windows PowerShell 编码 | `chcp 65001` 切换到 UTF-8 |

## 下一步

- 阅读 [README.md](../README.md) 了解完整 API
- 阅读 [architecture.md](./architecture.md) 了解六层架构
- 阅读 [SPEC.md](../SPEC.md) 了解设计哲学
- 自定义 `.opencode/agents/*.md` 调整 Agent prompt
