// src/alert-notifier.ts — Task 20：告警通知
//
// 职责：
// 1. AlertNotifier 类：管理多个通知渠道（Slack / Email / PagerDuty），按 severity 分发
// 2. sendAlert：通用告警发送函数，根据 channel 类型路由到具体实现
// 3. sendSlackAlert：发送 Slack Incoming Webhook 消息
// 4. sendEmailAlert：发送邮件（通过 HTTP API，如 SendGrid / Mailgun 兼容接口）
// 5. sendPagerDutyAlert：发送 PagerDuty Events API v2 事件
//
// 设计取舍：
// - 仅使用 Node 18+ 内置 fetch；测试可通过 fetchImpl 选项注入 mock
// - 邮件通过 HTTP API 发送（不引入 nodemailer 等外部 SMTP 依赖）
// - 多渠道并行发送，单个失败不影响其他渠道
// - severity 过滤：critical/high 默认触发 PagerDuty，medium 触发 Slack，低级别不发 PagerDuty
// - 退避重试：网络错误 / 5xx 状态码重试，4xx 不重试（与 webhook-notifier 一致）
//
// 与 cli.ts 集成：
// - `code-review alert --severity <sev> --message <text>` 命令行触发告警
// - 通过 --slack-url / --email-to / --pagerduty-key 指定接收方

// ==================== 类型定义 ====================

import type { Severity } from './types.js';

/** 告警严重度（兼容 Severity 与 info） */
export type AlertSeverity = Severity | 'info';

/** 告警渠道类型 */
export type AlertChannel = 'slack' | 'email' | 'pagerduty' | 'webhook';

/** 告警事件类型（PagerDuty 专用） */
export type PagerDutyEventType = 'trigger' | 'resolve' | 'acknowledge';

/** 告警 payload */
export interface AlertPayload {
  /** 告警标题（必填） */
  title: string;
  /** 告警消息内容（必填） */
  message: string;
  /** 严重度 */
  severity: AlertSeverity;
  /** 来源（如 'code-review' / 'security-review'） */
  source?: string;
  /** 关联的 finding ID（可选） */
  findingId?: string;
  /** 关联的文件路径（可选） */
  file?: string;
  /** 关联的行号（可选） */
  line?: number;
  /** 关联的 PR 编号（可选） */
  prNumber?: number;
  /** 关联的仓库（可选） */
  repository?: string;
  /** 触发时间戳（ISO 8601，自动生成） */
  timestamp?: string;
  /** 告警唯一 ID（自动生成，用于去重与 PagerDuty dedup_key） */
  alertId?: string;
  /** 自定义 metadata */
  metadata?: Record<string, unknown>;
}

/** 告警发送结果 */
export interface SendAlertResult {
  /** 渠道类型 */
  channel: AlertChannel;
  /** 是否成功 */
  ok: boolean;
  /** HTTP 状态码（请求发出时） */
  status?: number;
  /** 错误信息（失败时） */
  error?: string;
  /** 目标 URL 或地址（便于日志记录） */
  target: string;
  /** 告警 ID */
  alertId?: string;
}

/** Slack 渠道配置 */
export interface SlackConfig {
  /** Slack Incoming Webhook URL */
  webhookUrl: string;
  /** 自定义请求头（可选） */
  headers?: Record<string, string>;
  /** Slack channel 覆盖（可选，需 Slack 应用允许覆盖） */
  channel?: string;
  /** Slack 用户名覆盖（可选） */
  username?: string;
  /** Slack emoji 图标（可选） */
  iconEmoji?: string;
}

/** Email 渠道配置 */
export interface EmailConfig {
  /** 邮件 API endpoint（如 SendGrid v3 /mail/send） */
  apiUrl: string;
  /** API key（Bearer token） */
  apiKey: string;
  /** 发件人地址 */
  from: string;
  /** 收件人地址（多个用逗号分隔或数组） */
  to: string | string[];
  /** 邮件主题前缀（可选，默认 '[Code Review Alert]'） */
  subjectPrefix?: string;
  /** 自定义请求头（可选） */
  headers?: Record<string, string>;
}

/** PagerDuty 渠道配置 */
export interface PagerDutyConfig {
  /** PagerDuty Events API v2 integration key */
  integrationKey: string;
  /** 自定义请求头（可选） */
  headers?: Record<string, string>;
  /** PagerDuty API URL（可选，默认 https://events.pagerduty.com/v2/enqueue） */
  apiUrl?: string;
}

/** Webhook 渠道配置（通用） */
export interface WebhookConfig {
  /** Webhook URL */
  url: string;
  /** 自定义请求头（可选） */
  headers?: Record<string, string>;
  /** 自定义 secret（用于 HMAC 签名，可选） */
  secret?: string;
}

/** 告警发送选项 */
export interface SendAlertOptions {
  /** 请求超时（ms，默认 5000） */
  timeoutMs?: number;
  /** 重试次数（默认 1） */
  retries?: number;
  /** 自定义 fetch 实现（用于测试） */
  fetchImpl?: typeof fetch;
  /** PagerDuty 事件类型（默认 trigger） */
  pagerDutyEventType?: PagerDutyEventType;
}

/** AlertNotifier 构造选项 */
export interface AlertNotifierOptions {
  /** Slack 配置（可选） */
  slack?: SlackConfig;
  /** Email 配置（可选） */
  email?: EmailConfig;
  /** PagerDuty 配置（可选） */
  pagerDuty?: PagerDutyConfig;
  /** 通用 Webhook 配置（可选） */
  webhook?: WebhookConfig;
  /** 默认请求超时（ms，默认 5000） */
  defaultTimeoutMs?: number;
  /** 默认重试次数（默认 1） */
  defaultRetries?: number;
  /** 自定义 fetch 实现（用于测试） */
  fetchImpl?: typeof fetch;
  /** 自定义日志函数（默认 console.warn） */
  logger?: (message: string, ...args: unknown[]) => void;
  /** 触发 PagerDuty 的最低 severity（默认 'high'） */
  pagerDutyMinSeverity?: AlertSeverity;
  /** 触发 Slack 的最低 severity（默认 'medium'） */
  slackMinSeverity?: AlertSeverity;
  /** 触发 Email 的最低 severity（默认 'medium'） */
  emailMinSeverity?: AlertSeverity;
}

// ==================== 工具函数 ====================

/** Severity 优先级排序（数值越大越严重） */
const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/** 比较两个 severity（>= 时返回 true） */
export function severityAtLeast(a: AlertSeverity, threshold: AlertSeverity): boolean {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[threshold];
}

/** Slack 消息颜色映射 */
const SLACK_COLOR: Record<AlertSeverity, string> = {
  critical: '#dc143c',
  high: '#ff8c00',
  medium: '#ffd700',
  low: '#4682b4',
  info: '#808080',
};

/** PagerDuty 严重度映射（PagerDuty 支持 critical / error / warning / info） */
const PAGERDUTY_SEVERITY: Record<AlertSeverity, 'critical' | 'error' | 'warning' | 'info'> = {
  critical: 'critical',
  high: 'error',
  medium: 'warning',
  low: 'info',
  info: 'info',
};

/** 生成告警 ID（时间戳 + 随机串） */
function generateAlertId(): string {
  return `alert_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 生成 PagerDuty dedup_key（基于 alertId） */
function generateDedupKey(alertId: string): string {
  return `code-review:${alertId}`;
}

/** 格式化 Slack 消息 payload */
function formatSlackPayload(payload: AlertPayload, config: SlackConfig): Record<string, unknown> {
  const color = SLACK_COLOR[payload.severity] ?? SLACK_COLOR.info;
  const fields: Array<{ title: string; value: string; short: boolean }> = [];
  if (payload.source) fields.push({ title: 'Source', value: payload.source, short: true });
  if (payload.file) fields.push({ title: 'File', value: payload.file, short: true });
  if (payload.line !== undefined) fields.push({ title: 'Line', value: String(payload.line), short: true });
  if (payload.repository) fields.push({ title: 'Repository', value: payload.repository, short: true });
  if (payload.prNumber !== undefined) fields.push({ title: 'PR', value: `#${payload.prNumber}`, short: true });

  const body: Record<string, unknown> = {
    text: `${payload.title}`,
    attachments: [
      {
        color,
        title: payload.title,
        text: payload.message,
        fields,
        footer: 'code-review alert-notifier',
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };
  if (config.channel) body.channel = config.channel;
  if (config.username) body.username = config.username;
  if (config.iconEmoji) body.icon_emoji = config.iconEmoji;
  return body;
}

/** 格式化 Email API payload（兼容 SendGrid v3 /mail/send） */
function formatEmailPayload(
  payload: AlertPayload,
  config: EmailConfig,
): { subject: string; body: Record<string, unknown> } {
  const prefix = config.subjectPrefix ?? '[Code Review Alert]';
  const subject = `${prefix} [${payload.severity.toUpperCase()}] ${payload.title}`;
  const recipients = Array.isArray(config.to) ? config.to : config.to.split(',').map((s) => s.trim());
  const personalizations = recipients.map((email) => ({ to: [{ email }] }));

  // 构建纯文本邮件正文
  const lines: string[] = [
    `${payload.title}`,
    '',
    `Severity: ${payload.severity}`,
    `Time: ${payload.timestamp ?? new Date().toISOString()}`,
  ];
  if (payload.source) lines.push(`Source: ${payload.source}`);
  if (payload.file) {
    lines.push(`File: ${payload.file}${payload.line !== undefined ? `:${payload.line}` : ''}`);
  }
  if (payload.repository) lines.push(`Repository: ${payload.repository}`);
  if (payload.prNumber !== undefined) lines.push(`PR: #${payload.prNumber}`);
  if (payload.findingId) lines.push(`Finding ID: ${payload.findingId}`);
  lines.push('', 'Message:', payload.message);
  if (payload.metadata) {
    lines.push('', 'Metadata:', JSON.stringify(payload.metadata, null, 2));
  }

  const body = {
    personalizations,
    from: { email: config.from },
    subject,
    content: [
      {
        type: 'text/plain',
        value: lines.join('\n'),
      },
    ],
  };
  return { subject, body };
}

/** 格式化 PagerDuty Events API v2 payload */
function formatPagerDutyPayload(
  payload: AlertPayload,
  config: PagerDutyConfig,
  eventType: PagerDutyEventType,
): Record<string, unknown> {
  const dedupKey = generateDedupKey(payload.alertId ?? generateAlertId());
  const severity = PAGERDUTY_SEVERITY[payload.severity] ?? 'info';
  const details: Record<string, unknown> = {
    message: payload.message,
    severity: payload.severity,
    timestamp: payload.timestamp ?? new Date().toISOString(),
  };
  if (payload.source) details.source = payload.source;
  if (payload.file) details.file = payload.file;
  if (payload.line !== undefined) details.line = payload.line;
  if (payload.repository) details.repository = payload.repository;
  if (payload.prNumber !== undefined) details.prNumber = payload.prNumber;
  if (payload.findingId) details.findingId = payload.findingId;
  if (payload.metadata) details.metadata = payload.metadata;

  return {
    routing_key: config.integrationKey,
    event_action: eventType,
    dedup_key: dedupKey,
    payload: {
      summary: payload.title,
      severity,
      source: payload.source ?? 'code-review',
      component: payload.file ?? 'unknown',
      custom_details: details,
    },
  };
}

/** 执行 fetch 请求并处理重试 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: SendAlertOptions,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const { timeoutMs = 5000, retries = 1, fetchImpl } = options;
  const fetchFn = fetchImpl ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return { ok: false, error: 'fetch is not available in this environment' };
  }

  let lastError: string | undefined;
  let lastStatus: number | undefined;
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchFn(url, { ...init, signal: controller.signal });
        clearTimeout(timer);
        lastStatus = response.status;
        if (response.ok) {
          return { ok: true, status: response.status };
        }
        lastError = `HTTP ${response.status} ${response.statusText}`;
        // 4xx (非 429) 不重试
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return { ok: false, status: response.status, error: lastError };
        }
      } catch (err) {
        clearTimeout(timer);
        throw err;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    attempt++;
    if (attempt <= retries) {
      await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
    }
  }
  return { ok: false, status: lastStatus, error: lastError };
}

// ==================== 渠道发送函数 ====================

/**
 * 发送 Slack 告警消息。
 *
 * 使用 Slack Incoming Webhook；测试时可通过 fetchImpl 注入 mock。
 *
 * @param config Slack 配置
 * @param payload 告警 payload
 * @param options 发送选项
 */
export async function sendSlackAlert(
  config: SlackConfig,
  payload: AlertPayload,
  options: SendAlertOptions = {},
): Promise<SendAlertResult> {
  const target = config.webhookUrl;
  const alertId = payload.alertId ?? generateAlertId();
  const fullPayload: AlertPayload = { ...payload, alertId, timestamp: payload.timestamp ?? new Date().toISOString() };
  const body = JSON.stringify(formatSlackPayload(fullPayload, config));
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'code-review-alert/0.1.0',
    ...config.headers,
  };

  const result = await fetchWithRetry(
    target,
    { method: 'POST', headers, body },
    options,
  );
  return {
    channel: 'slack',
    target,
    alertId,
    ...result,
  };
}

/**
 * 发送邮件告警（通过 HTTP API，兼容 SendGrid v3 /mail/send）。
 *
 * @param config Email 配置
 * @param payload 告警 payload
 * @param options 发送选项
 */
export async function sendEmailAlert(
  config: EmailConfig,
  payload: AlertPayload,
  options: SendAlertOptions = {},
): Promise<SendAlertResult> {
  const target = config.apiUrl;
  const alertId = payload.alertId ?? generateAlertId();
  const fullPayload: AlertPayload = { ...payload, alertId, timestamp: payload.timestamp ?? new Date().toISOString() };
  const { body: emailBody } = formatEmailPayload(fullPayload, config);
  const body = JSON.stringify(emailBody);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'code-review-alert/0.1.0',
    Authorization: `Bearer ${config.apiKey}`,
    ...config.headers,
  };

  const result = await fetchWithRetry(
    target,
    { method: 'POST', headers, body },
    options,
  );
  return {
    channel: 'email',
    target,
    alertId,
    ...result,
  };
}

/**
 * 发送 PagerDuty 告警事件（Events API v2）。
 *
 * @param config PagerDuty 配置
 * @param payload 告警 payload
 * @param options 发送选项（pagerDutyEventType 默认 'trigger'）
 */
export async function sendPagerDutyAlert(
  config: PagerDutyConfig,
  payload: AlertPayload,
  options: SendAlertOptions = {},
): Promise<SendAlertResult> {
  const target = config.apiUrl ?? 'https://events.pagerduty.com/v2/enqueue';
  const alertId = payload.alertId ?? generateAlertId();
  const fullPayload: AlertPayload = { ...payload, alertId, timestamp: payload.timestamp ?? new Date().toISOString() };
  const eventType = options.pagerDutyEventType ?? 'trigger';
  const body = JSON.stringify(formatPagerDutyPayload(fullPayload, config, eventType));
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'code-review-alert/0.1.0',
    ...config.headers,
  };

  const result = await fetchWithRetry(
    target,
    { method: 'POST', headers, body },
    options,
  );
  return {
    channel: 'pagerduty',
    target,
    alertId,
    ...result,
  };
}

/**
 * 通用告警发送函数：根据 channel 类型路由到具体实现。
 *
 * @param channel 渠道类型
 * @param config 渠道配置
 * @param payload 告警 payload
 * @param options 发送选项
 */
export async function sendAlert(
  channel: AlertChannel,
  config: SlackConfig | EmailConfig | PagerDutyConfig | WebhookConfig,
  payload: AlertPayload,
  options: SendAlertOptions = {},
): Promise<SendAlertResult> {
  switch (channel) {
    case 'slack':
      return sendSlackAlert(config as SlackConfig, payload, options);
    case 'email':
      return sendEmailAlert(config as EmailConfig, payload, options);
    case 'pagerduty':
      return sendPagerDutyAlert(config as PagerDutyConfig, payload, options);
    case 'webhook': {
      // 通用 Webhook：直接 POST JSON
      const cfg = config as WebhookConfig;
      const target = cfg.url;
      const alertId = payload.alertId ?? generateAlertId();
      const fullPayload: AlertPayload = {
        ...payload,
        alertId,
        timestamp: payload.timestamp ?? new Date().toISOString(),
      };
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'code-review-alert/0.1.0',
        'X-Alert-Id': alertId,
        'X-Alert-Severity': payload.severity,
        ...cfg.headers,
      };
      const result = await fetchWithRetry(
        target,
        { method: 'POST', headers, body: JSON.stringify(fullPayload) },
        options,
      );
      return {
        channel: 'webhook',
        target,
        alertId,
        ...result,
      };
    }
    default: {
      // 编译期穷尽检查
      const _: never = channel;
      void _;
      return {
        channel,
        target: '',
        ok: false,
        error: `unsupported channel: ${channel}`,
      };
    }
  }
}

// ==================== AlertNotifier 类 ====================

/**
 * 多渠道告警通知器。
 *
 * 使用方式：
 * 1. const notifier = new AlertNotifier({ slack, email, pagerDuty })
 * 2. await notifier.notify(payload) — 自动按 severity 路由到合适的渠道
 *
 * severity 路由策略（可配置）：
 * - critical / high：触发所有配置的渠道（含 PagerDuty）
 * - medium：触发 Slack + Email
 * - low / info：仅触发 Slack（如已配置）
 */
export class AlertNotifier {
  private readonly slack?: SlackConfig;
  private readonly email?: EmailConfig;
  private readonly pagerDuty?: PagerDutyConfig;
  private readonly webhook?: WebhookConfig;
  private readonly defaultTimeoutMs: number;
  private readonly defaultRetries: number;
  private readonly fetchImpl?: typeof fetch;
  private readonly logger: (message: string, ...args: unknown[]) => void;
  private readonly pagerDutyMinSeverity: AlertSeverity;
  private readonly slackMinSeverity: AlertSeverity;
  private readonly emailMinSeverity: AlertSeverity;

  constructor(options: AlertNotifierOptions = {}) {
    this.slack = options.slack;
    this.email = options.email;
    this.pagerDuty = options.pagerDuty;
    this.webhook = options.webhook;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 5000;
    this.defaultRetries = options.defaultRetries ?? 1;
    this.fetchImpl = options.fetchImpl;
    this.logger = options.logger ?? console.warn;
    this.pagerDutyMinSeverity = options.pagerDutyMinSeverity ?? 'high';
    this.slackMinSeverity = options.slackMinSeverity ?? 'medium';
    this.emailMinSeverity = options.emailMinSeverity ?? 'medium';
  }

  /** 是否配置了指定渠道 */
  hasChannel(channel: AlertChannel): boolean {
    switch (channel) {
      case 'slack':
        return Boolean(this.slack);
      case 'email':
        return Boolean(this.email);
      case 'pagerduty':
        return Boolean(this.pagerDuty);
      case 'webhook':
        return Boolean(this.webhook);
      default:
        return false;
    }
  }

  /** 是否会针对指定 severity 触发指定渠道 */
  shouldNotify(channel: AlertChannel, severity: AlertSeverity): boolean {
    if (!this.hasChannel(channel)) return false;
    switch (channel) {
      case 'slack':
        return severityAtLeast(severity, this.slackMinSeverity);
      case 'email':
        return severityAtLeast(severity, this.emailMinSeverity);
      case 'pagerduty':
        return severityAtLeast(severity, this.pagerDutyMinSeverity);
      case 'webhook':
        return true; // 通用 webhook 总是触发
      default:
        return false;
    }
  }

  /**
   * 通知所有匹配 severity 的渠道。
   *
   * 单个渠道失败不影响其他渠道；所有结果汇总返回。
   * 若无渠道匹配，返回空数组。
   *
   * @param payload 告警 payload（自动生成 alertId / timestamp）
   */
  async notify(payload: AlertPayload): Promise<SendAlertResult[]> {
    const alertId = payload.alertId ?? generateAlertId();
    const fullPayload: AlertPayload = {
      ...payload,
      alertId,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    };

    const tasks: Array<Promise<SendAlertResult>> = [];
    const opts: SendAlertOptions = {
      timeoutMs: this.defaultTimeoutMs,
      retries: this.defaultRetries,
      fetchImpl: this.fetchImpl,
    };

    if (this.shouldNotify('slack', payload.severity) && this.slack) {
      tasks.push(sendSlackAlert(this.slack, fullPayload, opts));
    }
    if (this.shouldNotify('email', payload.severity) && this.email) {
      tasks.push(sendEmailAlert(this.email, fullPayload, opts));
    }
    if (this.shouldNotify('pagerduty', payload.severity) && this.pagerDuty) {
      tasks.push(sendPagerDutyAlert(this.pagerDuty, fullPayload, opts));
    }
    if (this.shouldNotify('webhook', payload.severity) && this.webhook) {
      tasks.push(sendAlert('webhook', this.webhook, fullPayload, opts));
    }

    const results = await Promise.all(tasks);
    for (const result of results) {
      if (!result.ok) {
        this.logger(
          `[alert] failed to notify ${result.channel} (${result.target}): ${result.error ?? 'unknown error'}`,
        );
      }
    }
    return results;
  }

  /** 便捷方法：发送 critical 告警（强制所有渠道） */
  async notifyCritical(payload: Omit<AlertPayload, 'severity'>): Promise<SendAlertResult[]> {
    return this.notify({ ...payload, severity: 'critical' });
  }

  /** 便捷方法：发送 high 告警 */
  async notifyHigh(payload: Omit<AlertPayload, 'severity'>): Promise<SendAlertResult[]> {
    return this.notify({ ...payload, severity: 'high' });
  }

  /** 便捷方法：发送 medium 告警 */
  async notifyMedium(payload: Omit<AlertPayload, 'severity'>): Promise<SendAlertResult[]> {
    return this.notify({ ...payload, severity: 'medium' });
  }
}
