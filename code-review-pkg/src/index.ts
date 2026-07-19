// src/index.ts — 公共 API 导出
export * from './types.js';

// diff-parser
export { parseDiff, parseDiffFromGit, computeDiffStats, getHunkContext, getAdditions, getDeletions, hasSignificantChanges, parseDiffStat, filterDiffsByPath, stripAnsiEscapes, isOnlyWhitespaceChange } from './diff-parser.js';

// file-filter
export { filterFiles, bundleFiles, detectLanguage, groupByDirectory, excludeGeneratedFiles } from './file-filter.js';

// rule-engine
export { loadRules, matchRules, getRulesByCategory, getRulesBySeverity } from './rule-engine.js';

// rule-customizer (Task 3：规则定制)
export {
  loadCustomRules,
  overrideRule,
  disableRule,
  enableRule,
  getActiveRules,
  getDisabledRules,
  loadRulesConfig,
  saveRulesConfig,
  applyRulesConfig,
  loadActiveCustomRules,
  DEFAULT_RULES_DIR,
  RULES_CONFIG_FILE,
} from './rule-customizer.js';
export type { RuleOverride, RulesConfig } from './rule-customizer.js';

// post-processor
export { correctLineLocations, filterFalsePositives, deduplicateFindings, BUILTIN_FP_RULES, filterBySeverity, groupByFile, sortBySeverity, filterByCategory, filterBySource, filterByConfidence, countBySeverity, createCachedFilter, mergeFindings, getUniqueCategories, TRUNCATION_MESSAGE, truncateFindings, createSeverityBasedFilter, filterWithStrategy } from './post-processor.js';
export type { FilterStrategy } from './post-processor.js';

// prompt-builder
export { buildReviewPrompt, buildSecurityPrompt, buildImpactPrompt, buildScanPrompt, formatFindingsSummary, buildCustomPrompt, getLanguageReviewTip, wrapDiffInCodeBlock, getOWASPTop10List, estimatePromptTokens, buildReviewPromptWithTokenLimit, buildReviewPromptWithCompression, createPromptVariant, selectPromptVariant, trackPromptMetrics } from './prompt-builder.js';
export type { PromptVariant, PromptVariantMetadata, PromptMetrics, PromptVariantStats, PromptMetricsStore, SelectPromptVariantOptions } from './prompt-builder.js';

// token-optimizer (迭代 6：Token 成本优化)
export {
  compressContext,
  selectModelByComplexity,
  estimateTokenCost,
  estimateTokenCount,
  fitsInBudget,
  optimizePrompt,
  DEFAULT_MODEL_TIERS,
} from './token-optimizer.js';
export type {
  ModelTier,
  ModelTierName,
  ComplexityMetrics,
  CompressionOptions,
  TokenCostEstimate,
  OptimizedPrompt,
  OptimizePromptOptions,
  EstimateTokenCostInput,
} from './token-optimizer.js';

// token-counter (Task 18：精确 Token 估算，纯 JS 实现)
export { countTokens } from './token-counter.js';

// mcp-adapter
export { getReviewContext, getReviewContextWithCache, getImpactRadius, isMCPAvailable, formatMCPContext, _resetMCPContextCache } from './mcp-adapter.js';

// comment-publisher
export { publishReview } from './comment-publisher.js';

// pipeline
export { runPipeline, applyFindings, runPipelineWithMiddleware, runPipelineFromFile, runSecurityPipeline, chunkLargeFile, runPipelineBatched } from './pipeline.js';
export type { PipelineMiddleware } from './pipeline.js';

// utils
export { slugify, truncateString, isCFile, isCppFile, isTestFile, isGeneratedFile, severityOrder, formatSeverity } from './utils.js';

// format
export { formatFindingMarkdown, formatFindingsMarkdown, formatFindingsJSON } from './format.js';

// validation
export { validateFinding, validatePipelineConfig, validatePipelineConfigWithWarnings } from './validation.js';

// constants
export { DEFAULT_FILTER_CONFIG, DEFAULT_BUNDLE_CONFIG, SEVERITY_ORDER, MAX_DIFF_SIZE, HIGH_CONFIDENCE_THRESHOLD, DEFAULT_IOU_THRESHOLD, LARGE_PR_THRESHOLD, DEFAULT_BATCH_SIZE } from './constants.js';

// ai-reflection
export { buildReflectionPrompt, buildBatchReflectionPrompt, parseReflectionResponse, callLLM, reflectFindings, reflectFindingsWithRouter, DEFAULT_REFLECTION_THRESHOLD } from './ai-reflection.js';
export type { ModelConfigMap, ReflectWithRouterResult } from './ai-reflection.js';

// model-router (Task 8：模型路由 — 根据 finding 复杂度选择 LLM 模型)
export {
  ModelRouter,
  classifyComplexity,
  getComplexityLevel,
  DEFAULT_MODEL_MAP,
  SMALL_COMPLEXITY_THRESHOLD,
  MEDIUM_COMPLEXITY_THRESHOLD,
  HIGH_RISK_CATEGORIES,
  MAX_COMPLEXITY_SCORE,
} from './model-router.js';
export type {
  ComplexityLevel,
  ModelSize,
  RoutingResult,
} from './model-router.js';

// state (会话状态机 + findings 持久化 + 断点续审 + 历史趋势 + 度量摘要)
export {
  StateStore,
  createSession,
  getSession,
  updateSessionStatus,
  listSessions,
  saveFindings,
  getFindingsBySession,
  getFindingsByFile,
  resumeInterruptedSessions,
  getTrendStats,
  getMetricsSummary,
} from './state.js';
export type {
  SessionStatus,
  Session,
  CreateSessionOptions,
  ListSessionsFilter,
  ResumeOptions,
  FindingsByFileOptions,
  TrendStatsOptions,
  TrendStats,
  StateStoreOptions,
  MetricsSummary,
} from './state.js';

// cache (三级缓存：L1 内存 + L2 磁盘 + 智能失效 + 命中统计)
export {
  L1MemoryCache,
  L2DiskCache,
  CacheManager,
} from './cache.js';
export type {
  CacheEntry,
  HitStats,
  CategoryHitStats,
  CacheSetOptions,
  L2DiskCacheOptions,
  CacheManagerOptions,
} from './cache.js';

// feedback (反馈闭环：反馈采集 + 误报模式分析 + 忽略配置 + 规则调优)
export {
  FeedbackStore,
  loadIgnoreConfig,
  shouldIgnore,
  markFalsePositive,
  getRuleEffectiveness,
  autoTuneRules,
  FALSE_POSITIVE_ANALYSIS_THRESHOLD,
  DEFAULT_FALSE_POSITIVE_REASON,
} from './feedback.js';
export type {
  FeedbackAction,
  FeedbackRecord,
  FeedbackStats,
  FalsePositivePattern,
  RuleSuggestion,
  IgnoreRule,
  IgnoreConfig,
  MarkFalsePositiveResult,
  RuleGrade,
  RuleEffectiveness,
  RuleTuningAction,
  RuleTuningSuggestion,
} from './feedback.js';

// context-learner (Task 7：上下文学习 — 从反馈中学习权重并应用到 findings)
export {
  ContextLearner,
  getWeightKey,
  DEFAULT_WEIGHT,
  LEARNING_MIN_FEEDBACKS,
  MIN_WEIGHT,
  MAX_WEIGHT,
} from './context-learner.js';
export type {
  LearnedWeights,
  LearningStats,
} from './context-learner.js';

// self-healer (Task 9：自愈能力 — 对低风险 finding 自动应用修复建议)
export {
  SelfHealer,
  healFinding,
  autoHealFindings,
  buildInHealingRules,
} from './self-healer.js';
export type {
  HealAction,
  HealingRule,
  HealResult,
  AutoHealResult,
} from './self-healer.js';

// orchestrator (编排控制层：审查会话管理 + Agent DAG 编排 + 异常降级)
export {
  ReviewSessionManager,
  executeDag,
  mergeResults,
  shouldSkipImpactAnalysis,
  buildReviewDag,
  withFallback,
  withRetry,
  getReviewContextWithFallback,
  callModelWithTimeout,
  batchProcess,
  prioritizeDiffs,
} from './orchestrator.js';
export type {
  ReviewSessionStatus,
  ReviewSessionConfig,
  AgentType,
  DagNode,
  DagContext,
  DagResult,
  BuildReviewDagOptions,
  RetryOptions,
  McpFallbackOptions,
  McpFallbackResult,
  ModelCallOptions,
  ModelCallResult,
  BatchResult,
  BatchError,
  BatchProcessOptions,
  BatchProcessResult,
  PauseSignal,
} from './orchestrator.js';

// progress (迭代 9：渐进式输出)
export { ProgressEmitter } from './progress.js';
export type {
  ProgressEvent,
  StartPayload,
  FileStartPayload,
  FileCompletePayload,
  FileErrorPayload,
  CompletePayload,
  ErrorPayload,
  ProgressPayloadMap,
  ProgressListener,
} from './progress.js';

// init-wizard (迭代 9：初始化向导)
export { generateConfig } from './init-wizard.js';
export type {
  ProjectLanguage,
  ReviewStrength,
  DeploymentMode,
  WizardOptions,
  GeneratedConfig,
} from './init-wizard.js';

// metrics (迭代 10：度量指标 + 趋势分析 + 仪表盘数据)
export { collectMetrics, generateDashboardData } from './metrics.js';
export type {
  SessionSnapshot,
  MetricsInput,
  CoverageMetrics,
  QualityMetrics,
  CostMetrics,
  EfficiencyMetrics,
  TrendBucket,
  TrendDirection,
  TrendMetrics,
  ReviewMetrics,
  DashboardKpi,
  DashboardCharts,
  DashboardData,
} from './metrics.js';

// ignore-manager (Task 2：.reviewignore 文件忽略机制)
// 注：feedback.ts 已导出同名 loadIgnoreConfig/shouldIgnore（YAML 格式），
// 这里以别名 re-export ignore-manager.ts 的同名函数，避免命名冲突
export {
  loadIgnoreConfig as loadReviewIgnoreConfig,
  shouldIgnore as shouldReviewIgnore,
  applyIgnoreRules,
  parseIgnoreContent,
} from './ignore-manager.js';
export type {
  IgnorePattern,
  IgnoreConfig as ReviewIgnoreConfig,
} from './ignore-manager.js';

// incremental-review (Task 1：增量审查能力)
export {
  computeFileDiffHash,
  loadLastReviewState,
  computeIncrementalDiff,
  serializeDiffsToDiffText,
  saveIncrementalState,
  mergeIncrementalFindings,
  DEFAULT_INCREMENTAL_STATE_FILE,
} from './incremental-review.js';
export type {
  IncrementalReviewState,
  LoadLastReviewStateOptions,
  LoadLastReviewStateResult,
  IncrementalDiffResult,
} from './incremental-review.js';

// precheck (Task 4：智能预检 — 检测 trivial changes 跳过 LLM 调用)
export {
  performPreCheck,
  isCommentLine,
  isOnlyCommentChange,
  isOnlyFormatChange,
  classifyDiff,
} from './precheck.js';
export type {
  PreCheckStats,
  PreCheckResult,
} from './precheck.js';

// parallel-tuner (Task 5：并行调优 — 动态调整并行度)
export {
  ParallelTuner,
  getDefaultParallelism,
  tuneParallelism,
  getCpuCount,
  DEFAULT_MAX_PARALLELISM,
  DEFAULT_MIN_PARALLELISM,
  DEFAULT_LARGE_FILE_THRESHOLD,
  DEFAULT_SMALL_FILE_THRESHOLD,
} from './parallel-tuner.js';
export type {
  TuneParallelismInput,
  TuneParallelismResult,
} from './parallel-tuner.js';

// streaming-output (Task 6：流式输出 — SSE 事件流)
export {
  StreamingEmitter,
  createStreamingEmitter,
  streamProcessFiles,
  errorToPayload,
} from './streaming-output.js';
export type {
  StreamingEvent,
  StreamWriter,
  StreamStartPayload,
  StreamFileStartPayload,
  StreamFileCompletePayload,
  StreamCompletePayload,
  StreamErrorPayload,
  StreamingPayloadMap,
  StreamingListener,
} from './streaming-output.js';

// orchestrator 补充导出 runWithConcurrency (Task 5 集成)
export { runWithConcurrency } from './orchestrator.js';

// rbac (Task 10：RBAC 权限控制 — admin / reviewer / viewer 三层角色 + 命令权限校验)
export {
  RbacManager,
  checkPermission,
  loadRoles,
  resolveRolePermissions,
  isValidRole,
  getRequiredPermission,
  ROLES,
  COMMAND_PERMISSIONS,
  DEFAULT_RBAC_CONFIG_FILE,
} from './rbac.js';
export type {
  RoleName,
  RbacConfig,
} from './rbac.js';

// audit-logger (Task 11：审计日志 — 记录用户操作、命令、findings，支持按用户/命令/结果过滤查询)
export {
  AuditLogger,
  logAction,
  getAuditLog,
  readAuditLogFile,
  DEFAULT_AUDIT_LOG_FILE,
  DEFAULT_AUDIT_HISTORY_LIMIT,
} from './audit-logger.js';
export type {
  AuditLogEntry,
  AuditResult,
  AuditQueryOptions,
} from './audit-logger.js';

// compliance-checker (Task 12：合规检查 — OWASP Top 10 / CWE Top 25 标准映射与合规报告)
export {
  ComplianceChecker,
  checkCompliance,
  OWASP_TOP_10,
  CWE_TOP_25,
} from './compliance-checker.js';
export type {
  OwaspCategoryId,
  CweId,
  OwaspCategory,
  CweEntry,
  ComplianceMapping,
  OwaspCategoryStat,
  ComplianceReport,
  CustomMapping,
} from './compliance-checker.js';

// tui (Task 13：交互式 TUI — 仅使用 ANSI 转义序列，不依赖外部 TUI 库)
export {
  ReviewTUI,
  launchTUI,
  renderFindings,
  sortFindings,
  sortFindingsBySeverity,
  sortFindingsByFile,
  sortFindingsByLine,
  sortFindingsByCategory,
  filterFindings,
  severityAnsiColor,
  colorizeSeverityTag,
  TUI_KEYS,
  ANSI_CLEAR_SCREEN,
  ANSI_CLEAR_LINE,
  ANSI_HIDE_CURSOR,
  ANSI_SHOW_CURSOR,
  ANSI_RESET,
  ANSI_BOLD,
  ANSI_REVERSE,
  ANSI_REVERSE_OFF,
  ANSI_FG,
  ANSI_BG,
} from './tui.js';
export type {
  TUISortMode,
  TUIFilter,
  TUIOptions,
  RenderFindingsOptions,
} from './tui.js';

// color-output (Task 14：彩色输出 — ANSI 颜色码 + NO_COLOR / FORCE_COLOR 标准支持)
export {
  colorizeSeverity,
  colorizeFinding,
  formatColoredOutput,
  shouldUseColor,
  severityColor,
  stripAnsi,
  hasAnsiColor,
  RESET,
  BOLD,
  DIM,
  ITALIC,
  UNDERLINE,
  REVERSE,
  FG,
  BG,
  SEVERITY_COLOR,
  SEVERITY_LABEL,
  SEVERITY_ICON,
} from './color-output.js';
export type {
  ColorizeFindingOptions,
  FormatColoredOutputOptions,
} from './color-output.js';

// result-exporter (Task 15：结果导出 — JSON / Markdown / SARIF v2.1.0 / HTML)
export {
  exportResults,
  exportJSON,
  exportMarkdown,
  exportSARIF,
  exportHTML,
  SARIF_LEVEL,
  escapeHtml,
  SEVERITY_HTML_STYLE,
  buildSummary,
} from './result-exporter.js';
export type {
  ExportFormat,
  ExportOptions,
  ToolInfo,
} from './result-exporter.js';

// webhook-notifier (Task 16：Webhook 通知 — review.completed / review.failed / finding.critical)
// 注：post-processor.ts 已导出同名 countBySeverity（Record<string, number>），
// webhook-notifier.ts 的 countBySeverity 返回 Record<Severity | 'info', number>，
// 以别名 re-export 避免命名冲突
export {
  WebhookNotifier,
  sendWebhook,
  formatReviewEvent,
  countBySeverity as countBySeverityForWebhook,
} from './webhook-notifier.js';
export type {
  WebhookEventType,
  WebhookEvent,
  ReviewCompletedPayload,
  ReviewFailedPayload,
  FindingCriticalPayload,
  WebhookEndpoint,
  SendWebhookOptions,
  SendWebhookResult,
  WebhookNotifierOptions,
} from './webhook-notifier.js';

// api-server (Task 17：HTTP API 暴露 — REST API 触发审查 / 查询 findings / 健康检查 / 度量)
export {
  ApiServer,
  startApiServer,
  stopApiServer,
  DEFAULT_API_PORT,
  DEFAULT_API_HOST,
  API_VERSION,
} from './api-server.js';
export type {
  ApiServerOptions,
  ReviewRequest,
  ReviewResponse,
  HealthResponse,
  FindingsResponse,
  MetricsResponse,
} from './api-server.js';

// tracing (Task 18：链路追踪 — OpenTelemetry 风格的内存 span 管理)
export {
  TracingManager,
  getGlobalTracer,
  setGlobalTracer,
  resetGlobalTracer,
  startSpan,
  endSpan,
  withSpan,
  exportTraces,
} from './tracing.js';
export type {
  Span,
  SpanStatus,
  SpanEvent,
  TraceExport,
  TracingManagerOptions,
} from './tracing.js';

// profiler (Task 19：性能剖析 — performance API + process.memoryUsage())
export {
  Profiler,
  getGlobalProfiler,
  setGlobalProfiler,
  resetGlobalProfiler,
  startProfiling,
  stopProfiling,
  getProfileReport,
  formatProfileReport,
} from './profiler.js';
export type {
  ProfilingOptions,
  MemorySnapshot,
  CpuSnapshot,
  ProfileMeasurement,
  ProfileReport,
  CategoryStat,
} from './profiler.js';

// alert-notifier (Task 20：告警通知 — Slack / Email / PagerDuty 多渠道按 severity 路由)
export {
  AlertNotifier,
  sendAlert,
  sendSlackAlert,
  sendEmailAlert,
  sendPagerDutyAlert,
  severityAtLeast,
} from './alert-notifier.js';
export type {
  AlertSeverity,
  AlertChannel,
  PagerDutyEventType,
  AlertPayload,
  SendAlertResult,
  SlackConfig,
  EmailConfig,
  PagerDutyConfig,
  WebhookConfig,
  SendAlertOptions,
  AlertNotifierOptions,
} from './alert-notifier.js';