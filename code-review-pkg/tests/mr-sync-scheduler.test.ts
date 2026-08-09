// tests/mr-sync-scheduler.test.ts
// Task 19.1：mr-sync-scheduler.ts 单元测试
// 使用 fake timers + mock multi-repo-manager 测试 start/stop/pause/resume/syncOnce/getStatus/getStore

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMRSyncScheduler } from '../src/mr-sync-scheduler.js';
import type { MRSyncScheduler } from '../src/mr-sync-scheduler.js';
import type { MultiRepoManager } from '../src/multi-repo-manager.js';
import type { CodeHubClient } from '../src/codehub-client.js';
import type { CodeHubMRListResponse, RepoConfig } from '../src/types.js';

// ==================== 辅助构造函数 ====================

/** 构造一个仓库配置 */
function makeRepo(overrides: Partial<RepoConfig> = {}): RepoConfig {
  return {
    repoId: overrides.repoId ?? 'repo-1',
    name: overrides.name ?? 'Repo 1',
    baseUrl: overrides.baseUrl ?? 'http://mock',
    token: overrides.token ?? 'token',
    projectId: overrides.projectId ?? 1,
    ...overrides,
  };
}

/** 构造一个 mock CodeHubClient，getMRList 返回固定 MR 列表 */
function makeMockClient(mrs: Array<{ iid: number; title: string }> = [
  { iid: 1, title: 'MR 1' },
  { iid: 2, title: 'MR 2' },
]): Partial<CodeHubClient> {
  return {
    getMRList: vi.fn().mockResolvedValue({
      mrs,
      total: mrs.length,
      page: 1,
      perPage: 100,
      totalPages: 1,
    } as CodeHubMRListResponse),
  };
}

// ==================== 测试主体 ====================

describe('createMRSyncScheduler', () => {
  let scheduler: MRSyncScheduler;
  let mockRepoManager: Partial<MultiRepoManager>;
  let mockClient: Partial<CodeHubClient>;

  beforeEach(() => {
    // 使用 fake timers（同时冻结 Date.now）
    vi.useFakeTimers();

    mockClient = makeMockClient();

    mockRepoManager = {
      listRepos: vi.fn().mockReturnValue([
        makeRepo({ repoId: 'repo-1', name: 'Repo 1' }),
        makeRepo({ repoId: 'repo-2', name: 'Repo 2', projectId: 2 }),
      ]),
      getClient: vi.fn().mockReturnValue(mockClient as CodeHubClient),
    };

    scheduler = createMRSyncScheduler({
      repoManager: mockRepoManager as MultiRepoManager,
      syncIntervalMs: 60000,
    });
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
  });

  // ==================== syncIntervalMs 下限保护 ====================

  describe('syncIntervalMs 下限保护', () => {
    it('低于 60000 的值被强制为 60000', () => {
      const s = createMRSyncScheduler({
        repoManager: mockRepoManager as MultiRepoManager,
        syncIntervalMs: 100,
      });
      expect(s.getStatus().syncIntervalMs).toBe(60000);
      s.stop();
    });

    it('未传 syncIntervalMs 时默认 600000', () => {
      const s = createMRSyncScheduler({
        repoManager: mockRepoManager as MultiRepoManager,
      });
      expect(s.getStatus().syncIntervalMs).toBe(600000);
      s.stop();
    });
  });

  // ==================== start / stop ====================

  describe('start / stop', () => {
    it('start 后 nextSyncAt 非 null，paused 为 false', () => {
      expect(scheduler.getStatus().nextSyncAt).toBeNull();

      scheduler.start();
      const status = scheduler.getStatus();
      expect(status.paused).toBe(false);
      expect(status.nextSyncAt).toBeTruthy();
      // nextSyncAt = Date.now() + 60000
      expect(new Date(status.nextSyncAt!).getTime()).toBe(Date.now() + 60000);
    });

    it('stop 后 nextSyncAt 为 null，状态重置', () => {
      scheduler.start();
      expect(scheduler.getStatus().nextSyncAt).toBeTruthy();

      scheduler.stop();
      const status = scheduler.getStatus();
      expect(status.nextSyncAt).toBeNull();
      expect(status.paused).toBe(false);
      expect(status.running).toBe(false);
    });

    it('重复 start 不重复启动（幂等）', () => {
      scheduler.start();
      const next1 = scheduler.getStatus().nextSyncAt;

      // 再次 start 不应改变 nextSyncAt（未触发新同步周期）
      scheduler.start();
      const next2 = scheduler.getStatus().nextSyncAt;

      expect(next2).toBe(next1);
    });
  });

  // ==================== pause / resume ====================

  describe('pause / resume', () => {
    it('pause 后 nextSyncAt 为 null，paused 为 true', () => {
      scheduler.start();
      expect(scheduler.getStatus().paused).toBe(false);
      expect(scheduler.getStatus().nextSyncAt).toBeTruthy();

      scheduler.pause();
      expect(scheduler.getStatus().paused).toBe(true);
      expect(scheduler.getStatus().nextSyncAt).toBeNull();
    });

    it('resume 后 nextSyncAt 重新计算，paused 为 false', () => {
      scheduler.start();
      scheduler.pause();
      expect(scheduler.getStatus().paused).toBe(true);
      expect(scheduler.getStatus().nextSyncAt).toBeNull();

      // 快进时间后恢复
      vi.advanceTimersByTime(50);
      scheduler.resume();
      const status = scheduler.getStatus();
      expect(status.paused).toBe(false);
      expect(status.nextSyncAt).toBeTruthy();
      // nextSyncAt = 当前时间 + 60000
      expect(new Date(status.nextSyncAt!).getTime()).toBe(Date.now() + 60000);
    });

    it('未 start 时 resume 不启动定时器（nextSyncAt 仍为 null）', () => {
      // 未调用 start，直接 resume
      scheduler.resume();
      expect(scheduler.getStatus().nextSyncAt).toBeNull();
      expect(scheduler.getStatus().paused).toBe(false);
    });
  });

  // ==================== syncOnce ====================

  describe('syncOnce', () => {
    it('手动同步返回正确结果（repoCount / mrCount）', async () => {
      const result = await scheduler.syncOnce();
      expect(result.repoCount).toBe(2); // 2 个仓库
      expect(result.mrCount).toBe(4); // 每个仓库 2 个 MR，共 4 个
      expect(result.syncedAt).toBe(new Date().toISOString());
      expect(result.errors).toEqual([]);
    });

    it('同步后状态更新（lastSyncAt / lastSyncCount）', async () => {
      const result = await scheduler.syncOnce();
      const status = scheduler.getStatus();
      expect(status.lastSyncAt).toBe(result.syncedAt);
      expect(status.lastSyncCount).toBe(4);
      expect(status.running).toBe(false);
    });

    it('同步后 store 包含 MR 数据', async () => {
      await scheduler.syncOnce();
      const store = scheduler.getStore();
      // repo-1 有 2 个 MR
      expect(store.getMRs('repo-1')).toHaveLength(2);
      // repo-2 有 2 个 MR
      expect(store.getMRs('repo-2')).toHaveLength(2);
      // 合并全部共 4 个
      expect(store.getMRs()).toHaveLength(4);
    });

    it('某仓库同步失败不中断其他仓库', async () => {
      // repo-1 的 client 抛错，repo-2 正常
      const failingClient: Partial<CodeHubClient> = {
        getMRList: vi.fn().mockRejectedValue(new Error('Network error')),
      };
      const okClient = makeMockClient([{ iid: 1, title: 'MR 1' }]);
      (mockRepoManager.getClient as vi.Mock).mockImplementation((repoId: string) => {
        if (repoId === 'repo-1') return failingClient as CodeHubClient;
        return okClient as CodeHubClient;
      });

      const result = await scheduler.syncOnce();
      expect(result.repoCount).toBe(2);
      expect(result.mrCount).toBe(1); // 仅 repo-2 成功返回 1 个 MR
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('repo-1');
      expect(result.errors[0]).toContain('Network error');

      // 错误被记录到全局状态
      const status = scheduler.getStatus();
      expect(status.errors).toHaveLength(1);
      expect(status.errors[0]).toContain('repo-1');
    });

    it('getClient 返回 null 时记录错误并跳过该仓库', async () => {
      (mockRepoManager.getClient as vi.Mock).mockReturnValue(null);

      const result = await scheduler.syncOnce();
      expect(result.repoCount).toBe(2);
      expect(result.mrCount).toBe(0);
      expect(result.errors).toHaveLength(2); // 2 个仓库都跳过
      expect(result.errors[0]).toContain('配置无效');
      expect(result.errors[0]).toContain('repo-1');
    });

    it('getMRList 返回空 MR 列表时 mrCount 为 0', async () => {
      const emptyClient = makeMockClient([]);
      (mockRepoManager.getClient as vi.Mock).mockReturnValue(emptyClient as CodeHubClient);

      const result = await scheduler.syncOnce();
      expect(result.repoCount).toBe(2);
      expect(result.mrCount).toBe(0);
      expect(result.errors).toEqual([]);
    });
  });

  // ==================== getStatus ====================

  describe('getStatus', () => {
    it('初始状态正确（未同步未启动）', () => {
      const status = scheduler.getStatus();
      expect(status.syncIntervalMs).toBe(60000);
      expect(status.paused).toBe(false);
      expect(status.running).toBe(false);
      expect(status.lastSyncAt).toBeNull();
      expect(status.lastSyncCount).toBe(0);
      expect(status.nextSyncAt).toBeNull();
      expect(Array.isArray(status.errors)).toBe(true);
      expect(status.errors).toHaveLength(0);
    });

    it('返回的 errors 数组为副本（修改不影响内部状态）', async () => {
      // 触发一次错误
      (mockRepoManager.getClient as vi.Mock).mockReturnValue(null);
      await scheduler.syncOnce();

      const status1 = scheduler.getStatus();
      expect(status1.errors).toHaveLength(2);

      // 修改副本
      status1.errors.push('injected error');
      status1.errors.length = 0;

      // 内部状态不受影响
      const status2 = scheduler.getStatus();
      expect(status2.errors).toHaveLength(2);
    });
  });

  // ==================== 定时同步 ====================

  describe('定时同步', () => {
    it('按间隔触发定时同步', async () => {
      scheduler.start();
      expect(mockClient.getMRList).not.toHaveBeenCalled();

      // 快进 59999ms：未到间隔，不触发
      vi.advanceTimersByTime(59999);
      expect(mockClient.getMRList).not.toHaveBeenCalled();

      // 再快进 1ms（共 60000ms）：触发定时同步
      await vi.advanceTimersByTimeAsync(1);
      // 2 个仓库各调用一次 getMRList
      expect(mockClient.getMRList).toHaveBeenCalledTimes(2);

      // 状态已更新
      const status = scheduler.getStatus();
      expect(status.lastSyncCount).toBe(4);
      expect(status.lastSyncAt).toBeTruthy();
      expect(status.nextSyncAt).toBeTruthy();
    });

    it('pause 后定时器停止，不再触发同步', async () => {
      scheduler.start();
      scheduler.pause();

      await vi.advanceTimersByTimeAsync(120000);
      expect(mockClient.getMRList).not.toHaveBeenCalled();
      expect(scheduler.getStatus().lastSyncCount).toBe(0);
    });
  });

  // ==================== getStore ====================

  describe('getStore', () => {
    it('同步前 store 为空', () => {
      const store = scheduler.getStore();
      expect(store.getMRs()).toEqual([]);
      expect(store.getMRs('repo-1')).toEqual([]);
      expect(store.getAll()).toEqual([]);
    });

    it('getMRs(repoId) 返回指定仓库的 MR 列表', async () => {
      await scheduler.syncOnce();
      const store = scheduler.getStore();
      const repo1MRs = store.getMRs('repo-1');
      expect(repo1MRs).toHaveLength(2);
      expect(repo1MRs[0].iid).toBe(1);
      expect(repo1MRs[1].iid).toBe(2);
    });

    it('getMRs() 无参数时返回全部仓库的 MR', async () => {
      await scheduler.syncOnce();
      const store = scheduler.getStore();
      expect(store.getMRs()).toHaveLength(4);
    });

    it('getAll() 返回带 repoId 标记的 MR 列表', async () => {
      await scheduler.syncOnce();
      const store = scheduler.getStore();
      const all = store.getAll();
      expect(all).toHaveLength(4);
      // 每项包含 repoId 和 mr
      for (const item of all) {
        expect(item.repoId).toBeTruthy();
        expect(item.mr).toBeDefined();
      }
      // 包含 repo-1 和 repo-2 的 MR
      const repo1Items = all.filter((i) => i.repoId === 'repo-1');
      const repo2Items = all.filter((i) => i.repoId === 'repo-2');
      expect(repo1Items).toHaveLength(2);
      expect(repo2Items).toHaveLength(2);
    });

    it('setMRs 覆盖该仓库的 MR 列表', async () => {
      await scheduler.syncOnce();
      const store = scheduler.getStore();
      expect(store.getMRs('repo-1')).toHaveLength(2);

      // 覆盖 repo-1 的 MR 列表
      store.setMRs('repo-1', [{ iid: 99, title: 'New MR' }]);
      expect(store.getMRs('repo-1')).toHaveLength(1);
      expect(store.getMRs('repo-1')[0].iid).toBe(99);
      // repo-2 不受影响
      expect(store.getMRs('repo-2')).toHaveLength(2);
    });
  });
});
