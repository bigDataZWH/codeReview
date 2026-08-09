// tests/multi-repo-manager.test.ts
// Task 19.1：multi-repo-manager.ts 单元测试
// 使用临时配置文件避免污染项目根目录

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMultiRepoManager } from '../src/multi-repo-manager.js';
import type { MultiRepoConfig } from '../src/types.js';

// ==================== 测试辅助 ====================

let tempDir: string;
let configPath: string;

beforeEach(() => {
  // 每个测试用例使用独立的临时目录与配置文件
  tempDir = mkdtempSync(join(tmpdir(), 'mrm-test-'));
  configPath = join(tempDir, '.codehub-config.json');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** 读取临时配置文件内容 */
function readConfig(): MultiRepoConfig {
  const content = readFileSync(configPath, 'utf-8');
  return JSON.parse(content) as MultiRepoConfig;
}

// ==================== addRepo ====================

describe('createMultiRepoManager — addRepo', () => {
  it('新增仓库时自动生成 repoId（repo-<timestamp>-<rand6>）', () => {
    const mgr = createMultiRepoManager(configPath);
    const repo = mgr.addRepo({
      name: 'test-repo',
      baseUrl: 'http://127.0.0.1:9099',
      token: 'token-1',
      projectId: 1,
    });
    expect(repo.repoId).toBeTruthy();
    expect(repo.repoId).toMatch(/^repo-/);
    expect(repo.name).toBe('test-repo');
    expect(repo.baseUrl).toBe('http://127.0.0.1:9099');
    expect(repo.token).toBe('token-1');
    expect(repo.projectId).toBe(1);
  });

  it('首个仓库自动设为 active', () => {
    const mgr = createMultiRepoManager(configPath);
    const repo = mgr.addRepo({
      name: 'first-repo',
      baseUrl: 'http://127.0.0.1:9099',
      token: 'token-1',
      projectId: 1,
    });
    expect(mgr.getActiveRepoId()).toBe(repo.repoId);
    expect(mgr.getActiveRepo()?.repoId).toBe(repo.repoId);
  });

  it('非首个仓库不自动设为 active', () => {
    const mgr = createMultiRepoManager(configPath);
    const r1 = mgr.addRepo({ name: 'r1', baseUrl: 'http://a', token: 't', projectId: 1 });
    const r2 = mgr.addRepo({ name: 'r2', baseUrl: 'http://b', token: 't', projectId: 2 });
    // active 仍为 r1
    expect(mgr.getActiveRepoId()).toBe(r1.repoId);
    expect(mgr.getActiveRepoId()).not.toBe(r2.repoId);
  });

  it('addRepo 后持久化到配置文件', () => {
    const mgr = createMultiRepoManager(configPath);
    mgr.addRepo({ name: 'persist-test', baseUrl: 'http://a', token: 't', projectId: 1 });
    // 文件存在且包含仓库
    expect(existsSync(configPath)).toBe(true);
    const config = readConfig();
    expect(config.repos).toHaveLength(1);
    expect(config.repos[0].name).toBe('persist-test');
  });

  it('多次 addRepo 生成不同 repoId', () => {
    const mgr = createMultiRepoManager(configPath);
    const r1 = mgr.addRepo({ name: 'r1', baseUrl: 'http://a', token: 't', projectId: 1 });
    const r2 = mgr.addRepo({ name: 'r2', baseUrl: 'http://b', token: 't', projectId: 2 });
    expect(r1.repoId).not.toBe(r2.repoId);
    expect(mgr.listRepos()).toHaveLength(2);
  });
});

// ==================== listRepos / getRepo ====================

describe('createMultiRepoManager — listRepos / getRepo', () => {
  it('空配置时 listRepos 返回空数组', () => {
    const mgr = createMultiRepoManager(configPath);
    expect(mgr.listRepos()).toEqual([]);
  });

  it('listRepos 返回所有已添加仓库', () => {
    const mgr = createMultiRepoManager(configPath);
    mgr.addRepo({ name: 'r1', baseUrl: 'http://a', token: 't', projectId: 1 });
    mgr.addRepo({ name: 'r2', baseUrl: 'http://b', token: 't', projectId: 2 });
    expect(mgr.listRepos()).toHaveLength(2);
  });

  it('getRepo(repoId) 返回指定仓库', () => {
    const mgr = createMultiRepoManager(configPath);
    const r1 = mgr.addRepo({ name: 'r1', baseUrl: 'http://a', token: 't', projectId: 1 });
    const found = mgr.getRepo(r1.repoId);
    expect(found?.repoId).toBe(r1.repoId);
    expect(found?.name).toBe('r1');
  });

  it('getRepo 未传 repoId 时返回 active 仓库', () => {
    const mgr = createMultiRepoManager(configPath);
    const r1 = mgr.addRepo({ name: 'r1', baseUrl: 'http://a', token: 't', projectId: 1 });
    mgr.addRepo({ name: 'r2', baseUrl: 'http://b', token: 't', projectId: 2 });
    // active 为 r1
    const active = mgr.getRepo();
    expect(active?.repoId).toBe(r1.repoId);
  });

  it('getRepo 不存在的 repoId 返回 null', () => {
    const mgr = createMultiRepoManager(configPath);
    expect(mgr.getRepo('nonexistent')).toBeNull();
  });

  it('getRepo 无 active 仓库且未传 repoId 返回 null', () => {
    const mgr = createMultiRepoManager(configPath);
    expect(mgr.getRepo()).toBeNull();
  });
});

// ==================== updateRepo ====================

describe('createMultiRepoManager — updateRepo', () => {
  it('更新仓库字段并返回更新后的仓库', () => {
    const mgr = createMultiRepoManager(configPath);
    const r1 = mgr.addRepo({ name: 'r1', baseUrl: 'http://a', token: 't1', projectId: 1 });
    const updated = mgr.updateRepo(r1.repoId, { name: 'updated', token: 't2' });
    expect(updated?.name).toBe('updated');
    expect(updated?.token).toBe('t2');
    expect(updated?.baseUrl).toBe('http://a'); // 未更新字段保留
    expect(updated?.repoId).toBe(r1.repoId); // repoId 不可变
  });

  it('updateRepo 后 listRepos 反映更新', () => {
    const mgr = createMultiRepoManager(configPath);
    const r1 = mgr.addRepo({ name: 'r1', baseUrl: 'http://a', token: 't', projectId: 1 });
    mgr.updateRepo(r1.repoId, { name: 'new-name' });
    const found = mgr.listRepos().find((r) => r.repoId === r1.repoId);
    expect(found?.name).toBe('new-name');
  });

  it('updateRepo 不存在的 repoId 返回 null', () => {
    const mgr = createMultiRepoManager(configPath);
    const result = mgr.updateRepo('nonexistent', { name: 'x' });
    expect(result).toBeNull();
  });

  it('updateRepo 后持久化到配置文件', () => {
    const mgr = createMultiRepoManager(configPath);
    const r1 = mgr.addRepo({ name: 'r1', baseUrl: 'http://a', token: 't', projectId: 1 });
    mgr.updateRepo(r1.repoId, { name: 'persisted' });
    const config = readConfig();
    const saved = config.repos.find((r) => r.repoId === r1.repoId);
    expect(saved?.name).toBe('persisted');
  });
});

// ==================== deleteRepo ====================

describe('createMultiRepoManager — deleteRepo', () => {
  it('删除仓库后 listRepos 不再包含该仓库', () => {
    const mgr = createMultiRepoManager(configPath);
    const r1 = mgr.addRepo({ name: 'r1', baseUrl: 'http://a', token: 't', projectId: 1 });
    mgr.deleteRepo(r1.repoId);
    expect(mgr.listRepos()).toHaveLength(0);
  });

  it('删除非 active 仓库时 active 不变', () => {
    const mgr = createMultiRepoManager(configPath);
    const r1 = mgr.addRepo({ name: 'r1', baseUrl: 'http://a', token: 't', projectId: 1 });
    const r2 = mgr.addRepo({ name: 'r2', baseUrl: 'http://b', token: 't', projectId: 2 });
    // active 为 r1
    const activeId = mgr.deleteRepo(r2.repoId);
    expect(activeId).toBe(r1.repoId);
    expect(mgr.getActiveRepoId()).toBe(r1.repoId);
  });

  it('删除 active 仓库时自动切换到剩余第一个', () => {
    const mgr = createMultiRepoManager(configPath);
    const r1 = mgr.addRepo({ name: 'r1', baseUrl: 'http://a', token: 't', projectId: 1 });
    const r2 = mgr.addRepo({ name: 'r2', baseUrl: 'http://b', token: 't', projectId: 2 });
    const r3 = mgr.addRepo({ name: 'r3', baseUrl: 'http://c', token: 't', projectId: 3 });
    // active 为 r1，删除 r1 后应切换到 r2（剩余第一个）
    const newActiveId = mgr.deleteRepo(r1.repoId);
    expect(newActiveId).toBe(r2.repoId);
    expect(mgr.getActiveRepoId()).toBe(r2.repoId);
    expect(mgr.listRepos()).toHaveLength(2);
  });

  it('删除唯一仓库后 active 为 null', () => {
    const mgr = createMultiRepoManager(configPath);
    const r1 = mgr.addRepo({ name: 'r1', baseUrl: 'http://a', token: 't', projectId: 1 });
    const newActiveId = mgr.deleteRepo(r1.repoId);
    expect(newActiveId).toBeNull();
    expect(mgr.getActiveRepoId()).toBeNull();
    expect(mgr.listRepos()).toHaveLength(0);
  });

  it('deleteRepo 不存在的 repoId 返回当前 activeRepoId', () => {
    const mgr = createMultiRepoManager(configPath);
    const r1 = mgr.addRepo({ name: 'r1', baseUrl: 'http://a', token: 't', projectId: 1 });
    const result = mgr.deleteRepo('nonexistent');
    expect(result).toBe(r1.repoId);
    expect(mgr.listRepos()).toHaveLength(1);
  });

  it('deleteRepo 后配置文件不再包含该仓库（全量重写）', () => {
    const mgr = createMultiRepoManager(configPath);
    const r1 = mgr.addRepo({ name: 'r1', baseUrl: 'http://a', token: 't', projectId: 1 });
    const r2 = mgr.addRepo({ name: 'r2', baseUrl: 'http://b', token: 't', projectId: 2 });
    mgr.deleteRepo(r1.repoId);
    const config = readConfig();
    expect(config.repos).toHaveLength(1);
    expect(config.repos.find((r) => r.repoId === r1.repoId)).toBeUndefined();
    expect(config.repos[0].repoId).toBe(r2.repoId);
  });
});

// ==================== activateRepo ====================

describe('createMultiRepoManager — activateRepo', () => {
  it('切换 active 仓库', () => {
    const mgr = createMultiRepoManager(configPath);
    const r1 = mgr.addRepo({ name: 'r1', baseUrl: 'http://a', token: 't', projectId: 1 });
    const r2 = mgr.addRepo({ name: 'r2', baseUrl: 'http://b', token: 't', projectId: 2 });
    // 初始 active 为 r1
    expect(mgr.getActiveRepoId()).toBe(r1.repoId);
    // 切换到 r2
    const ok = mgr.activateRepo(r2.repoId);
    expect(ok).toBe(true);
    expect(mgr.getActiveRepoId()).toBe(r2.repoId);
    expect(mgr.getActiveRepo()?.repoId).toBe(r2.repoId);
  });

  it('activateRepo 不存在的 repoId 返回 false', () => {
    const mgr = createMultiRepoManager(configPath);
    mgr.addRepo({ name: 'r1', baseUrl: 'http://a', token: 't', projectId: 1 });
    const ok = mgr.activateRepo('nonexistent');
    expect(ok).toBe(false);
  });

  it('activateRepo 后持久化到配置文件', () => {
    const mgr = createMultiRepoManager(configPath);
    const r1 = mgr.addRepo({ name: 'r1', baseUrl: 'http://a', token: 't', projectId: 1 });
    const r2 = mgr.addRepo({ name: 'r2', baseUrl: 'http://b', token: 't', projectId: 2 });
    mgr.activateRepo(r2.repoId);
    const config = readConfig();
    expect(config.activeRepoId).toBe(r2.repoId);
  });
});

// ==================== getClient ====================

describe('createMultiRepoManager — getClient', () => {
  it('返回 CodeHubClient 实例', () => {
    const mgr = createMultiRepoManager(configPath);
    mgr.addRepo({ name: 'r1', baseUrl: 'http://127.0.0.1:9099', token: 't', projectId: 1 });
    const client = mgr.getClient();
    expect(client).not.toBeNull();
    // CodeHubClient 实例应有 getConfig 方法
    expect(typeof client?.getConfig).toBe('function');
  });

  it('相同 repoId 多次调用返回缓存的同一实例', () => {
    const mgr = createMultiRepoManager(configPath);
    const r1 = mgr.addRepo({ name: 'r1', baseUrl: 'http://127.0.0.1:9099', token: 't', projectId: 1 });
    const c1 = mgr.getClient(r1.repoId);
    const c2 = mgr.getClient(r1.repoId);
    expect(c1).toBe(c2); // 同一引用
  });

  it('未传 repoId 时使用 activeRepoId 的 client', () => {
    const mgr = createMultiRepoManager(configPath);
    const r1 = mgr.addRepo({ name: 'r1', baseUrl: 'http://127.0.0.1:9099', token: 't', projectId: 1 });
    const c1 = mgr.getClient();
    const c2 = mgr.getClient(r1.repoId);
    // active 为 r1，两次应返回同一缓存实例
    expect(c1).toBe(c2);
  });

  it('无 active 仓库且未传 repoId 返回 null', () => {
    const mgr = createMultiRepoManager(configPath);
    expect(mgr.getClient()).toBeNull();
  });

  it('不存在的 repoId 返回 null', () => {
    const mgr = createMultiRepoManager(configPath);
    mgr.addRepo({ name: 'r1', baseUrl: 'http://127.0.0.1:9099', token: 't', projectId: 1 });
    expect(mgr.getClient('nonexistent')).toBeNull();
  });

  it('updateRepo 后清除该 repoId 的 client 缓存', () => {
    const mgr = createMultiRepoManager(configPath);
    const r1 = mgr.addRepo({ name: 'r1', baseUrl: 'http://127.0.0.1:9099', token: 't1', projectId: 1 });
    const c1 = mgr.getClient(r1.repoId);
    // 更新 baseUrl 后缓存应失效
    mgr.updateRepo(r1.repoId, { baseUrl: 'http://127.0.0.1:8888' });
    const c2 = mgr.getClient(r1.repoId);
    expect(c1).not.toBe(c2); // 不同引用（缓存已清除）
    // 新 client 的 config 反映更新后的 baseUrl
    expect(c2?.getConfig().baseUrl).toBe('http://127.0.0.1:8888');
  });

  it('deleteRepo 后该 repoId 的 client 缓存清除', () => {
    const mgr = createMultiRepoManager(configPath);
    const r1 = mgr.addRepo({ name: 'r1', baseUrl: 'http://127.0.0.1:9099', token: 't', projectId: 1 });
    mgr.getClient(r1.repoId);
    mgr.deleteRepo(r1.repoId);
    // 删除后 getClient 返回 null
    expect(mgr.getClient(r1.repoId)).toBeNull();
  });

  it('不同 repoId 返回不同 client 实例', () => {
    const mgr = createMultiRepoManager(configPath);
    const r1 = mgr.addRepo({ name: 'r1', baseUrl: 'http://a', token: 't', projectId: 1 });
    const r2 = mgr.addRepo({ name: 'r2', baseUrl: 'http://b', token: 't', projectId: 2 });
    const c1 = mgr.getClient(r1.repoId);
    const c2 = mgr.getClient(r2.repoId);
    expect(c1).not.toBe(c2);
  });
});

// ==================== 配置文件加载/持久化 ====================

describe('createMultiRepoManager — 配置文件持久化', () => {
  it('从已有配置文件加载仓库', () => {
    // 先写入一份配置
    const mgr1 = createMultiRepoManager(configPath);
    const r1 = mgr1.addRepo({ name: 'r1', baseUrl: 'http://a', token: 't', projectId: 1 });
    mgr1.activateRepo(r1.repoId);

    // 用同一 configPath 创建新 manager，应加载已有配置
    const mgr2 = createMultiRepoManager(configPath);
    expect(mgr2.listRepos()).toHaveLength(1);
    expect(mgr2.listRepos()[0].name).toBe('r1');
    expect(mgr2.getActiveRepoId()).toBe(r1.repoId);
  });

  it('空配置文件时返回空仓库列表', () => {
    const mgr = createMultiRepoManager(configPath);
    expect(mgr.listRepos()).toHaveLength(0);
    expect(mgr.getActiveRepoId()).toBeNull();
  });
});
