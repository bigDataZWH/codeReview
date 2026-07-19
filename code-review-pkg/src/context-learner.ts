// src/context-learner.ts — Task 7：上下文学习
//
// 职责：
// 1. ContextLearner 类：维护从历史反馈中学习到的权重
// 2. learnFromFeedback：基于 FeedbackStore 中的 accept/reject 数据更新权重
// 3. getLearnedWeights：返回当前已学习的权重映射
// 4. applyLearnedWeights：将学习到的权重应用到 findings，调整 confidence
//
// 设计取舍：
// - 权重以 (category + ruleId) 为键聚合，缺失 ruleId 时仅以 category 为键
// - 权重公式：weight = acceptCount / (acceptCount + rejectCount)，
//   落在 [0, 1] 区间；未学习时默认 1.0（即不调整）
// - 应用权重：finding.confidence = clamp01(confidence * weight)
// - 仅 reject 反馈会降低权重，accept 反馈会维持/提升权重，modify 不参与
//
// 与 feedback.ts 集成：
// - markFalsePositive 在记录 reject 反馈后调用 learner.learnFromFeedback(store)
// - 这样后续 applyLearnedWeights 即可参考最新学习结果

import type { Finding } from './types.js';
import type { FeedbackStore } from './feedback.js';

/** 学习到的权重映射：键为 `category` 或 `category:ruleId`，值为 [0,1] 的权重 */
export type LearnedWeights = Map<string, number>;

/** 默认权重：未学习过的模式视为 1.0（即不调整） */
export const DEFAULT_WEIGHT = 1.0;

/** 触发学习的最小反馈条数（少于则不更新权重） */
export const LEARNING_MIN_FEEDBACKS = 1;

/** 权重下限：避免完全置零导致 finding 直接被丢弃 */
export const MIN_WEIGHT = 0.0;

/** 权重上限 */
export const MAX_WEIGHT = 1.0;

/** 学习结果统计 */
export interface LearningStats {
  /** 已学习的模式数 */
  patternsCount: number;
  /** 用于学习的反馈总数 */
  feedbacksUsed: number;
  /** 最低权重 */
  minWeight: number;
  /** 最高权重 */
  maxWeight: number;
}

/**
 * 生成 finding 的权重键。
 *
 * - 有 ruleId 时使用 `category:ruleId`
 * - 否则使用 `category`
 */
export function getWeightKey(category: string, ruleId?: string): string {
  if (ruleId) return `${category}:${ruleId}`;
  return category;
}

/**
 * 上下文学习器：从反馈数据中学习权重，用于调整 finding 的 confidence。
 *
 * 使用方式：
 * 1. 调用 learnFromFeedback(store) 触发学习
 * 2. 调用 getLearnedWeights() 读取权重
 * 3. 调用 applyLearnedWeights(findings) 应用权重
 */
export class ContextLearner {
  /** 当前学习到的权重映射 */
  private weights: LearnedWeights = new Map();
  /** 上次学习时使用的反馈条数 */
  private lastFeedbacksUsed = 0;

  /**
   * 从 FeedbackStore 学习权重。
   *
   * - 仅统计 accept / reject 反馈（modify 不参与）
   * - 按 (category + ruleId) 聚合
   * - weight = acceptCount / (acceptCount + rejectCount)
   * - 当某模式 accept+reject=0 时跳过（保留旧权重）
   *
   * @param store 反馈存储
   * @returns 学习结果统计
   */
  learnFromFeedback(store: FeedbackStore): LearningStats {
    if (!store || store.size() < LEARNING_MIN_FEEDBACKS) {
      return {
        patternsCount: this.weights.size,
        feedbacksUsed: this.lastFeedbacksUsed,
        minWeight: this.weights.size > 0 ? Math.min(...this.weights.values()) : DEFAULT_WEIGHT,
        maxWeight: this.weights.size > 0 ? Math.max(...this.weights.values()) : DEFAULT_WEIGHT,
      };
    }

    const all = store.getAllFeedback();
    const acceptCounts = new Map<string, number>();
    const rejectCounts = new Map<string, number>();

    for (const rec of all) {
      const key = getWeightKey(rec.category, rec.ruleId);
      if (rec.action === 'accept') {
        acceptCounts.set(key, (acceptCounts.get(key) ?? 0) + 1);
      } else if (rec.action === 'reject') {
        rejectCounts.set(key, (rejectCounts.get(key) ?? 0) + 1);
      }
    }

    const newWeights: LearnedWeights = new Map();
    const allKeys = new Set<string>([...acceptCounts.keys(), ...rejectCounts.keys()]);
    let minW = MAX_WEIGHT;
    let maxW = MIN_WEIGHT;
    for (const key of allKeys) {
      const a = acceptCounts.get(key) ?? 0;
      const r = rejectCounts.get(key) ?? 0;
      const total = a + r;
      if (total === 0) continue;
      const w = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, a / total));
      newWeights.set(key, w);
      if (w < minW) minW = w;
      if (w > maxW) maxW = w;
    }

    this.weights = newWeights;
    this.lastFeedbacksUsed = all.length;

    return {
      patternsCount: this.weights.size,
      feedbacksUsed: this.lastFeedbacksUsed,
      minWeight: this.weights.size > 0 ? minW : DEFAULT_WEIGHT,
      maxWeight: this.weights.size > 0 ? maxW : DEFAULT_WEIGHT,
    };
  }

  /**
   * 返回当前学习到的权重映射（副本，外部修改不影响内部状态）。
   */
  getLearnedWeights(): LearnedWeights {
    return new Map(this.weights);
  }

  /**
   * 查询某个键的权重，未学习时返回 DEFAULT_WEIGHT。
   */
  getWeight(category: string, ruleId?: string): number {
    const key = getWeightKey(category, ruleId);
    return this.weights.get(key) ?? DEFAULT_WEIGHT;
  }

  /**
   * 将学习到的权重应用到 findings，调整 confidence。
   *
   * 调整规则：
   * - 查询 finding 对应键的权重（优先 `category:ruleId`，缺失时退回 `category`）
   * - 新 confidence = clamp01(old confidence * weight)
   * - 未学习过的模式 weight=1.0，confidence 保持不变
   * - 不会修改原数组，返回新数组
   *
   * @param findings 待调整的 findings
   * @returns 调整后的 findings 新数组
   */
  applyLearnedWeights(findings: Finding[]): Finding[] {
    if (!findings || findings.length === 0) return [];
    return findings.map((f) => {
      const weight = this.lookupWeight(f);
      if (weight === DEFAULT_WEIGHT) return f;
      const newConfidence = clamp01(f.confidence * weight);
      return { ...f, confidence: newConfidence };
    });
  }

  /**
   * 查询 finding 对应的权重。
   * 优先 `category:ruleId`；若不存在则退回 `category`；都没有则返回 DEFAULT_WEIGHT。
   */
  private lookupWeight(finding: Finding): number {
    if (finding.ruleId) {
      const key = getWeightKey(finding.category, finding.ruleId);
      const w = this.weights.get(key);
      if (w !== undefined) return w;
    }
    const catKey = getWeightKey(finding.category);
    return this.weights.get(catKey) ?? DEFAULT_WEIGHT;
  }

  /** 清空已学习的权重 */
  clear(): void {
    this.weights.clear();
    this.lastFeedbacksUsed = 0;
  }

  /** 已学习的模式数 */
  size(): number {
    return this.weights.size;
  }
}

/** 将值 clamp 到 [0, 1] 范围 */
function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
