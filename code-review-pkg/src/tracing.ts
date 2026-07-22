// src/tracing.ts — Task 18：链路追踪
//
// 职责：
// 1. TracingManager 类：内存存储 span，OpenTelemetry 风格的追踪管理
// 2. startSpan / endSpan：手动开启/关闭 span
// 3. withSpan：便捷包装器，自动开启/关闭 span 并捕获异常
// 4. exportTraces：导出全部 span 数据（JSON 格式）
//
// 设计取舍：
// - 仅使用内存存储，不依赖外部 SDK（@opentelemetry/api 等）
// - span 之间支持父子关系（parentSpanId）
// - 默认全局 TracingManager，可通过 setGlobalTracer 替换
// - 集成到 pipeline.ts 中，在 parseDiff/filterFiles/matchRules/buildPrompt 等步骤创建 span
// - 性能数据通过 performance.now() 采集（与 Node 18+ 兼容）
//
// 与 pipeline.ts 集成：
// - 在 runPipeline / runPipelineWithMiddleware 内创建 span
// - span 名称与 pipeline 步骤对应（如 'parseDiff' / 'filterFiles'）

// ==================== 类型定义 ====================

/** Span 状态 */
export type SpanStatus = 'active' | 'completed' | 'error';

/** 单个 span 记录 */
export interface Span {
  /** Span 唯一 ID */
  spanId: string;
  /** 父 span ID（可选） */
  parentSpanId?: string;
  /** Trace ID（同一次请求内共享） */
  traceId: string;
  /** Span 名称 */
  name: string;
  /** 起始时间戳（ms，performance.now() 相对值） */
  startTime: number;
  /** 结束时间戳（ms，performance.now() 相对值） */
  endTime?: number;
  /** 持续时间（ms） */
  durationMs?: number;
  /** Span 状态 */
  status: SpanStatus;
  /** Span 属性（业务标签，如 file 数量、rule 数量等） */
  attributes?: Record<string, unknown>;
  /** Span 事件（异常、警告等） */
  events?: SpanEvent[];
  /** 错误信息（status === 'error' 时填充） */
  error?: string;
}

/** Span 事件 */
export interface SpanEvent {
  /** 事件名称 */
  name: string;
  /** 事件时间戳（ms，performance.now() 相对值） */
  timestamp: number;
  /** 事件属性（可选） */
  attributes?: Record<string, unknown>;
}

/** 导出的 trace 数据 */
export interface TraceExport {
  /** Trace ID */
  traceId: string;
  /** 该 trace 下的全部 span */
  spans: Span[];
  /** Span 总数 */
  spanCount: number;
  /** 总持续时间（ms，从最早 span 到最晚 span） */
  totalDurationMs: number;
  /** 导出时间戳（ISO 8601） */
  exportedAt: string;
}

/** TracingManager 构造选项 */
export interface TracingManagerOptions {
  /** 服务名（默认 'code-review'） */
  serviceName?: string;
  /** Span 上限（默认 10000，避免内存溢出） */
  maxSpans?: number;
  /** 自定义 ID 生成器（用于测试） */
  idGenerator?: () => string;
  /** 自定义 performance.now 实现（用于测试） */
  nowFn?: () => number;
}

// ==================== 工具函数 ====================

/** 生成随机 hex 字符串（默认 16 字符 = 32 hex 位） */
function randomHex(length: number): string {
  const bytes = new Uint8Array(length);
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 默认 ID 生成器：使用 crypto 生成 16 字符 hex */
function defaultIdGenerator(): string {
  return randomHex(8);
}

// ==================== TracingManager 类 ====================

/**
 * 链路追踪管理器（内存存储，OpenTelemetry 风格）。
 *
 * 使用方式：
 * 1. const tracer = new TracingManager()
 * 2. const span = tracer.startSpan('parseDiff', { parentSpanId: parent?.spanId })
 * 3. ... 业务逻辑 ...
 * 4. tracer.endSpan(span)  // 或 span.setError(err) + tracer.endSpan(span)
 * 5. const exportData = tracer.exportTraces()
 *
 * 全局单例：
 * - getGlobalTracer() 返回默认全局 tracer
 * - setGlobalTracer(tracer) 替换全局 tracer（用于测试）
 */
export class TracingManager {
  /** 已记录的 span（按 spanId 索引） */
  private readonly spans: Map<string, Span> = new Map();
  /** trace ID → span ID 列表 */
  private readonly traceIndex: Map<string, string[]> = new Map();
  /** 当前活动 span 栈（用于自动关联 parent） */
  private readonly activeStack: Span[] = [];
  /** 服务名 */
  readonly serviceName: string;
  /** Span 上限 */
  private readonly maxSpans: number;
  /** ID 生成器 */
  private readonly idGenerator: () => string;
  /** performance.now 实现 */
  private readonly nowFn: () => number;

  constructor(options: TracingManagerOptions = {}) {
    this.serviceName = options.serviceName ?? 'code-review';
    this.maxSpans = Math.max(1, options.maxSpans ?? 10000);
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
    this.nowFn = options.nowFn ?? (() => performance.now());
  }

  private resolveSpan(span: Span | string): Span | undefined {
    return typeof span === 'string' ? this.spans.get(span) : span;
  }

  /** 当前 performance.now 值（便于测试注入） */
  now(): number {
    return this.nowFn();
  }

  /** 当前活动 span 数 */
  activeSpanCount(): number {
    return this.activeStack.length;
  }

  /** 内存中 span 总数 */
  spanCount(): number {
    return this.spans.size;
  }

  /** trace 总数 */
  traceCount(): number {
    return this.traceIndex.size;
  }

  /**
   * 开启一个新 span。
   *
   * - 自动生成 spanId / traceId（未指定 parent 时新建 trace）
   * - 若 parentSpanId 提供且找到对应 span，复用其 traceId
   * - 若 parentSpanId 为 null，明确创建根 span（不继承活动栈）
   * - 若 parentSpanId 为 undefined 且活动栈非空，使用栈顶作为 parent
   *
   * @param name span 名称（如 'parseDiff'）
   * @param options 选项（parentSpanId / traceId / attributes）
   * @returns 新建的 span
   */
  startSpan(
    name: string,
    options: {
      parentSpanId?: string | null;
      traceId?: string;
      attributes?: Record<string, unknown>;
    } = {},
  ): Span {
    // 查找 parent span：
    // - 显式 parentSpanId: null → 根 span
    // - 显式 parentSpanId: string → 查找对应 span
    // - 未指定 parentSpanId → 使用活动栈顶
    let parentSpan: Span | undefined;
    if (options.parentSpanId === null) {
      parentSpan = undefined;
    } else if (options.parentSpanId) {
      parentSpan = this.spans.get(options.parentSpanId);
    } else if (this.activeStack.length > 0) {
      parentSpan = this.activeStack[this.activeStack.length - 1];
    }

    const spanId = this.idGenerator();
    const traceId = options.traceId ?? parentSpan?.traceId ?? this.idGenerator();

    const span: Span = {
      spanId,
      parentSpanId: parentSpan?.spanId,
      traceId,
      name,
      startTime: this.now(),
      status: 'active',
      attributes: options.attributes ? { ...options.attributes } : undefined,
      events: [],
    };

    this.spans.set(spanId, span);
    this.activeStack.push(span);

    // 维护 trace 索引
    const traceSpans = this.traceIndex.get(traceId) ?? [];
    traceSpans.push(spanId);
    this.traceIndex.set(traceId, traceSpans);

    // 超限时丢弃最旧的 span（不抛异常）
    if (this.spans.size > this.maxSpans) {
      this.evictOldestSpan();
    }

    return span;
  }

  /**
   * 结束一个 span。
   *
   * - 计算 durationMs
   * - 更新 status（若 status 仍为 active，则置为 completed；若已为 error，保留）
   * - 从活动栈中移除
   *
   * @param span 要结束的 span（或 spanId）
   * @param error 可选错误信息（设置时将 status 置为 error）
   */
  endSpan(span: Span | string, error?: string | Error): void {
    const target = this.resolveSpan(span);
    if (!target) {
      return;
    }
    if (target.status === 'completed' || target.status === 'error') {
      return;
    }

    target.endTime = this.now();
    target.durationMs = target.endTime - target.startTime;
    if (error !== undefined) {
      target.error = error instanceof Error ? error.message : String(error);
      target.status = 'error';
    } else {
      target.status = 'completed';
    }

    const idx = this.activeStack.lastIndexOf(target);
    if (idx !== -1) {
      this.activeStack.splice(idx, 1);
    }
  }

  /** 为 span 添加属性 */
  setAttribute(span: Span | string, key: string, value: unknown): void {
    const target = this.resolveSpan(span);
    if (!target) return;
    if (!target.attributes) {
      target.attributes = {};
    }
    target.attributes[key] = value;
  }

  addEvent(span: Span | string, name: string, attributes?: Record<string, unknown>): void {
    const target = this.resolveSpan(span);
    if (!target) return;
    if (!target.events) {
      target.events = [];
    }
    target.events.push({
      name,
      timestamp: this.now(),
      attributes: attributes ? { ...attributes } : undefined,
    });
  }

  setError(span: Span | string, error: string | Error): void {
    const target = this.resolveSpan(span);
    if (!target) return;
    target.error = error instanceof Error ? error.message : String(error);
    target.status = 'error';
  }

  /** 获取指定 span */
  getSpan(spanId: string): Span | undefined {
    const span = this.spans.get(spanId);
    return span ? { ...span } : undefined;
  }

  /** 获取指定 trace 下的所有 span */
  getSpansByTrace(traceId: string): Span[] {
    const ids = this.traceIndex.get(traceId) ?? [];
    return ids
      .map((id) => this.spans.get(id))
      .filter((s): s is Span => s !== undefined)
      .map((s) => ({ ...s }));
  }

  /** 获取所有 span（按 startTime 排序） */
  getAllSpans(): Span[] {
    return Array.from(this.spans.values())
      .sort((a, b) => a.startTime - b.startTime)
      .map((s) => ({ ...s }));
  }

  /**
   * 导出 traces 数据。
   *
   * - 不传 traceId 时导出全部 trace
   * - 传 traceId 时导出指定 trace
   *
   * @param traceId 可选 trace ID
   * @returns TraceExport 或 TraceExport 数组
   */
  exportTraces(traceId?: string): TraceExport | TraceExport[] {
    const exportedAt = new Date().toISOString();

    if (traceId) {
      return this.exportSingleTrace(traceId, exportedAt);
    }

    const traceIds = Array.from(this.traceIndex.keys());
    return traceIds.map((id) => this.exportSingleTrace(id, exportedAt));
  }

  /** 导出单个 trace */
  private exportSingleTrace(traceId: string, exportedAt: string): TraceExport {
    const spans = this.getSpansByTrace(traceId);
    let minStart = Infinity;
    let maxEnd = -Infinity;
    for (const span of spans) {
      if (span.startTime < minStart) minStart = span.startTime;
      const end = span.endTime ?? span.startTime;
      if (end > maxEnd) maxEnd = end;
    }
    if (spans.length === 0) {
      minStart = 0;
      maxEnd = 0;
    }

    return {
      traceId,
      spans,
      spanCount: spans.length,
      totalDurationMs: maxEnd - minStart,
      exportedAt,
    };
  }

  /** 清空所有 span（保留配置） */
  clear(): void {
    this.spans.clear();
    this.traceIndex.clear();
    this.activeStack.length = 0;
  }

  private evictOldestSpan(): void {
    let oldestSpan: Span | undefined;
    let oldestId: string | undefined;
    for (const [id, span] of this.spans) {
      if (!oldestSpan || span.startTime < oldestSpan.startTime) {
        oldestSpan = span;
        oldestId = id;
      }
    }
    if (oldestId && oldestSpan) {
      this.spans.delete(oldestId);
      const stackIdx = this.activeStack.indexOf(oldestSpan);
      if (stackIdx !== -1) {
        this.activeStack.splice(stackIdx, 1);
      }
      const traceSpans = this.traceIndex.get(oldestSpan.traceId);
      if (traceSpans) {
        const filtered = traceSpans.filter((id) => id !== oldestId);
        if (filtered.length === 0) {
          this.traceIndex.delete(oldestSpan.traceId);
        } else {
          this.traceIndex.set(oldestSpan.traceId, filtered);
        }
      }
    }
  }
}

// ==================== 全局 tracer ====================

let globalTracer: TracingManager | undefined;

/** 获取全局 tracer（懒初始化） */
export function getGlobalTracer(): TracingManager {
  if (!globalTracer) {
    globalTracer = new TracingManager();
  }
  return globalTracer;
}

/** 替换全局 tracer（用于测试隔离） */
export function setGlobalTracer(tracer: TracingManager | undefined): void {
  globalTracer = tracer;
}

/** 重置全局 tracer（清空所有 span，便于测试） */
export function resetGlobalTracer(): void {
  if (globalTracer) {
    globalTracer.clear();
  } else {
    globalTracer = new TracingManager();
  }
}

// ==================== 便捷函数 ====================

/**
 * 开启一个 span（使用全局 tracer）。
 *
 * @param name span 名称
 * @param options 选项
 */
export function startSpan(
  name: string,
  options?: {
    parentSpanId?: string | null;
    traceId?: string;
    attributes?: Record<string, unknown>;
  },
): Span {
  return getGlobalTracer().startSpan(name, options);
}

/**
 * 结束一个 span（使用全局 tracer）。
 *
 * @param span span 或 spanId
 * @param error 可选错误
 */
export function endSpan(span: Span | string, error?: string | Error): void {
  getGlobalTracer().endSpan(span, error);
}

/**
 * 便捷包装器：自动管理 span 生命周期。
 *
 * 同步函数：
 * ```ts
 * const result = withSpan('parseDiff', { attributes: { input } }, (span) => {
 *   return parseDiff(input);
 * });
 * ```
 *
 * 异步函数：
 * ```ts
 * const result = await withSpan('filterFiles', async (span) => {
 *   return await filterFilesAsync(diffs);
 * });
 * ```
 *
 * 异常时自动设置 status=error 并重新抛出。
 */
export function withSpan<T>(
  name: string,
  fn: (span: Span) => T,
  options?: {
    parentSpanId?: string | null;
    traceId?: string;
    attributes?: Record<string, unknown>;
  },
): T;
export function withSpan<T>(
  name: string,
  options: {
    parentSpanId?: string | null;
    traceId?: string;
    attributes?: Record<string, unknown>;
  },
  fn: (span: Span) => T,
): T;
export function withSpan<T>(
  name: string,
  fnOrOptions: ((span: Span) => T) | {
    parentSpanId?: string | null;
    traceId?: string;
    attributes?: Record<string, unknown>;
  },
  maybeFn?: ((span: Span) => T) | {
    parentSpanId?: string | null;
    traceId?: string;
    attributes?: Record<string, unknown>;
  },
): T {
  const tracer = getGlobalTracer();
  const fn = typeof fnOrOptions === 'function'
    ? fnOrOptions
    : maybeFn as (span: Span) => T;
  const options = typeof fnOrOptions === 'function' ? undefined : fnOrOptions;

  const span = tracer.startSpan(name, options);
  try {
    const result = fn(span);
    // 异步结果（Promise）需要等待 resolve 后再结束 span
    if (result instanceof Promise) {
      return result.then(
        (v) => {
          tracer.endSpan(span);
          return v;
        },
        (err) => {
          tracer.endSpan(span, err);
          throw err;
        },
      ) as unknown as T;
    }
    tracer.endSpan(span);
    return result;
  } catch (err) {
    tracer.endSpan(span, err as Error);
    throw err;
  }
}

/**
 * 导出 traces 数据（使用全局 tracer）。
 *
 * @param traceId 可选 trace ID
 */
export function exportTraces(traceId?: string): TraceExport | TraceExport[] {
  return getGlobalTracer().exportTraces(traceId);
}
