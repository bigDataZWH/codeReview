// src/types.ts — 统一类型导出
// 实现在各迭代中逐步填充

/** Diff 解析输出 */
export interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'delete' | 'context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: Hunk[];
  language?: string;
  binary?: boolean;
  oldMode?: string;
  newMode?: string;
  similarity?: number;
  copied?: boolean;
}

/** 文件过滤 */
export interface FilterConfig {
  ignorePatterns?: string[];
  includePatterns?: string[];
  maxPatchLength?: number;
  includeBinary?: boolean;
  maxFiles?: number;
  language?: string[];
  includeDeleted?: boolean;
}

/** 文件打包 */
export interface BundleRule {
  name: string;
  pattern: string;
  related: string[];
}

export interface BundleConfig {
  bundles?: BundleRule[];
}

export interface FileBundle {
  id: string;
  primary: FileDiff;
  related: FileDiff[];
  annotations: RuleAnnotation[];
}

/** 规则引擎 */
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type MatchType = 'regex' | 'contains_any' | 'contains_all' | 'line_count_gt' | 'file_size_gt';

export interface RulePattern {
  type: MatchType;
  pattern: string;
  items?: string[];
  threshold?: number;
  message: string;
  flags?: string;
  line?: number;
}

export interface Rule {
  id: string;
  name: string;
  severity: Severity;
  category: string;
  language?: string[];
  patterns: RulePattern[];
  group?: string;
  description?: string;
  disabled?: boolean;
  excludePatterns?: string[];
}

export interface RuleAnnotation {
  ruleId: string;
  ruleName: string;
  severity: Severity;
  message: string;
  line?: number;
  category: string;
  description?: string;
}

/** Finding */
export interface Finding {
  file: string;
  line: number;
  endLine?: number;
  severity: Severity | 'info';
  category: string;
  message: string;
  suggestion?: string;
  confidence: number;
  source: 'rule' | 'ai';
  ruleId?: string;
}

/** 误报过滤 */
export interface FalsePositiveRule {
  id: string;
  name: string;
  match: (finding: Finding) => boolean;
}

/** 管道 */
export interface PipelineConfig {
  filter: FilterConfig;
  bundle?: BundleConfig;
  rules?: Rule[];
  falsePositiveRules?: FalsePositiveRule[];
  mcpEnabled?: boolean;
  mcpEndpoint?: string;
  dryRun?: boolean;
}

export interface PipelineResult {
  filteredDiffs: FileDiff[];
  bundles: FileBundle[];
  annotatedBundles: FileBundle[];
  context?: MCPContextResult;
  prompt: string;
  findings?: Finding[];
  processedFindings?: Finding[];
  durationMs?: number;
}

/** MCP 适配器 */
export interface BlastRadiusItem {
  path: string;
  type: 'caller' | 'callee' | 'test';
  relation: string;
}

export interface MCPContextResult {
  filePaths: string[];
  codeSnippets: Record<string, string>;
  blastRadius: BlastRadiusItem[];
  riskScore: number;
}

/** 评论发布 */
export interface ExistingComment {
  file: string;
  line: number;
  body: string;
}

export interface PublishOptions {
  findings: Finding[];
  owner: string;
  repo: string;
  prNumber: number;
  token: string;
  mode?: 'replace' | 'incremental';
  summaryCommentId?: number;
}

export interface PublishResult {
  inlineCount: number;
  summaryUpdated: boolean;
  skipped: number;
}

/** Git Diff 选项 */
export interface GitDiffOptions {
  from?: string;
  to?: string;
  cached?: boolean;
  path?: string[];
}

/** Annotated bundle alias */
export type AnnotatedBundle = FileBundle;

/** LLM Provider 配置（用于 AI 反思过滤） */
export interface LLMProviderConfig {
  /** Provider 类型 */
  provider: 'openai' | 'anthropic' | 'google';
  /** API Key */
  apiKey: string;
  /** 模型名称 */
  model: string;
  /** API 基础 URL（可选，用于自定义端点） */
  baseURL?: string;
  /** 请求超时毫秒数 */
  timeout?: number;
}

/** Prompt 构建上下文 */
export interface PipelineContext {
  filteredDiffs: FileDiff[];
  bundles: FileBundle[];
  annotatedBundles: FileBundle[];
  context?: MCPContextResult;
  customRules?: string;
}

/** LLM Provider 配置 */
export interface LLMProviderConfig {
  provider: 'openai' | 'anthropic' | 'google';
  apiKey: string;
  model: string;
  baseURL?: string;
  timeout?: number;
}

/** MCP 客户端配置 */
export interface MCPClientConfig {
  /** MCP Server 启动命令，默认 ["code-review-graph", "serve"] */
  command?: string[];
  /** 工作目录，默认 process.cwd() */
  cwd?: string;
  /** 请求超时毫秒数，默认 30000 */
  timeout?: number;
  /** 环境变量 */
  env?: Record<string, string>;
}