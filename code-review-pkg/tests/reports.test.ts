// tests/reports.test.ts
// Task 19.1：reports.ts 纯函数单元测试
// 覆盖 computeOverview / computeTrend / computeByRule / computeByAuthor / computeByRepo

import { describe, it, expect } from 'vitest';
import {
  computeOverview,
  computeTrend,
  computeByRule,
  computeByAuthor,
  computeByRepo,
} from '../src/reports.js';
import type { FindingHistoryRecord } from '../src/findings-history-store.js';
import type { Finding } from '../src/types.js';

// ==================== 辅助构造函数 ====================

/** 构造一条 Finding（含可选 ruleId/ruleName） */
function makeFinding(overrides: Partial<Finding> & { file?: string; line?: number } = {}): Finding {
  return {
    file: overrides.file ?? 'src/app.ts',
    line: overrides.line ?? 1,
    severity: overrides.severity ?? 'medium',
    category: overrides.category ?? 'quality',
    message: overrides.message ?? '示例问题',
    confidence: overrides.confidence ?? 0.9,
    source: overrides.source ?? 'rule',
    ruleId: overrides.ruleId,
    ...(overrides as any),
  };
}

/** 构造一条 FindingHistoryRecord */
function makeRecord(overrides: Partial<FindingHistoryRecord> = {}): FindingHistoryRecord {
  return {
    historyId: overrides.historyId ?? 'fh-test-1',
    mrIid: overrides.mrIid ?? 1,
    repoId: overrides.repoId ?? 'repo-1',
    author: overrides.author ?? 'zhangsan',
    finding: overrides.finding ?? makeFinding(),
    reviewedAt: overrides.reviewedAt ?? '2026-08-01T10:00:00.000Z',
    submitted: overrides.submitted ?? false,
    resolved: overrides.resolved ?? false,
    blockedMerge: overrides.blockedMerge ?? false,
    ...overrides,
  };
}

/** 获取今日 UTC 日期的 ISO 时间戳（用于 computeTrend 测试） */
function todayISO(hour = 10): string {
  const d = new Date();
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

/** 获取 N 天前的 UTC ISO 时间戳 */
function daysAgoISO(days: number, hour = 10): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

// ==================== computeOverview ====================

describe('computeOverview', () => {
  it('空数组返回全 0 指标', () => {
    const ov = computeOverview([]);
    expect(ov.totalFindings).toBe(0);
    expect(ov.reviewCount).toBe(0);
    expect(ov.interceptionCount).toBe(0);
    expect(ov.acceptanceRate).toBe(0);
    expect(ov.acceptanceNumerator).toBe(0);
    expect(ov.acceptanceDenominator).toBe(0);
    expect(ov.avgFindingsPerMR).toBe(0);
  });

  it('正确计算 totalFindings 与 reviewCount', () => {
    const records = [
      makeRecord({ mrIid: 1, repoId: 'r1' }),
      makeRecord({ mrIid: 1, repoId: 'r1' }),
      makeRecord({ mrIid: 2, repoId: 'r1' }),
      makeRecord({ mrIid: 1, repoId: 'r2' }),
    ];
    const ov = computeOverview(records);
    expect(ov.totalFindings).toBe(4);
    // 不同 mrIid+repoId 组合：1@r1, 2@r1, 1@r2 → 3
    expect(ov.reviewCount).toBe(3);
  });

  it('正确计算 acceptanceRate：submitted&&resolved / submitted', () => {
    const records = [
      // submitted=true, resolved=true → 分子+1, 分母+1
      makeRecord({ submitted: true, resolved: true }),
      // submitted=true, resolved=false → 分母+1
      makeRecord({ submitted: true, resolved: false }),
      // submitted=false → 不计入分母
      makeRecord({ submitted: false, resolved: true }),
    ];
    const ov = computeOverview(records);
    expect(ov.acceptanceNumerator).toBe(1);
    expect(ov.acceptanceDenominator).toBe(2);
    expect(ov.acceptanceRate).toBeCloseTo(50, 5);
  });

  it('分母为 0 时 acceptanceRate 返回 0', () => {
    const records = [
      makeRecord({ submitted: false, resolved: true }),
      makeRecord({ submitted: false, resolved: false }),
    ];
    const ov = computeOverview(records);
    expect(ov.acceptanceDenominator).toBe(0);
    expect(ov.acceptanceRate).toBe(0);
  });

  it('正确计算 interceptionCount：blockedMerge 的不同 MR 数', () => {
    const records = [
      makeRecord({ mrIid: 1, repoId: 'r1', blockedMerge: true }),
      makeRecord({ mrIid: 1, repoId: 'r1', blockedMerge: true }), // 同一 MR，不重复计
      makeRecord({ mrIid: 2, repoId: 'r1', blockedMerge: true }),
      makeRecord({ mrIid: 3, repoId: 'r1', blockedMerge: false }),
    ];
    const ov = computeOverview(records);
    // blockedMerge 的不同 MR：1@r1, 2@r1 → 2
    expect(ov.interceptionCount).toBe(2);
  });

  it('正确计算 avgFindingsPerMR', () => {
    const records = [
      makeRecord({ mrIid: 1, repoId: 'r1' }),
      makeRecord({ mrIid: 1, repoId: 'r1' }),
      makeRecord({ mrIid: 2, repoId: 'r1' }),
    ];
    const ov = computeOverview(records);
    // 3 findings / 2 MR = 1.5
    expect(ov.avgFindingsPerMR).toBeCloseTo(1.5, 5);
  });

  it('reviewCount 为 0 时 avgFindingsPerMR 返回 0', () => {
    const ov = computeOverview([]);
    expect(ov.avgFindingsPerMR).toBe(0);
  });

  it('全部 submitted&&resolved 时 acceptanceRate 为 100', () => {
    const records = [
      makeRecord({ submitted: true, resolved: true }),
      makeRecord({ submitted: true, resolved: true }),
    ];
    const ov = computeOverview(records);
    expect(ov.acceptanceRate).toBe(100);
    expect(ov.acceptanceNumerator).toBe(2);
    expect(ov.acceptanceDenominator).toBe(2);
  });
});

// ==================== computeTrend ====================

describe('computeTrend', () => {
  it('返回 rangeDays 个数据点', () => {
    const trend = computeTrend([], 7);
    expect(trend).toHaveLength(7);
    // 每个点都有 date/reviews/findings/acceptedFindings/interceptions 字段
    expect(trend[0]).toHaveProperty('date');
    expect(trend[0]).toHaveProperty('reviews');
    expect(trend[0]).toHaveProperty('findings');
    expect(trend[0]).toHaveProperty('acceptedFindings');
    expect(trend[0]).toHaveProperty('interceptions');
  });

  it('空记录时所有数据点 reviews/findings 均为 0', () => {
    const trend = computeTrend([], 3);
    for (const point of trend) {
      expect(point.reviews).toBe(0);
      expect(point.findings).toBe(0);
      expect(point.acceptedFindings).toBe(0);
      expect(point.interceptions).toBe(0);
    }
  });

  it('按日期分组统计 reviews/findings', () => {
    const today = todayISO();
    const records = [
      makeRecord({ mrIid: 1, repoId: 'r1', reviewedAt: today }),
      makeRecord({ mrIid: 1, repoId: 'r1', reviewedAt: today }),
      makeRecord({ mrIid: 2, repoId: 'r1', reviewedAt: today }),
    ];
    const trend = computeTrend(records, 7);
    // 最后一项是今天
    const todayPoint = trend[trend.length - 1];
    expect(todayPoint.reviews).toBe(2); // 1@r1, 2@r1
    expect(todayPoint.findings).toBe(3);
  });

  it('按日期分组统计 acceptedFindings（resolved=true）', () => {
    const today = todayISO();
    const records = [
      makeRecord({ reviewedAt: today, resolved: true }),
      makeRecord({ reviewedAt: today, resolved: false }),
      makeRecord({ reviewedAt: today, resolved: true }),
    ];
    const trend = computeTrend(records, 7);
    const todayPoint = trend[trend.length - 1];
    expect(todayPoint.acceptedFindings).toBe(2);
  });

  it('按日期分组统计 interceptions（blockedMerge 的不同 MR）', () => {
    const today = todayISO();
    const records = [
      makeRecord({ mrIid: 1, repoId: 'r1', reviewedAt: today, blockedMerge: true }),
      makeRecord({ mrIid: 1, repoId: 'r1', reviewedAt: today, blockedMerge: true }),
      makeRecord({ mrIid: 2, repoId: 'r1', reviewedAt: today, blockedMerge: true }),
    ];
    const trend = computeTrend(records, 7);
    const todayPoint = trend[trend.length - 1];
    expect(todayPoint.interceptions).toBe(2);
  });

  it('跨多日记录正确分组', () => {
    const today = todayISO();
    const yesterday = daysAgoISO(1);
    const records = [
      makeRecord({ mrIid: 1, reviewedAt: today }),
      makeRecord({ mrIid: 2, reviewedAt: yesterday }),
    ];
    const trend = computeTrend(records, 7);
    expect(trend).toHaveLength(7);
    const todayPoint = trend[trend.length - 1];
    const yesterdayPoint = trend[trend.length - 2];
    expect(todayPoint.findings).toBe(1);
    expect(yesterdayPoint.findings).toBe(1);
  });

  it('rangeDays 非正整数时回退为 30', () => {
    const trend = computeTrend([], 0);
    expect(trend).toHaveLength(30);
    const trendNeg = computeTrend([], -5);
    expect(trendNeg).toHaveLength(30);
    const trendNaN = computeTrend([], NaN);
    expect(trendNaN).toHaveLength(30);
  });

  it('默认 rangeDays 为 30', () => {
    const trend = computeTrend([]);
    expect(trend).toHaveLength(30);
  });

  it('日期范围外的记录不计入趋势', () => {
    // 100 天前的记录，rangeDays=7 → 不在范围内
    const oldDate = daysAgoISO(100);
    const records = [makeRecord({ reviewedAt: oldDate })];
    const trend = computeTrend(records, 7);
    // 所有数据点 findings 均为 0（旧记录不在 7 天范围内）
    for (const point of trend) {
      expect(point.findings).toBe(0);
    }
  });

  it('趋势日期按从早到晚顺序排列', () => {
    const trend = computeTrend([], 5);
    expect(trend).toHaveLength(5);
    for (let i = 1; i < trend.length; i++) {
      expect(trend[i].date >= trend[i - 1].date).toBe(true);
    }
  });
});

// ==================== computeByRule ====================

describe('computeByRule', () => {
  it('空数组返回空数组', () => {
    expect(computeByRule([])).toEqual([]);
  });

  it('按 ruleId 聚合 hitCount', () => {
    const records = [
      makeRecord({ finding: makeFinding({ ruleId: 'R001' }) }),
      makeRecord({ finding: makeFinding({ ruleId: 'R001' }) }),
      makeRecord({ finding: makeFinding({ ruleId: 'R002' }) }),
    ];
    const items = computeByRule(records);
    expect(items).toHaveLength(2);
    const r001 = items.find((i) => i.ruleId === 'R001');
    const r002 = items.find((i) => i.ruleId === 'R002');
    expect(r001?.hitCount).toBe(2);
    expect(r002?.hitCount).toBe(1);
  });

  it('按 hitCount 降序排序', () => {
    const records = [
      makeRecord({ finding: makeFinding({ ruleId: 'R002' }) }),
      makeRecord({ finding: makeFinding({ ruleId: 'R001' }) }),
      makeRecord({ finding: makeFinding({ ruleId: 'R001' }) }),
      makeRecord({ finding: makeFinding({ ruleId: 'R001' }) }),
    ];
    const items = computeByRule(records);
    // R001 hitCount=3, R002 hitCount=1 → R001 在前
    expect(items[0].ruleId).toBe('R001');
    expect(items[0].hitCount).toBe(3);
    expect(items[1].ruleId).toBe('R002');
    expect(items[1].hitCount).toBe(1);
    expect(items[0].hitCount).toBeGreaterThanOrEqual(items[1].hitCount);
  });

  it('ruleId 缺失归为 unknown', () => {
    const records = [
      makeRecord({ finding: makeFinding({ ruleId: undefined }) }),
      makeRecord({ finding: makeFinding({ ruleId: undefined }) }),
    ];
    const items = computeByRule(records);
    expect(items).toHaveLength(1);
    expect(items[0].ruleId).toBe('unknown');
    expect(items[0].hitCount).toBe(2);
  });

  it('正确计算 acceptanceCount 与 acceptanceRate', () => {
    const records = [
      // submitted=true, resolved=true → acceptanceCount+1
      makeRecord({ finding: makeFinding({ ruleId: 'R001' }), submitted: true, resolved: true }),
      // submitted=true, resolved=false → 不计入 acceptanceCount
      makeRecord({ finding: makeFinding({ ruleId: 'R001' }), submitted: true, resolved: false }),
      // submitted=false → 不计入分母
      makeRecord({ finding: makeFinding({ ruleId: 'R001' }), submitted: false, resolved: true }),
    ];
    const items = computeByRule(records);
    const r001 = items.find((i) => i.ruleId === 'R001');
    expect(r001?.acceptanceCount).toBe(1);
    // 分母=2（submitted=true 的有 2 条），分子=1 → 50%
    expect(r001?.acceptanceRate).toBeCloseTo(50, 5);
  });

  it('ruleName 从 finding.ruleName 读取，缺失时回退为 ruleId', () => {
    const records = [
      makeRecord({ finding: makeFinding({ ruleId: 'R001', ruleName: '禁止 eval' } as any) }),
      makeRecord({ finding: makeFinding({ ruleId: 'R002' }) }),
    ];
    const items = computeByRule(records);
    const r001 = items.find((i) => i.ruleId === 'R001');
    const r002 = items.find((i) => i.ruleId === 'R002');
    expect(r001?.ruleName).toBe('禁止 eval');
    expect(r002?.ruleName).toBe('R002');
  });
});

// ==================== computeByAuthor ====================

describe('computeByAuthor', () => {
  it('空数组返回空数组', () => {
    expect(computeByAuthor([])).toEqual([]);
  });

  it('按 author 聚合 mrCount 与 totalFindings', () => {
    const records = [
      makeRecord({ author: 'zhangsan', mrIid: 1, repoId: 'r1' }),
      makeRecord({ author: 'zhangsan', mrIid: 1, repoId: 'r1' }),
      makeRecord({ author: 'zhangsan', mrIid: 2, repoId: 'r1' }),
      makeRecord({ author: 'lisi', mrIid: 3, repoId: 'r1' }),
    ];
    const items = computeByAuthor(records);
    expect(items).toHaveLength(2);
    const zs = items.find((i) => i.author === 'zhangsan');
    const ls = items.find((i) => i.author === 'lisi');
    // zhangsan: 2 个不同 MR（1@r1, 2@r1），3 条 findings
    expect(zs?.mrCount).toBe(2);
    expect(zs?.totalFindings).toBe(3);
    expect(zs?.avgFindingsPerMR).toBeCloseTo(1.5, 5);
    // lisi: 1 个 MR，1 条 finding
    expect(ls?.mrCount).toBe(1);
    expect(ls?.totalFindings).toBe(1);
  });

  it('正确计算 acceptanceRate', () => {
    const records = [
      makeRecord({ author: 'a', submitted: true, resolved: true }),
      makeRecord({ author: 'a', submitted: true, resolved: false }),
    ];
    const items = computeByAuthor(records);
    expect(items[0].acceptanceRate).toBeCloseTo(50, 5);
  });

  it('同一作者跨多个仓库的 MR 均计入', () => {
    const records = [
      makeRecord({ author: 'a', mrIid: 1, repoId: 'r1' }),
      makeRecord({ author: 'a', mrIid: 1, repoId: 'r2' }),
    ];
    const items = computeByAuthor(records);
    // 1@r1 与 1@r2 是不同 MR（repoId 不同）
    expect(items[0].mrCount).toBe(2);
  });
});

// ==================== computeByRepo ====================

describe('computeByRepo', () => {
  it('空数组返回空数组', () => {
    expect(computeByRepo([])).toEqual([]);
  });

  it('按 repoId 聚合 mrCount 与 findings', () => {
    const records = [
      makeRecord({ repoId: 'r1', mrIid: 1 }),
      makeRecord({ repoId: 'r1', mrIid: 1 }),
      makeRecord({ repoId: 'r1', mrIid: 2 }),
      makeRecord({ repoId: 'r2', mrIid: 1 }),
    ];
    const items = computeByRepo(records);
    expect(items).toHaveLength(2);
    const r1 = items.find((i) => i.repoId === 'r1');
    const r2 = items.find((i) => i.repoId === 'r2');
    expect(r1?.mrCount).toBe(2); // 1@r1, 2@r1
    expect(r1?.findings).toBe(3);
    expect(r2?.mrCount).toBe(1); // 1@r2
    expect(r2?.findings).toBe(1);
  });

  it('正确计算 interceptions', () => {
    const records = [
      makeRecord({ repoId: 'r1', mrIid: 1, blockedMerge: true }),
      makeRecord({ repoId: 'r1', mrIid: 1, blockedMerge: true }),
      makeRecord({ repoId: 'r1', mrIid: 2, blockedMerge: true }),
      makeRecord({ repoId: 'r1', mrIid: 3, blockedMerge: false }),
    ];
    const items = computeByRepo(records);
    const r1 = items.find((i) => i.repoId === 'r1');
    // blockedMerge 的不同 MR：1@r1, 2@r1 → 2
    expect(r1?.interceptions).toBe(2);
  });

  it('repoName 从 repoNameMap 查找，缺失时回退为 repoId', () => {
    const records = [makeRecord({ repoId: 'r1' })];
    const nameMap = new Map([['r1', '前端仓库']]);
    const items = computeByRepo(records, nameMap);
    expect(items[0].repoName).toBe('前端仓库');
  });

  it('未提供 repoNameMap 时 repoName 回退为 repoId', () => {
    const records = [makeRecord({ repoId: 'r1' })];
    const items = computeByRepo(records);
    expect(items[0].repoName).toBe('r1');
  });

  it('repoNameMap 中找不到时 repoName 回退为 repoId', () => {
    const records = [makeRecord({ repoId: 'r1' })];
    const nameMap = new Map([['r2', '其他仓库']]);
    const items = computeByRepo(records, nameMap);
    expect(items[0].repoName).toBe('r1');
  });

  it('正确计算 acceptanceRate', () => {
    const records = [
      makeRecord({ repoId: 'r1', submitted: true, resolved: true }),
      makeRecord({ repoId: 'r1', submitted: true, resolved: false }),
      makeRecord({ repoId: 'r1', submitted: false, resolved: true }),
    ];
    const items = computeByRepo(records);
    // 分母=2, 分子=1 → 50%
    expect(items[0].acceptanceRate).toBeCloseTo(50, 5);
  });
});
