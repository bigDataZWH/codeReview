// src/metrics.ts — 迭代 10：度量指标 + 趋势分析 + 仪表盘数据
//
// 设计目标：
// - 从 StateStore 会话与 FeedbackStore 反馈中聚合出度量指标
// - 覆盖 5 大维度：coverage / quality / cost / efficiency / trend
// - generateDashboardData 输出可直接渲染的仪表盘数据结构
//
// 设计取舍：
// - 输入参数为不可变快照（session/findings/feedback store），不直接耦合存储层
// - 趋势分桶采用按天聚合，避免数据点过多
// - 不引入第三方图表库，仅输出原始数据结构，由调用方决定渲染方式

import { getRuleEffectiveness, type FeedbackStore, type RuleEffectiveness } from './feedback.js';
import type { Finding, Severity } from './types.js';

/** 度量指标输入：会话快照 */
export interface SessionSnapshot {
  /** 会话 ID */
  id: string;
  /** 会话状态 */
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** 总文件数 */
  filesTotal: number;
  /** 已处理文件数 */
  filesProcessed: number;
  /** 创建时间戳（ms） */
  createdAt: number;
  /** 更新时间戳（ms） */
  updatedAt: number;
  /** 完成时间戳（ms，可选） */
  finishedAt?: number;
  /** 已分析行数（可选） */
  linesAnalyzed?: number;
}

/** 度量指标输入 */
export interface MetricsInput {
  /** 会话快照列表 */
  sessions: SessionSnapshot[];
  /** 全部 findings */
  findings: Finding[];
  /** 反馈存储 */
  feedback: FeedbackStore;
  /** 消耗的 Token 总数（可选） */
  tokenConsumed?: number;
  /** 按会话 ID 分组的 findings（可选，用于趋势分析；缺省时所有 findings 归到桶中） */
  findingsBySession?: Map<string, Finding[]>;
}

/** 覆盖率指标 */
export interface CoverageMetrics {
  /** PR 覆盖率 = 已完成会话数 / 总会话数 */
  prCoverage: number;
  /** 文件覆盖率 = 已处理文件 / 总文件 */
  fileCoverage: number;
  /** 总会话数 */
  totalSessions: number;
  /** 已完成会话数 */
  completedSessions: number;
}

/** 质量指标 */
export interface QualityMetrics {
  /** 平均每文件 finding 数 */
  avgFindingsPerFile: number;
  /** 严重度分布 */
  severityDistribution: Record<Severity | 'info', number>;
  /** 接受率 = accept / (accept + reject + modify) */
  acceptRate: number;
  /** 拒绝率 = reject / (accept + reject + modify) */
  rejectRate: number;
  /** 类别分布 */
  categoryDistribution: Record<string, number>;
}

/** 成本指标 */
export interface CostMetrics {
  /** 总 Token 消耗 */
  tokenConsumed: number;
  /** 每千行代码 Token 消耗 */
  tokensPerKLine: number;
}

/** 效率指标 */
export interface EfficiencyMetrics {
  /** 修复率 = accept / total findings */
  fixRate: number;
  /** 总耗时（ms） */
  totalDurationMs: number;
  /** 平均每会话耗时（ms） */
  avgDurationPerSession: number;
}

/** 趋势分桶 */
export interface TrendBucket {
  /** 桶起始时间戳（ms） */
  bucketStart: number;
  /** 桶结束时间戳（ms） */
  bucketEnd: number;
  /** 该桶内 finding 数 */
  findingCount: number;
  /** 该桶内会话数 */
  sessionCount: number;
}

/** 趋势方向 */
export type TrendDirection = 'increasing' | 'decreasing' | 'stable';

/** 趋势指标 */
export interface TrendMetrics {
  /** 时间分桶 */
  buckets: TrendBucket[];
  /** 整体方向 */
  direction: TrendDirection;
}

/** 完整度量指标 */
export interface ReviewMetrics {
  coverage: CoverageMetrics;
  quality: QualityMetrics;
  cost: CostMetrics;
  efficiency: EfficiencyMetrics;
  trend: TrendMetrics;
}

/** 一天的毫秒数 */
const ONE_DAY_MS = 86400 * 1000;

/** 安全除法：分母为 0 时返回 0 */
function safeDiv(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/** 计算时间戳所属的天桶起始时间 */
function getBucketStart(ts: number, minTime: number): number {
  return Math.floor((ts - minTime) / ONE_DAY_MS) * ONE_DAY_MS + minTime;
}

/**
 * 收集度量指标。
 *
 * @param input 度量输入
 * @returns 完整度量指标
 */
export function collectMetrics(input: MetricsInput): ReviewMetrics {
  const { sessions, findings, feedback } = input;
  const tokenConsumed = Math.max(0, input.tokenConsumed ?? 0);

  // ── 覆盖率 ──
  const totalSessions = sessions.length;
  const completedSessions = sessions.filter((s) => s.status === 'completed').length;
  const totalFiles = sessions.reduce((s, sess) => s + Math.max(0, sess.filesTotal), 0);
  const processedFiles = sessions.reduce((s, sess) => s + Math.max(0, sess.filesProcessed), 0);
  const prCoverage = safeDiv(completedSessions, totalSessions);
  const fileCoverage = safeDiv(processedFiles, totalFiles);

  // ── 质量 ──
  const severityDistribution: Record<Severity | 'info', number> = {
    critical: 0, high: 0, medium: 0, low: 0, info: 0,
  };
  const categoryDistribution: Record<string, number> = {};
  for (const f of findings) {
    const sev = (f.severity as Severity | 'info') ?? 'info';
    severityDistribution[sev in severityDistribution ? sev : 'info']++;
    const cat = f.category ?? 'unknown';
    categoryDistribution[cat] = (categoryDistribution[cat] ?? 0) + 1;
  }
  const avgFindingsPerFile = safeDiv(findings.length, totalFiles);

  const stats = feedback.getFeedbackStats();
  const acceptRate = safeDiv(stats.acceptCount, stats.total);
  const rejectRate = safeDiv(stats.rejectCount, stats.total);

  // ── 成本 ──
  const totalLines = sessions.reduce((s, sess) => s + Math.max(0, sess.linesAnalyzed ?? 0), 0);
  const tokensPerKLine = totalLines > 0 ? (tokenConsumed / totalLines) * 1000 : 0;

  // ── 效率 ──
  const fixRate = safeDiv(stats.acceptCount, findings.length);
  let totalDurationMs = 0;
  for (const sess of sessions) {
    if (sess.finishedAt !== undefined && sess.finishedAt >= sess.createdAt) {
      totalDurationMs += sess.finishedAt - sess.createdAt;
    }
  }
  const avgDurationPerSession = safeDiv(totalDurationMs, completedSessions);

  // ── 趋势 ──
  const trend = computeTrend(sessions, input.findingsBySession, findings);

  return {
    coverage: {
      prCoverage,
      fileCoverage,
      totalSessions,
      completedSessions,
    },
    quality: {
      avgFindingsPerFile,
      severityDistribution,
      acceptRate,
      rejectRate,
      categoryDistribution,
    },
    cost: {
      tokenConsumed,
      tokensPerKLine,
    },
    efficiency: {
      fixRate,
      totalDurationMs,
      avgDurationPerSession,
    },
    trend,
  };
}

/**
 * 计算趋势：按天分桶，统计每个桶内的 finding 与会话数。
 * 通过对比最早与最近桶的 finding 数判断方向。
 */
function computeTrend(
  sessions: SessionSnapshot[],
  findingsBySession: Map<string, Finding[]> | undefined,
  allFindings: Finding[],
): TrendMetrics {
  if (sessions.length === 0) {
    return { buckets: [], direction: 'stable' };
  }

  // 按天分桶
  const minTime = Math.min(...sessions.map((s) => s.createdAt));
  const maxTime = Math.max(...sessions.map((s) => s.createdAt));
  const buckets: TrendBucket[] = [];
  const bucketMap = new Map<number, TrendBucket>();

  for (let t = minTime; t <= maxTime + ONE_DAY_MS; t += ONE_DAY_MS) {
    const b: TrendBucket = { bucketStart: t, bucketEnd: t + ONE_DAY_MS, findingCount: 0, sessionCount: 0 };
    buckets.push(b);
    bucketMap.set(t, b);
  }

  // 会话归桶
  for (const sess of sessions) {
    const day = getBucketStart(sess.createdAt, minTime);
    const b = bucketMap.get(day);
    if (b) b.sessionCount++;
  }

  // findings 归桶：优先按 findingsBySession，否则均匀分布
  if (findingsBySession && findingsBySession.size > 0) {
    const sessionMap = new Map(sessions.map((s) => [s.id, s]));
    for (const [sid, fs] of findingsBySession.entries()) {
      const sess = sessionMap.get(sid);
      if (!sess) continue;
      const day = getBucketStart(sess.createdAt, minTime);
      const b = bucketMap.get(day);
      if (b) b.findingCount += fs.length;
    }
  } else {
    // 无会话映射时，均匀分布到有会话的桶中（总数保持准确）
    if (allFindings.length > 0) {
      const activeBuckets = buckets.filter((b) => b.sessionCount > 0);
      const targetBuckets = activeBuckets.length > 0 ? activeBuckets : buckets;
      const baseCount = Math.floor(allFindings.length / targetBuckets.length);
      let remainder = allFindings.length % targetBuckets.length;
      for (const b of targetBuckets) {
        b.findingCount = baseCount + (remainder > 0 ? 1 : 0);
        remainder--;
      }
    }
  }

  // 移除空尾部桶
  while (buckets.length > 1 && buckets[buckets.length - 1].sessionCount === 0 && buckets[buckets.length - 1].findingCount === 0) {
    buckets.pop();
  }

  // 方向判断：对比前半段与后半段的 finding 密度
  let direction: TrendDirection = 'stable';
  if (buckets.length >= 2) {
    const half = Math.floor(buckets.length / 2);
    const firstHalf = buckets.slice(0, half).reduce((s, b) => s + b.findingCount, 0);
    const secondHalf = buckets.slice(half).reduce((s, b) => s + b.findingCount, 0);
    if (secondHalf > firstHalf * 1.2) {
      direction = 'increasing';
    } else if (secondHalf < firstHalf * 0.8) {
      direction = 'decreasing';
    }
  }

  return { buckets, direction };
}

// ============================================================
// 仪表盘数据
// ============================================================

/** 仪表盘 KPI 卡片数据 */
export interface DashboardKpi {
  /** PR 覆盖率 */
  prCoverage: number;
  /** 文件覆盖率 */
  fileCoverage: number;
  /** 接受率 */
  acceptRate: number;
  /** 总 finding 数 */
  totalFindings: number;
  /** 总会话数 */
  totalSessions: number;
  /** 总 Token 消耗 */
  totalTokens: number;
}

/** 仪表盘图表数据 */
export interface DashboardCharts {
  /** 严重度分布饼图 */
  severityPie: Record<Severity | 'info', number>;
  /** 类别分布柱状图 */
  categoryBar: Record<string, number>;
  /** 趋势折线图 */
  trendLine: TrendBucket[];
  /** 规则有效性排行（复用 feedback.RuleEffectiveness，统一逻辑） */
  ruleEffectiveness: RuleEffectiveness[];
}

/** 完整仪表盘数据 */
export interface DashboardData {
  /** KPI 卡片 */
  kpi: DashboardKpi;
  /** 图表数据 */
  charts: DashboardCharts;
  /** 完整度量（备份） */
  metrics: ReviewMetrics;
}

/**
 * 生成仪表盘数据：聚合 KPI、图表与规则有效性。
 *
 * @param input 度量输入
 * @returns 仪表盘数据
 */
export function generateDashboardData(input: MetricsInput): DashboardData {
  const metrics = collectMetrics(input);
  const { feedback } = input;

  // 规则有效性（复用 feedback.getRuleEffectiveness，统一逻辑）
  const ruleEffectiveness = getRuleEffectiveness(feedback);

  return {
    kpi: {
      prCoverage: metrics.coverage.prCoverage,
      fileCoverage: metrics.coverage.fileCoverage,
      acceptRate: metrics.quality.acceptRate,
      totalFindings: input.findings.length,
      totalSessions: metrics.coverage.totalSessions,
      totalTokens: metrics.cost.tokenConsumed,
    },
    charts: {
      severityPie: metrics.quality.severityDistribution,
      categoryBar: metrics.quality.categoryDistribution,
      trendLine: metrics.trend.buckets,
      ruleEffectiveness,
    },
    metrics,
  };
}
