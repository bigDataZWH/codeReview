// src/audit-logger.ts — Task 11：审计日志
//
// 职责：
// 1. AuditLogger 类：记录用户操作（命令、参数、findings）到内存与磁盘
// 2. logAction：便捷函数，记录一条审计日志
// 3. getAuditLog：便捷函数，按条件查询审计日志
//
// 设计取舍：
// - 审计日志采用 append-only 模式，写入后不可修改（保证可追溯性）
// - 每条日志包含：id / timestamp / user / action / args / findings / result / metadata
// - 持久化以 JSON Lines 格式存储（每行一条），便于追加写入与流式读取
// - 内存中保留最近 N 条日志，便于快速查询；查询超出范围时回退到磁盘
//
// 与 cli.ts 集成：
// - 在每个命令执行前后调用 audit.logAction 记录审计日志
// - 通过 audit 命令查询历史审计日志

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Finding } from './types.js';

/** 默认审计日志文件名 */
export const DEFAULT_AUDIT_LOG_FILE = '.code-review-audit.log';

/** 默认内存缓存上限 */
export const DEFAULT_AUDIT_HISTORY_LIMIT = 1000;

/** 审计日志条目 */
export interface AuditLogEntry {
  /** 唯一日志 ID（自动生成） */
  id: string;
  /** 时间戳（ms） */
  timestamp: number;
  /** 执行用户（未指定时为 'anonymous'） */
  user: string;
  /** 用户角色（可选） */
  role?: string;
  /** 执行的命令（如 'review' / 'rules disable'） */
  action: string;
  /** 命令参数（args 数组） */
  args: string[];
  /** 执行结果（'success' / 'failure' / 'denied'） */
  result: AuditResult;
  /** 执行耗时（ms，可选） */
  durationMs?: number;
  /** 关联的 findings（可选，仅在审查类命令中填充） */
  findings?: Finding[];
  /** findings 数量（findings 字段为空时仍可记录数量） */
  findingsCount?: number;
  /** 错误信息（result 为 failure/denied 时填充） */
  error?: string;
  /** 额外元数据（如 PR 编号、规则 ID 等） */
  metadata?: Record<string, unknown>;
}

/** 审计结果类型 */
export type AuditResult = 'success' | 'failure' | 'denied';

/** 审计日志查询条件 */
export interface AuditQueryOptions {
  /** 按用户过滤 */
  user?: string;
  /** 按 action 过滤（精确匹配） */
  action?: string;
  /** 按 action 前缀过滤（如 'rules' 匹配 'rules list' / 'rules disable' 等） */
  actionPrefix?: string;
  /** 按结果过滤 */
  result?: AuditResult;
  /** 起始时间戳（ms，包含） */
  fromTimestamp?: number;
  /** 结束时间戳（ms，不包含） */
  toTimestamp?: number;
  /** 限制返回条数（默认 100） */
  limit?: number;
  /** 是否从磁盘读取（默认仅读内存缓存） */
  fromDisk?: boolean;
}

/**
 * 审计日志记录器。
 *
 * 使用方式：
 * 1. const logger = new AuditLogger() — 内存模式
 * 2. logger.logAction({ user: 'alice', action: 'review', args: ['--incremental'], result: 'success' })
 * 3. logger.query({ user: 'alice' }) — 查询
 * 4. const logger2 = AuditLogger.loadFromFile(path) — 从磁盘加载历史
 * 5. logger2.persist(path) — 持久化新增日志
 */
export class AuditLogger {
  /** 内存中的日志缓存（按时间倒序，最新在前） */
  private entries: AuditLogEntry[] = [];
  /** 自增 ID 计数器 */
  private seqCounter = 0;
  /** 内存缓存上限 */
  private readonly historyLimit: number;
  /** 当前持久化文件路径（可选） */
  private filePath: string | undefined;
  /** 已持久化的最大日志 ID（避免重复写入磁盘） */
  private persistedIds: Set<string> = new Set();

  constructor(options?: {
    historyLimit?: number;
    filePath?: string;
    initialEntries?: AuditLogEntry[];
  }) {
    this.historyLimit = options?.historyLimit ?? DEFAULT_AUDIT_HISTORY_LIMIT;
    this.filePath = options?.filePath;
    if (options?.initialEntries) {
      for (const entry of options.initialEntries) {
        this.entries.push({ ...entry });
        this.persistedIds.add(entry.id);
      }
      // 倒序：最新在前
      this.entries.sort((a, b) => b.timestamp - a.timestamp);
      // 截断至 historyLimit
      if (this.entries.length > this.historyLimit) {
        this.entries = this.entries.slice(0, this.historyLimit);
      }
    }
  }

  /**
   * 记录一条审计日志。
   *
   * - 自动生成 id 与 timestamp
   * - 若设置了 filePath，则自动追加写入磁盘（JSON Lines）
   * - 自动填充 findingsCount（当 findings 非空时）
   *
   * @param entry 日志字段（id/timestamp 可选，自动生成）
   * @returns 完整的日志条目
   */
  logAction(entry: Omit<AuditLogEntry, 'id' | 'timestamp'> & Partial<Pick<AuditLogEntry, 'timestamp'>>): AuditLogEntry {
    const fullEntry: AuditLogEntry = {
      id: this.generateId(),
      timestamp: entry.timestamp ?? Date.now(),
      user: entry.user || 'anonymous',
      role: entry.role,
      action: entry.action,
      args: entry.args ?? [],
      result: entry.result,
      durationMs: entry.durationMs,
      findings: entry.findings,
      findingsCount: entry.findingsCount ?? entry.findings?.length,
      error: entry.error,
      metadata: entry.metadata,
    };

    // 写入内存（最新在前）
    this.entries.unshift(fullEntry);
    if (this.entries.length > this.historyLimit) {
      this.entries.length = this.historyLimit;
    }

    // 写入磁盘
    if (this.filePath) {
      this.appendToFile(this.filePath, fullEntry);
      this.persistedIds.add(fullEntry.id);
    }

    return { ...fullEntry };
  }

  /**
   * 查询审计日志。
   *
   * - 默认仅查询内存缓存；如需查询磁盘历史，设置 fromDisk=true
   * - 返回的日志按时间倒序（最新在前）
   *
   * @param options 查询条件
   * @returns 匹配的日志条目数组
   */
  query(options: AuditQueryOptions = {}): AuditLogEntry[] {
    const limit = options.limit ?? 100;
    let source: AuditLogEntry[];

    if (options.fromDisk && this.filePath) {
      source = readAuditLogFile(this.filePath);
    } else {
      source = this.entries;
    }

    const filtered = source.filter((e) => {
      if (options.user && e.user !== options.user) return false;
      if (options.action && e.action !== options.action) return false;
      if (options.actionPrefix && !e.action.startsWith(options.actionPrefix)) return false;
      if (options.result && e.result !== options.result) return false;
      if (options.fromTimestamp && e.timestamp < options.fromTimestamp) return false;
      if (options.toTimestamp && e.timestamp >= options.toTimestamp) return false;
      return true;
    });

    return filtered.slice(0, limit).map((e) => ({ ...e }));
  }

  /** 返回内存中的全部日志（按时间倒序） */
  getAll(): AuditLogEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  /** 返回日志总数（内存中） */
  size(): number {
    return this.entries.length;
  }

  /** 清空内存缓存（不影响磁盘） */
  clear(): void {
    this.entries = [];
  }

  /**
   * 将当前内存中的所有日志写入磁盘文件（覆盖写入）。
   *
   * @param filePath 文件路径（默认使用构造器传入的路径）
   */
  persist(filePath?: string): void {
    const path = filePath ?? this.filePath;
    if (!path) {
      throw new Error('no file path provided for persistence');
    }
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    // 倒序写入磁盘（与内存顺序一致：最新在前）
    const lines = this.entries
      .slice()
      .reverse() // 写入时按时间正序（旧 → 新），便于阅读
      .map((e) => JSON.stringify(e))
      .join('\n');
    writeFileSync(path, lines + (lines ? '\n' : ''), 'utf-8');
    // 标记所有日志已持久化
    for (const e of this.entries) {
      this.persistedIds.add(e.id);
    }
    this.filePath = path;
  }

  /** 追加单条日志到磁盘（JSON Lines） */
  private appendToFile(filePath: string, entry: AuditLogEntry): void {
    try {
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err) {
      // 磁盘写入失败不影响内存日志
      console.warn(
        '[audit] failed to append audit log to disk:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** 生成唯一日志 ID */
  private generateId(): string {
    this.seqCounter += 1;
    return `audit-${Date.now().toString(36)}-${this.seqCounter.toString(36)}`;
  }

  /**
   * 从磁盘加载历史日志（构造新实例）。
   *
   * 文件不存在或解析失败时返回空实例。
   *
   * @param filePath 文件路径
   * @param options 可选配置（historyLimit）
   */
  static loadFromFile(
    filePath: string,
    options?: { historyLimit?: number },
  ): AuditLogger {
    const entries = readAuditLogFile(filePath);
    return new AuditLogger({
      historyLimit: options?.historyLimit,
      filePath,
      initialEntries: entries,
    });
  }
}

/**
 * 从磁盘读取审计日志文件（JSON Lines 格式）。
 *
 * 每行一条 JSON；解析失败的行跳过。
 *
 * @param filePath 文件路径
 * @returns 日志条目数组（按时间倒序，最新在前）
 */
export function readAuditLogFile(filePath: string): AuditLogEntry[] {
  if (!filePath || !existsSync(filePath)) {
    return [];
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    const entries: AuditLogEntry[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as AuditLogEntry;
        if (parsed && typeof parsed.id === 'string' && typeof parsed.timestamp === 'number') {
          entries.push(parsed);
        }
      } catch {
        // 跳过解析失败的行
      }
    }
    // 时间倒序：最新在前
    entries.sort((a, b) => b.timestamp - a.timestamp);
    return entries;
  } catch {
    return [];
  }
}

/**
 * 便捷函数：使用默认 AuditLogger 记录一条审计日志。
 *
 * @param entry 日志字段（id/timestamp 可选，自动生成）
 * @param logger 审计日志记录器（可选，默认新建一个空实例）
 * @returns 完整的日志条目
 */
export function logAction(
  entry: Omit<AuditLogEntry, 'id' | 'timestamp'> & Partial<Pick<AuditLogEntry, 'timestamp'>>,
  logger?: AuditLogger,
): AuditLogEntry {
  const l = logger ?? new AuditLogger();
  return l.logAction(entry);
}

/**
 * 便捷函数：从磁盘加载审计日志并按条件查询。
 *
 * @param options 查询条件（需指定 filePath 才会从磁盘读取）
 * @returns 匹配的日志条目数组
 */
export function getAuditLog(options: AuditQueryOptions & { filePath?: string }): AuditLogEntry[] {
  const filePath = options.filePath;
  if (!filePath) {
    // 未提供文件路径时返回空数组
    return [];
  }
  const logger = AuditLogger.loadFromFile(filePath);
  return logger.query({ ...options, fromDisk: true });
}
