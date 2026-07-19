import { describe, it, expect } from 'vitest';
import * as api from '../src/index.js';

// ── 辅助：检测一个值是否为可调用函数 ──
function isFunction(v: unknown): v is (...args: unknown[]) => unknown {
  return typeof v === 'function';
}

function isClass(v: unknown): boolean {
  return typeof v === 'function' && /^\s*class\s+/.test(Function.prototype.toString.call(v));
}

// ── 验证所有公共 API 都被导出且可调用 ──

describe('index.ts 公共 API 导出', () => {
  // ==================== diff-parser ====================
  describe('diff-parser 导出', () => {
    const names = [
      'parseDiff',
      'parseDiffFromGit',
      'computeDiffStats',
      'getHunkContext',
      'getAdditions',
      'getDeletions',
      'hasSignificantChanges',
      'parseDiffStat',
      'filterDiffsByPath',
      'stripAnsiEscapes',
      'isOnlyWhitespaceChange',
    ] as const;

    for (const name of names) {
      it(`导出函数 ${name}`, () => {
        expect(api[name]).toBeDefined();
        expect(isFunction(api[name])).toBe(true);
      });
    }

    it('parseDiff 可正确解析 diff 文本', () => {
      const diff = `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,1 @@
-a
+b
`;
      const result = api.parseDiff(diff);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].path).toBe('a.ts');
    });
  });

  // ==================== file-filter ====================
  describe('file-filter 导出', () => {
    const names = [
      'filterFiles',
      'bundleFiles',
      'detectLanguage',
      'groupByDirectory',
      'excludeGeneratedFiles',
    ] as const;

    for (const name of names) {
      it(`导出函数 ${name}`, () => {
        expect(api[name]).toBeDefined();
        expect(isFunction(api[name])).toBe(true);
      });
    }
  });

  // ==================== rule-engine ====================
  describe('rule-engine 导出', () => {
    const names = ['loadRules', 'matchRules', 'getRulesByCategory', 'getRulesBySeverity'] as const;

    for (const name of names) {
      it(`导出函数 ${name}`, () => {
        expect(api[name]).toBeDefined();
        expect(isFunction(api[name])).toBe(true);
      });
    }
  });

  // ==================== post-processor ====================
  describe('post-processor 导出', () => {
    const names = [
      'correctLineLocations',
      'filterFalsePositives',
      'deduplicateFindings',
      'filterBySeverity',
      'groupByFile',
      'sortBySeverity',
      'filterByCategory',
      'filterBySource',
      'filterByConfidence',
      'countBySeverity',
      'createCachedFilter',
      'mergeFindings',
      'getUniqueCategories',
      'truncateFindings',
    ] as const;

    for (const name of names) {
      it(`导出函数 ${name}`, () => {
        expect(api[name]).toBeDefined();
        expect(isFunction(api[name])).toBe(true);
      });
    }

    it('导出常量 BUILTIN_FP_RULES', () => {
      expect(api.BUILTIN_FP_RULES).toBeDefined();
      expect(Array.isArray(api.BUILTIN_FP_RULES)).toBe(true);
    });

    it('导出常量 TRUNCATION_MESSAGE', () => {
      expect(api.TRUNCATION_MESSAGE).toBeDefined();
      expect(typeof api.TRUNCATION_MESSAGE).toBe('string');
    });
  });

  // ==================== prompt-builder ====================
  describe('prompt-builder 导出', () => {
    const names = [
      'buildReviewPrompt',
      'buildSecurityPrompt',
      'buildImpactPrompt',
      'buildScanPrompt',
      'formatFindingsSummary',
      'buildCustomPrompt',
      'getLanguageReviewTip',
      'wrapDiffInCodeBlock',
      'getOWASPTop10List',
      'estimatePromptTokens',
      'buildReviewPromptWithTokenLimit',
    ] as const;

    for (const name of names) {
      it(`导出函数 ${name}`, () => {
        expect(api[name]).toBeDefined();
        expect(isFunction(api[name])).toBe(true);
      });
    }
  });

  // ==================== mcp-adapter ====================
  describe('mcp-adapter 导出', () => {
    const names = ['getReviewContext', 'getImpactRadius', 'isMCPAvailable', 'formatMCPContext'] as const;

    for (const name of names) {
      it(`导出函数 ${name}`, () => {
        expect(api[name]).toBeDefined();
        expect(isFunction(api[name])).toBe(true);
      });
    }
  });

  // ==================== comment-publisher ====================
  describe('comment-publisher 导出', () => {
    it('导出函数 publishReview', () => {
      expect(api.publishReview).toBeDefined();
      expect(isFunction(api.publishReview)).toBe(true);
    });
  });

  // ==================== pipeline ====================
  describe('pipeline 导出', () => {
    const names = [
      'runPipeline',
      'applyFindings',
      'runPipelineWithMiddleware',
      'runPipelineFromFile',
      'runSecurityPipeline',
    ] as const;

    for (const name of names) {
      it(`导出函数 ${name}`, () => {
        expect(api[name]).toBeDefined();
        expect(isFunction(api[name])).toBe(true);
      });
    }
  });

  // ==================== utils ====================
  describe('utils 导出', () => {
    const names = [
      'slugify',
      'truncateString',
      'isCFile',
      'isCppFile',
      'isTestFile',
      'isGeneratedFile',
      'severityOrder',
      'formatSeverity',
    ] as const;

    for (const name of names) {
      it(`导出函数 ${name}`, () => {
        expect(api[name]).toBeDefined();
        expect(isFunction(api[name])).toBe(true);
      });
    }
  });

  // ==================== format ====================
  describe('format 导出', () => {
    const names = ['formatFindingMarkdown', 'formatFindingsMarkdown', 'formatFindingsJSON'] as const;

    for (const name of names) {
      it(`导出函数 ${name}`, () => {
        expect(api[name]).toBeDefined();
        expect(isFunction(api[name])).toBe(true);
      });
    }
  });

  // ==================== validation ====================
  describe('validation 导出', () => {
    const names = ['validateFinding', 'validatePipelineConfig'] as const;

    for (const name of names) {
      it(`导出函数 ${name}`, () => {
        expect(api[name]).toBeDefined();
        expect(isFunction(api[name])).toBe(true);
      });
    }
  });

  // ==================== constants ====================
  describe('constants 导出', () => {
    const names = [
      'DEFAULT_FILTER_CONFIG',
      'DEFAULT_BUNDLE_CONFIG',
      'SEVERITY_ORDER',
      'MAX_DIFF_SIZE',
      'HIGH_CONFIDENCE_THRESHOLD',
      'DEFAULT_IOU_THRESHOLD',
    ] as const;

    for (const name of names) {
      it(`导出常量 ${name}`, () => {
        expect(api[name]).toBeDefined();
      });
    }

    it('DEFAULT_FILTER_CONFIG 是合法的 FilterConfig', () => {
      expect(api.DEFAULT_FILTER_CONFIG).toBeTypeOf('object');
      expect(Array.isArray(api.DEFAULT_FILTER_CONFIG.ignorePatterns)).toBe(true);
    });

    it('SEVERITY_ORDER 映射包含全部严重度', () => {
      expect(api.SEVERITY_ORDER.critical).toBeGreaterThan(api.SEVERITY_ORDER.high);
      expect(api.SEVERITY_ORDER.high).toBeGreaterThan(api.SEVERITY_ORDER.medium);
      expect(api.SEVERITY_ORDER.medium).toBeGreaterThan(api.SEVERITY_ORDER.low);
    });
  });

  // ==================== ai-reflection ====================
  describe('ai-reflection 导出', () => {
    const names = [
      'buildReflectionPrompt',
      'buildBatchReflectionPrompt',
      'parseReflectionResponse',
      'callLLM',
      'reflectFindings',
    ] as const;

    for (const name of names) {
      it(`导出函数 ${name}`, () => {
        expect(api[name]).toBeDefined();
        expect(isFunction(api[name])).toBe(true);
      });
    }
  });

  // ==================== state ====================
  describe('state 导出', () => {
    const functionNames = [
      'createSession',
      'getSession',
      'updateSessionStatus',
      'listSessions',
      'saveFindings',
      'getFindingsBySession',
      'getFindingsByFile',
      'resumeInterruptedSessions',
      'getTrendStats',
    ] as const;

    for (const name of functionNames) {
      it(`导出函数 ${name}`, () => {
        expect(api[name]).toBeDefined();
        expect(isFunction(api[name])).toBe(true);
      });
    }

    it('导出类 StateStore', () => {
      expect(api.StateStore).toBeDefined();
      expect(isClass(api.StateStore) || isFunction(api.StateStore)).toBe(true);
      const store = new api.StateStore();
      expect(store).toBeInstanceOf(api.StateStore);
    });
  });

  // ==================== cache ====================
  describe('cache 导出', () => {
    const classNames = ['L1MemoryCache', 'L2DiskCache', 'CacheManager'] as const;

    for (const name of classNames) {
      it(`导出类 ${name}`, () => {
        expect(api[name]).toBeDefined();
        expect(isClass(api[name]) || isFunction(api[name])).toBe(true);
      });
    }

    it('L1MemoryCache 可实例化并工作', () => {
      const cache = new api.L1MemoryCache();
      cache.set('k', 'v');
      expect(cache.get('k')).toBe('v');
    });
  });

  // ==================== feedback ====================
  describe('feedback 导出', () => {
    const functionNames = ['loadIgnoreConfig', 'shouldIgnore'] as const;
    for (const name of functionNames) {
      it(`导出函数 ${name}`, () => {
        expect(api[name]).toBeDefined();
        expect(isFunction(api[name])).toBe(true);
      });
    }

    it('导出类 FeedbackStore', () => {
      expect(api.FeedbackStore).toBeDefined();
      expect(isClass(api.FeedbackStore) || isFunction(api.FeedbackStore)).toBe(true);
    });

    it('导出常量 FALSE_POSITIVE_ANALYSIS_THRESHOLD', () => {
      expect(api.FALSE_POSITIVE_ANALYSIS_THRESHOLD).toBeDefined();
      expect(typeof api.FALSE_POSITIVE_ANALYSIS_THRESHOLD).toBe('number');
    });
  });

  // ==================== orchestrator ====================
  describe('orchestrator 导出', () => {
    const functionNames = [
      'executeDag',
      'mergeResults',
      'shouldSkipImpactAnalysis',
      'buildReviewDag',
      'withFallback',
      'withRetry',
      'getReviewContextWithFallback',
      'callModelWithTimeout',
    ] as const;

    for (const name of functionNames) {
      it(`导出函数 ${name}`, () => {
        expect(api[name]).toBeDefined();
        expect(isFunction(api[name])).toBe(true);
      });
    }

    it('导出类 ReviewSessionManager', () => {
      expect(api.ReviewSessionManager).toBeDefined();
      expect(isClass(api.ReviewSessionManager) || isFunction(api.ReviewSessionManager)).toBe(true);
      const mgr = new api.ReviewSessionManager();
      expect(mgr).toBeInstanceOf(api.ReviewSessionManager);
    });
  });

  // ==================== 端到端：核心 API 协作 ====================
  describe('端到端：核心 API 协作验证', () => {
    it('parseDiff → filterFiles → bundleFiles → matchRules → buildReviewPrompt 链路', async () => {
      const diffText = `diff --git a/src/app.ts b/src/app.ts
index abc..def 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 import { foo } from './foo';
-const x = 1;
+const x = 2;
+console.log("debug");
 export default x;
`;
      // 1. parse
      const diffs = api.parseDiff(diffText);
      expect(diffs.length).toBe(1);

      // 2. filter
      const filtered = api.filterFiles(diffs, {});
      expect(filtered.length).toBe(1);

      // 3. bundle
      const bundles = api.bundleFiles(filtered, { bundles: [] });
      expect(bundles.length).toBeGreaterThan(0);

      // 4. match rules
      const annotations = api.matchRules(bundles[0], []);
      expect(Array.isArray(annotations)).toBe(true);

      // 5. build prompt
      const annotated = bundles.map((b) => ({ ...b, annotations: [...b.annotations, ...annotations] }));
      const prompt = api.buildReviewPrompt({
        filteredDiffs: filtered,
        bundles,
        annotatedBundles: annotated,
      });
      expect(prompt).toContain('src/app.ts');
    });

    it('validateFinding + formatFindingMarkdown + formatFindingsJSON 协作', () => {
      const finding = {
        file: 'src/app.ts',
        line: 5,
        severity: 'high' as const,
        category: 'security',
        message: 'sql injection',
        confidence: 0.9,
        source: 'rule' as const,
      };

      const errors = api.validateFinding(finding);
      expect(errors).toHaveLength(0);

      const md = api.formatFindingMarkdown(finding);
      expect(md).toContain('HIGH');
      expect(md).toContain('sql injection');

      const json = api.formatFindingsJSON([finding]);
      expect(JSON.parse(json)).toHaveLength(1);
    });

    it('runPipeline 完整流程', async () => {
      const diffText = `diff --git a/src/app.ts b/src/app.ts
index abc..def 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 import { foo } from './foo';
-const x = 1;
+const x = 2;
+console.log("debug");
 export default x;
`;
      const result = await api.runPipeline(diffText, { filter: {} });
      expect(result.filteredDiffs.length).toBe(1);
      expect(result.prompt).toContain('src/app.ts');
    });

    it('ReviewSessionManager + StateStore 协作', () => {
      const mgr = new api.ReviewSessionManager();
      const id = mgr.createReviewSession({ repo: 'o/r', prNumber: 1 });
      expect(mgr.getSessionStatus(id)).toBe('pending');
      mgr.startSession(id);
      expect(mgr.getSessionStatus(id)).toBe('running');
      mgr.completeSession(id);
      expect(mgr.getSessionStatus(id)).toBe('completed');
    });
  });
});
