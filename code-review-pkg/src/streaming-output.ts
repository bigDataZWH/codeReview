// src/streaming-output.ts — Task 6：流式输出
//
// 职责：
// - 为长耗时审查任务提供 SSE (Server-Sent Events) 风格的事件流式输出能力
// - 支持 start / file_start / file_complete / complete / error 事件
// - 提供创建 emitter、注册监听器、按 SSE 格式序列化事件、写出事件等能力
// - 不强绑定 stdout：调用方可注入 write 函数，决定事件去向（stdout / WebSocket / 日志）
//
// 设计取舍：
// - 复用 ProgressEmitter 风格的 on/emit API，但事件名使用下划线风格（SSE 常见命名）
// - SSE 事件格式：`event: <name>\ndata: <json>\n\n`
// - 监听器错误被吞掉，避免单监听器故障中断整体流程
// - 通过 createStreamingEmitter 工厂函数返回带 SSE 序列化与便捷发送方法的对象

import type { FileDiff, Finding } from './types.js';

/** 流式事件名称 */
export type StreamingEvent =
  | 'start'
  | 'file_start'
  | 'file_complete'
  | 'complete'
  | 'error';

/** start 事件负载 */
export interface StreamStartPayload {
  /** 总文件数 */
  totalFiles: number;
  /** 起始时间戳（ms） */
  startTime?: number;
}

/** file_start 事件负载 */
export interface StreamFileStartPayload {
  /** 当前文件路径 */
  file: string;
  /** 当前文件索引（0-based） */
  index: number;
  /** 总文件数 */
  total: number;
}

/** file_complete 事件负载 */
export interface StreamFileCompletePayload {
  /** 当前文件路径 */
  file: string;
  /** 当前文件索引（0-based） */
  index: number;
  /** 总文件数 */
  total: number;
  /** 该文件产生的 findings */
  findings: Finding[];
  /** 该文件处理耗时（ms） */
  durationMs?: number;
}

/** complete 事件负载 */
export interface StreamCompletePayload {
  /** 总文件数 */
  totalFiles: number;
  /** 总 findings 数 */
  findingsCount: number;
  /** 总耗时（ms） */
  durationMs: number;
  /** 失败文件数 */
  failedFiles?: number;
}

/** error 事件负载 */
export interface StreamErrorPayload {
  /** 错误对象（序列化为 message + stack） */
  message: string;
  /** 错误堆栈（可选） */
  stack?: string;
  /** 错误发生阶段 */
  stage?: string;
  /** 出错文件路径（可选） */
  file?: string;
}

/** 事件负载映射 */
export interface StreamingPayloadMap {
  start: StreamStartPayload;
  file_start: StreamFileStartPayload;
  file_complete: StreamFileCompletePayload;
  complete: StreamCompletePayload;
  error: StreamErrorPayload;
}

/** 监听器函数类型 */
export type StreamingListener<K extends StreamingEvent> = (
  payload: StreamingPayloadMap[K],
) => void;

/** 写出函数：将字符串写入目标（stdout / WebSocket 等） */
export type StreamWriter = (chunk: string) => void;

/** 内部监听器条目 */
interface ListenerEntry {
  once: boolean;
  fn: StreamingListener<StreamingEvent>;
  /** once 模式下原始监听器引用（用于 off 比对） */
  wrapped?: StreamingListener<StreamingEvent>;
}

/**
 * 流式输出 emitter。
 *
 * 提供 on / once / off / emit 用于注册和触发事件监听器；
 * 提供 emitSSE / sendSSE 用于按 SSE 格式序列化事件并写出。
 */
export class StreamingEmitter {
  /** 事件 → 监听器集合 */
  private readonly listeners: Map<StreamingEvent, Set<ListenerEntry>> = new Map();
  /** SSE 写出函数（可选；未设置时 emitSSE 仅序列化不写出） */
  private readonly writer?: StreamWriter;
  /** 总文件数（来自 start 事件） */
  private totalFiles = 0;
  /** 已处理文件数（file_complete 计数） */
  private processedFiles = 0;
  /** 是否已触发 start */
  private started = false;
  /** 是否已触发 complete */
  private completed = false;

  constructor(writer?: StreamWriter) {
    this.writer = writer;
  }

  /**
   * 注册事件监听器。
   */
  on<K extends StreamingEvent>(event: K, listener: StreamingListener<K>): this {
    return this.addListener(event, listener, false);
  }

  /**
   * 注册一次性事件监听器（触发后自动移除）。
   */
  once<K extends StreamingEvent>(event: K, listener: StreamingListener<K>): this {
    return this.addListener(event, listener, true);
  }

  /**
   * 取消事件监听器。
   */
  off<K extends StreamingEvent>(event: K, listener: StreamingListener<K>): this {
    const set = this.listeners.get(event);
    if (!set) return this;
    for (const entry of set) {
      if (entry.fn === listener || entry.wrapped === listener) {
        set.delete(entry);
        break;
      }
    }
    return this;
  }

  /** 内部添加监听器实现 */
  private addListener<K extends StreamingEvent>(
    event: K,
    listener: StreamingListener<K>,
    once: boolean,
  ): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const entry: ListenerEntry = once
      ? {
          once: true,
          fn: ((payload: StreamingPayloadMap[K]) => {
            this.off(event, listener);
            listener(payload);
          }) as unknown as StreamingListener<StreamingEvent>,
          wrapped: listener as unknown as StreamingListener<StreamingEvent>,
        }
      : {
          once: false,
          fn: listener as unknown as StreamingListener<StreamingEvent>,
          wrapped: undefined,
        };
    set.add(entry);
    return this;
  }

  /**
   * 触发事件（仅触发监听器，不写 SSE）。
   *
   * 内部维护 totalFiles/processedFiles 计数：
   * - start：记录 totalFiles
   * - file_complete：累加 processedFiles
   * - complete：标记完成
   */
  emit<K extends StreamingEvent>(event: K, payload: StreamingPayloadMap[K]): this {
    this.updateState(event, payload);
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return this;
    const list = Array.from(set);
    for (const entry of list) {
      try {
        entry.fn(payload as StreamingPayloadMap[StreamingEvent]);
      } catch {
        // 监听器异常吞掉
      }
    }
    return this;
  }

  /** 根据 emit 的事件更新内部计数 */
  private updateState<K extends StreamingEvent>(event: K, payload: StreamingPayloadMap[K]): void {
    switch (event) {
      case 'start': {
        const p = payload as StreamStartPayload;
        this.totalFiles = p.totalFiles;
        this.processedFiles = 0;
        this.started = true;
        this.completed = false;
        break;
      }
      case 'file_complete': {
        this.processedFiles += 1;
        break;
      }
      case 'complete': {
        this.completed = true;
        break;
      }
      default:
        break;
    }
  }

  /**
   * 将事件序列化为 SSE 格式字符串。
   *
   * 格式：
   * ```
   * event: <event-name>
   * data: <json-payload>
   *
   * ```
   */
  static serializeSSE<K extends StreamingEvent>(
    event: K,
    payload: StreamingPayloadMap[K],
  ): string {
    return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  }

  /**
   * 序列化并写出 SSE 事件（若构造时提供了 writer）。
   * 同时触发对应监听器。
   */
  emitSSE<K extends StreamingEvent>(event: K, payload: StreamingPayloadMap[K]): this {
    // 先触发监听器
    this.emit(event, payload);
    // 再写出 SSE
    if (this.writer) {
      this.writer(StreamingEmitter.serializeSSE(event, payload));
    }
    return this;
  }

  /** 发送 start 事件（SSE） */
  sendStart(payload: StreamStartPayload): this {
    return this.emitSSE('start', payload);
  }

  /** 发送 file_start 事件（SSE） */
  sendFileStart(payload: StreamFileStartPayload): this {
    return this.emitSSE('file_start', payload);
  }

  /** 发送 file_complete 事件（SSE） */
  sendFileComplete(payload: StreamFileCompletePayload): this {
    return this.emitSSE('file_complete', payload);
  }

  /** 发送 complete 事件（SSE） */
  sendComplete(payload: StreamCompletePayload): this {
    return this.emitSSE('complete', payload);
  }

  /** 发送 error 事件（SSE） */
  sendError(payload: StreamErrorPayload): this {
    return this.emitSSE('error', payload);
  }

  /**
   * 返回当前进度百分比（0-100，整数）。
   * - 未 start 时返回 0
   * - totalFiles=0 时返回 100
   * - complete 事件触发后固定返回 100
   */
  getProgress(): number {
    if (this.completed) return 100;
    if (!this.started) return 0;
    if (this.totalFiles === 0) return 100;
    const pct = Math.floor((this.processedFiles / this.totalFiles) * 100);
    if (pct > 100) return 100;
    if (pct < 0) return 0;
    return pct;
  }

  /** 返回指定事件的监听器数量 */
  listenerCount(event: StreamingEvent): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /** 清空指定事件的所有监听器（不传则清空所有） */
  removeAllListeners(event?: StreamingEvent): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }
}

/**
 * 工厂函数：创建一个 StreamingEmitter。
 *
 * @param writer 可选的写出函数（如 process.stdout.write.bind(process.stdout)）
 * @returns StreamingEmitter 实例
 */
export function createStreamingEmitter(writer?: StreamWriter): StreamingEmitter {
  return new StreamingEmitter(writer);
}

/**
 * 将 Error 对象转换为 StreamErrorPayload（提取 message / stack）。
 */
export function errorToPayload(err: unknown, stage?: string, file?: string): StreamErrorPayload {
  const error = err instanceof Error ? err : new Error(String(err));
  return {
    message: error.message,
    stack: error.stack,
    stage,
    file,
  };
}

/**
 * 遍历文件列表，逐个发送 file_start / file_complete 事件。
 *
 * 用于将 batchProcess 或顺序处理结果回放为 SSE 流。
 *
 * @param emitter 目标 emitter
 * @param diffs 文件列表
 * @param processFn 处理函数：接收 FileDiff，返回 findings（异步）
 */
export async function streamProcessFiles(
  emitter: StreamingEmitter,
  diffs: FileDiff[],
  processFn: (diff: FileDiff, index: number) => Promise<Finding[]>,
): Promise<{ allFindings: Finding[]; failedFiles: number; durationMs: number }> {
  const startTime = performance.now();
  const allFindings: Finding[] = [];
  let failedFiles = 0;

  emitter.sendStart({ totalFiles: diffs.length, startTime });

  for (let i = 0; i < diffs.length; i++) {
    const diff = diffs[i];
    const fileStart = performance.now();
    emitter.sendFileStart({
      file: diff.path,
      index: i,
      total: diffs.length,
    });
    try {
      const findings = await processFn(diff, i);
      allFindings.push(...findings);
      emitter.sendFileComplete({
        file: diff.path,
        index: i,
        total: diffs.length,
        findings,
        durationMs: performance.now() - fileStart,
      });
    } catch (err) {
      failedFiles++;
      emitter.sendError(errorToPayload(err, 'process-file', diff.path));
      // 仍发送一个空的 file_complete 事件以推进进度
      emitter.sendFileComplete({
        file: diff.path,
        index: i,
        total: diffs.length,
        findings: [],
        durationMs: performance.now() - fileStart,
      });
    }
  }

  const durationMs = performance.now() - startTime;
  emitter.sendComplete({
    totalFiles: diffs.length,
    findingsCount: allFindings.length,
    durationMs,
    failedFiles,
  });

  return { allFindings, failedFiles, durationMs };
}
