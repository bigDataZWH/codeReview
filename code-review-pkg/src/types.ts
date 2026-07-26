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
  /** 稳定 ID（基于 file:line:ruleId 哈希，可选；review-runner 等场景会自动生成） */
  id?: string;
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

// ==================== CodeHub 相关类型 ====================

/** CodeHub 连接配置 */
export interface CodeHubConfig {
  /** CodeHub 平台地址 */
  baseUrl: string;
  /** Personal Access Token */
  token: string;
  /** 项目 ID / 路径 */
  projectId: string;
}

/** CodeHub 用户信息 */
export interface CodeHubUser {
  id: number;
  name: string;
  username: string;
  avatar_url?: string;
  email?: string;
}

/** CodeHub Merge Request */
export interface CodeHubMR {
  id: number;
  iid: number;
  title: string;
  description: string;
  state: 'open' | 'merged' | 'closed' | 'locked';
  source_branch: string;
  target_branch: string;
  author: CodeHubUser;
  assignees?: CodeHubUser[];
  reviewers?: CodeHubUser[];
  created_at: string;
  updated_at: string;
  merged_at?: string;
  closed_at?: string;
  web_url: string;
  source_project_id?: number;
  target_project_id?: number;
  merge_status?: 'can_be_merged' | 'cannot_be_merged' | 'unchecked';
  changes_count?: string;
  user_notes_count?: number;
  labels?: string[];
  work_in_progress?: boolean;
}

/** CodeHub MR 列表响应（带分页） */
export interface CodeHubMRListResponse {
  mrs: CodeHubMR[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

/** CodeHub MR Diff 文件 */
export interface CodeHubDiffFile {
  diff: string;
  new_path: string;
  old_path: string;
  a_mode?: string;
  b_mode?: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
  binary?: boolean;
}

/** CodeHub MR Diff 响应 */
export interface CodeHubMRDiff {
  id: number;
  iid: number;
  diff_refs: {
    base_sha: string;
    head_sha: string;
    start_sha: string;
  };
  changes: CodeHubDiffFile[];
}

/** CodeHub 评论 */
export interface CodeHubComment {
  id: number;
  body: string;
  author: CodeHubUser;
  created_at: string;
  updated_at: string;
  path?: string;
  line?: number;
  line_type?: 'new' | 'old';
  position?: {
    base_sha: string;
    head_sha: string;
    start_sha: string;
    new_path?: string;
    old_path?: string;
    new_line?: number;
    old_line?: number;
    position_type?: 'text' | 'line';
  };
  resolvable?: boolean;
  resolved?: boolean;
  resolved_by?: CodeHubUser;
  parent_id?: number;
}

/** CodeHub 项目信息 */
export interface CodeHubProject {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  description: string;
  web_url: string;
  default_branch: string;
  visibility: 'private' | 'internal' | 'public';
  ssh_url_to_repo: string;
  http_url_to_repo: string;
  created_at: string;
  last_activity_at: string;
  star_count: number;
  forks_count: number;
  open_issues_count: number;
}

/** CodeHub 分支信息 */
export interface CodeHubBranch {
  name: string;
  merged: boolean;
  protected: boolean;
  default: boolean;
  can_push: boolean;
  web_url: string;
  commit: {
    id: string;
    short_id: string;
    title: string;
    author_name: string;
    author_email: string;
    created_at: string;
    message: string;
  };
}

/** CodeHub 发布评论选项 */
export interface CodeHubPublishOptions {
  findings: Finding[];
  projectId: string;
  mrIid: number;
  token: string;
  baseUrl: string;
  mode?: 'replace' | 'incremental';
}

/** CodeHub 发布结果 */
export interface CodeHubPublishResult {
  inlineCount: number;
  summaryUpdated: boolean;
  skipped: number;
}

/** 本地仓库信息 */
export interface RepoInfo {
  projectId: string;
  projectName?: string;
  localPath: string;
  currentBranch: string;
  lastFetchedAt: string;
  sizeBytes?: number;
}

/** 仓库管理器选项 */
export interface RepoManagerOptions {
  /** 本地仓库根目录 */
  baseDir: string;
  /** CodeHub 配置 */
  codehubConfig?: CodeHubConfig;
}

/** 仪表盘统计数据 */
export interface CodeHubDashboardStats {
  totalMRs: number;
  openMRs: number;
  mergedMRs: number;
  closedMRs: number;
  totalFindings: number;
  findingsBySeverity: Record<Severity | 'info', number>;
  pendingReviews: number;
  reviewedToday: number;
  reviewedThisWeek: number;
  trend: {
    date: string;
    reviews: number;
    findings: number;
  }[];
}

/** CodeHub Issue */
export interface CodeHubIssue {
  id: number;
  iid: number;
  title: string;
  description: string;
  state: 'opened' | 'closed';
  author: CodeHubUser;
  labels: string[];
  web_url?: string;
  created_at: string;
  updated_at: string;
}

/** CodeHub Issue 创建选项 */
export interface CodeHubCreateIssueOptions {
  title: string;
  description: string;
  labels?: string[];
  assigneeId?: number;
  milestoneId?: number;
}