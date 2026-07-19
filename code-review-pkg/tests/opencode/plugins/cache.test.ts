import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CacheManager } from '../../../src/cache.js';

const PLUGIN_PATH = '../../../opencode-config/.opencode/plugins/post-process.js';

async function loadPlugin() {
  const mod = await import(PLUGIN_PATH);
  return mod.default;
}

describe('post-process.js afterBuild hook cache hit stats', () => {
  let dir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cache-test-'));
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it('afterBuild 输出缓存命中统计信息', async () => {
    const plugin = await loadPlugin();
    const cache = new CacheManager({ diskCacheDir: dir });

    cache.set('ocr:diff:abc', { path: 'file.ts' });
    cache.set('ocr:rules:v1:file.ts:hash1:hash2', []);
    cache.set('ocr:mcp:def', { filePaths: [] });

    cache.get('ocr:diff:abc');
    cache.get('ocr:diff:abc');
    cache.get('ocr:diff:miss');

    cache.get('ocr:rules:v1:file.ts:hash1:hash2');
    cache.get('ocr:rules:v1:file.ts:hash1:miss');

    cache.get('ocr:mcp:def');
    cache.get('ocr:mcp:def');
    cache.get('ocr:mcp:def');
    cache.get('ocr:mcp:miss');

    const mockResult = {
      filteredDiffs: [],
      bundles: [],
      annotatedBundles: [],
      prompt: '',
    };

    await plugin.hooks.afterBuild(mockResult, { cache });

    expect(consoleLogSpy).toHaveBeenCalled();
    const logCall = consoleLogSpy.mock.calls.find((call) =>
      String(call[0]).includes('[cache]'),
    );
    expect(logCall).toBeDefined();
    expect(String(logCall[0])).toMatch(/\[cache\] hit:/);
    expect(String(logCall[0])).toMatch(/diff=\d+%/);
    expect(String(logCall[0])).toMatch(/rules=\d+%/);
    expect(String(logCall[0])).toMatch(/mcp=\d+%/);
  });

  it('afterBuild 输出正确的命中率百分比', async () => {
    const plugin = await loadPlugin();
    const cache = new CacheManager({ diskCacheDir: dir });

    cache.set('ocr:diff:test', {});
    cache.get('ocr:diff:test');
    cache.get('ocr:diff:test');
    cache.get('ocr:diff:miss');

    cache.set('ocr:rules:v1:file:hash', []);
    cache.get('ocr:rules:v1:file:hash');
    cache.get('ocr:rules:v1:file:miss');

    cache.set('ocr:mcp:test', {});
    cache.get('ocr:mcp:test');

    await plugin.hooks.afterBuild({}, { cache });

    const logCall = consoleLogSpy.mock.calls.find((call) =>
      String(call[0]).includes('[cache]'),
    );
    expect(String(logCall[0])).toContain('diff=67%');
    expect(String(logCall[0])).toContain('rules=50%');
    expect(String(logCall[0])).toContain('mcp=100%');
  });

  it('afterBuild 无缓存时不输出统计', async () => {
    const plugin = await loadPlugin();

    await plugin.hooks.afterBuild({}, {});

    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('[cache]'),
    );
  });

  it('afterBuild 缓存无 getCategoryHitStats 方法时不输出统计', async () => {
    const plugin = await loadPlugin();
    const mockCache = {
      getHitStats: () => ({ hits: 1, misses: 0, total: 1, hitRate: 1 }),
    };

    await plugin.hooks.afterBuild({}, { cache: mockCache });

    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('[cache]'),
    );
  });

  it('afterBuild 输出格式符合要求: [cache] hit: diff=XX% rules=XX% mcp=XX%', async () => {
    const plugin = await loadPlugin();
    const cache = new CacheManager({ diskCacheDir: dir });

    cache.set('ocr:diff:test', {});
    cache.get('ocr:diff:test');

    cache.set('ocr:rules:v1:file:hash', []);
    cache.get('ocr:rules:v1:file:hash');

    cache.set('ocr:mcp:test', {});
    cache.get('ocr:mcp:test');

    await plugin.hooks.afterBuild({}, { cache });

    const logCall = consoleLogSpy.mock.calls.find((call) =>
      String(call[0]).includes('[cache]'),
    );
    const logMessage = String(logCall[0]);
    expect(logMessage).toMatch(/^\[cache\] hit: diff=\d+% rules=\d+% mcp=\d+%$/);
  });

  it('afterBuild 空统计时输出 0%', async () => {
    const plugin = await loadPlugin();
    const cache = new CacheManager({ diskCacheDir: dir });

    await plugin.hooks.afterBuild({}, { cache });

    const logCall = consoleLogSpy.mock.calls.find((call) =>
      String(call[0]).includes('[cache]'),
    );
    expect(String(logCall[0])).toContain('diff=0%');
    expect(String(logCall[0])).toContain('rules=0%');
    expect(String(logCall[0])).toContain('mcp=0%');
  });
});