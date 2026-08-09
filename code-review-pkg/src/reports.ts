// src/reports.ts — 报表聚合计算（基于 findings 历史记录）
//
// 提供问题单接纳率、拦截数量、检视趋势、按规则/作者/仓库维度的聚合统计。
// 纯函数实现，入参为 FindingHistoryRecord[]，便于测试与组合；不引入外部依赖。
import type { FindingHistoryRecord } from './findings-history-store.js';

/** 报表总览指标 */
export interface ReportsOverview {
  /** 接纳率（0-100） */
  acceptanceRate: number;
  /** 已 resolved 的已提交 findings 数 */
  acceptanceNumerator: number;
  /** 已提交 findings 数 */
  acceptanceDenominator: number;
  /** 阻断合入的不同 MR 数 */
  interceptionCount: number;
  /** 检视次数（不同 MR 数） */
  reviewCount: number;
  /** findings 总数 */
  totalFindings: number;
  /** 平均每个 MR 的 findings 数 */
  avgFindingsPerMR: number;
}

/** 趋势数据点（按日） */
export interface TrendPoint {
  /** 日期 YYYY-MM-DD */
  date: string;
  /** 当日检视的 MR 数（去重 mrIid+repoId） */
  reviews: number;
  /** 当日 findings 总数 */
  findings: number;
  /** 当日 resolved 的 findings 数 */
  acceptedFindings: number;
  /** 当日 blockedMerge 的不同 MR 数 */
  interceptions: number;
}

/** 按规则聚合项 */
export interface ByRuleItem {
  ruleId: string;
  ruleName: string;
  hitCount: number;
  acceptanceCount: number;
  acceptanceRate: number;
}

/** 按作者聚合项 */
export interface ByAuthorItem {
  author: string;
  mrCount: number;
  totalFindings: number;
  avgFindingsPerMR: number;
  acceptanceRate: number;
}

/** 按仓库聚合项 */
export interface ByRepoItem {
  repoId: string;
  repoName: string;
  mrCount: number;
  findings: number;
  acceptanceRate: number;
  interceptions: number;
}

/**
 * 生成 mrIid+repoId 的唯一组合键，用于 MR 维度去重。
 */
function mrKey(mrIid: number | string, repoId: string): string {
  return `${mrIid}@${repoId}`;
}

/**
 * 从 ISO 时间戳提取日期（YYYY-MM-DD）。
 * ISO8601 字典序与日期序一致，可直接用 slice。
 */
function toDate(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * 计算百分比接纳率：分子/分母*100，分母为 0 时返回 0。
 */
function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

/**
 * 计算 overview 总览指标。
 *
 * - acceptanceRate：submitted=true && resolved=true 占 submitted=true 的比例
 * - interceptionCount：blockedMerge=true 的不同 mrIid+repoId 组合数
 * - reviewCount：不同 mrIid+repoId 组合数
 * - avgFindingsPerMR：totalFindings / reviewCount
 */
export function computeOverview(records: FindingHistoryRecord[]): ReportsOverview {
  const totalFindings = records.length;

  // 接纳率：submitted=true && resolved=true / submitted=true
  let acceptanceNumerator = 0;
  let acceptanceDenominator = 0;
  for (const r of records) {
    if (r.submitted) {
      acceptanceDenominator++;
      if (r.resolved) acceptanceNumerator++;
    }
  }

  // 检视次数：不同 mrIid+repoId 组合数
  const reviewKeys = new Set<string>();
  // 拦截次数：blockedMerge=true 的不同 MR 数（同一 MR 多次阻断只计一次）
  const interceptionKeys = new Set<string>();
  for (const r of records) {
    const key = mrKey(r.mrIid, r.repoId);
    reviewKeys.add(key);
    if (r.blockedMerge) interceptionKeys.add(key);
  }

  const reviewCount = reviewKeys.size;
  const interceptionCount = interceptionKeys.size;

  return {
    acceptanceRate: rate(acceptanceNumerator, acceptanceDenominator),
    acceptanceNumerator,
    acceptanceDenominator,
    interceptionCount,
    reviewCount,
    totalFindings,
    avgFindingsPerMR: reviewCount > 0 ? totalFindings / reviewCount : 0,
  };
}

/**
 * 计算趋势数据（最近 rangeDays 天，含今天）。
 *
 * 按 reviewedAt 的日期（YYYY-MM-DD）分组，每日统计：
 * - reviews：不同 mrIid+repoId 数
 * - findings：记录数
 * - acceptedFindings：resolved=true 的记录数
 * - interceptions：blockedMerge=true 的不同 MR 数
 *
 * rangeDays 支持常用值 7/30/90；非正整数时默认 30。
 */
export function computeTrend(
  records: FindingHistoryRecord[],
  rangeDays: number = 30,
): TrendPoint[] {
  // 规范化 rangeDays：非正整数回退为 30
  const days = Number.isFinite(rangeDays) && rangeDays > 0 ? Math.floor(rangeDays) : 30;

  // 生成最近 N 天的日期列表（从最早到最近，含今天），统一使用 UTC 日期与 toISOString 对齐
  const today = new Date();
  const dateList: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    dateList.push(d.toISOString().slice(0, 10));
  }

  // 按日期分组记录
  const byDate = new Map<string, FindingHistoryRecord[]>();
  for (const r of records) {
    const date = toDate(r.reviewedAt);
    let arr = byDate.get(date);
    if (!arr) {
      arr = [];
      byDate.set(date, arr);
    }
    arr.push(r);
  }

  // 生成趋势点（按日期顺序）
  return dateList.map((date) => {
    const dayRecords = byDate.get(date) ?? [];
    const reviewKeys = new Set<string>();
    const interceptionKeys = new Set<string>();
    let acceptedFindings = 0;
    for (const r of dayRecords) {
      const key = mrKey(r.mrIid, r.repoId);
      reviewKeys.add(key);
      if (r.blockedMerge) interceptionKeys.add(key);
      if (r.resolved) acceptedFindings++;
    }
    return {
      date,
      reviews: reviewKeys.size,
      findings: dayRecords.length,
      acceptedFindings,
      interceptions: interceptionKeys.size,
    };
  });
}

/**
 * 按规则聚合。
 *
 * - ruleId 缺失归为 'unknown'
 * - ruleName 从 finding.ruleName 读取（容忍缺失，回退为 ruleId）
 * - hitCount：记录数
 * - acceptanceCount：submitted=true && resolved=true 的记录数
 * - acceptanceRate：acceptanceCount / (submitted=true 数) * 100
 * - 按 hitCount 降序排序
 */
export function computeByRule(records: FindingHistoryRecord[]): ByRuleItem[] {
  const map = new Map<
    string,
    {
      ruleName: string;
      hitCount: number;
      acceptanceCount: number;
      submittedCount: number;
    }
  >();

  for (const r of records) {
    const ruleId = r.finding?.ruleId ?? 'unknown';
    // Finding 类型定义中暂无 ruleName 字段，容忍性读取以兼容扩展数据
    const ruleName = (r.finding as { ruleName?: string })?.ruleName ?? ruleId;

    let item = map.get(ruleId);
    if (!item) {
      item = { ruleName, hitCount: 0, acceptanceCount: 0, submittedCount: 0 };
      map.set(ruleId, item);
    }
    item.hitCount++;
    if (r.submitted) {
      item.submittedCount++;
      if (r.resolved) item.acceptanceCount++;
    }
  }

  const result: ByRuleItem[] = [];
  for (const [ruleId, item] of map) {
    result.push({
      ruleId,
      ruleName: item.ruleName,
      hitCount: item.hitCount,
      acceptanceCount: item.acceptanceCount,
      acceptanceRate: rate(item.acceptanceCount, item.submittedCount),
    });
  }
  // 按 hitCount 降序
  result.sort((a, b) => b.hitCount - a.hitCount);
  return result;
}

/**
 * 按作者聚合。
 *
 * - mrCount：不同 mrIid+repoId 数
 * - totalFindings：记录数
 * - avgFindingsPerMR：totalFindings / mrCount
 * - acceptanceRate：同 overview 口径（submitted&&resolved / submitted）
 */
export function computeByAuthor(records: FindingHistoryRecord[]): ByAuthorItem[] {
  const map = new Map<
    string,
    {
      mrKeys: Set<string>;
      totalFindings: number;
      acceptanceNumerator: number;
      acceptanceDenominator: number;
    }
  >();

  for (const r of records) {
    let item = map.get(r.author);
    if (!item) {
      item = {
        mrKeys: new Set(),
        totalFindings: 0,
        acceptanceNumerator: 0,
        acceptanceDenominator: 0,
      };
      map.set(r.author, item);
    }
    item.mrKeys.add(mrKey(r.mrIid, r.repoId));
    item.totalFindings++;
    if (r.submitted) {
      item.acceptanceDenominator++;
      if (r.resolved) item.acceptanceNumerator++;
    }
  }

  const result: ByAuthorItem[] = [];
  for (const [author, item] of map) {
    const mrCount = item.mrKeys.size;
    result.push({
      author,
      mrCount,
      totalFindings: item.totalFindings,
      avgFindingsPerMR: mrCount > 0 ? item.totalFindings / mrCount : 0,
      acceptanceRate: rate(item.acceptanceNumerator, item.acceptanceDenominator),
    });
  }
  return result;
}

/**
 * 按仓库聚合。
 *
 * - repoName：从 repoNameMap 查找，找不到用 repoId
 * - mrCount：不同 mrIid+repoId 数
 * - findings：记录数
 * - acceptanceRate：同 overview 口径
 * - interceptions：blockedMerge=true 的不同 MR 数
 */
export function computeByRepo(
  records: FindingHistoryRecord[],
  repoNameMap?: Map<string, string>,
): ByRepoItem[] {
  const map = new Map<
    string,
    {
      mrKeys: Set<string>;
      findings: number;
      acceptanceNumerator: number;
      acceptanceDenominator: number;
      interceptionKeys: Set<string>;
    }
  >();

  for (const r of records) {
    let item = map.get(r.repoId);
    if (!item) {
      item = {
        mrKeys: new Set(),
        findings: 0,
        acceptanceNumerator: 0,
        acceptanceDenominator: 0,
        interceptionKeys: new Set(),
      };
      map.set(r.repoId, item);
    }
    const key = mrKey(r.mrIid, r.repoId);
    item.mrKeys.add(key);
    item.findings++;
    if (r.blockedMerge) item.interceptionKeys.add(key);
    if (r.submitted) {
      item.acceptanceDenominator++;
      if (r.resolved) item.acceptanceNumerator++;
    }
  }

  const result: ByRepoItem[] = [];
  for (const [repoId, item] of map) {
    const repoName = repoNameMap?.get(repoId) ?? repoId;
    result.push({
      repoId,
      repoName,
      mrCount: item.mrKeys.size,
      findings: item.findings,
      acceptanceRate: rate(item.acceptanceNumerator, item.acceptanceDenominator),
      interceptions: item.interceptionKeys.size,
    });
  }
  return result;
}
