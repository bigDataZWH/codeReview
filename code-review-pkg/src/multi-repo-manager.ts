import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { RepoConfig, MultiRepoConfig } from './types.js';
import { CodeHubClient } from './codehub-client.js';
import {
  loadCodeHubConfig,
  saveCodeHubConfig,
  DEFAULT_CONFIG_FILE,
} from './codehub-config.js';

/**
 * 多仓管理器接口：在内存中维护一份 MultiRepoConfig，
 * 提供仓库的增删改查、激活切换以及按 repoId 缓存的 CodeHubClient 实例获取。
 */
export interface MultiRepoManager {
  /** 列出所有仓库配置 */
  listRepos(): RepoConfig[];
  /** 获取 active 仓库配置 */
  getActiveRepo(): RepoConfig | null;
  /** 获取 activeRepoId */
  getActiveRepoId(): string | null;
  /** 新增仓库配置（自动生成 repoId），返回新仓库。首个仓库自动设为 active */
  addRepo(input: Omit<RepoConfig, 'repoId'>): RepoConfig;
  /** 更新仓库配置，返回更新后的仓库；不存在返回 null */
  updateRepo(repoId: string, patch: Partial<Omit<RepoConfig, 'repoId'>>): RepoConfig | null;
  /** 删除仓库；若删除的是 active，自动将剩余第一个设为 active；返回新的 activeRepoId */
  deleteRepo(repoId: string): string | null;
  /** 切换激活仓库，返回是否成功 */
  activateRepo(repoId: string): boolean;
  /** 按 repoId 获取 CodeHubClient 实例（Map 缓存，配置变更时清除该 repoId 缓存）；未传 repoId 用 activeRepoId */
  getClient(repoId?: string): CodeHubClient | null;
  /** 按 repoId 获取仓库配置；未传用 activeRepoId */
  getRepo(repoId?: string): RepoConfig | null;
}

/**
 * 生成 repoId：repo-<timestamp>-<rand6>。
 * 参考 codehub-config.ts 的 generateDefaultRepoId 风格。
 */
function generateRepoId(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `repo-${ts}-${rand}`;
}

/**
 * 创建多仓管理器实例。
 * 内部用 loadCodeHubConfig 加载配置，维护一份内存中的 MultiRepoConfig 作为权威状态，
 * 每次 add/update/delete/activate 后持久化到文件。
 */
export function createMultiRepoManager(configPath?: string): MultiRepoManager {
  const resolvedPath = configPath ?? DEFAULT_CONFIG_FILE;
  // 内存中的多仓配置（权威状态）
  let config: MultiRepoConfig = loadCodeHubConfig(resolvedPath);
  // CodeHubClient 实例缓存（按 repoId 索引）
  const clientCache = new Map<string, CodeHubClient>();

  /**
   * 持久化完整内存配置到文件。
   * add/update/activate 使用 saveCodeHubConfig（upsert 语义即可正确持久化），
   * 并以返回值同步内存状态（反映 saveCodeHubConfig 的合并结果）。
   */
  function persist(): void {
    config = saveCodeHubConfig(config, resolvedPath);
  }

  /**
   * 全量重写配置文件（用于 delete 场景）。
   * saveCodeHubConfig 采用 upsert 合并语义，无法移除已有仓库，
   * 因此 deleteRepo 需直接覆写文件以保证被删除的仓库不再持久化。
   */
  function persistFullRewrite(): void {
    const absPath = resolve(process.cwd(), resolvedPath);
    const dir = dirname(absPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(absPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  return {
    listRepos(): RepoConfig[] {
      return config.repos;
    },

    getActiveRepo(): RepoConfig | null {
      if (!config.activeRepoId) return null;
      return config.repos.find((r) => r.repoId === config.activeRepoId) ?? null;
    },

    getActiveRepoId(): string | null {
      return config.activeRepoId;
    },

    addRepo(input: Omit<RepoConfig, 'repoId'>): RepoConfig {
      const repoId = generateRepoId();
      const newRepo: RepoConfig = { ...input, repoId };
      config.repos.push(newRepo);
      // 首个仓库自动设为 active
      if (config.activeRepoId === null) {
        config.activeRepoId = repoId;
      }
      persist();
      return newRepo;
    },

    updateRepo(
      repoId: string,
      patch: Partial<Omit<RepoConfig, 'repoId'>>,
    ): RepoConfig | null {
      const idx = config.repos.findIndex((r) => r.repoId === repoId);
      if (idx === -1) return null;
      // 合并 patch 字段（repoId 不可变，放最后以兜底覆盖）
      const updated: RepoConfig = { ...config.repos[idx], ...patch, repoId };
      config.repos[idx] = updated;
      // 配置变更（baseUrl/token 等可能改变）后清除该 repoId 的 client 缓存
      clientCache.delete(repoId);
      persist();
      return updated;
    },

    deleteRepo(repoId: string): string | null {
      const idx = config.repos.findIndex((r) => r.repoId === repoId);
      if (idx === -1) return config.activeRepoId;
      config.repos.splice(idx, 1);
      // 清除该 repoId 的 client 缓存
      clientCache.delete(repoId);
      // 若删除的是 active，自动将剩余第一个设为 active（无剩余则 null）
      if (config.activeRepoId === repoId) {
        config.activeRepoId = config.repos[0]?.repoId ?? null;
      }
      // delete 无法通过 saveCodeHubConfig 的 upsert 语义实现，需全量重写
      persistFullRewrite();
      return config.activeRepoId;
    },

    activateRepo(repoId: string): boolean {
      const exists = config.repos.some((r) => r.repoId === repoId);
      if (!exists) return false;
      config.activeRepoId = repoId;
      persist();
      return true;
    },

    getClient(repoId?: string): CodeHubClient | null {
      // 未传 repoId 时使用 activeRepoId
      const id = repoId ?? config.activeRepoId;
      if (!id) return null;
      const repo = config.repos.find((r) => r.repoId === id);
      if (!repo) return null;
      // 命中缓存直接返回
      const cached = clientCache.get(id);
      if (cached) return cached;
      // 未命中则按仓库配置创建并缓存
      // CodeHubConfig.projectId 为 string 类型，RepoConfig.projectId 为 number|string，需转换
      const client = new CodeHubClient({
        baseUrl: repo.baseUrl,
        token: repo.token,
        projectId: String(repo.projectId),
      });
      clientCache.set(id, client);
      return client;
    },

    getRepo(repoId?: string): RepoConfig | null {
      // 未传 repoId 时使用 activeRepoId
      const id = repoId ?? config.activeRepoId;
      if (!id) return null;
      return config.repos.find((r) => r.repoId === id) ?? null;
    },
  };
}
