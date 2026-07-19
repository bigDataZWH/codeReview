# opencode-code-review — 技术规格说明书 (SPEC)

## 1. 项目概述

基于 OpenCode 平台的 AI 代码审查确定性管道。本项目实现审查流程中所有确定性环节（Diff 解析、文件过滤、规则匹配、评论定位、误报过滤），通过 OpenCode 的 Agent/Command/MCP 接口与 AI 审查能力无缝衔接。

## 2. 技术选型

| 项 | 选型 | 理由 |
|---|---|---|
| 语言 | TypeScript 5.x + ES2022 | OpenCode 插件生态兼容；类型安全 |
| 运行时 | Node.js >= 18 | OpenCode 要求 |
| 测试框架 | Vitest | 零配置 TS 支持、极速 HMR |
| 包管理 | npm | 生态标准 |
| 构建 | tsx (dev) / tsup (build) | ESM 原生支持 |

## 3. 架构与模块

### 3.1 模块清单

| 模块 | 职责 | 输入 | 输出 |
|---|---|---|---|
| `diff-parser` | 解析 Git diff 为结构化数据 | diff 文本 / git 命令 | `FileDiff[]` |
| `file-filter` | 过滤、分组、打包变更文件 | `FileDiff[]` + 过滤规则 | `FileBundle[]` |
| `rule-engine` | 确定性规则匹配与标注 | `FileBundle[]` + 规则集 | `AnnotatedBundle[]` |
| `post-processor` | 定位修正 + 误报过滤 | `Finding[]` | 过滤后的 `Finding[]` |
| `mcp-adapter` | 调用 code-review-graph MCP | `FileDiff[]` | 增强上下文 |
| `comment-publisher` | 发布 PR 评论 | `Finding[]` + GitHub API | PR inline 评论 |
| `prompt-builder` | 构建 Agent prompt | 管道输出 | 完整 prompt 文本 |

### 3.2 核心数据类型

```typescript
// diff-parser 输出
interface FileDiff {
  path: string;
  oldPath?: string;          // 重命名场景
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: Hunk[];
  language?: string;
  binary?: boolean;
}

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;            // @@ ... @@ 之后的上下文行
  lines: DiffLine[];
}

interface DiffLine {
  type: 'add' | 'delete' | 'context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

// file-filter 输出
interface FileBundle {
  id: string;
  primary: FileDiff;
  related: FileDiff[];       // 关联文件（如 i18n 对）
  annotations: RuleAnnotation[];
}

// rule-engine 输出
interface RuleAnnotation {
  ruleId: string;
  ruleName: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  line?: number;
  category: string;
}

// 统一 Finding 类型
interface Finding {
  file: string;
  line: number;
  endLine?: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  message: string;
  suggestion?: string;
  confidence: number;        // 0-1
  source: 'rule' | 'ai';    // 来源
  ruleId?: string;
}

// 误报过滤器
interface FalsePositiveRule {
  id: string;
  name: string;
  match: (finding: Finding) => boolean;  // 返回 true 表示是误报
}
```

## 4. 模块详细规格

### 4.1 diff-parser

**职责**：将 unified diff 文本解析为 `FileDiff[]`。

**必须处理**：
- 标准 `git diff` 和 `git diff --cached` 输出
- 多文件 diff
- 文件重命名 (`old mode...new mode` / `rename from/to`)
- 二进制文件 (`Binary files ... differ`)
- 空 diff（无变更）
- 含空行的 hunk
- 含特殊字符的文件路径（空格、中文、Unicode）
- 行尾无换行的 `No newline at end of file` 标记

**接口**：
```typescript
function parseDiff(diffText: string): FileDiff[];
function parseDiffFromGit(options: GitDiffOptions): Promise<FileDiff[]>;
interface GitDiffOptions {
  from?: string;    // base ref (default: HEAD)
  to?: string;      // target ref (default: working tree)
  cached?: boolean; // --staged
  path?: string[];  // 限制路径
}
```

### 4.2 file-filter

**职责**：根据配置过滤、分组、打包文件。

**过滤规则**：
- `ignorePatterns`: glob 模式数组，匹配的文件排除
- `includePatterns`: glob 模式数组，仅包含匹配的文件
- `maxPatchLength`: 超过此长度的 patch 跳过（默认 10000 字符）
- `includeBinary`: 是否包含二进制文件（默认 false）

**智能打包规则**（YAML 配置）：
```yaml
bundles:
  - name: "i18n"
    pattern: "(.*)_en\\.(properties|json|yaml)"
    related: ["$1_zh.$2", "$1_ja.$2"]
  - name: "test-pair"
    pattern: "(.*)\\.test\\.(ts|js|py)"
    related: ["$1.$2"]
```

**接口**：
```typescript
function filterFiles(diffs: FileDiff[], config: FilterConfig): FileDiff[];
function bundleFiles(diffs: FileDiff[], config: BundleConfig): FileBundle[];
```

### 4.3 rule-engine

**职责**：对文件内容进行确定性规则匹配，生成预标注。

**规则格式**（YAML）：
```yaml
id: sql-injection
name: "SQL 拼接检测"
severity: high
category: security
language: [python, java, go]
patterns:
  - type: regex
    pattern: '(execute|query)\s*\(\s*["\x27].*\+\s*'  # 字符串拼接 SQL
    message: "检测到字符串拼接构造 SQL，存在注入风险"
  - type: regex
    pattern: 'format\s*\(.*%[sd].*SELECT|INSERT|UPDATE|DELETE'
    message: "检测到 format 拼接 SQL"
  - type: contains_any
    items: ['String sql =', 'const sql =', 'sql :=']
    message: "检测到直接赋值 SQL 字符串"
```

**匹配类型**：`regex`、`contains_any`、`contains_all`、`line_count_gt`、`file_size_gt`

**接口**：
```typescript
function loadRules(ruleDir: string): Rule[];
function matchRules(bundle: FileBundle, rules: Rule[]): RuleAnnotation[];
```

### 4.4 post-processor

**4.4.1 定位修正器 (Locator)**

**职责**：修正 AI 输出的行号偏差。

**策略**：
1. 将 AI 返回的行号与 diff hunk 的 `newLineNumber` 范围对比
2. 如果行号超出 hunk 范围，clamp 到最近的 hunk 行
3. 如果行号对应的行内容不匹配 finding 描述，在上下文中搜索匹配行

```typescript
function correctLineLocations(findings: Finding[], diffs: FileDiff[]): Finding[];
```

**4.4.2 误报硬规则过滤器 (FalsePositiveFilter)**

**内置规则**（预编译正则）：
```typescript
const BUILTIN_RULES: FalsePositiveRule[] = [
  // 非 C/C++ 文件的内存安全
  { id: 'mem-non-c', match: f => f.category === 'memory-safety' && !isCFile(f.file) },
  // 速率限制 / DOS 建议
  { id: 'rate-limit', match: f => /rate.?limit/i.test(f.message) },
  // 开放重定向
  { id: 'open-redirect', match: f => f.category === 'open-redirect' },
  // 生成的文件
  { id: 'generated', match: f => isGeneratedFile(f.file) },
  // 测试文件中的安全建议
  { id: 'test-security', match: f => isTestFile(f.file) && f.severity === 'low' },
  // TODO/FIXME 注释
  { id: 'todo-comment', match: f => /todo|fixme/i.test(f.message) && /comment/i.test(f.message) },
  // 日志级别建议
  { id: 'log-level', match: f => f.category === 'logging' && f.severity === 'info' },
];
```

```typescript
function filterFalsePositives(findings: Finding[], customRules?: FalsePositiveRule[]): Finding[];
```

**4.4.3 IoU 去重器 (Deduplicator)**

用于 CI 增量评论场景，避免重复发布已有评论。

```typescript
interface ExistingComment {
  file: string;
  line: number;
  body: string;
}

function deduplicateFindings(
  newFindings: Finding[],
  existingComments: ExistingComment[],
  iouThreshold?: number // default 0.5
): Finding[];
```

### 4.5 mcp-adapter

**职责**：通过 MCP 协议调用 code-review-graph。

**接口**：
```typescript
interface MCPContextResult {
  filePaths: string[];
  codeSnippets: Record<string, string>;
  blastRadius: BlastRadiusItem[];
  riskScore: number;
}

interface BlastRadiusItem {
  path: string;
  type: 'caller' | 'callee' | 'test';
  relation: string;
}

async function getReviewContext(filePaths: string[], mcpEndpoint?: string): Promise<MCPContextResult>;
async function getImpactRadius(filePaths: string[]): Promise<BlastRadiusItem[]>;
```

**降级策略**：MCP Server 不可用时，回退到全文上下文（grep 搜索）。

### 4.6 prompt-builder

**职责**：将管道各阶段输出组装为完整的 Agent prompt。

**模板变量**：
- `$DIFF` — 过滤后的 diff 文本
- `$CONTEXT` — 图谱增强上下文
- `$RULE_ANNOTATIONS` — 规则引擎标注
- `$FILE_LIST` — 变更文件列表
- `$STATS` — 变更统计
- `$CUSTOM_RULES` — 项目自定义审查规则

**接口**：
```typescript
function buildReviewPrompt(context: PipelineContext, template?: string): string;
function buildSecurityPrompt(context: PipelineContext): string;
```

### 4.7 comment-publisher

**职责**：将 findings 发布为 GitHub PR inline 评论。

**特性**：
- 行内评论（精确到代码行）
- Sticky summary 评论（更新而非新建）
- Incremental 模式（仅追加新发现）
- 支持 GitHub Actions 和 Octokit 两种调用方式

```typescript
async function publishReview(options: PublishOptions): Promise<PublishResult>;
interface PublishOptions {
  findings: Finding[];
  owner: string;
  repo: string;
  prNumber: number;
  token: string;
  mode?: 'replace' | 'incremental';
  summaryCommentId?: number;
}
```

## 5. 管道编排

```typescript
interface PipelineConfig {
  filter: FilterConfig;
  bundle: BundleConfig;
  rules: Rule[];
  falsePositiveRules?: FalsePositiveRule[];
  mcpEnabled?: boolean;
  mcpEndpoint?: string;
}

async function runPipeline(diffText: string, config: PipelineConfig): Promise<PipelineResult>;
interface PipelineResult {
  filteredDiffs: FileDiff[];
  bundles: FileBundle[];
  annotatedBundles: AnnotatedBundle[];
  context?: MCPContextResult;
  prompt: string;
  // AI 审查后回填
  findings?: Finding[];
  processedFindings?: Finding[];
}
```

## 6. OpenCode 集成配置

项目提供 `opencode-config/` 目录，包含：
- `opencode.jsonc` — 主配置（Agent 定义 + MCP 配置）
- `.opencode/agents/` — 三个 Agent 定义
- `.opencode/commands/` — 三个自定义命令
- `.opencode/rules/` — 审查规则指令
- `review-rules/` — 确定性规则 YAML 文件

## 7. 测试策略

| 层级 | 覆盖 | 框架 |
|---|---|---|
| 单元测试 | 每个模块的纯函数 | Vitest |
| 集成测试 | 管道端到端流程 | Vitest + fixtures |
| 快照测试 | Prompt 输出格式 | Vitest |
| 属性测试 | 边界条件 | Vitest |

**测试数据**：`tests/fixtures/` 目录包含各类 diff 样本、规则文件和预期输出。

## 8. 质量门禁

- 单元测试覆盖率 >= 90%
- 所有测试通过
- TypeScript 严格模式无错误
- ESLint 无错误