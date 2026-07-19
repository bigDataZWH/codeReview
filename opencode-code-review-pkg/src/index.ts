// src/index.ts — 公共 API 导出
export * from './types.js';

// diff-parser
export { parseDiff, parseDiffFromGit, computeDiffStats, getHunkContext, getAdditions, getDeletions, hasSignificantChanges, parseDiffStat, filterDiffsByPath, stripAnsiEscapes, isOnlyWhitespaceChange } from './diff-parser.js';

// file-filter
export { filterFiles, bundleFiles, detectLanguage, groupByDirectory, excludeGeneratedFiles } from './file-filter.js';

// rule-engine
export { loadRules, matchRules, getRulesByCategory, getRulesBySeverity } from './rule-engine.js';

// post-processor
export { correctLineLocations, filterFalsePositives, deduplicateFindings, BUILTIN_FP_RULES, filterBySeverity, groupByFile, sortBySeverity, filterByCategory, filterBySource, filterByConfidence, countBySeverity, createCachedFilter, mergeFindings, getUniqueCategories, TRUNCATION_MESSAGE, truncateFindings } from './post-processor.js';

// prompt-builder
export { buildReviewPrompt, buildSecurityPrompt, buildImpactPrompt, buildScanPrompt, formatFindingsSummary, buildCustomPrompt, getLanguageReviewTip, wrapDiffInCodeBlock, getOWASPTop10List, estimatePromptTokens, buildReviewPromptWithTokenLimit } from './prompt-builder.js';

// mcp-adapter
export { getReviewContext, getImpactRadius, isMCPAvailable, formatMCPContext } from './mcp-adapter.js';

// comment-publisher
export { publishReview } from './comment-publisher.js';

// pipeline
export { runPipeline, applyFindings, runPipelineWithMiddleware, runPipelineFromFile, runSecurityPipeline } from './pipeline.js';
export type { PipelineMiddleware } from './pipeline.js';

// utils
export { slugify, truncateString, isCFile, isCppFile, isTestFile, isGeneratedFile, severityOrder, formatSeverity } from './utils.js';

// format
export { formatFindingMarkdown, formatFindingsMarkdown, formatFindingsJSON } from './format.js';

// validation
export { validateFinding, validatePipelineConfig } from './validation.js';

// constants
export { DEFAULT_FILTER_CONFIG, DEFAULT_BUNDLE_CONFIG, SEVERITY_ORDER, MAX_DIFF_SIZE, HIGH_CONFIDENCE_THRESHOLD, DEFAULT_IOU_THRESHOLD } from './constants.js';

// ai-reflection
export { buildReflectionPrompt, buildBatchReflectionPrompt, parseReflectionResponse, callLLM, reflectFindings } from './ai-reflection.js';