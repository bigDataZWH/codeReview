// tests/token-optimizer.test.ts
// 迭代 6：Token 成本优化测试
// 验证上下文压缩、分级模型策略、Token 预算控制和成本预估

import { describe, it, expect } from 'vitest';
import {
  compressContext,
  selectModelByComplexity,
  estimateTokenCost,
  estimateTokenCount,
  fitsInBudget,
  optimizePrompt,
  DEFAULT_MODEL_TIERS,
  type ModelTier,
  type ComplexityMetrics,
  type TokenCostEstimate,
} from '../src/token-optimizer.js';
import type { FileDiff } from '../src/types.js';

// ── 辅助函数：构造 FileDiff ──

function makeDiff(path: string, lines: string[]): FileDiff {
  return {
    path,
    status: 'modified',
    hunks: [
      {
        oldStart: 1,
        oldCount: lines.length,
        newStart: 1,
        newCount: lines.length,
        header: '',
        lines: lines.map((content, i) => ({
          type: (content.startsWith('+') ? 'add' : content.startsWith('-') ? 'delete' : 'context') as
            | 'add'
            | 'delete'
            | 'context',
          content: content.replace(/^[+\- ]/, ''),
          newLineNumber: i + 1,
          oldLineNumber: i + 1,
        })),
      },
    ],
  };
}

// ── 上下文压缩 ──

describe('迭代 6：上下文压缩', () => {
  it('compressContext 移除空行', () => {
    const diff = makeDiff('a.ts', [
      '+const x = 1;',
      '+',
      '+const y = 2;',
      '+',
      '+// comment',
      '+const z = 3;',
    ]);
    const result = compressContext([diff], { stripBlankLines: true });
    const allLines = result[0].hunks.flatMap((h) => h.lines);
    // 不应包含空内容行
    expect(allLines.every((l) => l.content.trim() !== '')).toBe(true);
  });

  it('compressContext 移除注释', () => {
    const diff = makeDiff('a.ts', [
      '+const x = 1;',
      '+// single line comment',
      '+const y = 2;',
      '+/* block comment */',
      '+const z = 3;',
    ]);
    const result = compressContext([diff], { stripComments: true });
    const allLines = result[0].hunks.flatMap((h) => h.lines.map((l) => l.content));
    // 不应包含注释行
    expect(allLines.some((c) => c.trim().startsWith('//'))).toBe(false);
    expect(allLines.some((c) => c.includes('/*'))).toBe(false);
  });

  it('compressContext 保留 add/delete 关键行', () => {
    const diff = makeDiff('a.ts', [
      ' context line 1',
      ' context line 2',
      '+added line',
      '-removed line',
      ' context line 3',
    ]);
    const result = compressContext([diff], { contextLines: 1 });
    const allLines = result[0].hunks.flatMap((h) => h.lines);
    // add 和 delete 行应保留
    expect(allLines.some((l) => l.type === 'add')).toBe(true);
    expect(allLines.some((l) => l.type === 'delete')).toBe(true);
  });

  it('compressContext 保留关键行周围的 N 行上下文', () => {
    const diff = makeDiff('a.ts', [
      ' ctx 1',
      ' ctx 2',
      ' ctx 3',
      '+added',
      ' ctx 4',
      ' ctx 5',
      ' ctx 6',
    ]);
    const result = compressContext([diff], { contextLines: 1 });
    const allLines = result[0].hunks.flatMap((h) => h.lines);
    // 关键行周围的 1 行上下文应保留，但远离关键行的 context 行可能被裁剪
    expect(allLines.some((l) => l.type === 'add')).toBe(true);
  });

  it('compressContext 默认选项应用所有压缩策略', () => {
    const diff = makeDiff('a.ts', [
      '+const x = 1;',
      '+',
      '+// comment',
      '+const y = 2;',
    ]);
    const result = compressContext([diff], { stripBlankLines: true, stripComments: true });
    const allLines = result[0].hunks.flatMap((h) => h.lines);
    // 应同时移除空行和注释
    expect(allLines.every((l) => l.content.trim() !== '')).toBe(true);
    expect(allLines.every((l) => !l.content.trim().startsWith('//'))).toBe(true);
  });

  it('compressContext 空 diffs 返回空数组', () => {
    const result = compressContext([]);
    expect(result).toEqual([]);
  });

  it('compressContext enabled=false 时不压缩', () => {
    const diff = makeDiff('a.ts', ['+const x = 1;', '+', '+// comment']);
    const result = compressContext([diff], { enabled: false });
    // 原样返回（深拷贝）
    expect(result.length).toBe(1);
    const allLines = result[0].hunks.flatMap((h) => h.lines);
    expect(allLines.length).toBe(3); // 全部保留
  });

  it('compressContext 返回深拷贝不影响原对象', () => {
    const diff = makeDiff('a.ts', ['+const x = 1;', '+// comment']);
    const originalLineCount = diff.hunks[0].lines.length;
    compressContext([diff], { stripComments: true });
    // 原 diff 不应被修改
    expect(diff.hunks[0].lines.length).toBe(originalLineCount);
  });

  it('compressContext contextLines=0 只保留关键行', () => {
    const diff = makeDiff('a.ts', [
      ' ctx 1',
      ' ctx 2',
      '+added',
      ' ctx 3',
      ' ctx 4',
    ]);
    const result = compressContext([diff], { contextLines: 0 });
    const allLines = result[0].hunks.flatMap((h) => h.lines);
    expect(allLines.every((l) => l.type === 'add' || l.type === 'delete')).toBe(true);
  });

  it('compressContext 无关键行时保留全部 context', () => {
    const diff = makeDiff('a.ts', [
      ' ctx 1',
      ' ctx 2',
      ' ctx 3',
    ]);
    const result = compressContext([diff], { contextLines: 1 });
    const allLines = result[0].hunks.flatMap((h) => h.lines);
    expect(allLines.length).toBe(3);
  });

  it('compressContext 多个 hunks 正确处理', () => {
    const diff: FileDiff = {
      path: 'a.ts',
      status: 'modified',
      hunks: [
        {
          oldStart: 1,
          oldCount: 3,
          newStart: 1,
          newCount: 3,
          header: '',
          lines: [
            { type: 'context', content: 'line 1', oldLineNumber: 1, newLineNumber: 1 },
            { type: 'add', content: 'line 2', newLineNumber: 2 },
            { type: 'context', content: 'line 3', oldLineNumber: 2, newLineNumber: 3 },
          ],
        },
        {
          oldStart: 10,
          oldCount: 2,
          newStart: 10,
          newCount: 2,
          header: '',
          lines: [
            { type: 'context', content: 'line 10', oldLineNumber: 10, newLineNumber: 10 },
            { type: 'delete', content: 'line 11', oldLineNumber: 11 },
          ],
        },
      ],
    };
    const result = compressContext([diff], { contextLines: 0 });
    expect(result[0].hunks.length).toBe(2);
    expect(result[0].hunks[0].lines.some((l) => l.type === 'add')).toBe(true);
    expect(result[0].hunks[1].lines.some((l) => l.type === 'delete')).toBe(true);
  });

  it('compressContext oldCount/newCount 计算正确', () => {
    const diff = makeDiff('a.ts', [
      '+added',
      '-removed',
      ' context',
    ]);
    const result = compressContext([diff]);
    const hunk = result[0].hunks[0];
    expect(hunk.oldCount).toBe(2);
    expect(hunk.newCount).toBe(2);
  });

  it('compressContext 只有 add 行时计数正确', () => {
    const diff = makeDiff('a.ts', ['+a', '+b', '+c']);
    const result = compressContext([diff]);
    const hunk = result[0].hunks[0];
    expect(hunk.oldCount).toBe(0);
    expect(hunk.newCount).toBe(3);
  });

  it('compressContext 只有 delete 行时计数正确', () => {
    const diff = makeDiff('a.ts', ['-a', '-b', '-c']);
    const result = compressContext([diff]);
    const hunk = result[0].hunks[0];
    expect(hunk.oldCount).toBe(3);
    expect(hunk.newCount).toBe(0);
  });
});

// ── 分级模型策略 ──

describe('迭代 6：分级模型策略', () => {
  it('DEFAULT_MODEL_TIERS 包含 small / medium / large 三档', () => {
    expect(DEFAULT_MODEL_TIERS.small).toBeDefined();
    expect(DEFAULT_MODEL_TIERS.medium).toBeDefined();
    expect(DEFAULT_MODEL_TIERS.large).toBeDefined();
    expect(DEFAULT_MODEL_TIERS.small.model).toBeTypeOf('string');
    expect(DEFAULT_MODEL_TIERS.medium.model).toBeTypeOf('string');
    expect(DEFAULT_MODEL_TIERS.large.model).toBeTypeOf('string');
  });

  it('DEFAULT_MODEL_TIERS 模型复杂度阈值递增', () => {
    expect(DEFAULT_MODEL_TIERS.small.maxComplexity).toBeLessThan(DEFAULT_MODEL_TIERS.medium.maxComplexity);
    expect(DEFAULT_MODEL_TIERS.medium.maxComplexity).toBeLessThan(DEFAULT_MODEL_TIERS.large.maxComplexity);
  });

  it('selectModelByComplexity 小变更用 small 模型', () => {
    const metrics: ComplexityMetrics = {
      filesChanged: 2,
      linesChanged: 10,
      hunksCount: 2,
      hasSecurityRisk: false,
      complexityScore: 5,
    };
    const tier = selectModelByComplexity(metrics);
    expect(tier.tier).toBe('small');
  });

  it('selectModelByComplexity 中等变更用 medium 模型', () => {
    const metrics: ComplexityMetrics = {
      filesChanged: 10,
      linesChanged: 100,
      hunksCount: 15,
      hasSecurityRisk: false,
      complexityScore: 50,
    };
    const tier = selectModelByComplexity(metrics);
    expect(tier.tier).toBe('medium');
  });

  it('selectModelByComplexity 大变更用 large 模型', () => {
    const metrics: ComplexityMetrics = {
      filesChanged: 50,
      linesChanged: 1000,
      hunksCount: 100,
      hasSecurityRisk: true,
      complexityScore: 200,
    };
    const tier = selectModelByComplexity(metrics);
    expect(tier.tier).toBe('large');
  });

  it('selectModelByComplexity 有安全风险时强制使用 large 模型', () => {
    const metrics: ComplexityMetrics = {
      filesChanged: 1,
      linesChanged: 5,
      hunksCount: 1,
      hasSecurityRisk: true,
      complexityScore: 3,
    };
    const tier = selectModelByComplexity(metrics);
    expect(tier.tier).toBe('large');
  });

  it('selectModelByComplexity 支持自定义 tier 配置', () => {
    const customTiers: Record<string, ModelTier> = {
      micro: {
        tier: 'micro',
        model: 'gpt-nano',
        maxComplexity: 5,
        maxTokens: 1000,
        costPer1kTokens: 0.0001,
      },
      huge: {
        tier: 'huge',
        model: 'gpt-mega',
        maxComplexity: 1000,
        maxTokens: 100_000,
        costPer1kTokens: 0.05,
      },
    };
    const metrics: ComplexityMetrics = {
      filesChanged: 1,
      linesChanged: 1,
      hunksCount: 1,
      hasSecurityRisk: false,
      complexityScore: 1,
    };
    const tier = selectModelByComplexity(metrics, customTiers);
    expect(tier.tier).toBe('micro');
  });

  it('selectModelByComplexity complexityScore=0 使用 smallest tier', () => {
    const metrics: ComplexityMetrics = {
      filesChanged: 0,
      linesChanged: 0,
      hunksCount: 0,
      hasSecurityRisk: false,
      complexityScore: 0,
    };
    const tier = selectModelByComplexity(metrics);
    expect(tier.tier).toBe('small');
  });

  it('selectModelByComplexity 复杂度正好等于阈值时使用该 tier', () => {
    const metrics: ComplexityMetrics = {
      filesChanged: 1,
      linesChanged: 1,
      hunksCount: 1,
      hasSecurityRisk: false,
      complexityScore: 20,
    };
    const tier = selectModelByComplexity(metrics);
    expect(tier.tier).toBe('small');
  });

  it('selectModelByComplexity 复杂度超过阈值时升级到下一档', () => {
    const metrics: ComplexityMetrics = {
      filesChanged: 1,
      linesChanged: 1,
      hunksCount: 1,
      hasSecurityRisk: false,
      complexityScore: 21,
    };
    const tier = selectModelByComplexity(metrics);
    expect(tier.tier).toBe('medium');
  });

  it('selectModelByComplexity 自定义 tier 无 large 时安全风险用最后一档', () => {
    const customTiers: Record<string, ModelTier> = {
      tiny: {
        tier: 'tiny',
        model: 'gpt-tiny',
        maxComplexity: 10,
        maxTokens: 1000,
        costPer1kTokens: 0.0001,
      },
      big: {
        tier: 'big',
        model: 'gpt-big',
        maxComplexity: 100,
        maxTokens: 10000,
        costPer1kTokens: 0.01,
      },
    };
    const metrics: ComplexityMetrics = {
      filesChanged: 1,
      linesChanged: 1,
      hunksCount: 1,
      hasSecurityRisk: true,
      complexityScore: 1,
    };
    const tier = selectModelByComplexity(metrics, customTiers);
    expect(tier.tier).toBe('big');
  });

  it('selectModelByComplexity 只有单个 tier 时始终返回该 tier', () => {
    const customTiers: Record<string, ModelTier> = {
      only: {
        tier: 'only',
        model: 'gpt-only',
        maxComplexity: 50,
        maxTokens: 5000,
        costPer1kTokens: 0.001,
      },
    };
    const metrics: ComplexityMetrics = {
      filesChanged: 100,
      linesChanged: 1000,
      hunksCount: 100,
      hasSecurityRisk: false,
      complexityScore: 999,
    };
    const tier = selectModelByComplexity(metrics, customTiers);
    expect(tier.tier).toBe('only');
  });
});

// ── Token 预算控制 ──

describe('迭代 6：Token 预算控制', () => {
  it('estimateTokenCount 字符数 / 4 估算 token 数', () => {
    expect(estimateTokenCount('')).toBe(0);
    expect(estimateTokenCount('hello')).toBe(2); // ceil(5/4) = 2
    expect(estimateTokenCount('hello world')).toBe(3); // ceil(11/4) = 3
  });

  it('estimateTokenCount 长文本正确估算', () => {
    const longText = 'a'.repeat(400);
    expect(estimateTokenCount(longText)).toBe(100);
  });

  it('fitsInBudget 估算 token 数 ≤ 预算返回 true', () => {
    expect(fitsInBudget('hello', 10)).toBe(true); // 2 tokens ≤ 10
    expect(fitsInBudget('hello', 3)).toBe(true); // 2 tokens ≤ 3
    expect(fitsInBudget('hello', 1)).toBe(false); // 2 tokens > 1
  });

  it('fitsInBudget 边界：正好等于预算', () => {
    const text = 'a'.repeat(8); // 2 tokens
    expect(fitsInBudget(text, 2)).toBe(true);
    expect(fitsInBudget(text, 1)).toBe(false);
  });

  it('fitsInBudget 空字符串与 0 预算', () => {
    expect(fitsInBudget('', 0)).toBe(true);
    expect(fitsInBudget('', 100)).toBe(true);
  });

  it('estimateTokenCount 中文字符估算更准确', () => {
    const chineseText = '你好世界';
    const tokens = estimateTokenCount(chineseText);
    expect(tokens).toBe(4);
  });
});

// ── 成本预估 ──

describe('迭代 6：成本预估', () => {
  it('estimateTokenCost 计算基本成本', () => {
    const estimate: TokenCostEstimate = estimateTokenCost({
      promptTokens: 1000,
      completionTokens: 500,
      costPer1kPromptTokens: 0.01,
      costPer1kCompletionTokens: 0.03,
    });
    expect(estimate.totalTokens).toBe(1500);
    // prompt cost = 1000/1000 * 0.01 = 0.01
    expect(estimate.promptCost).toBeCloseTo(0.01, 5);
    // completion cost = 500/1000 * 0.03 = 0.015
    expect(estimate.completionCost).toBeCloseTo(0.015, 5);
    // total = 0.025
    expect(estimate.totalCost).toBeCloseTo(0.025, 5);
  });

  it('estimateTokenCost 0 token 时成本为 0', () => {
    const estimate: TokenCostEstimate = estimateTokenCost({
      promptTokens: 0,
      completionTokens: 0,
      costPer1kPromptTokens: 0.01,
      costPer1kCompletionTokens: 0.03,
    });
    expect(estimate.totalCost).toBe(0);
    expect(estimate.totalTokens).toBe(0);
  });

  it('estimateTokenCost 默认费率（使用 DEFAULT_MODEL_TIERS.large）', () => {
    const estimate: TokenCostEstimate = estimateTokenCost({
      promptTokens: 1000,
      completionTokens: 0,
    });
    expect(estimate.promptCost).toBeGreaterThan(0);
    expect(estimate.totalCost).toBe(estimate.promptCost);
  });

  it('estimateTokenCost 大型 prompt 估算合理', () => {
    const estimate: TokenCostEstimate = estimateTokenCost({
      promptTokens: 100_000,
      completionTokens: 10_000,
      costPer1kPromptTokens: 0.005,
      costPer1kCompletionTokens: 0.015,
    });
    expect(estimate.totalTokens).toBe(110_000);
    expect(estimate.promptCost).toBeCloseTo(0.5, 5);
    expect(estimate.completionCost).toBeCloseTo(0.15, 5);
    expect(estimate.totalCost).toBeCloseTo(0.65, 5);
  });

  it('estimateTokenCost 仅 completion tokens 时计算正确', () => {
    const estimate = estimateTokenCost({
      promptTokens: 0,
      completionTokens: 2000,
      costPer1kPromptTokens: 0.01,
      costPer1kCompletionTokens: 0.02,
    });
    expect(estimate.promptCost).toBe(0);
    expect(estimate.completionCost).toBeCloseTo(0.04, 5);
    expect(estimate.totalCost).toBeCloseTo(0.04, 5);
  });
});

// ── 综合优化 ──

describe('迭代 6：综合优化', () => {
  it('optimizePrompt 压缩 prompt 文本并返回压缩比', () => {
    const longPrompt = [
      '# Code Review',
      '',
      '// some comment',
      '',
      'const x = 1;',
      '',
      '// another comment',
      'const y = 2;',
      '   ',
      'const z = 3;',
    ].join('\n');
    const result = optimizePrompt(longPrompt, {
      stripBlankLines: true,
      stripComments: true,
    });
    expect(result.optimized.length).toBeLessThanOrEqual(longPrompt.length);
    expect(result.originalLength).toBe(longPrompt.length);
    expect(result.compressionRatio).toBeGreaterThan(0);
    expect(result.compressionRatio).toBeLessThanOrEqual(1);
  });

  it('optimizePrompt 空字符串返回零长度结果', () => {
    const result = optimizePrompt('');
    expect(result.optimized).toBe('');
    expect(result.originalLength).toBe(0);
    expect(result.compressionRatio).toBe(0);
  });

  it('optimizePrompt 无可压缩内容时压缩比 = 1', () => {
    const prompt = 'const x = 1;\nconst y = 2;\n';
    const result = optimizePrompt(prompt);
    expect(result.compressionRatio).toBe(1);
    expect(result.optimized).toBe(prompt);
  });

  it('迭代 6 整体目标：长 prompt 经压缩后 token 下降 ≥ 30%', () => {
    // 构造一个含大量空行和注释的 prompt
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push('// this is a comment line ' + i);
      lines.push('');
      lines.push('const x' + i + ' = ' + i + ';');
    }
    const longPrompt = lines.join('\n');
    const result = optimizePrompt(longPrompt, {
      stripBlankLines: true,
      stripComments: true,
    });
    // 压缩比应 ≤ 0.7（即下降 ≥ 30%）
    expect(result.compressionRatio).toBeLessThanOrEqual(0.7);
  });

  it('optimizePrompt 全是空行和注释时压缩到空字符串', () => {
    const prompt = '// comment\n\n  \n/* block */\n';
    const result = optimizePrompt(prompt, {
      stripBlankLines: true,
      stripComments: true,
    });
    expect(result.optimized).toBe('');
    expect(result.optimizedLength).toBe(0);
    expect(result.compressionRatio).toBe(0);
  });

  it('optimizePrompt 只移除空行', () => {
    const prompt = 'line1\n\nline2\n  \nline3';
    const result = optimizePrompt(prompt, { stripBlankLines: true });
    expect(result.optimized).toBe('line1\nline2\nline3');
    expect(result.compressionRatio).toBeLessThan(1);
  });

  it('optimizePrompt 只移除注释', () => {
    const prompt = '// comment\ncode here\n// another\nmore code';
    const result = optimizePrompt(prompt, { stripComments: true });
    expect(result.optimized).toBe('code here\nmore code');
    expect(result.compressionRatio).toBeLessThan(1);
  });

  it('optimizePrompt 单行文本不移除', () => {
    const prompt = 'const x = 1;';
    const result = optimizePrompt(prompt, { stripBlankLines: true, stripComments: true });
    expect(result.optimized).toBe(prompt);
    expect(result.compressionRatio).toBe(1);
  });

  it('optimizePrompt 只有换行符时处理正确', () => {
    const prompt = '\n\n\n';
    const result = optimizePrompt(prompt, { stripBlankLines: true });
    expect(result.optimized).toBe('');
    expect(result.originalLength).toBe(3);
    expect(result.compressionRatio).toBe(0);
  });
});
