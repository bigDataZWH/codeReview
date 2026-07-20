// tests/metrics.test.ts — 迭代 10：度量指标 + 趋势分析 + 规则自动调优
import { describe, it, expect, beforeEach } from 'vitest';
import { collectMetrics, generateDashboardData, type MetricsInput, type ReviewMetrics, type DashboardData } from '../src/metrics.js';
import { FeedbackStore, getRuleEffectiveness, autoTuneRules, type RuleEffectiveness, type RuleTuningSuggestion } from '../src/feedback.js';
import { StateStore, getMetricsSummary, type MetricsSummary } from '../src/state.js';
import type { Finding, Rule } from '../src/types.js';

// ── 辅助函数 ──

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

function makeRule(partial: Partial<Rule> = {}): Rule {
  return {
    id: 'sql-injection',
    name: 'SQL 注入检测',
    severity: 'critical',
    category: 'security',
    patterns: [{ type: 'regex', pattern: 'query.*\\+', message: 'SQL injection' }],
    ...partial,
  };
}

// ==================== collectMetrics 度量指标收集 ====================

describe('collectMetrics 度量指标收集', () => {
  it('空输入返回零值指标', () => {
    const metrics = collectMetrics({ sessions: [], findings: [], feedback: new FeedbackStore() });
    expect(metrics.coverage.prCoverage).toBe(0);
    expect(metrics.coverage.fileCoverage).toBe(0);
    expect(metrics.quality.avgFindingsPerFile).toBe(0);
    expect(metrics.cost.tokenConsumed).toBe(0);
  });

  it('PR 覆盖率 = 已审查会话数 / 总会话数', () => {
    const sessions = [
      { id: 's1', status: 'completed' as const, filesTotal: 10, filesProcessed: 10, createdAt: 1, updatedAt: 1 },
      { id: 's2', status: 'pending' as const, filesTotal: 5, filesProcessed: 0, createdAt: 2, updatedAt: 2 },
      { id: 's3', status: 'failed' as const, filesTotal: 3, filesProcessed: 1, createdAt: 3, updatedAt: 3 },
    ];
    const metrics = collectMetrics({ sessions, findings: [], feedback: new FeedbackStore() });
    // 已审查（completed）=1, 总=3 → 1/3
    expect(metrics.coverage.prCoverage).toBeCloseTo(1 / 3, 5);
  });

  it('文件覆盖率 = 已处理文件 / 总文件', () => {
    const sessions = [
      { id: 's1', status: 'completed' as const, filesTotal: 10, filesProcessed: 8, createdAt: 1, updatedAt: 1 },
      { id: 's2', status: 'completed' as const, filesTotal: 5, filesProcessed: 5, createdAt: 2, updatedAt: 2 },
    ];
    const metrics = collectMetrics({ sessions, findings: [], feedback: new FeedbackStore() });
    // (8+5)/(10+5) = 13/15
    expect(metrics.coverage.fileCoverage).toBeCloseTo(13 / 15, 5);
  });

  it('平均 finding 数 = 总 findings / 总文件数', () => {
    const sessions = [
      { id: 's1', status: 'completed' as const, filesTotal: 10, filesProcessed: 10, createdAt: 1, updatedAt: 1 },
    ];
    const findings: Finding[] = [
      makeFinding({ file: 'a.ts' }),
      makeFinding({ file: 'b.ts' }),
      makeFinding({ file: 'c.ts' }),
    ];
    const metrics = collectMetrics({ sessions, findings, feedback: new FeedbackStore() });
    expect(metrics.quality.avgFindingsPerFile).toBeCloseTo(3 / 10, 5);
  });

  it('严重度分布按 critical/high/medium/low/info 统计', () => {
    const findings: Finding[] = [
      makeFinding({ severity: 'critical' }),
      makeFinding({ severity: 'high' }),
      makeFinding({ severity: 'high' }),
      makeFinding({ severity: 'medium' }),
      makeFinding({ severity: 'info' }),
    ];
    const metrics = collectMetrics({ sessions: [], findings, feedback: new FeedbackStore() });
    expect(metrics.quality.severityDistribution.critical).toBe(1);
    expect(metrics.quality.severityDistribution.high).toBe(2);
    expect(metrics.quality.severityDistribution.medium).toBe(1);
    expect(metrics.quality.severityDistribution.low).toBe(0);
    expect(metrics.quality.severityDistribution.info).toBe(1);
  });

  it('接受率 = accept / (accept + reject + modify)', () => {
    const store = new FeedbackStore();
    for (let i = 0; i < 6; i++) store.recordFeedback(`a-${i}`, 'accept');
    for (let i = 0; i < 2; i++) store.recordFeedback(`r-${i}`, 'reject');
    for (let i = 0; i < 2; i++) store.recordFeedback(`m-${i}`, 'modify');
    const metrics = collectMetrics({ sessions: [], findings: [], feedback: store });
    // 6/(6+2+2) = 0.6
    expect(metrics.quality.acceptRate).toBeCloseTo(0.6, 5);
  });

  it('修复效率 = accept / total findings', () => {
    const store = new FeedbackStore();
    for (let i = 0; i < 5; i++) store.recordFeedback(`a-${i}`, 'accept');
    const findings: Finding[] = Array.from({ length: 10 }, (_, i) => makeFinding({ file: `f${i}.ts` }));
    const metrics = collectMetrics({ sessions: [], findings, feedback: store });
    // 5/10 = 0.5
    expect(metrics.efficiency.fixRate).toBeCloseTo(0.5, 5);
  });

  it('每千行成本 = 总 token / 总行数 * 1000', () => {
    const sessions = [
      { id: 's1', status: 'completed' as const, filesTotal: 1, filesProcessed: 1, createdAt: 1, updatedAt: 1, linesAnalyzed: 500 },
    ];
    const metrics = collectMetrics({
      sessions,
      findings: [],
      feedback: new FeedbackStore(),
      tokenConsumed: 1000,
    });
    // 1000 / 500 * 1000 = 2000
    expect(metrics.cost.tokensPerKLine).toBeCloseTo(2000, 5);
  });

  it('Token 消耗直接读取', () => {
    const metrics = collectMetrics({
      sessions: [],
      findings: [],
      feedback: new FeedbackStore(),
      tokenConsumed: 12345,
    });
    expect(metrics.cost.tokenConsumed).toBe(12345);
  });

  it('耗时（durationMs）来自会话耗时总和', () => {
    const now = Date.now();
    const sessions = [
      { id: 's1', status: 'completed' as const, filesTotal: 1, filesProcessed: 1, createdAt: now - 1000, updatedAt: now - 500, finishedAt: now - 500 },
      { id: 's2', status: 'completed' as const, filesTotal: 1, filesProcessed: 1, createdAt: now - 2000, updatedAt: now - 1000, finishedAt: now - 1000 },
    ];
    const metrics = collectMetrics({ sessions, findings: [], feedback: new FeedbackStore() });
    // s1: 500ms, s2: 1000ms → 总 1500ms
    expect(metrics.efficiency.totalDurationMs).toBeGreaterThanOrEqual(1000);
  });

  it('缺陷趋势：按时间窗口统计 finding 数量变化', () => {
    const now = Date.now();
    const sessions = [
      { id: 's1', status: 'completed' as const, filesTotal: 1, filesProcessed: 1, createdAt: now - 10 * 86400 * 1000, updatedAt: now - 10 * 86400 * 1000 },
      { id: 's2', status: 'completed' as const, filesTotal: 1, filesProcessed: 1, createdAt: now - 5 * 86400 * 1000, updatedAt: now - 5 * 86400 * 1000 },
      { id: 's3', status: 'completed' as const, filesTotal: 1, filesProcessed: 1, createdAt: now, updatedAt: now },
    ];
    const findings: Finding[] = [
      makeFinding({ file: 'a.ts' }),  // s1
      makeFinding({ file: 'b.ts' }),
      makeFinding({ file: 'c.ts' }),  // s2
      makeFinding({ file: 'd.ts' }),  // s3
    ];
    const metrics = collectMetrics({
      sessions,
      findings,
      feedback: new FeedbackStore(),
      findingsBySession: new Map([
        ['s1', [findings[0], findings[1]]],
        ['s2', [findings[2]]],
        ['s3', [findings[3]]],
      ]),
    });
    expect(metrics.trend.buckets.length).toBeGreaterThan(0);
    const totalFindings = metrics.trend.buckets.reduce((s, b) => s + b.findingCount, 0);
    expect(totalFindings).toBe(4);
  });

  it('趋势下降表示审查质量改善', () => {
    const now = Date.now();
    const sessions = [
      { id: 'old', status: 'completed' as const, filesTotal: 1, filesProcessed: 1, createdAt: now - 10 * 86400 * 1000, updatedAt: now - 10 * 86400 * 1000 },
      { id: 'new', status: 'completed' as const, filesTotal: 1, filesProcessed: 1, createdAt: now, updatedAt: now },
    ];
    const metrics = collectMetrics({
      sessions,
      findings: [],
      feedback: new FeedbackStore(),
      findingsBySession: new Map([
        ['old', Array.from({ length: 10 }, (_, i) => makeFinding({ file: `o${i}.ts` }))],
        ['new', Array.from({ length: 2 }, (_, i) => makeFinding({ file: `n${i}.ts` }))],
      ]),
    });
    expect(metrics.trend.direction).toBe('decreasing');
  });

  it('趋势上升表示审查质量恶化', () => {
    const now = Date.now();
    const sessions = [
      { id: 'old', status: 'completed' as const, filesTotal: 1, filesProcessed: 1, createdAt: now - 10 * 86400 * 1000, updatedAt: now - 10 * 86400 * 1000 },
      { id: 'new', status: 'completed' as const, filesTotal: 1, filesProcessed: 1, createdAt: now, updatedAt: now },
    ];
    const metrics = collectMetrics({
      sessions,
      findings: [],
      feedback: new FeedbackStore(),
      findingsBySession: new Map([
        ['old', Array.from({ length: 2 }, (_, i) => makeFinding({ file: `o${i}.ts` }))],
        ['new', Array.from({ length: 10 }, (_, i) => makeFinding({ file: `n${i}.ts` }))],
      ]),
    });
    expect(metrics.trend.direction).toBe('increasing');
  });

  it('趋势稳定：finding 数量无明显变化', () => {
    const now = Date.now();
    const sessions = [
      { id: 'old', status: 'completed' as const, filesTotal: 1, filesProcessed: 1, createdAt: now - 10 * 86400 * 1000, updatedAt: now - 10 * 86400 * 1000 },
      { id: 'new', status: 'completed' as const, filesTotal: 1, filesProcessed: 1, createdAt: now, updatedAt: now },
    ];
    const metrics = collectMetrics({
      sessions,
      findings: [],
      feedback: new FeedbackStore(),
      findingsBySession: new Map([
        ['old', [makeFinding({ file: 'a.ts' })]],
        ['new', [makeFinding({ file: 'b.ts' })]],
      ]),
    });
    expect(metrics.trend.direction).toBe('stable');
  });
});

// ==================== generateDashboardData 仪表盘数据 ====================

describe('generateDashboardData 仪表盘数据', () => {
  it('生成仪表盘数据包含关键 KPI', () => {
    const sessions = [
      { id: 's1', status: 'completed' as const, filesTotal: 10, filesProcessed: 10, createdAt: 1, updatedAt: 1 },
    ];
    const store = new FeedbackStore();
    store.recordFeedback('f1', 'accept');
    const dashboard = generateDashboardData({
      sessions,
      findings: [makeFinding()],
      feedback: store,
    });
    expect(dashboard.kpi).toBeDefined();
    expect(dashboard.kpi.prCoverage).toBeTypeOf('number');
    expect(dashboard.kpi.fileCoverage).toBeTypeOf('number');
    expect(dashboard.kpi.acceptRate).toBeTypeOf('number');
    expect(dashboard.kpi.totalFindings).toBe(1);
  });

  it('仪表盘包含严重度分布饼图数据', () => {
    const findings: Finding[] = [
      makeFinding({ severity: 'critical' }),
      makeFinding({ severity: 'high' }),
      makeFinding({ severity: 'low' }),
    ];
    const dashboard = generateDashboardData({
      sessions: [],
      findings,
      feedback: new FeedbackStore(),
    });
    expect(dashboard.charts.severityPie).toBeDefined();
    expect(dashboard.charts.severityPie.critical).toBe(1);
    expect(dashboard.charts.severityPie.high).toBe(1);
    expect(dashboard.charts.severityPie.low).toBe(1);
  });

  it('仪表盘包含趋势折线图数据', () => {
    const now = Date.now();
    const sessions = [
      { id: 's1', status: 'completed' as const, filesTotal: 1, filesProcessed: 1, createdAt: now - 86400 * 1000, updatedAt: now - 86400 * 1000 },
      { id: 's2', status: 'completed' as const, filesTotal: 1, filesProcessed: 1, createdAt: now, updatedAt: now },
    ];
    const dashboard = generateDashboardData({
      sessions,
      findings: [],
      feedback: new FeedbackStore(),
      findingsBySession: new Map([
        ['s1', [makeFinding({ file: 'a.ts' })]],
        ['s2', [makeFinding({ file: 'b.ts' }), makeFinding({ file: 'c.ts' })]],
      ]),
    });
    expect(dashboard.charts.trendLine).toBeDefined();
    expect(dashboard.charts.trendLine.length).toBeGreaterThan(0);
  });

  it('仪表盘包含类别分布柱状图数据', () => {
    const findings: Finding[] = [
      makeFinding({ category: 'security' }),
      makeFinding({ category: 'security' }),
      makeFinding({ category: 'style' }),
      makeFinding({ category: 'performance' }),
    ];
    const dashboard = generateDashboardData({
      sessions: [],
      findings,
      feedback: new FeedbackStore(),
    });
    expect(dashboard.charts.categoryBar).toBeDefined();
    expect(dashboard.charts.categoryBar.security).toBe(2);
    expect(dashboard.charts.categoryBar.style).toBe(1);
    expect(dashboard.charts.categoryBar.performance).toBe(1);
  });

  it('仪表盘包含规则有效性排行', () => {
    const store = new FeedbackStore();
    // rule-a: 5 accept, 1 reject
    for (let i = 0; i < 5; i++) store.recordFeedback(`a-${i}`, 'accept', undefined, makeFinding({ ruleId: 'rule-a' }));
    store.recordFeedback('r-0', 'reject', undefined, makeFinding({ ruleId: 'rule-a' }));
    // rule-b: 1 accept, 5 reject
    store.recordFeedback('a2-0', 'accept', undefined, makeFinding({ ruleId: 'rule-b' }));
    for (let i = 0; i < 5; i++) store.recordFeedback(`r2-${i}`, 'reject', undefined, makeFinding({ ruleId: 'rule-b' }));

    const dashboard = generateDashboardData({
      sessions: [],
      findings: [],
      feedback: store,
    });
    expect(dashboard.charts.ruleEffectiveness).toBeDefined();
    expect(dashboard.charts.ruleEffectiveness.length).toBe(2);
    // 按 acceptRate 降序，rule-a 应在前
    expect(dashboard.charts.ruleEffectiveness[0].ruleId).toBe('rule-a');
  });
});

// ==================== Task 15: 统一规则有效性计算 ====================

describe('Task 15: 仪表盘 ruleEffectiveness 复用 feedback.getRuleEffectiveness', () => {
  it('仪表盘 ruleEffectiveness 与 feedback.getRuleEffectiveness 完全一致', () => {
    const store = new FeedbackStore();
    // rule-a: 5 accept, 1 reject → acceptRate ≈ 0.833 (good)
    for (let i = 0; i < 5; i++) store.recordFeedback(`a-${i}`, 'accept', undefined, makeFinding({ ruleId: 'rule-a' }));
    store.recordFeedback('r-0', 'reject', undefined, makeFinding({ ruleId: 'rule-a' }));
    // rule-b: 1 accept, 3 reject, 2 modify → acceptRate = 0.167 (poor)
    store.recordFeedback('a2-0', 'accept', undefined, makeFinding({ ruleId: 'rule-b' }));
    for (let i = 0; i < 3; i++) store.recordFeedback(`r2-${i}`, 'reject', undefined, makeFinding({ ruleId: 'rule-b' }));
    for (let i = 0; i < 2; i++) store.recordFeedback(`m2-${i}`, 'modify', undefined, makeFinding({ ruleId: 'rule-b' }));

    const dashboard = generateDashboardData({
      sessions: [],
      findings: [],
      feedback: store,
    });
    const direct = getRuleEffectiveness(store);

    // metrics 应直接复用 feedback.getRuleEffectiveness，故输出完全一致
    expect(dashboard.charts.ruleEffectiveness).toEqual(direct);
  });

  it('仪表盘 ruleEffectiveness 包含完整 RuleEffectiveness 字段（acceptCount/rejectCount/modifyCount）', () => {
    const store = new FeedbackStore();
    for (let i = 0; i < 5; i++) store.recordFeedback(`a-${i}`, 'accept', undefined, makeFinding({ ruleId: 'rule-a' }));
    for (let i = 0; i < 3; i++) store.recordFeedback(`r-${i}`, 'reject', undefined, makeFinding({ ruleId: 'rule-a' }));
    for (let i = 0; i < 2; i++) store.recordFeedback(`m-${i}`, 'modify', undefined, makeFinding({ ruleId: 'rule-a' }));

    const dashboard = generateDashboardData({
      sessions: [],
      findings: [],
      feedback: store,
    });

    const entry = dashboard.charts.ruleEffectiveness[0];
    expect(entry).toBeDefined();
    expect(entry.ruleId).toBe('rule-a');
    expect(entry.acceptCount).toBe(5);
    expect(entry.rejectCount).toBe(3);
    expect(entry.modifyCount).toBe(2);
    expect(entry.totalFeedback).toBe(10);
    expect(entry.acceptRate).toBeCloseTo(0.5, 5);
    expect(entry.rejectRate).toBeCloseTo(0.3, 5);
    expect(entry.grade).toBe('medium');
  });

  it('仪表盘 ruleEffectiveness 等级阈值与 feedback.getRuleEffectiveness 一致', () => {
    const cases = [
      { accept: 7, reject: 3, modify: 0, expectedGrade: 'good' as const },    // 0.7
      { accept: 4, reject: 6, modify: 0, expectedGrade: 'medium' as const },  // 0.4
      { accept: 1, reject: 9, modify: 0, expectedGrade: 'poor' as const },    // 0.1
    ];

    for (const c of cases) {
      const store = new FeedbackStore();
      for (let i = 0; i < c.accept; i++) store.recordFeedback(`a-${i}`, 'accept', undefined, makeFinding({ ruleId: 'r1' }));
      for (let i = 0; i < c.reject; i++) store.recordFeedback(`r-${i}`, 'reject', undefined, makeFinding({ ruleId: 'r1' }));
      for (let i = 0; i < c.modify; i++) store.recordFeedback(`m-${i}`, 'modify', undefined, makeFinding({ ruleId: 'r1' }));

      const dashboard = generateDashboardData({
        sessions: [],
        findings: [],
        feedback: store,
      });
      const direct = getRuleEffectiveness(store);

      // 仪表盘输出与直接调用 feedback.getRuleEffectiveness 应有相同等级
      expect(dashboard.charts.ruleEffectiveness[0].grade).toBe(c.expectedGrade);
      expect(dashboard.charts.ruleEffectiveness[0].grade).toBe(direct[0].grade);
    }
  });

  it('空反馈时仪表盘 ruleEffectiveness 返回空数组（与 feedback.getRuleEffectiveness 一致）', () => {
    const store = new FeedbackStore();
    const dashboard = generateDashboardData({
      sessions: [],
      findings: [],
      feedback: store,
    });
    expect(dashboard.charts.ruleEffectiveness).toEqual([]);
    expect(dashboard.charts.ruleEffectiveness).toEqual(getRuleEffectiveness(store));
  });

  it('无 ruleId 的反馈不计入仪表盘 ruleEffectiveness（与 feedback.getRuleEffectiveness 一致）', () => {
    const store = new FeedbackStore();
    for (let i = 0; i < 10; i++) store.recordFeedback(`a-${i}`, 'accept', undefined, makeFinding({ ruleId: undefined }));

    const dashboard = generateDashboardData({
      sessions: [],
      findings: [],
      feedback: store,
    });
    expect(dashboard.charts.ruleEffectiveness).toEqual([]);
    expect(dashboard.charts.ruleEffectiveness).toEqual(getRuleEffectiveness(store));
  });

  it('多规则按 acceptRate 降序排序（与 feedback.getRuleEffectiveness 一致）', () => {
    const store = new FeedbackStore();
    // good-rule: 9 accept, 1 reject → 0.9 (good)
    for (let i = 0; i < 9; i++) store.recordFeedback(`g-${i}`, 'accept', undefined, makeFinding({ ruleId: 'good-rule' }));
    store.recordFeedback('g-r', 'reject', undefined, makeFinding({ ruleId: 'good-rule' }));
    // mid-rule: 5 accept, 5 reject → 0.5 (medium)
    for (let i = 0; i < 5; i++) store.recordFeedback(`m-${i}`, 'accept', undefined, makeFinding({ ruleId: 'mid-rule' }));
    for (let i = 0; i < 5; i++) store.recordFeedback(`m-r-${i}`, 'reject', undefined, makeFinding({ ruleId: 'mid-rule' }));
    // bad-rule: 1 accept, 9 reject → 0.1 (poor)
    store.recordFeedback('b-a', 'accept', undefined, makeFinding({ ruleId: 'bad-rule' }));
    for (let i = 0; i < 9; i++) store.recordFeedback(`b-r-${i}`, 'reject', undefined, makeFinding({ ruleId: 'bad-rule' }));

    const dashboard = generateDashboardData({
      sessions: [],
      findings: [],
      feedback: store,
    });
    const direct = getRuleEffectiveness(store);

    expect(dashboard.charts.ruleEffectiveness.map((e) => e.ruleId)).toEqual(['good-rule', 'mid-rule', 'bad-rule']);
    expect(dashboard.charts.ruleEffectiveness).toEqual(direct);
  });
});

// ==================== getRuleEffectiveness 规则有效性评估 ====================

describe('getRuleEffectiveness 规则有效性评估', () => {
  let store: FeedbackStore;
  beforeEach(() => {
    store = new FeedbackStore();
  });

  it('空反馈返回空数组', () => {
    expect(getRuleEffectiveness(store)).toEqual([]);
  });

  it('计算单条规则的有效性：acceptRate、rejectRate', () => {
    for (let i = 0; i < 8; i++) store.recordFeedback(`a-${i}`, 'accept', undefined, makeFinding({ ruleId: 'r1' }));
    for (let i = 0; i < 2; i++) store.recordFeedback(`r-${i}`, 'reject', undefined, makeFinding({ ruleId: 'r1' }));
    const eff = getRuleEffectiveness(store);
    expect(eff).toHaveLength(1);
    expect(eff[0].ruleId).toBe('r1');
    expect(eff[0].totalFeedback).toBe(10);
    expect(eff[0].acceptCount).toBe(8);
    expect(eff[0].rejectCount).toBe(2);
    expect(eff[0].acceptRate).toBeCloseTo(0.8, 5);
    expect(eff[0].rejectRate).toBeCloseTo(0.2, 5);
  });

  it('多规则按 acceptRate 降序排序', () => {
    for (let i = 0; i < 9; i++) store.recordFeedback(`a-${i}`, 'accept', undefined, makeFinding({ ruleId: 'good' }));
    store.recordFeedback('a-x', 'reject', undefined, makeFinding({ ruleId: 'good' }));
    for (let i = 0; i < 2; i++) store.recordFeedback(`b-${i}`, 'accept', undefined, makeFinding({ ruleId: 'bad' }));
    for (let i = 0; i < 8; i++) store.recordFeedback(`b-r-${i}`, 'reject', undefined, makeFinding({ ruleId: 'bad' }));
    const eff = getRuleEffectiveness(store);
    expect(eff[0].ruleId).toBe('good');
    expect(eff[1].ruleId).toBe('bad');
  });

  it('effectiveness 等级：acceptRate >= 0.7 为 good', () => {
    for (let i = 0; i < 7; i++) store.recordFeedback(`a-${i}`, 'accept', undefined, makeFinding({ ruleId: 'r1' }));
    for (let i = 0; i < 3; i++) store.recordFeedback(`r-${i}`, 'reject', undefined, makeFinding({ ruleId: 'r1' }));
    const eff = getRuleEffectiveness(store);
    expect(eff[0].grade).toBe('good');
  });

  it('effectiveness 等级：0.3 <= acceptRate < 0.7 为 medium', () => {
    for (let i = 0; i < 4; i++) store.recordFeedback(`a-${i}`, 'accept', undefined, makeFinding({ ruleId: 'r1' }));
    for (let i = 0; i < 6; i++) store.recordFeedback(`r-${i}`, 'reject', undefined, makeFinding({ ruleId: 'r1' }));
    const eff = getRuleEffectiveness(store);
    expect(eff[0].grade).toBe('medium');
  });

  it('effectiveness 等级：acceptRate < 0.3 为 poor', () => {
    for (let i = 0; i < 1; i++) store.recordFeedback(`a-${i}`, 'accept', undefined, makeFinding({ ruleId: 'r1' }));
    for (let i = 0; i < 9; i++) store.recordFeedback(`r-${i}`, 'reject', undefined, makeFinding({ ruleId: 'r1' }));
    const eff = getRuleEffectiveness(store);
    expect(eff[0].grade).toBe('poor');
  });

  it('无 ruleId 的反馈不计入规则有效性', () => {
    for (let i = 0; i < 10; i++) store.recordFeedback(`a-${i}`, 'accept', undefined, makeFinding({ ruleId: undefined }));
    const eff = getRuleEffectiveness(store);
    expect(eff).toEqual([]);
  });
});

// ==================== autoTuneRules 规则自动调优建议 ====================

describe('autoTuneRules 规则自动调优建议', () => {
  let store: FeedbackStore;
  beforeEach(() => {
    store = new FeedbackStore();
  });

  it('空反馈返回空数组', () => {
    const rules = [makeRule()];
    expect(autoTuneRules(store, rules)).toEqual([]);
  });

  it('对 poor 等级规则建议禁用或降级', () => {
    for (let i = 0; i < 1; i++) store.recordFeedback(`a-${i}`, 'accept', undefined, makeFinding({ ruleId: 'sql-injection' }));
    for (let i = 0; i < 9; i++) store.recordFeedback(`r-${i}`, 'reject', undefined, makeFinding({ ruleId: 'sql-injection' }));
    const rules = [makeRule({ id: 'sql-injection', severity: 'critical' })];
    const suggestions = autoTuneRules(store, rules);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].ruleId).toBe('sql-injection');
    expect(suggestions[0].action).toMatch(/disable|downgrade|review/i);
  });

  it('对 good 等级规则不生成建议', () => {
    for (let i = 0; i < 9; i++) store.recordFeedback(`a-${i}`, 'accept', undefined, makeFinding({ ruleId: 'sql-injection' }));
    for (let i = 0; i < 1; i++) store.recordFeedback(`r-${i}`, 'reject', undefined, makeFinding({ ruleId: 'sql-injection' }));
    const rules = [makeRule({ id: 'sql-injection' })];
    const suggestions = autoTuneRules(store, rules);
    expect(suggestions).toEqual([]);
  });

  it('对 medium 等级规则建议调整阈值', () => {
    for (let i = 0; i < 4; i++) store.recordFeedback(`a-${i}`, 'accept', undefined, makeFinding({ ruleId: 'sql-injection' }));
    for (let i = 0; i < 6; i++) store.recordFeedback(`r-${i}`, 'reject', undefined, makeFinding({ ruleId: 'sql-injection' }));
    const rules = [makeRule({ id: 'sql-injection' })];
    const suggestions = autoTuneRules(store, rules);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].action).toMatch(/tune|adjust|threshold/i);
  });

  it('建议包含原始 severity 与建议 severity', () => {
    for (let i = 0; i < 1; i++) store.recordFeedback(`a-${i}`, 'accept', undefined, makeFinding({ ruleId: 'sql-injection' }));
    for (let i = 0; i < 9; i++) store.recordFeedback(`r-${i}`, 'reject', undefined, makeFinding({ ruleId: 'sql-injection' }));
    const rules = [makeRule({ id: 'sql-injection', severity: 'critical' })];
    const suggestions = autoTuneRules(store, rules);
    expect(suggestions[0].currentSeverity).toBe('critical');
    expect(suggestions[0].suggestedSeverity).toBeDefined();
  });

  it('建议中包含原因说明', () => {
    for (let i = 0; i < 1; i++) store.recordFeedback(`a-${i}`, 'accept', undefined, makeFinding({ ruleId: 'sql-injection' }));
    for (let i = 0; i < 9; i++) store.recordFeedback(`r-${i}`, 'reject', undefined, makeFinding({ ruleId: 'sql-injection' }));
    const rules = [makeRule({ id: 'sql-injection' })];
    const suggestions = autoTuneRules(store, rules);
    expect(suggestions[0].reason).toBeTypeOf('string');
    expect(suggestions[0].reason!.length).toBeGreaterThan(0);
  });

  it('对反馈中没有对应规则的建议中标注 unknown rule', () => {
    for (let i = 0; i < 1; i++) store.recordFeedback(`a-${i}`, 'accept', undefined, makeFinding({ ruleId: 'orphan-rule' }));
    for (let i = 0; i < 9; i++) store.recordFeedback(`r-${i}`, 'reject', undefined, makeFinding({ ruleId: 'orphan-rule' }));
    const rules: Rule[] = [];  // 不包含 orphan-rule
    const suggestions = autoTuneRules(store, rules);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].ruleId).toBe('orphan-rule');
    expect(suggestions[0].currentSeverity).toBeUndefined();
  });
});

// ==================== getMetricsSummary 状态层度量摘要 ====================

describe('getMetricsSummary 状态层度量摘要', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
  });

  it('空存储返回零值摘要', () => {
    const summary = store.getMetricsSummary();
    expect(summary.totalSessions).toBe(0);
    expect(summary.totalFindings).toBe(0);
    expect(summary.avgFindingsPerSession).toBe(0);
    expect(summary.bySeverity.critical).toBe(0);
  });

  it('汇总所有会话与 findings', () => {
    store.createSession({ id: 's1', filesTotal: 5 });
    store.updateSessionStatus('s1', 'running');
    store.updateSessionStatus('s1', 'completed');
    store.saveFindings('s1', [
      makeFinding({ severity: 'critical' }),
      makeFinding({ severity: 'high' }),
      makeFinding({ severity: 'low' }),
    ]);

    store.createSession({ id: 's2', filesTotal: 3 });
    store.updateSessionStatus('s2', 'running');
    store.updateSessionStatus('s2', 'completed');
    store.saveFindings('s2', [
      makeFinding({ severity: 'medium' }),
    ]);

    const summary = store.getMetricsSummary();
    expect(summary.totalSessions).toBe(2);
    expect(summary.totalFindings).toBe(4);
    expect(summary.completedSessions).toBe(2);
    expect(summary.avgFindingsPerSession).toBeCloseTo(2, 5);
    expect(summary.bySeverity.critical).toBe(1);
    expect(summary.bySeverity.high).toBe(1);
    expect(summary.bySeverity.medium).toBe(1);
    expect(summary.bySeverity.low).toBe(1);
  });

  it('支持 since 时间过滤', () => {
    const old = Date.now() - 10000;
    store.createSession({ id: 'old', filesTotal: 1, createdAt: old });
    store.updateSessionStatus('old', 'running');
    store.updateSessionStatus('old', 'completed');
    store.saveFindings('old', [makeFinding()]);

    const recent = Date.now() - 1000;
    store.createSession({ id: 'new', filesTotal: 1, createdAt: recent });
    store.updateSessionStatus('new', 'running');
    store.updateSessionStatus('new', 'completed');
    store.saveFindings('new', [makeFinding(), makeFinding()]);

    const summary = store.getMetricsSummary({ since: Date.now() - 5000 });
    expect(summary.totalSessions).toBe(1);
    expect(summary.totalFindings).toBe(2);
  });

  it('byCategory 按类别聚合', () => {
    store.createSession({ id: 's1', filesTotal: 1 });
    store.updateSessionStatus('s1', 'running');
    store.updateSessionStatus('s1', 'completed');
    store.saveFindings('s1', [
      makeFinding({ category: 'security' }),
      makeFinding({ category: 'security' }),
      makeFinding({ category: 'style' }),
    ]);
    const summary = store.getMetricsSummary();
    expect(summary.byCategory.security).toBe(2);
    expect(summary.byCategory.style).toBe(1);
  });

  it('模块级 getMetricsSummary 函数使用默认实例', () => {
    // 默认实例查询，至少不抛错
    const summary = getMetricsSummary();
    expect(summary).toBeDefined();
    expect(summary.totalSessions).toBeTypeOf('number');
  });
});
