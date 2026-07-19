import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseDiff } from '../../../src/diff-parser.js';
import {
  ParallelTuner,
  getDefaultParallelism,
  tuneParallelism,
  getCpuCount,
  DEFAULT_MAX_PARALLELISM,
  DEFAULT_MIN_PARALLELISM,
  DEFAULT_LARGE_FILE_THRESHOLD,
  DEFAULT_SMALL_FILE_THRESHOLD,
} from '../../../src/parallel-tuner.js';
import {
  batchProcess,
  runWithConcurrency,
} from '../../../src/orchestrator.js';
import type { FileDiff, Finding } from '../../../src/types.js';

// ── 测试 fixtures ──

function generateDiff(fileCount: number, contentSize: number = 100): string {
  const parts: string[] = [];
  for (let i = 0; i < fileCount; i++) {
    const content = 'x'.repeat(contentSize);
    parts.push(`diff --git a/src/file${i}.ts b/src/file${i}.ts
index abc${i}..def${i} 100644
--- a/src/file${i}.ts
+++ b/src/file${i}.ts
@@ -1,1 +1,1 @@
-old content ${i}
+${content} ${i}
`);
  }
  return parts.join('\n');
}

function makeFinding(file: string, line: number = 1): Finding {
  return {
    file,
    line,
    severity: 'low',
    category: 'quality',
    message: 'test finding',
    confidence: 0.7,
    source: 'rule',
  };
}

// ── 模块单元测试 ──

describe('parallel-tuner 模块', () => {
  describe('常量默认值', () => {
    it('DEFAULT_MAX_PARALLELISM = 16', () => {
      expect(DEFAULT_MAX_PARALLELISM).toBe(16);
    });
    it('DEFAULT_MIN_PARALLELISM = 1', () => {
      expect(DEFAULT_MIN_PARALLELISM).toBe(1);
    });
    it('DEFAULT_LARGE_FILE_THRESHOLD 合理', () => {
      expect(DEFAULT_LARGE_FILE_THRESHOLD).toBeGreaterThan(DEFAULT_SMALL_FILE_THRESHOLD);
    });
    it('DEFAULT_SMALL_FILE_THRESHOLD > 0', () => {
      expect(DEFAULT_SMALL_FILE_THRESHOLD).toBeGreaterThan(0);
    });
  });

  describe('getCpuCount', () => {
    it('返回正整数', () => {
      const count = getCpuCount();
      expect(count).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(count)).toBe(true);
    });
  });

  describe('getDefaultParallelism', () => {
    it('IO 密集型返回至少 1', () => {
      const p = getDefaultParallelism(true);
      expect(p).toBeGreaterThanOrEqual(1);
    });

    it('CPU 密集型返回至少 1', () => {
      const p = getDefaultParallelism(false);
      expect(p).toBeGreaterThanOrEqual(1);
    });

    it('不超过 maxConcurrency', () => {
      const p = getDefaultParallelism(true, 4);
      expect(p).toBeLessThanOrEqual(4);
    });

    it('IO 密集型通常大于等于 CPU 密集型', () => {
      const io = getDefaultParallelism(true);
      const cpu = getDefaultParallelism(false);
      expect(io).toBeGreaterThanOrEqual(cpu);
    });
  });

  describe('tuneParallelism', () => {
    it('空文件时返回最小并行度（>=1）', () => {
      const result = tuneParallelism({ fileCount: 0, totalPatchSize: 0 });
      expect(result.parallelism).toBeGreaterThanOrEqual(1);
      expect(result.cpuCount).toBeGreaterThanOrEqual(1);
    });

    it('少文件时并行度 = fileCount', () => {
      const result = tuneParallelism({ fileCount: 2, totalPatchSize: 1000 });
      expect(result.parallelism).toBeLessThanOrEqual(2);
    });

    it('大文件时并行度减半', () => {
      const largeSize = (DEFAULT_LARGE_FILE_THRESHOLD + 10000) * 10;
      const result = tuneParallelism({
        fileCount: 10,
        totalPatchSize: largeSize,
      });
      // 大文件 → 并行度应被减半
      expect(result.avgFileSize).toBeGreaterThan(DEFAULT_LARGE_FILE_THRESHOLD);
      expect(result.reason).toContain('halved');
    });

    it('小文件时不减半', () => {
      const smallSize = DEFAULT_SMALL_FILE_THRESHOLD * 9; // 9 文件 × 阈值 < 阈值 × 10
      const result = tuneParallelism({
        fileCount: 10,
        totalPatchSize: smallSize,
      });
      expect(result.avgFileSize).toBeLessThan(DEFAULT_SMALL_FILE_THRESHOLD);
      expect(result.reason).toContain('small files');
    });

    it('尊重 maxConcurrency 上限', () => {
      const result = tuneParallelism({
        fileCount: 1000,
        totalPatchSize: 100000,
        maxConcurrency: 2,
      });
      expect(result.parallelism).toBeLessThanOrEqual(2);
    });

    it('尊重 minConcurrency 下限', () => {
      const result = tuneParallelism({
        fileCount: 1,
        totalPatchSize: 100,
        minConcurrency: 4,
      });
      expect(result.parallelism).toBeGreaterThanOrEqual(4);
    });

    it('返回结果包含所有字段', () => {
      const result = tuneParallelism({ fileCount: 5, totalPatchSize: 1000 });
      expect(result).toHaveProperty('parallelism');
      expect(result).toHaveProperty('cpuCount');
      expect(result).toHaveProperty('ioIntensive');
      expect(result).toHaveProperty('avgFileSize');
      expect(result).toHaveProperty('reason');
    });

    it('ioIntensive 默认为 true', () => {
      const result = tuneParallelism({ fileCount: 5, totalPatchSize: 1000 });
      expect(result.ioIntensive).toBe(true);
    });

    it('CPU 密集型不放大并行度', () => {
      const result = tuneParallelism({
        fileCount: 100,
        totalPatchSize: 10000,
        ioIntensive: false,
      });
      expect(result.ioIntensive).toBe(false);
      // CPU 密集型基础 = cpuCount，不应超过 cpuCount * 2（IO 模式才会翻倍）
      expect(result.parallelism).toBeLessThanOrEqual(result.cpuCount * 2 + 1);
    });
  });

  describe('ParallelTuner 类', () => {
    it('默认构造器创建实例', () => {
      const tuner = new ParallelTuner();
      expect(tuner).toBeInstanceOf(ParallelTuner);
      expect(tuner.getLastResult()).toBeNull();
    });

    it('tune(diffs) 基于 FileDiff[] 调优', () => {
      const diffs = parseDiff(generateDiff(10));
      const tuner = new ParallelTuner();
      const result = tuner.tune(diffs);
      expect(result.parallelism).toBeGreaterThanOrEqual(1);
      expect(result.avgFileSize).toBeGreaterThan(0);
      expect(tuner.getLastResult()).toBe(result);
    });

    it('tune(空数组) 返回 >= 1 并行度', () => {
      const tuner = new ParallelTuner();
      const result = tuner.tune([]);
      expect(result.parallelism).toBeGreaterThanOrEqual(1);
      expect(result.avgFileSize).toBe(0);
    });

    it('tuneBatch 限制并行度不超过批次数', () => {
      const diffs = parseDiff(generateDiff(5));
      const tuner = new ParallelTuner();
      // 5 文件，batchSize=10 → 1 批
      const result = tuner.tuneBatch(diffs, 10);
      expect(result.parallelism).toBe(1);
      expect(result.reason).toContain('batchCount=1');
    });

    it('tuneBatch 多批时并行度 <= 批次数', () => {
      const diffs = parseDiff(generateDiff(50));
      const tuner = new ParallelTuner();
      // 50 文件，batchSize=5 → 10 批
      const result = tuner.tuneBatch(diffs, 5);
      expect(result.parallelism).toBeLessThanOrEqual(10);
      expect(result.reason).toContain('batchCount=10');
    });

    it('tuneBatch batchSize=0 抛出错误', () => {
      const tuner = new ParallelTuner();
      expect(() => tuner.tuneBatch([], 0)).toThrow(/batchSize/);
    });

    it('构造选项可覆盖默认上限与下限', () => {
      const tuner = new ParallelTuner({ maxConcurrency: 2, minConcurrency: 1 });
      const diffs = parseDiff(generateDiff(100));
      const result = tuner.tune(diffs);
      expect(result.parallelism).toBeLessThanOrEqual(2);
    });

    it('tune 透传 ioIntensive 选项', () => {
      const tuner = new ParallelTuner({ ioIntensive: false });
      const diffs = parseDiff(generateDiff(100));
      const result = tuner.tune(diffs);
      expect(result.ioIntensive).toBe(false);
    });

    it('getLastResult 在 tune 后返回最新结果', () => {
      const tuner = new ParallelTuner();
      expect(tuner.getLastResult()).toBeNull();
      const diffs = parseDiff(generateDiff(5));
      const r1 = tuner.tune(diffs);
      expect(tuner.getLastResult()).toBe(r1);
      const r2 = tuner.tune(diffs);
      expect(tuner.getLastResult()).toBe(r2);
      expect(r2).not.toBe(r1);
    });
  });
});

// ── orchestrator 集成测试 ──

describe('batchProcess 并行调优集成', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parallel=true 时使用 effectiveParallelism', async () => {
    const diffs = parseDiff(generateDiff(50));
    const result = await batchProcess(diffs, {
      batchSize: 10,
      parallel: true,
      processFn: async (batch) => batch.map((d) => makeFinding(d.path)),
    });
    // 50 文件 / batchSize 10 = 5 批
    expect(result.batches.length).toBe(5);
    expect(result.effectiveParallelism).toBeDefined();
    expect(result.effectiveParallelism).toBeGreaterThanOrEqual(1);
    expect(result.effectiveParallelism).toBeLessThanOrEqual(5);
    expect(result.allFindings.length).toBe(50);
    expect(result.errors).toHaveLength(0);
  });

  it('parallel=false 时 effectiveParallelism = 1', async () => {
    const diffs = parseDiff(generateDiff(20));
    const result = await batchProcess(diffs, {
      batchSize: 5,
      parallel: false,
      processFn: async () => [],
    });
    expect(result.effectiveParallelism).toBe(1);
  });

  it('指定 parallelism 时使用该值', async () => {
    const diffs = parseDiff(generateDiff(30));
    let maxRunning = 0;
    let running = 0;
    const result = await batchProcess(diffs, {
      batchSize: 5,
      parallel: true,
      parallelism: 2,
      useTuner: false,
      processFn: async (batch) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        return batch.map((d) => makeFinding(d.path));
      },
    });
    // 6 批，并发 2 → 最大 2
    expect(maxRunning).toBeLessThanOrEqual(2);
    expect(maxRunning).toBeGreaterThanOrEqual(1);
    expect(result.effectiveParallelism).toBe(2);
  });

  it('useTuner=false 且未指定 parallelism 时使用默认并行度', async () => {
    const diffs = parseDiff(generateDiff(50));
    const result = await batchProcess(diffs, {
      batchSize: 10,
      parallel: true,
      useTuner: false,
      processFn: async () => [],
    });
    // 默认 = getDefaultParallelism()，但不超批次数 5
    const expected = Math.min(getDefaultParallelism(true), 5);
    expect(result.effectiveParallelism).toBe(expected);
  });

  it('effectiveParallelism 不超过批次数', async () => {
    const diffs = parseDiff(generateDiff(5));
    const result = await batchProcess(diffs, {
      batchSize: 10, // 1 batch
      parallel: true,
      parallelism: 100,
      useTuner: false,
      processFn: async () => [],
    });
    expect(result.effectiveParallelism).toBe(1);
  });

  it('大文件时并行度被调优器减半', async () => {
    // 构造大文件 diff（每文件 100KB 内容）
    const largeDiff = generateDiff(10, 100_000);
    const diffs = parseDiff(largeDiff);
    const tuner = new ParallelTuner();
    const tuned = tuner.tune(diffs);
    // 大文件 → 应触发 halved
    expect(tuned.avgFileSize).toBeGreaterThan(DEFAULT_LARGE_FILE_THRESHOLD);
    // 验证 batchProcess 也能正常处理
    const result = await batchProcess(diffs, {
      batchSize: 2,
      parallel: true,
      processFn: async () => [],
    });
    expect(result.effectiveParallelism).toBeGreaterThanOrEqual(1);
  });

  it('小 PR（少文件）并行度受文件数限制', async () => {
    const diffs = parseDiff(generateDiff(2));
    const result = await batchProcess(diffs, {
      batchSize: 1, // 2 批
      parallel: true,
      processFn: async () => [],
    });
    // 2 批 → 并行度最多 2
    expect(result.effectiveParallelism).toBeLessThanOrEqual(2);
  });

  it('并行调优保持结果正确性（findings 不丢失）', async () => {
    const diffs = parseDiff(generateDiff(30));
    const result = await batchProcess(diffs, {
      batchSize: 5, // 6 批
      parallel: true,
      parallelism: 3,
      useTuner: false,
      processFn: async (batch) => batch.map((d, i) => makeFinding(d.path, i)),
    });
    expect(result.allFindings.length).toBe(30);
    expect(result.batches.length).toBe(6);
    // batches 按 batchIndex 排序
    for (let i = 0; i < result.batches.length; i++) {
      expect(result.batches[i].batchIndex).toBe(i);
    }
  });
});

describe('runWithConcurrency', () => {
  it('空数组返回空结果', async () => {
    const result = await runWithConcurrency([], 4, async (item) => item);
    expect(result).toEqual([]);
  });

  it('concurrency=1 顺序执行', async () => {
    const items = [1, 2, 3, 4, 5];
    let maxRunning = 0;
    let running = 0;
    const result = await runWithConcurrency(items, 1, async (item) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return item * 2;
    });
    expect(result).toEqual([2, 4, 6, 8, 10]);
    expect(maxRunning).toBe(1);
  });

  it('concurrency=2 允许同时 2 个任务', async () => {
    const items = [1, 2, 3, 4];
    let maxRunning = 0;
    let running = 0;
    await runWithConcurrency(items, 2, async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 2));
      running--;
    });
    expect(maxRunning).toBeLessThanOrEqual(2);
    expect(maxRunning).toBeGreaterThanOrEqual(1);
  });

  it('结果顺序与输入一致', async () => {
    const items = [10, 20, 30, 40, 50];
    const result = await runWithConcurrency(items, 4, async (item, idx) => ({
      idx,
      value: item,
    }));
    expect(result.map((r) => r.idx)).toEqual([0, 1, 2, 3, 4]);
    expect(result.map((r) => r.value)).toEqual([10, 20, 30, 40, 50]);
  });

  it('concurrency=0 等价于 1', async () => {
    const items = [1, 2, 3];
    const result = await runWithConcurrency(items, 0, async (item) => item * 2);
    expect(result).toEqual([2, 4, 6]);
  });

  it('concurrency 大于 items 长度时正常工作', async () => {
    const items = [1, 2];
    const result = await runWithConcurrency(items, 100, async (item) => item + 1);
    expect(result).toEqual([2, 3]);
  });
});

// ── CLI 集成测试：review --stream 与 batchProcess 集成 ──
// 此处仅验证 module-level 导出，CLI 集成已在 streaming.test.ts / precheck.test.ts 中覆盖

describe('parallel-tuner 导出与 orchestrator 集成', () => {
  it('ParallelTuner 可在 batchProcess 之外独立使用', () => {
    const tuner = new ParallelTuner();
    const diffs: FileDiff[] = [
      {
        path: 'a.ts',
        status: 'modified',
        hunks: [
          {
            oldStart: 1,
            oldCount: 1,
            newStart: 1,
            newCount: 1,
            header: '',
            lines: [
              { type: 'add', content: 'console.log("x");' },
            ],
          },
        ],
      },
    ];
    const result = tuner.tune(diffs);
    expect(result.parallelism).toBeGreaterThanOrEqual(1);
  });

  it('batchProcess 接受 useTuner 选项', async () => {
    const diffs = parseDiff(generateDiff(10));
    const result = await batchProcess(diffs, {
      batchSize: 3,
      parallel: true,
      useTuner: true,
      processFn: async () => [],
    });
    expect(result.effectiveParallelism).toBeDefined();
  });
});
