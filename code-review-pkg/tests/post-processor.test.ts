import { describe, it, expect } from 'vitest';
import {
  correctLineLocations,
  filterFalsePositives,
  deduplicateFindings,
  computeTextOverlap,
  BUILTIN_FP_RULES,
  filterBySeverity,
  groupByFile,
  sortBySeverity,
  filterByCategory,
  filterBySource,
  filterByConfidence,
  countBySeverity,
  createCachedFilter,
  mergeFindings,
  getUniqueCategories,
  truncateFindings,
} from '../src/post-processor.js';
import type { Finding, FileDiff, FalsePositiveRule, ExistingComment } from '../src/types.js';

// ---- 辅助函数 ----

function makeFinding(overrides: Partial<Finding> & { file: string; line: number }): Finding {
  return {
    severity: 'medium',
    category: 'security',
    message: 'test finding',
    confidence: 0.7,
    source: 'rule',
    ...overrides,
  };
}

// ==================== correctLineLocations ====================
describe('correctLineLocations', () => {
  it('正确行号不变 — 行号在 hunk 范围内不修改', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 5, message: 'finding at line 5' }),
    ];

    const diffs: FileDiff[] = [
      {
        path: 'src/app.ts',
        status: 'modified',
        hunks: [
          {
            oldStart: 1,
            oldCount: 10,
            newStart: 1,
            newCount: 10,
            header: '@@ -1,10 +1,10 @@',
            lines: [
              { type: 'context', content: ' line 1', oldLineNumber: 1, newLineNumber: 1 },
              { type: 'context', content: ' line 2', oldLineNumber: 2, newLineNumber: 2 },
              { type: 'context', content: ' line 3', oldLineNumber: 3, newLineNumber: 3 },
              { type: 'context', content: ' line 4', oldLineNumber: 4, newLineNumber: 4 },
              { type: 'add', content: '+new line 5', newLineNumber: 5 },
              { type: 'context', content: ' line 6', oldLineNumber: 5, newLineNumber: 6 },
            ],
          },
        ],
      },
    ];

    const result = correctLineLocations(findings, diffs);
    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(5);
  });

  it('行号超出 hunk clamp 到最近行 — 行号大于 hunk 最大行', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 100, message: 'out of range' }),
    ];

    const diffs: FileDiff[] = [
      {
        path: 'src/app.ts',
        status: 'modified',
        hunks: [
          {
            oldStart: 1,
            oldCount: 3,
            newStart: 1,
            newCount: 3,
            header: '@@ -1,3 +1,3 @@',
            lines: [
              { type: 'add', content: '+line 1', newLineNumber: 1 },
              { type: 'add', content: '+line 2', newLineNumber: 2 },
              { type: 'add', content: '+line 3', newLineNumber: 3 },
            ],
          },
        ],
      },
    ];

    const result = correctLineLocations(findings, diffs);
    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(3); // clamp to hunk last line
  });

  it('行号小于 hunk 起始 — clamp 到 hunk 第一行', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 0, message: 'before hunk' }),
    ];

    const diffs: FileDiff[] = [
      {
        path: 'src/app.ts',
        status: 'modified',
        hunks: [
          {
            oldStart: 5,
            oldCount: 3,
            newStart: 5,
            newCount: 3,
            header: '@@ -5,3 +5,3 @@',
            lines: [
              { type: 'add', content: '+line 5', newLineNumber: 5 },
              { type: 'add', content: '+line 6', newLineNumber: 6 },
              { type: 'add', content: '+line 7', newLineNumber: 7 },
            ],
          },
        ],
      },
    ];

    const result = correctLineLocations(findings, diffs);
    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(5); // clamp to hunk first line
  });

  it('无对应文件的 finding 跳过', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'src/other.ts', line: 1, message: 'no matching diff' }),
    ];

    const diffs: FileDiff[] = [
      {
        path: 'src/app.ts',
        status: 'modified',
        hunks: [
          {
            oldStart: 1,
            oldCount: 1,
            newStart: 1,
            newCount: 1,
            header: '@@ -1,1 +1,1 @@',
            lines: [{ type: 'add', content: '+x', newLineNumber: 1 }],
          },
        ],
      },
    ];

    const result = correctLineLocations(findings, diffs);
    // finding 没有 diff 对应，line 不变
    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(1);
  });

  it('空 finding 列表 — 返回空', () => {
    const diffs: FileDiff[] = [
      {
        path: 'src/app.ts',
        status: 'modified',
        hunks: [
          {
            oldStart: 1,
            oldCount: 1,
            newStart: 1,
            newCount: 1,
            header: '@@ -1,1 +1,1 @@',
            lines: [{ type: 'add', content: '+x', newLineNumber: 1 }],
          },
        ],
      },
    ];

    const result = correctLineLocations([], diffs);
    expect(result).toHaveLength(0);
  });

  it('endLine 也被 clamp 到 hunk 范围内', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 100, endLine: 200, message: 'out of range' }),
    ];

    const diffs: FileDiff[] = [
      {
        path: 'src/app.ts',
        status: 'modified',
        hunks: [
          {
            oldStart: 1,
            oldCount: 3,
            newStart: 1,
            newCount: 3,
            header: '@@ -1,3 +1,3 @@',
            lines: [
              { type: 'add', content: '+line 1', newLineNumber: 1 },
              { type: 'add', content: '+line 2', newLineNumber: 2 },
              { type: 'add', content: '+line 3', newLineNumber: 3 },
            ],
          },
        ],
      },
    ];

    const result = correctLineLocations(findings, diffs);
    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(3);
    expect(result[0].endLine).toBe(3);
  });
});

// ==================== filterFalsePositives ====================
describe('filterFalsePositives', () => {
  it('内置规则：非 C/C++ 文件内存安全 — 内存安全 finding 在 .py 文件中被过滤', () => {
    const findings: Finding[] = [
      makeFinding({
        file: 'src/main.py',
        line: 10,
        severity: 'high',
        category: 'memory-safety',
        message: 'use after free risk',
        confidence: 0.7,
      }),
    ];

    const result = filterFalsePositives(findings);
    expect(result).toHaveLength(0);
  });

  it('内置规则：速率限制 — 包含 "rate limit" 的 finding 被过滤', () => {
    const findings: Finding[] = [
      makeFinding({
        file: 'src/api.ts',
        line: 5,
        severity: 'medium',
        category: 'security',
        message: 'Missing rate limit on this endpoint',
        confidence: 0.6,
      }),
    ];

    const result = filterFalsePositives(findings);
    expect(result).toHaveLength(0);
  });

  it('内置规则：生成文件 — @generated 文件中的 finding 被过滤', () => {
    const findings: Finding[] = [
      makeFinding({
        file: 'src/generated/api.pb.go',
        line: 42,
        severity: 'low',
        category: 'style',
        message: 'long line',
        confidence: 0.5,
      }),
    ];

    const result = filterFalsePositives(findings);
    expect(result).toHaveLength(0);
  });

  it('内置规则：测试文件低优先级 — .test.ts 中 low 级别的安全 finding 被过滤', () => {
    const findings: Finding[] = [
      makeFinding({
        file: 'src/utils.test.ts',
        line: 20,
        severity: 'low',
        category: 'security',
        message: 'weak random usage',
        confidence: 0.5,
      }),
    ];

    const result = filterFalsePositives(findings);
    expect(result).toHaveLength(0);
  });

  it('自定义规则 — 传入自定义 FalsePositiveRule 正确过滤', () => {
    const findings: Finding[] = [
      makeFinding({
        file: 'src/app.ts',
        line: 1,
        severity: 'medium',
        category: 'style',
        message: 'line too long',
        confidence: 0.6,
      }),
      makeFinding({
        file: 'src/app.ts',
        line: 2,
        severity: 'high',
        category: 'security',
        message: 'other issue',
        confidence: 0.7,
      }),
    ];

    const customRule: FalsePositiveRule = {
      id: 'custom-skip-style',
      name: '跳过样式类发现',
      match: (f) => f.category === 'style',
    };

    const result = filterFalsePositives(findings, [customRule]);
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe('other issue');
  });

  it('高置信度 finding 保留 — confidence=0.9 的 finding 不被误杀', () => {
    const findings: Finding[] = [
      makeFinding({
        file: 'src/main.py',
        line: 10,
        severity: 'high',
        category: 'memory-safety',
        message: 'use after free risk',
        confidence: 0.9,
      }),
    ];

    // 即使是非 C/C++ 的内存安全问题，高置信度也应保留
    const result = filterFalsePositives(findings);
    expect(result).toHaveLength(1);
  });

  it('BUILTIN_FP_RULES 是一个非空数组', () => {
    expect(Array.isArray(BUILTIN_FP_RULES)).toBe(true);
    expect(BUILTIN_FP_RULES.length).toBeGreaterThan(0);
  });

  it('内置规则：console.log low 级别 finding 被过滤', () => {
    const findings: Finding[] = [
      makeFinding({
        file: 'src/app.ts',
        line: 5,
        severity: 'low',
        category: 'best-practice',
        message: 'Remove console.log from production code',
        confidence: 0.5,
      }),
    ];

    const result = filterFalsePositives(findings);
    expect(result).toHaveLength(0);
  });

  it('内置规则：console.log high 级别 finding 保留', () => {
    const findings: Finding[] = [
      makeFinding({
        file: 'src/app.ts',
        line: 5,
        severity: 'high',
        category: 'security',
        message: 'console.log may leak sensitive data',
        confidence: 0.9,
      }),
    ];

    const result = filterFalsePositives(findings);
    expect(result).toHaveLength(1);
  });
});

// ==================== deduplicateFindings ====================
describe('deduplicateFindings', () => {
  it('完全相同的 finding 去重 — 同文件同行的 finding 被去重', () => {
    const newFindings: Finding[] = [
      makeFinding({
        file: 'src/app.ts',
        line: 10,
        severity: 'high',
        category: 'security',
        message: 'SQL injection risk detected',
        confidence: 0.8,
      }),
    ];

    const existingComments: ExistingComment[] = [
      {
        file: 'src/app.ts',
        line: 10,
        body: 'SQL injection risk detected',
      },
    ];

    const result = deduplicateFindings(newFindings, existingComments, 0.5);
    expect(result).toHaveLength(0);
  });

  it('相似 finding 保留 — 不同行的 finding 保留', () => {
    const newFindings: Finding[] = [
      makeFinding({
        file: 'src/app.ts',
        line: 20,
        severity: 'high',
        category: 'security',
        message: 'SQL injection risk detected',
        confidence: 0.8,
      }),
    ];

    const existingComments: ExistingComment[] = [
      {
        file: 'src/app.ts',
        line: 10,
        body: 'SQL injection risk detected',
      },
    ];

    const result = deduplicateFindings(newFindings, existingComments, 0.5);
    // 不同行不应去重
    expect(result).toHaveLength(1);
  });

  it('空现有评论 — 不去重', () => {
    const newFindings: Finding[] = [
      makeFinding({
        file: 'src/app.ts',
        line: 10,
        severity: 'high',
        category: 'security',
        message: 'some issue',
        confidence: 0.8,
      }),
    ];

    const result = deduplicateFindings(newFindings, [], 0.5);
    expect(result).toHaveLength(1);
  });

  it('IoU 阈值可配置 — 高阈值不去重低重叠', () => {
    const newFindings: Finding[] = [
      makeFinding({
        file: 'src/app.ts',
        line: 10,
        severity: 'high',
        category: 'security',
        message: 'XSS vulnerability in user input handling',
        confidence: 0.8,
      }),
    ];

    const existingComments: ExistingComment[] = [
      {
        file: 'src/app.ts',
        line: 10,
        body: 'XSS vulnerability in form validation',
      },
    ];

    // 高阈值 0.9 — 部分重叠不应被去重
    const resultStrict = deduplicateFindings(newFindings, existingComments, 0.9);
    expect(resultStrict).toHaveLength(1);

    // 低阈值 0.1 — 即使部分重叠也去重
    const resultLoose = deduplicateFindings(newFindings, existingComments, 0.1);
    expect(resultLoose).toHaveLength(0);
  });

  it('existingComments 为空时直接返回，不做多余计算', () => {
    const newFindings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 1, message: 'some issue' }),
      makeFinding({ file: 'src/app.ts', line: 2, message: 'another issue' }),
      makeFinding({ file: 'src/b.ts', line: 3, message: 'third issue' }),
    ];

    const result = deduplicateFindings(newFindings, []);
    expect(result).toHaveLength(3);
  });

  it('消息文本重叠去重 — 一个 finding message 是另一个的子串', () => {
    const newFindings: Finding[] = [
      makeFinding({
        file: 'src/app.ts',
        line: 10,
        severity: 'high',
        category: 'security',
        message: 'XSS vulnerability in user input handling',
        confidence: 0.8,
      }),
    ];

    const existingComments: ExistingComment[] = [
      {
        file: 'src/app.ts',
        line: 10,
        body: 'Found: XSS vulnerability in user input handling via innerHTML',
      },
    ];

    // The finding message is a substring of the comment body
    const result = deduplicateFindings(newFindings, existingComments, 0.5);
    expect(result).toHaveLength(0);
  });
});

// ==================== filterByCategory ====================
describe('filterByCategory', () => {
  it('只保留指定类别的 findings', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1, category: 'security' }),
      makeFinding({ file: 'b.ts', line: 2, category: 'style' }),
      makeFinding({ file: 'c.ts', line: 3, category: 'security' }),
    ];

    const result = filterByCategory(findings, ['security']);
    expect(result).toHaveLength(2);
    expect(result.every((f) => f.category === 'security')).toBe(true);
  });

  it('多个类别', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1, category: 'security' }),
      makeFinding({ file: 'b.ts', line: 2, category: 'style' }),
      makeFinding({ file: 'c.ts', line: 3, category: 'performance' }),
    ];

    const result = filterByCategory(findings, ['security', 'performance']);
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.category).sort()).toEqual(['performance', 'security']);
  });

  it('空类别列表返回空数组', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1, category: 'security' }),
    ];
    const result = filterByCategory(findings, []);
    expect(result).toHaveLength(0);
  });

  it('空 findings 返回空数组', () => {
    const result = filterByCategory([], ['security']);
    expect(result).toHaveLength(0);
  });
});

// ==================== filterBySeverity ====================

describe('filterBySeverity', () => {
  it('只保留 severity >= minSeverity 的 findings', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1, severity: 'critical' }),
      makeFinding({ file: 'b.ts', line: 2, severity: 'high' }),
      makeFinding({ file: 'c.ts', line: 3, severity: 'medium' }),
      makeFinding({ file: 'd.ts', line: 4, severity: 'low' }),
    ];

    const result = filterBySeverity(findings, 'high');
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.severity)).toEqual(['critical', 'high']);
  });

  it('minSeverity 为 low 时保留所有', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1, severity: 'critical' }),
      makeFinding({ file: 'b.ts', line: 2, severity: 'low' }),
    ];

    const result = filterBySeverity(findings, 'low');
    expect(result).toHaveLength(2);
  });
});

// ==================== groupByFile ====================

describe('groupByFile', () => {
  it('按文件正确分组 findings', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'src/a.ts', line: 1, category: 'security' }),
      makeFinding({ file: 'src/b.ts', line: 2, category: 'style' }),
      makeFinding({ file: 'src/a.ts', line: 3, category: 'performance' }),
    ];

    const grouped = groupByFile(findings);
    expect(grouped.size).toBe(2);
    expect(grouped.get('src/a.ts')).toHaveLength(2);
    expect(grouped.get('src/b.ts')).toHaveLength(1);
  });

  it('空 findings 返回空 Map', () => {
    const grouped = groupByFile([]);
    expect(grouped.size).toBe(0);
  });
});

// ==================== sortBySeverity ====================

describe('sortBySeverity', () => {
  it('按 severity 降序排列', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1, severity: 'low' }),
      makeFinding({ file: 'b.ts', line: 2, severity: 'critical' }),
      makeFinding({ file: 'c.ts', line: 3, severity: 'medium' }),
    ];

    const sorted = sortBySeverity(findings);
    expect(sorted.map((f) => f.severity)).toEqual(['critical', 'medium', 'low']);
  });

  it('空 findings 返回空数组', () => {
    const sorted = sortBySeverity([]);
    expect(sorted).toEqual([]);
  });
});

// ==================== correctLineLocations 内容匹配 ====================

describe('correctLineLocations content matching', () => {
  it('基于 finding message 中的代码片段找到正确 hunk', () => {
    const findings: Finding[] = [
      makeFinding({
        file: 'src/app.ts',
        line: 999,
        message: 'Found issue in `password = "secret"` on this line',
      }),
    ];

    const diffs: FileDiff[] = [
      {
        path: 'src/app.ts',
        status: 'modified',
        hunks: [
          {
            oldStart: 1, oldCount: 1, newStart: 1, newCount: 1,
            header: '@@ -1 +1 @@',
            lines: [{ type: 'add', content: 'password = "secret"', newLineNumber: 1 }],
          },
        ],
      },
    ];

    const result = correctLineLocations(findings, diffs);
    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(1);
  });
});

// ==================== filterBySource ====================

describe('filterBySource', () => {
  it('filters by rule source', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1, source: 'rule' }),
      makeFinding({ file: 'b.ts', line: 2, source: 'ai' }),
      makeFinding({ file: 'c.ts', line: 3, source: 'rule' }),
    ];
    expect(filterBySource(findings, 'rule')).toHaveLength(2);
    expect(filterBySource(findings, 'ai')).toHaveLength(1);
  });

  it('returns empty for unknown source', () => {
    const findings = [makeFinding({ file: 'a.ts', line: 1, source: 'rule' })];
    expect(filterBySource(findings, 'ai')).toHaveLength(0);
  });
});

// ==================== filterByConfidence ====================

describe('filterByConfidence', () => {
  it('filters by minimum confidence', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1, confidence: 0.9 }),
      makeFinding({ file: 'b.ts', line: 2, confidence: 0.5 }),
      makeFinding({ file: 'c.ts', line: 3, confidence: 0.7 }),
    ];
    expect(filterByConfidence(findings, 0.7)).toHaveLength(2);
    expect(filterByConfidence(findings, 0.95)).toHaveLength(0);
  });

  it('returns all when threshold is 0', () => {
    const findings = [makeFinding({ file: 'a.ts', line: 1, confidence: 0.1 })];
    expect(filterByConfidence(findings, 0)).toHaveLength(1);
  });
});

// ==================== countBySeverity (Round 48) ====================

describe('countBySeverity', () => {
  it('统计各 severity 数量', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1, severity: 'critical' }),
      makeFinding({ file: 'b.ts', line: 2, severity: 'high' }),
      makeFinding({ file: 'c.ts', line: 3, severity: 'high' }),
      makeFinding({ file: 'd.ts', line: 4, severity: 'low' }),
    ];
    const counts = countBySeverity(findings);
    expect(counts).toEqual({ critical: 1, high: 2, low: 1 });
  });

  it('空数组返回空对象', () => {
    expect(countBySeverity([])).toEqual({});
  });
});

// ==================== createCachedFilter (Round 53) ====================

describe('createCachedFilter', () => {
  it('缓存中的条目被过滤', () => {
    const cache = new Set(['src/app.ts:10:security']);
    const rule = createCachedFilter(cache);
    const finding: Finding = makeFinding({ file: 'src/app.ts', line: 10, category: 'security' });
    expect(rule.match(finding)).toBe(true);
  });

  it('不在缓存中的条目不被过滤', () => {
    const cache = new Set(['src/app.ts:10:security']);
    const rule = createCachedFilter(cache);
    const finding: Finding = makeFinding({ file: 'src/app.ts', line: 11, category: 'security' });
    expect(rule.match(finding)).toBe(false);
  });

  it('与 filterFalsePositives 配合使用', () => {
    const cache = new Set(['a.ts:1:style']);
    const customRules = [createCachedFilter(cache)];
    const findings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1, category: 'style' }),
      makeFinding({ file: 'b.ts', line: 2, category: 'style' }),
    ];
    const result = filterFalsePositives(findings, customRules);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('b.ts');
  });
});

// ==================== mergeFindings (Round 59) ====================

describe('mergeFindings', () => {
  it('合并并去重', () => {
    const existing: Finding[] = [makeFinding({ file: 'a.ts', line: 1, category: 'security' })];
    const incoming: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1, category: 'security' }),  // duplicate
      makeFinding({ file: 'b.ts', line: 2, category: 'style' }),     // new
    ];
    const merged = mergeFindings(existing, incoming);
    expect(merged).toHaveLength(2);
  });

  it('空 existing 返回 incoming', () => {
    const incoming: Finding[] = [makeFinding({ file: 'a.ts', line: 1, category: 'security' })];
    expect(mergeFindings([], incoming)).toHaveLength(1);
  });

  it('空 incoming 返回 existing', () => {
    const existing: Finding[] = [makeFinding({ file: 'a.ts', line: 1, category: 'security' })];
    expect(mergeFindings(existing, [])).toHaveLength(1);
  });
});

// ==================== getUniqueCategories (Round 64) ====================

describe('getUniqueCategories', () => {
  it('按频率降序返回类别', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1, category: 'security' }),
      makeFinding({ file: 'b.ts', line: 2, category: 'style' }),
      makeFinding({ file: 'c.ts', line: 3, category: 'security' }),
      makeFinding({ file: 'd.ts', line: 4, category: 'performance' }),
    ];
    const cats = getUniqueCategories(findings);
    expect(cats).toEqual(['security', 'style', 'performance']);
  });

  it('空 findings 返回空数组', () => {
    expect(getUniqueCategories([])).toEqual([]);
  });
});

// ==================== truncateFindings (Round 69) ====================

describe('truncateFindings', () => {
  it('不超过 maxCount 时不截断', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1 }),
      makeFinding({ file: 'b.ts', line: 2 }),
    ];
    const result = truncateFindings(findings, 5);
    expect(result).toHaveLength(2);
  });

  it('超过 maxCount 时截断并添加提示', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1 }),
      makeFinding({ file: 'b.ts', line: 2 }),
      makeFinding({ file: 'c.ts', line: 3 }),
    ];
    const result = truncateFindings(findings, 2);
    expect(result).toHaveLength(3); // 2 real + 1 truncation notice
    expect(result[2].category).toBe('_truncation');
    expect(result[2].message).toContain('1 more findings truncated');
  });

  it('maxCount=0 时只保留截断提示', () => {
    const findings: Finding[] = [makeFinding({ file: 'a.ts', line: 1 })];
    const result = truncateFindings(findings, 0);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('_truncation');
  });
});

// ==================== BUILTIN_FP_RULES extended (Task 17: 5 new rules) ====================
describe('BUILTIN_FP_RULES extended (5 new rules)', () => {
  it('filters "should add error handling" suggestions', () => {
    const findings: Finding[] = [
      makeFinding({
        file: 'a.ts',
        line: 1,
        severity: 'low',
        category: 'quality',
        message: 'Should add error handling for this code',
        confidence: 0.7,
        source: 'ai',
      }),
    ];
    const filtered = filterFalsePositives(findings);
    expect(filtered.length).toBe(0); // 被过滤
  });

  it('error handling rule 不误过滤高置信度真问题', () => {
    const findings: Finding[] = [
      makeFinding({
        file: 'a.ts',
        line: 1,
        severity: 'high',
        category: 'security',
        message: 'Missing error handling causes unhandled promise rejection',
        confidence: 0.9,
        source: 'rule',
      }),
    ];
    const filtered = filterFalsePositives(findings);
    expect(filtered.length).toBe(1); // 保留
  });

  it('filters "empty catch block" suggestions', () => {
    const findings: Finding[] = [
      makeFinding({
        file: 'a.ts',
        line: 1,
        severity: 'low',
        category: 'quality',
        message: 'Empty catch block detected here',
        confidence: 0.7,
        source: 'ai',
      }),
    ];
    const filtered = filterFalsePositives(findings);
    expect(filtered.length).toBe(0); // 被过滤
  });

  it('empty catch rule 不误过滤高置信度真问题', () => {
    const findings: Finding[] = [
      makeFinding({
        file: 'a.ts',
        line: 1,
        severity: 'high',
        category: 'security',
        message: 'Empty catch block swallows security exception',
        confidence: 0.9,
        source: 'rule',
      }),
    ];
    const filtered = filterFalsePositives(findings);
    expect(filtered.length).toBe(1); // 保留
  });

  it('filters "potential null reference" suggestions', () => {
    const findings: Finding[] = [
      makeFinding({
        file: 'a.ts',
        line: 1,
        severity: 'low',
        category: 'quality',
        message: 'Potential null reference in this expression',
        confidence: 0.7,
        source: 'ai',
      }),
    ];
    const filtered = filterFalsePositives(findings);
    expect(filtered.length).toBe(0); // 被过滤
  });

  it('null reference rule 不误过滤高置信度真问题', () => {
    const findings: Finding[] = [
      makeFinding({
        file: 'a.ts',
        line: 1,
        severity: 'critical',
        category: 'security',
        message: 'Null reference dereference leads to crash',
        confidence: 0.9,
        source: 'rule',
      }),
    ];
    const filtered = filterFalsePositives(findings);
    expect(filtered.length).toBe(1); // 保留
  });

  it('filters "unused variable" suggestions', () => {
    const findings: Finding[] = [
      makeFinding({
        file: 'a.ts',
        line: 1,
        severity: 'low',
        category: 'quality',
        message: 'Unused variable foo detected',
        confidence: 0.7,
        source: 'ai',
      }),
    ];
    const filtered = filterFalsePositives(findings);
    expect(filtered.length).toBe(0); // 被过滤
  });

  it('unused variable rule 不误过滤高置信度真问题', () => {
    const findings: Finding[] = [
      makeFinding({
        file: 'a.ts',
        line: 1,
        severity: 'high',
        category: 'security',
        message: 'Unused variable holds sensitive credential',
        confidence: 0.9,
        source: 'rule',
      }),
    ];
    const filtered = filterFalsePositives(findings);
    expect(filtered.length).toBe(1); // 保留
  });

  it('filters "function too long" suggestions', () => {
    const findings: Finding[] = [
      makeFinding({
        file: 'a.ts',
        line: 1,
        severity: 'low',
        category: 'quality',
        message: 'Function is too long, consider splitting it',
        confidence: 0.7,
        source: 'ai',
      }),
    ];
    const filtered = filterFalsePositives(findings);
    expect(filtered.length).toBe(0); // 被过滤
  });

  it('long function rule 不误过滤高置信度真问题', () => {
    const findings: Finding[] = [
      makeFinding({
        file: 'a.ts',
        line: 1,
        severity: 'medium',
        category: 'performance',
        message: 'Function too long causing performance degradation',
        confidence: 0.9,
        source: 'rule',
      }),
    ];
    const filtered = filterFalsePositives(findings);
    expect(filtered.length).toBe(1); // 保留
  });

  it('BUILTIN_FP_RULES has 17 rules', () => {
    expect(BUILTIN_FP_RULES.length).toBe(17);
  });
});

// ==================== computeTextOverlap with LCS algorithm (Task 19) ====================
describe('computeTextOverlap with LCS algorithm', () => {
  it('returns 1 for identical strings', () => {
    expect(computeTextOverlap('hello world', 'hello world')).toBe(1);
  });

  it('returns 0 for completely different strings', () => {
    expect(computeTextOverlap('abc', 'xyz')).toBe(0);
  });

  it('returns ~0.5 for partial overlap (word reordering)', () => {
    // "hello world" vs "world hello" 有 100% 词重叠但顺序不同
    // LCS（按词）= 1（"hello" 或 "world"），所以相似度约 0.5
    const overlap = computeTextOverlap('hello world', 'world hello');
    expect(overlap).toBeGreaterThan(0.3);
    expect(overlap).toBeLessThan(0.7);
  });

  it('returns proportional overlap for partial match', () => {
    // "hello world foo" vs "hello bar" 共享 "hello"
    const overlap = computeTextOverlap('hello world foo', 'hello bar');
    expect(overlap).toBeGreaterThan(0.1);
    expect(overlap).toBeLessThan(0.5);
  });

  it('handles empty strings', () => {
    expect(computeTextOverlap('', '')).toBe(0);
    expect(computeTextOverlap('hello', '')).toBe(0);
    expect(computeTextOverlap('', 'hello')).toBe(0);
  });

  it('handles case insensitive by default', () => {
    // 当前实现在比较前 toLowerCase，所以大小写不敏感
    const overlap = computeTextOverlap('Hello World', 'hello world');
    expect(overlap).toBeGreaterThanOrEqual(0.5);
  });

  it('substring 包含场景仍返回高重叠（向后兼容）', () => {
    // finding message 是 comment body 的子串时，LCS 覆盖整个较短序列
    const overlap = computeTextOverlap(
      'XSS vulnerability in user input handling',
      'Found: XSS vulnerability in user input handling via innerHTML',
    );
    expect(overlap).toBeGreaterThan(0.5);
  });

  it('完全不同词集合返回 0', () => {
    expect(computeTextOverlap('alpha beta', 'gamma delta')).toBe(0);
  });
});