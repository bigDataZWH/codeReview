# OpenCode 代码审查集成配置

OpenCode 集成配置包，提供 AI 驱动的代码审查能力，支持多 Agent DAG 编排、安全专项审查、变更影响分析和置信度评估。

## 目录结构

```
opencode-config/
├── opencode.jsonc           # 主配置文件
├── .opencode/
│   ├── commands/            # 命令定义
│   │   ├── review.md        # 代码审查（DAG编排）
│   │   ├── review-pr.md     # PR代码审查
│   │   ├── scan.md          # 全量代码扫描
│   │   ├── security-review.md  # 安全专项审查
│   │   ├── impact.md        # 变更影响分析
│   │   ├── reflect.md       # 置信度评估
│   │   ├── dashboard.md     # 仪表盘数据生成
│   │   ├── metrics.md       # 度量指标查询
│   │   └── feedback.md      # Finding反馈
│   ├── agents/              # Agent定义
│   │   ├── code-reviewer.md
│   │   ├── security-reviewer.md
│   │   ├── impact-analyzer.md
│   │   └── reflector.md
│   ├── rules/               # 规则定义
│   │   ├── quality-rules.md
│   │   ├── security-rules.md
│   │   └── false-positive-filters.md
│   └── plugins/             # 插件
│       └── post-process.js  # 后处理插件
└── README.md
```

## 安装方式

### 方式一：npm 包内置（推荐）

当 `code-review` npm 包安装完成后，配置文件已内置在包中，无需额外安装：

```bash
npm install code-review
```

使用时通过包命令直接调用，配置文件自动加载。

### 方式二：cp -r 复制

将配置目录复制到目标项目：

```bash
# 从 npm 包中复制
cp -r node_modules/code-review/opencode-config .

# 或从源码目录复制
cp -r /path/to/code-review-pkg/opencode-config .
```

复制后可根据项目需求自定义修改配置，修改不会影响原包。

### 方式三：symlink 链接

创建符号链接，保持配置与原包同步更新：

```bash
# 从 npm 包创建链接
ln -s node_modules/code-review/opencode-config .

# 或从源码目录创建链接
ln -s /path/to/code-review-pkg/opencode-config .
```

适合需要始终使用最新配置的场景，但注意修改会影响原配置。

## 使用说明

### 前置条件

1. 安装 OpenCode CLI：`npm install -g @opencode/cli`
2. 配置 API 密钥：`opencode config set api-key YOUR_KEY`
3. 确保项目根目录存在 `.opencode/` 目录或 `opencode.jsonc` 文件

### 快速开始

```bash
# 进入项目目录
cd your-project

# 初始化 OpenCode 配置（如需自定义）
opencode init

# 执行代码审查
opencode run review

# 执行 PR 审查
opencode run review-pr -- 123

# 执行全量扫描
opencode run scan -- --path ./src --language typescript
```

### 审查流程

代码审查采用 **DAG（有向无环图）** 编排，按以下顺序执行：

```
第一层（并行）          第二层（串行）         第三层（串行）
┌─────────────────┐      ┌──────────────┐      ┌──────────────┐
│ rule-engine     │      │              │      │              │
│ code-reviewer   │ ──→  │ impact-analy │ ──→  │  reflector   │
│ security-rev    │      │              │      │              │
└─────────────────┘      └──────────────┘      └──────────────┘
```

- **第一层**：规则引擎、代码审查、安全审查并行执行
- **第二层**：依赖第一层完成后，执行变更影响分析
- **第三层**：依赖第二层完成后，执行置信度评估和假阳性过滤

## 命令列表

| 命令 | 描述 | 参数 |
|------|------|------|
| `review` | 审查当前分支代码变更（DAG编排） | 无 |
| `review-pr` | 审查指定 PR 的代码变更 | `$ARGUMENTS` - PR 编号 |
| `scan` | 全量扫描指定目录代码问题 | `--path`, `--language`, `--limit`, `--exclude` |
| `security-review` | 安全专项代码审查 | 无 |
| `impact` | 变更影响范围分析 | 无 |
| `reflect` | 对审查发现进行置信度评估 | `$ARGUMENTS` - findings JSON |
| `dashboard` | 生成仪表盘数据 | `--sessions`, `--findings`, `--tokenConsumed` |
| `metrics` | 展示度量指标 | 无 |
| `feedback` | 提交 finding 反馈 | `--findingId`, `--action`, `--reason` |

### 命令详情

#### review - 代码审查

```bash
opencode run review
```

审查当前分支与 `main` 分支的差异，按 DAG 顺序编排多个审查 Agent。

#### review-pr - PR 代码审查

```bash
opencode run review-pr -- <PR_NUMBER>
```

审查指定 PR 的代码变更，自动获取 PR 信息和 diff。

#### scan - 全量代码扫描

```bash
opencode run scan -- --path ./src --language typescript --limit 50 --exclude "node_modules/**"
```

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `path` | string | 扫描目录路径 | "." |
| `language` | string[] | 指定语言过滤 | 自动识别 |
| `limit` | number | 限制扫描文件数量 | 0（不限制） |
| `exclude` | string[] | 排除模式（glob） | 无 |

#### feedback - 提交反馈

```bash
opencode run feedback -- --findingId "xxx" --action false-positive --reason "误报"
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `findingId` | string | finding 的唯一标识符 |
| `action` | string | 反馈动作：`false-positive` 或 `accept` |
| `reason` | string | 反馈原因（可选） |

## 配置说明

### 主配置文件：opencode.jsonc

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-5",
  "agent": {
    "code-reviewer": { ... },
    "security-reviewer": { ... },
    "impact-analyzer": { ... },
    "reflector": { ... }
  },
  "mcp": {
    "code-review-graph": {
      "type": "local",
      "command": ["code-review-graph", "serve"],
      "enabled": false
    }
  }
}
```

### 配置字段说明

| 字段 | 说明 |
|------|------|
| `model` | 顶层模型配置，所有 Agent 自动继承，可在 Agent 内单独声明覆盖 |
| `agent.*` | Agent 定义，包含 `description`、`prompt`、`tools` 字段 |
| `mcp.*` | MCP 工具配置，`code-review-graph` 用于代码图谱分析 |

### Agent 定义

每个 Agent 包含以下配置：

- `description`: Agent 描述
- `prompt`: Agent 系统提示词
- `tools.write`: 是否允许写入文件
- `tools.edit`: 是否允许编辑文件

### MCP 配置

`code-review-graph` MCP 在以下情况自动启用：

- 当 diff 文件数 >= 30（大 PR 阈值）时自动启用
- 可通过 `mcp.code-review-graph.enabled` 显式覆盖

## Finding 输出格式

所有审查命令输出统一格式的 JSON 数组：

```json
[
  {
    "file": "src/app.ts",
    "line": 42,
    "severity": "high",
    "category": "security",
    "message": "SQL injection vulnerability",
    "suggestion": "Use parameterized queries",
    "confidence": 0.9,
    "source": "ai"
  }
]
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `file` | string | 文件路径（必需） |
| `line` | number | 行号（必需） |
| `severity` | string | 严重程度：`critical` / `high` / `medium` / `low` / `info` |
| `category` | string | 类别：`security` / `logic` / `performance` / `maintainability` / `test` |
| `message` | string | 问题描述（必需） |
| `suggestion` | string | 修复建议（可选） |
| `confidence` | number | 置信度（0-1） |
| `source` | string | 来源：`rule`（规则引擎） / `ai`（AI审查） |

## 语言支持

支持多种编程语言的智能审查：

- **TypeScript/JavaScript**: 类型安全、`any` 使用、泛型约束、异步错误处理
- **Python**: 类型提示、可变默认参数、资源释放、异常处理
- **Go**: 错误处理、goroutine 泄漏、并发安全、defer 使用
- **Rust**: unsafe 使用、clone 优化、生命周期、borrow checker
- **Java**: 空指针处理、资源泄漏、异常处理、并发安全
- **C/C++**: 内存管理、缓冲区溢出、RAII 模式、未定义行为

## 后处理插件

`post-process.js` 插件在 AI 审查完成后自动执行以下操作：

1. **定位修正**：根据 diff 修正 finding 的行号
2. **误报过滤**：应用静态规则过滤已知假阳性
3. **去重**：移除重复的 findings
4. **置信度评估**：调用 reflector Agent 评估置信度

## 故障排查

### 常见问题

#### Q: OpenCode CLI 找不到配置文件

**A:** 确保当前目录存在 `.opencode/` 目录或 `opencode.jsonc` 文件。可通过以下命令检查：

```bash
ls -la | grep opencode
```

如果不存在，使用方式二或方式三安装配置。

#### Q: 审查命令执行失败

**A:** 检查以下事项：

1. 确认 API 密钥已配置：`opencode config get api-key`
2. 检查网络连接是否正常
3. 查看详细错误日志：`opencode run review --debug`

#### Q: Finding 行号不准确

**A:** 行号不准确可能是因为：

1. diff 与实际文件不一致，尝试重新生成 diff
2. 后处理插件未正确执行，检查 `code-review` 包是否安装

#### Q: MCP 服务无法启动

**A:** 如果 `code-review-graph` MCP 启用但无法启动：

1. 检查 `code-review-graph` 命令是否可用：`which code-review-graph`
2. 在配置中禁用 MCP：`"enabled": false`
3. 手动启动 MCP 服务：`code-review-graph serve`

#### Q: 输出不是有效 JSON

**A:** 如果 AI 返回的不是有效 JSON，后处理插件会尝试解析多种格式：

- 纯 JSON 数组字符串
- Markdown 代码块中的 JSON
- 已解析的数组

如果解析失败，会返回空数组并输出警告。

### 日志调试

启用调试模式获取详细日志：

```bash
opencode run review --debug
```

查看 OpenCode 日志目录：

```bash
# macOS/Linux
~/.opencode/logs/

# Windows
%USERPROFILE%\.opencode\logs\
```

## 支持

如有问题或建议，欢迎提交 Issue 或联系开发团队。