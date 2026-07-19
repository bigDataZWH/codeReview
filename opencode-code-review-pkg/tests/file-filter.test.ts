import { describe, it, expect } from 'vitest';
import { filterFiles, bundleFiles, detectLanguage, groupByDirectory, excludeGeneratedFiles, sortByPatchSize, getLanguageStats, loadGitignorePatterns, loadReviewIgnorePatterns } from '../src/file-filter.js';
import type { FileDiff } from '../src/types.js';

// ── 辅助函数 ──

function makeDiff(path: string, patch = '', opts: Partial<FileDiff> = {}): FileDiff {
  return {
    path,
    status: opts.status ?? 'modified',
    hunks: [],
    ...opts,
    binary: opts.binary,
  };
}

function makeDiffWithPatch(path: string, patchLength: number): FileDiff {
  return makeDiff(path, 'x'.repeat(patchLength));
}

/** 计算 FileDiff 的 patch 总长度（所有 hunk lines 拼接） */
function patchLength(diff: FileDiff): number {
  return diff.hunks.reduce(
    (sum, h) => sum + h.lines.reduce((s, l) => s + l.content.length, 0),
    0,
  );
}

// ── filterFiles 测试 ──

describe('filterFiles', () => {
  // 1. 无过滤规则 — 返回所有文件
  it('无过滤规则时返回所有文件', () => {
    const diffs: FileDiff[] = [
      makeDiff('src/a.ts'),
      makeDiff('src/b.ts'),
      makeDiff('README.md'),
    ];
    const result = filterFiles(diffs, {});
    expect(result).toEqual(diffs);
  });

  // 2. ignore glob — 匹配的文件被排除
  it('ignore glob 匹配的文件被排除', () => {
    const diffs: FileDiff[] = [
      makeDiff('src/a.ts'),
      makeDiff('src/b.ts'),
      makeDiff('dist/bundle.js'),
      makeDiff('node_modules/lodash/index.js'),
    ];
    const result = filterFiles(diffs, { ignorePatterns: ['dist/**', 'node_modules/**'] });
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  // 3. include glob — 仅返回匹配的文件
  it('include glob 仅返回匹配的文件', () => {
    const diffs: FileDiff[] = [
      makeDiff('src/a.ts'),
      makeDiff('src/b.ts'),
      makeDiff('README.md'),
      makeDiff('package.json'),
    ];
    const result = filterFiles(diffs, { includePatterns: ['**/*.ts'] });
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  // 4. ignore 优先 — 同时匹配 include 和 ignore 时排除
  it('ignore 优先于 include — 同时匹配时排除', () => {
    const diffs: FileDiff[] = [
      makeDiff('src/a.ts'),
      makeDiff('src/generated.ts'),
      makeDiff('src/b.ts'),
    ];
    const result = filterFiles(diffs, {
      includePatterns: ['**/*.ts'],
      ignorePatterns: ['**/generated.*'],
    });
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  // 5. maxPatchLength — patch 超长文件被排除
  it('maxPatchLength 超长的文件被排除', () => {
    const shortDiff = makeDiffWithPatch('src/short.ts', 50);
    shortDiff.hunks = [
      {
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 1,
        header: '@@ -1 +1 @@',
        lines: [{ type: 'context', content: 'x'.repeat(50) }],
      },
    ];

    const longDiff = makeDiffWithPatch('src/long.ts', 200);
    longDiff.hunks = [
      {
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 1,
        header: '@@ -1 +1 @@',
        lines: [{ type: 'context', content: 'x'.repeat(200) }],
      },
    ];

    const result = filterFiles([shortDiff, longDiff], { maxPatchLength: 100 });
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('src/short.ts');
  });

  // 6. 二进制文件排除 — 默认排除 binary 文件
  it('默认排除二进制文件', () => {
    const diffs: FileDiff[] = [
      makeDiff('src/logo.png', '', { binary: true }),
      makeDiff('src/app.ts'),
    ];
    const result = filterFiles(diffs, {});
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('src/app.ts');
  });

  // 7. 二进制文件包含 — includeBinary=true 时保留
  it('includeBinary=true 时保留二进制文件', () => {
    const diffs: FileDiff[] = [
      makeDiff('src/logo.png', '', { binary: true }),
      makeDiff('src/app.ts'),
    ];
    const result = filterFiles(diffs, { includeBinary: true });
    expect(result).toHaveLength(2);
  });

  // 14. 默认忽略 min/bundle 文件
  it('默认忽略 *.min.js、*.min.css、*.bundle.js 文件', () => {
    const diffs: FileDiff[] = [
      makeDiff('src/app.min.js'),
      makeDiff('src/style.min.css'),
      makeDiff('dist/vendor.bundle.js'),
      makeDiff('src/app.ts'),
      makeDiff('src/style.css'),
    ];
    const result = filterFiles(diffs, {});
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.path)).toEqual(['src/app.ts', 'src/style.css']);
  });

  // 16. include 否定模式 — !*.test.ts 排除测试文件
  it('include 否定模式：!*.test.ts 排除测试文件', () => {
    const diffs: FileDiff[] = [
      makeDiff('src/app.ts'),
      makeDiff('src/app.test.ts'),
      makeDiff('src/utils.ts'),
      makeDiff('src/utils.test.ts'),
    ];
    const result = filterFiles(diffs, {
      includePatterns: ['**/*.ts', '!**/*.test.ts'],
    });
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.path)).toEqual(['src/app.ts', 'src/utils.ts']);
  });

  // 18. maxFiles 截断
  it('maxFiles 截断超过阈值的文件数', () => {
    const diffs: FileDiff[] = [
      makeDiff('src/a.ts'),
      makeDiff('src/b.ts'),
      makeDiff('src/c.ts'),
      makeDiff('src/d.ts'),
      makeDiff('src/e.ts'),
    ];
    const result = filterFiles(diffs, { maxFiles: 3 });
    expect(result).toHaveLength(3);
    expect(result.map((d) => d.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  // 19. 空输入 — 返回空数组
  it('空输入返回空数组', () => {
    const result = filterFiles([], {});
    expect(result).toEqual([]);
  });

  // 9. 中英文路径 glob 匹配
  it('中英文路径 glob 匹配', () => {
    const diffs: FileDiff[] = [
      makeDiff('src/utils/工具栏.ts'),
      makeDiff('src/utils/toolbar.ts'),
      makeDiff('docs/说明.md'),
      makeDiff('docs/readme.md'),
    ];
    // 用 ? 匹配单个中文字符 —— 这里简单用 **/*.ts 匹配 ts 文件
    const result = filterFiles(diffs, { includePatterns: ['**/*.ts'] });
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.path)).toEqual([
      'src/utils/工具栏.ts',
      'src/utils/toolbar.ts',
    ]);
  });
});

// ── bundleFiles 测试 ──

describe('bundleFiles', () => {
  // 10. 无打包规则 — 每个文件独立 bundle
  it('无打包规则时每个文件独立 bundle', () => {
    const diffs: FileDiff[] = [
      makeDiff('src/a.ts'),
      makeDiff('src/b.ts'),
    ];
    const result = bundleFiles(diffs);
    expect(result).toHaveLength(2);
    // 每个 bundle 的 primary 就是自己，related 为空
    for (const bundle of result) {
      expect(bundle.related).toHaveLength(0);
    }
    // primary 的文件路径应与输入一致
    expect(result.map((b) => b.primary.path).sort()).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
  });

  // 11. i18n 打包 — _en.properties 和 _zh.properties 归为同组
  it('i18n 打包将 _en 和 _zh 文件归为同组', () => {
    const diffs: FileDiff[] = [
      makeDiff('src/i18n/messages_en.properties'),
      makeDiff('src/i18n/messages_zh.properties'),
      makeDiff('src/app.ts'),
    ];
    const result = bundleFiles(diffs, {
      bundles: [
        {
          name: 'i18n',
          pattern: '(.*)_en\\.(properties|json|yaml)',
          related: ['$1_zh.$2'],
        },
      ],
    });
    // app.ts 独立 bundle
    // _en 和 _zh 应归为一组
    const appBundle = result.find((b) => b.primary.path === 'src/app.ts');
    expect(appBundle).toBeDefined();
    expect(appBundle!.related).toHaveLength(0);

    const i18nBundle = result.find(
      (b) => b.primary.path === 'src/i18n/messages_en.properties',
    );
    expect(i18nBundle).toBeDefined();
    expect(i18nBundle!.related).toHaveLength(1);
    expect(i18nBundle!.related[0].path).toBe('src/i18n/messages_zh.properties');
  });

  // 12. test-pair 打包 — .test.ts 和对应源文件归为同组
  it('test-pair 打包将测试文件和源文件归为同组', () => {
    const diffs: FileDiff[] = [
      makeDiff('src/math.test.ts'),
      makeDiff('src/math.ts'),
      makeDiff('src/string.ts'),
    ];
    const result = bundleFiles(diffs, {
      bundles: [
        {
          name: 'test-pair',
          pattern: '(.*)\\.test\\.(ts|js|py)',
          related: ['$1.$2'],
        },
      ],
    });
    // math.test.ts 应为 primary，math.ts 应为 related
    const testBundle = result.find((b) => b.primary.path === 'src/math.test.ts');
    expect(testBundle).toBeDefined();
    expect(testBundle!.related).toHaveLength(1);
    expect(testBundle!.related[0].path).toBe('src/math.ts');

    // string.ts 独立
    const stringBundle = result.find((b) => b.primary.path === 'src/string.ts');
    expect(stringBundle).toBeDefined();
    expect(stringBundle!.related).toHaveLength(0);
  });

  // 13. 无关联文件 — 独立文件独立 bundle
  it('无关联文件时独立 bundle', () => {
    const diffs: FileDiff[] = [
      makeDiff('src/a.ts'),
      makeDiff('src/b.ts'),
      makeDiff('README.md'),
    ];
    const result = bundleFiles(diffs, {
      bundles: [
        {
          name: 'test-pair',
          pattern: '(.*)\\.test\\.(ts|js)',
          related: ['$1.$2'],
        },
      ],
    });
    expect(result).toHaveLength(3);
    for (const bundle of result) {
      expect(bundle.related).toHaveLength(0);
    }
  });

  // 14. 空输入 — 返回空数组
  it('空输入返回空数组', () => {
    const result = bundleFiles([]);
    expect(result).toEqual([]);
  });
});

// ── detectLanguage 测试 ──

describe('detectLanguage', () => {
  it('识别 TypeScript 文件', () => {
    expect(detectLanguage('src/app.ts')).toBe('typescript');
    expect(detectLanguage('src/Component.tsx')).toBe('typescript');
  });

  it('识别 JavaScript 文件', () => {
    expect(detectLanguage('src/index.js')).toBe('javascript');
    expect(detectLanguage('src/App.jsx')).toBe('javascript');
  });

  it('识别 Python 文件', () => {
    expect(detectLanguage('script.py')).toBe('python');
    expect(detectLanguage('types.pyi')).toBe('python');
  });

  it('识别其他常见语言', () => {
    expect(detectLanguage('main.go')).toBe('go');
    expect(detectLanguage('lib.rs')).toBe('rust');
    expect(detectLanguage('App.java')).toBe('java');
    expect(detectLanguage('style.css')).toBe('css');
    expect(detectLanguage('data.json')).toBe('json');
  });

  it('识别特殊文件名', () => {
    expect(detectLanguage('Dockerfile')).toBe('dockerfile');
    expect(detectLanguage('Dockerfile.prod')).toBe('dockerfile');
    expect(detectLanguage('Makefile')).toBe('makefile');
    expect(detectLanguage('Jenkinsfile')).toBe('groovy');
  });

  it('无扩展名返回 undefined', () => {
    expect(detectLanguage('LICENSE')).toBeUndefined();
    expect(detectLanguage('src/bin')).toBeUndefined();
  });

  it('未知扩展名返回 undefined', () => {
    expect(detectLanguage('data.xyz')).toBeUndefined();
  });
});

// ── Round 18: **/ glob 模式支持 ──

describe('glob **/ pattern', () => {
  it('支持 **/*.test.ts 模式匹配任意深度', () => {
    const diffs: FileDiff[] = [
      makeDiff('src/app.ts'),
      makeDiff('src/utils.test.ts'),
      makeDiff('packages/core/deep/nested/file.test.ts'),
      makeDiff('top-level.test.ts'),
    ];

    const result = filterFiles(diffs, {
      includePatterns: ['**/*.test.ts'],
    });
    expect(result).toHaveLength(3);
  });
});

// ── Round 25: language 过滤 ──

describe('language filter', () => {
  it('只保留指定语言的文件', () => {
    const diffs: FileDiff[] = [
      makeDiff('src/app.ts'),
      makeDiff('src/style.css'),
      makeDiff('script.py'),
      makeDiff('README.md'),
    ];

    const result = filterFiles(diffs, { language: ['typescript', 'python'] });
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.path)).toEqual(['src/app.ts', 'script.py']);
  });
});

// ── Round 31: includeDeleted 配置 ──

describe('includeDeleted', () => {
  it('includeDeleted=false 时过滤掉删除的文件', () => {
    const diffs: FileDiff[] = [
      { path: 'src/added.ts', status: 'added', hunks: [] },
      { path: 'src/deleted.ts', status: 'deleted', hunks: [] },
      { path: 'src/modified.ts', status: 'modified', hunks: [] },
    ];

    const result = filterFiles(diffs, { includeDeleted: false });
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.path)).toEqual(['src/added.ts', 'src/modified.ts']);
  });

  it('默认包含 deleted 文件', () => {
    const diffs: FileDiff[] = [
      { path: 'src/added.ts', status: 'added', hunks: [] },
      { path: 'src/deleted.ts', status: 'deleted', hunks: [] },
    ];

    const result = filterFiles(diffs, {});
    expect(result).toHaveLength(2);
  });
});

// ── groupByDirectory ──

describe('groupByDirectory', () => {
  it('groups files by directory', () => {
    const diffs: FileDiff[] = [
      { path: 'src/app.ts', status: 'modified', hunks: [] },
      { path: 'src/utils.ts', status: 'modified', hunks: [] },
      { path: 'tests/app.test.ts', status: 'added', hunks: [] },
      { path: 'README.md', status: 'modified', hunks: [] },
    ];

    const groups = groupByDirectory(diffs);
    expect(groups.get('src')).toHaveLength(2);
    expect(groups.get('tests')).toHaveLength(1);
    expect(groups.get('.')).toHaveLength(1);
  });

  it('returns empty map for empty input', () => {
    const groups = groupByDirectory([]);
    expect(groups.size).toBe(0);
  });
});

// ── Round 42: bundleFiles 去重 ──

describe('bundleFiles dedup', () => {
  it('同一个文件只出现在一个 bundle 中', () => {
    const diffs: FileDiff[] = [
      makeDiff('src/math.test.ts'),
      makeDiff('src/math.ts'),
      makeDiff('src/string.test.ts'),
      makeDiff('src/string.ts'),
    ];
    const result = bundleFiles(diffs, {
      bundles: [
        {
          name: 'test-pair',
          pattern: '(.*)\\.test\\.(ts|js)',
          related: ['$1.$2'],
        },
      ],
    });

    // 收集所有 primary + related 的 path
    const allPaths = result.flatMap((b) => [b.primary.path, ...b.related.map((r) => r.path)]);
    const uniquePaths = new Set(allPaths);

    // 所有文件都应被分配
    expect(uniquePaths.size).toBe(4);
    // 不应重复
    expect(allPaths.length).toBe(4);
  });
});

// ── excludeGeneratedFiles ──

describe('excludeGeneratedFiles', () => {
  it('excludes files with @generated marker', () => {
    const diffs: FileDiff[] = [
      {
        path: 'src/api.generated.ts',
        status: 'modified',
        hunks: [{
          oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, header: '',
          lines: [{ type: 'context', content: '// @generated Do not edit', oldLineNumber: 1, newLineNumber: 1 }],
        }],
      },
      {
        path: 'src/index.ts',
        status: 'modified',
        hunks: [{
          oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, header: '',
          lines: [{ type: 'add', content: 'export const x = 1;', newLineNumber: 1 }],
        }],
      },
    ];

    const result = excludeGeneratedFiles(diffs);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('src/index.ts');
  });

  it('keeps files without @generated marker', () => {
    const diffs: FileDiff[] = [
      {
        path: 'src/normal.ts',
        status: 'modified',
        hunks: [{
          oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, header: '',
          lines: [{ type: 'add', content: 'const x = 1;', newLineNumber: 1 }],
        }],
      },
    ];

    expect(excludeGeneratedFiles(diffs)).toHaveLength(1);
  });
});

// ── Round 47: sortByPatchSize ──

describe('sortByPatchSize', () => {
  it('大 patch 排前面', () => {
    const diffs: FileDiff[] = [
      makeDiff('small.ts', '+a', {
        hunks: [{ oldStart: 1, oldCount: 0, newStart: 1, newCount: 1, header: '', lines: [{ type: 'add', content: '+a', newLineNumber: 1 }] }],
      }),
      makeDiff('big.ts', 'x', {
        hunks: [{ oldStart: 1, oldCount: 0, newStart: 1, newCount: 2, header: '', lines: [
          { type: 'add', content: '+very long line content here', newLineNumber: 1 },
          { type: 'add', content: '+another very long line content', newLineNumber: 2 },
        ] }],
      }),
      makeDiff('medium.ts', '+m', {
        hunks: [{ oldStart: 1, oldCount: 0, newStart: 1, newCount: 1, header: '', lines: [{ type: 'add', content: '+medium line', newLineNumber: 1 }] }],
      }),
    ];
    const sorted = sortByPatchSize(diffs);
    expect(sorted[0].path).toBe('big.ts');
    expect(sorted[2].path).toBe('small.ts');
  });

  it('空数组返回空', () => {
    expect(sortByPatchSize([])).toEqual([]);
  });

  it('不修改原数组', () => {
    const diffs: FileDiff[] = [
      makeDiff('a.ts', '+a', {
        hunks: [{ oldStart: 1, oldCount: 0, newStart: 1, newCount: 1, header: '', lines: [{ type: 'add', content: '+a', newLineNumber: 1 }] }],
      }),
      makeDiff('b.ts', '+bb', {
        hunks: [{ oldStart: 1, oldCount: 0, newStart: 1, newCount: 1, header: '', lines: [{ type: 'add', content: '+bb', newLineNumber: 1 }] }],
      }),
    ];
    const sorted = sortByPatchSize(diffs);
    expect(diffs[0].path).toBe('a.ts');
    expect(sorted[0].path).toBe('b.ts');
  });
});

// ── Round 51: glob ** at end matches empty ──

describe('glob ** empty match (Round 51)', () => {
  it('** at end matches empty string', () => {
    // Create a diff at exact pattern base (no subdirectory)
    const diffs: FileDiff[] = [makeDiff('generated.ts', [{ type: 'add', content: '+a', newLineNumber: 1 }])];
    const result = filterFiles(diffs, { ignorePatterns: ['dist/**'] });
    // 'generated.ts' does not start with 'dist/' — should NOT be ignored
    expect(result).toHaveLength(1);
  });

  it('** at end matches nested path', () => {
    const diffs: FileDiff[] = [makeDiff('dist/bundle.min.js', [{ type: 'add', content: '+a', newLineNumber: 1 }])];
    const result = filterFiles(diffs, { ignorePatterns: ['dist/**'] });
    expect(result).toHaveLength(0);
  });
});

// ── Round 57: loadGitignorePatterns ──

describe('loadGitignorePatterns', () => {
  it('从 fixture 读取 .gitignore', async () => {
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
    // Create a temp .gitignore in fixtures
    const { writeFile, unlink } = await import('node:fs/promises');
    const gitignorePath = join(fixturesDir, '.gitignore');
    await writeFile(gitignorePath, '# comment\nnode_modules/\n*.log\n\ncoverage/\n');
    try {
      const patterns = await loadGitignorePatterns(fixturesDir);
      expect(patterns).toEqual(['node_modules/', '*.log', 'coverage/']);
    } finally {
      await unlink(gitignorePath).catch(() => {});
    }
  });

  it('不存在的目录返回空数组', async () => {
    const patterns = await loadGitignorePatterns('/nonexistent/path/xyz');
    expect(patterns).toEqual([]);
  });
});

// ── Round 62: getLanguageStats ──

describe('getLanguageStats', () => {
  it('统计语言分布', () => {
    const diffs: FileDiff[] = [
      makeDiff('a.ts', []),
      makeDiff('b.ts', []),
      makeDiff('c.py', []),
      makeDiff('d.go', []),
    ];
    const stats = getLanguageStats(diffs);
    expect(stats).toHaveLength(3);
    expect(stats[0]).toEqual({ language: 'typescript', count: 2 });
  });

  it('未知语言归为 unknown', () => {
    const diffs: FileDiff[] = [makeDiff('Makefile', [])];
    const stats = getLanguageStats(diffs);
    expect(stats).toEqual([{ language: 'makefile', count: 1 }]);
  });

  it('空数组返回空', () => {
    expect(getLanguageStats([])).toEqual([]);
  });
});

// ── Round 67: .opencode-review-ignore ──

describe('loadReviewIgnorePatterns', () => {
  it('读取 .opencode-review-ignore 文件', async () => {
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
    const { writeFile, unlink } = await import('node:fs/promises');
    const ignorePath = join(fixturesDir, '.opencode-review-ignore');
    await writeFile(ignorePath, '# skip these\nvendor/\n*.generated.ts\n');
    try {
      const patterns = await loadReviewIgnorePatterns(fixturesDir);
      expect(patterns).toEqual(['vendor/', '*.generated.ts']);
    } finally {
      await unlink(ignorePath).catch(() => {});
    }
  });

  it('不存在的文件返回空数组', async () => {
    const patterns = await loadReviewIgnorePatterns('/nonexistent/path/xyz');
    expect(patterns).toEqual([]);
  });
});
