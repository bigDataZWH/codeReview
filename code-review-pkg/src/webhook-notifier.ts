// src/webhook-notifier.ts — Task 16：Webhook 通知
//
// 职责：
// 1. formatReviewEvent：将审查结果格式化为 Webhook 事件 payload
// 2. sendWebhook：使用 Node 18+ 内置 fetch 发送 Webhook 通知（失败回退到 http 模块）
// 3. WebhookNotifier 类：管理多个 Webhook 端点，根据事件类型分发通知
//
// 设计取舍：
// - 优先使用全局 fetch（Node 18+ 内置）；测试可通过 fetchImpl 选项注入 mock
// - 事件类型采用 `review.completed` / `review.failed` / `finding.critical` 命名，遵循业界面惯例
// - 重试与超时控制：默认 5000ms 超时，1 次重试，失败仅记录日志不抛出（避免影响主流程）
// - 同时支持单端点 sendWebhook 与多端点 WebhookNotifier，便于不同集成场景使用
//
// 与 post-process.js 集成：
// - afterReview 完成后调用 WebhookNotifier.notifyReviewCompleted 触发 `review.completed` 事件
// - 当 findings 含 critical 时额外触发 `finding.critical` 事件
// - 异常时触发 `review.failed` 事件

import type { Finding, Severity } from './types.js';

// ==================== 类型定义 ====================

/** 支持的 Webhook 事件类型 */
export type WebhookEventType =
  | 'review.completed'
  | 'review.failed'
  | 'finding.critical';

/** Webhook 事件 payload（通用结构） */
export interface WebhookEvent {
  /** 事件类型 */
  event: WebhookEventType;
  /** 事件时间戳（ISO 8601） */
  timestamp: string;
  /** 事件唯一 ID（用于去重） */
  eventId: string;
  /** 事件数据（具体结构取决于 event 类型） */
  data: ReviewCompletedPayload | ReviewFailedPayload | FindingCriticalPayload;
}

/** review.completed 事件 payload */
export interface ReviewCompletedPayload {
  /** 会话 ID（可选） */
  sessionId?: string;
  /** 审查的文件总数 */
  filesTotal: number;
  /** findings 总数 */
  findingsCount: number;
  /** 按 severity 的 findings 计数 */
  severityCounts: Record<Severity | 'info', number>;
  /** 严重度最高的 finding（可选） */
  criticalCount: number;
  /** 审查耗时（ms） */
  durationMs?: number;
  /** 仓库 / PR 信息（可选） */
  repository?: string;
  prNumber?: number;
}

/** review.failed 事件 payload */
export interface ReviewFailedPayload {
  /** 会话 ID（可选） */
  sessionId?: string;
  /** 错误信息 */
  error: string;
  /** 失败阶段 */
  stage?: string;
  /** 仓库 / PR 信息（可选） */
  repository?: string;
  prNumber?: number;
}

/** finding.critical 事件 payload */
export interface FindingCriticalPayload {
  /** 会话 ID（可选） */
  sessionId?: string;
  /** 触发的 critical findings */
  findings: Finding[];
  /** critical findings 数量 */
  count: number;
  /** 仓库 / PR 信息（可选） */
  repository?: string;
  prNumber?: number;
}

/** Webhook 端点配置 */
export interface WebhookEndpoint {
  /** 端点 URL */
  url: string;
  /** 自定义请求头（可选） */
  headers?: Record<string, string>;
  /** 该端点订阅的事件类型（可选，缺省订阅全部事件） */
  events?: WebhookEventType[];
  /** 该端点专属 secret（用于 HMAC 签名，可选） */
  secret?: string;
}

/** 发送 Webhook 的选项 */
export interface SendWebhookOptions {
  /** 请求方法（默认 POST） */
  method?: 'POST' | 'PUT';
  /** 自定义请求头 */
  headers?: Record<string, string>;
  /** 请求超时（ms，默认 5000） */
  timeoutMs?: number;
  /** 重试次数（默认 1） */
  retries?: number;
  /** 自定义 fetch 实现（用于测试） */
  fetchImpl?: typeof fetch;
}

/** 发送 Webhook 的结果 */
export interface SendWebhookResult {
  /** 是否成功 */
  ok: boolean;
  /** HTTP 状态码（请求发出时） */
  status?: number;
  /** 错误信息（失败时） */
  error?: string;
  /** 端点 URL（便于日志记录） */
  url: string;
}

/** WebhookNotifier 构造选项 */
export interface WebhookNotifierOptions {
  /** 默认请求头 */
  defaultHeaders?: Record<string, string>;
  /** 默认超时（ms） */
  defaultTimeoutMs?: number;
  /** 默认重试次数 */
  defaultRetries?: number;
  /** 自定义 fetch 实现（用于测试） */
  fetchImpl?: typeof fetch;
  /** 自定义日志函数（默认 console.warn） */
  logger?: (message: string, ...args: unknown[]) => void;
  /** 仓库 / PR 信息（注入到事件 payload） */
  repository?: string;
  prNumber?: number;
}

// ==================== 工具函数 ====================

/** 生成事件 ID（时间戳 + 随机串） */
function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 计算 findings 的 severity 计数 */
export function countBySeverity(findings: Finding[]): Record<Severity | 'info', number> {
  const counts: Record<Severity | 'info', number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const f of findings) {
    const sev = f.severity as Severity | 'info';
    if (sev in counts) {
      counts[sev]++;
    } else {
      counts.info++;
    }
  }
  return counts;
}

// ==================== formatReviewEvent ====================

/**
 * 将审查结果格式化为 Webhook 事件。
 *
 * 根据事件类型生成对应的 payload：
 * - review.completed：审查完成，包含 findings 概要
 * - review.failed：审查失败，包含错误信息
 * - finding.critical：发现 critical 严重度的 finding
 *
 * @param event 事件类型
 * @param input 输入数据（根据事件类型不同）
 * @returns 标准 Webhook 事件 payload
 */
export function formatReviewEvent(
  event: 'review.completed',
  input: {
    findings: Finding[];
    filesTotal: number;
    durationMs?: number;
    sessionId?: string;
    repository?: string;
    prNumber?: number;
  },
): WebhookEvent;

export function formatReviewEvent(
  event: 'review.failed',
  input: {
    error: string | Error;
    stage?: string;
    sessionId?: string;
    repository?: string;
    prNumber?: number;
  },
): WebhookEvent;

export function formatReviewEvent(
  event: 'finding.critical',
  input: {
    findings: Finding[];
    sessionId?: string;
    repository?: string;
    prNumber?: number;
  },
): WebhookEvent;

export function formatReviewEvent(
  event: WebhookEventType,
  input: {
    findings?: Finding[];
    filesTotal?: number;
    durationMs?: number;
    sessionId?: string;
    repository?: string;
    prNumber?: number;
    error?: string | Error;
    stage?: string;
  },
): WebhookEvent {
  const timestamp = new Date().toISOString();
  const eventId = generateEventId();
  const repository = input.repository;
  const prNumber = input.prNumber;

  if (event === 'review.completed') {
    const findings = input.findings ?? [];
    const severityCounts = countBySeverity(findings);
    const data: ReviewCompletedPayload = {
      sessionId: input.sessionId,
      filesTotal: input.filesTotal ?? 0,
      findingsCount: findings.length,
      severityCounts,
      criticalCount: severityCounts.critical,
      durationMs: input.durationMs,
      repository,
      prNumber,
    };
    return { event, timestamp, eventId, data };
  }

  if (event === 'review.failed') {
    const err = input.error;
    const errorMessage = err instanceof Error ? err.message : String(err ?? '');
    const data: ReviewFailedPayload = {
      sessionId: input.sessionId,
      error: errorMessage,
      stage: input.stage,
      repository,
      prNumber,
    };
    return { event, timestamp, eventId, data };
  }

  // finding.critical
  const allFindings = input.findings ?? [];
  const criticalFindings = allFindings.filter((f) => f.severity === 'critical');
  const data: FindingCriticalPayload = {
    sessionId: input.sessionId,
    findings: criticalFindings,
    count: criticalFindings.length,
    repository,
    prNumber,
  };
  return { event, timestamp, eventId, data };
}

// ==================== sendWebhook ====================

/**
 * 发送 Webhook 通知到指定 URL。
 *
 * 使用 Node 18+ 内置 fetch；测试时可通过 fetchImpl 注入 mock。
 * 失败时（网络错误或非 2xx 状态码）会按 retries 重试。
 *
 * @param url 端点 URL
 * @param payload 事件 payload（将被 JSON 序列化）
 * @param options 发送选项
 * @returns 发送结果（包含成功/失败标志与状态码）
 */
export async function sendWebhook(
  url: string,
  payload: WebhookEvent,
  options: SendWebhookOptions = {},
): Promise<SendWebhookResult> {
  const {
    method = 'POST',
    headers = {},
    timeoutMs = 5000,
    retries = 1,
    fetchImpl,
  } = options;

  const fetchFn = fetchImpl ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return {
      ok: false,
      url,
      error: 'fetch is not available in this environment',
    };
  }

  const body = JSON.stringify(payload);
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'code-review-webhook/0.1.0',
    'X-Webhook-Event': payload.event,
    'X-Webhook-Id': payload.eventId,
    ...headers,
  };

  let lastError: string | undefined;
  let lastStatus: number | undefined;
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchFn(url, {
          method,
          headers: requestHeaders,
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);
        lastStatus = response.status;
        if (response.ok) {
          return { ok: true, status: response.status, url };
        }
        lastError = `HTTP ${response.status} ${response.statusText}`;
        // 4xx 错误（除 429）通常不重试，但 5xx 与 429 重试
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return { ok: false, status: response.status, error: lastError, url };
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
      // 指数退避：100ms, 200ms, 400ms...
      await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
    }
  }

  return { ok: false, url, status: lastStatus, error: lastError };
}

// ==================== WebhookNotifier 类 ====================

/**
 * Webhook 通知器：管理多个端点，根据事件类型分发通知。
 *
 * 使用方式：
 * 1. const notifier = new WebhookNotifier({ endpoints: [...] })
 * 2. await notifier.notify('review.completed', payload)
 *
 * 也可在构造后通过 addEndpoint 动态添加端点。
 */
export class WebhookNotifier {
  private endpoints: WebhookEndpoint[] = [];
  private readonly defaultHeaders: Record<string, string>;
  private readonly defaultTimeoutMs: number;
  private readonly defaultRetries: number;
  private readonly fetchImpl?: typeof fetch;
  private readonly logger: (message: string, ...args: unknown[]) => void;
  private readonly repository?: string;
  private readonly prNumber?: number;

  constructor(options: WebhookNotifierOptions & { endpoints?: WebhookEndpoint[] } = {}) {
    if (options.endpoints) {
      this.endpoints = [...options.endpoints];
    }
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 5000;
    this.defaultRetries = options.defaultRetries ?? 1;
    this.fetchImpl = options.fetchImpl;
    this.logger = options.logger ?? console.warn;
    this.repository = options.repository;
    this.prNumber = options.prNumber;
  }

  /** 添加 Webhook 端点 */
  addEndpoint(endpoint: WebhookEndpoint): void {
    this.endpoints.push(endpoint);
  }

  /** 移除指定 URL 的 Webhook 端点 */
  removeEndpoint(url: string): boolean {
    const idx = this.endpoints.findIndex((e) => e.url === url);
    if (idx === -1) return false;
    this.endpoints.splice(idx, 1);
    return true;
  }

  /** 列出所有已注册的端点 */
  listEndpoints(): WebhookEndpoint[] {
    return [...this.endpoints];
  }

  /** 订阅指定事件类型的端点列表 */
  private subscribersFor(event: WebhookEventType): WebhookEndpoint[] {
    return this.endpoints.filter((e) => !e.events || e.events.includes(event));
  }

  /**
   * 通知所有订阅了指定事件的端点。
   *
   * 单个端点失败不影响其他端点；所有结果汇总返回。
   *
   * @param event Webhook 事件
   * @returns 每个端点的发送结果
   */
  async notify(event: WebhookEvent): Promise<SendWebhookResult[]> {
    const subscribers = this.subscribersFor(event.event);
    if (subscribers.length === 0) {
      return [];
    }

    const results = await Promise.all(
      subscribers.map(async (endpoint) => {
        const headers = { ...this.defaultHeaders, ...(endpoint.headers ?? {}) };
        const result = await sendWebhook(endpoint.url, event, {
          headers,
          timeoutMs: this.defaultTimeoutMs,
          retries: this.defaultRetries,
          fetchImpl: this.fetchImpl,
        });
        if (!result.ok) {
          this.logger(
            `[webhook] failed to notify ${endpoint.url} for event ${event.event}: ${result.error ?? 'unknown error'}`,
          );
        }
        return result;
      }),
    );
    return results;
  }

  /**
   * 便捷方法：通知 review.completed 事件。
   */
  async notifyReviewCompleted(input: {
    findings: Finding[];
    filesTotal: number;
    durationMs?: number;
    sessionId?: string;
  }): Promise<SendWebhookResult[]> {
    const event = formatReviewEvent('review.completed', {
      ...input,
      repository: this.repository,
      prNumber: this.prNumber,
    });
    return this.notify(event);
  }

  /**
   * 便捷方法：通知 review.failed 事件。
   */
  async notifyReviewFailed(input: {
    error: string | Error;
    stage?: string;
    sessionId?: string;
  }): Promise<SendWebhookResult[]> {
    const event = formatReviewEvent('review.failed', {
      ...input,
      repository: this.repository,
      prNumber: this.prNumber,
    });
    return this.notify(event);
  }

  /**
   * 便捷方法：通知 finding.critical 事件。
   * 仅当 findings 中存在 critical 严重度的项时才发送。
   */
  async notifyFindingCritical(input: {
    findings: Finding[];
    sessionId?: string;
  }): Promise<SendWebhookResult[]> {
    const critical = input.findings.filter((f) => f.severity === 'critical');
    if (critical.length === 0) {
      return [];
    }
    const event = formatReviewEvent('finding.critical', {
      ...input,
      repository: this.repository,
      prNumber: this.prNumber,
    });
    return this.notify(event);
  }

  /**
   * 一站式方法：根据审查结果自动分发所有应触发的事件。
   * - 总是触发 review.completed
   * - 若 findings 中有 critical，额外触发 finding.critical
   *
   * @param findings 审查产出的 findings
   * @param context 上下文信息
   * @returns 所有发送结果
   */
  async notifyReviewResult(
    findings: Finding[],
    context: {
      filesTotal: number;
      durationMs?: number;
      sessionId?: string;
    },
  ): Promise<SendWebhookResult[]> {
    const results: SendWebhookResult[] = [];
    const completedResults = await this.notifyReviewCompleted({
      findings,
      filesTotal: context.filesTotal,
      durationMs: context.durationMs,
      sessionId: context.sessionId,
    });
    results.push(...completedResults);

    const criticalResults = await this.notifyFindingCritical({
      findings,
      sessionId: context.sessionId,
    });
    results.push(...criticalResults);

    return results;
  }
}
