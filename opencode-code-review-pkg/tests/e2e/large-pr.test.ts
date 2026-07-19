import { describe, it, expect } from 'vitest';
import { parseDiff } from '../../src/diff-parser.js';
import { filterFiles, bundleFiles, groupByDirectory } from '../../src/file-filter.js';
import { matchRules } from '../../src/rule-engine.js';
import { runPipeline, applyFindings, chunkLargeFile, runPipelineBatched } from '../../src/pipeline.js';
import {
  correctLineLocations,
  filterFalsePositives,
  groupByFile,
  sortBySeverity,
  truncateFindings,
  mergeFindings,
} from '../../src/post-processor.js';
import {
  ReviewSessionManager,
  executeDag,
  batchProcess,
  prioritizeDiffs,
  type DagNode,
  type BatchResult,
  type BatchProcessOptions,
} from '../../src/orchestrator.js';
import { LARGE_PR_THRESHOLD, DEFAULT_BATCH_SIZE } from '../../src/constants.js';
import type { Rule, Finding, PipelineConfig, FileDiff } from '../../src/types.js';

// ── 大 PR fixtures：生成 50+ 文件 ──

function generateLargeDiff(fileCount: number): string {
  const parts: string[] = [];
  for (let i = 0; i < fileCount; i++) {
    parts.push(`diff --git a/src/module${i}/file${i}.ts b/src/module${i}/file${i}.ts
index abc${i}..def${i} 100644
--- a/src/module${i}/file${i}.ts
+++ b/src/module${i}/file${i}.ts
@@ -1,3 +1,5 @@
 export function fn${i}() {
-  return ${i};
+  const x = ${i};
+  console.log("debug ${i}");
+  return x;
 }
`);
  }
  return parts.join('\n');
}

function generateSecurityDiff(fileCount: number): string {
  const parts: string[] = [];
  for (let i = 0; i < fileCount; i++) {
    parts.push(`diff --git a/src/sec${i}.ts b/src/sec${i}.ts
index abc${i}..def${i} 100644
--- a/src/sec${i}.ts
+++ b/src/sec${i}.ts
@@ -1,3 +1,5 @@
 export function fn${i}(input: any) {
-  const sql = "SELECT * FROM t WHERE id = '" + input + "'";
+  const sql = "SELECT * FROM t WHERE id = '" + input + "'";
+  eval(input);
+  return sql;
 }
`);
  }
  return parts.join('\n');
}

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
  {
    id: 'sql-injection',
    name: 'SQL 注入检测',
    severity: 'high',
    category: 'security',
    patterns: [
      { type: 'regex', pattern: 'SELECT.*\\+.*input', message: '字符串拼接 SQL 存在注入风险' },
    ],
  },
  {
    id: 'eval',
    name: 'eval 检测',
    severity: 'critical',
    category: 'security',
    patterns: [
      { type: 'regex', pattern: '\\beval\\s*\\(', message: 'eval 存在代码注入风险' },
    ],
  },
  {
    id: 'any-type',
    name: 'any 类型检测',
    severity: 'medium',
    category: 'quality',
    language: ['typescript'],
    patterns: [
      { type: 'regex', pattern: ':\\s*any\\b', message: '禁止使用 any 类型' },
    ],
  },
];

// ── E2E：大 PR 处理 ──

describe('E2E：大 PR 处理', () => {
  const FILE_COUNT = 60;
  const LARGE_DIFF = generateLargeDiff(FILE_COUNT);

  // ==================== 解析与过滤 ====================
  describe('大 PR 解析与过滤', () => {
    it(`解析 ${FILE_COUNT}+ 文件 diff`, () => {
      const diffs = parseDiff(LARGE_DIFF);
      expect(diffs.length).toBe(FILE_COUNT);
      // 验证文件路径正确
      for (let i = 0; i < FILE_COUNT; i++) {
        expect(diffs.some((d) => d.path === `src/module${i}/file${i}.ts`)).toBe(true);
      }
    });

    it('文件过滤保持性能', () => {
      const diffs = parseDiff(LARGE_DIFF);
      const start = performance.now();
      const filtered = filterFiles(diffs, { ignorePatterns: ['**/module5/**'] });
      const elapsed = performance.now() - start;
      // 应在 200ms 内完成（保守阈值）
      expect(elapsed).toBeLessThan(200);
      // 应过滤掉 module5 子目录下的所有文件
      expect(filtered.every((d) => !d.path.includes('module5/'))).toBe(true);
    });

    it('groupByDirectory 正确分组', () => {
      const diffs = parseDiff(LARGE_DIFF);
      const grouped = groupByDirectory(diffs);
      // 应该有 FILE_COUNT 个不同的目录
      expect(grouped.size).toBe(FILE_COUNT);
      for (const [_dir, files] of grouped) {
        expect(files.length).toBe(1);
      }
    });

    it('文件打包处理大量文件', () => {
      const diffs = parseDiff(LARGE_DIFF);
      const start = performance.now();
      const bundles = bundleFiles(diffs, { bundles: [] });
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(200);
      expect(bundles.length).toBe(FILE_COUNT);
    });
  });

  // ==================== 规则匹配 ====================
  describe('大 PR 规则匹配', () => {
    it('所有文件都应用规则匹配', () => {
      const diffs = parseDiff(LARGE_DIFF);
      const bundles = bundleFiles(diffs, { bundles: [] });
      const start = performance.now();
      const annotations = bundles.flatMap((b) => matchRules(b, RULES));
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(500);
      // 每个文件应该都匹配到 console.log
      expect(annotations.length).toBeGreaterThanOrEqual(FILE_COUNT);
      const consoleAnnotations = annotations.filter((a) => a.ruleId === 'console-log');
      expect(consoleAnnotations.length).toBe(FILE_COUNT);
    });
  });

  // ==================== 管道编排 ====================
  describe('大 PR 管道编排', () => {
    it('runPipeline 完整处理 50+ 文件', async () => {
      const config: PipelineConfig = {
        filter: {},
        rules: RULES,
      };
      const start = performance.now();
      const result = await runPipeline(LARGE_DIFF, config);
      const elapsed = performance.now() - start;

      // 应在 2s 内完成（保守阈值）
      expect(elapsed).toBeLessThan(2000);

      // 所有文件都应保留
      expect(result.filteredDiffs.length).toBe(FILE_COUNT);
      // 所有 bundle 都应被标注
      expect(result.annotatedBundles.length).toBe(FILE_COUNT);
      // prompt 应包含所有文件
      for (let i = 0; i < FILE_COUNT; i++) {
        expect(result.prompt).toContain(`file${i}.ts`);
      }
    });

    it('applyFindings 处理大量 findings', async () => {
      const result = await runPipeline(LARGE_DIFF, { filter: {}, rules: RULES });
      // 为每个文件生成 1 个 finding（高置信度避免被内置 FP 规则过滤）
      const findings: Finding[] = [];
      for (let i = 0; i < FILE_COUNT; i++) {
        findings.push({
          file: `src/module${i}/file${i}.ts`,
          line: 3,
          severity: 'high',
          category: 'security',
          message: `security issue in file ${i}`,
          confidence: 0.9,
          source: 'ai',
        });
      }
      const final = applyFindings(result, findings);
      expect(final.processedFindings).toBeDefined();
      expect(final.processedFindings!.length).toBeGreaterThan(0);
    });

    it('安全专项规则匹配大 PR', async () => {
      const secDiff = generateSecurityDiff(FILE_COUNT);
      const config: PipelineConfig = {
        filter: {},
        rules: RULES,
      };
      const result = await runPipeline(secDiff, config);
      const annotations = result.annotatedBundles.flatMap((b) => b.annotations);
      // 每个文件都应匹配到 sql-injection 和 eval
      const sql = annotations.filter((a) => a.ruleId === 'sql-injection');
      const evals = annotations.filter((a) => a.ruleId === 'eval');
      expect(sql.length).toBe(FILE_COUNT);
      expect(evals.length).toBe(FILE_COUNT);
    });
  });

  // ==================== 分批处理模拟 ====================
  describe('分批处理逻辑', () => {
    it('将大文件集合分批后逐批处理，结果可合并', async () => {
      const diffs = parseDiff(LARGE_DIFF);
      const batchSize = 10;
      const batches: FileDiff[][] = [];
      for (let i = 0; i < diffs.length; i += batchSize) {
        batches.push(diffs.slice(i, i + batchSize));
      }
      expect(batches.length).toBe(Math.ceil(FILE_COUNT / batchSize));

      // 逐批处理
      const allFindings: Finding[] = [];
      for (const batch of batches) {
        // 模拟每批生成 findings
        for (const d of batch) {
          allFindings.push({
            file: d.path,
            line: 3,
            severity: 'low',
            category: 'quality',
            message: 'console.log',
            confidence: 0.7,
            source: 'rule',
          });
        }
      }
      expect(allFindings.length).toBe(FILE_COUNT);

      // 使用 mergeFindings 合并批次结果（按 file:line:category 去重）
      const merged = mergeFindings([], allFindings);
      expect(merged.length).toBe(FILE_COUNT);

      // 模拟重复批次：合并应去重
      const merged2 = mergeFindings(merged, allFindings);
      expect(merged2.length).toBe(FILE_COUNT);
    });

    it('分批处理 + sortBySeverity + groupByFile 协作', () => {
      const diffs = parseDiff(LARGE_DIFF);
      const allFindings: Finding[] = [];
      for (let i = 0; i < diffs.length; i++) {
        const severity = i % 4 === 0 ? 'critical' : i % 4 === 1 ? 'high' : i % 4 === 2 ? 'medium' : 'low';
        allFindings.push({
          file: diffs[i].path,
          line: 3,
          severity,
          category: 'quality',
          message: `issue ${i}`,
          confidence: 0.7,
          source: 'rule',
        });
      }

      const sorted = sortBySeverity(allFindings);
      expect(sorted[0].severity).toBe('critical');
      // 验证大致有序
      const sevOrder = (s: string): number => ({ critical: 4, high: 3, medium: 2, low: 1 }[s] ?? 0);
      for (let i = 1; i < sorted.length; i++) {
        expect(sevOrder(sorted[i - 1].severity)).toBeGreaterThanOrEqual(sevOrder(sorted[i].severity));
      }

      const grouped = groupByFile(sorted);
      expect(grouped.size).toBe(FILE_COUNT);
    });

    it('truncateFindings 截断过多 findings', () => {
      const findings: Finding[] = [];
      for (let i = 0; i < 200; i++) {
        findings.push({
          file: `f${i}.ts`,
          line: i,
          severity: 'low',
          category: 'quality',
          message: `m${i}`,
          confidence: 0.5,
          source: 'rule',
        });
      }
      const truncated = truncateFindings(findings, 50);
      expect(truncated.length).toBe(51); // 50 + 1 truncation marker
      const last = truncated[truncated.length - 1];
      expect(last.category).toBe('_truncation');
      expect(last.message).toContain('150');
    });
  });

  // ==================== Orchestrator + DAG 大规模并行 ====================
  describe('大 PR orchestrator DAG 编排', () => {
    it('DAG 编排多个并行节点处理文件批次', async () => {
      const diffs = parseDiff(LARGE_DIFF);
      const batchSize = 15;
      const batches: FileDiff[][] = [];
      for (let i = 0; i < diffs.length; i += batchSize) {
        batches.push(diffs.slice(i, i + batchSize));
      }

      // 构造 DAG：每个批次一个 rule-engine 节点，最后汇总
      const dag: DagNode<Finding[]>[] = batches.map((batch, i) => ({
        id: `batch-${i}`,
        agentType: 'rule-engine',
        dependencies: [],
        handler: async (ctx) => {
          // 模拟规则匹配生成 findings
          return batch.map((d) => ({
            file: d.path,
            line: 3,
            severity: 'low' as const,
            category: 'quality',
            message: 'console.log',
            confidence: 0.7,
            source: 'rule' as const,
          }));
        },
      }));

      // 汇总节点：依赖所有批次
      dag.push({
        id: 'merge',
        agentType: 'custom',
        dependencies: batches.map((_, i) => `batch-${i}`),
        handler: async (ctx) => {
          const allFindings: Finding[] = [];
          for (const [nodeId, result] of ctx.previousResults) {
            if (nodeId.startsWith('batch-')) {
              allFindings.push(...(result as Finding[]));
            }
          }
          return allFindings;
        },
      });

      const result = await executeDag(dag, { diffs, previousResults: new Map() });

      // 所有节点应成功
      expect(result.errors.size).toBe(0);
      expect(result.results.size).toBe(dag.length);

      // merge 节点应返回所有 findings
      const merged = result.results.get('merge') as Finding[];
      expect(merged.length).toBe(FILE_COUNT);
    });

    it('DAG 中单批次失败不阻塞其他批次', async () => {
      const dag: DagNode<string>[] = [
        {
          id: 'ok-1',
          agentType: 'rule-engine',
          dependencies: [],
          handler: async () => 'result-1',
        },
        {
          id: 'fail',
          agentType: 'rule-engine',
          dependencies: [],
          handler: async () => {
            throw new Error('batch failed');
          },
        },
        {
          id: 'ok-2',
          agentType: 'rule-engine',
          dependencies: [],
          handler: async () => 'result-2',
        },
        {
          id: 'dependent',
          agentType: 'custom',
          dependencies: ['fail'],
          handler: async () => 'should-not-run',
        },
      ];

      const result = await executeDag(dag, { diffs: [], previousResults: new Map() });

      // 失败节点和其依赖应标记为错误
      expect(result.errors.has('fail')).toBe(true);
      expect(result.errors.has('dependent')).toBe(true);
      // 成功节点应正常
      expect(result.results.get('ok-1')).toBe('result-1');
      expect(result.results.get('ok-2')).toBe('result-2');
    });

    it('ReviewSessionManager 跟踪大 PR 处理进度', () => {
      const manager = new ReviewSessionManager();
      const id = manager.createReviewSession({
        files: parseDiff(LARGE_DIFF),
        repo: 'owner/repo',
        prNumber: 1,
      });
      const session = manager.getSession(id);
      expect(session?.filesTotal).toBe(FILE_COUNT);

      manager.startSession(id);

      // 模拟分批推进进度
      const store = (manager as unknown as { store: { incrementFilesProcessed: (id: string, n: number) => unknown } }).store;
      store.incrementFilesProcessed(id, 20);
      store.incrementFilesProcessed(id, 20);
      store.incrementFilesProcessed(id, 20);
      const updated = manager.getSession(id);
      expect(updated?.filesProcessed).toBe(FILE_COUNT);

      manager.completeSession(id);
      expect(manager.getSessionStatus(id)).toBe('completed');
    });
  });

  // ==================== 性能基准 ====================
  describe('大 PR 性能基准', () => {
    it('完整管道处理 60 文件在合理时间内完成', async () => {
      const start = performance.now();
      const result = await runPipeline(LARGE_DIFF, { filter: {}, rules: RULES });
      const final = applyFindings(result, []);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(3000);
      expect(final.filteredDiffs.length).toBe(FILE_COUNT);
    });

    it('100 文件 diff 解析性能', () => {
      const hugeDiff = generateLargeDiff(100);
      const start = performance.now();
      const diffs = parseDiff(hugeDiff);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(1000);
      expect(diffs.length).toBe(100);
    });
  });

  // ==================== 迭代 5：分批处理与优先级排序 ====================
  describe('迭代 5：分批处理与优先级排序', () => {
    it('LARGE_PR_THRESHOLD 常量默认值 = 30', () => {
      expect(LARGE_PR_THRESHOLD).toBe(30);
    });

    it('DEFAULT_BATCH_SIZE 常量默认值 = 10', () => {
      expect(DEFAULT_BATCH_SIZE).toBe(10);
    });

    // ── 分批处理 ──
    it('batchProcess 按每批 10 个文件分批处理 60 文件', async () => {
      const diffs = parseDiff(LARGE_DIFF);
      expect(diffs.length).toBe(FILE_COUNT);

      const options: BatchProcessOptions = {
        batchSize: 10,
        processFn: async (batch) => {
          return batch.map((d) => ({
            file: d.path,
            line: 1,
            severity: 'low' as const,
            category: 'quality',
            message: 'batch finding',
            confidence: 0.7,
            source: 'rule' as const,
          }));
        },
      };

      const result = await batchProcess(diffs, options);
      expect(result.batches.length).toBe(6); // 60 / 10 = 6 批
      expect(result.allFindings.length).toBe(FILE_COUNT);
      expect(result.errors).toHaveLength(0);
      expect(result.totalProcessed).toBe(FILE_COUNT);
    });

    it('batchProcess 自定义 batchSize=15 分批正确', async () => {
      const diffs = parseDiff(LARGE_DIFF);
      const result = await batchProcess(diffs, {
        batchSize: 15,
        processFn: async (batch) => [],
      });
      // 60 / 15 = 4 批
      expect(result.batches.length).toBe(4);
      for (const batch of result.batches) {
        expect(batch.items.length).toBeLessThanOrEqual(15);
      }
    });

    it('batchProcess 空数组返回空结果', async () => {
      const result = await batchProcess([], {
        batchSize: 10,
        processFn: async () => [],
      });
      expect(result.batches).toHaveLength(0);
      expect(result.allFindings).toHaveLength(0);
      expect(result.totalProcessed).toBe(0);
    });

    // ── 优先级排序 ──
    it('prioritizeDiffs 高风险文件（含 critical annotation）排在前面', () => {
      const diffs = parseDiff(LARGE_DIFF);
      const bundles = bundleFiles(diffs, { bundles: [] });
      // 模拟：第 0 个文件有 critical 标注
      const annotated = bundles.map((b, i) => ({
        ...b,
        annotations: i === 0
          ? [
              ...b.annotations,
              {
                ruleId: 'eval',
                ruleName: 'eval',
                severity: 'critical' as const,
                message: 'eval risk',
                category: 'security',
              },
            ]
          : b.annotations,
      }));

      const sorted = prioritizeDiffs(diffs, annotated);
      // 第一个文件应是包含 critical 的文件
      expect(sorted[0].path).toBe(diffs[0].path);
    });

    it('prioritizeDiffs 大 blast-radius 文件排在前面', () => {
      const diffs = parseDiff(LARGE_DIFF);
      const bundles = bundleFiles(diffs, { bundles: [] });
      // 给第 5 个文件加上 high 严重度的标注
      const annotated = bundles.map((b, i) => ({
        ...b,
        annotations: i === 5
          ? [
              ...b.annotations,
              {
                ruleId: 'sql-injection',
                ruleName: 'SQL 注入',
                severity: 'high' as const,
                message: 'sql injection',
                category: 'security',
              },
            ]
          : b.annotations,
      }));

      const sorted = prioritizeDiffs(diffs, annotated);
      // 第 5 个文件应排在更前
      const idx5 = sorted.findIndex((d) => d.path === diffs[5].path);
      expect(idx5).toBeLessThan(5);
    });

    it('prioritizeDiffs 无标注时保持原顺序', () => {
      const diffs = parseDiff(LARGE_DIFF);
      const bundles = bundleFiles(diffs, { bundles: [] });
      const sorted = prioritizeDiffs(diffs, bundles);
      // 无标注时保持原顺序
      expect(sorted[0].path).toBe(diffs[0].path);
      expect(sorted.length).toBe(diffs.length);
    });

    // ── 并行批次 ──
    it('batchProcess parallel=true 并行执行批次', async () => {
      const diffs = parseDiff(LARGE_DIFF);
      let runningCount = 0;
      let maxRunning = 0;
      const result = await batchProcess(diffs, {
        batchSize: 10,
        parallel: true,
        processFn: async (batch) => {
          runningCount++;
          maxRunning = Math.max(maxRunning, runningCount);
          await new Promise((r) => setTimeout(r, 5));
          runningCount--;
          return batch.map((d) => ({
            file: d.path,
            line: 1,
            severity: 'low' as const,
            category: 'quality',
            message: 'parallel finding',
            confidence: 0.7,
            source: 'rule' as const,
          }));
        },
      });
      // parallel 模式下最大并发数应 > 1
      expect(maxRunning).toBeGreaterThan(1);
      expect(result.allFindings.length).toBe(FILE_COUNT);
      expect(result.errors).toHaveLength(0);
    });

    it('batchProcess parallel=false 顺序执行批次', async () => {
      const diffs = parseDiff(LARGE_DIFF);
      let runningCount = 0;
      let maxRunning = 0;
      const result = await batchProcess(diffs, {
        batchSize: 10,
        parallel: false,
        processFn: async (batch) => {
          runningCount++;
          maxRunning = Math.max(maxRunning, runningCount);
          await new Promise((r) => setTimeout(r, 2));
          runningCount--;
          return [];
        },
      });
      // 顺序模式下最大并发数应 = 1
      expect(maxRunning).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    // ── 中途暂停和恢复 ──
    it('batchProcess 支持 pauseSignal 中途暂停与恢复', async () => {
      const diffs = parseDiff(LARGE_DIFF);
      let paused = false;
      const pauseSignal = {
        shouldPause: () => paused,
        waitWhilePaused: async () => {
          while (paused) {
            await new Promise((r) => setTimeout(r, 1));
          }
        },
      };
      const processedBatches: number[] = [];

      const promise = batchProcess(diffs, {
        batchSize: 10,
        pauseSignal,
        processFn: async (batch, batchIndex) => {
          processedBatches.push(batchIndex);
          // 第 3 批后暂停
          if (batchIndex === 2) {
            paused = true;
            // 短暂暂停后恢复
            setTimeout(() => {
              paused = false;
            }, 20);
          }
          return [];
        },
      });

      const result = await promise;
      expect(result.totalProcessed).toBe(FILE_COUNT);
      expect(processedBatches.length).toBe(6);
      // 应是连续的 0,1,2,3,4,5
      expect(processedBatches).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('batchProcess 单批次失败不影响其他批次', async () => {
      const diffs = parseDiff(LARGE_DIFF);
      const result = await batchProcess(diffs, {
        batchSize: 10,
        processFn: async (_batch, batchIndex) => {
          if (batchIndex === 2) {
            throw new Error('batch 2 failed');
          }
          return [];
        },
      });
      // batch 2 应在 errors 中
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].batchIndex).toBe(2);
      // 其他批次应正常处理
      expect(result.totalProcessed).toBe(FILE_COUNT);
    });

    // ── 大文件分块 ──
    it('chunkLargeFile 超过 maxPatchLength 的文件被分块', () => {
      // 构造一个超长 diff：单文件超过 1000 字符
      const longContent = 'x'.repeat(1500);
      const longDiff = `diff --git a/big.ts b/big.ts
index abc..def 100644
--- a/big.ts
+++ b/big.ts
@@ -1,1 +1,1 @@
-${longContent}
+${longContent}
`;
      const diffs = parseDiff(longDiff);
      expect(diffs.length).toBe(1);

      const chunks = chunkLargeFile(diffs[0], 1000);
      // 应至少分 2 块
      expect(chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('chunkLargeFile 小于 maxPatchLength 时不分块', () => {
      const smallDiff = `diff --git a/small.ts b/small.ts
index abc..def 100644
--- a/small.ts
+++ b/small.ts
@@ -1,1 +1,1 @@
-x
+y
`;
      const diffs = parseDiff(smallDiff);
      const chunks = chunkLargeFile(diffs[0], 100_000);
      expect(chunks.length).toBe(1);
    });

    it('chunkLargeFile 空 hunks 返回单元素数组', () => {
      const empty: FileDiff = { path: 'empty.ts', status: 'modified', hunks: [] };
      const chunks = chunkLargeFile(empty, 1000);
      expect(chunks.length).toBe(1);
    });

    // ── runPipelineBatched 集成 ──
    it('runPipelineBatched 大 PR 自动触发分批处理', async () => {
      const config: PipelineConfig = {
        filter: {},
        rules: RULES,
        batching: { threshold: 30, batchSize: 10, prioritize: true },
      };
      const result = await runPipelineBatched(LARGE_DIFF, config);
      expect(result.filteredDiffs.length).toBe(FILE_COUNT);
      expect(result.bundles.length).toBe(FILE_COUNT);
      // 应包含分批元信息
      expect(result.batchInfo).toBeDefined();
      expect(result.batchInfo!.batchesCount).toBe(6);
      expect(result.batchInfo!.totalFiles).toBe(FILE_COUNT);
    });

    it('runPipelineBatched 小 PR 不触发分批', async () => {
      const smallDiff = generateLargeDiff(10);
      const config: PipelineConfig = {
        filter: {},
        rules: RULES,
        batching: { threshold: 30, batchSize: 10 },
      };
      const result = await runPipelineBatched(smallDiff, config);
      expect(result.filteredDiffs.length).toBe(10);
      // 小 PR 不分批
      expect(result.batchInfo).toBeUndefined();
    });
  });
});
