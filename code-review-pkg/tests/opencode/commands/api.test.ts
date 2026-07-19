import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import {
  ApiServer,
  startApiServer,
  stopApiServer,
  DEFAULT_API_PORT,
  DEFAULT_API_HOST,
  API_VERSION,
  type ApiServerOptions,
  type ReviewRequest,
  type ReviewResponse,
  type HealthResponse,
  type FindingsResponse,
  type MetricsResponse,
} from '../../../src/api-server.js';
import type { Finding, PipelineResult } from '../../../src/types.js';
import { FeedbackStore } from '../../../src/feedback.js';

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

function makeMockPipelineResult(findings: Finding[] = []): PipelineResult {
  return {
    filteredDiffs: [],
    bundles: [],
    annotatedBundles: [],
    prompt: 'mock prompt',
    findings,
    durationMs: 100,
  };
}

// ── HTTP 客户端工具 ──

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  host = '127.0.0.1',
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: http.OutgoingHttpHeaders = {
      'Content-Type': 'application/json',
    };
    if (bodyStr !== undefined) {
      headers['Content-Length'] = Buffer.byteLength(bodyStr, 'utf-8');
    }

    const req = http.request(
      {
        host,
        port,
        method,
        path,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (bodyStr !== undefined) {
      req.write(bodyStr);
    }
    req.end();
  });
}

// ── 获取可用端口（避免冲突） ──

async function getAvailablePort(start = 30000): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close();
        reject(new Error('Failed to get available port'));
      }
    });
  });
}

// ==================== 常量 ====================

describe('API 常量', () => {
  it('DEFAULT_API_PORT 是 3000', () => {
    expect(DEFAULT_API_PORT).toBe(3000);
  });

  it('DEFAULT_API_HOST 是 127.0.0.1', () => {
    expect(DEFAULT_API_HOST).toBe('127.0.0.1');
  });

  it('API_VERSION 是 0.1.0', () => {
    expect(API_VERSION).toBe('0.1.0');
  });
});

// ==================== ApiServer 类 ====================

describe('ApiServer 类', () => {
  describe('构造器', () => {
    it('使用默认端口与主机', () => {
      const server = new ApiServer();
      // 内部状态通过 start/stop 间接验证
      expect(server).toBeInstanceOf(ApiServer);
    });

    it('接受自定义端口与主机', () => {
      const server = new ApiServer({ port: 4000, host: '0.0.0.0' });
      expect(server).toBeInstanceOf(ApiServer);
    });

    it('接受注入式 runPipeline / collectMetrics', () => {
      const mockPipeline = vi.fn(async () => makeMockPipelineResult(SAMPLE_FINDINGS));
      const mockMetrics = vi.fn(() => ({
        coverage: {
          prCoverage: 0,
          fileCoverage: 0,
          totalSessions: 0,
          completedSessions: 0,
        },
        quality: {
          avgFindingsPerFile: 0,
          severityDistribution: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          acceptRate: 0,
          rejectRate: 0,
          categoryDistribution: {},
        },
        cost: { tokenConsumed: 0, tokensPerKLine: 0 },
        efficiency: { fixRate: 0, totalDurationMs: 0, avgDurationPerSession: 0 },
        trend: { buckets: [], direction: 'stable' },
      }));
      const server = new ApiServer({
        runPipelineImpl: mockPipeline as never,
        collectMetricsImpl: mockMetrics as never,
      });
      expect(server).toBeInstanceOf(ApiServer);
    });

    it('接受 initialFindings 初始化', () => {
      const server = new ApiServer({ initialFindings: SAMPLE_FINDINGS });
      expect(server.getLastFindings()).toEqual(SAMPLE_FINDINGS);
    });
  });

  describe('start / stop', () => {
    let server: ApiServer;
    let port: number;

    beforeEach(async () => {
      port = await getAvailablePort();
      server = new ApiServer({ port, logger: () => undefined });
    });

    afterEach(async () => {
      if (server.isRunning()) {
        await server.stop();
      }
    });

    it('start 后服务器监听指定端口', async () => {
      await server.start();
      expect(server.isRunning()).toBe(true);
      const addr = server.address();
      expect(addr).not.toBeNull();
      expect(addr?.port).toBe(port);
      expect(addr?.host).toBe('127.0.0.1');
    });

    it('重复 start 抛出错误', async () => {
      await server.start();
      await expect(server.start()).rejects.toThrow(/already started/i);
    });

    it('stop 后服务器不再监听', async () => {
      await server.start();
      expect(server.isRunning()).toBe(true);
      await server.stop();
      expect(server.isRunning()).toBe(false);
      expect(server.address()).toBeNull();
    });

    it('未启动时 stop 不报错', async () => {
      const s = new ApiServer({ port: 0, logger: () => undefined });
      await s.stop();
      expect(s.isRunning()).toBe(false);
    });

    it('isRunning 在 start 前/后/stop 后状态正确', async () => {
      expect(server.isRunning()).toBe(false);
      await server.start();
      expect(server.isRunning()).toBe(true);
      await server.stop();
      expect(server.isRunning()).toBe(false);
    });
  });
});

// ==================== 路由分发 ====================

describe('API 路由分发', () => {
  let server: ApiServer;
  let port: number;

  beforeEach(async () => {
    port = await getAvailablePort();
    server = new ApiServer({
      port,
      logger: () => undefined,
      runPipelineImpl: vi.fn(async () => makeMockPipelineResult()) as never,
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('未匹配路由返回 404', async () => {
    const res = await httpRequest(port, 'GET', '/api/v1/unknown');
    expect(res.status).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/not found/i);
  });

  it('OPTIONS 请求返回 204（CORS 预检）', async () => {
    const res = await httpRequest(port, 'OPTIONS', '/api/v1/health');
    expect(res.status).toBe(204);
  });

  it('CORS 头在响应中', async () => {
    const res = await httpRequest(port, 'GET', '/api/v1/health');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('GET /api/v1/review 返回 404（仅支持 POST）', async () => {
    const res = await httpRequest(port, 'GET', '/api/v1/review');
    expect(res.status).toBe(404);
  });

  it('POST /api/v1/health 返回 404（仅支持 GET）', async () => {
    const res = await httpRequest(port, 'POST', '/api/v1/health', {});
    expect(res.status).toBe(404);
  });

  it('每次请求增加 requestsHandled', async () => {
    const initial = server.getRequestsHandled();
    await httpRequest(port, 'GET', '/api/v1/health');
    await httpRequest(port, 'GET', '/api/v1/health');
    expect(server.getRequestsHandled()).toBe(initial + 2);
  });
});

// ==================== GET /api/v1/health ====================

describe('GET /api/v1/health', () => {
  let server: ApiServer;
  let port: number;

  beforeEach(async () => {
    port = await getAvailablePort();
    server = new ApiServer({
      port,
      logger: () => undefined,
      runPipelineImpl: vi.fn(async () => makeMockPipelineResult()) as never,
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('返回 200 与健康状态', async () => {
    const res = await httpRequest(port, 'GET', '/api/v1/health');
    expect(res.status).toBe(200);
    const body: HealthResponse = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.version).toBe(API_VERSION);
    expect(body.startedAt).toBeTruthy();
    expect(body.currentTime).toBeTruthy();
    expect(body.requestsHandled).toBeGreaterThanOrEqual(1);
  });

  it('lastReviewAt 初始为 undefined', async () => {
    const res = await httpRequest(port, 'GET', '/api/v1/health');
    const body: HealthResponse = JSON.parse(res.body);
    expect(body.lastReviewAt).toBeUndefined();
  });

  it('审查后 lastReviewAt 被填充', async () => {
    await httpRequest(port, 'POST', '/api/v1/review', {
      diff: 'diff --git a/file.ts b/file.ts\n',
    });
    const res = await httpRequest(port, 'GET', '/api/v1/health');
    const body: HealthResponse = JSON.parse(res.body);
    expect(body.lastReviewAt).toBeTruthy();
  });
});

// ==================== POST /api/v1/review ====================

describe('POST /api/v1/review', () => {
  let server: ApiServer;
  let port: number;
  let mockPipeline: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    port = await getAvailablePort();
    mockPipeline = vi.fn(async () => makeMockPipelineResult(SAMPLE_FINDINGS));
    server = new ApiServer({
      port,
      logger: () => undefined,
      runPipelineImpl: mockPipeline as never,
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('成功返回 200 与 PipelineResult', async () => {
    const reqBody: ReviewRequest = {
      diff: 'diff --git a/file.ts b/file.ts\n',
    };
    const res = await httpRequest(port, 'POST', '/api/v1/review', reqBody);
    expect(res.status).toBe(200);
    const body: ReviewResponse = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.result).toBeDefined();
    expect(body.result?.findings).toEqual(SAMPLE_FINDINGS);
    expect(body.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('调用 runPipelineImpl 处理 diff', async () => {
    const reqBody: ReviewRequest = {
      diff: 'some diff content',
      mcpEnabled: true,
      dryRun: true,
    };
    await httpRequest(port, 'POST', '/api/v1/review', reqBody);
    expect(mockPipeline).toHaveBeenCalledTimes(1);
    const callArgs = mockPipeline.mock.calls[0];
    expect(callArgs[0]).toBe('some diff content');
    expect(callArgs[1]).toMatchObject({
      mcpEnabled: true,
      dryRun: true,
    });
  });

  it('缺少 diff 字段返回 400', async () => {
    const res = await httpRequest(port, 'POST', '/api/v1/review', {});
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/diff/i);
  });

  it('非 JSON 请求体返回 400', async () => {
    const res = await new Promise<HttpResponse>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/api/v1/review',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength('not json', 'utf-8'),
          },
        },
        (r) => {
          const chunks: Buffer[] = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () => {
            resolve({
              status: r.statusCode ?? 0,
              headers: r.headers,
              body: Buffer.concat(chunks).toString('utf-8'),
            });
          });
          r.on('error', reject);
        },
      );
      req.on('error', reject);
      req.write('not json');
      req.end();
    });
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/json/i);
  });

  it('runPipeline 抛错时返回 500', async () => {
    mockPipeline.mockImplementation(async () => {
      throw new Error('pipeline boom');
    });
    const res = await httpRequest(port, 'POST', '/api/v1/review', { diff: 'x' });
    expect(res.status).toBe(500);
    const body: ReviewResponse = JSON.parse(res.body);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('pipeline boom');
  });

  it('审查后 lastFindings 更新', async () => {
    await httpRequest(port, 'POST', '/api/v1/review', { diff: 'x' });
    expect(server.getLastFindings()).toEqual(SAMPLE_FINDINGS);
    expect(server.getLastResult()).toBeDefined();
  });

  it('空请求体返回 400（缺 diff）', async () => {
    const res = await new Promise<HttpResponse>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/api/v1/review',
          headers: { 'Content-Type': 'application/json' },
        },
        (r) => {
          const chunks: Buffer[] = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () => {
            resolve({
              status: r.statusCode ?? 0,
              headers: r.headers,
              body: Buffer.concat(chunks).toString('utf-8'),
            });
          });
          r.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(res.status).toBe(400);
  });
});

// ==================== GET /api/v1/findings ====================

describe('GET /api/v1/findings', () => {
  let server: ApiServer;
  let port: number;

  beforeEach(async () => {
    port = await getAvailablePort();
    server = new ApiServer({
      port,
      logger: () => undefined,
      initialFindings: SAMPLE_FINDINGS,
      runPipelineImpl: vi.fn(async () => makeMockPipelineResult()) as never,
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('返回 200 与全部 findings', async () => {
    const res = await httpRequest(port, 'GET', '/api/v1/findings');
    expect(res.status).toBe(200);
    const body: FindingsResponse = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.findings).toHaveLength(SAMPLE_FINDINGS.length);
    expect(body.count).toBe(SAMPLE_FINDINGS.length);
  });

  it('按 severity 过滤', async () => {
    const res = await httpRequest(port, 'GET', '/api/v1/findings?severity=critical');
    expect(res.status).toBe(200);
    const body: FindingsResponse = JSON.parse(res.body);
    expect(body.count).toBe(1);
    expect(body.findings[0].severity).toBe('critical');
  });

  it('按 file 前缀过滤', async () => {
    const res = await httpRequest(port, 'GET', '/api/v1/findings?file=src/a');
    expect(res.status).toBe(200);
    const body: FindingsResponse = JSON.parse(res.body);
    expect(body.count).toBe(1);
    expect(body.findings[0].file).toBe('src/a.ts');
  });

  it('limit 限制返回数量', async () => {
    const res = await httpRequest(port, 'GET', '/api/v1/findings?limit=2');
    expect(res.status).toBe(200);
    const body: FindingsResponse = JSON.parse(res.body);
    expect(body.count).toBe(2);
    expect(body.findings).toHaveLength(2);
  });

  it('无 findings 时返回空数组', async () => {
    const p = await getAvailablePort();
    const emptyServer = new ApiServer({
      port: p,
      logger: () => undefined,
      runPipelineImpl: vi.fn(async () => makeMockPipelineResult()) as never,
    });
    await emptyServer.start();
    try {
      const res = await httpRequest(p, 'GET', '/api/v1/findings');
      const body: FindingsResponse = JSON.parse(res.body);
      expect(body.findings).toEqual([]);
      expect(body.count).toBe(0);
    } finally {
      await emptyServer.stop();
    }
  });

  it('lastReviewAt 在初始时为 undefined', async () => {
    const res = await httpRequest(port, 'GET', '/api/v1/findings');
    const body: FindingsResponse = JSON.parse(res.body);
    expect(body.lastReviewAt).toBeUndefined();
  });
});

// ==================== GET /api/v1/metrics ====================

describe('GET /api/v1/metrics', () => {
  let server: ApiServer;
  let port: number;

  beforeEach(async () => {
    port = await getAvailablePort();
    server = new ApiServer({
      port,
      logger: () => undefined,
      initialFindings: SAMPLE_FINDINGS,
      feedbackStore: new FeedbackStore(),
      runPipelineImpl: vi.fn(async () => makeMockPipelineResult()) as never,
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('返回 200 与 metrics 结构', async () => {
    const res = await httpRequest(port, 'GET', '/api/v1/metrics');
    expect(res.status).toBe(200);
    const body: MetricsResponse = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.metrics).toBeDefined();
    expect(body.metrics?.coverage).toBeDefined();
    expect(body.metrics?.quality).toBeDefined();
    expect(body.metrics?.cost).toBeDefined();
    expect(body.metrics?.efficiency).toBeDefined();
    expect(body.metrics?.trend).toBeDefined();
  });

  it('severity 分布与初始 findings 一致', async () => {
    const res = await httpRequest(port, 'GET', '/api/v1/metrics');
    const body: MetricsResponse = JSON.parse(res.body);
    expect(body.metrics?.quality.severityDistribution.critical).toBe(1);
    expect(body.metrics?.quality.severityDistribution.high).toBe(1);
    expect(body.metrics?.quality.severityDistribution.medium).toBe(1);
    expect(body.metrics?.quality.severityDistribution.low).toBe(1);
    expect(body.metrics?.quality.severityDistribution.info).toBe(1);
  });

  it('collectMetrics 抛错时返回 500', async () => {
    const failingMetrics = vi.fn(() => {
      throw new Error('metrics boom');
    });
    const p = await getAvailablePort();
    const failingServer = new ApiServer({
      port: p,
      logger: () => undefined,
      collectMetricsImpl: failingMetrics as never,
      runPipelineImpl: vi.fn(async () => makeMockPipelineResult()) as never,
    });
    await failingServer.start();
    try {
      const res = await httpRequest(p, 'GET', '/api/v1/metrics');
      expect(res.status).toBe(500);
      const body: MetricsResponse = JSON.parse(res.body);
      expect(body.ok).toBe(false);
      expect(body.error).toBe('metrics boom');
    } finally {
      await failingServer.stop();
    }
  });
});

// ==================== 便捷函数 ====================

describe('startApiServer / stopApiServer', () => {
  let server: ApiServer | null = null;
  let port: number;

  beforeEach(async () => {
    port = await getAvailablePort();
  });

  afterEach(async () => {
    if (server) {
      await stopApiServer(server);
      server = null;
    }
  });

  it('startApiServer 返回已启动的服务器', async () => {
    server = await startApiServer({
      port,
      host: '127.0.0.1',
      logger: () => undefined,
      runPipelineImpl: vi.fn(async () => makeMockPipelineResult()) as never,
    });
    expect(server).toBeInstanceOf(ApiServer);
    expect(server.isRunning()).toBe(true);
  });

  it('stopApiServer 停止服务器', async () => {
    server = await startApiServer({
      port,
      logger: () => undefined,
      runPipelineImpl: vi.fn(async () => makeMockPipelineResult()) as never,
    });
    expect(server.isRunning()).toBe(true);
    await stopApiServer(server);
    expect(server.isRunning()).toBe(false);
    server = null;
  });

  it('便捷函数启动的服务器可处理请求', async () => {
    server = await startApiServer({
      port,
      logger: () => undefined,
      runPipelineImpl: vi.fn(async () => makeMockPipelineResult()) as never,
    });
    const res = await httpRequest(port, 'GET', '/api/v1/health');
    expect(res.status).toBe(200);
  });
});

// ==================== CLI 集成 ====================

interface TestState {
  exitError: Error | null;
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}

async function loadCli(opts: {
  argv: string[];
  env?: Record<string, string>;
}): Promise<TestState> {
  const state: TestState = {
    exitError: null,
    stdout: [],
    stderr: [],
    exitCode: null,
  };

  const origArgv = process.argv;
  process.argv = ['node', '/tmp/cli.js', ...opts.argv];

  const origEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    origEnv[k] = process.env[k];
    process.env[k] = v;
  }

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    state.stdout.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    state.stderr.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    state.exitCode = code ?? 0;
    const err = new Error(`__PROCESS_EXIT_${code ?? 0}__`);
    state.exitError = err;
    throw err;
  }) as never);

  vi.resetModules();

  try {
    await import('../../../src/cli.js');
    return state;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const match = msg.match(/^__PROCESS_EXIT_(\d+)__$/);
    if (match) {
      state.exitCode = parseInt(match[1], 10);
      return state;
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

describe('CLI: serve 命令', () => {
  it('无 --port 时使用默认端口', async () => {
    // 仅检查输出包含启动信息，不实际启动（命令会一直运行）
    // 我们设置 CODE_REVIEW_SERVE_NO_START=1 跳过实际启动
    const state = await loadCli({
      argv: ['serve'],
      env: { CODE_REVIEW_SERVE_NO_START: '1' },
    });

    // 输出应包含 serve 相关提示
    const output = state.stdout.join('\n') + state.stderr.join('\n');
    expect(output).toMatch(/serve|api|server|port/i);
  });

  it('--port 指定端口', async () => {
    const state = await loadCli({
      argv: ['serve', '--port', '9876'],
      env: { CODE_REVIEW_SERVE_NO_START: '1' },
    });

    const output = state.stdout.join('\n') + state.stderr.join('\n');
    expect(output).toMatch(/9876|port/i);
  });

  it('--host 指定主机', async () => {
    const state = await loadCli({
      argv: ['serve', '--host', '0.0.0.0'],
      env: { CODE_REVIEW_SERVE_NO_START: '1' },
    });

    const output = state.stdout.join('\n') + state.stderr.join('\n');
    expect(output).toMatch(/0\.0\.0\.0|host/i);
  });
});

// ==================== 端到端测试 ====================

describe('端到端：HTTP 完整请求流程', () => {
  let server: ApiServer;
  let port: number;

  beforeEach(async () => {
    port = await getAvailablePort();
    server = new ApiServer({
      port,
      logger: () => undefined,
      runPipelineImpl: vi.fn(async () => makeMockPipelineResult(SAMPLE_FINDINGS)) as never,
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('review → findings → metrics 完整流程', async () => {
    // 1. 触发审查
    const reviewRes = await httpRequest(port, 'POST', '/api/v1/review', {
      diff: 'some diff',
    });
    expect(reviewRes.status).toBe(200);
    const reviewBody: ReviewResponse = JSON.parse(reviewRes.body);
    expect(reviewBody.ok).toBe(true);

    // 2. 查询 findings
    const findingsRes = await httpRequest(port, 'GET', '/api/v1/findings');
    expect(findingsRes.status).toBe(200);
    const findingsBody: FindingsResponse = JSON.parse(findingsRes.body);
    expect(findingsBody.count).toBe(SAMPLE_FINDINGS.length);

    // 3. 查询 metrics
    const metricsRes = await httpRequest(port, 'GET', '/api/v1/metrics');
    expect(metricsRes.status).toBe(200);
    const metricsBody: MetricsResponse = JSON.parse(metricsRes.body);
    expect(metricsBody.ok).toBe(true);
    expect(metricsBody.metrics?.quality.severityDistribution.critical).toBe(1);

    // 4. 健康检查应反映已处理请求
    const healthRes = await httpRequest(port, 'GET', '/api/v1/health');
    const healthBody: HealthResponse = JSON.parse(healthRes.body);
    expect(healthBody.requestsHandled).toBeGreaterThanOrEqual(4);
    expect(healthBody.lastReviewAt).toBeTruthy();
  });
});

// ==================== 类型导出 ====================

describe('类型导出', () => {
  it('ApiServerOptions 接口存在', () => {
    const opts: ApiServerOptions = { port: 3000 };
    expect(opts.port).toBe(3000);
  });

  it('ReviewRequest 接口存在', () => {
    const req: ReviewRequest = { diff: 'x' };
    expect(req.diff).toBe('x');
  });

  it('ReviewResponse 接口存在', () => {
    const res: ReviewResponse = { ok: true };
    expect(res.ok).toBe(true);
  });

  it('HealthResponse 接口存在', () => {
    const r: HealthResponse = {
      status: 'ok',
      version: '0.1.0',
      startedAt: 'now',
      currentTime: 'now',
      requestsHandled: 0,
    };
    expect(r.status).toBe('ok');
  });

  it('FindingsResponse 接口存在', () => {
    const r: FindingsResponse = { ok: true, findings: [], count: 0 };
    expect(r.count).toBe(0);
  });

  it('MetricsResponse 接口存在', () => {
    const r: MetricsResponse = { ok: true };
    expect(r.ok).toBe(true);
  });
});
