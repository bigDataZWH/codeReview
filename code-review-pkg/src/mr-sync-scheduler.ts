// src/mr-sync-scheduler.ts — MR 同步调度器
// 基于 setInterval 周期性拉取各仓库的 MR 列表，写入内存 store 供路由层读取。
import type { MultiRepoManager } from './multi-repo-manager.js';

/** 调度器状态快照 */
export interface SyncStatus {
  /** 是否正在同步中（syncOnce 执行期间为 true） */
  running: boolean;
  /** 上次同步完成的 ISO 时间戳 */
  lastSyncAt: string | null;
  /** 上次同步的 MR 总数 */
  lastSyncCount: number;
  /** 下次预计同步的 ISO 时间戳（暂停时为 null） */
  nextSyncAt: string | null;
  /** 同步周期（毫秒） */
  syncIntervalMs: number;
  /** 是否处于暂停状态 */
  paused: boolean;
  /** 最近的错误信息（保留最近 20 条） */
  errors: string[];
}

/** 单次同步结果 */
export interface SyncResult {
  /** 同步完成时间戳 */
  syncedAt: string;
  /** 本次同步覆盖的仓库数量 */
  repoCount: number;
  /** 本次同步的 MR 总数 */
  mrCount: number;
  /** 本次同步产生的错误信息 */
  errors: string[];
}

/** 同步后的 MR 列表 store（内存） */
export interface MRSyncStore {
  /** 获取所有仓库或指定仓库的已同步 MR 列表；未同步过返回空数组 */
  getMRs(repoId?: string): any[];
  /** 获取全部（含 repoId 标记） */
  getAll(): Array<{ repoId: string; mr: any }>;
  /** 写入某仓库的 MR 列表（覆盖该仓库） */
  setMRs(repoId: string, mrs: any[]): void;
}

/** MR 同步调度器接口 */
export interface MRSyncScheduler {
  /** 启动定时同步（已启动则不重复） */
  start(): void;
  /** 停止定时同步并重置状态 */
  stop(): void;
  /** 暂停定时触发（running 状态不变） */
  pause(): void;
  /** 恢复定时触发，重算 nextSyncAt */
  resume(): void;
  /** 手动触发一次同步（不影响定时周期） */
  syncOnce(): Promise<SyncResult>;
  /** 获取当前状态快照 */
  getStatus(): SyncStatus;
  /** 获取同步 store（供路由层读取已同步的 MR 列表） */
  getStore(): MRSyncStore;
}

/** 默认同步周期：10 分钟 */
const DEFAULT_SYNC_INTERVAL_MS = 600000;
/** 最小同步周期：1 分钟 */
const MIN_SYNC_INTERVAL_MS = 60000;
/** errors 保留的最大条数 */
const MAX_ERRORS = 20;

/**
 * 创建 MR 同步调度器实例。
 * 使用原生 setInterval/setTimeout，不引入新依赖。
 */
export function createMRSyncScheduler(options: {
  repoManager: MultiRepoManager;
  /** 同步周期，默认 600000ms，低于 60000 强制为 60000 */
  syncIntervalMs?: number;
}): MRSyncScheduler {
  // 同步周期强制下限保护
  const rawInterval = options.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
  const syncIntervalMs = Math.max(rawInterval, MIN_SYNC_INTERVAL_MS);
  const repoManager = options.repoManager;

  // ===== 内存 store：Map<repoId, MR[]> =====
  const storeMap = new Map<string, any[]>();
  const store: MRSyncStore = {
    getMRs(repoId?: string): any[] {
      if (repoId) {
        return storeMap.get(repoId) ?? [];
      }
      // 未指定 repoId 时合并所有仓库的 MR
      const all: any[] = [];
      for (const mrs of storeMap.values()) {
        all.push(...mrs);
      }
      return all;
    },
    getAll(): Array<{ repoId: string; mr: any }> {
      const result: Array<{ repoId: string; mr: any }> = [];
      for (const [rid, mrs] of storeMap.entries()) {
        for (const mr of mrs) {
          result.push({ repoId: rid, mr });
        }
      }
      return result;
    },
    setMRs(repoId: string, mrs: any[]): void {
      storeMap.set(repoId, mrs);
    },
  };

  // ===== 调度器内部状态 =====
  let running = false;
  let lastSyncAt: string | null = null;
  let lastSyncCount = 0;
  let nextSyncAt: string | null = null;
  let paused = false;
  let errors: string[] = [];
  // start() 是否已被调用（用于区分 start 与 pause/resume 语义）
  let started = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  /** 计算下一次同步时间戳 */
  function computeNextSyncAt(): string {
    return new Date(Date.now() + syncIntervalMs).toISOString();
  }

  /** 设置定时器并重算 nextSyncAt */
  function setupInterval(): void {
    if (timer) {
      clearInterval(timer);
    }
    timer = setInterval(() => {
      // 定时触发的同步异常不应中断调度器，仅记录到 errors
      syncOnce().catch((err) => {
        const msg = `[scheduler] 定时同步异常: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        if (errors.length > MAX_ERRORS) {
          errors = errors.slice(errors.length - MAX_ERRORS);
        }
      });
    }, syncIntervalMs);
    nextSyncAt = computeNextSyncAt();
  }

  /** 手动/定时触发一次同步 */
  async function syncOnce(): Promise<SyncResult> {
    running = true;
    const syncedAt = new Date().toISOString();
    const errs: string[] = [];
    let mrCount = 0;
    const repos = repoManager.listRepos();

    for (const repo of repos) {
      // 单仓库失败不中断其他仓库
      try {
        const client = repoManager.getClient(repo.repoId);
        if (!client) {
          // client 为 null（配置无效），记录错误并跳过该仓库
          const msg = `仓库 ${repo.repoId} 配置无效，无法获取 client，已跳过`;
          errs.push(msg);
          continue;
        }
        // 拉取 open 状态 MR，per_page=100
        // getMRList 返回 CodeHubMRListResponse，MR 列表在 .mrs 字段
        const result = await client.getMRList({ state: 'open', perPage: 100 });
        const mrs = result?.mrs ?? [];
        store.setMRs(repo.repoId, mrs);
        mrCount += mrs.length;
      } catch (err) {
        const msg = `仓库 ${repo.repoId} 同步失败: ${err instanceof Error ? err.message : String(err)}`;
        errs.push(msg);
      }
    }

    // 合并本次错误到全局 errors（保留最近 MAX_ERRORS 条）
    if (errs.length > 0) {
      errors = errors.concat(errs);
      if (errors.length > MAX_ERRORS) {
        errors = errors.slice(errors.length - MAX_ERRORS);
      }
    }

    // 更新状态
    lastSyncAt = syncedAt;
    lastSyncCount = mrCount;
    if (!paused) {
      nextSyncAt = computeNextSyncAt();
    } else {
      nextSyncAt = null;
    }
    running = false;

    return {
      syncedAt,
      repoCount: repos.length,
      mrCount,
      errors: errs,
    };
  }

  function start(): void {
    // 若已启动则不重复
    if (started) return;
    started = true;
    // 若处于暂停状态，则不实际启动定时器（但记录应启动）
    if (!paused) {
      setupInterval();
    }
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    started = false;
    paused = false;
    nextSyncAt = null;
  }

  function pause(): void {
    paused = true;
    // 停止定时触发，但 running 状态不变
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    nextSyncAt = null;
  }

  function resume(): void {
    paused = false;
    // 仅在已 start 的情况下重新启动定时器
    if (started) {
      setupInterval();
    }
  }

  function getStatus(): SyncStatus {
    return {
      running,
      lastSyncAt,
      lastSyncCount,
      nextSyncAt,
      syncIntervalMs,
      paused,
      errors: [...errors],
    };
  }

  return {
    start,
    stop,
    pause,
    resume,
    syncOnce,
    getStatus,
    getStore: () => store,
  };
}
