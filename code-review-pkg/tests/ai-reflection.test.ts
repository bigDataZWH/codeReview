import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildReflectionPrompt,
  buildBatchReflectionPrompt,
  parseReflectionResponse,
  reflectFindings,
  callLLM,
  reflectFindingsWithRouter,
  DEFAULT_REFLECTION_THRESHOLD,
} from '../src/ai-reflection.js';
import type { Finding, LLMProviderConfig } from '../src/types.js';
import { isLLMConfigValid } from '../src/types.js';
import { ModelRouter } from '../src/model-router.js';

// ---- 辅助函数 ----

function makeFinding(overrides: Partial<Finding> & { file: string; line: number }): Finding {
  return {
    severity: 'medium',
    category: 'security',
    message: 'test finding',
    confidence: 0.7,
    source: 'rule',
    ...overrides,
  };
}

const mockConfig: LLMProviderConfig = {
  provider: 'openai',
  apiKey: 'test-key',
  model: 'gpt-4o-mini',
};

// ==================== buildReflectionPrompt ====================
describe('buildReflectionPrompt', () => {
  it('生成 prompt — 包含 finding 详情和评估要求', () => {
    const finding = makeFinding({
      file: 'src/app.ts',
      line: 42,
      severity: 'high',
      category: 'security',
      message: 'SQL injection risk',
      suggestion: 'Use parameterized queries',
    });

    const prompt = buildReflectionPrompt(finding);

    expect(prompt).toContain('src/app.ts');
    expect(prompt).toContain('42');
    expect(prompt).toContain('high');
    expect(prompt).toContain('security');
    expect(prompt).toContain('SQL injection risk');
    expect(prompt).toContain('Use parameterized queries');
    expect(prompt).toContain('"confidence"');
    expect(prompt).toContain('true positive');
    expect(prompt).toContain('false positive');
  });

  it('空 findings — 返回空字符串', () => {
    // buildReflectionPrompt 接受单个 finding，但如果是 undefined/null 触发的边界
    // 实际上空 findings 场景在 buildBatchReflectionPrompt 中测试
    const prompt = buildBatchReflectionPrompt([]);
    expect(prompt).toBe('');
  });
});

// ==================== buildBatchReflectionPrompt ====================
describe('buildBatchReflectionPrompt', () => {
  it('批量 prompt — 多个 finding 的 prompt 中每个都有独立编号', () => {
    const findings: Finding[] = [
      makeFinding({ file: 'src/a.ts', line: 10, message: 'finding A' }),
      makeFinding({ file: 'src/b.ts', line: 20, message: 'finding B' }),
    ];

    const prompt = buildBatchReflectionPrompt(findings);

    // 应包含 finding 编号
    expect(prompt).toContain('Finding #0');
    expect(prompt).toContain('Finding #1');
    expect(prompt).toContain('src/a.ts');
    expect(prompt).toContain('src/b.ts');
    expect(prompt).toContain('finding A');
    expect(prompt).toContain('finding B');
    // 应要求返回数组
    expect(prompt).toContain('JSON array');
    expect(prompt).toContain('"id"');
    expect(prompt).toContain('"confidence"');
  });

  it('空 findings — 返回空字符串', () => {
    const prompt = buildBatchReflectionPrompt([]);
    expect(prompt).toBe('');
  });
});

// ==================== parseReflectionResponse ====================
describe('parseReflectionResponse', () => {
  it('有效 JSON 响应 — 解析出 confidence 值', () => {
    const response = '{"confidence": 0.85}';
    const result = parseReflectionResponse(response);
    expect(result).toBe(0.85);
  });

  it('无效 JSON — 返回默认值 0.5', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = 'this is not json';
    const result = parseReflectionResponse(response);
    expect(result).toBe(0.5);
    warnSpy.mockRestore();
  });

  it('无效 JSON 时记录 warn 日志（含 [ai-reflection] 前缀）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = parseReflectionResponse('this is not json');
    expect(result).toBe(0.5);
    expect(warnSpy).toHaveBeenCalled();
    const allCalls = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(allCalls.some((s) => s.includes('[ai-reflection]'))).toBe(true);
    warnSpy.mockRestore();
  });

  it('confidence 超出范围 — clamp 到 [0, 1]', () => {
    const responseHigh = '{"confidence": 1.5}';
    expect(parseReflectionResponse(responseHigh)).toBe(1.0);

    const responseLow = '{"confidence": -0.3}';
    expect(parseReflectionResponse(responseLow)).toBe(0.0);
  });

  it('缺失 confidence 字段 — 返回默认值 0.5', () => {
    const response = '{"score": 0.8}';
    const result = parseReflectionResponse(response);
    expect(result).toBe(0.5);
  });

  it('批量响应 — 解析多个 finding 的结果', () => {
    const response = JSON.stringify([
      { id: 0, confidence: 0.9 },
      { id: 1, confidence: 0.3 },
      { id: 2, confidence: 0.7 },
    ]);

    expect(parseReflectionResponse(response, 0)).toBe(0.9);
    expect(parseReflectionResponse(response, 1)).toBe(0.3);
    expect(parseReflectionResponse(response, 2)).toBe(0.7);
  });

  it('批量响应中 index 超出范围 — 返回默认值 0.5', () => {
    const response = JSON.stringify([
      { id: 0, confidence: 0.9 },
    ]);

    expect(parseReflectionResponse(response, 5)).toBe(0.5);
  });

  it('空字符串 — 返回默认值 0.5', () => {
    expect(parseReflectionResponse('')).toBe(0.5);
  });
});

// ==================== reflectFindings ====================
describe('reflectFindings', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
  });

  it('单个 finding — mock fetch，验证调用 LLM 并过滤', async () => {
    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 10, message: 'test issue' }),
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: '{"confidence": 0.9}' } }],
        }),
    });

    globalThis.fetch = mockFetch;

    const result = await reflectFindings(findings, mockConfig, 0.5);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('src/app.ts');
  });

  it('批量 findings — mock fetch，验证批量 prompt', async () => {
    const findings: Finding[] = [
      makeFinding({ file: 'src/a.ts', line: 1, message: 'issue A' }),
      makeFinding({ file: 'src/b.ts', line: 2, message: 'issue B' }),
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: JSON.stringify([{ id: 0, confidence: 0.8 }, { id: 1, confidence: 0.6 }]) } }],
        }),
    });

    globalThis.fetch = mockFetch;

    const result = await reflectFindings(findings, mockConfig, 0.5);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    // 验证发送了批量 prompt（包含多个 finding 编号）
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.messages[0].content).toContain('Finding #0');
    expect(callBody.messages[0].content).toContain('Finding #1');
    expect(result).toHaveLength(2);
  });

  it('高置信度保留 — confidence=0.9 的 finding 保留', async () => {
    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 10, message: 'important issue' }),
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: '{"confidence": 0.9}' } }],
        }),
    });

    globalThis.fetch = mockFetch;

    const result = await reflectFindings(findings, mockConfig, 0.5);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('src/app.ts');
  });

  it('低置信度过滤 — confidence=0.3 的 finding 被过滤', async () => {
    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 10, message: 'likely false positive' }),
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: '{"confidence": 0.3}' } }],
        }),
    });

    globalThis.fetch = mockFetch;

    const result = await reflectFindings(findings, mockConfig, 0.5);
    expect(result).toHaveLength(0);
  });

  it('LLM 不可用 — fetch 抛错时，所有 finding 保留（降级策略）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 10, message: 'issue 1' }),
      makeFinding({ file: 'src/b.ts', line: 20, message: 'issue 2' }),
    ];

    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

    globalThis.fetch = mockFetch;

    const result = await reflectFindings(findings, mockConfig, 0.5);

    // 降级策略：LLM 不可用时保留所有 finding
    expect(result).toHaveLength(2);
    expect(result[0].file).toBe('src/app.ts');
    expect(result[1].file).toBe('src/b.ts');
    warnSpy.mockRestore();
  });

  it('LLM 不可用时记录 warn 日志（含 [ai-reflection] 前缀）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 10, message: 'issue 1' }),
    ];

    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    globalThis.fetch = mockFetch;

    await reflectFindings(findings, mockConfig, 0.5);

    expect(warnSpy).toHaveBeenCalled();
    const allCalls = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(allCalls.some((s) => s.includes('[ai-reflection]'))).toBe(true);
    warnSpy.mockRestore();
  });

  it('模型未配置 — config 为空对象时，所有 finding 保留且不调用 fetch', async () => {
    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 10, message: 'issue 1' }),
      makeFinding({ file: 'src/b.ts', line: 20, message: 'issue 2' }),
    ];

    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    const result = await reflectFindings(findings, {} as LLMProviderConfig, 0.5);

    expect(result).toHaveLength(2);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('模型未配置 — 缺少 model 时降级保留所有 finding', async () => {
    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 10, message: 'issue 1' }),
    ];

    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    const partialConfig: Partial<LLMProviderConfig> = { provider: 'openai', apiKey: 'key' };
    const result = await reflectFindings(findings, partialConfig as LLMProviderConfig, 0.5);

    expect(result).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('模型未配置 — config 为 undefined 时降级保留所有 finding', async () => {
    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 10, message: 'issue 1' }),
    ];

    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    const result = await reflectFindings(findings, undefined as unknown as LLMProviderConfig, 0.5);

    expect(result).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('空 findings — 直接返回空数组', async () => {
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    const result = await reflectFindings([], mockConfig, 0.5);

    expect(result).toHaveLength(0);
    // 不应调用 LLM
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('阈值可配置 — minConfidence 参数控制过滤阈值', async () => {
    const findings: Finding[] = [
      makeFinding({ file: 'src/a.ts', line: 1, message: 'issue A' }),
      makeFinding({ file: 'src/b.ts', line: 2, message: 'issue B' }),
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{
            message: {
              content: JSON.stringify([
                { id: 0, confidence: 0.6 },
                { id: 1, confidence: 0.4 },
              ]),
            },
          }],
        }),
    });

    globalThis.fetch = mockFetch;

    // 阈值 0.7 — 两个都应该被过滤
    const resultHigh = await reflectFindings(findings, mockConfig, 0.7);
    expect(resultHigh).toHaveLength(0);

    // 重置 mock
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{
            message: {
              content: JSON.stringify([
                { id: 0, confidence: 0.6 },
                { id: 1, confidence: 0.4 },
              ]),
            },
          }],
        }),
    });

    // 阈值 0.5 — 只有 issue A 保留
    const resultLow = await reflectFindings(findings, mockConfig, 0.5);
    expect(resultLow).toHaveLength(1);
    expect(resultLow[0].file).toBe('src/a.ts');
  });

  it('Anthropic 协议 — 使用正确的 endpoint 和 headers', async () => {
    const anthropicConfig: LLMProviderConfig = {
      provider: 'anthropic',
      apiKey: 'anthropic-key',
      model: 'claude-3-haiku-20240307',
    };

    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 10, message: 'test' }),
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: 'text', text: '{"confidence": 0.8}' }],
        }),
    });

    globalThis.fetch = mockFetch;

    const result = await reflectFindings(findings, anthropicConfig, 0.5);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('anthropic.com');
    expect(options.headers['x-api-key']).toBe('anthropic-key');
    expect(options.headers['anthropic-version']).toBe('2023-06-01');
    expect(result).toHaveLength(1);
  });

  it('Google 协议 — 使用正确的 endpoint', async () => {
    const googleConfig: LLMProviderConfig = {
      provider: 'google',
      apiKey: 'google-key',
      model: 'gemini-1.5-flash',
    };

    const findings: Finding[] = [
      makeFinding({ file: 'src/app.ts', line: 10, message: 'test' }),
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [{ content: { parts: [{ text: '{"confidence": 0.7}' }] } }],
        }),
    });

    globalThis.fetch = mockFetch;

    const result = await reflectFindings(findings, googleConfig, 0.5);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('gemini-1.5-flash');
    expect(result).toHaveLength(1);
  });
});

// ==================== callLLM ====================
describe('callLLM', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
  });

  it('配置为空 — 抛出错误', async () => {
    await expect(callLLM('test prompt', {} as LLMProviderConfig)).rejects.toThrow(
      'LLM config is invalid',
    );
  });

  it('缺少 model — 抛出错误', async () => {
    const partialConfig: Partial<LLMProviderConfig> = { provider: 'openai', apiKey: 'key' };
    await expect(callLLM('test prompt', partialConfig as LLMProviderConfig)).rejects.toThrow(
      'LLM config is invalid',
    );
  });

  it('缺少 apiKey — 抛出错误', async () => {
    const partialConfig: Partial<LLMProviderConfig> = { provider: 'openai', model: 'gpt-4' };
    await expect(callLLM('test prompt', partialConfig as LLMProviderConfig)).rejects.toThrow(
      'LLM config is invalid',
    );
  });

  it('缺少 provider — 抛出错误', async () => {
    const partialConfig: Partial<LLMProviderConfig> = { apiKey: 'key', model: 'gpt-4' };
    await expect(callLLM('test prompt', partialConfig as LLMProviderConfig)).rejects.toThrow(
      'LLM config is invalid',
    );
  });
});

// ==================== isLLMConfigValid ====================
describe('isLLMConfigValid', () => {
  it('完整配置 — 返回 true', () => {
    expect(isLLMConfigValid({ provider: 'openai', apiKey: 'key', model: 'gpt-4' })).toBe(true);
  });

  it('空对象 — 返回 false', () => {
    expect(isLLMConfigValid({})).toBe(false);
  });

  it('undefined — 返回 false', () => {
    expect(isLLMConfigValid(undefined)).toBe(false);
  });

  it('null — 返回 false', () => {
    expect(isLLMConfigValid(null)).toBe(false);
  });

  it('缺少 model — 返回 false', () => {
    expect(isLLMConfigValid({ provider: 'openai', apiKey: 'key' })).toBe(false);
  });

  it('缺少 apiKey — 返回 false', () => {
    expect(isLLMConfigValid({ provider: 'openai', model: 'gpt-4' })).toBe(false);
  });

  it('缺少 provider — 返回 false', () => {
    expect(isLLMConfigValid({ apiKey: 'key', model: 'gpt-4' })).toBe(false);
  });

  it('空字符串 model — 返回 false', () => {
    expect(isLLMConfigValid({ provider: 'openai', apiKey: 'key', model: '' })).toBe(false);
  });
});

// ==================== 新增：parseReflectionResponse 边界情况 ====================
describe('parseReflectionResponse 边界情况', () => {
  it('仅含空白字符的响应 — 返回默认值 0.5', () => {
    expect(parseReflectionResponse('   ')).toBe(0.5);
    expect(parseReflectionResponse('\t\n  \n')).toBe(0.5);
  });

  it('批量响应中 item 为 null — 返回默认值 0.5', () => {
    const response = JSON.stringify([null, { id: 1, confidence: 0.8 }]);
    expect(parseReflectionResponse(response, 0)).toBe(0.5);
    expect(parseReflectionResponse(response, 1)).toBe(0.8);
  });

  it('批量响应中 item 为 undefined — 返回默认值 0.5', () => {
    const response = JSON.stringify([undefined, { id: 1, confidence: 0.7 }]);
    expect(parseReflectionResponse(response, 0)).toBe(0.5);
    expect(parseReflectionResponse(response, 1)).toBe(0.7);
  });

  it('批量响应中 item 缺少 confidence 字段 — 返回默认值 0.5', () => {
    const response = JSON.stringify([{ id: 0 }, { id: 1, confidence: 0.6 }]);
    expect(parseReflectionResponse(response, 0)).toBe(0.5);
    expect(parseReflectionResponse(response, 1)).toBe(0.6);
  });

  it('index 为负数 — 返回默认值 0.5', () => {
    const response = JSON.stringify([{ id: 0, confidence: 0.9 }]);
    expect(parseReflectionResponse(response, -1)).toBe(0.5);
    expect(parseReflectionResponse(response, -100)).toBe(0.5);
  });

  it('confidence 恰好为 0 — clamp 后为 0', () => {
    expect(parseReflectionResponse('{"confidence": 0}')).toBe(0);
  });

  it('confidence 恰好为 1 — clamp 后为 1', () => {
    expect(parseReflectionResponse('{"confidence": 1}')).toBe(1);
  });

  it('JSON 解析结果为数字 — 返回默认值 0.5', () => {
    expect(parseReflectionResponse('42')).toBe(0.5);
  });

  it('JSON 解析结果为字符串 — 返回默认值 0.5', () => {
    expect(parseReflectionResponse('"hello"')).toBe(0.5);
  });

  it('JSON 解析结果为布尔值 — 返回默认值 0.5', () => {
    expect(parseReflectionResponse('true')).toBe(0.5);
    expect(parseReflectionResponse('false')).toBe(0.5);
  });

  it('JSON 解析结果为 null — 返回默认值 0.5', () => {
    expect(parseReflectionResponse('null')).toBe(0.5);
  });

  it('批量响应中 confidence 为字符串类型 — 返回默认值 0.5', () => {
    const response = JSON.stringify([{ id: 0, confidence: '0.8' }]);
    expect(parseReflectionResponse(response, 0)).toBe(0.5);
  });
});

// ==================== 新增：buildReflectionPrompt 边界情况 ====================
describe('buildReflectionPrompt 边界情况', () => {
  it('suggestion 为空字符串 — 显示 N/A', () => {
    const finding = makeFinding({
      file: 'src/app.ts',
      line: 10,
      suggestion: '',
    });
    const prompt = buildReflectionPrompt(finding);
    expect(prompt).toContain('Suggestion: N/A');
  });

  it('suggestion 为 undefined — 显示 N/A', () => {
    const finding = makeFinding({
      file: 'src/app.ts',
      line: 10,
    });
    delete (finding as Partial<Finding>).suggestion;
    const prompt = buildReflectionPrompt(finding);
    expect(prompt).toContain('Suggestion: N/A');
  });

  it('包含所有 finding 字段 — 验证格式一致性', () => {
    const finding = makeFinding({
      file: 'src/test.ts',
      line: 100,
      severity: 'critical',
      category: 'performance',
      message: 'slow loop detected',
      suggestion: 'use map instead',
    });
    const prompt = buildReflectionPrompt(finding);
    expect(prompt).toContain('File: src/test.ts');
    expect(prompt).toContain('Line: 100');
    expect(prompt).toContain('Severity: critical');
    expect(prompt).toContain('Category: performance');
    expect(prompt).toContain('Message: slow loop detected');
    expect(prompt).toContain('Suggestion: use map instead');
  });
});

// ==================== 新增：buildBatchReflectionPrompt 边界情况 ====================
describe('buildBatchReflectionPrompt 边界情况', () => {
  it('单个 finding — 生成正确的批量 prompt', () => {
    const findings = [makeFinding({ file: 'src/a.ts', line: 1, message: 'only one' })];
    const prompt = buildBatchReflectionPrompt(findings);
    expect(prompt).toContain('Finding #0');
    expect(prompt).toContain('JSON array');
    expect(prompt).toContain('only one');
  });

  it('suggestion 为 undefined 时批量 prompt 显示 N/A', () => {
    const finding = makeFinding({ file: 'src/a.ts', line: 1 });
    delete (finding as Partial<Finding>).suggestion;
    const prompt = buildBatchReflectionPrompt([finding]);
    expect(prompt).toContain('Suggestion: N/A');
  });
});

// ==================== 新增：reflectFindings 边界情况 ====================
describe('reflectFindings 边界情况', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    vi.restoreAllMocks();
  });

  it('confidence 恰好等于阈值 — 保留（>= 比较）', async () => {
    const findings = [makeFinding({ file: 'src/app.ts', line: 10, message: 'exact threshold' })];
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"confidence": 0.5}' } }],
      }),
    });
    globalThis.fetch = mockFetch;

    const result = await reflectFindings(findings, mockConfig, 0.5);
    expect(result).toHaveLength(1);
  });

  it('使用默认阈值 DEFAULT_REFLECTION_THRESHOLD', async () => {
    const findings = [
      makeFinding({ file: 'src/a.ts', line: 1, message: 'high confidence' }),
    ];
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"confidence": 0.7}' } }],
      }),
    });
    globalThis.fetch = mockFetch;

    const result = await reflectFindings(findings, mockConfig);
    expect(result).toHaveLength(1);
    expect(DEFAULT_REFLECTION_THRESHOLD).toBe(0.6);
  });

  it('HTTP 错误响应 — 降级保留所有 finding', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const findings = [makeFinding({ file: 'src/app.ts', line: 10, message: 'test' })];
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    globalThis.fetch = mockFetch;

    const result = await reflectFindings(findings, mockConfig, 0.5);
    expect(result).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('自定义 baseURL — 使用指定的 baseURL', async () => {
    const customConfig: LLMProviderConfig = {
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4',
      baseURL: 'https://custom.example.com',
    };
    const findings = [makeFinding({ file: 'src/app.ts', line: 10, message: 'test' })];
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"confidence": 0.8}' } }],
      }),
    });
    globalThis.fetch = mockFetch;

    await reflectFindings(findings, customConfig, 0.5);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('custom.example.com');
    expect(url).toContain('/v1/chat/completions');
  });
});

// ==================== 新增：callLLM 边界情况 ====================
describe('callLLM 边界情况', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    vi.restoreAllMocks();
  });

  it('HTTP 401 错误 — 抛出包含状态码的错误', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });
    globalThis.fetch = mockFetch;

    await expect(callLLM('test', mockConfig)).rejects.toThrow('401');
    await expect(callLLM('test', mockConfig)).rejects.toThrow('Unauthorized');
  });

  it('自定义超时配置 — 验证超时参数存在', async () => {
    const configWithTimeout: LLMProviderConfig = {
      ...mockConfig,
      timeout: 5000,
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"confidence": 0.8}' } }],
      }),
    });
    globalThis.fetch = mockFetch;

    const result = await callLLM('test prompt', configWithTimeout);
    expect(result).toBe('{"confidence": 0.8}');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0];
    expect(options.signal).toBeDefined();
  });
});

// ==================== 新增：reflectFindingsWithRouter ====================
describe('reflectFindingsWithRouter', () => {
  const originalFetch = globalThis.fetch;
  let router: ModelRouter;

  beforeEach(() => {
    router = new ModelRouter();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    vi.restoreAllMocks();
  });

  const smallConfig: LLMProviderConfig = {
    provider: 'openai',
    apiKey: 'small-key',
    model: 'gpt-4o-mini',
  };
  const largeConfig: LLMProviderConfig = {
    provider: 'openai',
    apiKey: 'large-key',
    model: 'gpt-4o-turbo',
  };

  function makeLowRiskFinding(file: string, line: number): Finding {
    return makeFinding({
      file,
      line,
      severity: 'low',
      category: 'style',
      message: 'minor style issue',
      confidence: 0.9,
    });
  }

  function makeHighRiskFinding(file: string, line: number): Finding {
    return makeFinding({
      file,
      line,
      severity: 'critical',
      category: 'security',
      message: 'critical security vulnerability detected in authentication flow with potential data breach',
      confidence: 0.3,
    });
  }

  it('空 findings — 返回空结果', async () => {
    const result = await reflectFindingsWithRouter([], router, { small: smallConfig });
    expect(result.findings).toEqual([]);
    expect(result.routings).toEqual([]);
    expect(result.sizeCounts).toEqual({});
  });

  it('基本功能 — 按复杂度路由并过滤低置信度', async () => {
    const findings = [
      makeLowRiskFinding('src/a.ts', 10),
      makeHighRiskFinding('src/b.ts', 20),
    ];

    const mockFetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      if (body.model === 'gpt-4o-mini') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            choices: [{ message: { content: JSON.stringify([{ id: 0, confidence: 0.2 }]) } }],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: JSON.stringify([{ id: 0, confidence: 0.9 }]) } }],
        }),
      });
    });
    globalThis.fetch = mockFetch;

    const result = await reflectFindingsWithRouter(
      findings,
      router,
      { small: smallConfig, large: largeConfig },
      0.5,
    );

    expect(result.routings).toHaveLength(2);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].file).toBe('src/b.ts');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('保持原 findings 顺序', async () => {
    const findings = [
      makeHighRiskFinding('src/high1.ts', 1),
      makeLowRiskFinding('src/low1.ts', 2),
      makeHighRiskFinding('src/high2.ts', 3),
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify([{ id: 0, confidence: 0.9 }]) } }],
      }),
    });
    globalThis.fetch = mockFetch;

    const result = await reflectFindingsWithRouter(
      findings,
      router,
      { small: smallConfig, large: largeConfig },
      0.5,
    );

    expect(result.findings).toHaveLength(3);
    expect(result.findings[0].file).toBe('src/high1.ts');
    expect(result.findings[1].file).toBe('src/low1.ts');
    expect(result.findings[2].file).toBe('src/high2.ts');
  });

  it('sizeCounts 正确统计各分级数量', async () => {
    const findings = [
      makeLowRiskFinding('src/a.ts', 1),
      makeLowRiskFinding('src/b.ts', 2),
      makeHighRiskFinding('src/c.ts', 3),
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify([{ id: 0, confidence: 0.8 }]) } }],
      }),
    });
    globalThis.fetch = mockFetch;

    const result = await reflectFindingsWithRouter(
      findings,
      router,
      { small: smallConfig, large: largeConfig },
      0.5,
    );

    expect(result.sizeCounts.small).toBe(2);
    expect(result.sizeCounts.large).toBe(1);
  });

  it('无有效 LLM 配置 — 所有 finding 保留（降级）', async () => {
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    const findings = [
      makeLowRiskFinding('src/a.ts', 1),
      makeHighRiskFinding('src/b.ts', 2),
    ];

    const result = await reflectFindingsWithRouter(findings, router, {}, 0.5);
    expect(result.findings).toHaveLength(2);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('部分分级无配置 — 向更高分级降级使用可用配置', async () => {
    const findings = [
      makeLowRiskFinding('src/low.ts', 1),
      makeHighRiskFinding('src/high.ts', 2),
    ];

    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      expect(body.model).toBe('gpt-4o-turbo');
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: JSON.stringify([{ id: 0, confidence: 0.9 }]) } }],
        }),
      });
    });
    globalThis.fetch = mockFetch;

    const result = await reflectFindingsWithRouter(
      findings,
      router,
      { large: largeConfig },
      0.5,
    );

    expect(result.findings).toHaveLength(2);
    expect(callCount).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('某组 LLM 调用失败 — 该组降级保留所有 finding', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const findings = [
      makeLowRiskFinding('src/low.ts', 1),
      makeHighRiskFinding('src/high.ts', 2),
    ];

    const mockFetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      if (body.model === 'gpt-4o-mini') {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: JSON.stringify([{ id: 0, confidence: 0.9 }]) } }],
        }),
      });
    });
    globalThis.fetch = mockFetch;

    const result = await reflectFindingsWithRouter(
      findings,
      router,
      { small: smallConfig, large: largeConfig },
      0.5,
    );

    expect(result.findings).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalled();
    const allCalls = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(allCalls.some((s) => s.includes('[ai-reflection]'))).toBe(true);
    warnSpy.mockRestore();
  });

  it('使用默认阈值', async () => {
    const findings = [makeLowRiskFinding('src/a.ts', 1)];
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify([{ id: 0, confidence: 0.7 }]) } }],
      }),
    });
    globalThis.fetch = mockFetch;

    const result = await reflectFindingsWithRouter(
      findings,
      router,
      { small: smallConfig },
    );

    expect(result.findings).toHaveLength(1);
    expect(DEFAULT_REFLECTION_THRESHOLD).toBe(0.6);
  });

  it('配置降级 — medium 缺失时使用 large 配置', async () => {
    const mediumFinding = makeFinding({
      file: 'src/medium.ts',
      line: 10,
      severity: 'high',
      category: 'performance',
      message: 'performance issue with moderate complexity',
      confidence: 0.7,
    });

    const mockFetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      expect(body.model).toBe('gpt-4o-turbo');
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: JSON.stringify([{ id: 0, confidence: 0.8 }]) } }],
        }),
      });
    });
    globalThis.fetch = mockFetch;

    const result = await reflectFindingsWithRouter(
      [mediumFinding],
      router,
      { large: largeConfig },
      0.5,
    );

    expect(result.findings).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('routings 顺序与输入一致', async () => {
    const findings = [
      makeLowRiskFinding('src/a.ts', 1),
      makeHighRiskFinding('src/b.ts', 2),
      makeLowRiskFinding('src/c.ts', 3),
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify([{ id: 0, confidence: 0.8 }]) } }],
      }),
    });
    globalThis.fetch = mockFetch;

    const result = await reflectFindingsWithRouter(
      findings,
      router,
      { small: smallConfig, large: largeConfig },
      0.5,
    );

    expect(result.routings).toHaveLength(3);
    expect(result.routings[0].size).toBe('small');
    expect(result.routings[1].size).toBe('large');
    expect(result.routings[2].size).toBe('small');
  });
});
