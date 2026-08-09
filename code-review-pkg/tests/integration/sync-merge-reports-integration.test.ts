// tests/integration/sync-merge-reports-integration.test.ts
// Task 19.2：sync / merge / reports 端点集成测试
// 启动 Mock CodeHub Server + API Server，通过 HTTP 端点验证完整链路
//
// 注意：codehub-routes.ts 中的 repoManager 与 syncScheduler 为模块级单例，
// 通过 POST /api/v1/codehub/repos-config 添加仓库来配置单例，
// 测试后清理 .codehub-config.json 与 historyStore 避免污染。

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockCodeHubServer, type MockCodeHubServerHandle } from '../../src/mock-codehub-server.js';
import { startApiServer, type ApiServer } from '../../src/api-server.js';
import { historyStore } from '../../src/review-runner.js';
import type { Finding } from '../../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', '..', 'mock-codehub-fixtures');
// 模块级 repoManager 使用 DEFAULT_CONFIG_FILE = '.codehub-config.json'（相对 process.cwd()）
const CONFIG_FILE = resolve(process.cwd(), '.codehub-config.json');

let mockHandle: MockCodeHubServerHandle;
let webServer: ApiServer;
let webPort: number;
let repoId: string;
// 备份原始配置文件内容（测试前若文件存在则备份，测试后恢复）
let originalConfigContent: string | null = null;

/** 动态获取一个可用端口，避免与已运行服务冲突 */
async function getAvailablePort(): Promise<number> {
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

/** 构造一个 Finding */
function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    file: overrides.file ?? 'src/app.ts',
    line: overrides.line ?? 1,
    severity: overrides.severity ?? 'medium',
    category: overrides.category ?? 'quality',
    message: overrides.message ?? '示例问题',
    confidence: overrides.confidence ?? 0.9,
    source: overrides.source ?? 'rule',
    ruleId: overrides.ruleId,
    id: overrides.id ?? 'finding-1',
    ...overrides,
  };
}

beforeAll(async () => {
  // 1. 备份已有配置文件（避免污染用户配置）
  if (existsSync(CONFIG_FILE)) {
    originalConfigContent = readFileSync(CONFIG_FILE, 'utf-8');
  }

  // 2. 启动 Mock CodeHub Server（使用 fixtures 数据）
  const mockPort = await getAvailablePort();
  mockHandle = await startMockCodeHubServer({
    port: mockPort,
    hostname: '127.0.0.1',
    fixturesDir: FIXTURES_DIR,
  });

  // 3. 启动 API Server（启用 CodeHub，禁用静态文件服务）
  webPort = await getAvailablePort();
  webServer = await startApiServer({
    port: webPort,
    host: '127.0.0.1',
    enableCodeHub: true,
    enableStatic: false,
    logger: () => undefined,
  });

  // 4. 通过 repos-config API 添加仓库（配置模块级 repoManager 单例）
  const addRes = await fetch(`http://127.0.0.1:${webPort}/api/v1/codehub/repos-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'test-mock-repo',
      baseUrl: mockHandle.baseUrl,
      token: 'mock-token',
      projectId: 1,
    }),
  });
  expect(addRes.status).toBe(201);
  const addBody = (await addRes.json()) as { ok: boolean; repo: { repoId: string; name: string } };
  repoId = addBody.repo.repoId;

  // 5. 向 historyStore 添加测试数据（用于报表端点验证）
  historyStore.clear();
  const now = new Date().toISOString();
  // 记录1：mrIid=1, zhangsan, R001(high), submitted&&resolved
  historyStore.add({
    mrIid: 1,
    repoId,
    author: 'zhangsan',
    finding: makeFinding({ id: 'f1', ruleId: 'R001', severity: 'high', file: 'src/a.ts', line: 10 }),
    reviewedAt: now,
    submitted: true,
    resolved: true,
    blockedMerge: false,
  });
  // 记录2：mrIid=1, zhangsan, R002(medium), submitted&&!resolved
  historyStore.add({
    mrIid: 1,
    repoId,
    author: 'zhangsan',
    finding: makeFinding({ id: 'f2', ruleId: 'R002', severity: 'medium', file: 'src/b.ts', line: 20 }),
    reviewedAt: now,
    submitted: true,
    resolved: false,
    blockedMerge: false,
  });
  // 记录3：mrIid=2, lisi, R001(critical), 未提交, blockedMerge
  historyStore.add({
    mrIid: 2,
    repoId,
    author: 'lisi',
    finding: makeFinding({ id: 'f3', ruleId: 'R001', severity: 'critical', file: 'src/c.ts', line: 30 }),
    reviewedAt: now,
    submitted: false,
    resolved: false,
    blockedMerge: true,
  });
});

afterAll(async () => {
  // 1. 停止服务器
  if (webServer) {
    await webServer.stop();
  }
  if (mockHandle) {
    await mockHandle.close();
  }

  // 2. 清理 historyStore
  historyStore.clear();

  // 3. 恢复或删除配置文件
  if (originalConfigContent !== null) {
    writeFileSync(CONFIG_FILE, originalConfigContent, 'utf-8');
  } else if (existsSync(CONFIG_FILE)) {
    unlinkSync(CONFIG_FILE);
  }
});

/** 调用 CodeHub API */
async function codehubApi(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${webPort}/api/v1/codehub${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

/** 调用 Reports API */
async function reportsApi(path: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${webPort}/api/v1/reports${path}`);
}

// ==================== 1. 同步端点 ====================

describe('1. 同步端点', () => {
  it('POST /api/v1/codehub/mrs/sync 手动触发同步，返回 syncedAt/repoCount/mrCount', async () => {
    const res = await codehubApi('/mrs/sync', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      syncedAt: string;
      repoCount: number;
      mrCount: number;
      errors: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.syncedAt).toBeTruthy();
    expect(body.repoCount).toBe(1); // 1 个仓库
    // fixtures 中 open 状态的 MR：iid 1, 2, 5 → 3 个
    expect(body.mrCount).toBe(3);
    expect(body.errors).toEqual([]);
  });

  it('GET /api/v1/codehub/mrs/sync/status 返回同步状态快照', async () => {
    const res = await codehubApi('/mrs/sync/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      running: boolean;
      lastSyncAt: string | null;
      lastSyncCount: number;
      nextSyncAt: string | null;
      syncIntervalMs: number;
      paused: boolean;
      errors: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.lastSyncAt).toBeTruthy();
    expect(body.lastSyncCount).toBe(3);
    expect(body.running).toBe(false);
    expect(typeof body.syncIntervalMs).toBe('number');
    expect(body.paused).toBe(false);
    expect(Array.isArray(body.errors)).toBe(true);
  });

  it('POST /api/v1/codehub/mrs/sync/pause 暂停定时同步', async () => {
    const res = await codehubApi('/mrs/sync/pause', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; paused: boolean };
    expect(body.ok).toBe(true);
    expect(body.paused).toBe(true);

    // 验证状态已更新
    const statusRes = await codehubApi('/mrs/sync/status');
    const statusBody = (await statusRes.json()) as { paused: boolean };
    expect(statusBody.paused).toBe(true);
  });

  it('POST /api/v1/codehub/mrs/sync/resume 恢复定时同步', async () => {
    const res = await codehubApi('/mrs/sync/resume', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      paused: boolean;
      nextSyncAt: string | null;
    };
    expect(body.ok).toBe(true);
    expect(body.paused).toBe(false);

    // 验证状态已更新
    const statusRes = await codehubApi('/mrs/sync/status');
    const statusBody = (await statusRes.json()) as { paused: boolean };
    expect(statusBody.paused).toBe(false);
  });
});

// ==================== 2. 合入端点 ====================

describe('2. 合入端点', () => {
  it('GET /api/v1/codehub/mrs/:iid/merge/check 无 findings 时 canMerge=true', async () => {
    // 未运行检视，reviewFindingsStore 为空，无阻断 findings
    const res = await codehubApi('/mrs/1/merge/check');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      canMerge: boolean;
      blockingFindings: unknown[];
      warnings: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.canMerge).toBe(true);
    expect(body.blockingFindings).toEqual([]);
    expect(body.warnings).toEqual([]);
  });

  it('POST /api/v1/codehub/mrs/:iid/merge 无阻断时成功合入', async () => {
    // MR 2 为 open 状态，无阻断 findings → 合入成功
    const res = await codehubApi('/mrs/2/merge', {
      method: 'POST',
      body: JSON.stringify({ mergeMethod: 'squash' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      merged: boolean;
      mrState: string;
    };
    expect(body.ok).toBe(true);
    expect(body.merged).toBe(true);
    expect(body.mrState).toBe('merged');
  });

  it('合入后 MR 状态变为 merged', async () => {
    // 验证 MR 2 已合入（通过 MR 详情端点转发）
    const res = await codehubApi('/mrs/2');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      mr: { iid: number; state: string };
    };
    expect(body.ok).toBe(true);
    expect(body.mr.iid).toBe(2);
    expect(body.mr.state).toBe('merged');
  });
});

// ==================== 3. 报表端点 ====================

describe('3. 报表端点', () => {
  it('GET /api/v1/reports/overview 返回总览指标', async () => {
    const res = await reportsApi('/overview');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      overview: {
        totalFindings: number;
        reviewCount: number;
        interceptionCount: number;
        acceptanceRate: number;
        acceptanceNumerator: number;
        acceptanceDenominator: number;
        avgFindingsPerMR: number;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.overview).toBeDefined();
    // 3 条历史记录
    expect(body.overview.totalFindings).toBe(3);
    // 2 个不同 MR（1@repo, 2@repo）
    expect(body.overview.reviewCount).toBe(2);
    // 1 个 MR 阻断合入（2@repo）
    expect(body.overview.interceptionCount).toBe(1);
    // submitted&&resolved / submitted = 1/2 = 50%
    expect(body.overview.acceptanceNumerator).toBe(1);
    expect(body.overview.acceptanceDenominator).toBe(2);
    expect(body.overview.acceptanceRate).toBeCloseTo(50, 5);
    // 3 findings / 2 MR = 1.5
    expect(body.overview.avgFindingsPerMR).toBeCloseTo(1.5, 5);
  });

  it('GET /api/v1/reports/trend?range=7d 返回趋势数据', async () => {
    const res = await reportsApi('/trend?range=7d');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      trend: Array<{
        date: string;
        reviews: number;
        findings: number;
        acceptedFindings: number;
        interceptions: number;
      }>;
    };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.trend)).toBe(true);
    expect(body.trend).toHaveLength(7);
    // 今日应有数据（3 条记录均在今日）
    const todayPoint = body.trend[body.trend.length - 1];
    expect(todayPoint.findings).toBe(3);
    expect(todayPoint.reviews).toBe(2); // 2 个不同 MR
    expect(todayPoint.acceptedFindings).toBe(1); // 1 条 resolved
    expect(todayPoint.interceptions).toBe(1); // 1 个阻断 MR
  });

  it('GET /api/v1/reports/trend 默认 range 为 30d', async () => {
    const res = await reportsApi('/trend');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { trend: unknown[] };
    expect(body.trend).toHaveLength(30);
  });

  it('GET /api/v1/reports/by-rule 返回按规则聚合', async () => {
    const res = await reportsApi('/by-rule');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      items: Array<{
        ruleId: string;
        ruleName: string;
        hitCount: number;
        acceptanceCount: number;
        acceptanceRate: number;
      }>;
    };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(2); // R001, R002
    // R001 hitCount=2（记录1+记录3），R002 hitCount=1（记录2）
    const r001 = body.items.find((i) => i.ruleId === 'R001');
    const r002 = body.items.find((i) => i.ruleId === 'R002');
    expect(r001?.hitCount).toBe(2);
    expect(r002?.hitCount).toBe(1);
    // R001: submitted=1（记录1），resolved=1 → acceptanceRate=100
    expect(r001?.acceptanceCount).toBe(1);
    expect(r001?.acceptanceRate).toBeCloseTo(100, 5);
    // R002: submitted=1（记录2），resolved=0 → acceptanceRate=0
    expect(r002?.acceptanceCount).toBe(0);
    expect(r002?.acceptanceRate).toBe(0);
    // 按 hitCount 降序
    expect(body.items[0].hitCount).toBeGreaterThanOrEqual(body.items[1].hitCount);
  });

  it('GET /api/v1/reports/by-author 返回按作者聚合', async () => {
    const res = await reportsApi('/by-author');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      items: Array<{
        author: string;
        mrCount: number;
        totalFindings: number;
        avgFindingsPerMR: number;
        acceptanceRate: number;
      }>;
    };
    expect(body.ok).toBe(true);
    expect(body.items).toHaveLength(2); // zhangsan, lisi
    const zs = body.items.find((i) => i.author === 'zhangsan');
    const ls = body.items.find((i) => i.author === 'lisi');
    // zhangsan: 1 个 MR（1@repo），2 条 findings
    expect(zs?.mrCount).toBe(1);
    expect(zs?.totalFindings).toBe(2);
    expect(zs?.avgFindingsPerMR).toBeCloseTo(2, 5);
    // submitted=2, resolved=1 → acceptanceRate=50
    expect(zs?.acceptanceRate).toBeCloseTo(50, 5);
    // lisi: 1 个 MR（2@repo），1 条 finding
    expect(ls?.mrCount).toBe(1);
    expect(ls?.totalFindings).toBe(1);
    // submitted=0 → acceptanceRate=0
    expect(ls?.acceptanceRate).toBe(0);
  });

  it('GET /api/v1/reports/by-repo 返回按仓库聚合', async () => {
    const res = await reportsApi('/by-repo');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      items: Array<{
        repoId: string;
        repoName: string;
        mrCount: number;
        findings: number;
        acceptanceRate: number;
        interceptions: number;
      }>;
    };
    expect(body.ok).toBe(true);
    expect(body.items).toHaveLength(1); // 1 个仓库
    const item = body.items[0];
    expect(item.repoId).toBe(repoId);
    expect(item.repoName).toBe('test-mock-repo');
    expect(item.mrCount).toBe(2); // 2 个不同 MR
    expect(item.findings).toBe(3); // 3 条 findings
    // submitted=2, resolved=1 → acceptanceRate=50
    expect(item.acceptanceRate).toBeCloseTo(50, 5);
    expect(item.interceptions).toBe(1); // 1 个阻断 MR
  });
});
