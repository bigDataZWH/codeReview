// src/parallel-tuner.ts — Task 5：并行调优
//
// 职责：
// - 基于文件大小、文件数量、CPU 核数动态调整并行度
// - 提供 getDefaultParallelism：基于 CPU 核数给出默认并行度
// - 提供 tuneParallelism：根据输入特征动态计算建议并行度
// - 提供 ParallelTuner 类：可记录历史与跟踪，便于运行时观察调优决策
//
// 设计取舍：
// - 纯启发式：CPU 核数 × 系数 + 文件数/大小修正，避免引入复杂调度
// - 上限保护：默认 16，避免对 LLM 等外部资源造成过大压力
// - 下限保护：>= 1
// - 文件大小阈值：单文件平均大小 > 阈值时降低并行度（防止内存压力）

import { cpus } from 'node:os';
import { getPatchSize } from './diff-parser.js';
import type { FileDiff } from './types.js';

/** 调优输入参数 */
export interface TuneParallelismInput {
  /** 文件数量 */
  fileCount: number;
  /** CPU 核数（默认 os.cpus().length） */
  cpuCount?: number;
  /** 文件总 patch 字符数（用于估算大小） */
  totalPatchSize?: number;
  /** 是否为 IO 密集型任务（如等待 LLM API 响应），默认 true。
   *  IO 密集型允许并行度高于 CPU 核数（设为 2x） */
  ioIntensive?: boolean;
  /** 用户指定的并行度上限（可选） */
  maxConcurrency?: number;
  /** 用户指定的并行度下限（可选，默认 1） */
  minConcurrency?: number;
}

/** 调优输出结果 */
export interface TuneParallelismResult {
  /** 建议并行度 */
  parallelism: number;
  /** 使用的 CPU 核数 */
  cpuCount: number;
  /** 是否为 IO 密集型 */
  ioIntensive: boolean;
  /** 单文件平均大小（字符） */
  avgFileSize: number;
  /** 调优原因（简短描述） */
  reason: string;
}

/** 默认并行度上限 */
export const DEFAULT_MAX_PARALLELISM = 16;
/** 默认并行度下限 */
export const DEFAULT_MIN_PARALLELISM = 1;
/** 单文件平均大小阈值（字符）：超过此值时降低并行度 */
export const DEFAULT_LARGE_FILE_THRESHOLD = 50_000;
/** 单文件平均大小阈值（字符）：低于此值时提升并行度 */
export const DEFAULT_SMALL_FILE_THRESHOLD = 5_000;

/**
 * 获取系统的 CPU 核数。
 *
 * 在 Node.js 环境返回 os.cpus().length；环境异常时回退为 1。
 */
export function getCpuCount(): number {
  try {
    const cpuList = cpus();
    return cpuList.length > 0 ? cpuList.length : 1;
  } catch {
    return 1;
  }
}

/**
 * 获取默认并行度。
 *
 * - CPU 密集型：默认 = CPU 核数
 * - IO 密集型：默认 = CPU 核数 × 2（上限 DEFAULT_MAX_PARALLELISM）
 * - CPU 核数无法获取时：默认 1
 *
 * @param ioIntensive 是否为 IO 密集型任务，默认 true
 * @param maxConcurrency 并行度上限，默认 DEFAULT_MAX_PARALLELISM
 */
export function getDefaultParallelism(
  ioIntensive: boolean = true,
  maxConcurrency: number = DEFAULT_MAX_PARALLELISM,
): number {
  const cpuCount = getCpuCount();
  let p = ioIntensive ? cpuCount * 2 : cpuCount;
  if (p < DEFAULT_MIN_PARALLELISM) p = DEFAULT_MIN_PARALLELISM;
  if (p > maxConcurrency) p = maxConcurrency;
  return p;
}

/**
 * 根据输入特征动态调整并行度。
 *
 * 调优策略（叠加生效）：
 * 1. 基础并行度 = IO 密集型 ? cpuCount * 2 : cpuCount
 * 2. 文件数修正：fileCount < cpuCount 时取 fileCount（无谓高并行）
 * 3. 大小修正：单文件平均 > LARGE_FILE_THRESHOLD 时减半（防内存压力）
 *              单文件平均 < SMALL_FILE_THRESHOLD 时不变
 * 4. 上下限裁剪：[minConcurrency, maxConcurrency]
 *
 * @param input 调优输入
 * @returns 调优结果
 */
export function tuneParallelism(input: TuneParallelismInput): TuneParallelismResult {
  const cpuCount = input.cpuCount ?? getCpuCount();
  const ioIntensive = input.ioIntensive ?? true;
  const maxConcurrency = input.maxConcurrency ?? DEFAULT_MAX_PARALLELISM;
  const minConcurrency = input.minConcurrency ?? DEFAULT_MIN_PARALLELISM;
  const fileCount = Math.max(0, input.fileCount);
  const totalPatchSize = input.totalPatchSize ?? 0;
  const avgFileSize = fileCount > 0 ? Math.floor(totalPatchSize / fileCount) : 0;

  // 1. 基础并行度
  let parallelism = ioIntensive ? cpuCount * 2 : cpuCount;
  const reasons: string[] = [];

  // 2. 文件数修正：少文件时降低并行度
  if (fileCount > 0 && fileCount < parallelism) {
    parallelism = fileCount;
    reasons.push(`reduced to fileCount (${fileCount})`);
  }

  // 3. 大小修正
  if (avgFileSize > DEFAULT_LARGE_FILE_THRESHOLD) {
    parallelism = Math.max(1, Math.floor(parallelism / 2));
    reasons.push(`large files (avg ${avgFileSize}B) halved`);
  } else if (avgFileSize > 0 && avgFileSize < DEFAULT_SMALL_FILE_THRESHOLD) {
    reasons.push(`small files (avg ${avgFileSize}B)`);
  }

  // 4. 上下限裁剪
  if (parallelism > maxConcurrency) {
    parallelism = maxConcurrency;
    reasons.push(`capped at max (${maxConcurrency})`);
  }
  if (parallelism < minConcurrency) {
    parallelism = minConcurrency;
    reasons.push(`floored at min (${minConcurrency})`);
  }

  // 防止 0
  if (parallelism < 1) parallelism = 1;

  const reason = reasons.length > 0 ? reasons.join('; ') : 'default';

  return {
    parallelism,
    cpuCount,
    ioIntensive,
    avgFileSize,
    reason,
  };
}

/**
 * 并行调优器类。
 *
 * 封装 tuneParallelism 并提供：
 * - tune(diffs, options)：基于 FileDiff[] 直接调优（自动计算 fileCount 与 totalPatchSize）
 * - tuneBatch(diffs, batchSize, options)：基于批次调优
 * - 历史记录：lastResult
 */
export class ParallelTuner {
  /** 默认上限 */
  private readonly maxConcurrency: number;
  /** 默认下限 */
  private readonly minConcurrency: number;
  /** 默认 IO 密集型 */
  private readonly ioIntensive: boolean;
  /** 上次调优结果 */
  private lastResult: TuneParallelismResult | null = null;

  constructor(options: {
    maxConcurrency?: number;
    minConcurrency?: number;
    ioIntensive?: boolean;
  } = {}) {
    this.maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_PARALLELISM;
    this.minConcurrency = options.minConcurrency ?? DEFAULT_MIN_PARALLELISM;
    this.ioIntensive = options.ioIntensive ?? true;
  }

  /**
   * 基于 FileDiff[] 直接调优并行度。
   */
  tune(
    diffs: FileDiff[],
    options: {
      ioIntensive?: boolean;
      maxConcurrency?: number;
      minConcurrency?: number;
    } = {},
  ): TuneParallelismResult {
    const fileCount = diffs.length;
    let totalPatchSize = 0;
    for (const d of diffs) {
      totalPatchSize += getPatchSize(d);
    }
    const result = tuneParallelism({
      fileCount,
      totalPatchSize,
      ioIntensive: options.ioIntensive ?? this.ioIntensive,
      maxConcurrency: options.maxConcurrency ?? this.maxConcurrency,
      minConcurrency: options.minConcurrency ?? this.minConcurrency,
    });
    this.lastResult = result;
    return result;
  }

  /**
   * 基于批次调优并行度：根据 batchSize 计算批次数，再依据批次数选择并行度。
   *
   * 批次数 ≤ 1 时返回 1；否则返回 tune(diffs) 的结果与批次数的较小者。
   */
  tuneBatch(
    diffs: FileDiff[],
    batchSize: number,
    options: {
      ioIntensive?: boolean;
      maxConcurrency?: number;
      minConcurrency?: number;
    } = {},
  ): TuneParallelismResult {
    if (batchSize <= 0) {
      throw new Error('batchSize must be positive');
    }
    if (diffs.length === 0) {
      const result = tuneParallelism({
        fileCount: 0,
        totalPatchSize: 0,
        ioIntensive: options.ioIntensive ?? this.ioIntensive,
        maxConcurrency: options.maxConcurrency ?? this.maxConcurrency,
        minConcurrency: options.minConcurrency ?? this.minConcurrency,
      });
      this.lastResult = result;
      return result;
    }
    const batchCount = Math.ceil(diffs.length / batchSize);
    const base = this.tune(diffs, options);
    const parallelism = Math.min(base.parallelism, Math.max(1, batchCount));
    const result: TuneParallelismResult = {
      ...base,
      parallelism,
      reason: `${base.reason}; batchCount=${batchCount}`,
    };
    this.lastResult = result;
    return result;
  }

  /** 返回上次调优结果（无则返回 null） */
  getLastResult(): TuneParallelismResult | null {
    return this.lastResult;
  }
}
