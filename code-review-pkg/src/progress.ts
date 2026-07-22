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

type AnyProgressListener = ProgressListener<ProgressEvent>;

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
  private listeners: Map<ProgressEvent, Set<ListenerEntry>> = new Map();
  private totalFiles = 0;
  private processedFiles = 0;
  private started = false;
  private completed = false;

  on<K extends ProgressEvent>(event: K, listener: ProgressListener<K>): this {
    return this.addListener(event, listener, false);
  }

  once<K extends ProgressEvent>(event: K, listener: ProgressListener<K>): this {
    return this.addListener(event, listener, true);
  }

  off<K extends ProgressEvent>(event: K, listener: ProgressListener<K>): this {
    const set = this.listeners.get(event);
    if (!set) return this;
    for (const entry of set) {
      if (entry.matches(listener as AnyProgressListener)) {
        set.delete(entry);
        break;
      }
    }
    return this;
  }

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
    set.add(new ListenerEntry(listener as AnyProgressListener, once, () => this.off(event, listener)));
    return this;
  }

  emit<K extends ProgressEvent>(event: K, payload: ProgressPayloadMap[K]): this {
    this.updateState(event, payload);

    const set = this.listeners.get(event);
    if (!set || set.size === 0) return this;
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

  private updateState<K extends ProgressEvent>(event: K, payload: ProgressPayloadMap[K]): void {
    switch (event) {
      case 'start': {
        const p = payload as StartPayload;
        this.totalFiles = Math.max(0, p.totalFiles);
        this.processedFiles = 0;
        this.started = true;
        this.completed = false;
        break;
      }
      case 'file-complete':
      case 'file-error': {
        if (this.processedFiles < this.totalFiles || this.totalFiles === 0) {
          this.processedFiles += 1;
        }
        break;
      }
      case 'complete': {
        this.completed = true;
        this.processedFiles = this.totalFiles;
        break;
      }
      default:
        break;
    }
  }

  getProgress(): number {
    if (this.completed) return 100;
    if (!this.started) return 0;
    if (this.totalFiles <= 0) return 100;
    const ratio = this.processedFiles / this.totalFiles;
    return Math.min(100, Math.max(0, Math.floor(ratio * 100)));
  }

  listenerCount(event: ProgressEvent): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  removeAllListeners(event?: ProgressEvent): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }
}

class ListenerEntry {
  readonly fn: AnyProgressListener;
  readonly once: boolean;
  private readonly original: AnyProgressListener | undefined;

  constructor(
    listener: AnyProgressListener,
    once: boolean,
    onTrigger: () => void,
  ) {
    this.once = once;
    if (once) {
      this.original = listener;
      this.fn = (payload) => {
        onTrigger();
        listener(payload);
      };
    } else {
      this.original = undefined;
      this.fn = listener;
    }
  }

  matches(listener: AnyProgressListener): boolean {
    return this.fn === listener || this.original === listener;
  }
}
