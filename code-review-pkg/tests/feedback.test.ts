import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FeedbackStore,
  loadIgnoreConfig,
  shouldIgnore,
  type FeedbackAction,
  type FeedbackRecord,
  type FeedbackStats,
  type FalsePositivePattern,
  type RuleSuggestion,
  type IgnoreConfig,
  type IgnoreRule,
} from '../src/feedback.js';
import type { Finding } from '../src/types.js';

/** 构造一条测试 finding */
function makeFinding(partial: Partial<Finding> = {}): Finding {
  return {
    file: 'src/index.ts',
    line: 10,
    severity: 'high',
    category: 'security',
    message: 'SQL injection',
    confidence: 0.9,
    source: 'rule',
    ...partial,
  };
}

// ==================== 反馈采集器 ====================

describe('反馈采集器 FeedbackStore', () => {
  let store: FeedbackStore;

  beforeEach(() => {
    store = new FeedbackStore();
  });

  it('recordFeedback 记录 accept 反馈并返回记录', () => {
    const rec = store.recordFeedback('f1', 'accept');
    expect(rec.findingId).toBe('f1');
    expect(rec.action).toBe('accept');
    expect(rec.timestamp).toBeTypeOf('number');
  });

  it('recordFeedback 记录 reject 反馈及 reason', () => {
    const rec = store.recordFeedback('f1', 'reject', '误报');
    expect(rec.action).toBe('reject');
    expect(rec.reason).toBe('误报');
  });

  it('recordFeedback 记录 modify 反馈', () => {
    const rec = store.recordFeedback('f1', 'modify', '建议修改');
    expect(rec.action).toBe('modify');
  });

  it('recordFeedback 自动生成唯一 id', () => {
    const r1 = store.recordFeedback('f1', 'accept');
    const r2 = store.recordFeedback('f2', 'accept');
    expect(r1.id).not.toBe(r2.id);
  });

  it('recordFeedback 不传 reason 时 reason 为 undefined', () => {
    const rec = store.recordFeedback('f1', 'accept');
    expect(rec.reason).toBeUndefined();
  });

  it('getFeedbackByFinding 返回该 finding 的反馈', () => {
    store.recordFeedback('f1', 'accept');
    const list = store.getFeedbackByFinding('f1');
    expect(list).toHaveLength(1);
    expect(list[0].action).toBe('accept');
  });

  it('getFeedbackByFinding 对不存在反馈返回空数组', () => {
    expect(store.getFeedbackByFinding('nope')).toEqual([]);
  });

  it('反馈去重：同一 finding 多次反馈只保留最新', () => {
    store.recordFeedback('f1', 'accept');
    store.recordFeedback('f1', 'reject', '改主意');
    const list = store.getFeedbackByFinding('f1');
    expect(list).toHaveLength(1);
    expect(list[0].action).toBe('reject');
    expect(list[0].reason).toBe('改主意');
  });

  it('反馈时间戳记录为当前时间', () => {
    const before = Date.now();
    const rec = store.recordFeedback('f1', 'accept');
    const after = Date.now();
    expect(rec.timestamp).toBeGreaterThanOrEqual(before);
    expect(rec.timestamp).toBeLessThanOrEqual(after);
  });

  it('反馈时间戳在去重后保留最新记录的时间戳', async () => {
    const r1 = store.recordFeedback('f1', 'accept');
    await new Promise((r) => setTimeout(r, 5));
    const r2 = store.recordFeedback('f1', 'reject');
    const list = store.getFeedbackByFinding('f1');
    expect(list[0].timestamp).toBe(r2.timestamp);
    expect(list[0].timestamp).toBeGreaterThan(r1.timestamp);
  });

  it('recordFeedback 同时保存 finding 快照与冗余字段', () => {
    const f = makeFinding({ category: 'perf', ruleId: 'r-1', file: 'a.ts', severity: 'medium' });
    const rec = store.recordFeedback('f1', 'accept', undefined, f);
    expect(rec.findingSnapshot).toBeDefined();
    expect(rec.findingSnapshot?.category).toBe('perf');
    expect(rec.category).toBe('perf');
    expect(rec.ruleId).toBe('r-1');
    expect(rec.file).toBe('a.ts');
    expect(rec.severity).toBe('medium');
  });

  it('recordFeedback 未传 finding 时冗余字段回退到默认值', () => {
    const rec = store.recordFeedback('f1', 'accept');
    expect(rec.findingSnapshot).toBeUndefined();
    expect(rec.category).toBe('unknown');
    expect(rec.ruleId).toBeUndefined();
    expect(rec.file).toBe('');
    expect(rec.severity).toBe('info');
  });

  it('getFeedbackStats 空仓库返回零统计', () => {
    const stats = store.getFeedbackStats();
    expect(stats.total).toBe(0);
    expect(stats.acceptCount).toBe(0);
    expect(stats.rejectCount).toBe(0);
    expect(stats.modifyCount).toBe(0);
    expect(stats.acceptRate).toBe(0);
    expect(stats.rejectRate).toBe(0);
    expect(stats.modifyRate).toBe(0);
  });

  it('getFeedbackStats 统计总数与各动作数量', () => {
    store.recordFeedback('f1', 'accept');
    store.recordFeedback('f2', 'accept');
    store.recordFeedback('f3', 'reject');
    store.recordFeedback('f4', 'modify');
    const stats = store.getFeedbackStats();
    expect(stats.total).toBe(4);
    expect(stats.acceptCount).toBe(2);
    expect(stats.rejectCount).toBe(1);
    expect(stats.modifyCount).toBe(1);
  });

  it('getFeedbackStats 计算各动作比例', () => {
    store.recordFeedback('f1', 'accept');
    store.recordFeedback('f2', 'reject');
    const stats = store.getFeedbackStats();
    expect(stats.total).toBe(2);
    expect(stats.acceptRate).toBeCloseTo(0.5, 5);
    expect(stats.rejectRate).toBeCloseTo(0.5, 5);
    expect(stats.modifyRate).toBeCloseTo(0, 5);
  });

  it('getFeedbackStats 反映去重后的最新动作', () => {
    store.recordFeedback('f1', 'accept');
    store.recordFeedback('f1', 'reject'); // 覆盖
    const stats = store.getFeedbackStats();
    expect(stats.total).toBe(1);
    expect(stats.acceptCount).toBe(0);
    expect(stats.rejectCount).toBe(1);
  });

  it('getFeedbackByAction 返回指定动作的所有反馈', () => {
    store.recordFeedback('f1', 'accept');
    store.recordFeedback('f2', 'reject');
    store.recordFeedback('f3', 'accept');
    const accepts = store.getFeedbackByAction('accept');
    expect(accepts).toHaveLength(2);
    expect(accepts.every((r) => r.action === 'accept')).toBe(true);
  });

  it('getFeedbackByAction 无匹配返回空数组', () => {
    store.recordFeedback('f1', 'accept');
    expect(store.getFeedbackByAction('reject')).toEqual([]);
  });

  it('getFeedbackByAction 反映去重后的最新状态', () => {
    store.recordFeedback('f1', 'accept');
    store.recordFeedback('f1', 'reject');
    const accepts = store.getFeedbackByAction('accept');
    const rejects = store.getFeedbackByAction('reject');
    expect(accepts).toHaveLength(0);
    expect(rejects).toHaveLength(1);
  });

  it('getAllFeedback 返回所有当前反馈（去重后）', () => {
    store.recordFeedback('f1', 'accept');
    store.recordFeedback('f2', 'reject');
    store.recordFeedback('f1', 'modify'); // 覆盖 f1
    const all = store.getAllFeedback();
    expect(all).toHaveLength(2);
    const ids = all.map((r) => r.findingId).sort();
    expect(ids).toEqual(['f1', 'f2']);
  });

  it('clear 清空所有反馈', () => {
    store.recordFeedback('f1', 'accept');
    store.recordFeedback('f2', 'reject');
    store.clear();
    expect(store.getFeedbackStats().total).toBe(0);
    expect(store.getAllFeedback()).toEqual([]);
  });

  it('size 返回当前反馈条数（去重后）', () => {
    store.recordFeedback('f1', 'accept');
    store.recordFeedback('f2', 'reject');
    store.recordFeedback('f1', 'modify');
    expect(store.size()).toBe(2);
  });
});

// ==================== 误报模式分析 ====================

describe('误报模式分析 analyzeFalsePositivePatterns', () => {
  let store: FeedbackStore;

  beforeEach(() => {
    store = new FeedbackStore();
  });

  it('反馈数据 < 100 时返回空数组（不启用分析）', () => {
    for (let i = 0; i < 99; i++) {
      store.recordFeedback(`f-${i}`, 'reject', undefined, makeFinding({ category: 'security', ruleId: 'r1' }));
    }
    expect(store.analyzeFalsePositivePatterns()).toEqual([]);
  });

  it('反馈数据正好 100 条时启用分析', () => {
    for (let i = 0; i < 100; i++) {
      store.recordFeedback(`f-${i}`, 'reject', undefined, makeFinding({ category: 'security', ruleId: 'sql-injection' }));
    }
    const patterns = store.analyzeFalsePositivePatterns();
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns[0].count).toBe(100);
    expect(patterns[0].pattern).toContain('security');
    expect(patterns[0].suggestion).toBeTypeOf('string');
    expect(patterns[0].suggestion.length).toBeGreaterThan(0);
  });

  it('按 (category + ruleId) 聚类频繁被 reject 的模式', () => {
    for (let i = 0; i < 60; i++) {
      store.recordFeedback(`a-${i}`, 'reject', undefined, makeFinding({ category: 'security', ruleId: 'r-a' }));
    }
    for (let i = 0; i < 40; i++) {
      store.recordFeedback(`b-${i}`, 'reject', undefined, makeFinding({ category: 'performance', ruleId: 'r-b' }));
    }
    for (let i = 0; i < 10; i++) {
      store.recordFeedback(`c-${i}`, 'accept', undefined, makeFinding({ category: 'style', ruleId: 'r-c' }));
    }
    const patterns = store.analyzeFalsePositivePatterns();
    expect(patterns).toHaveLength(2);
    expect(patterns[0].count).toBeGreaterThanOrEqual(patterns[1].count);
    expect(patterns[0].count).toBe(60);
  });

  it('没有 ruleId 时按 category 聚类', () => {
    for (let i = 0; i < 100; i++) {
      store.recordFeedback(`x-${i}`, 'reject', undefined, makeFinding({ category: 'security', ruleId: undefined }));
    }
    const patterns = store.analyzeFalsePositivePatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0].pattern).toContain('security');
    expect(patterns[0].pattern).not.toContain('ruleId');
  });

  it('accept 和 modify 反馈不参与误报模式分析', () => {
    for (let i = 0; i < 50; i++) {
      store.recordFeedback(`a-${i}`, 'accept', undefined, makeFinding({ category: 'security', ruleId: 'r-a' }));
    }
    for (let i = 0; i < 50; i++) {
      store.recordFeedback(`m-${i}`, 'modify', undefined, makeFinding({ category: 'security', ruleId: 'r-a' }));
    }
    for (let i = 0; i < 50; i++) {
      store.recordFeedback(`r-${i}`, 'reject', undefined, makeFinding({ category: 'performance', ruleId: 'r-b' }));
    }
    // total = 150 >= 100，但 reject 只有 50 条
    const patterns = store.analyzeFalsePositivePatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0].pattern).toContain('performance');
    expect(patterns[0].count).toBe(50);
  });

  it('模式列表按 count 降序排序', () => {
    for (let i = 0; i < 30; i++) {
      store.recordFeedback(`s-${i}`, 'reject', undefined, makeFinding({ category: 'security', ruleId: 'r-s' }));
    }
    for (let i = 0; i < 70; i++) {
      store.recordFeedback(`p-${i}`, 'reject', undefined, makeFinding({ category: 'performance', ruleId: 'r-p' }));
    }
    for (let i = 0; i < 50; i++) {
      store.recordFeedback(`q-${i}`, 'reject', undefined, makeFinding({ category: 'quality', ruleId: 'r-q' }));
    }
    const patterns = store.analyzeFalsePositivePatterns();
    expect(patterns[0].count).toBe(70);
    expect(patterns[1].count).toBe(50);
    expect(patterns[2].count).toBe(30);
  });

  it('suggestion 文本包含模式信息', () => {
    for (let i = 0; i < 100; i++) {
      store.recordFeedback(`f-${i}`, 'reject', undefined, makeFinding({ category: 'security', ruleId: 'sql-injection' }));
    }
    const patterns = store.analyzeFalsePositivePatterns();
    expect(patterns[0].suggestion).toContain('security');
  });

  it('没有 reject 反馈但 total >= 100 时返回空数组', () => {
    for (let i = 0; i < 100; i++) {
      store.recordFeedback(`f-${i}`, 'accept', undefined, makeFinding({ category: 'security', ruleId: 'r1' }));
    }
    expect(store.analyzeFalsePositivePatterns()).toEqual([]);
  });
});

// ==================== 规则建议生成 ====================

describe('规则建议生成 generateRuleSuggestions', () => {
  let store: FeedbackStore;

  beforeEach(() => {
    store = new FeedbackStore();
  });

  it('数据 < 100 时返回空数组', () => {
    for (let i = 0; i < 99; i++) {
      store.recordFeedback(`f-${i}`, 'reject', undefined, makeFinding({ category: 'security', ruleId: 'r1' }));
    }
    expect(store.generateRuleSuggestions()).toEqual([]);
  });

  it('基于误报模式生成规则建议', () => {
    for (let i = 0; i < 100; i++) {
      store.recordFeedback(`f-${i}`, 'reject', undefined, makeFinding({ category: 'security', ruleId: 'sql-injection' }));
    }
    const suggestions = store.generateRuleSuggestions();
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].suggestion).toBeTypeOf('string');
    expect(['high', 'medium', 'low']).toContain(suggestions[0].priority);
  });

  it('count >= 10 的模式标记为 high 优先级', () => {
    for (let i = 0; i < 15; i++) {
      store.recordFeedback(`h-${i}`, 'reject', undefined, makeFinding({ category: 'security', ruleId: 'r-high' }));
    }
    for (let i = 0; i < 85; i++) {
      store.recordFeedback(`o-${i}`, 'reject', undefined, makeFinding({ category: 'other', ruleId: 'r-other' }));
    }
    const suggestions = store.generateRuleSuggestions();
    const high = suggestions.find((s) => s.pattern.includes('r-high'));
    expect(high).toBeDefined();
    expect(high?.priority).toBe('high');
  });

  it('count 在 [5, 10) 的模式标记为 medium 优先级', () => {
    for (let i = 0; i < 7; i++) {
      store.recordFeedback(`m-${i}`, 'reject', undefined, makeFinding({ category: 'security', ruleId: 'r-med' }));
    }
    for (let i = 0; i < 93; i++) {
      store.recordFeedback(`o-${i}`, 'reject', undefined, makeFinding({ category: 'other', ruleId: 'r-other' }));
    }
    const suggestions = store.generateRuleSuggestions();
    const med = suggestions.find((s) => s.pattern.includes('r-med'));
    expect(med).toBeDefined();
    expect(med?.priority).toBe('medium');
  });

  it('count < 5 的模式标记为 low 优先级', () => {
    for (let i = 0; i < 3; i++) {
      store.recordFeedback(`l-${i}`, 'reject', undefined, makeFinding({ category: 'security', ruleId: 'r-low' }));
    }
    for (let i = 0; i < 97; i++) {
      store.recordFeedback(`o-${i}`, 'reject', undefined, makeFinding({ category: 'other', ruleId: 'r-other' }));
    }
    const suggestions = store.generateRuleSuggestions();
    const low = suggestions.find((s) => s.pattern.includes('r-low'));
    expect(low).toBeDefined();
    expect(low?.priority).toBe('low');
  });

  it('建议数与误报模式数一致', () => {
    for (let i = 0; i < 50; i++) {
      store.recordFeedback(`a-${i}`, 'reject', undefined, makeFinding({ category: 'security', ruleId: 'r-a' }));
    }
    for (let i = 0; i < 50; i++) {
      store.recordFeedback(`b-${i}`, 'reject', undefined, makeFinding({ category: 'performance', ruleId: 'r-b' }));
    }
    const patterns = store.analyzeFalsePositivePatterns();
    const suggestions = store.generateRuleSuggestions();
    expect(suggestions).toHaveLength(patterns.length);
  });
});

// ==================== 忽略配置加载 ====================

describe('忽略配置 loadIgnoreConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ignore-cfg-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('加载 YAML 格式的忽略配置', () => {
    const file = join(dir, '.opencode-review-ignore.yaml');
    writeFileSync(file, ['rules:', '  - category: security', '    ruleId: sql-injection', '  - category: style'].join('\n'), 'utf8');
    const cfg = loadIgnoreConfig(file);
    expect(cfg.rules).toHaveLength(2);
    expect(cfg.rules[0].category).toBe('security');
    expect(cfg.rules[0].ruleId).toBe('sql-injection');
    expect(cfg.rules[1].category).toBe('style');
  });

  it('加载包含 filePattern 的规则', () => {
    const file = join(dir, 'ignore.yaml');
    writeFileSync(file, ['rules:', '  - filePattern: "**/test/**"'].join('\n'), 'utf8');
    const cfg = loadIgnoreConfig(file);
    expect(cfg.rules[0].filePattern).toBe('**/test/**');
  });

  it('加载包含 severity 与 messageContains 的规则', () => {
    const file = join(dir, 'ignore.yaml');
    writeFileSync(file, ['rules:', '  - severity: low', '    messageContains: "TODO"'].join('\n'), 'utf8');
    const cfg = loadIgnoreConfig(file);
    expect(cfg.rules[0].severity).toBe('low');
    expect(cfg.rules[0].messageContains).toBe('TODO');
  });

  it('支持 .yml 扩展名', () => {
    const file = join(dir, 'ignore.yml');
    writeFileSync(file, ['rules:', '  - category: security'].join('\n'), 'utf8');
    const cfg = loadIgnoreConfig(file);
    expect(cfg.rules).toHaveLength(1);
    expect(cfg.rules[0].category).toBe('security');
  });

  it('空 rules 返回空数组', () => {
    const file = join(dir, 'ignore.yaml');
    writeFileSync(file, 'rules: []\n', 'utf8');
    const cfg = loadIgnoreConfig(file);
    expect(cfg.rules).toEqual([]);
  });

  it('文件不存在时抛出错误', () => {
    expect(() => loadIgnoreConfig(join(dir, 'nope.yaml'))).toThrow();
  });

  it('注释行与空行被忽略', () => {
    const file = join(dir, 'ignore.yaml');
    writeFileSync(file, ['# 这是注释', '', 'rules:', '  # 子注释', '  - category: security'].join('\n'), 'utf8');
    const cfg = loadIgnoreConfig(file);
    expect(cfg.rules).toHaveLength(1);
    expect(cfg.rules[0].category).toBe('security');
  });

  it('字段值带引号时正确去除引号', () => {
    const file = join(dir, 'ignore.yaml');
    writeFileSync(file, ['rules:', "  - category: \"security\"", "  - messageContains: 'TODO'"].join('\n'), 'utf8');
    const cfg = loadIgnoreConfig(file);
    expect(cfg.rules[0].category).toBe('security');
    expect(cfg.rules[1].messageContains).toBe('TODO');
  });

  it('同时支持多字段的复杂规则', () => {
    const file = join(dir, 'ignore.yaml');
    writeFileSync(
      file,
      [
        'rules:',
        '  - category: security',
        '    ruleId: sql-injection',
        '    filePattern: "**/test/**"',
        '    severity: high',
        '    messageContains: "SQL"',
      ].join('\n'),
      'utf8',
    );
    const cfg = loadIgnoreConfig(file);
    expect(cfg.rules).toHaveLength(1);
    expect(cfg.rules[0].category).toBe('security');
    expect(cfg.rules[0].ruleId).toBe('sql-injection');
    expect(cfg.rules[0].filePattern).toBe('**/test/**');
    expect(cfg.rules[0].severity).toBe('high');
    expect(cfg.rules[0].messageContains).toBe('SQL');
  });

  it('顶层未知键被忽略', () => {
    const file = join(dir, 'ignore.yaml');
    writeFileSync(file, ['version: 1', 'rules:', '  - category: security'].join('\n'), 'utf8');
    const cfg = loadIgnoreConfig(file);
    expect(cfg.rules).toHaveLength(1);
    expect(cfg.rules[0].category).toBe('security');
  });

  it('列表项以单独 "-" 起始行后跟字段', () => {
    const file = join(dir, 'ignore.yaml');
    writeFileSync(file, ['rules:', '  -', '    category: security', '    ruleId: r1'].join('\n'), 'utf8');
    const cfg = loadIgnoreConfig(file);
    expect(cfg.rules).toHaveLength(1);
    expect(cfg.rules[0].category).toBe('security');
    expect(cfg.rules[0].ruleId).toBe('r1');
  });

  it('未知字段被忽略（不写入 IgnoreRule）', () => {
    const file = join(dir, 'ignore.yaml');
    writeFileSync(file, ['rules:', '  - category: security', '    unknownField: foo'].join('\n'), 'utf8');
    const cfg = loadIgnoreConfig(file);
    expect(cfg.rules).toHaveLength(1);
    expect(cfg.rules[0].category).toBe('security');
    expect((cfg.rules[0] as Record<string, unknown>).unknownField).toBeUndefined();
  });

  it('空字段值被忽略', () => {
    const file = join(dir, 'ignore.yaml');
    writeFileSync(file, ['rules:', '  - category:'].join('\n'), 'utf8');
    const cfg = loadIgnoreConfig(file);
    expect(cfg.rules).toHaveLength(1);
    expect(cfg.rules[0].category).toBeUndefined();
  });

  it('rules 之后又出现顶层键时停止收集', () => {
    const file = join(dir, 'ignore.yaml');
    writeFileSync(
      file,
      ['rules:', '  - category: security', 'other:', '  - foo: bar', '  - category: ignored'].join('\n'),
      'utf8',
    );
    const cfg = loadIgnoreConfig(file);
    expect(cfg.rules).toHaveLength(1);
    expect(cfg.rules[0].category).toBe('security');
  });
});

// ==================== shouldIgnore 判断 ====================

describe('shouldIgnore 判断', () => {
  it('category 匹配时返回 true', () => {
    const cfg: IgnoreConfig = { rules: [{ category: 'security' }] };
    expect(shouldIgnore(makeFinding({ category: 'security' }), cfg)).toBe(true);
  });

  it('category 不匹配时返回 false', () => {
    const cfg: IgnoreConfig = { rules: [{ category: 'security' }] };
    expect(shouldIgnore(makeFinding({ category: 'style' }), cfg)).toBe(false);
  });

  it('ruleId 匹配时返回 true', () => {
    const cfg: IgnoreConfig = { rules: [{ ruleId: 'sql-injection' }] };
    expect(shouldIgnore(makeFinding({ ruleId: 'sql-injection' }), cfg)).toBe(true);
  });

  it('ruleId 不匹配时返回 false', () => {
    const cfg: IgnoreConfig = { rules: [{ ruleId: 'sql-injection' }] };
    expect(shouldIgnore(makeFinding({ ruleId: 'other-rule' }), cfg)).toBe(false);
  });

  it('filePattern 使用 ** 通配匹配', () => {
    const cfg: IgnoreConfig = { rules: [{ filePattern: '**/test/**' }] };
    expect(shouldIgnore(makeFinding({ file: 'src/test/foo.ts' }), cfg)).toBe(true);
    expect(shouldIgnore(makeFinding({ file: 'src/foo.ts' }), cfg)).toBe(false);
  });

  it('filePattern 使用 * 通配匹配文件名', () => {
    const cfg: IgnoreConfig = { rules: [{ filePattern: '*.test.ts' }] };
    expect(shouldIgnore(makeFinding({ file: 'foo.test.ts' }), cfg)).toBe(true);
    expect(shouldIgnore(makeFinding({ file: 'foo.ts' }), cfg)).toBe(false);
  });

  it('filePattern 完全匹配字面值', () => {
    const cfg: IgnoreConfig = { rules: [{ filePattern: 'src/exact.ts' }] };
    expect(shouldIgnore(makeFinding({ file: 'src/exact.ts' }), cfg)).toBe(true);
    expect(shouldIgnore(makeFinding({ file: 'src/other.ts' }), cfg)).toBe(false);
  });

  it('severity 匹配时返回 true', () => {
    const cfg: IgnoreConfig = { rules: [{ severity: 'low' }] };
    expect(shouldIgnore(makeFinding({ severity: 'low' }), cfg)).toBe(true);
    expect(shouldIgnore(makeFinding({ severity: 'high' }), cfg)).toBe(false);
  });

  it('messageContains 子串匹配', () => {
    const cfg: IgnoreConfig = { rules: [{ messageContains: 'TODO' }] };
    expect(shouldIgnore(makeFinding({ message: 'TODO: fix later' }), cfg)).toBe(true);
    expect(shouldIgnore(makeFinding({ message: 'SQL injection' }), cfg)).toBe(false);
  });

  it('messageContains 大小写敏感', () => {
    const cfg: IgnoreConfig = { rules: [{ messageContains: 'TODO' }] };
    expect(shouldIgnore(makeFinding({ message: 'todo: lower' }), cfg)).toBe(false);
  });

  it('多字段同时指定时需全部匹配（AND 逻辑）', () => {
    const cfg: IgnoreConfig = { rules: [{ category: 'security', severity: 'low' }] };
    expect(shouldIgnore(makeFinding({ category: 'security', severity: 'low' }), cfg)).toBe(true);
    expect(shouldIgnore(makeFinding({ category: 'security', severity: 'high' }), cfg)).toBe(false);
    expect(shouldIgnore(makeFinding({ category: 'style', severity: 'low' }), cfg)).toBe(false);
  });

  it('多条规则中任一匹配即返回 true（OR 逻辑）', () => {
    const cfg: IgnoreConfig = {
      rules: [{ category: 'security' }, { severity: 'low' }],
    };
    expect(shouldIgnore(makeFinding({ category: 'security', severity: 'high' }), cfg)).toBe(true);
    expect(shouldIgnore(makeFinding({ category: 'style', severity: 'low' }), cfg)).toBe(true);
    expect(shouldIgnore(makeFinding({ category: 'style', severity: 'high' }), cfg)).toBe(false);
  });

  it('空规则列表返回 false', () => {
    expect(shouldIgnore(makeFinding(), { rules: [] })).toBe(false);
  });

  it('info severity 也支持匹配', () => {
    const cfg: IgnoreConfig = { rules: [{ severity: 'info' }] };
    expect(shouldIgnore(makeFinding({ severity: 'info' }), cfg)).toBe(true);
  });

  it('finding 缺失 ruleId 时 ruleId 规则不匹配', () => {
    const cfg: IgnoreConfig = { rules: [{ ruleId: 'sql-injection' }] };
    expect(shouldIgnore(makeFinding({ ruleId: undefined }), cfg)).toBe(false);
  });
});

// ==================== 类型导出校验 ====================

describe('反馈模块类型导出', () => {
  it('FeedbackAction 联合类型包含 accept/reject/modify', () => {
    const actions: FeedbackAction[] = ['accept', 'reject', 'modify'];
    expect(actions).toContain('accept');
    expect(actions).toContain('reject');
    expect(actions).toContain('modify');
  });

  it('FeedbackRecord 接口字段完整', () => {
    const rec: FeedbackRecord = {
      id: 'r-1',
      findingId: 'f-1',
      action: 'accept',
      timestamp: Date.now(),
      category: 'security',
      ruleId: 'r-a',
      file: 'a.ts',
      severity: 'high',
    };
    expect(rec.id).toBe('r-1');
    expect(rec.action).toBe('accept');
  });

  it('FalsePositivePattern 接口字段完整', () => {
    const p: FalsePositivePattern = { pattern: 'category:security', count: 5, suggestion: 's' };
    expect(p.count).toBe(5);
  });

  it('RuleSuggestion 接口字段完整', () => {
    const s: RuleSuggestion = { pattern: 'p', suggestion: 's', priority: 'high' };
    expect(s.priority).toBe('high');
  });

  it('IgnoreRule 接口字段可选', () => {
    const rule: IgnoreRule = {};
    expect(rule).toBeDefined();
  });
});
