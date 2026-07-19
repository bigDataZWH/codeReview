// src/progress.ts — 迭代 9：渐进式输出
//
// 设计目标：
// - 为长耗时审查任务提供事件流式输出能力
// - 支持 start / file-start / file-complete / file-error / complete / error 事件
// - 支持进度百分比计算（基于已处理文件数）
// - 不直接耦合 I/O，调用方可注册监听器后自行决定如何呈现（CLI spinner、WebSockets、日志等）
//
// 设计取舍：
// - 使用 Node.js 标准 EventEmitter 风格 API（on/once/off/emit）
// - 不依赖 events 模块，自行实现最小事件分发，避免 ESM 互操作问题
// - 监听器错误被捕获并吞掉，避免单监听器故障影响整体流程

/** 进度事件名称 */
export type ProgressEvent =
  | 'start'
  | 'file-start'
  | 'file-complete'
  | 'file-error'
  | 'complete'
  | 'error';

/** start 事件负载 */
export interface StartPayload {
  /** 总文件数 */
  totalFiles: number;
  /** 起始时间戳（ms） */
  startTime?: number;
}

/** file-start 事件负载 */
export interface FileStartPayload {
  /** 当前文件路径 */
  file: string;
  /** 当前文件索引（0-based） */
  index: number;
  /** 总文件数 */
  total: number;
}

/** file-complete 事件负载 */
export interface FileCompletePayload {
  /** 当前文件路径 */
  file: string;
  /** 当前文件索引（0-based） */
  index: number;
  /** 总文件数 */
  total: number;
  /** 该文件产生的 findings */
  findings: unknown[];
  /** 该文件处理耗时（ms） */
  durationMs?: number;
}

/** file-error 事件负载 */
export interface FileErrorPayload {
  /** 当前文件路径 */
  file: string;
  /** 当前文件索引（0-based） */
  index: number;
  /** 总文件数 */
  total: number;
  /** 错误对象 */
  error: Error;
}

/** complete 事件负载 */
export interface CompletePayload {
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
export interface ErrorPayload {
  /** 错误对象 */
  error: Error;
  /** 错误发生阶段 */
  stage?: string;
}

/** 事件负载映射 */
export interface ProgressPayloadMap {
  start: StartPayload;
  'file-start': FileStartPayload;
  'file-complete': FileCompletePayload;
  'file-error': FileErrorPayload;
  complete: CompletePayload;
  error: ErrorPayload;
}

/** 监听器函数类型 */
export type ProgressListener<K extends ProgressEvent> = (
  payload: ProgressPayloadMap[K],
) => void;

/**
 * 渐进式输出事件发射器。
 *
 * 用法：
 * ```ts
 * const emitter = new ProgressEmitter();
 * emitter.on('file-complete', ({ file, findings }) => console.log(`${file}: ${findings.length}`));
 * emitter.emit('start', { totalFiles: 10 });
 * for (let i = 0; i < 10; i++) {
 *   emitter.emit('file-complete', { file: `f${i}`, index: i, total: 10, findings: [] });
 * }
 * emitter.emit('complete', { totalFiles: 10, findingsCount: 0, durationMs: 100 });
 * ```
 */
export class ProgressEmitter {
  /** 事件 → 监听器集合 */
  private listeners: Map<ProgressEvent, Set<ListenerEntry>> = new Map();
  /** 总文件数（来自 start 事件） */
  private totalFiles = 0;
  /** 已处理文件数（file-complete + file-error） */
  private processedFiles = 0;
  /** 是否已触发 start */
  private started = false;
  /** 是否已触发 complete */
  private completed = false;

  /**
   * 注册事件监听器。
   * @param event 事件名称
   * @param listener 监听器函数
   */
  on<K extends ProgressEvent>(event: K, listener: ProgressListener<K>): this {
    return this.addListener(event, listener, false);
  }

  /**
   * 注册一次性事件监听器（触发后自动移除）。
   */
  once<K extends ProgressEvent>(event: K, listener: ProgressListener<K>): this {
    return this.addListener(event, listener, true);
  }

  /**
   * 取消事件监听器。
   */
  off<K extends ProgressEvent>(event: K, listener: ProgressListener<K>): this {
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
  private addListener<K extends ProgressEvent>(
    event: K,
    listener: ProgressListener<K>,
    once: boolean,
  ): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    // once 包装：触发后自动 off
    const entry: ListenerEntry = once
      ? {
          once: true,
          fn: ((payload: ProgressPayloadMap[K]) => {
            this.off(event, listener);
            listener(payload);
          }) as unknown as ProgressListener<ProgressEvent>,
          wrapped: listener as unknown as ProgressListener<ProgressEvent>,
        }
      : {
          once: false,
          fn: listener as ProgressListener<ProgressEvent>,
          wrapped: undefined,
        };
    set.add(entry);
    return this;
  }

  /**
   * 触发事件。
   *
   * 内部维护 totalFiles/processedFiles 计数：
   * - start：记录 totalFiles
   * - file-complete / file-error：累加 processedFiles
   * - complete：标记完成
   *
   * 监听器抛出的错误被吞掉，避免单监听器故障中断整体流程。
   */
  emit<K extends ProgressEvent>(event: K, payload: ProgressPayloadMap[K]): this {
    // 内部状态维护
    this.updateState(event, payload);

    const set = this.listeners.get(event);
    if (!set || set.size === 0) return this;
    // 拷贝一份避免 once 触发时迭代过程中修改集合
    const list = Array.from(set);
    for (const entry of list) {
      try {
        entry.fn(payload as ProgressPayloadMap[ProgressEvent]);
      } catch {
        // 监听器异常吞掉，不影响其他监听器与主流程
      }
    }
    return this;
  }

  /** 根据 emit 的事件更新内部计数 */
  private updateState<K extends ProgressEvent>(event: K, payload: ProgressPayloadMap[K]): void {
    switch (event) {
      case 'start': {
        const p = payload as StartPayload;
        this.totalFiles = p.totalFiles;
        this.processedFiles = 0;
        this.started = true;
        this.completed = false;
        break;
      }
      case 'file-complete':
      case 'file-error': {
        // 防止重复累加（同一 index 多次触发不应重复计）
        // 简化策略：仅按事件次数累加，调用方需保证事件语义正确
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
   * 返回当前进度百分比（0-100，整数）。
   * - 未 start 时返回 0
   * - totalFiles=0 时返回 100（无文件即完成）
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
  listenerCount(event: ProgressEvent): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /** 清空指定事件的所有监听器（不传则清空所有） */
  removeAllListeners(event?: ProgressEvent): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }
}

/** 内部监听器条目 */
interface ListenerEntry {
  once: boolean;
  fn: ProgressListener<ProgressEvent>;
  /** once 模式下原始监听器引用（用于 off 比对） */
  wrapped?: ProgressListener<ProgressEvent>;
}
