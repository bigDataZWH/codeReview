import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildReflectionPrompt,
  buildBatchReflectionPrompt,
  parseReflectionResponse,
  reflectFindings,
} from '../src/ai-reflection.js';
import type { Finding, LLMProviderConfig } from '../src/types.js';

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
    const response = 'this is not json';
    const result = parseReflectionResponse(response);
    expect(result).toBe(0.5);
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
