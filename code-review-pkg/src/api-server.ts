// src/api-server.ts — Task 17：HTTP API 暴露
//
// 职责：
// 1. ApiServer 类：使用 Node.js 内置 http 模块提供 REST API（不依赖 express）
// 2. startApiServer / stopApiServer：便捷启动/停止函数
// 3. 端点：
//    - POST /api/v1/review    触发审查（接受 diff 文本，返回 PipelineResult）
//    - GET  /api/v1/findings  获取最近一次审查的 findings
//    - GET  /api/v1/health    健康检查
//    - GET  /api/v1/metrics   获取 metrics
//
// 设计取舍：
// - 仅使用 Node 内置 http 模块，不引入 express / fastify 等外部依赖
// - 路由通过简单的 URL 匹配实现，避免引入框架
// - 状态保存在实例上（lastFindings / lastResult），便于多次查询
// - 支持注入 runPipeline / collectMetrics 等依赖，便于测试 mock
// - 错误统一以 JSON `{ error: string }` 返回，状态码遵循 HTTP 语义
//
// 与 cli.ts 集成：
// - `code-review serve --port 3000` 启动 API 服务器

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { runPipeline } from './pipeline.js';
import { collectMetrics, type MetricsInput, type ReviewMetrics } from './metrics.js';
import { FeedbackStore } from './feedback.js';
import type { Finding, PipelineResult } from './types.js';

// ==================== 类型定义 ====================

/** API 服务器选项 */
export interface ApiServerOptions {
  /** 监听端口（默认 3000） */
  port?: number;
  /** 监听主机（默认 127.0.0.1） */
  host?: string;
  /** 注入式 runPipeline（用于测试） */
  runPipelineImpl?: typeof runPipeline;
  /** 注入式 collectMetrics（用于测试） */
  collectMetricsImpl?: typeof collectMetrics;
  /** 注入式 FeedbackStore（用于测试） */
  feedbackStore?: FeedbackStore;
  /** 注入式 findings 来源（用于测试，覆盖 lastFindings 状态） */
  initialFindings?: Finding[];
  /** 注入式 metrics 输入（用于测试） */
  metricsInput?: MetricsInput;
  /** 日志函数（默认 console.log） */
  logger?: (message: string, ...args: unknown[]) => void;
}

/** /api/v1/review 请求体 */
export interface ReviewRequest {
  /** Diff 文本（必填） */
  diff: string;
  /** 过滤配置（可选） */
  filter?: Record<string, unknown>;
  /** 是否启用 MCP（可选，默认 false） */
  mcpEnabled?: boolean;
  /** 是否 dry-run（可选，默认 false） */
  dryRun?: boolean;
}

/** /api/v1/review 响应体 */
export interface ReviewResponse {
  /** 是否成功 */
  ok: boolean;
  /** PipelineResult（成功时） */
  result?: PipelineResult;
  /** 错误信息（失败时） */
  error?: string;
  /** 耗时（ms） */
  durationMs?: number;
}

/** /api/v1/health 响应体 */
export interface HealthResponse {
  /** 服务状态：'ok' / 'degraded' */
  status: 'ok' | 'degraded';
  /** 服务版本 */
  version: string;
  /** 启动时间（ISO 8601） */
  startedAt: string;
  /** 当前时间（ISO 8601） */
  currentTime: string;
  /** 已处理的审查请求数 */
  requestsHandled: number;
  /** 最后一次审查时间（ISO 8601，可选） */
  lastReviewAt?: string;
}

/** /api/v1/findings 响应体 */
export interface FindingsResponse {
  /** 是否成功 */
  ok: boolean;
  /** findings 数组 */
  findings: Finding[];
  /** findings 数量 */
  count: number;
  /** 最后一次审查时间（ISO 8601） */
  lastReviewAt?: string;
}

/** /api/v1/metrics 响应体 */
export interface MetricsResponse {
  /** 是否成功 */
  ok: boolean;
  /** 度量指标 */
  metrics?: ReviewMetrics;
  /** 错误信息 */
  error?: string;
}

// ==================== 工具函数 ====================

/** 读取请求体（最大 10MB） */
function readRequestBody(req: IncomingMessage, maxBytes = 10 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > maxBytes) {
        reject(new Error(`Request body too large (max ${maxBytes} bytes)`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    req.on('error', (err) => reject(err));
  });
}

/** 解析 JSON 请求体 */
function parseJsonBody(body: string): unknown {
  if (!body || body.trim() === '') {
    return {};
  }
  return JSON.parse(body);
}

/** 发送 JSON 响应 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json, 'utf-8'),
  });
  res.end(json);
}

/** 从 URL 中提取查询参数 */
function parseQuery(url: string): Record<string, string> {
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return {};
  const queryStr = url.slice(qIdx + 1);
  const result: Record<string, string> = {};
  for (const pair of queryStr.split('&')) {
    const [k, v] = pair.split('=').map(decodeURIComponent);
    if (k) result[k] = v ?? '';
  }
  return result;
}

// ==================== ApiServer 类 ====================

/** 默认监听端口 */
export const DEFAULT_API_PORT = 3000;

/** 默认监听主机 */
export const DEFAULT_API_HOST = '127.0.0.1';

/** API 版本 */
export const API_VERSION = '0.1.0';

/**
 * HTTP API 服务器：基于 Node.js 内置 http 模块实现。
 *
 * 使用方式：
 * 1. const server = new ApiServer({ port: 3000 });
 * 2. await server.start();
 * 3. // 客户端请求 POST /api/v1/review 等
 * 4. await server.stop();
 *
 * 或使用便捷函数：
 * - startApiServer(options) → 返回已启动的 ApiServer
 * - stopApiServer(server) → 停止服务器
 */
export class ApiServer {
  private readonly port: number;
  private readonly host: string;
  private readonly runPipelineImpl: typeof runPipeline;
  private readonly collectMetricsImpl: typeof collectMetrics;
  private readonly feedbackStore: FeedbackStore;
  private readonly metricsInput?: MetricsInput;
  private readonly logger: (message: string, ...args: unknown[]) => void;

  private server: Server | null = null;
  private startedAt: string | null = null;
  private requestsHandled = 0;
  private lastReviewAt: string | null = null;
  private lastFindings: Finding[] = [];
  private lastResult: PipelineResult | null = null;

  constructor(options: ApiServerOptions = {}) {
    this.port = options.port ?? DEFAULT_API_PORT;
    this.host = options.host ?? DEFAULT_API_HOST;
    this.runPipelineImpl = options.runPipelineImpl ?? runPipeline;
    this.collectMetricsImpl = options.collectMetricsImpl ?? collectMetrics;
    this.feedbackStore = options.feedbackStore ?? new FeedbackStore();
    this.metricsInput = options.metricsInput;
    this.logger = options.logger ?? console.log;
    if (options.initialFindings) {
      this.lastFindings = [...options.initialFindings];
    }
  }

  /** 启动 HTTP 服务器 */
  async start(): Promise<void> {
    if (this.server) {
      throw new Error('ApiServer already started');
    }
    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger('[api] request handler error:', message);
        if (!res.headersSent) {
          sendJson(res, 500, { ok: false, error: message });
        }
      });
    });
    return new Promise((resolve, reject) => {
      this.server!.on('error', (err) => {
        this.server = null;
        reject(err);
      });
      this.server!.listen(this.port, this.host, () => {
        this.startedAt = new Date().toISOString();
        this.logger(`[api] server listening on http://${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  /** 停止 HTTP 服务器 */
  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  }

  /** 服务器是否正在运行 */
  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }

  /** 获取监听地址 */
  address(): { host: string; port: number } | null {
    if (!this.server || !this.server.listening) return null;
    const addr = this.server.address();
    if (addr && typeof addr === 'object') {
      return { host: addr.address, port: addr.port };
    }
    return null;
  }

  /** 获取最后一次审查的 findings */
  getLastFindings(): Finding[] {
    return [...this.lastFindings];
  }

  /** 获取最后一次审查结果 */
  getLastResult(): PipelineResult | null {
    return this.lastResult;
  }

  /** 获取已处理请求数 */
  getRequestsHandled(): number {
    return this.requestsHandled;
  }

  /** 主请求分发器 */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.requestsHandled++;
    const url = req.url ?? '/';
    const path = url.split('?')[0];
    const method = req.method ?? 'GET';

    // CORS 头（便于开发调试）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (path === '/api/v1/health' && method === 'GET') {
      return this.handleHealth(req, res);
    }

    if (path === '/api/v1/review' && method === 'POST') {
      return this.handleReview(req, res);
    }

    if (path === '/api/v1/findings' && method === 'GET') {
      return this.handleFindings(req, res);
    }

    if (path === '/api/v1/metrics' && method === 'GET') {
      return this.handleMetrics(req, res);
    }

    // 未匹配路由
    sendJson(res, 404, { ok: false, error: `Not found: ${method} ${path}` });
  }

  /** GET /api/v1/health */
  private handleHealth(_req: IncomingMessage, res: ServerResponse): void {
    const response: HealthResponse = {
      status: 'ok',
      version: API_VERSION,
      startedAt: this.startedAt ?? new Date().toISOString(),
      currentTime: new Date().toISOString(),
      requestsHandled: this.requestsHandled,
      lastReviewAt: this.lastReviewAt ?? undefined,
    };
    sendJson(res, 200, response);
  }

  /** POST /api/v1/review */
  private async handleReview(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let bodyText: string;
    try {
      bodyText = await readRequestBody(req);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, { ok: false, error: `Failed to read request body: ${message}` });
      return;
    }

    let payload: ReviewRequest;
    try {
      const parsed = parseJsonBody(bodyText) as Partial<ReviewRequest>;
      if (!parsed.diff || typeof parsed.diff !== 'string') {
        sendJson(res, 400, { ok: false, error: 'Missing or invalid "diff" field in request body' });
        return;
      }
      payload = parsed as ReviewRequest;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, { ok: false, error: `Invalid JSON: ${message}` });
      return;
    }

    const startTime = performance.now();
    try {
      const result = await this.runPipelineImpl(payload.diff, {
        filter: (payload.filter ?? {}) as Parameters<typeof runPipeline>[1]['filter'],
        mcpEnabled: payload.mcpEnabled ?? false,
        dryRun: payload.dryRun ?? false,
      });
      const durationMs = performance.now() - startTime;
      this.lastResult = result;
      this.lastFindings = result.findings ?? [];
      this.lastReviewAt = new Date().toISOString();

      const response: ReviewResponse = {
        ok: true,
        result,
        durationMs,
      };
      sendJson(res, 200, response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const durationMs = performance.now() - startTime;
      this.logger('[api] review failed:', message);
      const response: ReviewResponse = {
        ok: false,
        error: message,
        durationMs,
      };
      sendJson(res, 500, response);
    }
  }

  /** GET /api/v1/findings */
  private handleFindings(req: IncomingMessage, res: ServerResponse): void {
    const query = parseQuery(req.url ?? '');
    let findings = this.lastFindings;

    // 支持按 severity 过滤
    if (query.severity) {
      findings = findings.filter((f) => f.severity === query.severity);
    }
    // 支持按 file 过滤（前缀匹配）
    if (query.file) {
      findings = findings.filter((f) => f.file.startsWith(query.file));
    }
    // 支持限制返回数量
    let limitedFindings = findings;
    if (query.limit) {
      const limit = parseInt(query.limit, 10);
      if (!Number.isNaN(limit) && limit >= 0) {
        limitedFindings = findings.slice(0, limit);
      }
    }

    const response: FindingsResponse = {
      ok: true,
      findings: limitedFindings,
      count: limitedFindings.length,
      lastReviewAt: this.lastReviewAt ?? undefined,
    };
    sendJson(res, 200, response);
  }

  /** GET /api/v1/metrics */
  private handleMetrics(_req: IncomingMessage, res: ServerResponse): void {
    try {
      const input = this.metricsInput ?? {
        sessions: [],
        findings: this.lastFindings,
        feedback: this.feedbackStore,
      };
      const metrics = this.collectMetricsImpl(input);
      const response: MetricsResponse = { ok: true, metrics };
      sendJson(res, 200, response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const response: MetricsResponse = { ok: false, error: message };
      sendJson(res, 500, response);
    }
  }
}

// ==================== 便捷函数 ====================

/**
 * 启动 API 服务器（便捷函数）。
 *
 * @param options 服务器选项
 * @returns 已启动的 ApiServer 实例
 */
export async function startApiServer(options: ApiServerOptions = {}): Promise<ApiServer> {
  const server = new ApiServer(options);
  await server.start();
  return server;
}

/**
 * 停止 API 服务器（便捷函数）。
 *
 * @param server ApiServer 实例
 */
export async function stopApiServer(server: ApiServer): Promise<void> {
  await server.stop();
}
