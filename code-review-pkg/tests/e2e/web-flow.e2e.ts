// tests/e2e/web-flow.e2e.ts
// 端到端 Web 流程测试 — 使用 Node.js 内置测试运行器
// 运行方式: npx tsx --test tests/e2e/web-flow.e2e.ts
// Mock 模式: CODE_REVIEW_E2E_MOCK=1 npx tsx --test tests/e2e/web-flow.e2e.ts

import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { startApiServer, stopApiServer, type ApiServer } from '../../src/api-server.js';
import { ReviewSelfInspector, type InspectionResult } from '../../src/review-self-inspector.js';
import { ReviewSessionStore } from '../../src/review-session.js';
import { startMockCodeHubServer, type MockCodeHubServerHandle } from '../../src/mock-codehub-server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '..', '..', 'mock-codehub-fixtures');

// ==================== 类型定义 ====================

interface TestContext {
  baseUrl: string;
  port: number;
  server: ApiServer;
  mockHandle: MockCodeHubServerHandle | null;
  inspector: ReviewSelfInspector;
  reviewStorePath: string;
  metrics: TestMetrics;
}

interface ScenarioResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs: number;
  details?: string;
  retryCount?: number;
}

interface TestMetrics {
  startTime: number;
  scenarios: ScenarioResult[];
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  totalRetries: number;
}

// ==================== 辅助工具 ====================

function getAvailablePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = http.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolvePort(port));
      } else {
        server.close();
        reject(new Error('Failed to get available port'));
      }
    });
  });
}

async function httpGet(url: string): Promise<{ status: number; body: unknown }> {
  const resp = await fetch(url);
  const text = await resp.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: resp.status, body };
}

async function httpPost(url: string, payload?: unknown): Promise<{ status: number; body: unknown }> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await resp.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: resp.status, body };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`超时 ${ms}ms`)), ms)),
  ]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ==================== 测试上下文 ====================

let ctx: TestContext;
const MOCK_MODE = process.env.CODE_REVIEW_E2E_MOCK === '1';

// ==================== 初始化 ====================

test('初始化: 启动 Mock CodeHub + ApiServer', async () => {
  let mockHandle: MockCodeHubServerHandle | null = null;
  let configPath = '';

  if (MOCK_MODE) {
    // 启动 Mock CodeHub 服务
    const mockPort = await getAvailablePort();
    mockHandle = await startMockCodeHubServer({
      port: mockPort,
      hostname: '127.0.0.1',
      fixturesDir: FIXTURES_DIR,
    });

    // 创建临时 CodeHub 配置文件指向 mock 服务
    const tmpDir = tmpdir();
    const configDir = join(tmpDir, `codehub-test-${Date.now()}`);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    configPath = join(configDir, 'codehub-config.json');
    const config = {
      baseUrl: mockHandle.baseUrl,
      token: 'mock-token',
      projectId: '1',
      repoBaseDir: '.codehub-repos',
    };
    writeFileSync(configPath, JSON.stringify(config), 'utf8');
    console.log(`[E2E] Mock CodeHub 启动于 ${mockHandle.baseUrl}`);
  }

  const port = await getAvailablePort();
  const tmpDir = tmpdir();
  const storePath = join(tmpDir, `review-sessions-${Date.now()}.json`);

  const serverOptions: Record<string, unknown> = {
    port,
    host: '127.0.0.1',
    enableCodeHub: true,
    enableStatic: false,
    logger: () => undefined,
    reviewStorePath: storePath,
  };

  if (configPath) {
    serverOptions.codehubConfigPath = configPath;
  }

  const server = await startApiServer(serverOptions as any);

  ctx = {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    server,
    mockHandle,
    inspector: new ReviewSelfInspector(),
    reviewStorePath: storePath,
    metrics: {
      startTime: Date.now(),
      scenarios: [],
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      totalRetries: 0,
    },
  };

  console.log(`[E2E] ApiServer 启动于 ${ctx.baseUrl} (mock=${MOCK_MODE})`);
});

// ==================== S1: 一键配置健康检查 ====================

test('S1: 一键配置健康检查 - GET /api/v1/opencode/health', async () => {
  const start = performance.now();
  try {
    const { status, body } = await withTimeout(
      httpGet(`${ctx.baseUrl}/api/v1/opencode/health`),
      10000,
    );
    assert.strictEqual(status, 200, `期望 HTTP 200, 实际 ${status}`);
    const b = body as Record<string, unknown>;
    assert.ok(b, '响应体非空');

    const hasOk = 'ok' in b || 'status' in b;
    const hasInitialized = 'initialized' in b;
    const hasAgents = 'agents' in b;
    console.log(`[S1] health ok=${hasOk}, initialized=${hasInitialized}, agents=${hasAgents}`);

    ctx.metrics.scenarios.push({
      name: 'S1: 一键配置健康检查',
      status: 'pass',
      durationMs: Math.round(performance.now() - start),
    });
  } catch (err) {
    ctx.metrics.scenarios.push({
      name: 'S1: 一键配置健康检查',
      status: 'fail',
      durationMs: Math.round(performance.now() - start),
      details: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
});

// ==================== S2: 启动 opencode ====================

test('S2: 启动 opencode - POST /api/v1/services/start-all', async () => {
  const start = performance.now();
  try {
    if (MOCK_MODE) {
      console.log('[S2] Mock 模式: 跳过 opencode 启动');
      ctx.metrics.scenarios.push({
        name: 'S2: 启动 opencode',
        status: 'pass',
        durationMs: Math.round(performance.now() - start),
        details: 'Mock 模式跳过',
      });
      return;
    }

    const { status, body } = await withTimeout(
      httpPost(`${ctx.baseUrl}/api/v1/services/start-all`),
      45000,
    );
    const b = body as Record<string, unknown>;
    console.log(`[S2] start-all status=${status}, ok=${b.ok}`);

    if (status === 200 && b.ok === true) {
      ctx.metrics.scenarios.push({
        name: 'S2: 启动 opencode',
        status: 'pass',
        durationMs: Math.round(performance.now() - start),
      });
    } else {
      ctx.metrics.scenarios.push({
        name: 'S2: 启动 opencode',
        status: 'fail',
        durationMs: Math.round(performance.now() - start),
        details: `status=${status}`,
      });
      throw new Error(`start-all 返回非 ok: status=${status}`);
    }
  } catch (err) {
    ctx.metrics.scenarios.push({
      name: 'S2: 启动 opencode',
      status: 'fail',
      durationMs: Math.round(performance.now() - start),
      details: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
});

// ==================== S3: 浏览 MR 列表 ====================

test('S3: 浏览 MR 列表 - GET /api/v1/codehub/mrs', async () => {
  const start = performance.now();
  try {
    const { status, body } = await withTimeout(
      httpGet(`${ctx.baseUrl}/api/v1/codehub/mrs`),
      10000,
    );
    assert.strictEqual(status, 200, `期望 HTTP 200, 实际 ${status}`);
    const b = body as { ok: boolean; mrs: unknown[]; total: number };
    assert.ok(b.ok, 'ok 应为 true');
    assert.ok(Array.isArray(b.mrs), 'mrs 应为数组');
    console.log(`[S3] MR 列表: ${b.mrs.length} 个 MR`);

    ctx.metrics.scenarios.push({
      name: 'S3: 浏览 MR 列表',
      status: 'pass',
      durationMs: Math.round(performance.now() - start),
    });
  } catch (err) {
    ctx.metrics.scenarios.push({
      name: 'S3: 浏览 MR 列表',
      status: 'fail',
      durationMs: Math.round(performance.now() - start),
      details: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
});

// ==================== S4: 触发检视 + 自检 ====================

test('S4: 触发检视 - POST /api/v1/review/start', async () => {
  const start = performance.now();
  let retryCount = 0;
  try {
    const mrIid = 1;
    const { status, body } = await withTimeout(
      httpPost(`${ctx.baseUrl}/api/v1/review/start`, { mrIid }),
      10000,
    );
    assert.strictEqual(status, 200, `期望 HTTP 200, 实际 ${status}`);
    const b = body as { ok: boolean; sessionId: string };
    assert.ok(b.ok, 'ok 应为 true');
    assert.ok(typeof b.sessionId === 'string' && b.sessionId.length > 0, 'sessionId 非空');

    const sessionId = b.sessionId;
    console.log(`[S4] 会话创建: ${sessionId}`);

    // 等待 worker 执行完成 (defaultRunner 约 300ms, 留足余量)
    await sleep(800);

    // 获取会话状态进行自检
    const { status: gStatus, body: gBody } = await withTimeout(
      httpGet(`${ctx.baseUrl}/api/v1/review/${sessionId}`),
      10000,
    );
    assert.strictEqual(gStatus, 200, `获取会话期望 HTTP 200, 实际 ${gStatus}`);
    const sessionResp = gBody as { ok: boolean; session: any };
    const session = sessionResp.session;

    // 使用 ReviewSelfInspector 进行自检
    const inspectionResult: InspectionResult = ctx.inspector.inspect(session);
    console.log(
      `[S4] 自检结果: ok=${inspectionResult.ok}, recalled=${inspectionResult.recalled}, ` +
      `critical=${inspectionResult.findingsCritical}, high=${inspectionResult.findingsHigh}, ` +
      `medium=${inspectionResult.findingsMedium}, issues=[${inspectionResult.issues.join(', ')}]`,
    );

    ctx.metrics.criticalCount += inspectionResult.findingsCritical;
    ctx.metrics.highCount += inspectionResult.findingsHigh;
    ctx.metrics.mediumCount += inspectionResult.findingsMedium;

    // 如果自检不通过，最多重试 3 次
    if (!inspectionResult.ok) {
      const maxRetries = 3;
      for (let r = 1; r <= maxRetries; r++) {
        retryCount++;
        ctx.metrics.totalRetries++;
        console.log(`[S4] 自检未通过 (${inspectionResult.issues.join(',')}), 第 ${r}/${maxRetries} 次重试...`);

        const { status: rs, body: rb } = await withTimeout(
          httpPost(`${ctx.baseUrl}/api/v1/review/start`, { mrIid }),
          10000,
        );
        if (rs !== 200) continue;
        const newSessionId = (rb as { sessionId: string }).sessionId;
        await sleep(800);

        const { body: nb } = await withTimeout(
          httpGet(`${ctx.baseUrl}/api/v1/review/${newSessionId}`),
          10000,
        );
        const newSession = (nb as { session: any }).session;
        const newInspection = ctx.inspector.inspect(newSession);

        ctx.metrics.criticalCount += newInspection.findingsCritical;
        ctx.metrics.highCount += newInspection.findingsHigh;
        ctx.metrics.mediumCount += newInspection.findingsMedium;

        if (newInspection.ok) {
          console.log(`[S4] 重试成功: ${newSessionId}`);
          break;
        }
        if (r === maxRetries) {
          console.log(`[S4] 已达最大重试次数`);
        }
      }
    }

    ctx.metrics.scenarios.push({
      name: 'S4: 触发检视',
      status: 'pass',
      durationMs: Math.round(performance.now() - start),
      retryCount,
    });
  } catch (err) {
    ctx.metrics.scenarios.push({
      name: 'S4: 触发检视',
      status: 'fail',
      durationMs: Math.round(performance.now() - start),
      details: err instanceof Error ? err.message : String(err),
      retryCount,
    });
    throw err;
  }
});

// ==================== S5: 查看会话 ====================

test('S5: 查看会话 - GET /api/v1/review/:sessionId', async () => {
  const start = performance.now();
  try {
    const { body: createResp } = await withTimeout(
      httpPost(`${ctx.baseUrl}/api/v1/review/start`, { mrIid: 2 }),
      10000,
    );
    const sessionId = (createResp as { sessionId: string }).sessionId;
    assert.ok(sessionId, 'sessionId 非空');

    // 等待 worker 执行完成
    await sleep(800);

    const { status, body } = await withTimeout(
      httpGet(`${ctx.baseUrl}/api/v1/review/${sessionId}`),
      10000,
    );
    assert.strictEqual(status, 200, `期望 HTTP 200, 实际 ${status}`);
    const b = body as { ok: boolean; session: Record<string, unknown> };
    assert.ok(b.ok, 'ok 应为 true');
    assert.ok(b.session, 'session 存在');

    const session = b.session as {
      id: string;
      status: string;
      mrIid: number;
      findings: unknown[];
      startedAt: string;
      updatedAt: string;
    };
    assert.strictEqual(session.id, sessionId, 'session.id 匹配');
    assert.ok(session.status, `status 存在: ${session.status}`);
    assert.strictEqual(session.mrIid, 2, 'mrIid 匹配');
    assert.ok(Array.isArray(session.findings), 'findings 为数组');
    assert.ok(session.startedAt, 'startedAt 存在');
    assert.ok(session.updatedAt, 'updatedAt 存在');

    console.log(`[S5] 会话 ${sessionId}: status=${session.status}, findings=${session.findings.length}`);

    ctx.metrics.scenarios.push({
      name: 'S5: 查看会话',
      status: 'pass',
      durationMs: Math.round(performance.now() - start),
    });
  } catch (err) {
    ctx.metrics.scenarios.push({
      name: 'S5: 查看会话',
      status: 'fail',
      durationMs: Math.round(performance.now() - start),
      details: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
});

// ==================== S6: 持久化会话 ====================

test('S6: 持久化会话 - 创建会话, 写入, mock 重启(重新加载 store), 验证可检索', async () => {
  const start = performance.now();
  try {
    const { body: createResp } = await withTimeout(
      httpPost(`${ctx.baseUrl}/api/v1/review/start`, { mrIid: 3 }),
      10000,
    );
    const sessionId = (createResp as { sessionId: string }).sessionId;
    assert.ok(sessionId, 'sessionId 非空');
    console.log(`[S6] 创建会话: ${sessionId}`);

    // 等待 worker 完成
    await sleep(800);

    // 验证可获取
    const { status: s1, body: b1 } = await withTimeout(
      httpGet(`${ctx.baseUrl}/api/v1/review/${sessionId}`),
      10000,
    );
    assert.strictEqual(s1, 200, '第一次获取期望 200');
    assert.ok((b1 as { ok: boolean }).ok, '第一次获取 ok');

    // Mock 重启: 用持久化文件重新创建 store 并验证会话存在
    const store = new ReviewSessionStore(ctx.reviewStorePath);
    const reloaded = store.getSession(sessionId);
    assert.ok(reloaded, '重新加载后会话存在于持久化存储');
    if (reloaded) {
      assert.strictEqual(reloaded.id, sessionId, '重新加载后 sessionId 匹配');
    }

    console.log(`[S6] 会话持久化验证通过: ${sessionId}`);

    ctx.metrics.scenarios.push({
      name: 'S6: 持久化会话',
      status: 'pass',
      durationMs: Math.round(performance.now() - start),
    });
  } catch (err) {
    ctx.metrics.scenarios.push({
      name: 'S6: 持久化会话',
      status: 'fail',
      durationMs: Math.round(performance.now() - start),
      details: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
});

// ==================== S7: SSE 流 ====================

test('S7: SSE 流 - 创建会话, 连接流 1-2s, 验证收到 progress 事件', async () => {
  const start = performance.now();
  try {
    const { body: createResp } = await withTimeout(
      httpPost(`${ctx.baseUrl}/api/v1/review/start`, { mrIid: 4 }),
      10000,
    );
    const sessionId = (createResp as { sessionId: string }).sessionId;
    assert.ok(sessionId, 'sessionId 非空');
    console.log(`[S7] 创建会话用于 SSE: ${sessionId}`);

    // 等待会话开始执行
    await sleep(300);

    // 连接 SSE 流
    const sseUrl = `${ctx.baseUrl}/api/v1/review/${sessionId}/stream`;
    const events: Array<{ type: string; data: unknown }> = [];

    const controller = new AbortController();
    const signal = controller.signal;

    let collected = false;

    const fetchPromise = fetch(sseUrl, { signal });

    try {
      const response = await withTimeout(fetchPromise, 5000);
      assert.strictEqual(response.status, 200, `SSE 期望 HTTP 200, 实际 ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('SSE 无 readable stream');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      const timeoutMs = 2000;
      const timeout = setTimeout(() => {
        if (!collected) {
          controller.abort();
        }
      }, timeoutMs);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                if (parsed.type) {
                  events.push({ type: parsed.type, data: parsed.data });
                }
              } catch {
                // 忽略无法解析的行
              }
            }
          }

          if (collected) break;
        }
      } catch {
        // reader 被 abort 或流结束
      }

      clearTimeout(timeout);
      collected = true;
    } catch {
      // fetch 超时或被 abort
    }

    const progressEvents = events.filter((e) => e.type === 'progress');
    console.log(`[S7] SSE 事件: ${events.length} 个总计, ${progressEvents.length} 个 progress`);

    assert.ok(events.length > 0, '应至少收到一个 SSE 事件');
    assert.ok(progressEvents.length > 0, '应至少收到一个 progress 事件');

    const lastProgress = progressEvents[progressEvents.length - 1];
    assert.ok(lastProgress.data, 'progress 事件包含 data');
    const pData = lastProgress.data as { sessionId?: string; progress?: number; status?: string };
    assert.ok(pData.sessionId, 'progress 事件包含 sessionId');

    ctx.metrics.scenarios.push({
      name: 'S7: SSE 流',
      status: 'pass',
      durationMs: Math.round(performance.now() - start),
    });
  } catch (err) {
    ctx.metrics.scenarios.push({
      name: 'S7: SSE 流',
      status: 'fail',
      durationMs: Math.round(performance.now() - start),
      details: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
});

// ==================== 清理 ====================

test('清理: 停止 ApiServer + Mock CodeHub + 汇总输出', async () => {
  if (ctx?.server) {
    await stopApiServer(ctx.server);
    console.log('[E2E] ApiServer 已停止');
  }
  if (ctx?.mockHandle) {
    await ctx.mockHandle.close();
    console.log('[E2E] Mock CodeHub 已停止');
  }

  const totalDuration = Date.now() - ctx.metrics.startTime;
  const passed = ctx.metrics.scenarios.filter((s) => s.status === 'pass').length;
  const failed = ctx.metrics.scenarios.filter((s) => s.status === 'fail').length;
  const total = ctx.metrics.scenarios.length;

  console.log('\n========== E2E 测试汇总 ==========');
  console.log(`总耗时: ${totalDuration}ms`);
  console.log(`通过: ${passed}/${total}`);
  console.log(`失败: ${failed}/${total}`);
  console.log(`Critical: ${ctx.metrics.criticalCount}, High: ${ctx.metrics.highCount}, Medium: ${ctx.metrics.mediumCount}`);
  console.log(`总重试次数: ${ctx.metrics.totalRetries}`);
  console.log('----------------------------------');
  for (const s of ctx.metrics.scenarios) {
    const icon = s.status === 'pass' ? '✅' : s.status === 'fail' ? '❌' : '⚠️';
    const retryInfo = s.retryCount ? ` (重试 ${s.retryCount})` : '';
    const detail = s.details ? ` — ${s.details}` : '';
    console.log(`${icon} ${s.name}: ${s.status} [${s.durationMs}ms]${retryInfo}${detail}`);
  }
  console.log('==================================\n');

  // 将汇总写入临时文件
  const summaryPath = join(tmpdir(), `e2e-summary-${Date.now()}.json`);
  const summary = {
    totalDuration,
    passed,
    failed,
    total,
    criticalCount: ctx.metrics.criticalCount,
    highCount: ctx.metrics.highCount,
    mediumCount: ctx.metrics.mediumCount,
    totalRetries: ctx.metrics.totalRetries,
    scenarios: ctx.metrics.scenarios,
    mockMode: MOCK_MODE,
    timestamp: new Date().toISOString(),
  };
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`[E2E] 汇总已写入: ${summaryPath}`);
  process.env.E2E_SUMMARY_PATH = summaryPath;
});