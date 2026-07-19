// src/cache.ts — 三级缓存管理器
//
// L1：进程内 Map（最快，进程退出即丢失）
// L2：磁盘 JSON 文件（跨进程共享，重启可恢复）
// CacheManager：组合 L1+L2，提供智能失效、命中统计、getOrCreate 等高级能力

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/** 单条缓存记录 */
export interface CacheEntry<T> {
  /** 缓存值 */
  value: T;
  /** 创建时间戳（ms） */
  createdAt: number;
  /** 过期时间戳（ms），undefined 表示永久 */
  expiresAt?: number;
}

/** 命中统计 */
export interface HitStats {
  /** 命中次数 */
  hits: number;
  /** 未命中次数 */
  misses: number;
  /** 总查询次数 */
  total: number;
  /** 命中率（0-1） */
  hitRate: number;
}

/** set 操作选项 */
export interface CacheSetOptions {
  /** TTL 毫秒数；undefined 表示永久 */
  ttl?: number;
}

/** L2 磁盘缓存条目（含原始 key 用于加载索引） */
interface StoredEntry<T> extends CacheEntry<T> {
  key: string;
}

/** L2 构造选项 */
export interface L2DiskCacheOptions {
  /** 缓存目录路径 */
  cacheDir: string;
}

/**
 * 计算 key 对应的稳定文件名（SHA-1 hex）。
 * 使用哈希避免特殊字符在文件名中产生问题。
 */
function hashKey(key: string): string {
  return createHash('sha1').update(key, 'utf8').digest('hex');
}

// ==================== L1 内存缓存 ====================

/**
 * L1 进程内内存缓存。
 * 基于 Map 实现，支持 TTL 失效。
 */
export class L1MemoryCache {
  private map: Map<string, CacheEntry<unknown>> = new Map();

  /** 写入缓存 */
  set<T>(key: string, value: T, opts?: CacheSetOptions): void {
    const now = Date.now();
    const entry: CacheEntry<unknown> = {
      value,
      createdAt: now,
      expiresAt: opts?.ttl != null ? now + opts.ttl : undefined,
    };
    this.map.set(key, entry);
  }

  /** 读取底层 entry（不删除过期项） */
  private getEntry<T>(key: string): CacheEntry<T> | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt != null && Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return entry as unknown as CacheEntry<T>;
  }

  /** 读取缓存值，未命中或已过期返回 undefined */
  get<T>(key: string): T | undefined {
    const entry = this.getEntry<T>(key);
    return entry ? entry.value : undefined;
  }

  /** 判断 key 是否存在且未过期 */
  has(key: string): boolean {
    return this.getEntry(key) !== null;
  }

  /** 删除 key，返回是否实际删除 */
  delete(key: string): boolean {
    return this.map.delete(key);
  }

  /** 清空所有缓存 */
  clear(): void {
    this.map.clear();
  }

  /** 当前缓存条目数（自动清理已过期项） */
  size(): number {
    this.sweepExpired();
    return this.map.size;
  }

  /** 返回所有 key（会触发过期检查） */
  keys(): string[] {
    const result: string[] = [];
    for (const key of Array.from(this.map.keys())) {
      if (this.getEntry(key) !== null) {
        result.push(key);
      }
    }
    return result;
  }

  /** 清理所有已过期的条目 */
  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (entry.expiresAt != null && now > entry.expiresAt) {
        this.map.delete(key);
      }
    }
  }
}

// ==================== L2 磁盘缓存 ====================

/**
 * L2 磁盘缓存：每个 key 一个 JSON 文件，跨进程共享。
 * 实例化时自动加载已存在的缓存索引；写入时同步落盘。
 */
export class L2DiskCache {
  private readonly cacheDir: string;
  /** key -> 文件名 映射，避免每次都遍历目录 */
  private keyToFilename: Map<string, string> = new Map();

  constructor(options: L2DiskCacheOptions) {
    this.cacheDir = options.cacheDir;
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    } else {
      this.loadIndex();
    }
  }

  /** 扫描缓存目录，重建 key -> filename 索引 */
  private loadIndex(): void {
    let files: string[];
    try {
      files = readdirSync(this.cacheDir);
    } catch {
      return;
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = readFileSync(join(this.cacheDir, file), 'utf8');
        const data = JSON.parse(raw) as StoredEntry<unknown>;
        if (data && typeof data.key === 'string') {
          this.keyToFilename.set(data.key, file);
        }
      } catch {
        // 损坏文件忽略，不加入索引
      }
    }
  }

  /** 计算 key 对应的磁盘文件路径 */
  keyToFilePath(key: string): string {
    const filename = this.keyToFilename.get(key) ?? `${hashKey(key)}.json`;
    return join(this.cacheDir, filename);
  }

  /** 写入磁盘缓存 */
  set<T>(key: string, value: T, opts?: CacheSetOptions): void {
    const now = Date.now();
    const filename = `${hashKey(key)}.json`;
    const entry: StoredEntry<T> = {
      key,
      value,
      createdAt: now,
      expiresAt: opts?.ttl != null ? now + opts.ttl : undefined,
    };
    writeFileSync(join(this.cacheDir, filename), JSON.stringify(entry), 'utf8');
    this.keyToFilename.set(key, filename);
  }

  /** 读取磁盘缓存，未命中/过期/损坏均返回 undefined */
  get<T>(key: string): T | undefined {
    const entry = this.getEntry<T>(key);
    return entry ? entry.value : undefined;
  }

  /** 读取底层 entry */
  private getEntry<T>(key: string): StoredEntry<T> | null {
    const filename = this.keyToFilename.get(key);
    if (!filename) return null;
    try {
      const raw = readFileSync(join(this.cacheDir, filename), 'utf8');
      const data = JSON.parse(raw) as StoredEntry<T>;
      if (data.expiresAt != null && Date.now() > data.expiresAt) {
        this.delete(key);
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  /** 判断 key 是否存在且未过期 */
  has(key: string): boolean {
    const filename = this.keyToFilename.get(key);
    if (!filename) return false;
    try {
      const raw = readFileSync(join(this.cacheDir, filename), 'utf8');
      const data = JSON.parse(raw) as StoredEntry<unknown>;
      if (data.expiresAt != null && Date.now() > data.expiresAt) {
        this.delete(key);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /** 删除磁盘缓存文件，返回是否实际删除 */
  delete(key: string): boolean {
    const filename = this.keyToFilename.get(key);
    if (!filename) return false;
    try {
      unlinkSync(join(this.cacheDir, filename));
    } catch {
      // 文件可能已被删除
    }
    return this.keyToFilename.delete(key);
  }

  /** 清空所有磁盘缓存文件 */
  clear(): void {
    for (const filename of Array.from(this.keyToFilename.values())) {
      try {
        unlinkSync(join(this.cacheDir, filename));
      } catch {
        // 忽略
      }
    }
    this.keyToFilename.clear();
  }

  /** 当前索引条目数 */
  size(): number {
    return this.keyToFilename.size;
  }

  /** 返回所有 key */
  keys(): string[] {
    return Array.from(this.keyToFilename.keys());
  }
}

// ==================== CacheManager 三级缓存管理器 ====================

/** CacheManager 构造选项 */
export interface CacheManagerOptions {
  /** L2 磁盘缓存目录 */
  diskCacheDir: string;
  /** 是否启用 L2（默认 true） */
  enableL2?: boolean;
}

/**
 * 三级缓存管理器：组合 L1（内存）+ L2（磁盘）。
 *
 * - 写入：同时写入 L1 与 L2（若启用）
 * - 读取：先查 L1，未命中查 L2，L2 命中后回填 L1
 * - 智能失效：支持按 TTL、key 前缀、正则失效
 * - 命中统计：自动累加 hits/misses，可调用 getHitStats 查看
 * - getOrCreate：缓存未命中时调用 factory 并自动写入
 */
export class CacheManager {
  private readonly l1: L1MemoryCache;
  private readonly l2: L2DiskCache;
  private readonly enableL2: boolean;
  private hits = 0;
  private misses = 0;

  constructor(options: CacheManagerOptions) {
    this.l1 = new L1MemoryCache();
    this.l2 = new L2DiskCache({ cacheDir: options.diskCacheDir });
    this.enableL2 = options.enableL2 !== false;
  }

  /** 获取内部 L1 实例（用于直接操作或测试） */
  getL1(): L1MemoryCache {
    return this.l1;
  }

  /** 获取内部 L2 实例（用于直接操作或测试） */
  getL2(): L2DiskCache {
    return this.l2;
  }

  /** 写入缓存（同时写入 L1 与 L2） */
  set<T>(key: string, value: T, opts?: CacheSetOptions): void {
    this.l1.set(key, value, opts);
    if (this.enableL2) {
      this.l2.set(key, value, opts);
    }
  }

  /**
   * 读取缓存：先查 L1，未命中查 L2，命中 L2 时回填 L1。
   * 自动累加 hits/misses。
   */
  get<T>(key: string): T | undefined {
    // L1 命中
    if (this.l1.has(key)) {
      this.hits++;
      return this.l1.get<T>(key);
    }
    // L1 未命中，尝试 L2
    if (this.enableL2 && this.l2.has(key)) {
      const v = this.l2.get<T>(key);
      // 回填 L1
      this.l1.set(key, v);
      this.hits++;
      return v;
    }
    // 全部未命中
    this.misses++;
    return undefined;
  }

  /** 判断 key 是否存在（L1 或 L2 任一存在即可） */
  has(key: string): boolean {
    if (this.l1.has(key)) return true;
    if (this.enableL2 && this.l2.has(key)) return true;
    return false;
  }

  /** 删除缓存（同时删除 L1 与 L2），返回是否实际删除 */
  delete(key: string): boolean {
    const d1 = this.l1.delete(key);
    const d2 = this.enableL2 ? this.l2.delete(key) : false;
    return d1 || d2;
  }

  /** 清空 L1 与 L2 */
  clear(): void {
    this.l1.clear();
    if (this.enableL2) {
      this.l2.clear();
    }
  }

  /** 返回 L1 当前条目数（活跃缓存指标） */
  size(): number {
    return this.l1.size();
  }

  /** 返回 L1 与 L2 的 key 并集 */
  keys(): string[] {
    const set = new Set<string>([...this.l1.keys(), ...this.l2.keys()]);
    return Array.from(set);
  }

  /**
   * 按 key 前缀失效：删除所有以 prefix 开头的 key。
   * 空字符串前缀匹配所有 key。
   * @returns 删除的唯一 key 数量
   */
  invalidateByPrefix(prefix: string): number {
    const l1Keys = this.l1.keys().filter((k) => k.startsWith(prefix));
    const l2Keys = this.enableL2
      ? this.l2.keys().filter((k) => k.startsWith(prefix))
      : [];
    const allKeys = new Set<string>([...l1Keys, ...l2Keys]);
    for (const key of allKeys) {
      this.l1.delete(key);
      if (this.enableL2) this.l2.delete(key);
    }
    return allKeys.size;
  }

  /**
   * 按正则失效：删除所有匹配 pattern 的 key。
   * @returns 删除的唯一 key 数量
   */
  invalidateByPattern(pattern: RegExp): number {
    const l1Keys = this.l1.keys().filter((k) => pattern.test(k));
    const l2Keys = this.enableL2
      ? this.l2.keys().filter((k) => pattern.test(k))
      : [];
    const allKeys = new Set<string>([...l1Keys, ...l2Keys]);
    for (const key of allKeys) {
      this.l1.delete(key);
      if (this.enableL2) this.l2.delete(key);
    }
    return allKeys.size;
  }

  /** 获取命中统计 */
  getHitStats(): HitStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      total,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /** 重置命中统计计数器 */
  resetHitStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * 缓存未命中时调用 factory 计算值并写入缓存。
   * 支持 sync 与 async factory。
   * @throws 当 factory 抛出错误时透传，且不写入缓存
   */
  getOrCreate<T>(
    key: string,
    factory: () => T | Promise<T>,
    opts?: CacheSetOptions,
  ): T | Promise<T> {
    // 先检查缓存命中
    if (this.l1.has(key)) {
      this.hits++;
      return this.l1.get<T>(key) as T;
    }
    if (this.enableL2 && this.l2.has(key)) {
      const v = this.l2.get<T>(key);
      this.l1.set(key, v);
      this.hits++;
      return v as T;
    }
    // 未命中，调用 factory
    this.misses++;
    try {
      const result = factory();
      if (result instanceof Promise) {
        return result.then((v) => {
          this.set(key, v, opts);
          return v;
        });
      }
      this.set(key, result, opts);
      return result;
    } catch (err) {
      throw err;
    }
  }
}
