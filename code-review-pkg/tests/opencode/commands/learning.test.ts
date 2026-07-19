import { describe, it, expect, beforeEach } from 'vitest';
import {
  ContextLearner,
  getWeightKey,
  DEFAULT_WEIGHT,
  LEARNING_MIN_FEEDBACKS,
  MIN_WEIGHT,
  MAX_WEIGHT,
} from '../../../src/context-learner.js';
import { FeedbackStore, markFalsePositive } from '../../../src/feedback.js';
import type { Finding } from '../../../src/types.js';

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

// ==================== 常量 ====================

describe('context-learner 常量', () => {
  it('DEFAULT_WEIGHT = 1.0', () => {
    expect(DEFAULT_WEIGHT).toBe(1.0);
  });

  it('LEARNING_MIN_FEEDBACKS = 1', () => {
    expect(LEARNING_MIN_FEEDBACKS).toBe(1);
  });

  it('MIN_WEIGHT = 0.0', () => {
    expect(MIN_WEIGHT).toBe(0.0);
  });

  it('MAX_WEIGHT = 1.0', () => {
    expect(MAX_WEIGHT).toBe(1.0);
  });
});

// ==================== getWeightKey ====================

describe('getWeightKey', () => {
  it('有 ruleId 时返回 `category:ruleId`', () => {
    expect(getWeightKey('security', 'sql-injection')).toBe('security:sql-injection');
  });

  it('无 ruleId 时返回 category', () => {
    expect(getWeightKey('security')).toBe('security');
  });

  it('ruleId 为 undefined 时返回 category', () => {
    expect(getWeightKey('security', undefined)).toBe('security');
  });
});

// ==================== ContextLearner 类 ====================

describe('ContextLearner', () => {
  let learner: ContextLearner;
  let store: FeedbackStore;

  beforeEach(() => {
    learner = new ContextLearner();
    store = new FeedbackStore();
  });

  describe('初始状态', () => {
    it('初始 weights 为空', () => {
      expect(learner.getLearnedWeights().size).toBe(0);
    });

    it('初始 size = 0', () => {
      expect(learner.size()).toBe(0);
    });

    it('未学习过的模式 getWeight 返回 DEFAULT_WEIGHT', () => {
      expect(learner.getWeight('security', 'sql-injection')).toBe(DEFAULT_WEIGHT);
      expect(learner.getWeight('quality')).toBe(DEFAULT_WEIGHT);
    });
  });

  describe('learnFromFeedback', () => {
    it('store 为空时不更新权重', () => {
      const stats = learner.learnFromFeedback(store);
      expect(stats.patternsCount).toBe(0);
      expect(stats.feedbacksUsed).toBe(0);
    });

    it('仅 accept 反馈：权重为 1.0', () => {
      const finding = makeFinding({ ruleId: 'sql-injection' });
      store.recordFeedback('f1', 'accept', 'ok', finding);
      const stats = learner.learnFromFeedback(store);
      expect(stats.patternsCount).toBe(1);
      expect(stats.feedbacksUsed).toBe(1);
      const w = learner.getWeight('security', 'sql-injection');
      expect(w).toBeCloseTo(1.0, 5);
    });

    it('仅 reject 反馈：权重为 0', () => {
      const finding = makeFinding({ ruleId: 'sql-injection' });
      store.recordFeedback('f1', 'reject', '误报', finding);
      learner.learnFromFeedback(store);
      const w = learner.getWeight('security', 'sql-injection');
      expect(w).toBeCloseTo(0.0, 5);
    });

    it('accept+reject 各一半：权重为 0.5', () => {
      const finding = makeFinding({ ruleId: 'sql-injection' });
      store.recordFeedback('f1', 'accept', 'ok', finding);
      store.recordFeedback('f2', 'reject', '误报', finding);
      learner.learnFromFeedback(store);
      const w = learner.getWeight('security', 'sql-injection');
      expect(w).toBeCloseTo(0.5, 5);
    });

    it('3 accept + 1 reject：权重为 0.75', () => {
      const finding = makeFinding({ ruleId: 'sql-injection' });
      store.recordFeedback('f1', 'accept', 'ok', finding);
      store.recordFeedback('f2', 'accept', 'ok', finding);
      store.recordFeedback('f3', 'accept', 'ok', finding);
      store.recordFeedback('f4', 'reject', '误报', finding);
      learner.learnFromFeedback(store);
      const w = learner.getWeight('security', 'sql-injection');
      expect(w).toBeCloseTo(0.75, 5);
    });

    it('modify 反馈不参与学习', () => {
      const finding = makeFinding({ ruleId: 'sql-injection' });
      store.recordFeedback('f1', 'modify', '改', finding);
      const stats = learner.learnFromFeedback(store);
      // modify 反馈被记录但未产生权重
      expect(stats.patternsCount).toBe(0);
      expect(stats.feedbacksUsed).toBe(1);
    });

    it('不同 ruleId 分别产生独立权重', () => {
      const f1 = makeFinding({ ruleId: 'r1' });
      const f2 = makeFinding({ ruleId: 'r2' });
      // r1: 1 accept + 0 reject = 1.0
      store.recordFeedback('a1', 'accept', 'ok', f1);
      // r2: 0 accept + 1 reject = 0.0
      store.recordFeedback('r1', 'reject', 'no', f2);
      learner.learnFromFeedback(store);
      expect(learner.getWeight('security', 'r1')).toBeCloseTo(1.0, 5);
      expect(learner.getWeight('security', 'r2')).toBeCloseTo(0.0, 5);
    });

    it('无 ruleId 时按 category 聚合', () => {
      const f1 = makeFinding({ category: 'quality', ruleId: undefined });
      store.recordFeedback('a1', 'accept', 'ok', f1);
      store.recordFeedback('r1', 'reject', 'no', f1);
      learner.learnFromFeedback(store);
      // 仅按 category 查询
      expect(learner.getWeight('quality')).toBeCloseTo(0.5, 5);
    });

    it('多次调用 learnFromFeedback 覆盖旧权重', () => {
      const finding = makeFinding({ ruleId: 'r1' });
      store.recordFeedback('f1', 'accept', 'ok', finding);
      learner.learnFromFeedback(store);
      expect(learner.getWeight('security', 'r1')).toBeCloseTo(1.0, 5);

      // 再添加 2 个 reject
      store.recordFeedback('f2', 'reject', 'no', finding);
      store.recordFeedback('f3', 'reject', 'no', finding);
      learner.learnFromFeedback(store);
      // 现在 1 accept + 2 reject = 1/3
      expect(learner.getWeight('security', 'r1')).toBeCloseTo(1 / 3, 5);
    });

    it('学习结果统计返回最小/最大权重', () => {
      const f1 = makeFinding({ ruleId: 'r1' });
      const f2 = makeFinding({ ruleId: 'r2' });
      // r1: 全 reject -> 0
      store.recordFeedback('a1', 'reject', 'no', f1);
      // r2: 全 accept -> 1
      store.recordFeedback('a2', 'accept', 'ok', f2);
      const stats = learner.learnFromFeedback(store);
      expect(stats.minWeight).toBeCloseTo(0.0, 5);
      expect(stats.maxWeight).toBeCloseTo(1.0, 5);
    });
  });

  describe('getLearnedWeights', () => {
    it('返回副本，外部修改不影响内部状态', () => {
      const finding = makeFinding({ ruleId: 'r1' });
      store.recordFeedback('f1', 'accept', 'ok', finding);
      learner.learnFromFeedback(store);

      const weights = learner.getLearnedWeights();
      expect(weights.size).toBe(1);
      expect(weights.get('security:r1')).toBeCloseTo(1.0, 5);

      // 修改副本
      weights.set('hacked', 0.1);
      // 内部不应受影响
      expect(learner.getLearnedWeights().has('hacked')).toBe(false);
    });

    it('未学习时返回空 Map', () => {
      const weights = learner.getLearnedWeights();
      expect(weights.size).toBe(0);
    });
  });

  describe('applyLearnedWeights', () => {
    it('未学习时 findings 保持不变', () => {
      const findings = [makeFinding({ ruleId: 'r1', confidence: 0.8 })];
      const result = learner.applyLearnedWeights(findings);
      expect(result).toEqual(findings);
    });

    it('空数组返回空数组', () => {
      expect(learner.applyLearnedWeights([])).toEqual([]);
    });

    it('应用 reject 权重降低 confidence', () => {
      const finding = makeFinding({ ruleId: 'r1', confidence: 0.8 });
      store.recordFeedback('f1', 'reject', 'no', finding);
      learner.learnFromFeedback(store);
      // weight = 0
      const result = learner.applyLearnedWeights([finding]);
      expect(result[0].confidence).toBeCloseTo(0.0, 5);
    });

    it('应用 0.5 权重时 confidence 减半', () => {
      const finding = makeFinding({ ruleId: 'r1', confidence: 0.8 });
      store.recordFeedback('f1', 'accept', 'ok', finding);
      store.recordFeedback('f2', 'reject', 'no', finding);
      learner.learnFromFeedback(store);
      // weight = 0.5, 0.8 * 0.5 = 0.4
      const result = learner.applyLearnedWeights([finding]);
      expect(result[0].confidence).toBeCloseTo(0.4, 5);
    });

    it('应用 1.0 权重时 confidence 不变', () => {
      const finding = makeFinding({ ruleId: 'r1', confidence: 0.8 });
      store.recordFeedback('f1', 'accept', 'ok', finding);
      learner.learnFromFeedback(store);
      const result = learner.applyLearnedWeights([finding]);
      expect(result[0].confidence).toBeCloseTo(0.8, 5);
    });

    it('权重优先匹配 category:ruleId', () => {
      const finding = makeFinding({ ruleId: 'r1', confidence: 0.8 });
      // r1: 全 reject -> 0
      store.recordFeedback('f1', 'reject', 'no', finding);
      // category 单独: 全 accept -> 1.0
      const catFinding = makeFinding({ category: 'security', ruleId: undefined });
      store.recordFeedback('f2', 'accept', 'ok', catFinding);
      learner.learnFromFeedback(store);
      // 应优先匹配 category:ruleId -> weight=0
      const result = learner.applyLearnedWeights([finding]);
      expect(result[0].confidence).toBeCloseTo(0.0, 5);
    });

    it('没有 ruleId 时退回 category 权重', () => {
      const finding = makeFinding({ ruleId: undefined, confidence: 0.8 });
      // category 单独: 1 accept + 1 reject = 0.5
      store.recordFeedback('f1', 'accept', 'ok', finding);
      store.recordFeedback('f2', 'reject', 'no', finding);
      learner.learnFromFeedback(store);
      const result = learner.applyLearnedWeights([finding]);
      expect(result[0].confidence).toBeCloseTo(0.4, 5);
    });

    it('未学习过的模式 confidence 不变', () => {
      const finding1 = makeFinding({ ruleId: 'r1', confidence: 0.8 });
      const finding2 = makeFinding({ ruleId: 'r2', confidence: 0.6 });
      // 仅学习 r1
      store.recordFeedback('f1', 'reject', 'no', finding1);
      learner.learnFromFeedback(store);
      const result = learner.applyLearnedWeights([finding1, finding2]);
      expect(result[0].confidence).toBeCloseTo(0.0, 5);
      expect(result[1].confidence).toBeCloseTo(0.6, 5);
    });

    it('不修改原数组', () => {
      const finding = makeFinding({ ruleId: 'r1', confidence: 0.8 });
      store.recordFeedback('f1', 'reject', 'no', finding);
      learner.learnFromFeedback(store);
      const original = [finding];
      learner.applyLearnedWeights(original);
      // 原 finding 对象的 confidence 不应被修改
      expect(original[0].confidence).toBeCloseTo(0.8, 5);
    });

    it('confidence 超过 1 时被 clamp 到 1', () => {
      // 构造一个权重 < 1.0 的场景触发 clamp01 路径，confidence = 1.5 应被 clamp
      const finding = makeFinding({ ruleId: 'r1', confidence: 1.5 });
      // 1 accept + 1 reject = weight 0.5
      store.recordFeedback('f1', 'accept', 'ok', finding);
      store.recordFeedback('f2', 'reject', 'no', finding);
      learner.learnFromFeedback(store);
      const result = learner.applyLearnedWeights([finding]);
      // 1.5 * 0.5 = 0.75，且被 clamp 到 [0,1]
      expect(result[0].confidence).toBeLessThanOrEqual(1.0);
      expect(result[0].confidence).toBeGreaterThanOrEqual(0.0);
    });

    it('批量应用权重到多个 findings', () => {
      const f1 = makeFinding({ ruleId: 'r1', confidence: 0.8 });
      const f2 = makeFinding({ ruleId: 'r2', confidence: 0.6 });
      const f3 = makeFinding({ ruleId: 'r3', confidence: 0.4 });
      store.recordFeedback('a1', 'accept', 'ok', f1);
      store.recordFeedback('a2', 'reject', 'no', f2);
      store.recordFeedback('a3', 'accept', 'ok', f3);
      store.recordFeedback('a4', 'reject', 'no', f3);
      learner.learnFromFeedback(store);
      // r1: 1.0, r2: 0.0, r3: 0.5
      const result = learner.applyLearnedWeights([f1, f2, f3]);
      expect(result[0].confidence).toBeCloseTo(0.8, 5);
      expect(result[1].confidence).toBeCloseTo(0.0, 5);
      expect(result[2].confidence).toBeCloseTo(0.2, 5);
    });
  });

  describe('clear', () => {
    it('清空已学习的权重', () => {
      const finding = makeFinding({ ruleId: 'r1' });
      store.recordFeedback('f1', 'accept', 'ok', finding);
      learner.learnFromFeedback(store);
      expect(learner.size()).toBe(1);

      learner.clear();
      expect(learner.size()).toBe(0);
      expect(learner.getWeight('security', 'r1')).toBe(DEFAULT_WEIGHT);
    });
  });
});

// ==================== markFalsePositive 集成学习器 ====================

describe('markFalsePositive 与 ContextLearner 集成', () => {
  let store: FeedbackStore;
  let learner: ContextLearner;

  beforeEach(() => {
    store = new FeedbackStore();
    learner = new ContextLearner();
  });

  it('传入 learner 时触发学习', () => {
    const finding = makeFinding({ ruleId: 'sql-injection' });
    markFalsePositive(store, 'f1', finding, '误报', learner);
    // 学习器应已更新
    expect(learner.size()).toBe(1);
    expect(learner.getWeight('security', 'sql-injection')).toBeCloseTo(0.0, 5);
  });

  it('不传 learner 时不报错', () => {
    const finding = makeFinding({ ruleId: 'sql-injection' });
    expect(() => markFalsePositive(store, 'f1', finding, '误报')).not.toThrow();
  });

  it('多次标记误报后学习器持续更新', () => {
    const finding1 = makeFinding({ ruleId: 'r1' });
    const finding2 = makeFinding({ ruleId: 'r1' });
    markFalsePositive(store, 'f1', finding1, '误报1', learner);
    // 第一次：1 reject = weight 0
    expect(learner.getWeight('security', 'r1')).toBeCloseTo(0.0, 5);

    // 加一个 accept
    store.recordFeedback('f2', 'accept', 'ok', finding2);
    learner.learnFromFeedback(store);
    // 现在 1 accept + 1 reject = 0.5
    expect(learner.getWeight('security', 'r1')).toBeCloseTo(0.5, 5);
  });

  it('标记误报后应用学习器能降低同类 finding 的 confidence', () => {
    const finding = makeFinding({ ruleId: 'sql-injection', confidence: 0.9 });
    markFalsePositive(store, 'f1', finding, '误报', learner);

    // 新的同类 finding
    const newFinding = makeFinding({ ruleId: 'sql-injection', confidence: 0.9 });
    const result = learner.applyLearnedWeights([newFinding]);
    // weight=0 -> confidence=0
    expect(result[0].confidence).toBeCloseTo(0.0, 5);
  });
});
