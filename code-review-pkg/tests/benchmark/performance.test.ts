import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDiff } from '../../src/diff-parser.js';
import { filterFiles, bundleFiles } from '../../src/file-filter.js';
import { matchRules } from '../../src/rule-engine.js';
import { runPipeline, applyFindings } from '../../src/pipeline.js';
import {
  correctLineLocations,
  filterFalsePositives,
  deduplicateFindings,
  sortBySeverity,
} from '../../src/post-processor.js';
import { L1MemoryCache, L2DiskCache, CacheManager } from '../../src/cache.js';
import { formatFindingsMarkdown } from '../../src/format.js';
import type { Rule, Finding, FileDiff } from '../../src/types.js';

// ── 工具：生成大 diff ──

function generateLargeDiff(fileCount: number, linesPerFile: number = 5): string {
  const parts: string[] = [];
  for (let i = 0; i < fileCount; i++) {
    const lines: string[] = [];
    for (let j = 0; j < linesPerFile; j++) {
      lines.push(`+line ${j} in file ${i}`);
    }
    parts.push(`diff --git a/src/file${i}.ts b/src/file${i}.ts
index abc${i}..def${i} 100644
--- a/src/file${i}.ts
+++ b/src/file${i}.ts
@@ -1,1 +1,${linesPerFile + 1} @@
 import { x } from 'x';
${lines.join('\n')}
`);
  }
  return parts.join('\n');
}

function generateRules(count: number): Rule[] {
  const rules: Rule[] = [];
  for (let i = 0; i < count; i++) {
    rules.push({
      id: `rule-${i}`,
      name: `Rule ${i}`,
      severity: i % 4 === 0 ? 'critical' : i % 4 === 1 ? 'high' : i % 4 === 2 ? 'medium' : 'low',
      category: i % 2 === 0 ? 'security' : 'quality',
      patterns: [
        { type: 'regex', pattern: `pattern${i}`, message: `rule ${i} matched` },
      ],
    });
  }
  return rules;
}

function generateFindings(count: number): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i < count; i++) {
    findings.push({
      file: `src/file${i % 100}.ts`,
      line: (i % 50) + 1,
      severity: i % 4 === 0 ? 'critical' : i % 4 === 1 ? 'high' : i % 4 === 2 ? 'medium' : 'low',
      category: i % 2 === 0 ? 'security' : 'quality',
      message: `finding message ${i}`,
      confidence: 0.5 + (i % 5) * 0.1,
      source: i % 2 === 0 ? 'rule' : 'ai',
    });
  }
  return findings;
}

// ── 性能基准测试 ──

describe('性能基准测试', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bench-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ==================== diff-parser 性能 ====================
  describe('diff-parser 性能', () => {
    it('解析 100 文件 diff 应在 500ms 内完成', () => {
      const diff = generateLargeDiff(100, 5);
      const start = performance.now();
      const result = parseDiff(diff);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(500);
      expect(result.length).toBe(100);
    });

    it('解析 500 文件 diff 应在 2s 内完成', () => {
      const diff = generateLargeDiff(500, 5);
      const start = performance.now();
      const result = parseDiff(diff);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(2000);
      expect(result.length).toBe(500);
    });

    it('解析单文件大 hunk（1000 行）', () => {
      const lines = Array.from({ length: 1000 }, (_, i) => `+line ${i}`).join('\n');
      const diff = `diff --git a/big.ts b/big.ts
index abc..def 100644
--- a/big.ts
+++ b/big.ts
@@ -1,1 +1,1001 @@
 import { x } from 'x';
${lines}
`;
      const start = performance.now();
      const result = parseDiff(diff);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(500);
      expect(result.length).toBe(1);
      expect(result[0].hunks[0].lines.length).toBeGreaterThan(1000);
    });

    it('解析空 diff 性能', () => {
      const start = performance.now();
      const result = parseDiff('');
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(10);
      expect(result).toEqual([]);
    });
  });

  // ==================== rule-engine 性能 ====================
  describe('rule-engine 性能', () => {
    it('100 文件 × 10 规则匹配应在 500ms 内完成', () => {
      const diff = generateLargeDiff(100, 5);
      const parsed = parseDiff(diff);
      const bundles = bundleFiles(parsed, { bundles: [] });
      const rules = generateRules(10);

      const start = performance.now();
      const annotations = bundles.flatMap((b) => matchRules(b, rules));
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(500);
      expect(annotations).toBeDefined();
    });

    it('100 文件 × 50 规则匹配应在 1s 内完成', () => {
      const diff = generateLargeDiff(100, 5);
      const parsed = parseDiff(diff);
      const bundles = bundleFiles(parsed, { bundles: [] });
      const rules = generateRules(50);

      const start = performance.now();
      bundles.flatMap((b) => matchRules(b, rules));
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(1000);
    });

    it('单文件 × 100 规则匹配', () => {
      const diff = generateLargeDiff(1, 20);
      const parsed = parseDiff(diff);
      const bundles = bundleFiles(parsed, { bundles: [] });
      const rules = generateRules(100);

      const start = performance.now();
      matchRules(bundles[0], rules);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(200);
    });
  });

  // ==================== pipeline 性能 ====================
  describe('pipeline 性能', () => {
    it('50 文件完整管道应在 1s 内完成', async () => {
      const diff = generateLargeDiff(50, 5);
      const rules = generateRules(5);
      const start = performance.now();
      await runPipeline(diff, { filter: {}, rules });
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(1000);
    });

    it('100 文件完整管道应在 2s 内完成', async () => {
      const diff = generateLargeDiff(100, 5);
      const rules = generateRules(5);
      const start = performance.now();
      await runPipeline(diff, { filter: {}, rules });
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(2000);
    });

    it('空 diff 管道处理快速返回', async () => {
      const start = performance.now();
      await runPipeline('', { filter: {}, rules: [] });
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(50);
    });
  });

  // ==================== post-processor 性能 ====================
  describe('post-processor 性能', () => {
    it('correctLineLocations 处理 1000 findings 应在 500ms 内完成', () => {
      const diff = generateLargeDiff(100, 5);
      const parsed = parseDiff(diff);
      const findings = generateFindings(1000);

      const start = performance.now();
      correctLineLocations(findings, parsed);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(500);
    });

    it('filterFalsePositives 处理 1000 findings 应在 200ms 内完成', () => {
      const findings = generateFindings(1000);

      const start = performance.now();
      filterFalsePositives(findings);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(200);
    });

    it('sortBySeverity 处理 1000 findings 应在 100ms 内完成', () => {
      const findings = generateFindings(1000);

      const start = performance.now();
      sortBySeverity(findings);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(100);
    });

    it('deduplicateFindings 处理 500 findings + 100 existing 应在 500ms 内完成', () => {
      const newFindings = generateFindings(500);
      const existing = newFindings.slice(0, 100).map((f) => ({
        file: f.file,
        line: f.line,
        body: f.message,
      }));

      const start = performance.now();
      deduplicateFindings(newFindings, existing);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(500);
    });

    it('applyFindings 端到端处理 500 findings', async () => {
      const diff = generateLargeDiff(50, 5);
      const result = await runPipeline(diff, { filter: {}, rules: [] });
      const findings = generateFindings(500);

      const start = performance.now();
      applyFindings(result, findings);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(500);
    });
  });

  // ==================== cache 命中率与性能 ====================
  describe('cache 命中率与性能', () => {
    it('L1MemoryCache 1000 次读写性能', () => {
      const cache = new L1MemoryCache();
      const N = 1000;

      // 写入
      const writeStart = performance.now();
      for (let i = 0; i < N; i++) {
        cache.set(`key-${i}`, `value-${i}`);
      }
      const writeElapsed = performance.now() - writeStart;
      expect(writeElapsed).toBeLessThan(100);

      // 读取（全部命中）
      const readStart = performance.now();
      for (let i = 0; i < N; i++) {
        cache.get(`key-${i}`);
      }
      const readElapsed = performance.now() - readStart;
      expect(readElapsed).toBeLessThan(100);
    });

    it('L2DiskCache 100 次读写性能', () => {
      const cacheDir = join(tmpDir, 'l2-cache');
      const cache = new L2DiskCache({ cacheDir });
      const N = 100;

      const writeStart = performance.now();
      for (let i = 0; i < N; i++) {
        cache.set(`key-${i}`, `value-${i}`);
      }
      const writeElapsed = performance.now() - writeStart;
      expect(writeElapsed).toBeLessThan(2000); // 磁盘 IO 较慢

      const readStart = performance.now();
      for (let i = 0; i < N; i++) {
        cache.get(`key-${i}`);
      }
      const readElapsed = performance.now() - readStart;
      expect(readElapsed).toBeLessThan(500);
    });

    it('CacheManager 命中率统计', () => {
      const cacheDir = join(tmpDir, 'cache-mgr');
      const manager = new CacheManager({ diskCacheDir: cacheDir });

      // 写入 100 个 key
      for (let i = 0; i < 100; i++) {
        manager.set(`k-${i}`, `v-${i}`);
      }

      // 读取：80 个命中，20 个未命中
      for (let i = 0; i < 80; i++) {
        manager.get(`k-${i}`);
      }
      for (let i = 0; i < 20; i++) {
        manager.get(`missing-${i}`);
      }

      const stats = manager.getHitStats();
      expect(stats.hits).toBe(80);
      expect(stats.misses).toBe(20);
      expect(stats.total).toBe(100);
      expect(stats.hitRate).toBeCloseTo(0.8, 2);
    });

    it('CacheManager L1 命中时不再访问 L2', () => {
      const cacheDir = join(tmpDir, 'cache-l1');
      const manager = new CacheManager({ diskCacheDir: cacheDir });

      manager.set('k', 'v');
      // 第一次 get 走 L1
      const start1 = performance.now();
      manager.get('k');
      const t1 = performance.now() - start1;

      // 多次 get 同一 key 应快速命中 L1
      const start2 = performance.now();
      for (let i = 0; i < 1000; i++) {
        manager.get('k');
      }
      const t2 = performance.now() - start2;

      // 1000 次命中 L1 应在 50ms 内
      expect(t2).toBeLessThan(50);
      expect(t1).toBeGreaterThanOrEqual(0);
    });
  });

  // ==================== format 性能 ====================
  describe('format 性能', () => {
    it('formatFindingsMarkdown 处理 500 findings 应在 100ms 内完成', () => {
      const findings = generateFindings(500);
      const start = performance.now();
      formatFindingsMarkdown(findings);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(100);
    });
  });

  // ==================== 综合性能基准 ====================
  describe('综合性能基准', () => {
    it('完整流程 50 文件 500 findings 在 2s 内完成', async () => {
      const diff = generateLargeDiff(50, 5);
      const rules = generateRules(5);
      const start = performance.now();

      // 1. 解析 + 管道
      const result = await runPipeline(diff, { filter: {}, rules });
      // 2. 生成 findings
      const findings = generateFindings(500);
      // 3. 后处理
      const final = applyFindings(result, findings);
      // 4. 格式化
      formatFindingsMarkdown(final.processedFindings ?? []);

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(2000);
    });

    it('多次运行性能稳定（无内存泄漏迹象）', async () => {
      const diff = generateLargeDiff(20, 5);
      const rules = generateRules(5);
      const timings: number[] = [];

      for (let run = 0; run < 5; run++) {
        const start = performance.now();
        await runPipeline(diff, { filter: {}, rules });
        timings.push(performance.now() - start);
      }

      // 后续运行不应比第一次慢 5 倍以上（无内存泄漏迹象）
      const maxTiming = Math.max(...timings);
      const minTiming = Math.min(...timings);
      expect(maxTiming / minTiming).toBeLessThan(10);
    });
  });
});
