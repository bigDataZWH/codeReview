// src/index.ts — 公共 API 导出
export * from './types.js';

// diff-parser
export { parseDiff, parseDiffFromGit, computeDiffStats, getHunkContext, getAdditions, getDeletions, hasSignificantChanges, parseDiffStat, filterDiffsByPath, stripAnsiEscapes, isOnlyWhitespaceChange } from './diff-parser.js';

// file-filter
export { filterFiles, bundleFiles, detectLanguage, groupByDirectory, excludeGeneratedFiles } from './file-filter.js';

// rule-engine
export { loadRules, matchRules, getRulesByCategory, getRulesBySeverity } from './rule-engine.js';

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
export { buildReflectionPrompt, buildBatchReflectionPrompt, parseReflectionResponse, callLLM, reflectFindings, DEFAULT_REFLECTION_THRESHOLD } from './ai-reflection.js';

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