import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Finding, FileDiff } from '../../../src/types.js';
import {
  loadIgnoreConfig,
  parseIgnoreContent,
  shouldIgnore,
  applyIgnoreRules,
} from '../../../src/ignore-manager.js';

const PLUGIN_PATH = '../../../opencode-config/.opencode/plugins/post-process.js';

async function loadPlugin() {
  const mod = await import(PLUGIN_PATH);
  return mod.default;
}

function makeFinding(overrides: Partial<Finding> & { file: string; line: number }): Finding {
  return {
    severity: 'low',
    category: 'quality',
    message: 'test finding',
    confidence: 0.8,
    source: 'rule',
    ...overrides,
  };
}

describe('ignore-manager: parseIgnoreContent', () => {
  it('解析空内容返回空 patterns', () => {
    const config = parseIgnoreContent('');
    expect(config.patterns).toEqual([]);
  });

  it('跳过空行和注释行', () => {
    const text = `
# 这是一行注释
   
# 又一行注释
dist/**
`;
    const config = parseIgnoreContent(text);
    expect(config.patterns).toHaveLength(1);
    expect(config.patterns[0].pattern).toBe('dist/**');
    expect(config.patterns[0].negate).toBe(false);
  });

  it('识别取反规则 (! 前缀)', () => {
    const config = parseIgnoreContent('!important.ts\n');
    expect(config.patterns).toHaveLength(1);
    expect(config.patterns[0].pattern).toBe('important.ts');
    expect(config.patterns[0].negate).toBe(true);
  });

  it('处理 \\# 转义为字面 #', () => {
    const config = parseIgnoreContent('\\#file.txt\n');
    expect(config.patterns).toHaveLength(1);
    expect(config.patterns[0].pattern).toBe('#file.txt');
  });

  it('处理 \\! 转义为字面 !', () => {
    const config = parseIgnoreContent('\\!special.txt\n');
    expect(config.patterns).toHaveLength(1);
    expect(config.patterns[0].pattern).toBe('!special.txt');
    expect(config.patterns[0].negate).toBe(false);
  });

  it('跳过仅含 ! 的空取反规则', () => {
    const config = parseIgnoreContent('!\n');
    expect(config.patterns).toEqual([]);
  });

  it('保留 source 字段', () => {
    const config = parseIgnoreContent('dist/**\n', '/tmp/.reviewignore');
    expect(config.source).toBe('/tmp/.reviewignore');
  });

  it('支持 Windows 风格换行 (\\r\\n)', () => {
    const config = parseIgnoreContent('dist/**\r\nnode_modules/\r\n');
    expect(config.patterns).toHaveLength(2);
    expect(config.patterns[0].pattern).toBe('dist/**');
    expect(config.patterns[1].pattern).toBe('node_modules');
  });
});

describe('ignore-manager: loadIgnoreConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ignore-mgr-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('从文件加载 .reviewignore 配置', () => {
    const filePath = join(tmpDir, '.reviewignore');
    writeFileSync(filePath, 'dist/**\nnode_modules/\n!important.ts\n', 'utf8');

    const config = loadIgnoreConfig(filePath);
    expect(config.patterns).toHaveLength(3);
    expect(config.patterns[0].pattern).toBe('dist/**');
    expect(config.patterns[1].pattern).toBe('node_modules');
    expect(config.patterns[2].pattern).toBe('important.ts');
    expect(config.patterns[2].negate).toBe(true);
    expect(config.source).toBe(filePath);
  });

  it('文件不存在时抛出错误', () => {
    const badPath = join(tmpDir, 'missing.reviewignore');
    expect(() => loadIgnoreConfig(badPath)).toThrow(/not found/);
  });

  it('configPath 为空时抛出错误', () => {
    expect(() => loadIgnoreConfig('')).toThrow(/not found/);
  });
});

describe('ignore-manager: shouldIgnore 基础模式', () => {
  describe('文件路径模式 dist/**', () => {
    const config = parseIgnoreContent('dist/**\n');

    it('匹配 dist 目录下的文件', () => {
      expect(shouldIgnore('dist/bundle.js', config)).toBe(true);
      expect(shouldIgnore('dist/foo/bar.ts', config)).toBe(true);
      expect(shouldIgnore('dist/a/b/c/d.js', config)).toBe(true);
    });

    it('不匹配 dist 目录外的文件', () => {
      expect(shouldIgnore('src/app.ts', config)).toBe(false);
      expect(shouldIgnore('package.json', config)).toBe(false);
    });

    it('不匹配 dist 本身（无尾随内容）', () => {
      // dist/** 要求 dist/ 后跟内容，dist 单独不匹配
      expect(shouldIgnore('dist', config)).toBe(false);
    });
  });

  describe('文件类型 *.generated.ts', () => {
    const config = parseIgnoreContent('*.generated.ts\n');

    it('匹配根目录下的生成文件', () => {
      expect(shouldIgnore('app.generated.ts', config)).toBe(true);
    });

    it('匹配子目录下的生成文件', () => {
      expect(shouldIgnore('src/api.generated.ts', config)).toBe(true);
      expect(shouldIgnore('a/b/c/generated.generated.ts', config)).toBe(true);
    });

    it('不匹配非生成文件', () => {
      expect(shouldIgnore('app.ts', config)).toBe(false);
      expect(shouldIgnore('app.generated.js', config)).toBe(false);
    });
  });

  describe('目录规则 node_modules/', () => {
    const config = parseIgnoreContent('node_modules/\n');

    it('匹配目录下的文件', () => {
      expect(shouldIgnore('node_modules/lodash/index.js', config)).toBe(true);
      expect(shouldIgnore('node_modules/react/react.js', config)).toBe(true);
    });

    it('匹配任意路径下的同名目录', () => {
      // 不含 / 的目录规则前置 **/，匹配任意层级
      expect(shouldIgnore('packages/app/node_modules/lodash/index.js', config)).toBe(true);
    });
  });

  describe('根锚定规则 /build', () => {
    it('仅匹配根目录的 build', () => {
      const config = parseIgnoreContent('/build\n');
      expect(shouldIgnore('build', config)).toBe(true);
      expect(shouldIgnore('build/output.js', config)).toBe(true);
      // 不匹配子目录下的同名 build
      expect(shouldIgnore('src/build', config)).toBe(false);
    });

    it('/build/ 作为目录规则仅匹配根目录的 build', () => {
      const config = parseIgnoreContent('/build/\n');
      expect(shouldIgnore('build/output.js', config)).toBe(true);
      expect(shouldIgnore('build/a/b/c.js', config)).toBe(true);
      expect(shouldIgnore('src/build/output.js', config)).toBe(false);
    });
  });

  describe('带路径的模式 src/*.ts', () => {
    const config = parseIgnoreContent('src/*.ts\n');

    it('匹配 src 目录下的 .ts 文件', () => {
      expect(shouldIgnore('src/app.ts', config)).toBe(true);
      expect(shouldIgnore('src/foo.ts', config)).toBe(true);
    });

    it('不匹配 src 子目录下的文件', () => {
      expect(shouldIgnore('src/sub/foo.ts', config)).toBe(false);
    });

    it('不匹配其他目录的 .ts 文件', () => {
      expect(shouldIgnore('lib/foo.ts', config)).toBe(false);
    });
  });
});

describe('ignore-manager: shouldIgnore 取反与顺序', () => {
  it('取反规则可重新包含已忽略文件', () => {
    const config = parseIgnoreContent('vendor/**\n!vendor/important.ts\n');
    expect(shouldIgnore('vendor/lib/utils.ts', config)).toBe(true);
    expect(shouldIgnore('vendor/important.ts', config)).toBe(false);
  });

  it('最后匹配的规则决定结果', () => {
    // 先忽略再包含再忽略
    const config = parseIgnoreContent('vendor/**\n!vendor/important.ts\nvendor/important.ts\n');
    expect(shouldIgnore('vendor/important.ts', config)).toBe(true);
  });

  it('取反规则在前、忽略规则在后时，忽略优先', () => {
    const config = parseIgnoreContent('!dist/keep.ts\ndist/**\n');
    // 先有取反（无前置忽略状态被改为 false，等价于默认），再被 dist/** 忽略
    expect(shouldIgnore('dist/keep.ts', config)).toBe(true);
  });

  it('空配置不忽略任何文件', () => {
    const config = parseIgnoreContent('');
    expect(shouldIgnore('any/file.ts', config)).toBe(false);
  });

  it('空 filePath 不忽略', () => {
    const config = parseIgnoreContent('dist/**\n');
    expect(shouldIgnore('', config)).toBe(false);
  });
});

describe('ignore-manager: applyIgnoreRules', () => {
  it('过滤被忽略文件的 findings', () => {
    const config = parseIgnoreContent('dist/**\nnode_modules/\n');
    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 1 }),
      makeFinding({ file: 'dist/bundle.js', line: 2 }),
      makeFinding({ file: 'node_modules/lodash/index.js', line: 3 }),
      makeFinding({ file: 'src/utils.ts', line: 4 }),
    ];

    const result = applyIgnoreRules(findings, config);
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.file)).toEqual(['src/app.ts', 'src/utils.ts']);
  });

  it('取反规则保留指定文件', () => {
    const config = parseIgnoreContent('vendor/**\n!vendor/important.ts\n');
    const findings: Finding[] = [
      makeFinding({ file: 'vendor/lib/utils.ts', line: 1 }),
      makeFinding({ file: 'vendor/important.ts', line: 2 }),
      makeFinding({ file: 'src/app.ts', line: 3 }),
    ];

    const result = applyIgnoreRules(findings, config);
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.file)).toEqual(['vendor/important.ts', 'src/app.ts']);
  });

  it('空配置时返回原数组', () => {
    const config = parseIgnoreContent('');
    const findings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1 }),
      makeFinding({ file: 'b.ts', line: 2 }),
    ];

    const result = applyIgnoreRules(findings, config);
    expect(result).toBe(findings);
  });

  it('空 findings 返回原数组', () => {
    const config = parseIgnoreContent('dist/**\n');
    const findings: Finding[] = [];
    const result = applyIgnoreRules(findings, config);
    expect(result).toBe(findings);
  });

  it('所有 findings 都被忽略时返回空数组', () => {
    const config = parseIgnoreContent('dist/**\n');
    const findings: Finding[] = [
      makeFinding({ file: 'dist/a.js', line: 1 }),
      makeFinding({ file: 'dist/b.js', line: 2 }),
    ];
    const result = applyIgnoreRules(findings, config);
    expect(result).toEqual([]);
  });

  it('不修改原数组', () => {
    const config = parseIgnoreContent('dist/**\n');
    const findings: Finding[] = [
      makeFinding({ file: 'src/a.ts', line: 1 }),
      makeFinding({ file: 'dist/b.js', line: 2 }),
    ];
    const originalLength = findings.length;
    const result = applyIgnoreRules(findings, config);
    expect(findings).toHaveLength(originalLength);
    expect(result).not.toBe(findings);
  });

  it('支持泛型：可处理含 file 字段的任意对象', () => {
    const config = parseIgnoreContent('dist/**\n');
    const items = [
      { file: 'src/a.ts', other: 'x' },
      { file: 'dist/b.js', other: 'y' },
    ];
    const result = applyIgnoreRules(items, config);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('src/a.ts');
  });
});

describe('post-process.js afterReview 集成忽略规则', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ignore-pp-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('使用 context.ignoreConfig 过滤 findings', async () => {
    const plugin = await loadPlugin();
    const ignoreConfig = parseIgnoreContent('dist/**\nnode_modules/\n');

    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 1 }),
      makeFinding({ file: 'dist/bundle.js', line: 2 }),
      makeFinding({ file: 'node_modules/lodash/index.js', line: 3 }),
    ];

    const result = await plugin.hooks.afterReview(findings, {
      correctLineLocations: vi.fn((f) => f),
      filterFalsePositives: vi.fn((f) => f),
      deduplicateFindings: vi.fn((f) => f),
      applyIgnoreRules,
      ignoreConfig,
    });

    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('src/app.ts');
  });

  it('使用 context.applyIgnoreRules 应用忽略规则', async () => {
    const plugin = await loadPlugin();
    const ignoreConfig = parseIgnoreContent('vendor/**\n');

    const callOrder: string[] = [];
    const applySpy = vi.fn((findings: Finding[]) => {
      callOrder.push('applyIgnore');
      return findings.filter((f) => !f.file.startsWith('vendor/'));
    });
    const correctSpy = vi.fn((findings: Finding[]) => {
      callOrder.push('correct');
      return findings;
    });

    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 1 }),
      makeFinding({ file: 'vendor/lib.ts', line: 2 }),
    ];

    const result = await plugin.hooks.afterReview(findings, {
      correctLineLocations: correctSpy,
      filterFalsePositives: vi.fn((f) => f),
      deduplicateFindings: vi.fn((f) => f),
      applyIgnoreRules: applySpy,
      ignoreConfig,
      // 提供 diffs 以触发 correctLineLocations（post-process 仅在 context.diffs 存在时调用）
      diffs: [],
    });

    expect(applySpy).toHaveBeenCalledWith(findings, ignoreConfig);
    expect(callOrder[0]).toBe('applyIgnore');
    expect(callOrder[1]).toBe('correct');
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('src/app.ts');
  });

  it('忽略规则在 correctLineLocations 之前执行', async () => {
    const plugin = await loadPlugin();
    const ignoreConfig = parseIgnoreContent('dist/**\n');

    const receivedByCorrect: Finding[][] = [];
    const correctSpy = vi.fn((findings: Finding[]) => {
      receivedByCorrect.push([...findings]);
      return findings;
    });

    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 1 }),
      makeFinding({ file: 'dist/bundle.js', line: 2 }),
    ];

    await plugin.hooks.afterReview(findings, {
      correctLineLocations: correctSpy,
      filterFalsePositives: vi.fn((f) => f),
      deduplicateFindings: vi.fn((f) => f),
      applyIgnoreRules,
      ignoreConfig,
      // 提供 diffs 以触发 correctLineLocations（post-process 仅在 context.diffs 存在时调用）
      diffs: [],
    });

    // correctLineLocations 收到的是过滤后的列表（已去掉 dist/bundle.js）
    expect(correctSpy).toHaveBeenCalledTimes(1);
    expect(receivedByCorrect[0]).toHaveLength(1);
    expect(receivedByCorrect[0][0].file).toBe('src/app.ts');
  });

  it('忽略规则过滤掉全部 findings 时直接返回空数组', async () => {
    const plugin = await loadPlugin();
    const ignoreConfig = parseIgnoreContent('dist/**\n');

    const correctSpy = vi.fn((f: Finding[]) => f);
    const filterSpy = vi.fn((f: Finding[]) => f);
    const dedupSpy = vi.fn((f: Finding[]) => f);

    const findings: Finding[] = [
      makeFinding({ file: 'dist/a.js', line: 1 }),
      makeFinding({ file: 'dist/b.js', line: 2 }),
    ];

    const result = await plugin.hooks.afterReview(findings, {
      correctLineLocations: correctSpy,
      filterFalsePositives: filterSpy,
      deduplicateFindings: dedupSpy,
      applyIgnoreRules,
      ignoreConfig,
    });

    expect(result).toEqual([]);
    // 后续处理函数不应被调用
    expect(correctSpy).not.toHaveBeenCalled();
    expect(filterSpy).not.toHaveBeenCalled();
    expect(dedupSpy).not.toHaveBeenCalled();
  });

  it('未提供 ignoreConfig 时不应用忽略规则', async () => {
    const plugin = await loadPlugin();

    const applySpy = vi.fn((f: Finding[]) => f);
    const correctSpy = vi.fn((f: Finding[]) => f);

    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 1 }),
      makeFinding({ file: 'dist/b.js', line: 2 }),
    ];

    const result = await plugin.hooks.afterReview(findings, {
      correctLineLocations: correctSpy,
      filterFalsePositives: vi.fn((f) => f),
      deduplicateFindings: vi.fn((f) => f),
      applyIgnoreRules: applySpy,
      skipReviewIgnore: true,
    });

    expect(applySpy).not.toHaveBeenCalled();
    expect(result).toHaveLength(2);
  });

  it('从 ignoreConfigPath 加载 .reviewignore 文件', async () => {
    const plugin = await loadPlugin();
    const filePath = join(tmpDir, '.reviewignore');
    writeFileSync(filePath, 'dist/**\n', 'utf8');

    const applySpy = vi.fn((findings: Finding[]) =>
      findings.filter((f) => !f.file.startsWith('dist/')),
    );

    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 1 }),
      makeFinding({ file: 'dist/b.js', line: 2 }),
    ];

    // 通过 loadIgnoreConfigFn 注入加载函数，避免依赖 code-review 包的可用性
    const loadSpy = vi.fn((p: string) => {
      expect(p).toBe(filePath);
      return loadIgnoreConfig(p);
    });

    const result = await plugin.hooks.afterReview(findings, {
      correctLineLocations: vi.fn((f) => f),
      filterFalsePositives: vi.fn((f) => f),
      deduplicateFindings: vi.fn((f) => f),
      applyIgnoreRules: applySpy,
      ignoreConfigPath: filePath,
      loadIgnoreConfigFn: loadSpy,
    });

    expect(loadSpy).toHaveBeenCalledWith(filePath);
    expect(applySpy).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('src/app.ts');
  });

  it('skipReviewIgnore: true 跳过自动加载', async () => {
    const plugin = await loadPlugin();
    // 创建一个会被自动加载的 .reviewignore（但被 skipReviewIgnore 跳过）
    const filePath = join(tmpDir, '.reviewignore');
    writeFileSync(filePath, 'dist/**\n', 'utf8');

    const applySpy = vi.fn((f: Finding[]) => f);

    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 1 }),
      makeFinding({ file: 'dist/b.js', line: 2 }),
    ];

    const result = await plugin.hooks.afterReview(findings, {
      correctLineLocations: vi.fn((f) => f),
      filterFalsePositives: vi.fn((f) => f),
      deduplicateFindings: vi.fn((f) => f),
      applyIgnoreRules: applySpy,
      ignoreConfigPath: filePath,
      skipReviewIgnore: true,
    });

    expect(applySpy).not.toHaveBeenCalled();
    expect(result).toHaveLength(2);
  });
});

describe('post-process.js afterReview 向后兼容', () => {
  it('未提供 ignore 相关参数时维持原有行为', async () => {
    const plugin = await loadPlugin();

    const callOrder: string[] = [];
    const mockCorrect = vi.fn((findings: Finding[], _diffs: FileDiff[]) => {
      callOrder.push('correct');
      return findings;
    });
    const mockFilter = vi.fn((findings: Finding[]) => {
      callOrder.push('filter');
      return findings;
    });
    const mockDedup = vi.fn((findings: Finding[]) => {
      callOrder.push('dedup');
      return findings;
    });
    const mockReflect = vi.fn((findings: Finding[]) => {
      callOrder.push('reflect');
      return findings;
    });

    const findings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1 }),
      makeFinding({ file: 'b.ts', line: 2 }),
    ];
    const diffs: FileDiff[] = [
      {
        path: 'a.ts',
        status: 'modified',
        hunks: [
          {
            oldStart: 1, oldCount: 5, newStart: 1, newCount: 5,
            header: '',
            lines: [{ type: 'add', content: 'foo', newLineNumber: 1 }],
          },
        ],
      },
    ];

    const result = await plugin.hooks.afterReview(findings, {
      correctLineLocations: mockCorrect,
      filterFalsePositives: mockFilter,
      deduplicateFindings: mockDedup,
      reflectFindings: mockReflect,
      // 提供 llmConfig 以触发 reflectFindings（post-process 仅在 llmConfig 存在时调用）
      llmConfig: {},
      diffs,
    });

    expect(result).toEqual(findings);
    expect(callOrder).toEqual(['correct', 'filter', 'dedup', 'reflect']);
    // correctLineLocations 收到完整的 findings（未被忽略规则过滤）
    expect(mockCorrect).toHaveBeenCalledWith(findings, diffs);
  });
});
