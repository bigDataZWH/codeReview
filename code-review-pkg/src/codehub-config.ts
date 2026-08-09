import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { CodeHubConfig, RepoConfig, MultiRepoConfig } from './types.js';

export const DEFAULT_CONFIG_FILE = '.codehub-config.json';

/** 默认同步间隔（毫秒） */
export const DEFAULT_SYNC_INTERVAL_MS = 600000;

/**
 * 旧版单仓配置结构（用于迁移检测）。
 * 仅作为读取/解析时的兼容形状，不再对外暴露。
 */
interface LegacySingleRepoConfig {
  baseUrl?: string;
  token?: string;
  projectId?: string | number;
  repoBaseDir?: string;
  repoDir?: string;
  reviewConfig?: {
    defaultStrength?: 'lenient' | 'standard' | 'strict';
    securityReview?: boolean;
    defaultLanguage?: string;
  };
}

/**
 * 配置文件原始内容：可能为旧单仓结构、新多仓结构，或两者混存的中间态。
 */
type RawConfigFile = LegacySingleRepoConfig & Partial<MultiRepoConfig>;

/** 旧版 CodeHubFullConfig 类型别名（向后兼容，等价于新多仓结构） */
export type CodeHubFullConfig = MultiRepoConfig;

const DEFAULT_REVIEW_CONFIG = {
  defaultStrength: 'standard' as const,
  securityReview: true,
};

/**
 * 生成默认 repoId：repo-<timestamp>-<rand6>。
 * 仅在旧单仓配置首次迁移时调用，迁移结果会持久化以保证后续读取幂等。
 */
function generateDefaultRepoId(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `repo-${ts}-${rand}`;
}

/**
 * 检测并执行旧单仓配置到多仓结构的迁移。
 * 幂等：若 raw 已存在 repos 数组，则直接规范化返回，不重复处理、不记录日志。
 */
function migrateToMultiRepo(raw: RawConfigFile): MultiRepoConfig {
  // 已是多仓结构：规范化后直接返回（幂等出口）
  if (Array.isArray(raw.repos)) {
    return {
      repos: raw.repos,
      activeRepoId: raw.activeRepoId ?? raw.repos[0]?.repoId ?? null,
      syncIntervalMs: raw.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS,
      reviewConfig: raw.reviewConfig,
    };
  }

  // 旧单仓结构：检测是否含有 baseUrl/token/projectId 等字段
  const hasLegacyFields = Boolean(raw.baseUrl || raw.token || raw.projectId);
  if (!hasLegacyFields) {
    // 既无 repos 也无旧字段：返回空多仓结构
    return {
      repos: [],
      activeRepoId: null,
      syncIntervalMs: DEFAULT_SYNC_INTERVAL_MS,
      reviewConfig: raw.reviewConfig,
    };
  }

  // 执行迁移：将旧字段封装为单个 RepoConfig，并设为 active
  const repoId = generateDefaultRepoId();
  const migratedRepo: RepoConfig = {
    repoId,
    name: `repo-${raw.projectId ?? 'default'}`,
    baseUrl: raw.baseUrl ?? '',
    token: raw.token ?? '',
    projectId: raw.projectId ?? '',
    repoDir: raw.repoDir ?? raw.repoBaseDir,
  };

  console.log(
    `[codehub-config] 检测到旧版单仓配置，已自动迁移为多仓结构：repoId=${repoId}（baseUrl=${migratedRepo.baseUrl}, projectId=${migratedRepo.projectId}），并设为 active。`,
  );

  return {
    repos: [migratedRepo],
    activeRepoId: repoId,
    syncIntervalMs: DEFAULT_SYNC_INTERVAL_MS,
    reviewConfig: raw.reviewConfig,
  };
}

/**
 * 读取 CodeHub 多仓配置。
 * 读取时若检测到旧版单仓结构会自动迁移为多仓并回写文件，保证后续读取幂等且 repoId 稳定。
 * 环境变量 CODEHUB_URL/CODEHUB_TOKEN/CODEHUB_PROJECT_ID/CODEHUB_REPO_DIR 会覆盖当前 active 仓库的对应字段。
 */
export function loadCodeHubConfig(
  configPath: string = DEFAULT_CONFIG_FILE,
): MultiRepoConfig {
  const absPath = resolve(process.cwd(), configPath);

  let fileConfig: RawConfigFile = {};
  let fileExisted = false;
  if (existsSync(absPath)) {
    fileExisted = true;
    try {
      const content = readFileSync(absPath, 'utf-8');
      fileConfig = JSON.parse(content) as RawConfigFile;
    } catch (err) {
      console.warn(`[codehub-config] Failed to parse config file: ${absPath}`, err);
    }
  }

  // 执行迁移（幂等）：已有多仓结构不重复处理
  const wasMultiRepo = Array.isArray(fileConfig.repos);
  const migrated = migrateToMultiRepo(fileConfig);

  // 若发生了实际迁移（原文件非多仓但存在旧字段），将迁移结果回写以保证幂等与稳定 repoId
  if (fileExisted && !wasMultiRepo && migrated.repos.length > 0) {
    try {
      writeFileSync(absPath, JSON.stringify(migrated, null, 2), 'utf-8');
    } catch (err) {
      console.warn(`[codehub-config] Failed to persist migrated config: ${absPath}`, err);
    }
  }

  // 环境变量覆盖 active 仓库的对应字段（运行时覆盖，不写入文件）
  const envBaseUrl = process.env.CODEHUB_URL;
  const envToken = process.env.CODEHUB_TOKEN;
  const envProjectId = process.env.CODEHUB_PROJECT_ID;
  const envRepoDir = process.env.CODEHUB_REPO_DIR;
  if (envBaseUrl || envToken || envProjectId || envRepoDir) {
    const active = getActiveRepo(migrated);
    if (active) {
      if (envBaseUrl) active.baseUrl = envBaseUrl;
      if (envToken) active.token = envToken;
      if (envProjectId) active.projectId = envProjectId;
      if (envRepoDir) active.repoDir = envRepoDir;
    }
  }

  // 规范化 reviewConfig（补默认值）
  migrated.reviewConfig = {
    ...DEFAULT_REVIEW_CONFIG,
    ...migrated.reviewConfig,
  };

  return migrated;
}

/**
 * 保存 CodeHub 多仓配置到文件。
 * 已存在的仓库按 repoId 做 upsert 合并；activeRepoId / syncIntervalMs / reviewConfig 缺省时沿用已有值。
 */
export function saveCodeHubConfig(
  config: Partial<MultiRepoConfig>,
  configPath: string = DEFAULT_CONFIG_FILE,
): MultiRepoConfig {
  const absPath = resolve(process.cwd(), configPath);
  const dir = dirname(absPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // 读取并迁移已有配置（保证旧文件也能被正确合并）
  let existing: MultiRepoConfig;
  if (existsSync(absPath)) {
    try {
      const raw = JSON.parse(readFileSync(absPath, 'utf-8')) as RawConfigFile;
      existing = migrateToMultiRepo(raw);
    } catch {
      existing = {
        repos: [],
        activeRepoId: null,
        syncIntervalMs: DEFAULT_SYNC_INTERVAL_MS,
      };
    }
  } else {
    existing = {
      repos: [],
      activeRepoId: null,
      syncIntervalMs: DEFAULT_SYNC_INTERVAL_MS,
    };
  }

  // 仓库列表按 repoId upsert 合并
  const reposMap = new Map<string, RepoConfig>();
  for (const r of existing.repos) reposMap.set(r.repoId, r);
  if (Array.isArray(config.repos)) {
    for (const r of config.repos) {
      reposMap.set(r.repoId, r);
    }
  }

  const merged: MultiRepoConfig = {
    repos: Array.from(reposMap.values()),
    activeRepoId: config.activeRepoId ?? existing.activeRepoId,
    syncIntervalMs:
      config.syncIntervalMs ?? existing.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS,
    reviewConfig: {
      ...existing.reviewConfig,
      ...config.reviewConfig,
    },
  };

  writeFileSync(absPath, JSON.stringify(merged, null, 2), 'utf-8');

  return merged;
}

/**
 * 返回当前 active 仓库配置（含 baseUrl/token/projectId/repoDir，向后兼容旧调用方）。
 * 无 active 仓库时返回 null。不传 config 时自动从默认路径加载。
 */
export function getActiveRepo(config?: MultiRepoConfig): RepoConfig | null {
  const cfg = config ?? loadCodeHubConfig();
  if (!cfg.activeRepoId) return null;
  return cfg.repos.find((r) => r.repoId === cfg.activeRepoId) ?? null;
}

/**
 * 返回当前 active repoId。无激活仓库时返回 null。
 * 不传 config 时自动从默认路径加载。
 */
export function getActiveRepoId(config?: MultiRepoConfig): string | null {
  const cfg = config ?? loadCodeHubConfig();
  return cfg.activeRepoId;
}

/**
 * 向后兼容：返回旧版单仓 CodeHubConfig（baseUrl/token/projectId）。
 * 取自当前 active 仓库；可选的 config 覆盖项优先使用。
 */
export function getCodeHubConfig(config?: Partial<CodeHubConfig>): CodeHubConfig {
  const full = loadCodeHubConfig();
  const active = getActiveRepo(full);
  return {
    baseUrl: config?.baseUrl ?? active?.baseUrl ?? '',
    token: config?.token ?? active?.token ?? '',
    projectId:
      config?.projectId ??
      (active?.projectId !== undefined ? String(active.projectId) : ''),
  };
}

/** 判断 CodeHub 配置是否有效（baseUrl、token、projectId 均非空） */
export function isCodeHubConfigValid(
  config: Partial<CodeHubConfig> | undefined | null,
): boolean {
  if (!config) return false;
  return Boolean(config.baseUrl && config.token && config.projectId);
}

/** 对 token 做脱敏处理（保留首 4 + 末 4，其余以 **** 代替） */
export function maskToken(token: string): string {
  if (!token || token.length <= 8) {
    return '****';
  }
  return `${token.slice(0, 4)}****${token.slice(-4)}`;
}
