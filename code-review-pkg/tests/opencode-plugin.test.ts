import { describe, it, expect, vi } from 'vitest';
import type { Finding, FileDiff, ExistingComment } from '../src/types.js';

// post-process.js 是 ESM .js 文件，使用 dynamic import
const PLUGIN_PATH = '../opencode-config/.opencode/plugins/post-process.js';

async function loadPlugin() {
  const mod = await import(PLUGIN_PATH);
  return mod.default;
}

// ---- 辅助：构造测试 finding ----
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

describe('post-process.js afterReview hook', () => {
  it('calls correctLineLocations → filterFalsePositives → deduplicateFindings', async () => {
    const plugin = await loadPlugin();

    // mock 后处理函数（在测试环境模拟 code-review 包）
    const callOrder: string[] = [];
    const mockCorrect = vi.fn((findings: Finding[], _diffs: FileDiff[]) => {
      callOrder.push('correct');
      return findings;
    });
    const mockFilter = vi.fn((findings: Finding[]) => {
      callOrder.push('filter');
      return findings;
    });
    const mockDedup = vi.fn((findings: Finding[], _existing?: ExistingComment[]) => {
      callOrder.push('dedup');
      return findings;
    });

    const findings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1 }),
    ];
    const diffs: FileDiff[] = [
      {
        path: 'a.ts',
        status: 'modified',
        hunks: [
          {
            oldStart: 1, oldCount: 5, newStart: 1, newCount: 5,
            lines: [{ type: 'add', oldLine: undefined, newLine: 1, content: 'foo' }],
          },
        ],
      },
    ];

    const result = await plugin.hooks.afterReview(findings, {
      correctLineLocations: mockCorrect,
      filterFalsePositives: mockFilter,
      deduplicateFindings: mockDedup,
      diffs,
    });

    expect(mockCorrect).toHaveBeenCalledWith(findings, diffs);
    expect(mockFilter).toHaveBeenCalled();
    expect(mockDedup).toHaveBeenCalled();
    expect(result).toEqual(findings); // 默认情况下原样返回

    // 验证调用顺序：correct → filter → dedup
    expect(callOrder).toEqual(['correct', 'filter', 'dedup']);
  });

  it('returns findings unchanged when context has no post-process functions', async () => {
    const plugin = await loadPlugin();
    const findings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1 }),
    ];
    // 空上下文，且 code-review 包不在 node_modules 中（dynamic import 失败）
    // 应该静默降级，原样返回 findings
    const result = await plugin.hooks.afterReview(findings, {});
    expect(result).toEqual(findings);
  });

  it('skips correctLineLocations when diffs not provided', async () => {
    const plugin = await loadPlugin();
    const mockCorrect = vi.fn((findings: Finding[]) => findings);
    const mockFilter = vi.fn((findings: Finding[]) => findings);
    const mockDedup = vi.fn((findings: Finding[]) => findings);

    const findings: Finding[] = [makeFinding({ file: 'a.ts', line: 1 })];

    // 未提供 diffs，correctLineLocations 应该被跳过
    await plugin.hooks.afterReview(findings, {
      correctLineLocations: mockCorrect,
      filterFalsePositives: mockFilter,
      deduplicateFindings: mockDedup,
    });

    expect(mockCorrect).not.toHaveBeenCalled();
    expect(mockFilter).toHaveBeenCalled();
    expect(mockDedup).toHaveBeenCalled();
  });

  it('passes through processing results between steps', async () => {
    const plugin = await loadPlugin();
    const filteredFindings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1, message: 'filtered' }),
    ];

    // correct 返回原样，filter 返回新数组，dedup 验证接收的是 filter 的返回值
    const mockCorrect = vi.fn((findings: Finding[]) => findings);
    const mockFilter = vi.fn((_findings: Finding[]) => filteredFindings);
    const mockDedup = vi.fn((findings: Finding[]) => {
      // 验证 dedup 接收的是 filter 的返回值
      expect(findings).toBe(filteredFindings);
      return findings;
    });

    const originalFindings: Finding[] = [makeFinding({ file: 'a.ts', line: 1, message: 'original' })];
    const diffs: FileDiff[] = [];

    const result = await plugin.hooks.afterReview(originalFindings, {
      correctLineLocations: mockCorrect,
      filterFalsePositives: mockFilter,
      deduplicateFindings: mockDedup,
      diffs,
    });

    expect(result).toBe(filteredFindings);
  });
});
