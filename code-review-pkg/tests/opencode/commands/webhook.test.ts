import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  WebhookNotifier,
  sendWebhook,
  formatReviewEvent,
  countBySeverity,
  type WebhookEvent,
  type WebhookEndpoint,
  type SendWebhookResult,
} from '../../../src/webhook-notifier.js';
import type { Finding } from '../../../src/types.js';

// ── 测试 fixtures ──

function makeFinding(partial: Partial<Finding> = {}): Finding {
  return {
    file: 'src/app.ts',
    line: 10,
    severity: 'high',
    category: 'security',
    message: 'SQL injection detected',
    confidence: 0.85,
    source: 'rule',
    ruleId: 'sql-injection',
    suggestion: 'Use parameterized queries',
    ...partial,
  };
}

const SAMPLE_FINDINGS: Finding[] = [
  makeFinding({ file: 'src/a.ts', line: 10, severity: 'critical', message: 'critical issue' }),
  makeFinding({ file: 'src/b.ts', line: 20, severity: 'high', message: 'high issue' }),
  makeFinding({ file: 'src/c.ts', line: 30, severity: 'medium', message: 'medium issue' }),
  makeFinding({ file: 'src/d.ts', line: 40, severity: 'low', message: 'low issue' }),
  makeFinding({ file: 'src/e.ts', line: 50, severity: 'info', message: 'info issue' }),
];

// ── mock fetch 工具 ──

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function makeMockFetch(
  responses: Array<{ status?: number; ok?: boolean; statusText?: string }> = [],
): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  let callIdx = 0;
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const cfg = responses[Math.min(callIdx, responses.length - 1)] ?? { status: 200, ok: true };
    callIdx++;
    return {
      ok: cfg.ok ?? (cfg.status !== undefined && cfg.status >= 200 && cfg.status < 300),
      status: cfg.status ?? 200,
      statusText: cfg.statusText ?? 'OK',
    } as Response;
  });
  return { fetch: fetchImpl as unknown as typeof fetch, calls };
}

// ==================== countBySeverity ====================

describe('countBySeverity', () => {
  it('空数组返回全 0', () => {
    const counts = countBySeverity([]);
    expect(counts).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    });
  });

  it('正确统计各 severity', () => {
    const counts = countBySeverity(SAMPLE_FINDINGS);
    expect(counts.critical).toBe(1);
    expect(counts.high).toBe(1);
    expect(counts.medium).toBe(1);
    expect(counts.low).toBe(1);
    expect(counts.info).toBe(1);
  });

  it('未知 severity 归到 info', () => {
    const f = makeFinding({ severity: 'unknown' as Finding['severity'] });
    const counts = countBySeverity([f]);
    expect(counts.info).toBe(1);
  });
});

// ==================== formatReviewEvent ====================

describe('formatReviewEvent', () => {
  describe('review.completed', () => {
    it('生成正确的事件结构', () => {
      const event = formatReviewEvent('review.completed', {
        findings: SAMPLE_FINDINGS,
        filesTotal: 5,
      });
      expect(event.event).toBe('review.completed');
      expect(event.timestamp).toBeTruthy();
      expect(event.eventId).toMatch(/^evt_\d+_/);
      expect(event.data).toBeDefined();
    });

    it('包含 findings 数量与 severity 分布', () => {
      const event = formatReviewEvent('review.completed', {
        findings: SAMPLE_FINDINGS,
        filesTotal: 5,
      });
      const data = event.data as Extract<WebhookEvent['data'], { findingsCount: number }>;
      expect(data.findingsCount).toBe(5);
      expect(data.filesTotal).toBe(5);
      expect(data.severityCounts.critical).toBe(1);
      expect(data.severityCounts.high).toBe(1);
      expect(data.severityCounts.critical).toBe(1);
      expect(data.criticalCount).toBe(1);
    });

    it('包含 durationMs / sessionId / repository / prNumber', () => {
      const event = formatReviewEvent('review.completed', {
        findings: [],
        filesTotal: 0,
        durationMs: 1234,
        sessionId: 'sess-1',
        repository: 'owner/repo',
        prNumber: 42,
      });
      const data = event.data as Extract<WebhookEvent['data'], { findingsCount: number }>;
      expect(data.durationMs).toBe(1234);
      expect(data.sessionId).toBe('sess-1');
      expect(data.repository).toBe('owner/repo');
      expect(data.prNumber).toBe(42);
    });

    it('空 findings 时 severityCounts 全为 0', () => {
      const event = formatReviewEvent('review.completed', {
        findings: [],
        filesTotal: 0,
      });
      const data = event.data as Extract<WebhookEvent['data'], { severityCounts: Record<string, number> }>;
      expect(data.severityCounts.critical).toBe(0);
      expect(data.severityCounts.high).toBe(0);
      expect(data.findingsCount).toBe(0);
    });
  });

  describe('review.failed', () => {
    it('生成正确的事件结构', () => {
      const event = formatReviewEvent('review.failed', {
        error: 'LLM call failed',
      });
      expect(event.event).toBe('review.failed');
      expect(event.eventId).toMatch(/^evt_\d+_/);
      const data = event.data as Extract<WebhookEvent['data'], { error: string }>;
      expect(data.error).toBe('LLM call failed');
    });

    it('Error 对象提取 message', () => {
      const event = formatReviewEvent('review.failed', {
        error: new Error('Pipeline timeout'),
      });
      const data = event.data as Extract<WebhookEvent['data'], { error: string }>;
      expect(data.error).toBe('Pipeline timeout');
    });

    it('包含 stage / sessionId / repository / prNumber', () => {
      const event = formatReviewEvent('review.failed', {
        error: 'boom',
        stage: 'llm-call',
        sessionId: 'sess-2',
        repository: 'owner/repo',
        prNumber: 99,
      });
      const data = event.data as Extract<WebhookEvent['data'], { error: string; stage?: string }>;
      expect(data.stage).toBe('llm-call');
      expect(data.sessionId).toBe('sess-2');
      expect(data.repository).toBe('owner/repo');
      expect(data.prNumber).toBe(99);
    });
  });

  describe('finding.critical', () => {
    it('过滤出 critical findings', () => {
      const event = formatReviewEvent('finding.critical', {
        findings: SAMPLE_FINDINGS,
      });
      expect(event.event).toBe('finding.critical');
      const data = event.data as Extract<WebhookEvent['data'], { findings: Finding[]; count: number }>;
      expect(data.count).toBe(1);
      expect(data.findings).toHaveLength(1);
      expect(data.findings[0].severity).toBe('critical');
    });

    it('无 critical 时 count 为 0', () => {
      const event = formatReviewEvent('finding.critical', {
        findings: [makeFinding({ severity: 'high' })],
      });
      const data = event.data as Extract<WebhookEvent['data'], { count: number }>;
      expect(data.count).toBe(0);
      expect(data.findings).toEqual([]);
    });

    it('包含 sessionId / repository / prNumber', () => {
      const event = formatReviewEvent('finding.critical', {
        findings: SAMPLE_FINDINGS,
        sessionId: 'sess-3',
        repository: 'owner/repo',
        prNumber: 7,
      });
      const data = event.data as Extract<WebhookEvent['data'], { sessionId?: string }>;
      expect(data.sessionId).toBe('sess-3');
      expect(data.repository).toBe('owner/repo');
      expect(data.prNumber).toBe(7);
    });
  });

  it('每次调用生成不同的 eventId', () => {
    const e1 = formatReviewEvent('review.completed', { findings: [], filesTotal: 0 });
    const e2 = formatReviewEvent('review.completed', { findings: [], filesTotal: 0 });
    expect(e1.eventId).not.toBe(e2.eventId);
  });
});

// ==================== sendWebhook ====================

describe('sendWebhook', () => {
  it('成功发送返回 ok=true 与状态码', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 200, ok: true }]);
    const event = formatReviewEvent('review.completed', { findings: [], filesTotal: 0 });

    const result = await sendWebhook('https://example.com/hook', event, {
      fetchImpl: fetch,
      retries: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.url).toBe('https://example.com/hook');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://example.com/hook');
  });

  it('请求头包含 Content-Type / User-Agent / X-Webhook-Event', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 200 }]);
    const event = formatReviewEvent('review.completed', { findings: [], filesTotal: 0 });

    await sendWebhook('https://example.com/hook', event, { fetchImpl: fetch, retries: 0 });

    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['User-Agent']).toMatch(/^code-review-webhook/);
    expect(headers['X-Webhook-Event']).toBe('review.completed');
    expect(headers['X-Webhook-Id']).toBe(event.eventId);
  });

  it('body 是 JSON 序列化的 payload', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 200 }]);
    const event = formatReviewEvent('review.completed', { findings: [], filesTotal: 0 });

    await sendWebhook('https://example.com/hook', event, { fetchImpl: fetch, retries: 0 });

    const body = calls[0].init?.body as string;
    expect(() => JSON.parse(body)).not.toThrow();
    const parsed = JSON.parse(body);
    expect(parsed.event).toBe('review.completed');
    expect(parsed.eventId).toBe(event.eventId);
  });

  it('自定义 headers 与默认 headers 合并', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 200 }]);
    const event = formatReviewEvent('review.completed', { findings: [], filesTotal: 0 });

    await sendWebhook('https://example.com/hook', event, {
      fetchImpl: fetch,
      retries: 0,
      headers: {
        Authorization: 'Bearer token-123',
        'X-Custom': 'custom-value',
      },
    });

    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer token-123');
    expect(headers['X-Custom']).toBe('custom-value');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('非 2xx 响应返回 ok=false', async () => {
    const { fetch } = makeMockFetch([{ status: 500, ok: false, statusText: 'Internal Server Error' }]);
    const event = formatReviewEvent('review.completed', { findings: [], filesTotal: 0 });

    const result = await sendWebhook('https://example.com/hook', event, {
      fetchImpl: fetch,
      retries: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error).toMatch(/500/);
  });

  it('4xx 响应（非 429）不重试', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 404, ok: false, statusText: 'Not Found' }]);
    const event = formatReviewEvent('review.completed', { findings: [], filesTotal: 0 });

    const result = await sendWebhook('https://example.com/hook', event, {
      fetchImpl: fetch,
      retries: 3,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it('5xx 响应重试指定次数', async () => {
    const { fetch, calls } = makeMockFetch([
      { status: 500, ok: false },
      { status: 500, ok: false },
      { status: 200, ok: true },
    ]);
    const event = formatReviewEvent('review.completed', { findings: [], filesTotal: 0 });

    const result = await sendWebhook('https://example.com/hook', event, {
      fetchImpl: fetch,
      retries: 2,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(calls).toHaveLength(3);
  });

  it('网络错误重试并最终失败', async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => {
      calls.push({ url: _url, init: _init });
      throw new Error('network error');
    });
    const event = formatReviewEvent('review.completed', { findings: [], filesTotal: 0 });

    const result = await sendWebhook('https://example.com/hook', event, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('network error');
    expect(calls).toHaveLength(2);
  });

  it('fetchImpl 缺失时返回 ok=false', async () => {
    const event = formatReviewEvent('review.completed', { findings: [], filesTotal: 0 });

    const result = await sendWebhook('https://example.com/hook', event, {
      fetchImpl: undefined as unknown as typeof fetch,
      retries: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('支持 PUT 方法', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 200 }]);
    const event = formatReviewEvent('review.completed', { findings: [], filesTotal: 0 });

    await sendWebhook('https://example.com/hook', event, {
      fetchImpl: fetch,
      method: 'PUT',
      retries: 0,
    });

    expect(calls[0].init?.method).toBe('PUT');
  });
});

// ==================== WebhookNotifier 类 ====================

describe('WebhookNotifier', () => {
  describe('端点管理', () => {
    it('构造时接受 endpoints', () => {
      const notifier = new WebhookNotifier({
        endpoints: [{ url: 'https://a.com/hook' }],
      });
      expect(notifier.listEndpoints()).toHaveLength(1);
      expect(notifier.listEndpoints()[0].url).toBe('https://a.com/hook');
    });

    it('addEndpoint 添加端点', () => {
      const notifier = new WebhookNotifier();
      notifier.addEndpoint({ url: 'https://a.com/hook' });
      notifier.addEndpoint({ url: 'https://b.com/hook' });
      expect(notifier.listEndpoints()).toHaveLength(2);
    });

    it('removeEndpoint 按 URL 移除', () => {
      const notifier = new WebhookNotifier({
        endpoints: [
          { url: 'https://a.com/hook' },
          { url: 'https://b.com/hook' },
        ],
      });
      expect(notifier.removeEndpoint('https://a.com/hook')).toBe(true);
      expect(notifier.listEndpoints()).toHaveLength(1);
      expect(notifier.listEndpoints()[0].url).toBe('https://b.com/hook');
    });

    it('removeEndpoint 不存在的 URL 返回 false', () => {
      const notifier = new WebhookNotifier();
      expect(notifier.removeEndpoint('https://nope.com/hook')).toBe(false);
    });

    it('listEndpoints 返回副本（不泄露内部状态）', () => {
      const notifier = new WebhookNotifier({
        endpoints: [{ url: 'https://a.com/hook' }],
      });
      const list = notifier.listEndpoints();
      list.push({ url: 'https://b.com/hook' });
      expect(notifier.listEndpoints()).toHaveLength(1);
    });
  });

  describe('notify - 事件订阅', () => {
    it('端点未指定 events 时订阅所有事件', async () => {
      const { fetch, calls } = makeMockFetch([{ status: 200 }]);
      const notifier = new WebhookNotifier({
        endpoints: [{ url: 'https://a.com/hook' }],
        fetchImpl: fetch,
        defaultRetries: 0,
      });

      const event = formatReviewEvent('review.completed', { findings: [], filesTotal: 0 });
      await notifier.notify(event);

      expect(calls).toHaveLength(1);
    });

    it('端点指定 events 时仅订阅匹配事件', async () => {
      const { fetch, calls } = makeMockFetch([{ status: 200 }]);
      const notifier = new WebhookNotifier({
        endpoints: [
          {
            url: 'https://a.com/hook',
            events: ['review.failed'],
          },
        ],
        fetchImpl: fetch,
        defaultRetries: 0,
      });

      const event = formatReviewEvent('review.completed', { findings: [], filesTotal: 0 });
      const results = await notifier.notify(event);

      expect(calls).toHaveLength(0);
      expect(results).toEqual([]);
    });

    it('多个端点并行通知', async () => {
      const { fetch, calls } = makeMockFetch([{ status: 200 }, { status: 200 }]);
      const notifier = new WebhookNotifier({
        endpoints: [
          { url: 'https://a.com/hook' },
          { url: 'https://b.com/hook' },
        ],
        fetchImpl: fetch,
        defaultRetries: 0,
      });

      const event = formatReviewEvent('review.completed', { findings: [], filesTotal: 0 });
      const results = await notifier.notify(event);

      expect(results).toHaveLength(2);
      expect(calls).toHaveLength(2);
      const urls = calls.map((c) => c.url).sort();
      expect(urls).toEqual(['https://a.com/hook', 'https://b.com/hook']);
    });

    it('无订阅端点时返回空数组', async () => {
      const { fetch, calls } = makeMockFetch([]);
      const notifier = new WebhookNotifier({
        endpoints: [],
        fetchImpl: fetch,
      });

      const event = formatReviewEvent('review.completed', { findings: [], filesTotal: 0 });
      const results = await notifier.notify(event);

      expect(results).toEqual([]);
      expect(calls).toHaveLength(0);
    });

    it('单个端点失败不影响其他端点', async () => {
      let callIdx = 0;
      const calls: FetchCall[] = [];
      const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        callIdx++;
        if (callIdx === 1) {
          throw new Error('network error');
        }
        return { ok: true, status: 200, statusText: 'OK' } as Response;
      });

      const notifier = new WebhookNotifier({
        endpoints: [
          { url: 'https://fail.com/hook' },
          { url: 'https://ok.com/hook' },
        ],
        fetchImpl: fetchImpl as unknown as typeof fetch,
        defaultRetries: 0,
      });

      const event = formatReviewEvent('review.completed', { findings: [], filesTotal: 0 });
      const results = await notifier.notify(event);

      expect(results).toHaveLength(2);
      const okResults = results.filter((r) => r.ok);
      const failResults = results.filter((r) => !r.ok);
      expect(okResults).toHaveLength(1);
      expect(failResults).toHaveLength(1);
    });

    it('失败时调用 logger 记录', async () => {
      const loggerCalls: string[] = [];
      const fetchImpl = vi.fn(async () => {
        throw new Error('boom');
      });
      const notifier = new WebhookNotifier({
        endpoints: [{ url: 'https://fail.com/hook' }],
        fetchImpl: fetchImpl as unknown as typeof fetch,
        defaultRetries: 0,
        logger: (msg: string) => loggerCalls.push(msg),
      });

      const event = formatReviewEvent('review.completed', { findings: [], filesTotal: 0 });
      await notifier.notify(event);

      expect(loggerCalls.length).toBeGreaterThan(0);
      expect(loggerCalls[0]).toMatch(/webhook/);
    });

    it('端点 headers 与默认 headers 合并', async () => {
      const { fetch, calls } = makeMockFetch([{ status: 200 }]);
      const notifier = new WebhookNotifier({
        endpoints: [
          {
            url: 'https://a.com/hook',
            headers: { 'X-Endpoint': 'a' },
          },
        ],
        defaultHeaders: { 'X-Default': 'default-val' },
        fetchImpl: fetch,
        defaultRetries: 0,
      });

      const event = formatReviewEvent('review.completed', { findings: [], filesTotal: 0 });
      await notifier.notify(event);

      const headers = calls[0].init?.headers as Record<string, string>;
      expect(headers['X-Default']).toBe('default-val');
      expect(headers['X-Endpoint']).toBe('a');
    });
  });

  describe('便捷方法', () => {
    it('notifyReviewCompleted 触发 review.completed 事件', async () => {
      const { fetch, calls } = makeMockFetch([{ status: 200 }]);
      const notifier = new WebhookNotifier({
        endpoints: [{ url: 'https://a.com/hook' }],
        fetchImpl: fetch,
        defaultRetries: 0,
      });

      await notifier.notifyReviewCompleted({
        findings: SAMPLE_FINDINGS,
        filesTotal: 5,
        durationMs: 1000,
      });

      expect(calls).toHaveLength(1);
      const body = JSON.parse(calls[0].init?.body as string);
      expect(body.event).toBe('review.completed');
      expect(body.data.findingsCount).toBe(5);
      expect(body.data.filesTotal).toBe(5);
      expect(body.data.durationMs).toBe(1000);
    });

    it('notifyReviewFailed 触发 review.failed 事件', async () => {
      const { fetch, calls } = makeMockFetch([{ status: 200 }]);
      const notifier = new WebhookNotifier({
        endpoints: [{ url: 'https://a.com/hook' }],
        fetchImpl: fetch,
        defaultRetries: 0,
      });

      await notifier.notifyReviewFailed({
        error: 'pipeline crashed',
        stage: 'llm',
      });

      expect(calls).toHaveLength(1);
      const body = JSON.parse(calls[0].init?.body as string);
      expect(body.event).toBe('review.failed');
      expect(body.data.error).toBe('pipeline crashed');
      expect(body.data.stage).toBe('llm');
    });

    it('notifyFindingCritical 无 critical 时不发送', async () => {
      const { fetch, calls } = makeMockFetch([{ status: 200 }]);
      const notifier = new WebhookNotifier({
        endpoints: [{ url: 'https://a.com/hook' }],
        fetchImpl: fetch,
        defaultRetries: 0,
      });

      const results = await notifier.notifyFindingCritical({
        findings: [makeFinding({ severity: 'high' })],
      });

      expect(results).toEqual([]);
      expect(calls).toHaveLength(0);
    });

    it('notifyFindingCritical 有 critical 时发送事件', async () => {
      const { fetch, calls } = makeMockFetch([{ status: 200 }]);
      const notifier = new WebhookNotifier({
        endpoints: [{ url: 'https://a.com/hook' }],
        fetchImpl: fetch,
        defaultRetries: 0,
      });

      await notifier.notifyFindingCritical({
        findings: SAMPLE_FINDINGS,
      });

      expect(calls).toHaveLength(1);
      const body = JSON.parse(calls[0].init?.body as string);
      expect(body.event).toBe('finding.critical');
      expect(body.data.count).toBe(1);
    });

    it('notifyReviewResult 触发 completed 与（如有）critical', async () => {
      const { fetch, calls } = makeMockFetch([{ status: 200 }, { status: 200 }]);
      const notifier = new WebhookNotifier({
        endpoints: [{ url: 'https://a.com/hook' }],
        fetchImpl: fetch,
        defaultRetries: 0,
      });

      const results = await notifier.notifyReviewResult(SAMPLE_FINDINGS, {
        filesTotal: 5,
        durationMs: 1000,
        sessionId: 'sess-x',
      });

      expect(results).toHaveLength(2);
      expect(calls).toHaveLength(2);
      const events = calls.map((c) => JSON.parse(c.init?.body as string).event);
      expect(events).toContain('review.completed');
      expect(events).toContain('finding.critical');
    });

    it('notifyReviewResult 无 critical 时仅触发 completed', async () => {
      const { fetch, calls } = makeMockFetch([{ status: 200 }]);
      const notifier = new WebhookNotifier({
        endpoints: [{ url: 'https://a.com/hook' }],
        fetchImpl: fetch,
        defaultRetries: 0,
      });

      const results = await notifier.notifyReviewResult(
        [makeFinding({ severity: 'high' })],
        { filesTotal: 1 },
      );

      expect(results).toHaveLength(1);
      expect(calls).toHaveLength(1);
      const body = JSON.parse(calls[0].init?.body as string);
      expect(body.event).toBe('review.completed');
    });

    it('repository / prNumber 注入到事件 payload', async () => {
      const { fetch, calls } = makeMockFetch([{ status: 200 }]);
      const notifier = new WebhookNotifier({
        endpoints: [{ url: 'https://a.com/hook' }],
        fetchImpl: fetch,
        defaultRetries: 0,
        repository: 'owner/repo',
        prNumber: 42,
      });

      await notifier.notifyReviewCompleted({
        findings: [],
        filesTotal: 0,
      });

      const body = JSON.parse(calls[0].init?.body as string);
      expect(body.data.repository).toBe('owner/repo');
      expect(body.data.prNumber).toBe(42);
    });
  });
});

// ==================== post-process.js 集成 ====================

const PLUGIN_PATH = '../../../opencode-config/.opencode/plugins/post-process.js';

async function loadPlugin() {
  const mod = await import(PLUGIN_PATH);
  return mod.default;
}

describe('post-process.js Webhook 集成', () => {
  let originalWebhookEnv: string | undefined;

  beforeEach(() => {
    originalWebhookEnv = process.env.CODE_REVIEW_WEBHOOK_URL;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalWebhookEnv === undefined) {
      delete process.env.CODE_REVIEW_WEBHOOK_URL;
    } else {
      process.env.CODE_REVIEW_WEBHOOK_URL = originalWebhookEnv;
    }
    vi.restoreAllMocks();
  });

  it('afterReview 完成后调用 WebhookNotifier', async () => {
    // 注入 mock 的 webhook 函数
    const mockSendWebhook = vi.fn(async () => ({ ok: true, status: 200, url: 'test' }));
    const mockFormatReviewEvent = vi.fn(() => ({
      event: 'review.completed',
      timestamp: new Date().toISOString(),
      eventId: 'evt-test',
      data: {},
    }));

    const plugin = await loadPlugin();

    const findings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1, severity: 'critical' }),
    ];

    await plugin.hooks.afterReview(findings, {
      correctLineLocations: vi.fn((f) => f),
      filterFalsePositives: vi.fn((f) => f),
      deduplicateFindings: vi.fn((f) => f),
      // 注入 mock Webhook 通知器
      webhookNotifier: {
        notifyReviewResult: mockSendWebhook,
      },
      webhookContext: {
        filesTotal: 1,
        durationMs: 100,
      },
    });

    expect(mockSendWebhook).toHaveBeenCalledTimes(1);
    const callArgs = mockSendWebhook.mock.calls[0];
    expect(callArgs[0]).toEqual(findings);
    expect(callArgs[1]).toMatchObject({
      filesTotal: 1,
      durationMs: 100,
    });
    void mockFormatReviewEvent;
  });

  it('未提供 webhookNotifier 时不报错', async () => {
    const plugin = await loadPlugin();
    const findings: Finding[] = [makeFinding({ file: 'a.ts', line: 1 })];

    const result = await plugin.hooks.afterReview(findings, {
      correctLineLocations: vi.fn((f) => f),
      filterFalsePositives: vi.fn((f) => f),
      deduplicateFindings: vi.fn((f) => f),
    });

    expect(result).toEqual(findings);
  });

  it('Webhook 通知失败不影响主流程', async () => {
    const mockSendWebhook = vi.fn(async () => {
      throw new Error('webhook failed');
    });

    const plugin = await loadPlugin();
    const findings: Finding[] = [makeFinding({ file: 'a.ts', line: 1 })];

    const result = await plugin.hooks.afterReview(findings, {
      correctLineLocations: vi.fn((f) => f),
      filterFalsePositives: vi.fn((f) => f),
      deduplicateFindings: vi.fn((f) => f),
      webhookNotifier: {
        notifyReviewResult: mockSendWebhook,
      },
    });

    expect(result).toEqual(findings);
  });

  it('可通过 context.webhookEndpoints 配置端点', async () => {
    const plugin = await loadPlugin();
    const findings: Finding[] = [makeFinding({ file: 'a.ts', line: 1 })];

    // 注入 mock WebhookNotifier 构造器
    const mockNotifierInstance = {
      notifyReviewResult: vi.fn(async () => [{ ok: true, status: 200, url: 'test' }]),
    };
    const mockWebhookNotifierCtor = vi.fn(() => mockNotifierInstance);

    await plugin.hooks.afterReview(findings, {
      correctLineLocations: vi.fn((f) => f),
      filterFalsePositives: vi.fn((f) => f),
      deduplicateFindings: vi.fn((f) => f),
      webhookNotifierCtor: mockWebhookNotifierCtor,
      webhookEndpoints: [{ url: 'https://example.com/hook' }],
      webhookContext: { filesTotal: 1 },
    });

    expect(mockWebhookNotifierCtor).toHaveBeenCalled();
    expect(mockNotifierInstance.notifyReviewResult).toHaveBeenCalled();
  });
});

// ==================== CLI 集成（环境变量驱动） ====================

describe('环境变量驱动 Webhook 配置', () => {
  it('CODE_REVIEW_WEBHOOK_URL 设置时通知器使用该 URL', () => {
    process.env.CODE_REVIEW_WEBHOOK_URL = 'https://env.example.com/hook';
    const notifier = new WebhookNotifier({
      endpoints: [{ url: process.env.CODE_REVIEW_WEBHOOK_URL }],
    });
    expect(notifier.listEndpoints()[0].url).toBe('https://env.example.com/hook');
    delete process.env.CODE_REVIEW_WEBHOOK_URL;
  });
});

// ==================== 类型导出 ====================

describe('类型导出', () => {
  it('WebhookEndpoint 接口存在', () => {
    const ep: WebhookEndpoint = { url: 'https://a.com' };
    expect(ep.url).toBe('https://a.com');
  });

  it('SendWebhookResult 接口存在', () => {
    const r: SendWebhookResult = { ok: true, url: 'https://a.com' };
    expect(r.ok).toBe(true);
  });

  it('WebhookEvent 接口存在', () => {
    const e: WebhookEvent = {
      event: 'review.completed',
      timestamp: new Date().toISOString(),
      eventId: 'evt-1',
      data: {
        filesTotal: 0,
        findingsCount: 0,
        severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        criticalCount: 0,
      },
    };
    expect(e.event).toBe('review.completed');
  });
});
