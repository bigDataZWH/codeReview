import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AlertNotifier,
  sendAlert,
  sendSlackAlert,
  sendEmailAlert,
  sendPagerDutyAlert,
  severityAtLeast,
  type AlertPayload,
  type SlackConfig,
  type EmailConfig,
  type PagerDutyConfig,
  type WebhookConfig,
  type AlertSeverity,
} from '../../../src/alert-notifier.js';

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

function makePayload(partial: Partial<AlertPayload> = {}): AlertPayload {
  return {
    title: 'Test Alert',
    message: 'Something happened',
    severity: 'high',
    ...partial,
  };
}

// ==================== severityAtLeast ====================

describe('severityAtLeast', () => {
  it('critical >= critical', () => {
    expect(severityAtLeast('critical', 'critical')).toBe(true);
  });

  it('critical >= low', () => {
    expect(severityAtLeast('critical', 'low')).toBe(true);
  });

  it('low >= critical 为 false', () => {
    expect(severityAtLeast('low', 'critical')).toBe(false);
  });

  it('medium >= high 为 false', () => {
    expect(severityAtLeast('medium', 'high')).toBe(false);
  });

  it('info >= low 为 false', () => {
    expect(severityAtLeast('info', 'low')).toBe(false);
  });

  it('high >= medium 为 true', () => {
    expect(severityAtLeast('high', 'medium')).toBe(true);
  });

  it('info >= info 为 true', () => {
    expect(severityAtLeast('info', 'info')).toBe(true);
  });
});

// ==================== sendSlackAlert ====================

describe('sendSlackAlert', () => {
  const config: SlackConfig = {
    webhookUrl: 'https://hooks.slack.com/services/T0/B0/xxx',
  };

  it('成功发送返回 ok=true', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 200 }]);
    const payload = makePayload({ severity: 'critical' });
    const result = await sendSlackAlert(config, payload, { fetchImpl: fetch, retries: 0 });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.channel).toBe('slack');
    expect(result.target).toBe(config.webhookUrl);
    expect(result.alertId).toMatch(/^alert_/);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(config.webhookUrl);
  });

  it('请求体包含 attachment 与 color', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 200 }]);
    const payload = makePayload({ severity: 'critical', title: 'Critical Finding' });
    await sendSlackAlert(config, payload, { fetchImpl: fetch, retries: 0 });

    const init = calls[0].init;
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    expect(body.attachments[0].color).toBe('#dc143c');
    expect(body.attachments[0].title).toBe('Critical Finding');
    expect(body.text).toBe('Critical Finding');
  });

  it('severity 映射到 Slack color', async () => {
    const cases: Array<{ severity: AlertSeverity; color: string }> = [
      { severity: 'critical', color: '#dc143c' },
      { severity: 'high', color: '#ff8c00' },
      { severity: 'medium', color: '#ffd700' },
      { severity: 'low', color: '#4682b4' },
      { severity: 'info', color: '#808080' },
    ];

    for (const { severity, color } of cases) {
      const { fetch, calls } = makeMockFetch([{ status: 200 }]);
      await sendSlackAlert(config, makePayload({ severity }), { fetchImpl: fetch, retries: 0 });
      const body = JSON.parse(calls[0].init?.body as string);
      expect(body.attachments[0].color).toBe(color);
    }
  });

  it('自定义 channel / username / icon_emoji 注入到 body', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 200 }]);
    const cfg: SlackConfig = {
      ...config,
      channel: '#alerts',
      username: 'review-bot',
      iconEmoji: ':warning:',
    };
    await sendSlackAlert(cfg, makePayload(), { fetchImpl: fetch, retries: 0 });
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.channel).toBe('#alerts');
    expect(body.username).toBe('review-bot');
    expect(body.icon_emoji).toBe(':warning:');
  });

  it('payload.file / line / repository / prNumber 出现在 fields', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 200 }]);
    await sendSlackAlert(
      config,
      makePayload({
        file: 'src/app.ts',
        line: 42,
        repository: 'acme/repo',
        prNumber: 99,
      }),
      { fetchImpl: fetch, retries: 0 },
    );
    const body = JSON.parse(calls[0].init?.body as string);
    const fields = body.attachments[0].fields;
    const titles = fields.map((f: { title: string }) => f.title);
    expect(titles).toContain('File');
    expect(titles).toContain('Line');
    expect(titles).toContain('Repository');
    expect(titles).toContain('PR');
  });

  it('5xx 错误触发重试', async () => {
    const { fetch, calls } = makeMockFetch([
      { status: 500, statusText: 'Internal Server Error' },
      { status: 200 },
    ]);
    const result = await sendSlackAlert(config, makePayload(), {
      fetchImpl: fetch,
      retries: 1,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('4xx 错误不重试', async () => {
    const { fetch, calls } = makeMockFetch([
      { status: 400, statusText: 'Bad Request' },
    ]);
    const result = await sendSlackAlert(config, makePayload(), {
      fetchImpl: fetch,
      retries: 3,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/HTTP 400/);
    expect(calls).toHaveLength(1);
  });

  it('网络错误触发重试', async () => {
    let callIdx = 0;
    const calls: FetchCall[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      callIdx++;
      if (callIdx === 1) throw new Error('network error');
      return { ok: true, status: 200, statusText: 'OK' } as Response;
    });
    const result = await sendSlackAlert(config, makePayload(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 1,
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('重试耗尽后返回失败', async () => {
    const { fetch, calls } = makeMockFetch([
      { status: 503, statusText: 'Service Unavailable' },
      { status: 503, statusText: 'Service Unavailable' },
    ]);
    const result = await sendSlackAlert(config, makePayload(), {
      fetchImpl: fetch,
      retries: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(calls).toHaveLength(2);
  });

  it('自动生成 alertId 与 timestamp', async () => {
    const { fetch } = makeMockFetch([{ status: 200 }]);
    const result = await sendSlackAlert(config, makePayload({ alertId: undefined, timestamp: undefined }), {
      fetchImpl: fetch,
      retries: 0,
    });

    expect(result.alertId).toMatch(/^alert_/);
  });

  it('保留显式 alertId', async () => {
    const { fetch } = makeMockFetch([{ status: 200 }]);
    const result = await sendSlackAlert(
      config,
      makePayload({ alertId: 'custom-id-123' }),
      { fetchImpl: fetch, retries: 0 },
    );

    expect(result.alertId).toBe('custom-id-123');
  });
});

// ==================== sendEmailAlert ====================

describe('sendEmailAlert', () => {
  const config: EmailConfig = {
    apiUrl: 'https://api.sendgrid.com/v3/mail/send',
    apiKey: 'SG.xxx',
    from: 'alerts@example.com',
    to: 'alice@example.com,bob@example.com',
  };

  it('成功发送返回 ok=true', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 202 }]);
    const result = await sendEmailAlert(config, makePayload(), { fetchImpl: fetch, retries: 0 });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(202);
    expect(result.channel).toBe('email');
    expect(result.target).toBe(config.apiUrl);
    expect(calls).toHaveLength(1);
  });

  it('请求头包含 Authorization Bearer', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 202 }]);
    await sendEmailAlert(config, makePayload(), { fetchImpl: fetch, retries: 0 });

    const init = calls[0].init;
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${config.apiKey}`);
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('请求体兼容 SendGrid v3 personalizations 结构', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 202 }]);
    await sendEmailAlert(config, makePayload({ severity: 'critical', title: 'Critical' }), {
      fetchImpl: fetch,
      retries: 0,
    });

    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.personalizations).toHaveLength(2);
    expect(body.personalizations[0].to[0].email).toBe('alice@example.com');
    expect(body.personalizations[1].to[0].email).toBe('bob@example.com');
    expect(body.from.email).toBe('alerts@example.com');
    expect(body.subject).toMatch(/\[CRITICAL\]/);
    expect(body.subject).toMatch(/Critical/);
    expect(body.content[0].type).toBe('text/plain');
    expect(body.content[0].value).toContain('Critical');
  });

  it('收件人数组形式（string[]）正确转换', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 202 }]);
    const cfg: EmailConfig = {
      ...config,
      to: ['a@x.com', 'b@x.com', 'c@x.com'],
    };
    await sendEmailAlert(cfg, makePayload(), { fetchImpl: fetch, retries: 0 });
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.personalizations).toHaveLength(3);
  });

  it('subjectPrefix 自定义前缀', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 202 }]);
    const cfg: EmailConfig = { ...config, subjectPrefix: '[SecOps]' };
    await sendEmailAlert(cfg, makePayload({ severity: 'high', title: 'Alert' }), {
      fetchImpl: fetch,
      retries: 0,
    });
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.subject).toMatch(/^\[SecOps\] \[HIGH\] Alert$/);
  });

  it('邮件正文包含 file:line / repository / prNumber', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 202 }]);
    await sendEmailAlert(
      config,
      makePayload({
        file: 'src/app.ts',
        line: 42,
        repository: 'acme/repo',
        prNumber: 7,
        findingId: 'finding-001',
      }),
      { fetchImpl: fetch, retries: 0 },
    );
    const body = JSON.parse(calls[0].init?.body as string);
    const text = body.content[0].value;
    expect(text).toContain('src/app.ts:42');
    expect(text).toContain('acme/repo');
    expect(text).toContain('#7');
    expect(text).toContain('finding-001');
  });

  it('4xx 错误不重试', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 401, statusText: 'Unauthorized' }]);
    const result = await sendEmailAlert(config, makePayload(), {
      fetchImpl: fetch,
      retries: 3,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  it('5xx 错误重试', async () => {
    const { fetch, calls } = makeMockFetch([
      { status: 500, statusText: 'Internal' },
      { status: 202 },
    ]);
    const result = await sendEmailAlert(config, makePayload(), {
      fetchImpl: fetch,
      retries: 1,
    });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });
});

// ==================== sendPagerDutyAlert ====================

describe('sendPagerDutyAlert', () => {
  const config: PagerDutyConfig = {
    integrationKey: 'abc123def456',
  };

  it('成功发送返回 ok=true', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 202 }]);
    const result = await sendPagerDutyAlert(config, makePayload(), {
      fetchImpl: fetch,
      retries: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(202);
    expect(result.channel).toBe('pagerduty');
    expect(result.target).toBe('https://events.pagerduty.com/v2/enqueue');
    expect(calls).toHaveLength(1);
  });

  it('请求体符合 Events API v2 结构', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 202 }]);
    await sendPagerDutyAlert(config, makePayload({ severity: 'critical', title: 'PD Alert' }), {
      fetchImpl: fetch,
      retries: 0,
    });

    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.routing_key).toBe(config.integrationKey);
    expect(body.event_action).toBe('trigger');
    expect(body.dedup_key).toMatch(/^code-review:alert_/);
    expect(body.payload.summary).toBe('PD Alert');
    expect(body.payload.severity).toBe('critical');
    expect(body.payload.source).toBe('code-review');
    expect(body.payload.custom_details.message).toBe('Something happened');
  });

  it('severity 映射到 PagerDuty severity', async () => {
    const cases: Array<{ severity: AlertSeverity; pd: string }> = [
      { severity: 'critical', pd: 'critical' },
      { severity: 'high', pd: 'error' },
      { severity: 'medium', pd: 'warning' },
      { severity: 'low', pd: 'info' },
      { severity: 'info', pd: 'info' },
    ];

    for (const { severity, pd } of cases) {
      const { fetch, calls } = makeMockFetch([{ status: 202 }]);
      await sendPagerDutyAlert(config, makePayload({ severity }), {
        fetchImpl: fetch,
        retries: 0,
      });
      const body = JSON.parse(calls[0].init?.body as string);
      expect(body.payload.severity).toBe(pd);
    }
  });

  it('支持 trigger / resolve / acknowledge 事件类型', async () => {
    for (const action of ['trigger', 'resolve', 'acknowledge'] as const) {
      const { fetch, calls } = makeMockFetch([{ status: 202 }]);
      await sendPagerDutyAlert(config, makePayload(), {
        fetchImpl: fetch,
        retries: 0,
        pagerDutyEventType: action,
      });
      const body = JSON.parse(calls[0].init?.body as string);
      expect(body.event_action).toBe(action);
    }
  });

  it('自定义 apiUrl 覆盖默认值', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 202 }]);
    const cfg: PagerDutyConfig = {
      ...config,
      apiUrl: 'https://events.eu.pagerduty.com/v2/enqueue',
    };
    await sendPagerDutyAlert(cfg, makePayload(), { fetchImpl: fetch, retries: 0 });
    expect(calls[0].url).toBe('https://events.eu.pagerduty.com/v2/enqueue');
  });

  it('dedup_key 基于 alertId 生成', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 202 }]);
    await sendPagerDutyAlert(
      config,
      makePayload({ alertId: 'my-alert-001' }),
      { fetchImpl: fetch, retries: 0 },
    );
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.dedup_key).toBe('code-review:my-alert-001');
  });

  it('4xx 错误不重试', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 400, statusText: 'Bad Request' }]);
    const result = await sendPagerDutyAlert(config, makePayload(), {
      fetchImpl: fetch,
      retries: 3,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(calls).toHaveLength(1);
  });
});

// ==================== sendAlert（路由器）====================

describe('sendAlert 通用路由器', () => {
  it('channel=slack 路由到 sendSlackAlert', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 200 }]);
    const cfg: SlackConfig = { webhookUrl: 'https://hooks.slack.com/x' };
    const result = await sendAlert('slack', cfg, makePayload(), {
      fetchImpl: fetch,
      retries: 0,
    });
    expect(result.channel).toBe('slack');
    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe('https://hooks.slack.com/x');
  });

  it('channel=email 路由到 sendEmailAlert', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 202 }]);
    const cfg: EmailConfig = {
      apiUrl: 'https://api.sendgrid.com/v3/mail/send',
      apiKey: 'k',
      from: 'a@x.com',
      to: 'b@x.com',
    };
    const result = await sendAlert('email', cfg, makePayload(), {
      fetchImpl: fetch,
      retries: 0,
    });
    expect(result.channel).toBe('email');
    expect(result.ok).toBe(true);
  });

  it('channel=pagerduty 路由到 sendPagerDutyAlert', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 202 }]);
    const cfg: PagerDutyConfig = { integrationKey: 'k' };
    const result = await sendAlert('pagerduty', cfg, makePayload(), {
      fetchImpl: fetch,
      retries: 0,
    });
    expect(result.channel).toBe('pagerduty');
    expect(result.ok).toBe(true);
  });

  it('channel=webhook 通用 POST JSON', async () => {
    const { fetch, calls } = makeMockFetch([{ status: 200 }]);
    const cfg: WebhookConfig = { url: 'https://example.com/hook' };
    const result = await sendAlert('webhook', cfg, makePayload(), {
      fetchImpl: fetch,
      retries: 0,
    });
    expect(result.channel).toBe('webhook');
    expect(result.ok).toBe(true);
    const init = calls[0].init;
    const headers = init?.headers as Record<string, string>;
    expect(headers['X-Alert-Severity']).toBe('high');
    expect(headers['X-Alert-Id']).toMatch(/^alert_/);
    const body = JSON.parse(init?.body as string);
    expect(body.title).toBe('Test Alert');
  });
});

// ==================== AlertNotifier 类 ====================

describe('AlertNotifier', () => {
  describe('构造器与 hasChannel', () => {
    it('默认空配置无任何渠道', () => {
      const n = new AlertNotifier();
      expect(n.hasChannel('slack')).toBe(false);
      expect(n.hasChannel('email')).toBe(false);
      expect(n.hasChannel('pagerduty')).toBe(false);
      expect(n.hasChannel('webhook')).toBe(false);
    });

    it('配置 slack 后 hasChannel 返回 true', () => {
      const n = new AlertNotifier({
        slack: { webhookUrl: 'https://hooks.slack.com/x' },
      });
      expect(n.hasChannel('slack')).toBe(true);
      expect(n.hasChannel('email')).toBe(false);
    });

    it('配置多渠道后 hasChannel 反映状态', () => {
      const n = new AlertNotifier({
        slack: { webhookUrl: 'https://hooks.slack.com/x' },
        email: {
          apiUrl: 'https://api.sendgrid.com/v3/mail/send',
          apiKey: 'k',
          from: 'a@x.com',
          to: 'b@x.com',
        },
        pagerDuty: { integrationKey: 'k' },
      });
      expect(n.hasChannel('slack')).toBe(true);
      expect(n.hasChannel('email')).toBe(true);
      expect(n.hasChannel('pagerduty')).toBe(true);
      expect(n.hasChannel('webhook')).toBe(false);
    });
  });

  describe('shouldNotify - 默认 severity 路由', () => {
    it('Slack 默认 medium 起触发', () => {
      const n = new AlertNotifier({
        slack: { webhookUrl: 'https://hooks.slack.com/x' },
      });
      expect(n.shouldNotify('slack', 'critical')).toBe(true);
      expect(n.shouldNotify('slack', 'high')).toBe(true);
      expect(n.shouldNotify('slack', 'medium')).toBe(true);
      expect(n.shouldNotify('slack', 'low')).toBe(false);
      expect(n.shouldNotify('slack', 'info')).toBe(false);
    });

    it('Email 默认 medium 起触发', () => {
      const n = new AlertNotifier({
        email: {
          apiUrl: 'https://api.sendgrid.com/v3/mail/send',
          apiKey: 'k',
          from: 'a@x.com',
          to: 'b@x.com',
        },
      });
      expect(n.shouldNotify('email', 'high')).toBe(true);
      expect(n.shouldNotify('email', 'medium')).toBe(true);
      expect(n.shouldNotify('email', 'low')).toBe(false);
    });

    it('PagerDuty 默认 high 起触发', () => {
      const n = new AlertNotifier({
        pagerDuty: { integrationKey: 'k' },
      });
      expect(n.shouldNotify('pagerduty', 'critical')).toBe(true);
      expect(n.shouldNotify('pagerduty', 'high')).toBe(true);
      expect(n.shouldNotify('pagerduty', 'medium')).toBe(false);
      expect(n.shouldNotify('pagerduty', 'low')).toBe(false);
    });

    it('未配置的渠道 shouldNotify 始终为 false', () => {
      const n = new AlertNotifier();
      expect(n.shouldNotify('slack', 'critical')).toBe(false);
      expect(n.shouldNotify('email', 'critical')).toBe(false);
      expect(n.shouldNotify('pagerduty', 'critical')).toBe(false);
    });

    it('自定义 pagerDutyMinSeverity=critical 后 high 不触发', () => {
      const n = new AlertNotifier({
        pagerDuty: { integrationKey: 'k' },
        pagerDutyMinSeverity: 'critical',
      });
      expect(n.shouldNotify('pagerduty', 'critical')).toBe(true);
      expect(n.shouldNotify('pagerduty', 'high')).toBe(false);
    });

    it('自定义 slackMinSeverity=low 后 low 也触发', () => {
      const n = new AlertNotifier({
        slack: { webhookUrl: 'https://hooks.slack.com/x' },
        slackMinSeverity: 'low',
      });
      expect(n.shouldNotify('slack', 'low')).toBe(true);
      expect(n.shouldNotify('slack', 'info')).toBe(false);
    });
  });

  describe('notify - 多渠道并行分发', () => {
    it('critical 触发所有配置渠道', async () => {
      const { fetch, calls } = makeMockFetch([
        { status: 200 },
        { status: 202 },
        { status: 202 },
      ]);
      const n = new AlertNotifier({
        slack: { webhookUrl: 'https://hooks.slack.com/x' },
        email: {
          apiUrl: 'https://api.sendgrid.com/v3/mail/send',
          apiKey: 'k',
          from: 'a@x.com',
          to: 'b@x.com',
        },
        pagerDuty: { integrationKey: 'k' },
        fetchImpl: fetch,
        defaultRetries: 0,
      });

      const results = await n.notify(makePayload({ severity: 'critical' }));
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.ok)).toBe(true);
      expect(calls).toHaveLength(3);
    });

    it('medium 仅触发 Slack + Email（PagerDuty 不触发）', async () => {
      const { fetch, calls } = makeMockFetch([
        { status: 200 },
        { status: 202 },
      ]);
      const n = new AlertNotifier({
        slack: { webhookUrl: 'https://hooks.slack.com/x' },
        email: {
          apiUrl: 'https://api.sendgrid.com/v3/mail/send',
          apiKey: 'k',
          from: 'a@x.com',
          to: 'b@x.com',
        },
        pagerDuty: { integrationKey: 'k' },
        fetchImpl: fetch,
        defaultRetries: 0,
      });

      const results = await n.notify(makePayload({ severity: 'medium' }));
      expect(results).toHaveLength(2);
      const channels = results.map((r) => r.channel).sort();
      expect(channels).toEqual(['email', 'slack']);
      expect(calls).toHaveLength(2);
    });

    it('low 不触发任何渠道（默认阈值）', async () => {
      const { fetch, calls } = makeMockFetch([]);
      const n = new AlertNotifier({
        slack: { webhookUrl: 'https://hooks.slack.com/x' },
        email: {
          apiUrl: 'https://api.sendgrid.com/v3/mail/send',
          apiKey: 'k',
          from: 'a@x.com',
          to: 'b@x.com',
        },
        pagerDuty: { integrationKey: 'k' },
        fetchImpl: fetch,
        defaultRetries: 0,
      });

      const results = await n.notify(makePayload({ severity: 'low' }));
      expect(results).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });

    it('单个渠道失败不影响其他渠道', async () => {
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
      const n = new AlertNotifier({
        slack: { webhookUrl: 'https://fail.slack.com/x' },
        email: {
          apiUrl: 'https://api.sendgrid.com/v3/mail/send',
          apiKey: 'k',
          from: 'a@x.com',
          to: 'b@x.com',
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        defaultRetries: 0,
      });

      const results = await n.notify(makePayload({ severity: 'high' }));
      expect(results).toHaveLength(2);
      const okResults = results.filter((r) => r.ok);
      expect(okResults).toHaveLength(1);
      expect(okResults[0].channel).toBe('email');
    });

    it('所有渠道共享同一 alertId', async () => {
      const { fetch } = makeMockFetch([{ status: 200 }, { status: 202 }]);
      const n = new AlertNotifier({
        slack: { webhookUrl: 'https://hooks.slack.com/x' },
        email: {
          apiUrl: 'https://api.sendgrid.com/v3/mail/send',
          apiKey: 'k',
          from: 'a@x.com',
          to: 'b@x.com',
        },
        fetchImpl: fetch,
        defaultRetries: 0,
      });

      const results = await n.notify(makePayload({ severity: 'high' }));
      const ids = new Set(results.map((r) => r.alertId));
      expect(ids.size).toBe(1);
    });

    it('自定义 logger 在失败时被调用', async () => {
      const loggerCalls: string[] = [];
      const fetchImpl = vi.fn(async () => {
        throw new Error('network error');
      });
      const n = new AlertNotifier({
        slack: { webhookUrl: 'https://hooks.slack.com/x' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        defaultRetries: 0,
        logger: (msg: string) => loggerCalls.push(msg),
      });

      await n.notify(makePayload({ severity: 'high' }));
      expect(loggerCalls.length).toBeGreaterThan(0);
      expect(loggerCalls[0]).toMatch(/\[alert\] failed to notify slack/);
    });

    it('所有渠道失败时 results 长度等于配置的渠道数', async () => {
      const fetchImpl = vi.fn(async () => {
        throw new Error('network error');
      });
      const n = new AlertNotifier({
        slack: { webhookUrl: 'https://hooks.slack.com/x' },
        email: {
          apiUrl: 'https://api.sendgrid.com/v3/mail/send',
          apiKey: 'k',
          from: 'a@x.com',
          to: 'b@x.com',
        },
        pagerDuty: { integrationKey: 'k' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        defaultRetries: 0,
      });

      const results = await n.notify(makePayload({ severity: 'critical' }));
      expect(results).toHaveLength(3);
      expect(results.every((r) => !r.ok)).toBe(true);
    });
  });

  describe('便捷方法', () => {
    it('notifyCritical 强制 critical severity', async () => {
      const { fetch, calls } = makeMockFetch([{ status: 200 }, { status: 202 }, { status: 202 }]);
      const n = new AlertNotifier({
        slack: { webhookUrl: 'https://hooks.slack.com/x' },
        email: {
          apiUrl: 'https://api.sendgrid.com/v3/mail/send',
          apiKey: 'k',
          from: 'a@x.com',
          to: 'b@x.com',
        },
        pagerDuty: { integrationKey: 'k' },
        fetchImpl: fetch,
        defaultRetries: 0,
      });

      const results = await n.notifyCritical({
        title: 'Critical!',
        message: 'something critical',
      });
      expect(results).toHaveLength(3);
      // PagerDuty 应被触发（critical >= high）
      const pdResult = results.find((r) => r.channel === 'pagerduty');
      expect(pdResult).toBeDefined();
      expect(pdResult?.ok).toBe(true);
      void calls;
    });

    it('notifyHigh 强制 high severity', async () => {
      const { fetch } = makeMockFetch([{ status: 200 }, { status: 202 }, { status: 202 }]);
      const n = new AlertNotifier({
        slack: { webhookUrl: 'https://hooks.slack.com/x' },
        email: {
          apiUrl: 'https://api.sendgrid.com/v3/mail/send',
          apiKey: 'k',
          from: 'a@x.com',
          to: 'b@x.com',
        },
        pagerDuty: { integrationKey: 'k' },
        fetchImpl: fetch,
        defaultRetries: 0,
      });

      const results = await n.notifyHigh({
        title: 'High!',
        message: 'something high',
      });
      expect(results).toHaveLength(3);
    });

    it('notifyMedium 强制 medium severity（PagerDuty 不触发）', async () => {
      const { fetch } = makeMockFetch([{ status: 200 }, { status: 202 }]);
      const n = new AlertNotifier({
        slack: { webhookUrl: 'https://hooks.slack.com/x' },
        email: {
          apiUrl: 'https://api.sendgrid.com/v3/mail/send',
          apiKey: 'k',
          from: 'a@x.com',
          to: 'b@x.com',
        },
        pagerDuty: { integrationKey: 'k' },
        fetchImpl: fetch,
        defaultRetries: 0,
      });

      const results = await n.notifyMedium({
        title: 'Medium!',
        message: 'something medium',
      });
      expect(results).toHaveLength(2);
      const channels = results.map((r) => r.channel).sort();
      expect(channels).toEqual(['email', 'slack']);
    });
  });

  describe('webhook 通用渠道', () => {
    it('webhook 渠道总是触发（无 severity 过滤）', async () => {
      const { fetch, calls } = makeMockFetch([{ status: 200 }]);
      const n = new AlertNotifier({
        webhook: { url: 'https://example.com/hook' },
        fetchImpl: fetch,
        defaultRetries: 0,
      });

      const results = await n.notify(makePayload({ severity: 'info' }));
      expect(results).toHaveLength(1);
      expect(results[0].channel).toBe('webhook');
      expect(results[0].ok).toBe(true);
      expect(calls).toHaveLength(1);
    });
  });
});

// ==================== CLI 集成测试 ====================

interface TestState {
  stdout: string[];
  stderr: string[];
}

const testState: TestState = {
  stdout: [],
  stderr: [],
};

async function loadCli(opts: {
  argv: string[];
  env?: Record<string, string>;
}): Promise<{
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}> {
  const { argv, env = {} } = opts;

  testState.stdout = [];
  testState.stderr = [];

  const origArgv = process.argv;
  process.argv = ['node', '/tmp/cli.js', ...argv];

  const origEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    origEnv[k] = process.env[k];
    process.env[k] = v;
  }

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    testState.stdout.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    testState.stderr.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });

  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    const err = new Error(`__PROCESS_EXIT_${code ?? 0}__`);
    throw err;
  }) as never);

  vi.resetModules();

  try {
    await import('../../../src/cli.js');
    return {
      stdout: [...testState.stdout],
      stderr: [...testState.stderr],
      exitCode: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const match = msg.match(/^__PROCESS_EXIT_(\d+)__$/);
    if (match) {
      return {
        stdout: [...testState.stdout],
        stderr: [...testState.stderr],
        exitCode: parseInt(match[1], 10),
      };
    }
    throw err;
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    process.argv = origArgv;
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    vi.resetModules();
  }
}

describe('alert 命令 CLI 集成', () => {
  beforeEach(() => {
    testState.stdout = [];
    testState.stderr = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CODE_REVIEW_ALERT_NO_NETWORK;
  });

  it('缺少 --severity 与 --message 时输出 usage 并退出 1', async () => {
    const { exitCode, stderr } = await loadCli({
      argv: ['alert'],
    });
    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toMatch(/Usage:.*--severity/);
  });

  it('缺少 --message 时退出 1', async () => {
    const { exitCode, stderr } = await loadCli({
      argv: ['alert', '--severity', 'high'],
    });
    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toMatch(/Usage:/);
  });

  it('无效 --severity 时退出 1', async () => {
    const { exitCode, stderr } = await loadCli({
      argv: ['alert', '--severity', 'urgent', '--message', 'test'],
    });
    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toMatch(/invalid severity/);
  });

  it('未配置任何渠道时退出 1', async () => {
    const { exitCode, stderr } = await loadCli({
      argv: ['alert', '--severity', 'high', '--message', 'test'],
    });
    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toMatch(/at least one channel/);
  });

  it('email 缺少 --email-api-url / --email-api-key 时退出 1', async () => {
    const { exitCode, stderr } = await loadCli({
      argv: ['alert', '--severity', 'high', '--message', 'test', '--email-to', 'a@x.com'],
    });
    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toMatch(/email-api-url and --email-api-key are required/);
  });

  it('无效 --slack-min-severity 时退出 1', async () => {
    const { exitCode, stderr } = await loadCli({
      argv: [
        'alert',
        '--severity', 'high',
        '--message', 'test',
        '--slack-url', 'https://hooks.slack.com/x',
        '--slack-min-severity', 'urgent',
      ],
    });
    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toMatch(/invalid --slack-min-severity/);
  });

  it('CODE_REVIEW_ALERT_NO_NETWORK=1 dry-run 模式输出 payload JSON', async () => {
    const { exitCode, stdout } = await loadCli({
      argv: [
        'alert',
        '--severity', 'critical',
        '--message', 'critical issue',
        '--title', 'Critical Alert',
        '--source', 'security-review',
        '--file', 'src/app.ts',
        '--line', '42',
        '--pr-number', '7',
        '--repository', 'acme/repo',
        '--slack-url', 'https://hooks.slack.com/x',
        '--email-to', 'a@x.com',
        '--email-api-url', 'https://api.sendgrid.com/v3/mail/send',
        '--email-api-key', 'SG.k',
        '--pagerduty-key', 'pd-key',
      ],
      env: { CODE_REVIEW_ALERT_NO_NETWORK: '1' },
    });

    expect(exitCode).toBeNull();
    const out = stdout.join('\n');
    const parsed = JSON.parse(out);
    expect(parsed.mode).toBe('dry-run');
    expect(parsed.payload.severity).toBe('critical');
    expect(parsed.payload.title).toBe('Critical Alert');
    expect(parsed.payload.source).toBe('security-review');
    expect(parsed.payload.file).toBe('src/app.ts');
    expect(parsed.payload.line).toBe(42);
    expect(parsed.payload.prNumber).toBe(7);
    expect(parsed.payload.repository).toBe('acme/repo');
    expect(parsed.channels.slack).toBe(true);
    expect(parsed.channels.email).toBe(true);
    expect(parsed.channels.pagerDuty).toBe(true);
  });

  it('dry-run 模式仅 Slack 渠道', async () => {
    const { exitCode, stdout } = await loadCli({
      argv: [
        'alert',
        '--severity', 'medium',
        '--message', 'medium issue',
        '--slack-url', 'https://hooks.slack.com/x',
      ],
      env: { CODE_REVIEW_ALERT_NO_NETWORK: '1' },
    });

    expect(exitCode).toBeNull();
    const parsed = JSON.parse(stdout.join('\n'));
    expect(parsed.channels.slack).toBe(true);
    expect(parsed.channels.email).toBe(false);
    expect(parsed.channels.pagerDuty).toBe(false);
  });

  it('自定义 --slack-min-severity 在 dry-run 模式被接受', async () => {
    const { exitCode, stdout } = await loadCli({
      argv: [
        'alert',
        '--severity', 'low',
        '--message', 'low issue',
        '--slack-url', 'https://hooks.slack.com/x',
        '--slack-min-severity', 'low',
      ],
      env: { CODE_REVIEW_ALERT_NO_NETWORK: '1' },
    });
    expect(exitCode).toBeNull();
    const parsed = JSON.parse(stdout.join('\n'));
    expect(parsed.payload.severity).toBe('low');
  });

  it('--line 非数字时被忽略（不报错）', async () => {
    const { exitCode, stdout } = await loadCli({
      argv: [
        'alert',
        '--severity', 'high',
        '--message', 'test',
        '--slack-url', 'https://hooks.slack.com/x',
        '--line', 'not-a-number',
      ],
      env: { CODE_REVIEW_ALERT_NO_NETWORK: '1' },
    });
    expect(exitCode).toBeNull();
    const parsed = JSON.parse(stdout.join('\n'));
    expect(parsed.payload.line).toBeUndefined();
  });

  it('--pr-number 非数字时被忽略', async () => {
    const { exitCode, stdout } = await loadCli({
      argv: [
        'alert',
        '--severity', 'high',
        '--message', 'test',
        '--slack-url', 'https://hooks.slack.com/x',
        '--pr-number', 'abc',
      ],
      env: { CODE_REVIEW_ALERT_NO_NETWORK: '1' },
    });
    expect(exitCode).toBeNull();
    const parsed = JSON.parse(stdout.join('\n'));
    expect(parsed.payload.prNumber).toBeUndefined();
  });

  it('默认 --title 为 Code Review Alert', async () => {
    const { exitCode, stdout } = await loadCli({
      argv: [
        'alert',
        '--severity', 'high',
        '--message', 'test',
        '--slack-url', 'https://hooks.slack.com/x',
      ],
      env: { CODE_REVIEW_ALERT_NO_NETWORK: '1' },
    });
    expect(exitCode).toBeNull();
    const parsed = JSON.parse(stdout.join('\n'));
    expect(parsed.payload.title).toBe('Code Review Alert');
  });
});
