import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  RbacManager,
  checkPermission,
  loadRoles,
  ROLES,
  resolveRolePermissions,
  isValidRole,
  COMMAND_PERMISSIONS,
  DEFAULT_RBAC_CONFIG_FILE,
} from '../../../src/rbac.js';
import type { RbacConfig, RoleName } from '../../../src/rbac.js';

// ---- CLI 测试辅助 ----

interface TestState {
  exitError: Error | null;
  stdout: string[];
  stderr: string[];
}

const testState: TestState = {
  exitError: null,
  stdout: [],
  stderr: [],
};

async function loadCli(opts: {
  argv: string[];
  env?: Record<string, string>;
}): Promise<{
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}> {
  const { argv, env = {} } = opts;

  testState.exitError = null;
  testState.stdout = [];
  testState.stderr = [];

  const origArgv = process.argv;
  process.argv = ['node', '/tmp/cli.js', ...argv];

  const origEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    origEnv[k] = process.env[k];
    process.env[k] = v;
  }

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    testState.stdout.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    testState.stderr.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });

  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    const err = new Error(`__PROCESS_EXIT_${code ?? 0}__`);
    testState.exitError = err;
    throw err;
  }) as never);

  vi.resetModules();

  try {
    await import('../../../src/cli.js');
    return {
      stdout: [...testState.stdout],
      stderr: [...testState.stderr],
      exitCode: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const match = msg.match(/^__PROCESS_EXIT_(\d+)__$/);
    if (match) {
      return {
        stdout: [...testState.stdout],
        stderr: [...testState.stderr],
        exitCode: parseInt(match[1], 10),
      };
    }
    throw err;
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    process.argv = origArgv;
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    vi.resetModules();
  }
}

// ==================== ROLES 常量 ====================

describe('ROLES 常量', () => {
  it('包含 admin 角色', () => {
    expect(ROLES.admin).toBe('admin');
  });

  it('包含 reviewer 角色', () => {
    expect(ROLES.reviewer).toBe('reviewer');
  });

  it('包含 viewer 角色', () => {
    expect(ROLES.viewer).toBe('viewer');
  });
});

// ==================== isValidRole ====================

describe('isValidRole', () => {
  it('合法角色返回 true', () => {
    expect(isValidRole('admin')).toBe(true);
    expect(isValidRole('reviewer')).toBe(true);
    expect(isValidRole('viewer')).toBe(true);
  });

  it('非法角色返回 false', () => {
    expect(isValidRole('superuser')).toBe(false);
    expect(isValidRole('')).toBe(false);
    expect(isValidRole('root')).toBe(false);
  });
});

// ==================== resolveRolePermissions ====================

describe('resolveRolePermissions', () => {
  it('viewer 拥有只读权限', () => {
    const perms = resolveRolePermissions('viewer');
    expect(perms).toContain('review:view');
    expect(perms).toContain('rules:list');
    expect(perms).toContain('metrics:view');
  });

  it('reviewer 继承 viewer 权限并扩展执行权限', () => {
    const perms = resolveRolePermissions('reviewer');
    // 继承自 viewer
    expect(perms).toContain('review:view');
    expect(perms).toContain('rules:list');
    // reviewer 专属
    expect(perms).toContain('review:run');
    expect(perms).toContain('feedback:submit');
  });

  it('admin 继承 reviewer + viewer 权限并扩展管理权限', () => {
    const perms = resolveRolePermissions('admin');
    expect(perms).toContain('review:view');
    expect(perms).toContain('review:run');
    expect(perms).toContain('rules:override');
    expect(perms).toContain('publish:run');
  });

  it('admin 同时拥有 viewer / reviewer 的全部权限', () => {
    const adminPerms = new Set(resolveRolePermissions('admin'));
    const viewerPerms = resolveRolePermissions('viewer');
    const reviewerPerms = resolveRolePermissions('reviewer');
    for (const p of viewerPerms) {
      expect(adminPerms.has(p)).toBe(true);
    }
    for (const p of reviewerPerms) {
      expect(adminPerms.has(p)).toBe(true);
    }
  });

  it('viewer 不拥有 admin/reviewer 专属权限', () => {
    const perms = new Set(resolveRolePermissions('viewer'));
    expect(perms.has('review:run')).toBe(false);
    expect(perms.has('rules:override')).toBe(false);
    expect(perms.has('publish:run')).toBe(false);
  });

  it('reviewer 不拥有 admin 专属权限', () => {
    const perms = new Set(resolveRolePermissions('reviewer'));
    expect(perms.has('rules:override')).toBe(false);
    expect(perms.has('publish:run')).toBe(false);
  });

  it('支持自定义权限覆盖', () => {
    const custom = {
      viewer: ['custom:view'],
      reviewer: ['custom:review'],
    };
    expect(resolveRolePermissions('viewer', custom)).toContain('custom:view');
    expect(resolveRolePermissions('reviewer', custom)).toContain('custom:review');
    // 仍继承 viewer
    expect(resolveRolePermissions('reviewer', custom)).toContain('custom:view');
  });
});

// ==================== RbacManager 类 ====================

describe('RbacManager', () => {
  let manager: RbacManager;

  beforeEach(() => {
    manager = new RbacManager();
  });

  describe('构造器', () => {
    it('默认空配置', () => {
      expect(manager.listUsers()).toEqual([]);
    });

    it('支持初始用户角色映射', () => {
      const m = new RbacManager({
        initialUsers: { alice: 'admin', bob: 'reviewer', carol: 'viewer' },
      });
      expect(m.getUserRole('alice')).toBe('admin');
      expect(m.getUserRole('bob')).toBe('reviewer');
      expect(m.getUserRole('carol')).toBe('viewer');
    });

    it('忽略非法角色', () => {
      const m = new RbacManager({
        initialUsers: { alice: 'admin', bob: 'invalid-role' as RoleName },
      });
      expect(m.getUserRole('alice')).toBe('admin');
      expect(m.getUserRole('bob')).toBeUndefined();
    });

    it('支持自定义角色权限', () => {
      const m = new RbacManager({
        customPermissions: { viewer: ['custom:perm'] },
      });
      expect(m.getUserPermissions('anyone')).toContain('custom:perm');
    });
  });

  describe('assignRole', () => {
    it('为用户分配角色', () => {
      manager.assignRole('alice', 'admin');
      expect(manager.getUserRole('alice')).toBe('admin');
    });

    it('分配角色覆盖旧角色', () => {
      manager.assignRole('alice', 'viewer');
      manager.assignRole('alice', 'admin');
      expect(manager.getUserRole('alice')).toBe('admin');
    });

    it('空用户名抛错', () => {
      expect(() => manager.assignRole('', 'admin')).toThrow();
    });

    it('非法角色抛错', () => {
      expect(() => manager.assignRole('alice', 'invalid' as RoleName)).toThrow();
    });
  });

  describe('getUserRoleOrDefault', () => {
    it('已分配角色返回实际角色', () => {
      manager.assignRole('alice', 'admin');
      expect(manager.getUserRoleOrDefault('alice')).toBe('admin');
    });

    it('未分配角色默认 viewer', () => {
      expect(manager.getUserRoleOrDefault('unknown')).toBe('viewer');
    });
  });

  describe('checkPermission', () => {
    it('admin 拥有 review:run 权限', () => {
      manager.assignRole('alice', 'admin');
      expect(manager.checkPermission('alice', 'review:run')).toBe(true);
    });

    it('reviewer 拥有 review:run 权限', () => {
      manager.assignRole('bob', 'reviewer');
      expect(manager.checkPermission('bob', 'review:run')).toBe(true);
    });

    it('viewer 不拥有 review:run 权限', () => {
      manager.assignRole('carol', 'viewer');
      expect(manager.checkPermission('carol', 'review:run')).toBe(false);
    });

    it('viewer 拥有 review:view 权限', () => {
      manager.assignRole('carol', 'viewer');
      expect(manager.checkPermission('carol', 'review:view')).toBe(true);
    });

    it('admin 拥有 rules:override 权限', () => {
      manager.assignRole('alice', 'admin');
      expect(manager.checkPermission('alice', 'rules:override')).toBe(true);
    });

    it('reviewer 不拥有 rules:override 权限', () => {
      manager.assignRole('bob', 'reviewer');
      expect(manager.checkPermission('bob', 'rules:override')).toBe(false);
    });

    it('未分配角色用户默认 viewer', () => {
      expect(manager.checkPermission('guest', 'review:view')).toBe(true);
      expect(manager.checkPermission('guest', 'review:run')).toBe(false);
    });

    it('空权限字符串返回 false', () => {
      manager.assignRole('alice', 'admin');
      expect(manager.checkPermission('alice', '')).toBe(false);
    });

    it('未知权限返回 false', () => {
      manager.assignRole('alice', 'admin');
      expect(manager.checkPermission('alice', 'unknown:perm')).toBe(false);
    });
  });

  describe('hasAnyPermission', () => {
    it('用户拥有任意一个权限即返回 true', () => {
      manager.assignRole('carol', 'viewer');
      expect(
        manager.hasAnyPermission('carol', ['review:run', 'review:view']),
      ).toBe(true);
    });

    it('用户不拥有任何权限时返回 false', () => {
      manager.assignRole('carol', 'viewer');
      expect(
        manager.hasAnyPermission('carol', ['review:run', 'rules:override']),
      ).toBe(false);
    });

    it('空权限列表返回 false', () => {
      manager.assignRole('alice', 'admin');
      expect(manager.hasAnyPermission('alice', [])).toBe(false);
    });
  });

  describe('getUserPermissions', () => {
    it('返回用户拥有的所有权限（含继承）', () => {
      manager.assignRole('alice', 'admin');
      const perms = manager.getUserPermissions('alice');
      expect(perms).toContain('review:view');
      expect(perms).toContain('review:run');
      expect(perms).toContain('rules:override');
    });

    it('未分配角色用户返回 viewer 权限', () => {
      const perms = manager.getUserPermissions('guest');
      expect(perms).toContain('review:view');
      expect(perms).toContain('rules:list');
    });
  });

  describe('listUsers', () => {
    it('列出所有已分配角色的用户', () => {
      manager.assignRole('alice', 'admin');
      manager.assignRole('bob', 'viewer');
      const users = manager.listUsers();
      expect(users).toHaveLength(2);
      const names = users.map((u) => u.user);
      expect(names).toContain('alice');
      expect(names).toContain('bob');
    });

    it('空管理器返回空数组', () => {
      expect(manager.listUsers()).toEqual([]);
    });
  });

  describe('removeUser', () => {
    it('移除已存在的用户', () => {
      manager.assignRole('alice', 'admin');
      expect(manager.removeUser('alice')).toBe(true);
      expect(manager.getUserRole('alice')).toBeUndefined();
    });

    it('移除不存在的用户返回 false', () => {
      expect(manager.removeUser('unknown')).toBe(false);
    });
  });

  describe('getBuiltinPermissions', () => {
    it('返回三个内置角色的权限映射', () => {
      const perms = manager.getBuiltinPermissions();
      expect(perms.admin).toBeDefined();
      expect(perms.reviewer).toBeDefined();
      expect(perms.viewer).toBeDefined();
    });

    it('admin 权限包含 viewer 与 reviewer 权限', () => {
      const perms = manager.getBuiltinPermissions();
      const adminSet = new Set(perms.admin);
      for (const p of perms.viewer) {
        expect(adminSet.has(p)).toBe(true);
      }
      for (const p of perms.reviewer) {
        expect(adminSet.has(p)).toBe(true);
      }
    });
  });
});

// ==================== 持久化 ====================

describe('RbacManager 持久化', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rbac-test-'));
    configPath = join(tmpDir, 'rbac.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saveToFile 写入磁盘文件', () => {
    const m = new RbacManager({ initialUsers: { alice: 'admin', bob: 'viewer' } });
    m.saveToFile(configPath);
    expect(existsSync(configPath)).toBe(true);
  });

  it('saveToFile 父目录不存在时自动创建', () => {
    const nested = join(tmpDir, 'a', 'b', 'rbac.json');
    const m = new RbacManager({ initialUsers: { alice: 'admin' } });
    m.saveToFile(nested);
    expect(existsSync(nested)).toBe(true);
  });

  it('saveToFile 写入的内容可被 loadFromFile 还原', () => {
    const m1 = new RbacManager({ initialUsers: { alice: 'admin', bob: 'reviewer' } });
    m1.saveToFile(configPath);

    const m2 = RbacManager.loadFromFile(configPath);
    expect(m2.getUserRole('alice')).toBe('admin');
    expect(m2.getUserRole('bob')).toBe('reviewer');
  });

  it('saveToFile 默认路径为 .code-review-rbac.json', () => {
    expect(DEFAULT_RBAC_CONFIG_FILE).toBe('.code-review-rbac.json');
  });

  it('loadFromFile 文件不存在时返回空管理器', () => {
    const m = RbacManager.loadFromFile(join(tmpDir, 'non-existent.json'));
    expect(m.listUsers()).toEqual([]);
  });

  it('loadFromFile 解析失败时返回空管理器', () => {
    writeFileSync(configPath, 'not valid json', 'utf-8');
    const m = RbacManager.loadFromFile(configPath);
    expect(m.listUsers()).toEqual([]);
  });

  it('loadFromFile 忽略非法角色', () => {
    const config: RbacConfig = {
      users: { alice: 'admin', bob: 'invalid' as RoleName },
    };
    writeFileSync(configPath, JSON.stringify(config), 'utf-8');

    const m = RbacManager.loadFromFile(configPath);
    expect(m.getUserRole('alice')).toBe('admin');
    expect(m.getUserRole('bob')).toBeUndefined();
  });

  it('saveToFile 持久化自定义权限', () => {
    const m1 = new RbacManager({
      initialUsers: { alice: 'viewer' },
      customPermissions: { viewer: ['custom:perm'] },
    });
    m1.saveToFile(configPath);

    const content = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content) as RbacConfig;
    expect(parsed.customPermissions).toBeDefined();
    expect(parsed.customPermissions?.viewer).toContain('custom:perm');
  });

  it('saveToFile + loadFromFile 跨进程持久化权限检查', () => {
    const m1 = new RbacManager({ initialUsers: { alice: 'admin', carol: 'viewer' } });
    m1.saveToFile(configPath);

    const m2 = RbacManager.loadFromFile(configPath);
    expect(m2.checkPermission('alice', 'rules:override')).toBe(true);
    expect(m2.checkPermission('carol', 'rules:override')).toBe(false);
    expect(m2.checkPermission('carol', 'review:view')).toBe(true);
  });
});

// ==================== 便捷函数 ====================

describe('checkPermission 便捷函数', () => {
  it('不传 manager 时使用默认空管理器（默认 viewer）', () => {
    // 默认 viewer 拥有 review:view
    expect(checkPermission('guest', 'review:view')).toBe(true);
    // 默认 viewer 不拥有 review:run
    expect(checkPermission('guest', 'review:run')).toBe(false);
  });

  it('传入 manager 时复用实例', () => {
    const m = new RbacManager({ initialUsers: { alice: 'admin' } });
    expect(checkPermission('alice', 'rules:override', m)).toBe(true);
  });
});

describe('loadRoles 便捷函数', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rbac-test-'));
    configPath = join(tmpDir, 'rbac.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('从磁盘加载角色配置', () => {
    const config: RbacConfig = { users: { alice: 'admin', bob: 'viewer' } };
    writeFileSync(configPath, JSON.stringify(config), 'utf-8');

    const m = loadRoles(configPath);
    expect(m.getUserRole('alice')).toBe('admin');
    expect(m.getUserRole('bob')).toBe('viewer');
  });

  it('文件不存在时返回空管理器', () => {
    const m = loadRoles(join(tmpDir, 'non-existent.json'));
    expect(m.listUsers()).toEqual([]);
  });
});

// ==================== 命令到权限映射 ====================

describe('COMMAND_PERMISSIONS', () => {
  it('review 命令映射到 review:run 权限', () => {
    expect(COMMAND_PERMISSIONS.review).toBe('review:run');
  });

  it('rules 命令映射到 rules:list 权限', () => {
    expect(COMMAND_PERMISSIONS.rules).toBe('rules:list');
  });

  it('publish 命令映射到 publish:run 权限', () => {
    expect(COMMAND_PERMISSIONS.publish).toBe('publish:run');
  });

  it('audit 命令映射到 audit:query 权限', () => {
    expect(COMMAND_PERMISSIONS.audit).toBe('audit:query');
  });

  it('compliance 命令映射到 compliance:run 权限', () => {
    expect(COMMAND_PERMISSIONS.compliance).toBe('compliance:run');
  });
});

// ==================== CLI 集成：权限校验 ====================

describe('CLI: RBAC 权限校验', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rbac-cli-'));
    configPath = join(tmpDir, 'rbac.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('未配置 RBAC 文件时使用默认 viewer，只读命令可执行', async () => {
    const { exitCode } = await loadCli({
      argv: ['rules', 'list', '--config', join(tmpDir, 'rules.json')],
      env: {
        CODE_REVIEW_RBAC_CONFIG: join(tmpDir, 'non-existent.json'),
        CODE_REVIEW_USER: 'guest',
      },
    });
    // 默认 viewer 拥有 rules:list，应允许执行
    expect(exitCode).not.toBe(1);
  });

  it('viewer 执行 admin 专属命令被拒绝并退出 1', async () => {
    // 准备 RBAC 配置：carol = viewer
    writeFileSync(
      configPath,
      JSON.stringify({ users: { carol: 'viewer' } }),
      'utf-8',
    );

    const { stderr, exitCode } = await loadCli({
      argv: ['rules', 'disable', 'SEC001', '--config', join(tmpDir, 'rules.json')],
      env: {
        CODE_REVIEW_RBAC_CONFIG: configPath,
        CODE_REVIEW_USER: 'carol',
      },
    });

    // rules:disable 是 admin 专属权限，viewer 不应有
    // 注意：rules disable 实际权限为 rules:disable
    expect(exitCode).toBe(1);
    expect(stderr.some((s) => s.toLowerCase().includes('permission') || s.toLowerCase().includes('denied'))).toBe(true);
  });

  it('admin 用户可以执行 admin 专属命令（rules disable）', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ users: { alice: 'admin' } }),
      'utf-8',
    );

    const { exitCode } = await loadCli({
      argv: ['rules', 'disable', 'SEC001', '--config', join(tmpDir, 'rules.json')],
      env: {
        CODE_REVIEW_RBAC_CONFIG: configPath,
        CODE_REVIEW_USER: 'alice',
      },
    });

    // alice 是 admin，拥有 rules:disable 权限，应允许执行
    expect(exitCode).not.toBe(1);
  });

  it('使用 CODE_REVIEW_ROLE 环境变量指定角色', async () => {
    const { exitCode } = await loadCli({
      argv: ['rules', 'list', '--config', join(tmpDir, 'rules.json')],
      env: {
        CODE_REVIEW_RBAC_CONFIG: join(tmpDir, 'non-existent.json'),
        CODE_REVIEW_ROLE: 'viewer',
      },
    });

    // viewer 拥有 rules:list
    expect(exitCode).not.toBe(1);
  });

  it('CODE_REVIEW_ROLE 为 admin 时拥有管理权限', async () => {
    const { exitCode } = await loadCli({
      argv: ['rules', 'list', '--config', join(tmpDir, 'rules.json')],
      env: {
        CODE_REVIEW_RBAC_CONFIG: join(tmpDir, 'non-existent.json'),
        CODE_REVIEW_ROLE: 'admin',
      },
    });

    expect(exitCode).not.toBe(1);
  });

  it('未指定用户与角色时默认 viewer，可执行只读命令', async () => {
    const { exitCode } = await loadCli({
      argv: ['rules', 'list', '--config', join(tmpDir, 'rules.json')],
      env: {
        CODE_REVIEW_RBAC_CONFIG: join(tmpDir, 'non-existent.json'),
      },
    });

    expect(exitCode).not.toBe(1);
  });
});
