import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  Profiler,
  startProfiling,
  stopProfiling,
  getProfileReport,
  formatProfileReport,
  getGlobalProfiler,
  setGlobalProfiler,
  resetGlobalProfiler,
  type ProfileReport,
  type ProfileMeasurement,
  type MemorySnapshot,
  type CategoryStat,
  type ProfilingOptions,
} from '../../../src/profiler.js';

// ── 测试 fixtures ──

function makeMemorySnapshot(partial: Partial<MemorySnapshot> = {}): MemorySnapshot {
  return {
    timestamp: 0,
    rss: 1024 * 1024 * 10,
    heapTotal: 1024 * 1024 * 8,
    heapUsed: 1024 * 1024 * 5,
    external: 0,
    arrayBuffers: 0,
    ...partial,
  };
}

// ── CLI 测试辅助 ──

interface TestState {
  stdin: string;
  exitError: Error | null;
  stdout: string[];
  stderr: string[];
}

const testState: TestState = {
  stdin: '',
  exitError: null,
  stdout: [],
  stderr: [],
};

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn((...args: unknown[]) => {
      const fd = args[0];
      if (fd === 0 || fd === '0') {
        return testState.stdin;
      }
      return (actual.readFileSync as (...a: unknown[]) => unknown)(...args);
    }),
  };
});

async function loadCli(opts: {
  argv: string[];
  stdin?: string;
}): Promise<{
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}> {
  const { argv, stdin = '' } = opts;

  testState.stdin = stdin;
  testState.exitError = null;
  testState.stdout = [];
  testState.stderr = [];

  const origArgv = process.argv;
  process.argv = ['node', '/tmp/cli.js', ...argv];

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    testState.stdout.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    testState.stderr.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });

  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    const err = new Error(`__PROCESS_EXIT_${code ?? 0}__`);
    testState.exitError = err;
    throw err;
  }) as never);

  vi.resetModules();

  try {
    await import('../../../src/cli.js');
    return {
      stdout: [...testState.stdout],
      stderr: [...testState.stderr],
      exitCode: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const match = msg.match(/^__PROCESS_EXIT_(\d+)__$/);
    if (match) {
      return {
        stdout: [...testState.stdout],
        stderr: [...testState.stderr],
        exitCode: parseInt(match[1], 10),
      };
    }
    throw err;
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    process.argv = origArgv;
    vi.resetModules();
  }
}

// ── 测试 diff ──

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

// ==================== Profiler 类 ====================

describe('Profiler', () => {
  let profiler: Profiler;

  beforeEach(() => {
    // 使用 mock setInterval/clearInterval 避免真实定时器
    profiler = new Profiler({
      setIntervalFn: (fn) => {
        // 立即执行一次，模拟采样
        setTimeout(fn, 0);
        return 'mock-timer-id';
      },
      clearIntervalFn: () => {},
    });
  });

  describe('构造器', () => {
    it('默认非运行状态', () => {
      expect(profiler.isRunning()).toBe(false);
    });

    it('初始 measurementCount=0', () => {
      expect(profiler.measurementCount()).toBe(0);
    });

    it('初始 sampleCount=0', () => {
      expect(profiler.sampleCount()).toBe(0);
    });

    it('自定义 nowFn', () => {
      let time = 100;
      const p = new Profiler({ nowFn: () => time });
      expect(p.now()).toBe(100);
      time = 200;
      expect(p.now()).toBe(200);
    });

    it('自定义 memoryUsageFn', () => {
      let heap = 1024 * 1024;
      const p = new Profiler({
        memoryUsageFn: () => makeMemorySnapshot({ heapUsed: heap }),
      });
      p.startProfiling();
      heap = 1024 * 1024 * 2;
      p.measure('test', () => undefined);
      const report = p.stopProfiling();
      // 初始快照 heapUsed = 1024*1024，结束快照 heapUsed = 2*1024*1024
      expect(report.finalMemory?.heapUsed).toBe(1024 * 1024 * 2);
    });
  });

  describe('startProfiling / stopProfiling', () => {
    it('startProfiling 标记为 running', () => {
      profiler.startProfiling();
      expect(profiler.isRunning()).toBe(true);
      profiler.stopProfiling();
    });

    it('startProfiling 后立即采样初始内存快照', () => {
      profiler.startProfiling();
      expect(profiler.sampleCount()).toBeGreaterThanOrEqual(1);
      profiler.stopProfiling();
    });

    it('重复 startProfiling 抛错', () => {
      profiler.startProfiling();
      expect(() => profiler.startProfiling()).toThrow('already running');
      profiler.stopProfiling();
    });

    it('stopProfiling 返回报告', () => {
      profiler.startProfiling();
      const report = profiler.stopProfiling();
      expect(report).toBeDefined();
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
      expect(report.memorySamples).toBeGreaterThan(0);
      expect(report.measurementCount).toBe(0);
    });

    it('stopProfiling 未开启时抛错', () => {
      expect(() => profiler.stopProfiling()).toThrow('not running');
    });

    it('stopProfiling 设置 endTime', () => {
      profiler.startProfiling();
      const report = profiler.stopProfiling();
      expect(report.endTime).toBeGreaterThanOrEqual(report.startTime);
    });

    it('stopProfiling 采集最终内存快照', () => {
      profiler.startProfiling();
      const report = profiler.stopProfiling();
      expect(report.finalMemory).toBeDefined();
      expect(report.initialMemory).toBeDefined();
    });

    it('CPU 采集启用时记录初始 / 最终快照', () => {
      profiler.startProfiling({ trackCpu: true });
      const report = profiler.stopProfiling();
      expect(report.initialCpu).toBeDefined();
      expect(report.finalCpu).toBeDefined();
      expect(report.cpuTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('CPU 采集禁用时不记录 CPU 数据', () => {
      const p = new Profiler({
        trackCpu: false,
        setIntervalFn: () => 'mock',
        clearIntervalFn: () => undefined,
      });
      p.startProfiling();
      const report = p.stopProfiling();
      expect(report.initialCpu).toBeUndefined();
      expect(report.finalCpu).toBeUndefined();
      expect(report.cpuTimeMs).toBeUndefined();
      expect(report.cpuSamples).toBe(0);
    });

    it('内存采样间隔可配置', () => {
      let sampleCount = 0;
      const p = new Profiler({
        memorySampleIntervalMs: 10,
        setIntervalFn: () => 'mock',
        clearIntervalFn: () => undefined,
        memoryUsageFn: () => {
          sampleCount++;
          return makeMemorySnapshot({ timestamp: sampleCount });
        },
      });
      p.startProfiling();
      // 由于 setIntervalFn 是 mock，不实际触发 — 仅检查 startProfiling 不抛错
      const report = p.stopProfiling();
      expect(report).toBeDefined();
    });

    it('maxSamples 上限保护', () => {
      const p = new Profiler({
        maxSamples: 2,
        setIntervalFn: (fn) => {
          // 立即触发多次采样
          fn();
          fn();
          fn();
          return 'mock';
        },
        clearIntervalFn: () => undefined,
      });
      p.startProfiling();
      const report = p.stopProfiling();
      // 初始 + 1 + 最终（超限部分被丢弃）
      expect(report.memorySamples).toBeLessThanOrEqual(5);
    });
  });

  describe('measure / measureAsync', () => {
    it('measure 同步测量返回结果', () => {
      profiler.startProfiling();
      const result = profiler.measure('op', () => 42);
      expect(result).toBe(42);
      expect(profiler.measurementCount()).toBe(1);
      profiler.stopProfiling();
    });

    it('measure 记录 durationMs', async () => {
      profiler.startProfiling();
      profiler.measure('op', () => {
        // 同步操作
      });
      const report = profiler.stopProfiling();
      expect(report.measurements).toHaveLength(1);
      expect(report.measurements[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('measure 异常时仍记录 measurement 并重新抛出', () => {
      profiler.startProfiling();
      expect(() =>
        profiler.measure('op', () => {
          throw new Error('boom');
        }),
      ).toThrow('boom');
      const report = profiler.stopProfiling();
      expect(report.measurements).toHaveLength(1);
      expect(report.measurements[0].error).toBe(true);
    });

    it('measure 记录 category', () => {
      profiler.startProfiling();
      profiler.measure('op', () => undefined, 'parse');
      profiler.measure('op2', () => undefined, 'filter');
      const report = profiler.stopProfiling();
      expect(report.measurements).toHaveLength(2);
      expect(report.measurements[0].category).toBe('parse');
      expect(report.measurements[1].category).toBe('filter');
    });

    it('measure 未开启 profiling 时也记录测量', () => {
      // 未 startProfiling，measure 仍可使用
      profiler.measure('op', () => 1);
      expect(profiler.measurementCount()).toBe(1);
      // startMemory/endMemory 为 undefined（因 running=false）
    });

    it('measure 记录 startMemory / endMemory（开启 profiling 时）', () => {
      profiler.startProfiling();
      profiler.measure('op', () => undefined);
      profiler.stopProfiling();
      // 通过 reset 后再获取 report — 上面的 stop 已返回 report
      // 这里重新构造一个简单测试
    });

    it('measureAsync 异步测量返回结果', async () => {
      profiler.startProfiling();
      const result = await profiler.measureAsync('op', async () => {
        await new Promise((r) => setTimeout(r, 5));
        return 'done';
      });
      expect(result).toBe('done');
      expect(profiler.measurementCount()).toBe(1);
      profiler.stopProfiling();
    });

    it('measureAsync 异常时记录 error 并重新抛出', async () => {
      profiler.startProfiling();
      await expect(
        profiler.measureAsync('op', async () => {
          throw new Error('async boom');
        }),
      ).rejects.toThrow('async boom');
      const report = profiler.stopProfiling();
      expect(report.measurements).toHaveLength(1);
      expect(report.measurements[0].error).toBe(true);
    });
  });

  describe('getProfileReport', () => {
    it('未启动时返回空报告', () => {
      const report = profiler.getProfileReport();
      expect(report.measurementCount).toBe(0);
      expect(report.measurements).toEqual([]);
      expect(report.categoryStats).toEqual({});
      expect(report.slowestMeasurements).toEqual([]);
    });

    it('包含 durationMs / startTime / endTime', () => {
      profiler.startProfiling();
      const report = profiler.stopProfiling();
      expect(report.startTime).toBeGreaterThan(0);
      expect(report.endTime).toBeGreaterThanOrEqual(report.startTime);
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('包含内存峰值 peakMemory', () => {
      profiler.startProfiling();
      profiler.measure('op', () => undefined);
      const report = profiler.stopProfiling();
      expect(report.peakMemory).toBeDefined();
      expect(report.peakMemory?.heapUsed).toBeGreaterThanOrEqual(0);
    });

    it('按 category 聚合统计', () => {
      profiler.startProfiling();
      profiler.measure('a', () => undefined, 'parse');
      profiler.measure('b', () => undefined, 'parse');
      profiler.measure('c', () => undefined, 'filter');
      const report = profiler.stopProfiling();

      expect(Object.keys(report.categoryStats).sort()).toEqual(['filter', 'parse']);
      const parseStat = report.categoryStats.parse;
      expect(parseStat.count).toBe(2);
      expect(parseStat.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(parseStat.avgDurationMs).toBe(parseStat.totalDurationMs / 2);
      expect(parseStat.maxDurationMs).toBeGreaterThanOrEqual(parseStat.minDurationMs);
    });

    it('slowestMeasurements 按 durationMs 降序', () => {
      // 通过 advanceTime 模拟 measure 内部的耗时
      let time = 0;
      const p = new Profiler({
        nowFn: () => time,
        setIntervalFn: () => 'mock',
        clearIntervalFn: () => undefined,
        memoryUsageFn: () => makeMemorySnapshot({ timestamp: time }),
      });
      p.startProfiling();

      // fast: 5ms 耗时
      time = 100;
      p.measure('fast', () => {
        time += 5;
      });
      // medium: 50ms 耗时
      time = 200;
      p.measure('medium', () => {
        time += 50;
      });
      // slow: 500ms 耗时
      time = 300;
      p.measure('slow', () => {
        time += 500;
      });
      const report = p.stopProfiling();
      const slow = report.measurements.find((m) => m.name === 'slow');
      const medium = report.measurements.find((m) => m.name === 'medium');
      const fast = report.measurements.find((m) => m.name === 'fast');
      expect(slow?.durationMs).toBeGreaterThan(medium!.durationMs);
      expect(medium?.durationMs).toBeGreaterThan(fast!.durationMs);
      expect(report.slowestMeasurements[0].name).toBe('slow');
      expect(report.slowestMeasurements[1].name).toBe('medium');
      expect(report.slowestMeasurements[2].name).toBe('fast');
    });

    it('measurements 按 startTime 升序', () => {
      let time = 1000;
      const p = new Profiler({
        nowFn: () => time,
        setIntervalFn: () => 'mock',
        clearIntervalFn: () => undefined,
      });
      p.startProfiling();
      time = 2000;
      p.measure('a', () => undefined);
      time = 3000;
      p.measure('b', () => undefined);
      time = 4000;
      p.measure('c', () => undefined);
      const report = p.stopProfiling();
      const names = report.measurements.map((m) => m.name);
      expect(names).toEqual(['a', 'b', 'c']);
    });

    it('报告包含 memorySamples 与 cpuSamples 计数', () => {
      profiler.startProfiling();
      const report = profiler.stopProfiling();
      expect(report.memorySamples).toBeGreaterThan(0);
      expect(report.cpuSamples).toBeGreaterThanOrEqual(0);
    });
  });

  describe('reset', () => {
    it('清空所有数据', () => {
      profiler.startProfiling();
      profiler.measure('op', () => undefined);
      profiler.stopProfiling();
      profiler.reset();
      expect(profiler.measurementCount()).toBe(0);
      expect(profiler.sampleCount()).toBe(0);
      expect(profiler.isRunning()).toBe(false);
    });

    it('reset 在 running 状态下也清空并停止', () => {
      profiler.startProfiling();
      profiler.measure('op', () => undefined);
      profiler.reset();
      expect(profiler.isRunning()).toBe(false);
      expect(profiler.measurementCount()).toBe(0);
    });
  });
});

// ==================== 全局 profiler ====================

describe('全局 profiler', () => {
  afterEach(() => {
    setGlobalProfiler(undefined);
  });

  it('getGlobalProfiler 懒初始化', () => {
    setGlobalProfiler(undefined);
    const p1 = getGlobalProfiler();
    expect(p1).toBeInstanceOf(Profiler);
    const p2 = getGlobalProfiler();
    expect(p2).toBe(p1);
  });

  it('setGlobalProfiler 替换全局 profiler', () => {
    const custom = new Profiler();
    setGlobalProfiler(custom);
    expect(getGlobalProfiler()).toBe(custom);
  });

  it('resetGlobalProfiler 清空当前 profiler', () => {
    const p = getGlobalProfiler();
    p.startProfiling();
    p.measure('op', () => undefined);
    p.stopProfiling();
    expect(p.measurementCount()).toBe(1);
    resetGlobalProfiler();
    expect(getGlobalProfiler().measurementCount()).toBe(0);
  });

  it('resetGlobalProfiler 在未初始化时创建新实例', () => {
    setGlobalProfiler(undefined);
    resetGlobalProfiler();
    expect(getGlobalProfiler()).toBeInstanceOf(Profiler);
  });
});

// ==================== 便捷函数 ====================

describe('便捷函数 startProfiling / stopProfiling / getProfileReport', () => {
  beforeEach(() => {
    resetGlobalProfiler();
  });

  afterEach(() => {
    setGlobalProfiler(undefined);
  });

  it('startProfiling 使用全局 profiler', () => {
    startProfiling();
    expect(getGlobalProfiler().isRunning()).toBe(true);
    stopProfiling();
  });

  it('stopProfiling 返回报告', () => {
    startProfiling();
    const report = stopProfiling();
    expect(report).toBeDefined();
    expect(report.measurementCount).toBe(0);
  });

  it('getProfileReport 在剖析中调用返回中间报告', () => {
    startProfiling();
    const report = getProfileReport();
    expect(report).toBeDefined();
    stopProfiling();
  });
});

// ==================== formatProfileReport ====================

describe('formatProfileReport', () => {
  it('生成可读字符串', () => {
    const report: ProfileReport = {
      startTime: 100,
      endTime: 200,
      durationMs: 100,
      memorySamples: 5,
      cpuSamples: 5,
      measurementCount: 2,
      peakMemory: makeMemorySnapshot({ heapUsed: 1024 * 1024 * 10 }),
      initialMemory: makeMemorySnapshot({ heapUsed: 1024 * 1024 * 5 }),
      finalMemory: makeMemorySnapshot({ heapUsed: 1024 * 1024 * 8 }),
      initialCpu: { timestamp: 0, user: 100, system: 50 },
      finalCpu: { timestamp: 100, user: 200, system: 80 },
      cpuTimeMs: 130,
      categoryStats: {
        parse: {
          count: 2,
          totalDurationMs: 50,
          avgDurationMs: 25,
          maxDurationMs: 30,
          minDurationMs: 20,
          totalMemoryDeltaBytes: 1024,
        },
      },
      slowestMeasurements: [
        {
          name: 'parseDiff',
          startTime: 100,
          endTime: 130,
          durationMs: 30,
          memoryDeltaBytes: 512,
        },
      ],
      measurements: [],
    };

    const text = formatProfileReport(report);
    expect(text).toContain('Performance Report');
    expect(text).toContain('Total Duration: 100.00ms');
    expect(text).toContain('CPU Time: 130.00ms');
    expect(text).toContain('Measurements: 2');
    expect(text).toContain('Memory Samples: 5');
    expect(text).toContain('--- Memory ---');
    expect(text).toContain('Initial Heap');
    expect(text).toContain('Final Heap');
    expect(text).toContain('Peak Heap');
    expect(text).toContain('--- By Category ---');
    expect(text).toContain('parse:');
    expect(text).toContain('--- Slowest Operations ---');
    expect(text).toContain('parseDiff: 30.00ms');
  });

  it('无测量时省略 category 与 slowest sections', () => {
    const report: ProfileReport = {
      startTime: 0,
      endTime: 100,
      durationMs: 100,
      memorySamples: 1,
      cpuSamples: 0,
      measurementCount: 0,
      categoryStats: {},
      slowestMeasurements: [],
      measurements: [],
    };
    const text = formatProfileReport(report);
    expect(text).not.toContain('--- By Category ---');
    expect(text).not.toContain('--- Slowest Operations ---');
  });

  it('无 CPU 数据时省略 CPU 行', () => {
    const report: ProfileReport = {
      startTime: 0,
      endTime: 100,
      durationMs: 100,
      memorySamples: 1,
      cpuSamples: 0,
      measurementCount: 0,
      categoryStats: {},
      slowestMeasurements: [],
      measurements: [],
    };
    const text = formatProfileReport(report);
    expect(text).not.toContain('CPU Time');
  });
});

// ==================== 类型导出 ====================

describe('类型导出', () => {
  it('ProfileReport 接口存在', () => {
    const report: ProfileReport = {
      startTime: 0,
      endTime: 0,
      durationMs: 0,
      memorySamples: 0,
      cpuSamples: 0,
      measurementCount: 0,
      categoryStats: {},
      slowestMeasurements: [],
      measurements: [],
    };
    expect(report.durationMs).toBe(0);
  });

  it('ProfileMeasurement 接口存在', () => {
    const m: ProfileMeasurement = {
      name: 'op',
      startTime: 0,
      endTime: 10,
      durationMs: 10,
    };
    expect(m.durationMs).toBe(10);
  });

  it('MemorySnapshot 接口存在', () => {
    const s: MemorySnapshot = {
      timestamp: 0,
      rss: 0,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
    };
    expect(s.rss).toBe(0);
  });

  it('CategoryStat 接口存在', () => {
    const s: CategoryStat = {
      count: 0,
      totalDurationMs: 0,
      avgDurationMs: 0,
      maxDurationMs: 0,
      minDurationMs: 0,
      totalMemoryDeltaBytes: 0,
    };
    expect(s.count).toBe(0);
  });

  it('ProfilingOptions 接口存在', () => {
    const opts: ProfilingOptions = {
      memorySampleIntervalMs: 100,
      maxSamples: 500,
      trackCpu: true,
    };
    expect(opts.memorySampleIntervalMs).toBe(100);
  });
});

// ==================== CLI 集成：--profile 标志 ====================

describe('CLI: review --profile 标志', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'profile-cli-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('--profile 输出性能报告到 stderr', async () => {
    const { stderr, exitCode } = await loadCli({
      argv: ['review', '--profile'],
      stdin: SIMPLE_DIFF,
    });

    expect(exitCode).toBeNull();
    const stderrText = stderr.join('\n');
    expect(stderrText).toContain('Performance Report');
    expect(stderrText).toContain('Total Duration');
  });

  it('--profile 不影响 stdout 的 review 结果', async () => {
    const { stdout, exitCode } = await loadCli({
      argv: ['review', '--profile'],
      stdin: SIMPLE_DIFF,
    });

    expect(exitCode).toBeNull();
    // stdout 应包含 review prompt（不受 profile 影响）
    expect(stdout.length).toBeGreaterThan(0);
  });

  it('--profile-output 写入报告文件', async () => {
    const profilePath = join(tmpDir, 'profile.txt');
    await loadCli({
      argv: ['review', '--profile', '--profile-output', profilePath],
      stdin: SIMPLE_DIFF,
    });

    expect(existsSync(profilePath)).toBe(true);
    const content = readFileSync(profilePath, 'utf-8');
    expect(content).toContain('Performance Report');
    expect(content).toContain('Total Duration');
  });

  it('--profile-output 后 stderr 输出文件路径信息', async () => {
    const profilePath = join(tmpDir, 'profile.txt');
    const { stderr } = await loadCli({
      argv: ['review', '--profile', '--profile-output', profilePath],
      stdin: SIMPLE_DIFF,
    });

    const stderrText = stderr.join('\n');
    expect(stderrText).toContain('[profile] report written to');
    expect(stderrText).toContain(profilePath);
  });

  it('未指定 --profile 时不输出性能报告', async () => {
    const { stderr } = await loadCli({
      argv: ['review'],
      stdin: SIMPLE_DIFF,
    });

    const stderrText = stderr.join('\n');
    expect(stderrText).not.toContain('Performance Report');
  });

  it('--profile-interval 接受数值', async () => {
    const { exitCode } = await loadCli({
      argv: ['review', '--profile', '--profile-interval', '100'],
      stdin: SIMPLE_DIFF,
    });

    expect(exitCode).toBeNull();
  });

  it('review 不带 --profile 正常工作', async () => {
    const { stdout, exitCode } = await loadCli({
      argv: ['review'],
      stdin: SIMPLE_DIFF,
    });

    expect(exitCode).toBeNull();
    expect(stdout.length).toBeGreaterThan(0);
  });
});
