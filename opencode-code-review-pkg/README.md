# OpenCode AI 代码检视系统

> 基于 OpenCode 平台的智能代码审查解决方案 — 把"AI 审 PR"从口号变成确定性管道。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-blue)](./package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](./tsconfig.json)
[![Test](https://img.shields.io/badge/tests-1092%20passed-brightgreen)](#测试)
[![Coverage](https://img.shields.io/badge/coverage-96.38%25-brightgreen)](#测试)

`opencode-code-review` 在 AI 与 PR 之间架设一条**确定性管道**：把 git diff 解析、文件过滤、规则匹配、上下文增强、Prompt 拼装、误报过滤、评论发布等环节全部固化为可测试、可缓存、可编排的代码。AI 只在"该它说话的时候"说话，从而把误报率、Token 成本、运行时延压在工程可控范围内。

- 远程仓库：<https://github.com/bigDataZWH/codeReview>
- 适用场景：GitHub PR 自动审查、本地分支预审、安全专项扫描、影响半径分析
- 设计原则：**确定性优先，AI 辅助**；**管道可缓存**；**Agent 可编排**；**反馈可闭环**

---

## 目录

- [特性](#特性)
- [快速开始](#快速开始)
- [架构概览](#架构概览)
- [核心模块](#核心模块)
- [OpenCode 配置](#opencode-配置)
- [自定义规则](#自定义规则)
- [CI/CD 集成](#cicd-集成)
- [测试](#测试)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

---

## 特性

- **确定性管道**：把 diff 解析 → 文件过滤 → 规则匹配 → Prompt 构建 → 后处理 → 评论发布固化为可测试的纯函数链；任意阶段都可单独调用、缓存或替换。
- **规则引擎**：基于 YAML/JSON 声明规则，内置 `regex`、`contains_any`、`contains_all`、`line_count_gt`、`file_size_gt` 五种匹配器；支持按语言、按严重级别、按目录过滤。
- **三阶段后处理**：①行号修正器 (Locator) 把 AI 给出的偏移行号 clamp 回真实 hunk；②误报硬规则过滤器 (FalsePositiveFilter) 内置 17 条预编译正则规则；③IoU 去重器 (Deduplicator) 防止 CI 增量场景重复发评论。
- **知识图谱集成**：通过 MCP 协议接入 `code-review-graph`，自动检索调用链 (caller/callee) 与测试覆盖，给出爆炸半径 (blast radius) 与风险评分；MCP 不可用时降级为 grep 全文检索。
- **反馈闭环**：`feedback` 模块记录人工标注的误报，分析误报模式 (FalsePositivePattern)，输出规则调优建议 (autoTuneRules)；`.opencode-review-ignore` 支持细粒度忽略配置。
- **多 Agent 编排**：`orchestrator` 模块以 DAG 描述审查会话，支持 `code-reviewer` / `security-reviewer` / `impact-analyzer` / `reflector` 四种 Agent 协作；内置 `withRetry`、`withFallback`、`callModelWithTimeout`、`batchProcess` 等弹性能力。
- **AI 反思**：`ai-reflection` 调用轻量模型对汇总后的 findings 做统一置信度评估，过滤低置信结果，自动校准 prompt。
- **三级缓存**：L1 内存 (LRU) + L2 磁盘 (持久化) + 智能失效策略，对 diff 解析、规则匹配、MCP 上下文按内容哈希缓存。
- **Token 成本优化**：`token-optimizer` 估算 Token 数与成本，按复杂度选择模型层级 (Haiku / Sonnet / Opus)，自动压缩上下文并在超出预算时截断。
- **状态持久化**：`state` 模块管理审查会话状态机，支持断点续审、历史趋势查询与度量摘要生成。
- **度量与仪表盘**：`metrics` 模块统一收集覆盖、质量、成本、效率四类指标，输出趋势桶 (TrendBucket) 与仪表盘数据 (DashboardData)。
- **渐进式输出**：`progress` 模块以事件流形式发布 `start` / `fileStart` / `fileComplete` / `fileError` / `complete` 事件，方便长 PR 实时反馈。
- **初始化向导**：`init-wizard` 根据语言、审查强度、部署模式生成开箱即用的 `opencode.jsonc` 与规则集。
- **CLI 一把梭**：内置 `parse / review / security-review / scan / impact / publish` 六个子命令，可直接接入 GitHub Actions。

---

## 快速开始

### 环境要求

| 项 | 最低版本 | 推荐 |
|---|---|---|
| Node.js | 18.0 | 20 LTS |
| npm | 9 | 10 |
| Git | 2.30 | 2.40+ |

### 安装

```bash
# 全局安装（CLI 用户）
npm install -g opencode-code-review

# 本地依赖
npm install opencode-code-review
```

### 基本使用

```bash
# 1. 解析 diff，输出结构化 JSON
git diff main...HEAD | opencode-code-review parse

# 2. 生成完整审查 prompt（推荐接 Agent）
git diff main...HEAD | opencode-code-review review > review-prompt.txt

# 3. 安全专项审查
git diff main...HEAD | opencode-code-review security-review

# 4. 全量扫描指定目录
opencode-code-review scan ./src

# 5. 影响半径分析
git diff main...HEAD | opencode-code-review impact

# 6. 将 findings 发布为 PR inline 评论
opencode-code-review publish \
  --owner bigDataZWH \
  --repo codeReview \
  --pr 42 \
  --file findings.json \
  --token "$GITHUB_TOKEN" \
  --mode incremental
```

### 以库形式调用

```typescript
import { runPipeline, parseDiff, loadRules, filterFalsePositives } from 'opencode-code-review';
import { readFileSync } from 'node:fs';

const diff = readFileSync(0, 'utf-8');
const rules = loadRules('./review-rules');

const result = await runPipeline(diff, {
  filter: { ignorePatterns: ['dist/**', '*.generated.*'] },
  bundle: {},
  rules,
  mcpEnabled: false,
});

// 假设 AI 输出 findings
const clean = filterFalsePositives(result.findings ?? []);
console.log(`保留 ${clean.length} 条 findings`);
```

更多示例参见 [SPEC.md](./SPEC.md) 与 `tests/` 目录。

---

## 架构概览

系统采用**六层架构**，自上而下逐层降级 AI 不确定性：

```
┌─────────────────────────────────────────────────────────┐
│ L1 触发层 (Trigger)     GitHub Action / CLI / OpenCode │
├─────────────────────────────────────────────────────────┤
│ L2 编排层 (Orchestrator) DAG 调度、超时、重试、降级     │
├─────────────────────────────────────────────────────────┤
│ L3 管道层 (Pipeline)     parse → filter → bundle → rule │
├─────────────────────────────────────────────────────────┤
│ L4 Agent 层             code-reviewer / security /     │
│                         impact-analyzer / reflector     │
├─────────────────────────────────────────────────────────┤
│ L5 状态层 (State)       会话状态机 / 三级缓存 / 反馈库  │
├─────────────────────────────────────────────────────────┤
│ L6 输出层 (Output)       comment-publisher / progress  │
└─────────────────────────────────────────────────────────┘
```

| 层 | 职责 | 关键模块 |
|---|---|---|
| L1 触发层 | 接收 diff、决定运行模式 | `cli.ts`、`.github/workflows/code-review.yml`、`opencode-config/.opencode/commands/` |
| L2 编排层 | 多 Agent DAG 调度、超时与降级 | `orchestrator.ts` |
| L3 管道层 | 解析、过滤、打包、规则匹配、prompt 构建 | `diff-parser` / `file-filter` / `rule-engine` / `prompt-builder` |
| L4 Agent 层 | 实际调用 LLM 完成 review/security/impact/reflection | `ai-reflection.ts` + OpenCode Agent |
| L5 状态层 | 会话持久化、缓存、反馈采集 | `state.ts` / `cache.ts` / `feedback.ts` |
| L6 输出层 | 发布 PR 评论、事件流推送 | `comment-publisher.ts` / `progress.ts` |

> 详细的六层架构解析、数据流图、模块依赖矩阵见 [`docs/architecture.md`](./docs/architecture.md)。

---

## 核心模块

下表列出全部对外导出的源码模块及其职责。完整 API 签名见 [`src/index.ts`](./src/index.ts)。

| 模块 | 源文件 | 职责 |
|---|---|---|
| **diff-parser** | `src/diff-parser.ts` | 将 unified diff 解析为 `FileDiff[]`；处理重命名、二进制、`No newline at end of file` 等边界 |
| **file-filter** | `src/file-filter.ts` | 按 glob 过滤、按目录分组、智能打包（i18n 对、测试对）、自动检测语言 |
| **rule-engine** | `src/rule-engine.ts` | 加载 YAML/JSON 规则并匹配文件内容，输出 `RuleAnnotation[]` |
| **mcp-adapter** | `src/mcp-adapter.ts` | 通过 MCP 调用 `code-review-graph`，检索调用链与爆炸半径；不可用时降级为 grep |
| **post-processor** | `src/post-processor.ts` | 三阶段后处理：行号修正 / 误报过滤 / IoU 去重 |
| **ai-reflection** | `src/ai-reflection.ts` | 调用轻量模型对 findings 做置信度评估，过滤低置信结果 |
| **pipeline** | `src/pipeline.ts` | 串联上述模块的主流程；支持中间件、批量、缓存 |
| **state** | `src/state.ts` | 会话状态机 + findings 持久化 + 断点续审 + 趋势统计 |
| **cache** | `src/cache.ts` | L1 内存 + L2 磁盘三级缓存，按内容哈希命中 |
| **feedback** | `src/feedback.ts` | 反馈采集、误报模式分析、忽略配置、规则调优建议 |
| **orchestrator** | `src/orchestrator.ts` | DAG 编排、`withRetry` / `withFallback` / `batchProcess` |
| **comment-publisher** | `src/comment-publisher.ts` | 发布 PR inline 评论、sticky summary、incremental 模式 |
| **prompt-builder** | `src/prompt-builder.ts` | 构建 review/security/impact/scan 四类 prompt，支持模板变量与变体 A/B |
| **token-optimizer** | `src/token-optimizer.ts` | Token 数与成本估算、按复杂度选模型、上下文压缩 |
| **metrics** | `src/metrics.ts` | 覆盖/质量/成本/效率四类度量，输出趋势桶与仪表盘数据 |
| **progress** | `src/progress.ts` | 渐进式事件流：`start` / `fileStart` / `fileComplete` / `complete` |
| **init-wizard** | `src/init-wizard.ts` | 交互式生成 `opencode.jsonc` 与初始规则集 |

辅助模块：

| 模块 | 文件 | 用途 |
|---|---|---|
| `types` | `src/types.ts` | 全量公共类型（`FileDiff`、`Finding`、`Rule`、`PipelineConfig` 等） |
| `format` | `src/format.ts` | findings → Markdown / JSON 输出 |
| `validation` | `src/validation.ts` | 运行时校验 `Finding` 与 `PipelineConfig` |
| `constants` | `src/constants.ts` | 默认阈值常量 |
| `utils` | `src/utils.ts` | `slugify` / `isCFile` / `severityOrder` 等纯函数 |

---

## OpenCode 配置

仓库 `opencode-config/` 目录提供可直接复制的 OpenCode 配置：

```
opencode-config/
├── opencode.jsonc              # 主配置：Agent 定义 + MCP 配置
└── .opencode/
    ├── agents/                 # 四个 Agent 的 prompt 定义
    │   ├── code-reviewer.md
    │   ├── security-reviewer.md
    │   ├── impact-analyzer.md
    │   └── reflector.md
    ├── commands/               # 四个自定义命令
    │   ├── review.md           # 审查当前分支
    │   ├── review-pr.md        # 审查指定 PR
    │   ├── security-review.md # 安全专项
    │   └── scan.md             # 全量扫描目录
    ├── rules/                  # 规则指令文档
    │   ├── security-rules.md
    │   ├── quality-rules.md
    │   └── false-positive-filters.md
    └── plugins/
        └── post-process.js     # 后处理钩子示例
```

### Agent 配置

`opencode.jsonc` 中预置了 4 个 Agent，分别承担不同职责：

| Agent | 模型 | 职责 |
|---|---|---|
| `code-reviewer` | `anthropic/claude-sonnet-4-5` | 通用代码审查：质量/逻辑/性能/可维护性 |
| `security-reviewer` | `anthropic/claude-opus-4-1-20250805` | 安全专项，三层分析方法论 |
| `impact-analyzer` | `anthropic/claude-haiku-4-5` | 变更影响半径分析，输出风险评分 |
| `reflector` | `anthropic/claude-haiku-4-5` | 对汇总 findings 做统一置信度评估 |

```jsonc
// opencode.jsonc 片段
{
  "agent": {
    "code-reviewer": {
      "description": "通用代码审查 Agent",
      "model": "anthropic/claude-sonnet-4-5",
      "tools": { "write": false, "edit": false }
    }
    // ... 其余 Agent
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

### 自定义命令

通过 `commands/*.md` 定义可被 OpenCode 触发的子任务。每个命令通过 `!` 指令嵌入 shell 片段，例如：

```markdown
---
description: 审查当前分支的代码变更
agent: code-reviewer
subtask: true
---

## 变更统计
!`git diff main...HEAD --stat`

## 详细变更
!`git diff main...HEAD`
```

### 启用知识图谱 MCP

将 `opencode.jsonc` 中 `mcp.code-review-graph.enabled` 改为 `true`，并确保本机已安装 `code-review-graph` CLI：

```bash
npm install -g code-review-graph
code-review-graph serve &
```

不可用时管道会自动降级为 `grep` 全文检索，参见 `src/mcp-adapter.ts` 的 `getReviewContextWithFallback`。

---

## 自定义规则

规则支持 **YAML** 与 **JSON** 两种格式，存放于 `review-rules/` 目录。`loadRules()` 会递归读取目录下所有 `.json` / `.yaml` / `.yml` 文件。

### 规则字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 唯一标识，建议 `kebab-case` |
| `name` | string | 是 | 人类可读名称（中文） |
| `severity` | `critical` \| `high` \| `medium` \| `low` | 是 | 严重级别 |
| `category` | string | 是 | 类别（`security` / `quality` / `performance` 等） |
| `language` | string[] | 否 | 限制生效语言（`typescript`、`python`、`go` …） |
| `patterns` | RulePattern[] | 是 | 匹配模式列表，命中任一即触发 |
| `group` | string | 否 | 规则分组（用于一键启停） |
| `description` | string | 否 | 详细描述 |
| `disabled` | boolean | 否 | 是否禁用 |
| `excludePatterns` | string[] | 否 | 命中后跳过的文件 glob |

### 匹配类型

| `type` | 必填字段 | 触发条件 |
|---|---|---|
| `regex` | `pattern` | 正则匹配行内容，可用 `flags` 配置 |
| `contains_any` | `items` | 行内容包含数组中任意字符串 |
| `contains_all` | `items` | 文件包含数组中所有字符串 |
| `line_count_gt` | `threshold` | 文件总行数大于阈值 |
| `file_size_gt` | `threshold` | 文件字节数大于阈值 |

### YAML 示例

```yaml
# review-rules/sql-injection.yaml
id: sql-injection-string-concat
name: "SQL 注入 - 字符串拼接"
severity: high
category: security
language: [python, java, go, typescript]
patterns:
  - type: regex
    pattern: '(execute|query|exec)\s*\(\s*["''].*\+'
    message: "检测到字符串拼接构造 SQL，应使用参数化查询"
  - type: contains_any
    items: ['String sql =', 'const sql =', 'sql :=']
    message: "直接赋值 SQL 字符串，请确认是否参数化"
excludePatterns:
  - '**/*.test.ts'
  - '**/migrations/**'
```

### JSON 示例

```json
[
  {
    "id": "hardcoded-secret",
    "name": "硬编码密钥",
    "severity": "critical",
    "category": "security",
    "patterns": [
      {
        "type": "regex",
        "pattern": "(?i)(api[_-]?key|secret|token)\\s*[:=]\\s*[\"'][A-Za-z0-9]{16,}",
        "message": "检测到硬编码密钥，应使用环境变量"
      }
    ]
  }
]
```

仓库已内置 8 条规则：`hardcoded-secret` / `npe` / `path-traversal` / `quality` / `security` / `sql-injection` / `thread-safety` / `xss`，可作为模板。

---

## CI/CD 集成

### GitHub Action

仓库提供 `.github/workflows/code-review.yml`，在 PR `opened` 与 `synchronize` 时触发：

```yaml
name: AI Code Review
on:
  pull_request:
    types: [opened, synchronize]
permissions:
  pull-requests: write
  contents: read

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install opencode-code-review
        run: npm install -g opencode-code-review
      - name: Run Code Review
        run: |
          git diff origin/${{ github.base_ref }}...HEAD | \
          opencode-code-review review > review-results.json 2>&1 || true
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      - name: Publish Review Comments
        if: always()
        run: |
          if [ -f review-results.json ]; then
            opencode-code-review publish \
              --owner ${{ github.repository_owner }} \
              --repo ${{ github.event.repository.name }} \
              --pr ${{ github.event.pull_request.number }} \
              --file review-results.json \
              --token ${{ secrets.GITHUB_TOKEN }} \
              --mode incremental
          fi
```

### 必需的 Secrets

| Secret | 用途 | 是否必需 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 调用 Claude 模型 | 调用 AI Agent 时必需 |
| `GITHUB_TOKEN` | 发布 PR 评论（Actions 自动注入） | 发布评论时必需 |

### 忽略文件

在仓库根目录创建 `.opencode-review-ignore`，语法同 `.gitignore`：

```gitignore
# 依赖目录
node_modules/
vendor/

# 生成文件
*.generated.*
*.pb.go
dist/
build/

# 锁文件
package-lock.json
yarn.lock
pnpm-lock.yaml
```

参考 `.opencode-review-ignore.example`。

### 本地预审

在推送分支前本地跑一遍，把"AI 在 PR 上挑刺"前移到本地：

```bash
git diff origin/main...HEAD | opencode-code-review review | less
```

---

## 测试

测试基于 [Vitest](https://vitest.dev)，目录组织如下：

```
tests/
├── *.test.ts                  # 单元测试（与 src/ 一一对应）
├── fixtures/                  # 测试数据：diff 样本、规则文件
│   └── rules/
├── integration/               # 集成测试：管道端到端
├── e2e/                        # 端到端：CI 流程、大 PR、安全审查流
└── benchmark/                  # 性能与准确性基准
```

### 运行测试

```bash
# 一次性运行
npm test

# 监听模式
npm run test:watch

# 覆盖率（阈值 90%，分支/函数/行/语句全覆盖）
npm run test:coverage

# 类型检查 + 全量测试（CI 流程）
npm run ci
```

### 当前状态

- **测试用例**：1092 个，全部通过
- **行覆盖率**：96.38%
- **覆盖维度**：branches / functions / lines / statements 均 ≥ 90%
- **基准测试**：`tests/benchmark/{accuracy,performance}.test.ts`

### 编写测试

```typescript
import { describe, it, expect } from 'vitest';
import { parseDiff } from 'opencode-code-review';

describe('parseDiff', () => {
  it('应正确解析单文件新增 diff', () => {
    const diff = [
      'diff --git a/foo.ts b/foo.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/foo.ts',
      '@@ -0,0 +1,2 @@',
      '+export const x = 1;',
      '+export const y = 2;',
    ].join('\n');

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe('added');
    expect(files[0].hunks[0].lines).toHaveLength(2);
  });
});
```

详见 [CONTRIBUTING.md](./CONTRIBUTING.md) 中的 TDD 开发流程。

---

## 贡献指南

欢迎贡献代码、规则、文档与问题反馈。请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

- **Bug 与特性请求**：<https://github.com/bigDataZWH/codeReview/issues>
- **Pull Request**：<https://github.com/bigDataZWH/codeReview/pulls>
- **安全漏洞**：请勿公开 issue，邮件联系维护者

---

## 许可证

本项目基于 [MIT License](./LICENSE) 发布。

Copyright © 2026 OpenCode Code Review Contributors.
