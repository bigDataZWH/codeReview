// src/model-router.ts — Task 8：模型路由
//
// 职责：
// 1. ModelRouter 类：根据 finding 复杂度选择 LLM 模型
// 2. classifyComplexity：评估单条 finding 的复杂度评分（0-100）
// 3. routeByComplexity：根据复杂度返回对应的模型名（small / medium / large）
//
// 设计取舍：
// - 复杂度评分基于多维度启发式：severity、category、message 长度、suggestion 长度、confidence
//   - severity：critical=30, high=20, medium=10, low=5, info=0
//   - category：security/memory-safety/concurrency 加分（高风险类别）
//   - message 长度：>200 字符加 10 分
//   - suggestion 长度：>200 字符加 5 分
//   - confidence：<0.5 加 10 分（低置信度更需要强模型反思）
// - 模型分级：[0,30) → small；[30,70) → medium；[70,100] → large
// - 安全/内存/并发类 finding 强制升级到 large（避免漏报高风险）
// - 路由策略可配置：用户可传入自定义模型名映射

import type { Finding, Severity } from './types.js';

/** 复杂度等级 */
export type ComplexityLevel = 'low' | 'medium' | 'high';

/** 模型分级名称 */
export type ModelSize = 'small' | 'medium' | 'large';

/** 路由结果 */
export interface RoutingResult {
  /** 选择的模型名 */
  model: string;
  /** 模型分级 */
  size: ModelSize;
  /** 复杂度评分（0-100） */
  complexityScore: number;
  /** 复杂度等级 */
  complexityLevel: ComplexityLevel;
  /** 选择该模型的原因 */
  reason: string;
}

/** 默认模型名映射 */
export const DEFAULT_MODEL_MAP: Record<ModelSize, string> = {
  small: 'gpt-4o-mini',
  medium: 'gpt-4o',
  large: 'gpt-4o-turbo',
};

/** 复杂度评分阈值：[0, SMALL_THRESHOLD) → small */
export const SMALL_COMPLEXITY_THRESHOLD = 30;
/** 复杂度评分阈值：[SMALL_THRESHOLD, MEDIUM_THRESHOLD) → medium */
export const MEDIUM_COMPLEXITY_THRESHOLD = 70;

/** 强制升级到 large 的高风险类别集合 */
export const HIGH_RISK_CATEGORIES: ReadonlySet<string> = new Set([
  'security',
  'memory-safety',
  'concurrency',
  'thread-safety',
  'auth',
]);

/** severity 评分映射 */
const SEVERITY_SCORE: Record<Severity | 'info', number> = {
  critical: 30,
  high: 20,
  medium: 10,
  low: 5,
  info: 0,
};

/** 长消息阈值（字符） */
const LONG_MESSAGE_THRESHOLD = 200;

/** 长建议阈值（字符） */
const LONG_SUGGESTION_THRESHOLD = 200;

/** 低置信度阈值 */
const LOW_CONFIDENCE_THRESHOLD = 0.5;

/** 低置信度加分 */
const LOW_CONFIDENCE_BONUS = 10;

/** 长消息加分 */
const LONG_MESSAGE_BONUS = 10;

/** 长建议加分 */
const LONG_SUGGESTION_BONUS = 5;

/** 最大复杂度评分 */
export const MAX_COMPLEXITY_SCORE = 100;

/**
 * 评估单条 finding 的复杂度评分。
 *
 * 评分维度（累加，最高 100）：
 * - severity：critical=30, high=20, medium=10, low=5, info=0
 * - category：高风险类别（security/memory-safety/concurrency）加 20 分
 * - message 长度：>200 字符加 10 分
 * - suggestion 长度：>200 字符加 5 分
 * - confidence：<0.5 加 10 分（低置信度更需要强模型反思）
 *
 * @param finding 待评估的 finding
 * @returns 复杂度评分 [0, 100]
 */
export function classifyComplexity(finding: Finding): number {
  let score = 0;

  // severity 评分
  const sev = finding.severity as Severity | 'info';
  score += SEVERITY_SCORE[sev] ?? 0;

  // 高风险类别加分
  if (HIGH_RISK_CATEGORIES.has(finding.category)) {
    score += 20;
  }

  // 长消息加分
  if (typeof finding.message === 'string' && finding.message.length > LONG_MESSAGE_THRESHOLD) {
    score += LONG_MESSAGE_BONUS;
  }

  // 长建议加分
  if (
    finding.suggestion !== undefined &&
    typeof finding.suggestion === 'string' &&
    finding.suggestion.length > LONG_SUGGESTION_THRESHOLD
  ) {
    score += LONG_SUGGESTION_BONUS;
  }

  // 低置信度加分
  if (typeof finding.confidence === 'number' && finding.confidence < LOW_CONFIDENCE_THRESHOLD) {
    score += LOW_CONFIDENCE_BONUS;
  }

  return Math.max(0, Math.min(MAX_COMPLEXITY_SCORE, score));
}

/**
 * 根据复杂度评分返回等级。
 *
 * - [0, 30) → low
 * - [30, 70) → medium
 * - [70, 100] → high
 */
export function getComplexityLevel(score: number): ComplexityLevel {
  if (score < SMALL_COMPLEXITY_THRESHOLD) return 'low';
  if (score < MEDIUM_COMPLEXITY_THRESHOLD) return 'medium';
  return 'high';
}

/**
 * 模型路由器：根据 finding 复杂度选择 LLM 模型。
 *
 * 使用方式：
 * 1. new ModelRouter() — 使用默认模型映射
 * 2. new ModelRouter({ models: {...} }) — 自定义模型名映射
 * 3. router.routeByComplexity(finding) — 返回 RoutingResult
 */
export class ModelRouter {
  /** 模型名映射 */
  private readonly models: Record<ModelSize, string>;
  /** 自定义复杂度阈值（可选） */
  private readonly smallThreshold: number;
  private readonly mediumThreshold: number;
  /** 路由历史记录（最近 N 条） */
  private history: RoutingResult[] = [];
  /** 历史记录上限 */
  private readonly historyLimit: number;

  constructor(options?: {
    /** 自定义模型名映射 */
    models?: Partial<Record<ModelSize, string>>;
    /** small 阈值（默认 30） */
    smallThreshold?: number;
    /** medium 阈值（默认 70） */
    mediumThreshold?: number;
    /** 历史记录上限（默认 100） */
    historyLimit?: number;
  }) {
    this.models = { ...DEFAULT_MODEL_MAP, ...(options?.models ?? {}) };
    this.smallThreshold = options?.smallThreshold ?? SMALL_COMPLEXITY_THRESHOLD;
    this.mediumThreshold = options?.mediumThreshold ?? MEDIUM_COMPLEXITY_THRESHOLD;
    this.historyLimit = options?.historyLimit ?? 100;
  }

  /**
   * 根据 finding 复杂度选择模型。
   *
   * 选择规则：
   * 1. 高风险类别（security/memory-safety/concurrency）强制使用 large 模型
   * 2. 否则按复杂度评分选择：[0, small) → small；[small, medium) → medium；[medium, 100] → large
   *
   * @param finding 待路由的 finding
   * @returns 路由结果
   */
  routeByComplexity(finding: Finding): RoutingResult {
    const score = classifyComplexity(finding);

    // 高风险类别强制 large
    if (HIGH_RISK_CATEGORIES.has(finding.category)) {
      const result: RoutingResult = {
        model: this.models.large,
        size: 'large',
        complexityScore: score,
        complexityLevel: 'high',
        reason: `high-risk category "${finding.category}" forced large model`,
      };
      this.pushHistory(result);
      return result;
    }

    const level = this.getLevel(score);
    const size = this.levelToSize(level);
    const result: RoutingResult = {
      model: this.models[size],
      size,
      complexityScore: score,
      complexityLevel: level,
      reason: `complexity score ${score} → ${size} model`,
    };
    this.pushHistory(result);
    return result;
  }

  /**
   * 根据复杂度评分返回等级（使用实例配置的阈值）。
   */
  getLevel(score: number): ComplexityLevel {
    if (score < this.smallThreshold) return 'low';
    if (score < this.mediumThreshold) return 'medium';
    return 'high';
  }

  /**
   * 等级 → 模型分级映射。
   */
  private levelToSize(level: ComplexityLevel): ModelSize {
    switch (level) {
      case 'low':
        return 'small';
      case 'medium':
        return 'medium';
      case 'high':
        return 'large';
    }
  }

  /**
   * 查询模型名映射。
   */
  getModels(): Record<ModelSize, string> {
    return { ...this.models };
  }

  /**
   * 返回最近 N 条路由历史（副本）。
   */
  getHistory(): RoutingResult[] {
    return [...this.history];
  }

  /** 清空路由历史 */
  clearHistory(): void {
    this.history = [];
  }

  /** 追加历史记录，超过上限时移除最旧的 */
  private pushHistory(result: RoutingResult): void {
    this.history.push(result);
    while (this.history.length > this.historyLimit) {
      this.history.shift();
    }
  }
}
