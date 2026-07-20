# codeReview

基于 OpenCode 平台的 **AI 代码审查确定性管道**。将代码审查中所有可验证、确定性的环节（Diff 解析、文件过滤、规则匹配、行号修正、误报过滤、评论发布）沉淀为独立模块，与 AI 能力（LLM 评审 / 反思 / MCP 图谱）通过 prompt 接口解耦衔接。

[![CI](https://github.com/bigDataZWH/codeReview/actions/workflows/code-review.yml/badge.svg)](https://github.com/bigDataZWH/codeReview/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 目录

- [核心特性](#核心特性)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [架构总览](#架构总览)
- [快速开始](#快速开始)
- [CLI 命令](#cli-命令)
- [编程式 API](#编程式-api)
- [审查规则](#审查规则)
- [OpenCode 集成](#opencode-集成)
- [GitHub Actions 集成](#github-actions-集成)
- [测试](#测试)
- [开发](#开发)
- [许可证](#许可证)

---

## 核心特性

- **确定性管道**：6 步流水线（解析 → 过滤 → 打包 → 规则标注 → MCP 上下文 → Prompt 构建），所有可验证逻辑与 AI 解耦，可单测、可回放
- **多场景审查**：通用 review / security / scan / impact 四种内置 prompt 模板，共用同一管道
- **规则引擎**：内置 5 类规则（NPE / Quality / Security / Thread-Safety / XSS），支持 `regex` / `contains_any` / `contains_all` / `line_count_gt` / `file_size_gt` 五种匹配方式
- **后处理**：行号修正（clamp 到 hunk 范围）+ 误报硬规则过滤 + IoU 去重，避免重复评论
- **AI 反思**：通过 LLM 对 Finding 进行批量置信度评估，过滤低置信度误报
- **MCP 图谱**：可选接入 `code-review-graph` MCP Server，提供爆炸半径（caller / callee / test）和风险评分
- **PR 评论发布**：支持 GitHub inline 评论 + Sticky summary，`replace` / `incremental` 两种模式
- **中间件机制**：`PipelineMiddleware` 支持 `afterParse` / `afterFilter` / `afterBuild` 钩子扩展

## 技术栈

| 项 | 选型 |
| --- | --- |
| 语言 | TypeScript 5.x + ES2022 (ESM) |
| 运行时 | Node.js >= 18 |
| 构建 | tsup |
| 测试 | Vitest |
| 包管理 | npm |

## 项目结构

```
.
├── code-review-pkg/        # 主包
│   ├── src/
│   │   ├── diff-parser.ts           # Git diff 解析为 FileDiff[]
│   │   ├── file-filter.ts           # 过滤 / 分组 / 打包
│   │   ├── rule-engine.ts           # 确定性规则匹配
│   │   ├── prompt-builder.ts        # 构建 review/security/scan/impact prompt
│   │   ├── mcp-adapter.ts           # code-review-graph MCP 客户端
│   │   ├── post-processor.ts        # 行号修正 + 误报过滤 + IoU 去重
│   │   ├── ai-reflection.ts         # LLM 反思评估
│   │   ├── comment-publisher.ts     # GitHub PR 评论发布
│   │   ├── pipeline.ts              # 管道编排（含中间件）
│   │   ├── format.ts                # Markdown / JSON 输出
│   │   ├── validation.ts            # Finding / Config 校验
│   │   ├── constants.ts             # 默认配置常量
│   │   ├── types.ts                 # 统一类型定义
│   │   ├── utils.ts                 # 通用工具函数
│   │   ├── cli.ts                   # CLI 入口
│   │   └── index.ts                 # 公共 API 导出
│   ├── review-rules/                # 内置规则集（JSON）
│   │   ├── npe.json
│   │   ├── quality.json
│   │   ├── security.json
│   │   ├── thread-safety.json
│   │   └── xss.json
│   ├── opencode-config/             # OpenCode 集成配置
│   │   ├── opencode.jsonc           # Agent + MCP 主配置
│   │   └── .opencode/
│   │       ├── agents/              # 3 个 Agent 定义
│   │       ├── commands/            # 4 个自定义命令
│   │       ├── rules/               # 审查规则指令
│   │       └── plugins/             # post-process 插件
│   ├── scripts/                     # 辅助脚本
│   ├── tests/                       # 单元 + 集成测试
│   ├── .github/workflows/           # CI 工作流
│   └── SPEC.md                      # 技术规格说明书
├── code-review/            # 静态 HTML 报告查看器
└── README.md
```

## 架构总览

```
Git Diff 文本
   │
   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ diff-parser  │ → │ file-filter  │ → │ bundleFiles  │
│ FileDiff[]   │   │ 过滤/排除    │   │ 关联文件打包 │
└──────────────┘   └──────────────┘   └──────────────┘
                                              │
                                              ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│prompt-builder│ ← │ mcp-adapter  │ ← │ rule-engine  │
│ 构建 AI 提示│   │ 图谱上下文   │   │ 规则标注     │
└──────────────┘   └──────────────┘   └──────────────┘
        │
        ▼  (AI 产出 Finding)
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│post-processor│ → │ai-reflection │ → │comment-publisher│
│ 行号修正+误报│   │ LLM 二次反思 │   │ 发布 PR 评论 │
└──────────────┘   └──────────────┘   └──────────────┘
```

**核心数据流**：`FileDiff[]` → `FileBundle[]` → `AnnotatedBundle[]` → `PipelineResult` → `Finding[]` → 过滤后的 `Finding[]`

## 快速开始

### 安装

```bash
# 全局安装（用于 CLI）
npm install -g code-review

# 或本地开发
cd code-review-pkg
npm install
npm run build
```

### 命令行使用

```bash
# 解析 diff 为结构化 JSON
git diff | code-review parse

# 生成 review prompt（管道 dry-run 输出）
git diff | code-review review

# 安全审查
git diff | code-review security-review

# 全量扫描
git diff | code-review scan

# 影响范围分析
git diff | code-review impact

# 发布评论到 GitHub PR
code-review publish \
  --owner bigDataZWH \
  --repo codeReview \
  --pr 42 \
  --file findings.json \
  --token "$GITHUB_TOKEN" \
  --mode incremental
```

## CLI 命令

| 命令 | 说明 |
| --- | --- |
| `parse` | 从 stdin 读取 diff，输出结构化 `FileDiff[]` JSON |
| `review` | 运行通用代码审查管道，输出构建好的 prompt |
| `security-review` | 运行安全专项审查（使用安全 prompt 模板） |
| `scan` | 全量扫描管道 |
| `impact` | 变更影响范围分析 |
| `publish` | 将 `findings.json` 发布为 GitHub PR inline 评论 |

## 编程式 API

```typescript
import {
  runPipeline,
  applyFindings,
  runSecurityPipeline,
  parseDiff,
  buildReviewPrompt,
  publishReview,
  loadRules,
  DEFAULT_FILTER_CONFIG,
} from 'code-review';

// 1. 运行管道（确定性部分）
const result = await runPipeline(diffText, {
  filter: DEFAULT_FILTER_CONFIG,
  rules: loadRules('./review-rules'),
  mcpEnabled: true,
  dryRun: false,
});

// 2. 将 AI 返回的 findings 回填到 result（自动行号修正 + 误报过滤）
const final = applyFindings(result, aiFindings, customFPRules);

// 3. 发布到 PR
await publishReview({
  findings: final.processedFindings ?? [],
  owner: 'bigDataZWH',
  repo: 'codeReview',
  prNumber: 42,
  token: process.env.GITHUB_TOKEN!,
  mode: 'incremental',
});
```

### 管道中间件

```typescript
import { runPipelineWithMiddleware } from 'code-review';

const result = await runPipelineWithMiddleware(diffText, config, [
  {
    name: 'log-parsed',
    afterParse: (diffs) => {
      console.log(`Parsed ${diffs.length} files`);
      return diffs;
    },
  },
  {
    name: 'enrich-result',
    afterBuild: (r) => ({ ...r, /* custom fields */ }),
  },
]);
```

## 审查规则

规则以 JSON 文件形式存放在 [review-rules/](code-review-pkg/review-rules)，支持 5 种匹配方式：

| 类型 | 说明 |
| --- | --- |
| `regex` | 正则匹配 |
| `contains_any` | 包含任一关键词 |
| `contains_all` | 包含全部关键词 |
| `line_count_gt` | 文件行数大于阈值 |
| `file_size_gt` | 文件大小大于阈值 |

**示例规则**（`security.json`）：

```json
[
  {
    "id": "sql-injection",
    "name": "SQL 注入检测",
    "severity": "high",
    "category": "security",
    "patterns": [
      { "type": "regex", "pattern": "(execute|query)\\s*\\(\\s*[\"'].*\\+", "message": "检测到字符串拼接构造 SQL" },
      { "type": "contains_any", "items": ["String sql =", "const sql =", "sql :="], "message": "检测到直接赋值 SQL 字符串" }
    ]
  }
]
```

**内置规则集**：

| 文件 | 类别 | 覆盖 |
| --- | --- | --- |
| `npe.json` | logic | Java/Kotlin 空指针解引用、TS 可选链缺失 |
| `quality.json` | quality | TypeScript `any` 类型检测 |
| `security.json` | security | SQL 注入 |
| `thread-safety.json` | security | 共享可变状态检测 |
| `xss.json` | security | innerHTML / document.write / v-html 检测 |

## OpenCode 集成

[opencode-config/](code-review-pkg/opencode-config) 目录提供完整的 OpenCode 集成：

### Agent 定义（`opencode.jsonc`）

| Agent | 模型 | 职责 |
| --- | --- | --- |
| `code-reviewer` | claude-sonnet-4-5 | 通用代码审查（质量/逻辑/性能/可维护性） |
| `security-reviewer` | claude-opus-4-1 | 安全专项审查（注入/认证/加密/数据泄露） |
| `impact-analyzer` | claude-haiku-4-5 | 变更影响半径与风险评分 |

### MCP 配置

```jsonc
{
  "mcp": {
    "code-review-graph": {
      "type": "local",
      "command": ["code-review-graph", "serve"],
      "enabled": false  // 默认关闭，按需启用
    }
  }
}
```

### 自定义命令

`review` / `review-pr` / `scan` / `security-review` 四个命令封装常用审查流程，详情见 [`.opencode/commands/`](code-review-pkg/opencode-config/.opencode/commands)。

## GitHub Actions 集成

仓库内置两个工作流：

### 1. 通用代码审查（[code-review.yml](code-review-pkg/.github/workflows/code-review.yml)）

```yaml
on:
  pull_request:
    types: [opened, synchronize]
permissions:
  pull-requests: write
  contents: read
```

触发：PR 打开或同步时，对所有变更文件运行 review 管道。

### 2. 安全专项审查（[security-review.yml](code-review-pkg/.github/workflows/security-review.yml)）

触发：PR 涉及 `src/**` / `lib/**` / `api/**` / `internal/**` 路径时，运行 security-review 管道。

**所需 Secrets**：

- `ANTHROPIC_API_KEY` — Anthropic API Key（用于 LLM 审查与反思）
- `GITHUB_TOKEN` — 默认提供，用于发布 PR 评论

## 测试

```bash
cd code-review-pkg

# 运行全部测试
npm test

# 监听模式
npm run test:watch

# 覆盖率
npm run test:coverage

# 类型检查
npm run lint
```

测试覆盖每个模块的纯函数（单元测试）以及管道端到端流程（集成测试），fixtures 位于 [tests/fixtures/](code-review-pkg/tests/fixtures)。

## 开发

```bash
cd code-review-pkg

# 安装依赖
npm install

# 构建（tsup）
npm run build

# CI 流程（lint + test）
npm run ci
```

**关键常量**（[constants.ts](code-review-pkg/src/constants.ts)）：

| 常量 | 默认值 | 说明 |
| --- | --- | --- |
| `MAX_DIFF_SIZE` | 5,000,000 | diff 最大字符数 |
| `DEFAULT_IOU_THRESHOLD` | 0.5 | 去重 IoU 阈值 |
| `HIGH_CONFIDENCE_THRESHOLD` | 0.85 | 高置信度阈值 |
| `maxPatchLength` | 100,000 | 单文件 patch 最大长度 |

## 许可证

MIT
