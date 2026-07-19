import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  L1MemoryCache,
  L2DiskCache,
  CacheManager,
  type CacheEntry,
  type HitStats,
} from '../src/cache.js';

// ==================== L1 内存缓存 ====================

describe('L1MemoryCache', () => {
  let cache: L1MemoryCache;

  beforeEach(() => {
    cache = new L1MemoryCache();
  });

  it('set/get 基本存取', () => {
    cache.set('k1', 'v1');
    expect(cache.get('k1')).toBe('v1');
  });

  it('set 覆盖已存在的 key', () => {
    cache.set('k1', 'v1');
    cache.set('k1', 'v2');
    expect(cache.get('k1')).toBe('v2');
  });

  it('get 不存在的 key 返回 undefined', () => {
    expect(cache.get('missing')).toBeUndefined();
  });

  it('has 正确判断 key 是否存在', () => {
    cache.set('k1', 'v1');
    expect(cache.has('k1')).toBe(true);
    expect(cache.has('missing')).toBe(false);
  });

  it('delete 删除存在的 key 返回 true', () => {
    cache.set('k1', 'v1');
    expect(cache.delete('k1')).toBe(true);
    expect(cache.has('k1')).toBe(false);
  });

  it('delete 不存在的 key 返回 false', () => {
    expect(cache.delete('missing')).toBe(false);
  });

  it('clear 清空所有条目', () => {
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');
    cache.clear();
    expect(cache.has('k1')).toBe(false);
    expect(cache.has('k2')).toBe(false);
    expect(cache.size()).toBe(0);
  });

  it('size 返回当前条目数', () => {
    expect(cache.size()).toBe(0);
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');
    expect(cache.size()).toBe(2);
  });

  it('keys 返回所有 key 数组', () => {
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');
    const keys = cache.keys();
    expect(keys.sort()).toEqual(['k1', 'k2']);
  });

  it('支持任意可序列化值（对象、数组、数字）', () => {
    cache.set('obj', { a: 1, b: 'two' });
    cache.set('arr', [1, 2, 3]);
    cache.set('num', 42);
    expect(cache.get('obj')).toEqual({ a: 1, b: 'two' });
    expect(cache.get('arr')).toEqual([1, 2, 3]);
    expect(cache.get('num')).toBe(42);
  });

  it('支持存储 null 与 false 值', () => {
    cache.set('null', null);
    cache.set('false', false);
    expect(cache.get('null')).toBeNull();
    expect(cache.get('false')).toBe(false);
    expect(cache.has('false')).toBe(true);
  });

  it('支持按 TTL 失效：过期后 get 返回 undefined', async () => {
    cache.set('ttl', 'v', { ttl: 20 });
    expect(cache.get('ttl')).toBe('v');
    await new Promise((r) => setTimeout(r, 30));
    expect(cache.get('ttl')).toBeUndefined();
  });

  it('TTL 过期后 has 返回 false', async () => {
    cache.set('ttl', 'v', { ttl: 10 });
    await new Promise((r) => setTimeout(r, 20));
    expect(cache.has('ttl')).toBe(false);
  });

  it('TTL 过期后 size 自动减 1', async () => {
    cache.set('ttl', 'v', { ttl: 10 });
    expect(cache.size()).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(cache.size()).toBe(0);
  });

  it('keys 返回未过期的 key 列表', async () => {
    cache.set('k1', 'v1', { ttl: 10 });
    cache.set('k2', 'v2');
    await new Promise((r) => setTimeout(r, 20));
    expect(cache.keys()).toEqual(['k2']);
  });

  it('未设置 TTL 时永久有效', async () => {
    cache.set('forever', 'v');
    await new Promise((r) => setTimeout(r, 10));
    expect(cache.has('forever')).toBe(true);
  });

  it('setOptions 不传 ttl 时不影响已有 TTL', () => {
    cache.set('k', 'v', { ttl: 1000 });
    cache.set('k', 'v2'); // 不传 TTL，应保持原 TTL 还是重置？规范：重置为永久
    expect(cache.get('k')).toBe('v2');
  });

  it('set 可更新 TTL', () => {
    cache.set('k', 'v', { ttl: 10 });
    cache.set('k', 'v2', { ttl: 10000 });
    expect(cache.get('k')).toBe('v2');
  });
});

// ==================== L2 磁盘缓存 ====================

describe('L2DiskCache', () => {
  let dir: string;
  let cache: L2DiskCache;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cache-l2-'));
    cache = new L2DiskCache({ cacheDir: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('set/get 基本存取', () => {
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('set 写入磁盘文件', () => {
    cache.set('disk1', 'v1');
    // 文件名通常是 hash(key).json
    const files = cache.keys();
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it('get 不存在的 key 返回 undefined', () => {
    expect(cache.get('nope')).toBeUndefined();
  });

  it('has 判断 key 是否存在', () => {
    cache.set('k', 'v');
    expect(cache.has('k')).toBe(true);
    expect(cache.has('missing')).toBe(false);
  });

  it('delete 删除磁盘文件', () => {
    cache.set('k', 'v');
    expect(cache.delete('k')).toBe(true);
    expect(cache.has('k')).toBe(false);
    expect(cache.get('k')).toBeUndefined();
  });

  it('delete 不存在的 key 返回 false', () => {
    expect(cache.delete('ghost')).toBe(false);
  });

  it('clear 清空所有磁盘文件', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.keys()).toHaveLength(0);
    expect(cache.size()).toBe(0);
  });

  it('支持存储对象', () => {
    cache.set('obj', { name: 'test', value: 42 });
    expect(cache.get('obj')).toEqual({ name: 'test', value: 42 });
  });

  it('重启实例后能从磁盘恢复数据', () => {
    cache.set('persist', 'me');
    const cache2 = new L2DiskCache({ cacheDir: dir });
    expect(cache2.get('persist')).toBe('me');
  });

  it('TTL 过期后 get 返回 undefined', async () => {
    cache.set('k', 'v', { ttl: 20 });
    expect(cache.get('k')).toBe('v');
    await new Promise((r) => setTimeout(r, 30));
    expect(cache.get('k')).toBeUndefined();
  });

  it('TTL 过期后 has 返回 false', async () => {
    cache.set('k', 'v', { ttl: 10 });
    await new Promise((r) => setTimeout(r, 20));
    expect(cache.has('k')).toBe(false);
  });

  it('cacheDir 不存在时自动创建', () => {
    const newDir = join(dir, 'subdir');
    const c = new L2DiskCache({ cacheDir: newDir });
    c.set('k', 'v');
    expect(c.get('k')).toBe('v');
    expect(existsSync(newDir)).toBe(true);
  });

  it('keys 返回所有缓存的 key', () => {
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');
    const keys = cache.keys().sort();
    expect(keys).toEqual(['k1', 'k2']);
  });

  it('size 返回缓存条目数', () => {
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');
    expect(cache.size()).toBe(2);
  });

  it('文件损坏时 get 返回 undefined', () => {
    cache.set('broken', 'v');
    // 找到对应文件并破坏内容
    const files = cache.keys();
    for (const key of files) {
      const file = (cache as any).keyToFilePath(key);
      writeFileSync(file, 'not json {', 'utf8');
    }
    expect(cache.get('broken')).toBeUndefined();
  });
});

// ==================== CacheManager 三级缓存 ====================

describe('CacheManager', () => {
  let dir: string;
  let mgr: CacheManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cache-mgr-'));
    mgr = new CacheManager({ diskCacheDir: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('set/get 同时写入 L1 与 L2', () => {
    mgr.set('k1', 'v1');
    expect(mgr.get('k1')).toBe('v1');
    // L1 命中
    expect(mgr.getL1().has('k1')).toBe(true);
    // L2 也存在
    expect(mgr.getL2().has('k1')).toBe(true);
  });

  it('L1 命中时不读 L2', () => {
    mgr.set('k1', 'v1');
    // 删除 L2 数据，L1 仍能命中
    mgr.getL2().delete('k1');
    expect(mgr.get('k1')).toBe('v1');
  });

  it('L1 未命中时回退到 L2', () => {
    mgr.set('k1', 'v1');
    mgr.getL1().delete('k1');
    expect(mgr.getL1().has('k1')).toBe(false);
    expect(mgr.get('k1')).toBe('v1');
    // 命中后应回填 L1
    expect(mgr.getL1().has('k1')).toBe(true);
  });

  it('L1 与 L2 都未命中返回 undefined', () => {
    expect(mgr.get('ghost')).toBeUndefined();
  });

  it('has 检查 L1 或 L2 任一存在', () => {
    mgr.set('k', 'v');
    expect(mgr.has('k')).toBe(true);
    mgr.getL1().delete('k');
    expect(mgr.has('k')).toBe(true); // L2 仍在
    mgr.getL2().delete('k');
    expect(mgr.has('k')).toBe(false);
  });

  it('delete 同时删除 L1 与 L2', () => {
    mgr.set('k', 'v');
    expect(mgr.delete('k')).toBe(true);
    expect(mgr.getL1().has('k')).toBe(false);
    expect(mgr.getL2().has('k')).toBe(false);
  });

  it('delete 不存在的 key 返回 false', () => {
    expect(mgr.delete('ghost')).toBe(false);
  });

  it('clear 同时清空 L1 与 L2', () => {
    mgr.set('k1', 'v1');
    mgr.set('k2', 'v2');
    mgr.clear();
    expect(mgr.getL1().size()).toBe(0);
    expect(mgr.getL2().size()).toBe(0);
  });

  it('支持 TTL 失效（L1 与 L2 同时）', async () => {
    mgr.set('k', 'v', { ttl: 20 });
    expect(mgr.get('k')).toBe('v');
    await new Promise((r) => setTimeout(r, 30));
    expect(mgr.get('k')).toBeUndefined();
  });

  it('按 key 前缀失效', () => {
    mgr.set('user:1', 'a');
    mgr.set('user:2', 'b');
    mgr.set('post:1', 'c');
    const deleted = mgr.invalidateByPrefix('user:');
    expect(deleted).toBe(2);
    expect(mgr.has('user:1')).toBe(false);
    expect(mgr.has('user:2')).toBe(false);
    expect(mgr.has('post:1')).toBe(true);
  });

  it('按 key 前缀失效（无匹配返回 0）', () => {
    expect(mgr.invalidateByPrefix('nonexistent:')).toBe(0);
  });

  it('按 key 前缀失效：空字符串前缀匹配所有', () => {
    mgr.set('a', '1');
    mgr.set('b', '2');
    expect(mgr.invalidateByPrefix('')).toBe(2);
    expect(mgr.size()).toBe(0);
  });

  it('invalidateByPrefix 同时清理 L1 与 L2', () => {
    mgr.set('user:1', 'a');
    mgr.set('user:2', 'b');
    mgr.invalidateByPrefix('user:');
    expect(mgr.getL1().keys().length).toBe(0);
    expect(mgr.getL2().keys().length).toBe(0);
  });

  it('按 pattern（正则）失效', () => {
    mgr.set('user:1:profile', 'a');
    mgr.set('user:1:settings', 'b');
    mgr.set('user:2:profile', 'c');
    const deleted = mgr.invalidateByPattern(/^user:1:/);
    expect(deleted).toBe(2);
    expect(mgr.has('user:1:profile')).toBe(false);
    expect(mgr.has('user:1:settings')).toBe(false);
    expect(mgr.has('user:2:profile')).toBe(true);
  });

  it('getHitStats 初始命中率为 0', () => {
    const stats = mgr.getHitStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.total).toBe(0);
    expect(stats.hitRate).toBe(0);
  });

  it('getHitStats 累加 hits / misses', () => {
    mgr.set('k', 'v');
    mgr.get('k'); // hit L1
    mgr.get('k'); // hit L1
    mgr.get('missing'); // miss
    const stats = mgr.getHitStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.total).toBe(3);
    expect(stats.hitRate).toBeCloseTo(2 / 3, 5);
  });

  it('L2 命中也算 hit', () => {
    mgr.set('k', 'v');
    mgr.getL1().delete('k');
    const v = mgr.get('k');
    expect(v).toBe('v');
    const stats = mgr.getHitStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(0);
  });

  it('resetHitStats 重置统计', () => {
    mgr.set('k', 'v');
    mgr.get('k');
    mgr.get('missing');
    mgr.resetHitStats();
    const stats = mgr.getHitStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
  });

  it('getOrCreate 缓存命中时不调用 factory', () => {
    mgr.set('k', 'cached');
    let called = 0;
    const v = mgr.getOrCreate('k', () => {
      called++;
      return 'fresh';
    });
    expect(v).toBe('cached');
    expect(called).toBe(0);
  });

  it('getOrCreate 缓存未命中时调用 factory 并写入', () => {
    let called = 0;
    const v = mgr.getOrCreate('new-key', () => {
      called++;
      return 'fresh';
    });
    expect(v).toBe('fresh');
    expect(called).toBe(1);
    expect(mgr.get('new-key')).toBe('fresh');
  });

  it('getOrCreate 同时支持 async factory', async () => {
    const v = await mgr.getOrCreate('async-key', async () => {
      return 'async-value';
    });
    expect(v).toBe('async-value');
    expect(mgr.get('async-key')).toBe('async-value');
  });

  it('getOrCreate 支持 TTL 选项', async () => {
    await mgr.getOrCreate('ttl-key', async () => 'v', { ttl: 20 });
    expect(mgr.get('ttl-key')).toBe('v');
    await new Promise((r) => setTimeout(r, 30));
    expect(mgr.get('ttl-key')).toBeUndefined();
  });

  it('getOrCreate factory 抛出错误时不缓存', async () => {
    await expect(
      mgr.getOrCreate('err-key', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(mgr.has('err-key')).toBe(false);
  });

  it('getOrCreate 同步 factory 抛出错误时不缓存', () => {
    expect(() =>
      mgr.getOrCreate('err-sync', () => {
        throw new Error('sync-boom');
      }),
    ).toThrow('sync-boom');
    expect(mgr.has('err-sync')).toBe(false);
  });

  it('getOrCreate L1 未命中但 L2 命中时不调用 factory', () => {
    mgr.set('l2-only', 'cached');
    mgr.getL1().delete('l2-only');
    let called = 0;
    const v = mgr.getOrCreate('l2-only', () => {
      called++;
      return 'fresh';
    });
    expect(v).toBe('cached');
    expect(called).toBe(0);
    // 命中后应回填 L1
    expect(mgr.getL1().has('l2-only')).toBe(true);
  });

  it('getOrCreate 禁用 L2 时只查 L1', () => {
    const m = new CacheManager({ diskCacheDir: dir, enableL2: false });
    let called = 0;
    const v = m.getOrCreate('k', () => {
      called++;
      return 'fresh';
    });
    expect(v).toBe('fresh');
    expect(called).toBe(1);
    expect(m.get('k')).toBe('fresh');
  });

  it('禁用 L2 时只使用 L1', () => {
    const m = new CacheManager({ diskCacheDir: dir, enableL2: false });
    m.set('k', 'v');
    expect(m.get('k')).toBe('v');
    expect(m.getL1().has('k')).toBe(true);
    expect(m.getL2().size()).toBe(0);
  });

  it('getL1 / getL2 暴露内部缓存实例', () => {
    expect(mgr.getL1()).toBeInstanceOf(L1MemoryCache);
    expect(mgr.getL2()).toBeInstanceOf(L2DiskCache);
  });

  it('size 返回 L1 条目数（L1 反映活跃缓存）', () => {
    mgr.set('k1', 'v1');
    mgr.set('k2', 'v2');
    expect(mgr.size()).toBe(2);
  });

  it('keys 返回 L1 与 L2 的并集', () => {
    mgr.set('k1', 'v1');
    mgr.set('k2', 'v2');
    // 手动只在 L2 添加一项
    mgr.getL2().set('only-l2', 'v');
    const keys = mgr.keys().sort();
    expect(keys).toEqual(['k1', 'k2', 'only-l2']);
  });

  it('从已有磁盘目录加载历史缓存', () => {
    mgr.set('p1', 'v1');
    mgr.set('p2', 'v2');
    // 新建 manager 指向同一目录
    const mgr2 = new CacheManager({ diskCacheDir: dir });
    expect(mgr2.getL2().has('p1')).toBe(true);
    expect(mgr2.getL2().has('p2')).toBe(true);
  });
});

// ==================== 类型导出校验 ====================

describe('类型导出', () => {
  it('CacheEntry 类型存在并可被引用', () => {
    const entry: CacheEntry<string> = { value: 'v', createdAt: Date.now() };
    expect(entry.value).toBe('v');
    expect(entry.createdAt).toBeTypeOf('number');
  });

  it('HitStats 类型存在并可被引用', () => {
    const stats: HitStats = { hits: 1, misses: 0, total: 1, hitRate: 1 };
    expect(stats.hits).toBe(1);
    expect(stats.hitRate).toBe(1);
  });
});
