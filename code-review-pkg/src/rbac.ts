// src/rbac.ts — Task 10：RBAC 权限控制
//
// 职责：
// 1. ROLES 常量：定义内置角色 admin / reviewer / viewer
// 2. RbacManager 类：管理用户-角色映射、角色-权限映射，提供权限检查接口
// 3. checkPermission：便捷函数，校验用户是否拥有指定权限
// 4. loadRoles：从磁盘加载角色配置（持久化跨进程）
//
// 设计取舍：
// - 内置角色采用层级继承：admin 继承 reviewer 权限，reviewer 继承 viewer 权限
// - 权限以字符串表示（例如 "review:run"、"rules:override"），由调用方约定
// - 角色配置以 JSON 持久化，便于跨 CLI 调用复用
// - 默认未分配角色的用户视为 viewer（最小权限原则）
//
// 与 cli.ts 集成：
// - 在执行命令前调用 checkPermission 校验当前用户角色
// - 通过 --user / --role 标志或环境变量 CODE_REVIEW_USER / CODE_REVIEW_ROLE 传入身份

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** 角色名称 */
export type RoleName = 'admin' | 'reviewer' | 'viewer';

/** 内置角色常量：admin / reviewer / viewer */
export const ROLES: Record<RoleName, RoleName> = {
  admin: 'admin',
  reviewer: 'reviewer',
  viewer: 'viewer',
};

/** 角色继承关系：admin > reviewer > viewer */
const ROLE_INHERITANCE: Record<RoleName, RoleName | undefined> = {
  admin: 'reviewer',
  reviewer: 'viewer',
  viewer: undefined,
};

/** 默认角色配置文件名 */
export const DEFAULT_RBAC_CONFIG_FILE = '.code-review-rbac.json';

/** 角色配置（持久化结构） */
export interface RbacConfig {
  /** 用户名 -> 角色名 */
  users: Record<string, RoleName>;
  /** 角色名 -> 权限列表（自定义角色扩展，覆盖内置权限） */
  customPermissions?: Record<string, string[]>;
}

/**
 * 内置角色权限映射（已展开继承关系）。
 *
 * - viewer：只读权限，可查看审查结果、规则列表、度量指标、审计日志
 * - reviewer：viewer + 执行审查、提交反馈
 * - admin：reviewer + 规则覆盖/禁用/启用、发布评论、初始化、合规检查
 */
const BUILTIN_PERMISSIONS: Record<RoleName, string[]> = {
  viewer: [
    'review:view',
    'rules:list',
    'rules:show',
    'metrics:view',
    'dashboard:view',
    'audit:query',
    'compliance:view',
    'feedback:view',
    'parse:run',
  ],
  reviewer: [
    'review:run',
    'security-review:run',
    'scan:run',
    'impact:run',
    'reflect:run',
    'feedback:submit',
    'incremental:run',
    'stream:view',
  ],
  admin: [
    'rules:override',
    'rules:disable',
    'rules:enable',
    'publish:run',
    'init:run',
    'audit:export',
    'compliance:run',
  ],
};

/**
 * 解析角色对应的全部权限（含继承）。
 *
 * 继承链：admin → reviewer → viewer
 *
 * @param role 角色名
 * @param customPermissions 自定义角色权限覆盖（可选）
 * @returns 该角色拥有的所有权限字符串
 */
export function resolveRolePermissions(
  role: RoleName,
  customPermissions?: Record<string, string[]>,
): string[] {
  const perms = new Set<string>();
  let current: RoleName | undefined = role;
  const seen = new Set<RoleName>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const list = customPermissions?.[current] ?? BUILTIN_PERMISSIONS[current] ?? [];
    for (const p of list) perms.add(p);
    current = ROLE_INHERITANCE[current];
  }
  return [...perms];
}

/**
 * 判断一个角色名是否为合法的内置角色。
 */
export function isValidRole(role: string): role is RoleName {
  return role === 'admin' || role === 'reviewer' || role === 'viewer';
}

/**
 * RBAC 管理器：维护用户-角色映射，提供权限检查接口。
 *
 * 使用方式：
 * 1. const mgr = new RbacManager() — 内存模式
 * 2. mgr.assignRole('alice', 'admin') — 分配角色
 * 3. mgr.checkPermission('alice', 'review:run') — 校验权限
 * 4. const mgr2 = RbacManager.loadFromFile(path) — 从磁盘加载
 * 5. mgr2.saveToFile(path) — 持久化到磁盘
 */
export class RbacManager {
  /** 用户名 -> 角色名 */
  private userRoles: Map<string, RoleName> = new Map();
  /** 自定义角色权限覆盖 */
  private customPermissions: Record<string, string[]> | undefined;

  constructor(options?: {
    initialUsers?: Record<string, RoleName>;
    customPermissions?: Record<string, string[]>;
  }) {
    if (options?.initialUsers) {
      for (const [user, role] of Object.entries(options.initialUsers)) {
        if (isValidRole(role)) {
          this.userRoles.set(user, role);
        }
      }
    }
    this.customPermissions = options?.customPermissions;
  }

  /**
   * 为用户分配角色（覆盖旧角色）。
   * @throws 当角色名非法时抛出错误
   */
  assignRole(user: string, role: RoleName): void {
    if (!user || typeof user !== 'string') {
      throw new Error('user must be a non-empty string');
    }
    if (!isValidRole(role)) {
      throw new Error(`invalid role: ${role}`);
    }
    this.userRoles.set(user, role);
  }

  /** 查询用户角色，未分配时返回 undefined */
  getUserRole(user: string): RoleName | undefined {
    return this.userRoles.get(user);
  }

  /**
   * 查询用户角色，未分配时返回默认角色（viewer）。
   */
  getUserRoleOrDefault(user: string): RoleName {
    return this.userRoles.get(user) ?? 'viewer';
  }

  /** 返回用户拥有的所有权限（含继承） */
  getUserPermissions(user: string): string[] {
    const role = this.getUserRoleOrDefault(user);
    return resolveRolePermissions(role, this.customPermissions);
  }

  /**
   * 校验用户是否拥有指定权限。
   *
   * - 未分配角色的用户默认为 viewer，仅拥有 viewer 权限
   * - 权限字符串精确匹配（不支持通配符）
   *
   * @param user 用户名
   * @param permission 权限字符串
   * @returns true 表示用户拥有该权限
   */
  checkPermission(user: string, permission: string): boolean {
    if (!permission || typeof permission !== 'string') return false;
    const perms = this.getUserPermissions(user);
    return perms.includes(permission);
  }

  /**
   * 校验用户是否拥有给定权限中的任意一个。
   *
   * @param user 用户名
   * @param permissions 权限字符串数组
   * @returns true 表示用户拥有至少一个权限
   */
  hasAnyPermission(user: string, permissions: string[]): boolean {
    if (!permissions || permissions.length === 0) return false;
    const perms = this.getUserPermissions(user);
    return permissions.some((p) => perms.includes(p));
  }

  /** 列出所有已分配角色的用户 */
  listUsers(): Array<{ user: string; role: RoleName }> {
    return [...this.userRoles.entries()].map(([user, role]) => ({ user, role }));
  }

  /** 移除用户的角色分配 */
  removeUser(user: string): boolean {
    return this.userRoles.delete(user);
  }

  /** 获取内置角色权限（含继承展开） */
  getBuiltinPermissions(): Record<RoleName, string[]> {
    return {
      admin: resolveRolePermissions('admin'),
      reviewer: resolveRolePermissions('reviewer'),
      viewer: resolveRolePermissions('viewer'),
    };
  }

  /**
   * 将当前配置持久化到磁盘。
   */
  saveToFile(configPath: string = DEFAULT_RBAC_CONFIG_FILE): void {
    const config: RbacConfig = {
      users: Object.fromEntries(this.userRoles),
      customPermissions: this.customPermissions,
    };
    const dir = dirname(configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  /**
   * 从磁盘加载配置（覆盖当前内存状态）。
   *
   * 文件不存在或解析失败时返回空配置实例。
   */
  static loadFromFile(configPath: string = DEFAULT_RBAC_CONFIG_FILE): RbacManager {
    if (!existsSync(configPath)) {
      return new RbacManager();
    }
    try {
      const content = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(content) as Partial<RbacConfig>;
      const users: Record<string, RoleName> = {};
      if (parsed.users && typeof parsed.users === 'object') {
        for (const [u, r] of Object.entries(parsed.users)) {
          if (typeof r === 'string' && isValidRole(r)) {
            users[u] = r;
          }
        }
      }
      return new RbacManager({
        initialUsers: users,
        customPermissions:
          parsed.customPermissions && typeof parsed.customPermissions === 'object'
            ? parsed.customPermissions
            : undefined,
      });
    } catch {
      return new RbacManager();
    }
  }
}

/**
 * 便捷函数：使用默认 RbacManager 校验用户权限。
 *
 * @param user 用户名
 * @param permission 权限字符串
 * @param manager RBAC 管理器实例（可选，默认新建一个空实例）
 * @returns true 表示用户拥有该权限
 */
export function checkPermission(
  user: string,
  permission: string,
  manager?: RbacManager,
): boolean {
  const mgr = manager ?? new RbacManager();
  return mgr.checkPermission(user, permission);
}

/**
 * 从磁盘加载角色配置，返回 RbacManager 实例。
 *
 * 文件不存在或解析失败时返回空配置实例。
 *
 * @param configPath 配置文件路径
 */
export function loadRoles(configPath: string = DEFAULT_RBAC_CONFIG_FILE): RbacManager {
  return RbacManager.loadFromFile(configPath);
}

/**
 * 顶层命令到默认权限的映射。
 *
 * `rules` 命令默认需要 `rules:list`（只读），具体子命令权限由
 * `getRequiredPermission` 在调用时按子命令精细判定。
 */
export const COMMAND_PERMISSIONS: Record<string, string> = {
  parse: 'review:view',
  review: 'review:run',
  'security-review': 'security-review:run',
  scan: 'scan:run',
  impact: 'impact:run',
  reflect: 'reflect:run',
  publish: 'publish:run',
  init: 'init:run',
  feedback: 'feedback:submit',
  metrics: 'metrics:view',
  dashboard: 'dashboard:view',
  rules: 'rules:list',
  audit: 'audit:query',
  compliance: 'compliance:run',
};

/** rules 子命令 → 权限映射 */
const RULES_SUBCOMMAND_PERMISSIONS: Record<string, string> = {
  list: 'rules:list',
  show: 'rules:show',
  disable: 'rules:disable',
  enable: 'rules:enable',
  override: 'rules:override',
};

/**
 * 根据命令与子命令获取所需权限。
 *
 * - `rules` 命令根据子命令精细判定（list/show/disable/enable/override）
 * - 其他命令使用 COMMAND_PERMISSIONS 中的默认映射
 * - 未识别命令返回 undefined（不强制权限校验）
 *
 * @param command 顶层命令
 * @param subcommand 子命令（可选，仅对 rules 命令有意义）
 * @returns 所需权限字符串，或 undefined
 */
export function getRequiredPermission(
  command: string,
  subcommand?: string,
): string | undefined {
  if (command === 'rules') {
    if (subcommand && RULES_SUBCOMMAND_PERMISSIONS[subcommand]) {
      return RULES_SUBCOMMAND_PERMISSIONS[subcommand];
    }
    return 'rules:list';
  }
  return COMMAND_PERMISSIONS[command];
}
