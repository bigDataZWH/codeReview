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
  /** 缓存管理器实例（迭代 4：缓存集成） */
  cache?: import('./cache.js').CacheManager;
  /** 缓存相关选项（迭代 4） */
  cacheOptions?: PipelineCacheOptions;
  /** 大 PR 分批处理选项（迭代 5） */
  batching?: BatchOptions;
  /** 上下文压缩选项（迭代 6） */
  compression?: CompressionOptions;
  /** Task 18：链路追踪管理器（可选，未提供时使用一次性 TracingManager） */
  tracer?: import('./tracing.js').TracingManager;
}

/** 管道缓存选项 */
export interface PipelineCacheOptions {
  /** 规则版本号，变更后使规则匹配缓存失效（默认 'v1'） */
  ruleVersion?: string;
  /** diff 缓存 TTL（毫秒），不设置则永久 */
  diffTtlMs?: number;
  /** MCP 上下文缓存 TTL（毫秒） */
  mcpTtlMs?: number;
}

/** 大 PR 分批处理选项（迭代 5） */
export interface BatchOptions {
  /** 触发分批处理的文件数阈值，默认 30 */
  threshold?: number;
  /** 每批文件数，默认 10 */
  batchSize?: number;
  /** 是否启用优先级排序，默认 true */
  prioritize?: boolean;
  /** 是否并行执行批次，默认 false（顺序执行） */
  parallel?: boolean;
}

/** 上下文压缩选项（迭代 6） */
export interface CompressionOptions {
  /** 是否启用上下文压缩 */
  enabled?: boolean;
  /** 保留关键行（add/delete）周围的上下文行数 */
  contextLines?: number;
  /** 是否移除注释 */
  stripComments?: boolean;
  /** 是否移除空行 */
  stripBlankLines?: boolean;
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
  /** 分批处理元信息（迭代 5，仅大 PR 触发分批时存在） */
  batchInfo?: BatchInfo;
}

/** 分批处理元信息（迭代 5） */
export interface BatchInfo {
  /** 实际批次数 */
  batchesCount: number;
  /** 总文件数 */
  totalFiles: number;
  /** 每批文件数 */
  batchSize: number;
  /** 是否启用了优先级排序 */
  prioritized: boolean;
  /** 失败批次数 */
  failedBatches: number;
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
  afterPublish?: (result: PublishResult, findings: Finding[], context?: Record<string, unknown>) => Promise<void> | void;
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
  provider?: 'openai' | 'anthropic' | 'google';
  /** API Key */
  apiKey?: string;
  /** 模型名称 */
  model?: string;
  /** API 基础 URL（可选，用于自定义端点） */
  baseURL?: string;
  /** 请求超时毫秒数 */
  timeout?: number;
}

/**
 * 判断 LLM 配置是否有效（provider + apiKey + model 均非空）。
 * 未配置模型时所有 AI 相关操作将走降级路径。
 */
export function isLLMConfigValid(config: Partial<LLMProviderConfig> | undefined | null): boolean {
  if (!config) return false;
  return Boolean(config.provider && config.apiKey && config.model);
}

/** Prompt 构建上下文 */
export interface PipelineContext {
  filteredDiffs: FileDiff[];
  bundles: FileBundle[];
  annotatedBundles: FileBundle[];
  context?: MCPContextResult;
  customRules?: string;
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