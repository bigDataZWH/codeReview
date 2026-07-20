import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ModelRouter,
  classifyComplexity,
  getComplexityLevel,
  DEFAULT_MODEL_MAP,
  SMALL_COMPLEXITY_THRESHOLD,
  MEDIUM_COMPLEXITY_THRESHOLD,
  HIGH_RISK_CATEGORIES,
  MAX_COMPLEXITY_SCORE,
} from '../../../src/model-router.js';
import {
  reflectFindingsWithRouter,
  DEFAULT_REFLECTION_THRESHOLD,
} from '../../../src/ai-reflection.js';
import type { Finding } from '../../../src/types.js';

function makeFinding(partial: Partial<Finding> = {}): Finding {
  return {
    file: 'src/index.ts',
    line: 10,
    severity: 'low',
    category: 'quality',
    message: 'test finding',
    confidence: 0.8,
    source: 'rule',
    ...partial,
  };
}

/** 构造 OpenAI 协议格式的 fetch mock 响应 */
function makeOpenAIResponse(content: string): Response {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        choices: [{ message: { content } }],
      }),
  } as Response;
}

// ==================== 常量 ====================

describe('model-router 常量', () => {
  it('DEFAULT_MODEL_MAP 包含 small/medium/large', () => {
    expect(DEFAULT_MODEL_MAP.small).toBeDefined();
    expect(DEFAULT_MODEL_MAP.medium).toBeDefined();
    expect(DEFAULT_MODEL_MAP.large).toBeDefined();
    expect(typeof DEFAULT_MODEL_MAP.small).toBe('string');
  });

  it('SMALL_COMPLEXITY_THRESHOLD < MEDIUM_COMPLEXITY_THRESHOLD', () => {
    expect(SMALL_COMPLEXITY_THRESHOLD).toBeLessThan(MEDIUM_COMPLEXITY_THRESHOLD);
  });

  it('HIGH_RISK_CATEGORIES 包含 security', () => {
    expect(HIGH_RISK_CATEGORIES.has('security')).toBe(true);
    expect(HIGH_RISK_CATEGORIES.has('memory-safety')).toBe(true);
    expect(HIGH_RISK_CATEGORIES.has('concurrency')).toBe(true);
  });

  it('MAX_COMPLEXITY_SCORE = 100', () => {
    expect(MAX_COMPLEXITY_SCORE).toBe(100);
  });
});

// ==================== classifyComplexity ====================

describe('classifyComplexity', () => {
  it('low severity 普通类别得 5 分', () => {
    const f = makeFinding({ severity: 'low', category: 'quality' });
    expect(classifyComplexity(f)).toBe(5);
  });

  it('critical severity 得 30 分', () => {
    const f = makeFinding({ severity: 'critical', category: 'quality' });
    expect(classifyComplexity(f)).toBe(30);
  });

  it('high severity 得 20 分', () => {
    const f = makeFinding({ severity: 'high', category: 'quality' });
    expect(classifyComplexity(f)).toBe(20);
  });

  it('medium severity 得 10 分', () => {
    const f = makeFinding({ severity: 'medium', category: 'quality' });
    expect(classifyComplexity(f)).toBe(10);
  });

  it('info severity 得 0 分', () => {
    const f = makeFinding({ severity: 'info', category: 'quality' });
    expect(classifyComplexity(f)).toBe(0);
  });

  it('高风险类别加 20 分', () => {
    const f = makeFinding({ severity: 'low', category: 'security' });
    // low(5) + security(20) = 25
    expect(classifyComplexity(f)).toBe(25);
  });

  it('长消息加 10 分', () => {
    const longMessage = 'x'.repeat(201);
    const f = makeFinding({ severity: 'low', category: 'quality', message: longMessage });
    // low(5) + longMessage(10) = 15
    expect(classifyComplexity(f)).toBe(15);
  });

  it('长建议加 5 分', () => {
    const longSuggestion = 'x'.repeat(201);
    const f = makeFinding({ severity: 'low', category: 'quality', suggestion: longSuggestion });
    // low(5) + longSuggestion(5) = 10
    expect(classifyComplexity(f)).toBe(10);
  });

  it('低置信度加 10 分', () => {
    const f = makeFinding({ severity: 'low', category: 'quality', confidence: 0.3 });
    // low(5) + lowConfidence(10) = 15
    expect(classifyComplexity(f)).toBe(15);
  });

  it('所有维度叠加不超过 100', () => {
    const f = makeFinding({
      severity: 'critical',
      category: 'security',
      message: 'x'.repeat(300),
      suggestion: 'y'.repeat(300),
      confidence: 0.1,
    });
    // 30 + 20 + 10 + 5 + 10 = 75
    expect(classifyComplexity(f)).toBe(75);
  });

  it('评分被 clamp 到 [0, 100]', () => {
    const f = makeFinding({ severity: 'critical', category: 'security' });
    expect(classifyComplexity(f)).toBeGreaterThanOrEqual(0);
    expect(classifyComplexity(f)).toBeLessThanOrEqual(100);
  });
});

// ==================== getComplexityLevel ====================

describe('getComplexityLevel', () => {
  it('score < 30 → low', () => {
    expect(getComplexityLevel(0)).toBe('low');
    expect(getComplexityLevel(29)).toBe('low');
  });

  it('30 <= score < 70 → medium', () => {
    expect(getComplexityLevel(30)).toBe('medium');
    expect(getComplexityLevel(69)).toBe('medium');
  });

  it('score >= 70 → high', () => {
    expect(getComplexityLevel(70)).toBe('high');
    expect(getComplexityLevel(100)).toBe('high');
  });
});

// ==================== ModelRouter 类 ====================

describe('ModelRouter', () => {
  let router: ModelRouter;

  beforeEach(() => {
    router = new ModelRouter();
  });

  describe('构造器', () => {
    it('默认构造器使用 DEFAULT_MODEL_MAP', () => {
      const models = router.getModels();
      expect(models.small).toBe(DEFAULT_MODEL_MAP.small);
      expect(models.medium).toBe(DEFAULT_MODEL_MAP.medium);
      expect(models.large).toBe(DEFAULT_MODEL_MAP.large);
    });

    it('自定义模型名映射', () => {
      const r = new ModelRouter({
        models: { small: 'custom-small', large: 'custom-large' },
      });
      const models = r.getModels();
      expect(models.small).toBe('custom-small');
      expect(models.large).toBe('custom-large');
      // 未覆盖的仍用默认值
      expect(models.medium).toBe(DEFAULT_MODEL_MAP.medium);
    });

    it('自定义复杂度阈值', () => {
      const r = new ModelRouter({ smallThreshold: 20, mediumThreshold: 50 });
      const lowFinding = makeFinding({ severity: 'low', category: 'quality' });
      // score=5, 5 < 20 → low → small
      const result = r.routeByComplexity(lowFinding);
      expect(result.size).toBe('small');
    });
  });

  describe('routeByComplexity', () => {
    it('低复杂度 finding 路由到 small 模型', () => {
      const f = makeFinding({ severity: 'low', category: 'quality' });
      const result = router.routeByComplexity(f);
      expect(result.size).toBe('small');
      expect(result.model).toBe(DEFAULT_MODEL_MAP.small);
      expect(result.complexityLevel).toBe('low');
      expect(result.complexityScore).toBe(5);
      expect(result.reason).toContain('complexity score');
    });

    it('中复杂度 finding 路由到 medium 模型', () => {
      // critical(30) + lowConfidence(10) = 40, 30 <= 40 < 70 → medium
      const f = makeFinding({
        severity: 'critical',
        category: 'quality',
        confidence: 0.3,
      });
      const result = router.routeByComplexity(f);
      expect(result.size).toBe('medium');
      expect(result.model).toBe(DEFAULT_MODEL_MAP.medium);
      expect(result.complexityLevel).toBe('medium');
    });

    it('高复杂度 finding 路由到 large 模型', () => {
      // critical(30) + security(20) + longMessage(10) + lowConfidence(10) = 70 → high
      const f = makeFinding({
        severity: 'critical',
        category: 'security',
        message: 'x'.repeat(300),
        confidence: 0.1,
      });
      const result = router.routeByComplexity(f);
      // security 类别强制 large
      expect(result.size).toBe('large');
      expect(result.model).toBe(DEFAULT_MODEL_MAP.large);
      expect(result.reason).toContain('forced large model');
    });

    it('security 类别强制 large 模型', () => {
      // 即使 severity=low 也会升级到 large
      const f = makeFinding({ severity: 'low', category: 'security' });
      const result = router.routeByComplexity(f);
      expect(result.size).toBe('large');
      expect(result.model).toBe(DEFAULT_MODEL_MAP.large);
      expect(result.complexityLevel).toBe('high');
      expect(result.reason).toContain('high-risk category');
    });

    it('memory-safety 类别强制 large 模型', () => {
      const f = makeFinding({ severity: 'low', category: 'memory-safety' });
      const result = router.routeByComplexity(f);
      expect(result.size).toBe('large');
    });

    it('concurrency 类别强制 large 模型', () => {
      const f = makeFinding({ severity: 'low', category: 'concurrency' });
      const result = router.routeByComplexity(f);
      expect(result.size).toBe('large');
    });

    it('thread-safety 类别强制 large 模型', () => {
      const f = makeFinding({ severity: 'low', category: 'thread-safety' });
      const result = router.routeByComplexity(f);
      expect(result.size).toBe('large');
    });

    it('auth 类别强制 large 模型', () => {
      const f = makeFinding({ severity: 'low', category: 'auth' });
      const result = router.routeByComplexity(f);
      expect(result.size).toBe('large');
    });

    it('RoutingResult 包含完整字段', () => {
      const f = makeFinding({ severity: 'low', category: 'quality' });
      const result = router.routeByComplexity(f);
      expect(result).toHaveProperty('model');
      expect(result).toHaveProperty('size');
      expect(result).toHaveProperty('complexityScore');
      expect(result).toHaveProperty('complexityLevel');
      expect(result).toHaveProperty('reason');
    });
  });

  describe('历史记录', () => {
    it('getHistory 返回路由历史', () => {
      const f1 = makeFinding({ severity: 'low', category: 'quality' });
      const f2 = makeFinding({ severity: 'critical', category: 'security' });
      router.routeByComplexity(f1);
      router.routeByComplexity(f2);
      const history = router.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].size).toBe('small');
      expect(history[1].size).toBe('large');
    });

    it('clearHistory 清空历史', () => {
      const f = makeFinding({ severity: 'low', category: 'quality' });
      router.routeByComplexity(f);
      expect(router.getHistory()).toHaveLength(1);
      router.clearHistory();
      expect(router.getHistory()).toHaveLength(0);
    });

    it('历史记录超过上限时移除最旧的', () => {
      const r = new ModelRouter({ historyLimit: 3 });
      for (let i = 0; i < 5; i++) {
        r.routeByComplexity(makeFinding({ severity: 'low', category: 'quality' }));
      }
      const history = r.getHistory();
      expect(history).toHaveLength(3);
    });

    it('getHistory 返回副本', () => {
      const f = makeFinding({ severity: 'low', category: 'quality' });
      router.routeByComplexity(f);
      const h1 = router.getHistory();
      h1.pop();
      const h2 = router.getHistory();
      expect(h2).toHaveLength(1);
    });
  });

  describe('getModels', () => {
    it('返回副本，外部修改不影响内部状态', () => {
      const models = router.getModels();
      models.small = 'hacked';
      const models2 = router.getModels();
      expect(models2.small).not.toBe('hacked');
    });
  });
});

// ==================== reflectFindingsWithRouter 集成测试 ====================

describe('reflectFindingsWithRouter', () => {
  let router: ModelRouter;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    router = new ModelRouter();
  });

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
  });

  it('空 findings 返回空结果', async () => {
    const result = await reflectFindingsWithRouter([], router, {});
    expect(result.findings).toEqual([]);
    expect(result.routings).toEqual([]);
    expect(result.sizeCounts).toEqual({});
  });

  it('高风险类别强制使用 large 模型配置', async () => {
    const findings: Finding[] = [
      makeFinding({ severity: 'low', category: 'security', confidence: 0.9 }),
    ];
    const configMap = {
      small: { provider: 'openai', apiKey: 'small-key', model: 'gpt-4o-mini' },
      large: { provider: 'openai', apiKey: 'large-key', model: 'gpt-4o-turbo' },
    };

    const mockFetch = vi.fn().mockResolvedValue(
      makeOpenAIResponse(JSON.stringify([{ id: 0, confidence: 0.9 }])),
    );
    globalThis.fetch = mockFetch;

    const result = await reflectFindingsWithRouter(findings, router, configMap);

    expect(result.routings[0].size).toBe('large');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // 验证调用使用的是 large 模型（URL 中包含 /chat/completions，body 中 model 是 large）
    const opts = mockFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(opts.body as string);
    expect(body.model).toBe('gpt-4o-turbo');
    expect(result.findings).toHaveLength(1);
  });

  it('低复杂度 finding 使用 small 模型配置', async () => {
    const findings: Finding[] = [
      makeFinding({ severity: 'low', category: 'quality', confidence: 0.8 }),
    ];
    const configMap = {
      small: { provider: 'openai', apiKey: 'small-key', model: 'gpt-4o-mini' },
      large: { provider: 'openai', apiKey: 'large-key', model: 'gpt-4o-turbo' },
    };

    const mockFetch = vi.fn().mockResolvedValue(
      makeOpenAIResponse(JSON.stringify([{ id: 0, confidence: 0.9 }])),
    );
    globalThis.fetch = mockFetch;

    const result = await reflectFindingsWithRouter(findings, router, configMap);

    expect(result.routings[0].size).toBe('small');
    const opts = mockFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(opts.body as string);
    expect(body.model).toBe('gpt-4o-mini');
  });

  it('不同复杂度的 finding 路由到不同模型', async () => {
    const findings: Finding[] = [
      // low: 5 → small
      makeFinding({ severity: 'low', category: 'quality', confidence: 0.8 }),
      // high: security forced → large
      makeFinding({ severity: 'critical', category: 'security', confidence: 0.9 }),
    ];
    const configMap = {
      small: { provider: 'openai', apiKey: 'small-key', model: 'gpt-4o-mini' },
      medium: { provider: 'openai', apiKey: 'medium-key', model: 'gpt-4o' },
      large: { provider: 'openai', apiKey: 'large-key', model: 'gpt-4o-turbo' },
    };

    const mockFetch = vi.fn().mockResolvedValue(
      makeOpenAIResponse(JSON.stringify([
        { id: 0, confidence: 0.9 },
        { id: 1, confidence: 0.9 },
      ])),
    );
    globalThis.fetch = mockFetch;

    const result = await reflectFindingsWithRouter(findings, router, configMap);

    // 应分别路由到 small 和 large，触发 2 次 LLM 调用
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const models = mockFetch.mock.calls.map((c) => {
      const opts = c[1] as RequestInit;
      const body = JSON.parse(opts.body as string);
      return body.model;
    }).sort();
    expect(models).toEqual(['gpt-4o-mini', 'gpt-4o-turbo']);
    expect(result.sizeCounts).toEqual({ small: 1, large: 1 });
  });

  it('置信度低于阈值时过滤 finding', async () => {
    const findings: Finding[] = [
      makeFinding({ severity: 'low', category: 'quality', confidence: 0.8 }),
    ];
    const configMap = {
      small: { provider: 'openai', apiKey: 'small-key', model: 'gpt-4o-mini' },
    };
    // confidence < DEFAULT_REFLECTION_THRESHOLD (0.6)
    const mockFetch = vi.fn().mockResolvedValue(
      makeOpenAIResponse(JSON.stringify([{ id: 0, confidence: 0.3 }])),
    );
    globalThis.fetch = mockFetch;

    const result = await reflectFindingsWithRouter(findings, router, configMap);
    expect(result.findings).toHaveLength(0);
  });

  it('置信度等于阈值时保留 finding', async () => {
    const findings: Finding[] = [
      makeFinding({ severity: 'low', category: 'quality', confidence: 0.8 }),
    ];
    const configMap = {
      small: { provider: 'openai', apiKey: 'small-key', model: 'gpt-4o-mini' },
    };
    const mockFetch = vi.fn().mockResolvedValue(
      makeOpenAIResponse(JSON.stringify([{ id: 0, confidence: DEFAULT_REFLECTION_THRESHOLD }])),
    );
    globalThis.fetch = mockFetch;

    const result = await reflectFindingsWithRouter(findings, router, configMap);
    expect(result.findings).toHaveLength(1);
  });

  it('无该分级配置时降级为全保留', async () => {
    // finding 路由到 small，但 configMap 只有 large
    const findings: Finding[] = [
      makeFinding({ severity: 'low', category: 'quality', confidence: 0.8 }),
    ];
    const configMap = {
      large: { provider: 'openai', apiKey: 'large-key', model: 'gpt-4o-turbo' },
    };
    const mockFetch = vi.fn().mockResolvedValue(
      makeOpenAIResponse(JSON.stringify([{ id: 0, confidence: 0.9 }])),
    );
    globalThis.fetch = mockFetch;

    const result = await reflectFindingsWithRouter(findings, router, configMap);
    // 应该会向 large 降级（pickConfigForSize 中先尝试 small，找不到则尝试 large）
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const opts = mockFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(opts.body as string);
    expect(body.model).toBe('gpt-4o-turbo');
    expect(result.findings).toHaveLength(1);
  });

  it('所有配置都无效时全保留', async () => {
    const findings: Finding[] = [
      makeFinding({ severity: 'low', category: 'quality', confidence: 0.8 }),
    ];
    // configMap 中的配置都缺少 apiKey
    const configMap = {
      small: { provider: 'openai', model: 'gpt-4o-mini' },
    };
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    const result = await reflectFindingsWithRouter(findings, router, configMap);
    // 无有效配置 → 不调用 LLM → 全保留
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.findings).toHaveLength(1);
  });

  it('返回的 routings 顺序与输入一致', async () => {
    const findings: Finding[] = [
      makeFinding({ severity: 'low', category: 'quality', confidence: 0.8 }),
      makeFinding({ severity: 'critical', category: 'security', confidence: 0.9 }),
      makeFinding({ severity: 'medium', category: 'quality', confidence: 0.7 }),
    ];
    const configMap = {
      small: { provider: 'openai', apiKey: 'k', model: 'm' },
      large: { provider: 'openai', apiKey: 'k', model: 'm' },
    };
    const mockFetch = vi.fn().mockResolvedValue(
      makeOpenAIResponse(JSON.stringify([
        { id: 0, confidence: 0.9 },
        { id: 1, confidence: 0.9 },
        { id: 2, confidence: 0.9 },
      ])),
    );
    globalThis.fetch = mockFetch;

    const result = await reflectFindingsWithRouter(findings, router, configMap);
    expect(result.routings).toHaveLength(3);
    expect(result.routings[0].size).toBe('small'); // low quality
    expect(result.routings[1].size).toBe('large'); // critical security forced
    expect(result.routings[2].size).toBe('small'); // medium quality
  });

  it('minConfidence 自定义阈值', async () => {
    const findings: Finding[] = [
      makeFinding({ severity: 'low', category: 'quality', confidence: 0.8 }),
    ];
    const configMap = {
      small: { provider: 'openai', apiKey: 'k', model: 'm' },
    };
    // LLM 返回 0.5，使用 0.8 阈值 → 应过滤掉
    const mockFetch = vi.fn().mockResolvedValue(
      makeOpenAIResponse(JSON.stringify([{ id: 0, confidence: 0.5 }])),
    );
    globalThis.fetch = mockFetch;

    const result = await reflectFindingsWithRouter(findings, router, configMap, 0.8);
    expect(result.findings).toHaveLength(0);
  });

  it('LLM 调用失败时该组全保留（降级策略）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const findings: Finding[] = [
      makeFinding({ severity: 'low', category: 'quality', confidence: 0.8 }),
    ];
    const configMap = {
      small: { provider: 'openai', apiKey: 'k', model: 'm' },
    };
    const mockFetch = vi.fn().mockRejectedValue(new Error('network error'));
    globalThis.fetch = mockFetch;

    const result = await reflectFindingsWithRouter(findings, router, configMap);
    expect(result.findings).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('多组 findings 分别使用各自模型', async () => {
    // 构造三组 finding：low quality / medium quality / critical security
    const findings: Finding[] = [
      // 1: low quality → small (score=5)
      makeFinding({ severity: 'low', category: 'quality', confidence: 0.8, message: 'f1' }),
      // 2: critical quality + lowConfidence → medium (score=40)
      makeFinding({ severity: 'critical', category: 'quality', confidence: 0.3, message: 'f2' }),
      // 3: critical security forced → large
      makeFinding({ severity: 'critical', category: 'security', confidence: 0.9, message: 'f3' }),
    ];
    const configMap = {
      small: { provider: 'openai', apiKey: 'k', model: 'gpt-4o-mini' },
      medium: { provider: 'openai', apiKey: 'k', model: 'gpt-4o' },
      large: { provider: 'openai', apiKey: 'k', model: 'gpt-4o-turbo' },
    };
    const mockFetch = vi.fn().mockResolvedValue(
      makeOpenAIResponse(JSON.stringify([{ id: 0, confidence: 0.9 }])),
    );
    globalThis.fetch = mockFetch;

    const result = await reflectFindingsWithRouter(findings, router, configMap);
    // 三组分别调用一次 LLM
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result.sizeCounts).toEqual({ small: 1, medium: 1, large: 1 });
    const usedModels = mockFetch.mock.calls.map((c) => {
      const opts = c[1] as RequestInit;
      const body = JSON.parse(opts.body as string);
      return body.model;
    }).sort();
    expect(usedModels).toEqual(['gpt-4o', 'gpt-4o-mini', 'gpt-4o-turbo']);
  });
});
