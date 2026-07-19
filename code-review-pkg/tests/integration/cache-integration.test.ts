// tests/integration/cache-integration.test.ts
// 迭代 4：缓存集成测试
// 验证 CacheManager 集成到 pipeline / mcp-adapter 后，相同输入的缓存命中行为与命中率统计

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPipeline } from '../../src/pipeline.js';
import { getReviewContextWithCache, _resetMCPContextCache } from '../../src/mcp-adapter.js';
import { CacheManager } from '../../src/cache.js';
import type { PipelineConfig, Rule } from '../../src/types.js';

const SIMPLE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 import { foo } from './foo';
-const x = 1;
+const x = 2;
+const y = 3;
 export default x;
`;

const RULES: Rule[] = [
  {
    id: 'console-log',
    name: 'console.log 检测',
    severity: 'low',
    category: 'quality',
    patterns: [
      { type: 'regex', pattern: 'console\\.log', message: '禁止使用 console.log' },
    ],
  },
];

describe('集成测试：缓存命中率优化（迭代 4）', () => {
  let cacheDir: string;
  let cache: CacheManager;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'cache-int-'));
    cache = new CacheManager({ diskCacheDir: cacheDir });
    _resetMCPContextCache();
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  // ==================== diff-parser 缓存 ====================

  describe('diff-parser 结果缓存', () => {
    it('相同 diff 内容多次运行管道应命中 diff 缓存', async () => {
      const config: PipelineConfig = { filter: {}, rules: RULES, cache };
      // 第一次运行：cache miss
      const r1 = await runPipeline(SIMPLE_DIFF, config);
      expect(r1.filteredDiffs).toHaveLength(1);
      const stats1 = cache.getHitStats();
      // 至少触发一次 miss（diff 解析）
      expect(stats1.misses).toBeGreaterThan(0);

      // 第二次运行：相同 diff 内容应命中缓存
      const r2 = await runPipeline(SIMPLE_DIFF, config);
      expect(r2.filteredDiffs).toEqual(r1.filteredDiffs);

      const stats2 = cache.getHitStats();
      // 第二次应有 hits 增长
      expect(stats2.hits).toBeGreaterThan(stats1.hits);
    });

    it('不同 diff 内容不应命中 diff 缓存', async () => {
      const config: PipelineConfig = { filter: {}, rules: RULES, cache };
      const diff2 = SIMPLE_DIFF.replace('const y = 3;', 'const z = 4;');

      await runPipeline(SIMPLE_DIFF, config);
      const stats1 = { ...cache.getHitStats() };

      await runPipeline(diff2, config);
      const stats2 = cache.getHitStats();
      // 第二次应有新的 miss
      expect(stats2.misses).toBeGreaterThan(stats1.misses);
    });
  });

  // ==================== rule-engine 缓存 ====================

  describe('rule-engine 匹配结果缓存', () => {
    it('相同 bundle+规则集应命中规则匹配缓存', async () => {
      const config: PipelineConfig = { filter: {}, rules: RULES, cache };
      // 第一次运行：cache miss
      await runPipeline(SIMPLE_DIFF, config);
      const stats1 = { ...cache.getHitStats() };

      // 第二次运行：相同文件 + 规则应命中
      await runPipeline(SIMPLE_DIFF, config);
      const stats2 = cache.getHitStats();
      expect(stats2.hits).toBeGreaterThan(stats1.hits);
    });

    it('不同规则版本号应使规则匹配缓存失效', async () => {
      // 首次使用 v1 规则
      const configV1: PipelineConfig = { filter: {}, rules: RULES, cache };
      await runPipeline(SIMPLE_DIFF, configV1);
      const stats1 = { ...cache.getHitStats() };

      // 切换规则版本号，应触发新的 miss
      const configV2: PipelineConfig = {
        filter: {},
        rules: RULES,
        cache,
        cacheOptions: { ruleVersion: 'v2' },
      };
      await runPipeline(SIMPLE_DIFF, configV2);
      const stats2 = cache.getHitStats();
      expect(stats2.misses).toBeGreaterThan(stats1.misses);
    });
  });

  // ==================== MCP 上下文缓存 ====================

  describe('MCP 上下文查询缓存', () => {
    it('相同文件路径列表应命中 MCP 上下文缓存', async () => {
      const filePaths = ['src/app.ts', 'src/util.ts'];
      // 第一次查询：miss
      const c1 = await getReviewContextWithCache(filePaths, cache);
      expect(c1.filePaths).toEqual(filePaths);
      const stats1 = { ...cache.getHitStats() };

      // 第二次查询：相同路径列表应命中缓存
      const c2 = await getReviewContextWithCache(filePaths, cache);
      expect(c2.filePaths).toEqual(filePaths);
      const stats2 = cache.getHitStats();
      expect(stats2.hits).toBeGreaterThan(stats1.hits);
    });

    it('不同文件路径列表不应命中 MCP 上下文缓存', async () => {
      const paths1 = ['src/a.ts'];
      const paths2 = ['src/b.ts'];

      await getReviewContextWithCache(paths1, cache);
      const stats1 = { ...cache.getHitStats() };

      await getReviewContextWithCache(paths2, cache);
      const stats2 = cache.getHitStats();
      expect(stats2.misses).toBeGreaterThan(stats1.misses);
    });
  });

  // ==================== 命中率统计 ====================

  describe('缓存命中率统计', () => {
    it('重复运行相同管道，命中率应 ≥ 60%', async () => {
      const config: PipelineConfig = { filter: {}, rules: RULES, cache, mcpEnabled: false };

      // 首次运行（必然 miss）
      await runPipeline(SIMPLE_DIFF, config);

      // 后续多次运行（应命中）
      for (let i = 0; i < 5; i++) {
        await runPipeline(SIMPLE_DIFF, config);
      }

      const stats = cache.getHitStats();
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.hitRate).toBeGreaterThanOrEqual(0.6);
    });

    it('getOrCreate 模式：未命中时调用 factory 并写入', () => {
      let called = 0;
      const v1 = cache.getOrCreate('test-key', () => {
        called++;
        return 'first';
      });
      expect(v1).toBe('first');
      expect(called).toBe(1);

      const v2 = cache.getOrCreate('test-key', () => {
        called++;
        return 'second';
      });
      expect(v2).toBe('first');
      expect(called).toBe(1); // 未调用 factory
    });

    it('resetHitStats 重置后命中率重新统计', async () => {
      const config: PipelineConfig = { filter: {}, rules: RULES, cache };
      await runPipeline(SIMPLE_DIFF, config);
      await runPipeline(SIMPLE_DIFF, config);

      cache.resetHitStats();
      const stats = cache.getHitStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.total).toBe(0);
    });
  });
});
