// src/profiler.ts — Task 19：性能剖析
//
// 职责：
// 1. Profiler 类：使用 performance API 与 process.memoryUsage() 收集性能数据
// 2. startProfiling / stopProfiling：开启/停止剖析会话，记录 CPU 时间与内存快照
// 3. getProfileReport：生成可读的性能报告（含 top-N 慢操作 / 内存峰值）
// 4. measure / measureAsync：便捷包装器，自动测量函数耗时
//
// 设计取舍：
// - 仅使用 Node 内置 performance API 与 process.memoryUsage()，不引入 v8-profiler 等原生依赖
// - 内存采样按固定间隔（默认 50ms）轮询；间隔可在 startProfiling 时配置
// - 测量记录存内存中，单次剖析会话独立；多次剖析互不干扰
// - 报告输出为结构化对象（ProfileReport），由调用方决定渲染方式
//
// 与 cli.ts 集成：
// - `code-review review --profile < diff.txt` 开启剖析并输出性能报告
// - 报告以 JSON 格式输出到 stderr，不影响 stdout 的 review 结果

import { performance } from 'node:perf_hooks';

// ==================== 类型定义 ====================

/** 单次剖析会话的配置 */
export interface ProfilingOptions {
  /** 内存采样间隔（ms，默认 50） */
  memorySampleIntervalMs?: number;
  /** 最大采样数（默认 1000，避免内存溢出） */
  maxSamples?: number;
  /** 是否启用 CPU 时间采集（默认 true） */
  trackCpu?: boolean;
  /** 自定义 performance.now 实现（用于测试） */
  nowFn?: () => number;
  /** 自定义 memoryUsage 实现（用于测试） */
  memoryUsageFn?: () => MemorySnapshot;
  /** 自定义 setInterval（用于测试，避免真实定时器） */
  setIntervalFn?: (fn: () => void, ms: number) => unknown;
  /** 自定义 clearInterval（用于测试） */
  clearIntervalFn?: (id: unknown) => void;
}

/** 内存快照 */
export interface MemorySnapshot {
  /** 时间戳（ms，performance.now() 相对值） */
  timestamp: number;
  /** rss（Resident Set Size，字节） */
  rss: number;
  /** heapTotal（V8 已申请堆大小，字节） */
  heapTotal: number;
  /** heapUsed（V8 实际使用的堆大小，字节） */
  heapUsed: number;
  /** external（C++ 对象绑定的内存，字节） */
  external: number;
  /** arrayBuffers（ArrayBuffer 占用的内存，字节） */
  arrayBuffers?: number;
}

/** CPU 时间快照 */
export interface CpuSnapshot {
  /** 时间戳（ms，performance.now() 相对值） */
  timestamp: number;
  /** 用户态 CPU 时间（ms） */
  user: number;
  /** 系统态 CPU 时间（ms） */
  system: number;
}

/** 单个测量点（measure / measureAsync） */
export interface ProfileMeasurement {
  /** 测量名 */
  name: string;
  /** 起始时间戳（ms） */
  startTime: number;
  /** 结束时间戳（ms） */
  endTime: number;
  /** 持续时间（ms） */
  durationMs: number;
  /** 测量起始时的内存快照（可选） */
  startMemory?: MemorySnapshot;
  /** 测量结束时的内存快照（可选） */
  endMemory?: MemorySnapshot;
  /** 内存增量（endMemory.heapUsed - startMemory.heapUsed，字节） */
  memoryDeltaBytes?: number;
  /** 测量类别（可选，用于分组） */
  category?: string;
  /** 是否出错（异常时为 true） */
  error?: boolean;
}

/** 性能报告 */
export interface ProfileReport {
  /** 会话开始时间戳（ms） */
  startTime: number;
  /** 会话结束时间戳（ms） */
  endTime: number;
  /** 会话总耗时（ms） */
  durationMs: number;
  /** 内存采样数 */
  memorySamples: number;
  /** CPU 采样数 */
  cpuSamples: number;
  /** 测量数 */
  measurementCount: number;
  /** 内存峰值（采样中最大 heapUsed） */
  peakMemory?: MemorySnapshot;
  /** 初始内存快照 */
  initialMemory?: MemorySnapshot;
  /** 结束内存快照 */
  finalMemory?: MemorySnapshot;
  /** 初始 CPU 快照 */
  initialCpu?: CpuSnapshot;
  /** 最终 CPU 快照 */
  finalCpu?: CpuSnapshot;
  /** CPU 总耗时（user + system，ms） */
  cpuTimeMs?: number;
  /** 按 category 分组的测量统计 */
  categoryStats: Record<string, CategoryStat>;
  /** 最慢的 N 个测量（默认按 durationMs 降序前 10） */
  slowestMeasurements: ProfileMeasurement[];
  /** 全部测量（按 startTime 升序） */
  measurements: ProfileMeasurement[];
}

/** 单个 category 的统计 */
export interface CategoryStat {
  /** 测量数 */
  count: number;
  /** 总耗时（ms） */
  totalDurationMs: number;
  /** 平均耗时（ms） */
  avgDurationMs: number;
  /** 最大耗时（ms） */
  maxDurationMs: number;
  /** 最小耗时（ms） */
  minDurationMs: number;
  /** 总内存增量（字节） */
  totalMemoryDeltaBytes: number;
}

// ==================== 工具函数 ====================

/** 默认内存快照实现：使用 process.memoryUsage() */
function defaultMemoryUsage(): MemorySnapshot {
  // 使用 globalThis.process 兼容浏览器 / 测试环境
  const proc = (globalThis as { process?: NodeJS.Process }).process;
  if (!proc || typeof proc.memoryUsage !== 'function') {
    return {
      timestamp: performance.now(),
      rss: 0,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    };
  }
  const mu = proc.memoryUsage();
  return {
    timestamp: performance.now(),
    rss: mu.rss,
    heapTotal: mu.heapTotal,
    heapUsed: mu.heapUsed,
    external: mu.external,
    arrayBuffers: mu.arrayBuffers,
  };
}

/** 默认 CPU 快照实现：使用 process.cpuUsage() */
function defaultCpuUsage(): CpuSnapshot {
  const proc = (globalThis as { process?: NodeJS.Process }).process;
  if (!proc || typeof proc.cpuUsage !== 'function') {
    return {
      timestamp: performance.now(),
      user: 0,
      system: 0,
    };
  }
  const cu = proc.cpuUsage();
  return {
    timestamp: performance.now(),
    user: cu.user / 1000, // µs → ms
    system: cu.system / 1000,
  };
}

// ==================== Profiler 类 ====================

/**
 * 性能剖析器（基于 performance API 与 process.memoryUsage()）。
 *
 * 使用方式：
 * ```ts
 * const profiler = new Profiler();
 * profiler.startProfiling({ memorySampleIntervalMs: 50 });
 * // ... 业务逻辑 ...
 * profiler.measure('parseDiff', () => parseDiff(text));
 * const report = profiler.stopProfiling();
 * console.log(JSON.stringify(report, null, 2));
 * ```
 *
 * 全局单例：
 * - getGlobalProfiler() 返回默认全局 profiler
 * - setGlobalProfiler(profiler) 替换全局 profiler（用于测试）
 */
export class Profiler {
  /** 是否正在剖析 */
  private running = false;
  /** 会话开始时间 */
  private startTime = 0;
  /** 会话结束时间 */
  private endTime = 0;
  /** 初始内存快照 */
  private initialMemory?: MemorySnapshot;
  /** 结束内存快照 */
  private finalMemory?: MemorySnapshot;
  /** 初始 CPU 快照 */
  private initialCpu?: CpuSnapshot;
  /** 最终 CPU 快照 */
  private finalCpu?: CpuSnapshot;
  /** 内存采样列表 */
  private memorySamples: MemorySnapshot[] = [];
  /** CPU 采样列表 */
  private cpuSamples: CpuSnapshot[] = [];
  /** 测量列表 */
  private measurements: ProfileMeasurement[] = [];
  /** 采样定时器 ID */
  private samplerId: unknown = null;
  /** 配置 */
  private options: Required<Omit<ProfilingOptions, 'setIntervalFn' | 'clearIntervalFn'>> & {
    setIntervalFn?: (fn: () => void, ms: number) => unknown;
    clearIntervalFn?: (id: unknown) => void;
  };

  constructor(options: ProfilingOptions = {}) {
    this.options = {
      memorySampleIntervalMs: options.memorySampleIntervalMs ?? 50,
      maxSamples: options.maxSamples ?? 1000,
      trackCpu: options.trackCpu ?? true,
      nowFn: options.nowFn ?? (() => performance.now()),
      memoryUsageFn: options.memoryUsageFn ?? defaultMemoryUsage,
      setIntervalFn: options.setIntervalFn,
      clearIntervalFn: options.clearIntervalFn,
    };
  }

  /** 当前 performance.now 值（便于测试注入） */
  now(): number {
    return this.options.nowFn();
  }

  /** 是否正在剖析 */
  isRunning(): boolean {
    return this.running;
  }

  /** 当前测量数 */
  measurementCount(): number {
    return this.measurements.length;
  }

  /** 当前内存采样数 */
  sampleCount(): number {
    return this.memorySamples.length;
  }

  /**
   * 开启剖析会话。
   *
   * - 记录初始内存/CPU 快照
   * - 启动定时器周期性采集内存/CPU 采样
   * - 调用方在业务执行完成后调用 stopProfiling 停止采集
   *
   * @param options 剖析选项（覆盖构造器选项）
   */
  startProfiling(options?: ProfilingOptions): void {
    if (this.running) {
      throw new Error('Profiler is already running');
    }
    // 合并临时选项
    if (options) {
      this.options = {
        ...this.options,
        ...options,
      };
    }

    this.running = true;
    this.startTime = this.now();
    this.measurements = [];
    this.memorySamples = [];
    this.cpuSamples = [];

    // 初始快照
    this.initialMemory = this.options.memoryUsageFn();
    this.memorySamples.push(this.initialMemory);
    if (this.options.trackCpu) {
      this.initialCpu = defaultCpuUsage();
      this.cpuSamples.push(this.initialCpu);
    }

    // 启动定时器（若提供 setIntervalFn 则用之，否则用全局 setInterval）
    const setIntervalFn = this.options.setIntervalFn;
    if (setIntervalFn) {
      this.samplerId = setIntervalFn(() => this.sample(), this.options.memorySampleIntervalMs);
    } else {
      this.samplerId = setInterval(() => this.sample(), this.options.memorySampleIntervalMs);
    }
  }

  /** 周期性采样回调 */
  private sample(): void {
    if (!this.running) return;
    if (this.memorySamples.length >= this.options.maxSamples) {
      return;
    }
    const mem = this.options.memoryUsageFn();
    this.memorySamples.push(mem);
    if (this.options.trackCpu) {
      this.cpuSamples.push(defaultCpuUsage());
    }
  }

  /**
   * 停止剖析会话。
   *
   * - 停止定时器
   * - 记录最终内存/CPU 快照
   * - 返回性能报告
   */
  stopProfiling(): ProfileReport {
    if (!this.running) {
      throw new Error('Profiler is not running');
    }
    this.running = false;
    this.endTime = this.now();

    // 停止定时器
    if (this.samplerId !== null) {
      const clearIntervalFn = this.options.clearIntervalFn;
      if (clearIntervalFn) {
        clearIntervalFn(this.samplerId);
      } else {
        clearInterval(this.samplerId as NodeJS.Timeout);
      }
      this.samplerId = null;
    }

    // 最终快照
    this.finalMemory = this.options.memoryUsageFn();
    this.memorySamples.push(this.finalMemory);
    if (this.options.trackCpu) {
      this.finalCpu = defaultCpuUsage();
      this.cpuSamples.push(this.finalCpu);
    }

    return this.getProfileReport();
  }

  /**
   * 生成性能报告。
   *
   * 在 stopProfiling 之后可调用，或在剖析过程中调用以获取中间状态。
   */
  getProfileReport(): ProfileReport {
    const measurements = this.measurements.slice().sort((a, b) => a.startTime - b.startTime);
    const slowest = measurements.slice().sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);

    // 按 category 分组统计
    const categoryStats: Record<string, CategoryStat> = {};
    for (const m of measurements) {
      const cat = m.category ?? 'default';
      if (!categoryStats[cat]) {
        categoryStats[cat] = {
          count: 0,
          totalDurationMs: 0,
          avgDurationMs: 0,
          maxDurationMs: 0,
          minDurationMs: Number.POSITIVE_INFINITY,
          totalMemoryDeltaBytes: 0,
        };
      }
      const stat = categoryStats[cat];
      stat.count++;
      stat.totalDurationMs += m.durationMs;
      stat.maxDurationMs = Math.max(stat.maxDurationMs, m.durationMs);
      stat.minDurationMs = Math.min(stat.minDurationMs, m.durationMs);
      if (m.memoryDeltaBytes !== undefined) {
        stat.totalMemoryDeltaBytes += m.memoryDeltaBytes;
      }
    }
    for (const cat of Object.keys(categoryStats)) {
      const stat = categoryStats[cat];
      stat.avgDurationMs = stat.count > 0 ? stat.totalDurationMs / stat.count : 0;
    }

    // 找内存峰值
    let peakMemory: MemorySnapshot | undefined;
    for (const s of this.memorySamples) {
      if (!peakMemory || s.heapUsed > peakMemory.heapUsed) {
        peakMemory = s;
      }
    }

    const cpuTimeMs =
      this.initialCpu && this.finalCpu
        ? this.finalCpu.user - this.initialCpu.user + (this.finalCpu.system - this.initialCpu.system)
        : undefined;

    return {
      startTime: this.startTime,
      endTime: this.endTime,
      durationMs: this.endTime - this.startTime,
      memorySamples: this.memorySamples.length,
      cpuSamples: this.cpuSamples.length,
      measurementCount: this.measurements.length,
      peakMemory,
      initialMemory: this.initialMemory,
      finalMemory: this.finalMemory,
      initialCpu: this.initialCpu,
      finalCpu: this.finalCpu,
      cpuTimeMs,
      categoryStats,
      slowestMeasurements: slowest,
      measurements,
    };
  }

  /**
   * 测量同步函数的执行时间。
   *
   * @param name 测量名
   * @param fn 待测函数
   * @param category 测量类别（可选）
   */
  measure<T>(name: string, fn: () => T, category?: string): T {
    const startTime = this.now();
    const startMemory = this.running ? this.options.memoryUsageFn() : undefined;
    let error = false;
    try {
      return fn();
    } catch (err) {
      error = true;
      throw err;
    } finally {
      const endTime = this.now();
      const endMemory = this.running ? this.options.memoryUsageFn() : undefined;
      const measurement: ProfileMeasurement = {
        name,
        startTime,
        endTime,
        durationMs: endTime - startTime,
        startMemory,
        endMemory,
        memoryDeltaBytes:
          startMemory && endMemory ? endMemory.heapUsed - startMemory.heapUsed : undefined,
        category,
        error,
      };
      this.measurements.push(measurement);
    }
  }

  /**
   * 测量异步函数的执行时间。
   *
   * @param name 测量名
   * @param fn 待测异步函数
   * @param category 测量类别（可选）
   */
  async measureAsync<T>(name: string, fn: () => Promise<T>, category?: string): Promise<T> {
    const startTime = this.now();
    const startMemory = this.running ? this.options.memoryUsageFn() : undefined;
    let error = false;
    try {
      return await fn();
    } catch (err) {
      error = true;
      throw err;
    } finally {
      const endTime = this.now();
      const endMemory = this.running ? this.options.memoryUsageFn() : undefined;
      const measurement: ProfileMeasurement = {
        name,
        startTime,
        endTime,
        durationMs: endTime - startTime,
        startMemory,
        endMemory,
        memoryDeltaBytes:
          startMemory && endMemory ? endMemory.heapUsed - startMemory.heapUsed : undefined,
        category,
        error,
      };
      this.measurements.push(measurement);
    }
  }

  /** 重置剖析器（清空所有数据，停止任何活动会话） */
  reset(): void {
    if (this.running) {
      if (this.samplerId !== null) {
        const clearIntervalFn = this.options.clearIntervalFn;
        if (clearIntervalFn) {
          clearIntervalFn(this.samplerId);
        } else {
          clearInterval(this.samplerId as NodeJS.Timeout);
        }
        this.samplerId = null;
      }
      this.running = false;
    }
    this.startTime = 0;
    this.endTime = 0;
    this.initialMemory = undefined;
    this.finalMemory = undefined;
    this.initialCpu = undefined;
    this.finalCpu = undefined;
    this.memorySamples = [];
    this.cpuSamples = [];
    this.measurements = [];
  }
}

// ==================== 全局 profiler ====================

let globalProfiler: Profiler | undefined;

/** 获取全局 profiler（懒初始化） */
export function getGlobalProfiler(): Profiler {
  if (!globalProfiler) {
    globalProfiler = new Profiler();
  }
  return globalProfiler;
}

/** 替换全局 profiler（用于测试隔离） */
export function setGlobalProfiler(profiler: Profiler | undefined): void {
  globalProfiler = profiler;
}

/** 重置全局 profiler */
export function resetGlobalProfiler(): void {
  if (globalProfiler) {
    globalProfiler.reset();
  } else {
    globalProfiler = new Profiler();
  }
}

// ==================== 便捷函数 ====================

/**
 * 开启性能剖析会话（使用全局 profiler）。
 *
 * @param options 剖析选项
 */
export function startProfiling(options?: ProfilingOptions): void {
  getGlobalProfiler().startProfiling(options);
}

/**
 * 停止性能剖析并返回报告（使用全局 profiler）。
 */
export function stopProfiling(): ProfileReport {
  return getGlobalProfiler().stopProfiling();
}

/**
 * 获取当前性能报告（使用全局 profiler）。
 * 可在剖析过程中调用以获取中间状态。
 */
export function getProfileReport(): ProfileReport {
  return getGlobalProfiler().getProfileReport();
}

/**
 * 格式化性能报告为可读字符串。
 *
 * @param report 性能报告
 */
export function formatProfileReport(report: ProfileReport): string {
  const lines: string[] = [];
  lines.push('=== Performance Report ===');
  lines.push(`Total Duration: ${report.durationMs.toFixed(2)}ms`);
  if (report.cpuTimeMs !== undefined) {
    lines.push(`CPU Time: ${report.cpuTimeMs.toFixed(2)}ms`);
  }
  lines.push(`Measurements: ${report.measurementCount}`);
  lines.push(`Memory Samples: ${report.memorySamples}`);
  if (report.cpuSamples > 0) {
    lines.push(`CPU Samples: ${report.cpuSamples}`);
  }

  if (report.initialMemory && report.finalMemory) {
    const deltaBytes = report.finalMemory.heapUsed - report.initialMemory.heapUsed;
    const formatBytes = (b: number) => `${(b / 1024 / 1024).toFixed(2)} MB`;
    lines.push('');
    lines.push('--- Memory ---');
    lines.push(`Initial Heap: ${formatBytes(report.initialMemory.heapUsed)}`);
    lines.push(`Final Heap: ${formatBytes(report.finalMemory.heapUsed)}`);
    lines.push(`Delta: ${deltaBytes >= 0 ? '+' : ''}${formatBytes(deltaBytes)}`);
    if (report.peakMemory) {
      lines.push(`Peak Heap: ${formatBytes(report.peakMemory.heapUsed)}`);
    }
  }

  if (Object.keys(report.categoryStats).length > 0) {
    lines.push('');
    lines.push('--- By Category ---');
    for (const [cat, stat] of Object.entries(report.categoryStats)) {
      lines.push(
        `${cat}: count=${stat.count} total=${stat.totalDurationMs.toFixed(2)}ms ` +
          `avg=${stat.avgDurationMs.toFixed(2)}ms max=${stat.maxDurationMs.toFixed(2)}ms`,
      );
    }
  }

  if (report.slowestMeasurements.length > 0) {
    lines.push('');
    lines.push('--- Slowest Operations ---');
    for (const m of report.slowestMeasurements.slice(0, 5)) {
      const memInfo =
        m.memoryDeltaBytes !== undefined
          ? `  Δmem=${(m.memoryDeltaBytes / 1024).toFixed(2)}KB`
          : '';
      lines.push(`  ${m.name}: ${m.durationMs.toFixed(2)}ms${memInfo}`);
    }
  }

  return lines.join('\n');
}
