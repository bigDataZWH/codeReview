// tests/prompt-optimization.test.ts — 迭代 8：Prompt 工程优化（变体管理 + A/B 测试 + 三层方法论）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createPromptVariant,
  selectPromptVariant,
  trackPromptMetrics,
  buildSecurityPrompt,
  type PromptVariant,
  type PromptMetrics,
  type PromptMetricsStore,
} from '../src/prompt-builder.js';
import type { FileDiff, FileBundle, PipelineContext, RuleAnnotation } from '../src/types.js';

// ── 辅助函数 ──

function makeDiff(path: string): FileDiff {
  return {
    path,
    status: 'modified',
    hunks: [
      {
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 3,
        header: '@@ -1 +1,3 @@',
        lines: [
          { type: 'delete', content: '-old', oldLineNumber: 1 },
          { type: 'add', content: '+new1', newLineNumber: 1 },
          { type: 'add', content: '+new2', newLineNumber: 2 },
        ],
      },
    ],
  };
}

function makeBundle(path: string, annotations: RuleAnnotation[] = []): FileBundle {
  return {
    id: path,
    primary: makeDiff(path),
    related: [],
    annotations,
  };
}

function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  const diffs: FileDiff[] = [makeDiff('src/app.ts'), makeDiff('src/util.ts')];
  const bundles: FileBundle[] = [makeBundle('src/app.ts'), makeBundle('src/util.ts')];
  return {
    filteredDiffs: diffs,
    bundles,
    annotatedBundles: bundles,
    ...overrides,
  };
}

// ==================== PromptVariant 类型与 createPromptVariant ====================

describe('PromptVariant 变体管理', () => {
  it('createPromptVariant 创建带 name/template/version 的变体', () => {
    const variant = createPromptVariant({
      name: 'v1',
      template: 'Hello $FILE_LIST',
      version: '1.0.0',
    });

    expect(variant.name).toBe('v1');
    expect(variant.template).toBe('Hello $FILE_LIST');
    expect(variant.version).toBe('1.0.0');
    expect(variant.id).toBeTypeOf('string');
    expect(variant.id.length).toBeGreaterThan(0);
  });

  it('createPromptVariant 默认 version 为 "1.0.0"', () => {
    const variant = createPromptVariant({
      name: 'v1',
      template: 'Hello',
    });
    expect(variant.version).toBe('1.0.0');
  });

  it('createPromptVariant 默认 weight 为 1', () => {
    const variant = createPromptVariant({
      name: 'v1',
      template: 'Hello',
    });
    expect(variant.weight).toBe(1);
  });

  it('createPromptVariant 支持自定义 weight', () => {
    const variant = createPromptVariant({
      name: 'v1',
      template: 'Hello',
      weight: 3,
    });
    expect(variant.weight).toBe(3);
  });

  it('createPromptVariant 拒绝空 name', () => {
    expect(() =>
      createPromptVariant({ name: '', template: 'Hello' }),
    ).toThrow(/name/);
  });

  it('createPromptVariant 拒绝空 template', () => {
    expect(() =>
      createPromptVariant({ name: 'v1', template: '' }),
    ).toThrow(/template/);
  });

  it('createPromptVariant 拒绝负 weight', () => {
    expect(() =>
      createPromptVariant({ name: 'v1', template: 'Hello', weight: -1 }),
    ).toThrow(/weight/);
  });

  it('createPromptVariant 生成的 id 唯一', () => {
    const v1 = createPromptVariant({ name: 'v1', template: 'Hello' });
    const v2 = createPromptVariant({ name: 'v2', template: 'World' });
    expect(v1.id).not.toBe(v2.id);
  });

  it('createPromptVariant 携带 metadata 字段', () => {
    const variant = createPromptVariant({
      name: 'v1',
      template: 'Hello',
      metadata: { author: 'team', description: 'baseline' },
    });
    expect(variant.metadata?.author).toBe('team');
    expect(variant.metadata?.description).toBe('baseline');
  });
});

// ==================== selectPromptVariant A/B 测试分配 ====================

describe('selectPromptVariant 变体分配', () => {
  it('单个变体时总是返回该变体', () => {
    const variants = [
      createPromptVariant({ name: 'solo', template: 't1' }),
    ];
    const picked = selectPromptVariant(variants);
    expect(picked.name).toBe('solo');
  });

  it('空数组时抛出错误', () => {
    expect(() => selectPromptVariant([])).toThrow(/empty|variant/i);
  });

  it('按权重分配：高权重变体被选中概率更高', () => {
    const variants = [
      createPromptVariant({ name: 'a', template: 'ta', weight: 1 }),
      createPromptVariant({ name: 'b', template: 'tb', weight: 9 }),
    ];
    // mock Math.random 返回 0.05 → 应选 a（落在 [0, 1) 区间）
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.05);
    expect(selectPromptVariant(variants).name).toBe('a');
    // mock Math.random 返回 0.5 → 应选 b（落在 [1, 10) 区间）
    spy.mockReturnValue(0.5);
    expect(selectPromptVariant(variants).name).toBe('b');
    // mock Math.random 返回 0.99 → 应选 b
    spy.mockReturnValue(0.99);
    expect(selectPromptVariant(variants).name).toBe('b');
    spy.mockRestore();
  });

  it('按权重分配：单权重时随机分布', () => {
    const variants = [
      createPromptVariant({ name: 'a', template: 'ta' }),
      createPromptVariant({ name: 'b', template: 'tb' }),
    ];
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.0);
    expect(selectPromptVariant(variants).name).toBe('a');
    spy.mockReturnValue(0.99);
    expect(selectPromptVariant(variants).name).toBe('b');
    spy.mockRestore();
  });

  it('支持传入 deterministic key 实现稳定分配', () => {
    const variants = [
      createPromptVariant({ name: 'a', template: 'ta', weight: 1 }),
      createPromptVariant({ name: 'b', template: 'tb', weight: 1 }),
    ];
    // 相同 key → 相同分配
    const r1 = selectPromptVariant(variants, { key: 'user-123' });
    const r2 = selectPromptVariant(variants, { key: 'user-123' });
    expect(r1.name).toBe(r2.name);
    // 不同 key 可能不同（不强制要求不同，但相同 key 必须稳定）
  });

  it('deterministic key 在不同权重下保持稳定', () => {
    const variants = [
      createPromptVariant({ name: 'a', template: 'ta', weight: 3 }),
      createPromptVariant({ name: 'b', template: 'tb', weight: 7 }),
    ];
    const r1 = selectPromptVariant(variants, { key: 'pr-42' });
    const r2 = selectPromptVariant(variants, { key: 'pr-42' });
    const r3 = selectPromptVariant(variants, { key: 'pr-42' });
    expect(r1.name).toBe(r2.name);
    expect(r2.name).toBe(r3.name);
  });

  it('权重全为 0 时退化为均匀随机', () => {
    const variants = [
      createPromptVariant({ name: 'a', template: 'ta', weight: 0 }),
      createPromptVariant({ name: 'b', template: 'tb', weight: 0 }),
    ];
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.0);
    expect(selectPromptVariant(variants).name).toBe('a');
    spy.mockReturnValue(0.99);
    expect(selectPromptVariant(variants).name).toBe('b');
    spy.mockRestore();
  });
});

// ==================== trackPromptMetrics A/B 测试效果统计 ====================

describe('trackPromptMetrics 效果统计', () => {
  let store: PromptMetricsStore;
  beforeEach(() => {
    store = trackPromptMetrics();
  });

  it('初始状态：无记录', () => {
    expect(store.getAll()).toEqual([]);
    expect(store.getVariantStats('v1')).toBeNull();
  });

  it('record 记录单次 prompt 使用指标', () => {
    store.record({
      variantId: 'v1',
      timestamp: Date.now(),
      findingCount: 5,
      acceptCount: 2,
      rejectCount: 1,
      modifyCount: 0,
      tokenCount: 1000,
      durationMs: 1200,
    });
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0].variantId).toBe('v1');
  });

  it('getVariantStats 聚合单变体统计', () => {
    store.record({
      variantId: 'v1', timestamp: 1, findingCount: 10,
      acceptCount: 4, rejectCount: 2, modifyCount: 1,
      tokenCount: 1000, durationMs: 1000,
    });
    store.record({
      variantId: 'v1', timestamp: 2, findingCount: 10,
      acceptCount: 6, rejectCount: 2, modifyCount: 1,
      tokenCount: 1200, durationMs: 1500,
    });
    const stats = store.getVariantStats('v1');
    expect(stats).not.toBeNull();
    expect(stats!.sampleCount).toBe(2);
    expect(stats!.totalFindings).toBe(20);
    expect(stats!.totalAccept).toBe(10);
    expect(stats!.totalReject).toBe(4);
    expect(stats!.totalModify).toBe(2);
    // 接受率 = 10 / (10+4+2) = 10/16 = 0.625
    expect(stats!.acceptRate).toBeCloseTo(0.625, 5);
    expect(stats!.avgTokens).toBe(1100);
    expect(stats!.avgDurationMs).toBe(1250);
  });

  it('getVariantStats 对未知 variantId 返回 null', () => {
    expect(store.getVariantStats('unknown')).toBeNull();
  });

  it('compareVariants 返回所有变体的对比统计', () => {
    store.record({
      variantId: 'a', timestamp: 1, findingCount: 10,
      acceptCount: 4, rejectCount: 6, modifyCount: 0,
      tokenCount: 1000, durationMs: 1000,
    });
    store.record({
      variantId: 'b', timestamp: 2, findingCount: 10,
      acceptCount: 8, rejectCount: 2, modifyCount: 0,
      tokenCount: 1500, durationMs: 800,
    });
    const comparison = store.compareVariants();
    expect(comparison).toHaveLength(2);
    // 按 acceptRate 降序
    expect(comparison[0].acceptRate).toBeGreaterThanOrEqual(comparison[1].acceptRate);
  });

  it('compareVariants 空数据返回空数组', () => {
    expect(store.compareVariants()).toEqual([]);
  });

  it('getVariantStats 在 0 反馈时 acceptRate 为 0', () => {
    store.record({
      variantId: 'v1', timestamp: 1, findingCount: 0,
      acceptCount: 0, rejectCount: 0, modifyCount: 0,
      tokenCount: 500, durationMs: 800,
    });
    const stats = store.getVariantStats('v1');
    expect(stats!.acceptRate).toBe(0);
  });

  it('pickWinner 返回 acceptRate 最高的变体', () => {
    store.record({
      variantId: 'a', timestamp: 1, findingCount: 10,
      acceptCount: 4, rejectCount: 6, modifyCount: 0,
      tokenCount: 1000, durationMs: 1000,
    });
    store.record({
      variantId: 'b', timestamp: 2, findingCount: 10,
      acceptCount: 8, rejectCount: 2, modifyCount: 0,
      tokenCount: 1500, durationMs: 800,
    });
    const winner = store.pickWinner();
    expect(winner).not.toBeNull();
    expect(winner!.variantId).toBe('b');
  });

  it('pickWinner 在样本数 < minSamples 时返回 null', () => {
    store.record({
      variantId: 'a', timestamp: 1, findingCount: 10,
      acceptCount: 4, rejectCount: 6, modifyCount: 0,
      tokenCount: 1000, durationMs: 1000,
    });
    expect(store.pickWinner({ minSamples: 5 })).toBeNull();
  });

  it('clear 清空所有指标', () => {
    store.record({
      variantId: 'v1', timestamp: 1, findingCount: 1,
      acceptCount: 1, rejectCount: 0, modifyCount: 0,
      tokenCount: 100, durationMs: 100,
    });
    store.clear();
    expect(store.getAll()).toEqual([]);
  });
});

// ==================== 安全审查三层方法论 ====================

describe('buildSecurityPrompt 三层方法论', () => {
  it('Prompt 中包含三层方法论结构', () => {
    const prompt = buildSecurityPrompt(makeContext());
    // 第一层：仓库上下文研究
    expect(prompt).toMatch(/第一层|Layer 1|仓库上下文|Repository Context/i);
    // 第二层：diff 对比分析
    expect(prompt).toMatch(/第二层|Layer 2|diff|对比分析|Comparative/i);
    // 第三层：漏洞评估
    expect(prompt).toMatch(/第三层|Layer 3|漏洞评估|Vulnerability/i);
  });

  it('第一层 Prompt 包含架构、认证机制、数据流', () => {
    const prompt = buildSecurityPrompt(makeContext());
    expect(prompt).toMatch(/架构|architecture/i);
    expect(prompt).toMatch(/认证|authentication|auth/i);
    expect(prompt).toMatch(/数据流|data flow/i);
  });

  it('第二层 Prompt 包含安全敏感变更识别', () => {
    const prompt = buildSecurityPrompt(makeContext());
    expect(prompt).toMatch(/安全敏感|security-sensitive|敏感变更/i);
  });

  it('第三层 Prompt 包含严重度、可利用性、修复建议', () => {
    const prompt = buildSecurityPrompt(makeContext());
    expect(prompt).toMatch(/严重度|severity/i);
    expect(prompt).toMatch(/可利用性|exploitability|exploit/i);
    expect(prompt).toMatch(/修复建议|recommendation|remediation/i);
  });

  it('保留原有 OWASP / 安全维度内容', () => {
    const prompt = buildSecurityPrompt(makeContext());
    expect(prompt).toMatch(/SQL|injection|XSS|CSRF/i);
  });

  it('保留 diff 内容嵌入', () => {
    const prompt = buildSecurityPrompt(makeContext());
    expect(prompt).toContain('src/app.ts');
    expect(prompt).toContain('-old');
    expect(prompt).toContain('+new1');
  });

  it('空输入时仍能生成三层方法论 prompt', () => {
    const context: PipelineContext = {
      filteredDiffs: [],
      bundles: [],
      annotatedBundles: [],
    };
    const prompt = buildSecurityPrompt(context);
    expect(prompt).toMatch(/第一层|Layer 1/i);
    expect(prompt).toMatch(/第二层|Layer 2/i);
    expect(prompt).toMatch(/第三层|Layer 3/i);
    expect(prompt.length).toBeGreaterThan(0);
  });
});

// ==================== Prompt 版本管理 ====================

describe('Prompt 版本管理', () => {
  it('variant.version 默认 "1.0.0"', () => {
    const v = createPromptVariant({ name: 'a', template: 't' });
    expect(v.version).toBe('1.0.0');
  });

  it('variant.version 支持语义化版本', () => {
    const v = createPromptVariant({ name: 'a', template: 't', version: '2.3.1' });
    expect(v.version).toBe('2.3.1');
  });

  it('同一 prompt 多版本可独立管理', () => {
    const v1 = createPromptVariant({ name: 'security', template: 'old', version: '1.0.0' });
    const v2 = createPromptVariant({ name: 'security', template: 'new', version: '2.0.0' });
    expect(v1.id).not.toBe(v2.id);
    expect(v1.version).not.toBe(v2.version);
    expect(v1.template).not.toBe(v2.template);
  });
});
