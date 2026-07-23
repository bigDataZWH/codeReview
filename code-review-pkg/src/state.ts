// src/state.ts — 状态与数据层：会话状态机、findings 持久化、断点续审、历史趋势
//
// 设计取舍：避免原生依赖（better-sqlite3 等）带来的安装/编译问题，
// 使用纯 TypeScript 实现一个轻量级存储：默认内存 Map，可选 JSON 文件持久化。
// 接口与未来切换到 SQLite 的实现保持一致，便于平滑替换。

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Finding, Severity } from './types.js';

/** 会话状态枚举 */
export type SessionStatus = 'pending' | 'running' | 'completed' | 'failed';

/** 合法的状态转换映射：from -> 允许转入的 to 列表 */
const VALID_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  pending: ['running', 'failed'],
  running: ['completed', 'failed'],
  completed: [],
  failed: [],
};

/** 创建会话参数 */
export interface CreateSessionOptions {
  /** 会话唯一 ID */
  id: string;
  /** 待处理文件总数 */
  filesTotal: number;
  /** 创建时间戳（可选，默认 Date.now()） */
  createdAt?: number;
  /** 仓库信息（可选） */
  repo?: string;
  /** PR 编号（可选） */
  prNumber?: number;
  /** 提交 SHA（可选） */
  commitSha?: string;
}

/** 会话记录 */
export interface Session {
  id: string;
  status: SessionStatus;
  filesTotal: number;
  filesProcessed: number;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  error?: string;
  repo?: string;
  prNumber?: number;
  commitSha?: string;
}

/** 趋势统计结果 */
export interface TrendStats {
  totalSessions: number;
  completedSessions: number;
  failedSessions: number;
  runningSessions: number;
  pendingSessions: number;
  totalFindings: number;
  avgFindingsPerSession: number;
  bySeverity: Record<Severity | 'info', number>;
  byCategory: Record<string, number>;
}

/** 度量指标摘要（迭代 10）—— 与 TrendStats 结构一致，保留别名以兼容公共 API */
export type MetricsSummary = TrendStats;

/** 查询会话过滤选项 */
export interface ListSessionsFilter {
  status?: SessionStatus;
}

/** 续审选项 */
export interface ResumeOptions {
  /** 可恢复状态集合，默认 ['pending', 'running'] */
  recoverableStatuses?: SessionStatus[];
}

/** getFindingsByFile 的查询选项 */
export interface FindingsByFileOptions {
  /** 跨所有会话查询（忽略 sessionId 参数） */
  allSessions?: boolean;
}

/** 趋势统计选项 */
export interface TrendStatsOptions {
  /** 仅统计创建时间 >= since 的会话 */
  since?: number;
}

/** StateStore 构造选项 */
export interface StateStoreOptions {
  /** 持久化文件路径（空字符串或 undefined 表示纯内存模式） */
  persistFile?: string;
  /** 是否在每次写操作后自动落盘（默认 true） */
  autoFlush?: boolean;
}

/** 序列化到磁盘的格式 */
interface PersistShape {
  version: 1;
  sessions: Session[];
  findings: Array<{ sessionId: string; finding: Finding }>;
}

const SEVERITY_KEYS: (Severity | 'info')[] = ['critical', 'high', 'medium', 'low', 'info'];

function createEmptyBySeverity(): Record<Severity | 'info', number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

/**
 * 状态存储：管理会话状态机、findings 持久化、断点续审、历史趋势统计。
 *
 * 默认为内存模式；当传入 `persistFile` 时启用 JSON 文件持久化：
 * - 实例化时若文件存在，自动加载
 * - 写操作根据 `autoFlush` 决定是否立即落盘
 * - 显式调用 `flush()` 强制写入
 */
export class StateStore {
  private sessions: Map<string, Session> = new Map();
  /** 会话创建顺序：用于 createdAt 相等时的稳定排序 tiebreaker */
  private sessionSeq: Map<string, number> = new Map();
  private findings: Array<{ sessionId: string; finding: Finding }> = [];
  private readonly persistFile?: string;
  private readonly autoFlush: boolean;
  private closed = false;
  private seqCounter = 0;

  constructor(options: StateStoreOptions = {}) {
    this.persistFile = options.persistFile && options.persistFile.length > 0 ? options.persistFile : undefined;
    this.autoFlush = options.autoFlush !== false;
    if (this.persistFile) {
      this.loadFromDisk();
    }
  }

  /** 是否启用持久化模式 */
  isPersistent(): boolean {
    return this.persistFile !== undefined;
  }

  /** 从磁盘加载历史数据 */
  private loadFromDisk(): void {
    if (!this.persistFile) return;
    if (!existsSync(this.persistFile)) return;
    try {
      const raw = readFileSync(this.persistFile, 'utf8');
      const data = JSON.parse(raw) as PersistShape;
      if (data && typeof data === 'object') {
        const sessions = data.sessions ?? [];
        this.sessions = new Map(sessions.map((s) => [s.id, s] as const));
        // 按 createdAt 升序回填 seq，保证多次加载后顺序稳定
        const sorted = [...sessions].sort((a, b) => a.createdAt - b.createdAt);
        this.sessionSeq = new Map();
        let i = 0;
        for (const s of sorted) {
          this.sessionSeq.set(s.id, i++);
        }
        this.seqCounter = i;
        this.findings = Array.isArray(data.findings) ? data.findings : [];
      }
    } catch (err) {
      // 文件损坏时静默回退到空状态
      console.warn('[state] loadFromDisk failed to parse persist file, falling back to empty state:', err);
      this.sessions = new Map();
      this.sessionSeq = new Map();
      this.findings = [];
    }
  }

  /** 强制把当前内存数据落盘 */
  flush(): void {
    if (!this.persistFile) return;
    const dir = dirname(this.persistFile);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const payload: PersistShape = {
      version: 1,
      sessions: Array.from(this.sessions.values()),
      findings: this.findings,
    };
    writeFileSync(this.persistFile, JSON.stringify(payload, null, 2), 'utf8');
  }

  /** 写操作后若启用 autoFlush 则自动落盘 */
  private maybeFlush(): void {
    if (this.persistFile && this.autoFlush) {
      this.flush();
    }
  }

  /** 关闭存储：清空内存数据并落盘（如启用持久化） */
  close(): void {
    if (this.closed) return;
    this.maybeFlush();
    this.sessions.clear();
    this.sessionSeq.clear();
    this.findings = [];
    this.closed = true;
  }

  /**
   * 创建新会话。
   * @throws 当 ID 已存在时抛出错误
   * @throws 当 filesTotal 为负数时抛出错误
   */
  createSession(options: CreateSessionOptions): Session {
    if (this.sessions.has(options.id)) {
      throw new Error(`Session with id "${options.id}" already exists`);
    }
    if (options.filesTotal < 0) {
      throw new Error(`filesTotal must be non-negative, got ${options.filesTotal}`);
    }
    const now = options.createdAt ?? Date.now();
    const session: Session = {
      id: options.id,
      status: 'pending',
      filesTotal: options.filesTotal,
      filesProcessed: 0,
      createdAt: now,
      updatedAt: now,
      repo: options.repo,
      prNumber: options.prNumber,
      commitSha: options.commitSha,
    };
    this.sessions.set(session.id, session);
    this.sessionSeq.set(session.id, this.seqCounter++);
    this.maybeFlush();
    return { ...session };
  }

  /** 获取会话，不存在返回 null */
  getSession(id: string): Session | null {
    const s = this.sessions.get(id);
    return s ? { ...s } : null;
  }

  /**
   * 更新会话状态。受状态机约束：
   * - pending → running / failed
   * - running → completed / failed
   * - completed / failed 为终态
   * @returns 更新后的会话；不存在返回 null
   * @throws 当状态转换非法时抛出错误
   */
  updateSessionStatus(id: string, status: SessionStatus, error?: string): Session | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    if (!VALID_TRANSITIONS[s.status].includes(status)) {
      throw new Error(`invalid session status transition: ${s.status} -> ${status}`);
    }
    s.status = status;
    s.updatedAt = Date.now();
    if (status === 'completed' || status === 'failed') {
      s.finishedAt = s.updatedAt;
      if (status === 'failed' && error !== undefined) {
        s.error = error;
      }
    }
    this.maybeFlush();
    return { ...s };
  }

  /**
   * 累加已处理文件数。
   * @returns 更新后的会话；不存在返回 null
   * @throws 当 count 为负数时抛出错误
   */
  incrementFilesProcessed(id: string, count: number = 1): Session | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    if (count < 0) {
      throw new Error(`count must be non-negative, got ${count}`);
    }
    s.filesProcessed += count;
    s.updatedAt = Date.now();
    this.maybeFlush();
    return { ...s };
  }

  /** 列出会话，可按状态过滤；默认按 createdAt 倒序，createdAt 相等时按插入顺序倒序 */
  listSessions(filter?: ListSessionsFilter): Session[] {
    let list = Array.from(this.sessions.values());
    if (filter?.status) {
      list = list.filter((s) => s.status === filter.status);
    }
    this.sortSessionsByCreatedAtDesc(list);
    return list.map((s) => ({ ...s }));
  }

  /** 按 createdAt 倒序排序，createdAt 相等时按插入顺序倒序 */
  private sortSessionsByCreatedAtDesc(sessions: Session[]): void {
    sessions.sort((a, b) => {
      if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
      const sa = this.sessionSeq.get(a.id) ?? 0;
      const sb = this.sessionSeq.get(b.id) ?? 0;
      return sb - sa;
    });
  }

  /** 按 createdAt 升序排序，createdAt 相等时按插入顺序升序 */
  private sortSessionsByCreatedAtAsc(sessions: Session[]): void {
    sessions.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      const sa = this.sessionSeq.get(a.id) ?? 0;
      const sb = this.sessionSeq.get(b.id) ?? 0;
      return sa - sb;
    });
  }

  /** 删除会话及其关联 findings；返回是否实际删除 */
  deleteSession(id: string): boolean {
    const existed = this.sessions.delete(id);
    if (existed) {
      this.sessionSeq.delete(id);
      this.findings = this.findings.filter((f) => f.sessionId !== id);
      this.maybeFlush();
    }
    return existed;
  }

  /**
   * 保存 findings 到指定会话（追加而非覆盖）。
   * @returns 实际保存的条数
   * @throws 当会话不存在时抛出错误
   */
  saveFindings(sessionId: string, findings: Finding[]): number {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Session "${sessionId}" not found`);
    }
    if (!Array.isArray(findings) || findings.length === 0) {
      return 0;
    }
    const toAdd = findings.map((f) => ({ sessionId, finding: { ...f } }));
    this.findings.push(...toAdd);
    const s = this.sessions.get(sessionId)!;
    s.updatedAt = Date.now();
    this.maybeFlush();
    return findings.length;
  }

  /** 获取指定会话的所有 findings */
  getFindingsBySession(sessionId: string): Finding[] {
    if (!this.sessions.has(sessionId)) return [];
    return this.findings
      .filter((f) => f.sessionId === sessionId)
      .map((f) => ({ ...f.finding }));
  }

  /**
   * 按文件路径查询 findings。
   * - 默认在指定 sessionId 下查询
   * - 当 `opts.allSessions = true` 时跨所有会话查询，此时 `sessionIdOrFile` 参数被当作 file 路径处理
   */
  getFindingsByFile(
    sessionIdOrFile: string,
    file?: string,
    opts?: FindingsByFileOptions,
  ): Finding[] {
    if (opts?.allSessions) {
      const targetFile = sessionIdOrFile;
      return this.findings
        .filter((f) => f.finding.file === targetFile)
        .map((f) => ({ ...f.finding }));
    }
    const sessionId = sessionIdOrFile;
    const targetFile = file!;
    if (!sessionId || !targetFile) return [];
    if (!this.sessions.has(sessionId)) return [];
    return this.findings
      .filter((f) => f.sessionId === sessionId && f.finding.file === targetFile)
      .map((f) => ({ ...f.finding }));
  }

  /**
   * 获取可恢复的中断会话（默认状态为 pending 或 running）。
   * 按 createdAt 升序返回，createdAt 相等时按插入顺序升序。
   */
  resumeInterruptedSessions(opts?: ResumeOptions): Session[] {
    const recoverable: SessionStatus[] = opts?.recoverableStatuses ?? ['pending', 'running'];
    const list = Array.from(this.sessions.values()).filter((s) => recoverable.includes(s.status));
    this.sortSessionsByCreatedAtAsc(list);
    return list.map((s) => ({ ...s }));
  }

  /** 历史趋势统计 */
  getTrendStats(opts?: TrendStatsOptions): TrendStats {
    return this.computeStats(opts?.since ?? 0);
  }

  /** 重置模块级默认实例（仅用于测试） */
  resetDefault(): void {
    defaultStore = new StateStore();
  }

  /**
   * 返回度量指标摘要：会话总数、findings 总数、严重度/类别分布、平均值。
   *
   * @param opts 选项（since: 仅统计 createdAt >= since 的会话）
   * @returns 摘要对象
   */
  getMetricsSummary(opts?: { since?: number }): MetricsSummary {
    return this.computeStats(opts?.since ?? 0);
  }

  /** 内部通用统计方法：供 getTrendStats 和 getMetricsSummary 共享 */
  private computeStats(since: number): TrendStats {
    const sessions = Array.from(this.sessions.values()).filter((s) => s.createdAt >= since);
    const sessionIds = new Set(sessions.map((s) => s.id));
    const findings = this.findings.filter((f) => sessionIds.has(f.sessionId));

    const bySeverity = createEmptyBySeverity();
    const byCategory: Record<string, number> = {};
    for (const { finding } of findings) {
      const sev = (finding.severity as Severity | 'info') ?? 'info';
      if (SEVERITY_KEYS.includes(sev)) {
        bySeverity[sev]++;
      }
      const cat = finding.category ?? 'unknown';
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }

    let completedSessions = 0;
    let failedSessions = 0;
    let runningSessions = 0;
    let pendingSessions = 0;
    for (const s of sessions) {
      switch (s.status) {
        case 'completed':
          completedSessions++;
          break;
        case 'failed':
          failedSessions++;
          break;
        case 'running':
          runningSessions++;
          break;
        case 'pending':
          pendingSessions++;
          break;
      }
    }

    const totalFindings = findings.length;
    const avgFindingsPerSession = completedSessions > 0
      ? totalFindings / completedSessions
      : 0;

    return {
      totalSessions: sessions.length,
      completedSessions,
      failedSessions,
      runningSessions,
      pendingSessions,
      totalFindings,
      avgFindingsPerSession,
      bySeverity,
      byCategory,
    };
  }
}

// ==================== 模块级默认实例 API ====================

let defaultStore = new StateStore();

/** 创建会话（使用默认实例） */
export function createSession(options: CreateSessionOptions): Session {
  return defaultStore.createSession(options);
}

/** 获取会话（使用默认实例） */
export function getSession(id: string): Session | null {
  return defaultStore.getSession(id);
}

/** 更新会话状态（使用默认实例） */
export function updateSessionStatus(
  id: string,
  status: SessionStatus,
  error?: string,
): Session | null {
  return defaultStore.updateSessionStatus(id, status, error);
}

/** 列出会话（使用默认实例） */
export function listSessions(filter?: ListSessionsFilter): Session[] {
  return defaultStore.listSessions(filter);
}

/** 保存 findings（使用默认实例） */
export function saveFindings(sessionId: string, findings: Finding[]): number {
  return defaultStore.saveFindings(sessionId, findings);
}

/** 获取会话内所有 findings（使用默认实例） */
export function getFindingsBySession(sessionId: string): Finding[] {
  return defaultStore.getFindingsBySession(sessionId);
}

/** 按文件查询 findings（使用默认实例） */
export function getFindingsByFile(
  sessionIdOrFile: string,
  file?: string,
  opts?: FindingsByFileOptions,
): Finding[] {
  return defaultStore.getFindingsByFile(sessionIdOrFile, file, opts);
}

/** 获取可恢复的中断会话（使用默认实例） */
export function resumeInterruptedSessions(opts?: ResumeOptions): Session[] {
  return defaultStore.resumeInterruptedSessions(opts);
}

/** 历史趋势统计（使用默认实例） */
export function getTrendStats(opts?: TrendStatsOptions): TrendStats {
  return defaultStore.getTrendStats(opts);
}

/** 度量指标摘要（使用默认实例，迭代 10） */
export function getMetricsSummary(opts?: { since?: number }): MetricsSummary {
  return defaultStore.getMetricsSummary(opts);
}
