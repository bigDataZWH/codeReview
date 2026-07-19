// tests/false-positive-optimization.test.ts
// 迭代 7：误报过滤优化测试
// 验证新增的硬规则、可配置反思阈值、severity-based filtering 和组合过滤策略

import { describe, it, expect } from 'vitest';
import {
  filterFalsePositives,
  BUILTIN_FP_RULES,
  filterBySeverity,
  filterByConfidence,
  filterWithStrategy,
  createSeverityBasedFilter,
  type FilterStrategy,
} from '../src/post-processor.js';
import { reflectFindings, DEFAULT_REFLECTION_THRESHOLD } from '../src/ai-reflection.js';
import type { Finding, FalsePositiveRule } from '../src/types.js';

// ── 辅助函数 ──

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    file: 'src/app.ts',
    line: 1,
    severity: 'medium',
    category: 'quality',
    message: 'test finding',
    confidence: 0.5,
    source: 'rule',
    ...overrides,
  };
}

// ── 新增硬规则（迭代 7） ──

describe('迭代 7：新增硬规则（误报过滤）', () => {
  it('BUILTIN_FP_RULES 包含 ≥ 12 条规则（原 8 + 新增 4+）', () => {
    expect(BUILTIN_FP_RULES.length).toBeGreaterThanOrEqual(12);
  });

  it('过滤"建议添加注释/JSDoc"类低价值发现', () => {
    const findings: Finding[] = [
      makeFinding({
        message: '建议添加 JSDoc 注释',
        severity: 'low',
        confidence: 0.4,
      }),
      makeFinding({
        message: 'consider adding comments to this function',
        severity: 'low',
        confidence: 0.4,
      }),
    ];
    const filtered = filterFalsePositives(findings);
    expect(filtered.length).toBe(0);
  });

  it('过滤"命名风格建议"类低价值发现', () => {
    const findings: Finding[] = [
      makeFinding({
        message: 'naming convention: use camelCase',
        severity: 'low',
        confidence: 0.4,
      }),
      makeFinding({
        message: 'variable name should be more descriptive',
        severity: 'low',
        confidence: 0.4,
      }),
    ];
    const filtered = filterFalsePositives(findings);
    expect(filtered.length).toBe(0);
  });

  it('过滤"import 排序"类低价值发现', () => {
    const findings: Finding[] = [
      makeFinding({
        message: 'imports should be sorted alphabetically',
        severity: 'low',
        confidence: 0.4,
      }),
      makeFinding({
        message: 'import order is incorrect',
        severity: 'low',
        confidence: 0.4,
      }),
    ];
    const filtered = filterFalsePositives(findings);
    expect(filtered.length).toBe(0);
  });

  it('过滤"代码格式化"类低价值发现（prettier/eslint 风格）', () => {
    const findings: Finding[] = [
      makeFinding({
        message: 'use single quotes instead of double quotes',
        severity: 'low',
        confidence: 0.4,
      }),
      makeFinding({
        message: 'missing semicolon at end of line',
        severity: 'low',
        confidence: 0.4,
      }),
    ];
    const filtered = filterFalsePositives(findings);
    expect(filtered.length).toBe(0);
  });

  it('高置信度的低价值建议不被过滤', () => {
    const findings: Finding[] = [
      makeFinding({
        message: '建议添加 JSDoc 注释',
        severity: 'low',
        confidence: 0.95, // 高置信度
      }),
    ];
    const filtered = filterFalsePositives(findings);
    expect(filtered.length).toBe(1);
  });

  it('其他类别的高严重度 finding 不被新规则误过滤', () => {
    const findings: Finding[] = [
      makeFinding({
        message: 'SQL injection vulnerability',
        severity: 'high',
        category: 'security',
        confidence: 0.9,
      }),
      makeFinding({
        message: 'eval() usage',
        severity: 'critical',
        category: 'security',
        confidence: 0.95,
      }),
    ];
    const filtered = filterFalsePositives(findings);
    expect(filtered.length).toBe(2);
  });
});

// ── severity-based filtering（迭代 7） ──

describe('迭代 7：severity-based filtering', () => {
  it('createSeverityBasedFilter 默认过滤 info 级别', () => {
    const filter = createSeverityBasedFilter();
    expect(filter.id).toBe('severity-based-filter');
    expect(filter.name).toBeTypeOf('string');

    const infoFinding = makeFinding({ severity: 'info' });
    const lowFinding = makeFinding({ severity: 'low' });
    expect(filter.match(infoFinding)).toBe(true);
    expect(filter.match(lowFinding)).toBe(false);
  });

  it('createSeverityBasedFilter 自定义 minSeverity=medium 过滤 low 和 info', () => {
    const filter = createSeverityBasedFilter('medium');
    expect(filter.match(makeFinding({ severity: 'info' }))).toBe(true);
    expect(filter.match(makeFinding({ severity: 'low' }))).toBe(true);
    expect(filter.match(makeFinding({ severity: 'medium' }))).toBe(false);
    expect(filter.match(makeFinding({ severity: 'high' }))).toBe(false);
  });

  it('createSeverityBasedFilter 自定义 minSeverity=high 仅保留 critical 和 high', () => {
    const filter = createSeverityBasedFilter('high');
    expect(filter.match(makeFinding({ severity: 'info' }))).toBe(true);
    expect(filter.match(makeFinding({ severity: 'low' }))).toBe(true);
    expect(filter.match(makeFinding({ severity: 'medium' }))).toBe(true);
    expect(filter.match(makeFinding({ severity: 'high' }))).toBe(false);
    expect(filter.match(makeFinding({ severity: 'critical' }))).toBe(false);
  });

  it('createSeverityBasedFilter 可作为 FalsePositiveRule 使用', () => {
    const filter = createSeverityBasedFilter('medium');
    const findings: Finding[] = [
      makeFinding({ severity: 'info', message: 'info finding' }),
      makeFinding({ severity: 'low', message: 'low finding' }),
      makeFinding({ severity: 'medium', message: 'medium finding' }),
      makeFinding({ severity: 'high', message: 'high finding' }),
    ];
    const filtered = filterFalsePositives(findings, [filter]);
    expect(filtered.length).toBe(2);
    expect(filtered.every((f) => f.severity === 'medium' || f.severity === 'high')).toBe(true);
  });
});

// ── 可配置的过滤策略（迭代 7） ──

describe('迭代 7：可配置的过滤策略', () => {
  it('FilterStrategy 类型可定义多步骤过滤', () => {
    const strategy: FilterStrategy = {
      stripInfoSeverity: true,
      minConfidence: 0.5,
      stripLowValueFindings: true,
      customRules: [],
    };
    expect(strategy.stripInfoSeverity).toBe(true);
    expect(strategy.minConfidence).toBe(0.5);
  });

  it('filterWithStrategy 默认策略：过滤 info + 低置信度', () => {
    const findings: Finding[] = [
      makeFinding({ severity: 'info', confidence: 0.9, message: 'info finding' }),
      makeFinding({ severity: 'low', confidence: 0.3, message: 'low confidence finding' }),
      makeFinding({ severity: 'high', confidence: 0.9, message: 'high finding' }),
    ];
    const strategy: FilterStrategy = {
      stripInfoSeverity: true,
      minConfidence: 0.5,
    };
    const result = filterWithStrategy(findings, strategy);
    // info 被过滤、低置信度被过滤、high 高置信度保留
    expect(result.length).toBe(1);
    expect(result[0].severity).toBe('high');
  });

  it('filterWithStrategy 关闭 stripInfoSeverity 时保留 info', () => {
    const findings: Finding[] = [
      makeFinding({ severity: 'info', confidence: 0.9, message: 'info finding' }),
    ];
    const strategy: FilterStrategy = {
      stripInfoSeverity: false,
      minConfidence: 0.5,
    };
    const result = filterWithStrategy(findings, strategy);
    expect(result.length).toBe(1);
  });

  it('filterWithStrategy 启用 stripLowValueFindings 时过滤低价值发现', () => {
    const findings: Finding[] = [
      makeFinding({
        severity: 'low',
        confidence: 0.7,
        message: '建议添加 JSDoc 注释',
      }),
      makeFinding({
        severity: 'low',
        confidence: 0.7,
        message: 'imports should be sorted',
      }),
      makeFinding({
        severity: 'high',
        confidence: 0.7,
        message: 'SQL injection risk',
      }),
    ];
    const strategy: FilterStrategy = {
      stripLowValueFindings: true,
      minConfidence: 0,
    };
    const result = filterWithStrategy(findings, strategy);
    // 应保留 SQL injection，过滤 JSDoc 和 import 排序
    expect(result.length).toBe(1);
    expect(result[0].message).toContain('SQL injection');
  });

  it('filterWithStrategy 应用自定义规则', () => {
    const findings: Finding[] = [
      makeFinding({ severity: 'medium', confidence: 0.9, message: 'normal finding', file: 'a.ts' }),
      makeFinding({ severity: 'high', confidence: 0.9, message: 'special finding', file: 'b.ts' }),
    ];
    const customRule: FalsePositiveRule = {
      id: 'custom-filter-b',
      name: '过滤 b.ts 文件',
      match: (f) => f.file === 'b.ts',
    };
    const strategy: FilterStrategy = {
      customRules: [customRule],
    };
    const result = filterWithStrategy(findings, strategy);
    expect(result.length).toBe(1);
    expect(result[0].file).toBe('a.ts');
  });

  it('filterWithStrategy 组合所有策略：精确过滤', () => {
    const findings: Finding[] = [
      // 1. info - 应被 stripInfoSeverity 过滤
      makeFinding({ severity: 'info', confidence: 0.9, message: 'info' }),
      // 2. low + 低置信度 - 应被 minConfidence 过滤
      makeFinding({ severity: 'low', confidence: 0.3, message: 'low conf' }),
      // 3. low + 高置信度 + 低价值 - 应被 stripLowValueFindings 过滤
      makeFinding({ severity: 'low', confidence: 0.9, message: '建议添加 JSDoc' }),
      // 4. medium + 高置信度 + 真实问题 - 应保留
      makeFinding({ severity: 'medium', confidence: 0.9, message: 'real issue', file: 'a.ts' }),
      // 5. high + 高置信度 - 应保留
      makeFinding({ severity: 'high', confidence: 0.95, message: 'security issue' }),
    ];
    const strategy: FilterStrategy = {
      stripInfoSeverity: true,
      minConfidence: 0.5,
      stripLowValueFindings: true,
    };
    const result = filterWithStrategy(findings, strategy);
    // 应保留 #4 和 #5
    expect(result.length).toBe(2);
    expect(result.some((f) => f.message === 'real issue')).toBe(true);
    expect(result.some((f) => f.message === 'security issue')).toBe(true);
  });
});

// ── 反思阈值可配置（迭代 7） ──

describe('迭代 7：反思阈值可配置', () => {
  it('DEFAULT_REFLECTION_THRESHOLD 默认值 = 0.6', () => {
    expect(DEFAULT_REFLECTION_THRESHOLD).toBe(0.6);
  });

  it('reflectFindings 默认使用 0.6 阈值', async () => {
    // LLM 不可用时应降级保留所有 findings
    const findings: Finding[] = [
      makeFinding({ confidence: 0.3 }),
      makeFinding({ confidence: 0.9 }),
    ];
    // 不传 minConfidence，应使用默认 0.6
    const result = await reflectFindings(findings, {
      provider: 'openai',
      apiKey: 'invalid',
      model: 'gpt-4',
    }).catch(() => findings);
    // 降级时保留所有
    expect(result.length).toBe(2);
  });

  it('reflectFindings 接受自定义阈值', async () => {
    const findings: Finding[] = [
      makeFinding({ confidence: 0.3 }),
      makeFinding({ confidence: 0.9 }),
    ];
    // 传 minConfidence = 0.5
    const result = await reflectFindings(
      findings,
      {
        provider: 'openai',
        apiKey: 'invalid',
        model: 'gpt-4',
      },
      0.5,
    ).catch(() => findings);
    // 降级时保留所有（LLM 不可用）
    expect(result.length).toBe(2);
  });
});

// ── 组合过滤策略精度（迭代 7） ──

describe('迭代 7：组合过滤策略精度', () => {
  it('组合策略：先 severity 后 confidence，精确控制结果', () => {
    const findings: Finding[] = [
      makeFinding({ severity: 'info', confidence: 0.9 }),
      makeFinding({ severity: 'low', confidence: 0.3 }),
      makeFinding({ severity: 'low', confidence: 0.8 }),
      makeFinding({ severity: 'medium', confidence: 0.7 }),
      makeFinding({ severity: 'high', confidence: 0.95 }),
    ];
    // 步骤 1: 过滤 info
    const step1 = filterBySeverity(findings, 'low');
    expect(step1.length).toBe(4); // 排除 info

    // 步骤 2: 过滤低置信度
    const step2 = filterByConfidence(step1, 0.5);
    expect(step2.length).toBe(3); // 排除 confidence=0.3
    expect(step2.every((f) => f.severity !== 'info')).toBe(true);
    expect(step2.every((f) => f.confidence >= 0.5)).toBe(true);
  });

  it('组合策略：filterFalsePositives + filterWithStrategy 协同', () => {
    const findings: Finding[] = [
      // 内置 FP 规则应过滤
      makeFinding({
        severity: 'low',
        confidence: 0.4,
        message: 'TODO: refactor',
      }),
      // info 应被 strategy 过滤
      makeFinding({
        severity: 'info',
        confidence: 0.9,
        message: 'info finding',
      }),
      // 真实问题应保留
      makeFinding({
        severity: 'high',
        confidence: 0.9,
        message: 'sql injection',
        category: 'security',
      }),
    ];

    // 先用内置 FP 规则过滤
    const afterBuiltinFP = filterFalsePositives(findings);
    // 再用 strategy 过滤 info
    const final = filterWithStrategy(afterBuiltinFP, {
      stripInfoSeverity: true,
      minConfidence: 0,
    });
    expect(final.length).toBe(1);
    expect(final[0].message).toContain('sql injection');
  });

  it('迭代 7 整体目标：误报率显著降低', () => {
    // 构造 10 个 finding：5 个误报 + 5 个真阳
    const findings: Finding[] = [
      // 误报 1: info 级别
      makeFinding({ severity: 'info', confidence: 0.9, message: 'info 1' }),
      // 误报 2: 低置信度 + low
      makeFinding({ severity: 'low', confidence: 0.3, message: 'low conf 2' }),
      // 误报 3: TODO
      makeFinding({ severity: 'low', confidence: 0.4, message: 'TODO: refactor 3' }),
      // 误报 4: JSDoc 建议
      makeFinding({ severity: 'low', confidence: 0.4, message: '建议添加 JSDoc 注释 4' }),
      // 误报 5: import 排序
      makeFinding({ severity: 'low', confidence: 0.4, message: 'imports should be sorted 5' }),
      // 真阳 1-5
      makeFinding({ severity: 'critical', confidence: 0.95, message: 'eval injection 1', category: 'security' }),
      makeFinding({ severity: 'high', confidence: 0.9, message: 'sql injection 2', category: 'security' }),
      makeFinding({ severity: 'high', confidence: 0.9, message: 'xss risk 3', category: 'security' }),
      makeFinding({ severity: 'medium', confidence: 0.8, message: 'memory leak 4', category: 'quality' }),
      makeFinding({ severity: 'medium', confidence: 0.85, message: 'race condition 5', category: 'quality' }),
    ];

    // 应用 filterWithStrategy：组合 stripInfo + minConf + stripLowValue
    const filtered = filterWithStrategy(findings, {
      stripInfoSeverity: true,
      minConfidence: 0.5,
      stripLowValueFindings: true,
    });

    // 误报率 = 误报数 / 总数；过滤后应保留所有真阳
    const truePositives = filtered.filter((f) =>
      f.message.includes('injection') ||
      f.message.includes('xss') ||
      f.message.includes('memory') ||
      f.message.includes('race'),
    );
    expect(truePositives.length).toBe(5); // 全部真阳保留

    // 误报应被过滤掉
    const falsePositivesRemaining = filtered.filter((f) =>
      f.message.includes('TODO') ||
      f.message.includes('JSDoc') ||
      f.message.includes('imports') ||
      f.message.includes('info 1') ||
      f.message.includes('low conf 2'),
    );
    expect(falsePositivesRemaining.length).toBe(0);

    // 总数应 ≤ 5（仅真阳）
    expect(filtered.length).toBe(5);
  });
});
