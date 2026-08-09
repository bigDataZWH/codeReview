// tests/integration/web-e2e-mock.test.ts
// Task 7：Web API 服务器通过 Mock CodeHub 的端到端测试
// 启动 mock-codehub + serve 两个服务，通过 /api/v1/codehub/* 端点验证完整链路

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { startMockCodeHubServer, type MockCodeHubServerHandle } from '../../src/mock-codehub-server.js';
import { startApiServer, type ApiServer } from '../../src/api-server.js';
import { _resetRepoManagerCacheForTests } from '../../src/codehub-routes.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', '..', 'mock-codehub-fixtures');

const MOCK_PORT = 9092;
const TOKEN = 'mock-token';
const PROJECT_ID = '1';

let mockHandle: MockCodeHubServerHandle;
let webServer: ApiServer;
let configPath: string;
let webPort: number;

/** 动态获取一个可用端口，避免与已运行服务（如 opencode serve 占用 4098）冲突 */
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

beforeAll(async () => {
  // 避免进程内其他测试文件已初始化 repoManager 缓存（模块级 Map）导致本测试自定义 configPath 被忽略
  _resetRepoManagerCacheForTests();

  // 1. 启动 mock-codehub
  mockHandle = await startMockCodeHubServer({
    port: MOCK_PORT,
    hostname: '127.0.0.1',
    fixturesDir: FIXTURES_DIR,
  });

  // 2. 创建临时 CodeHub 配置文件，指向 mock 服务
  const tmpDir = tmpdir();
  const configDir = resolve(tmpDir, `codehub-test-${Date.now()}`);
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  configPath = resolve(configDir, 'codehub-config.json');
  const config = {
    baseUrl: mockHandle.baseUrl,
    token: TOKEN,
    projectId: PROJECT_ID,
    repoBaseDir: '.codehub-repos',
  };
  writeFileSync(configPath, JSON.stringify(config), 'utf8');

  // 3. 动态获取可用端口并启动 Web API server（避免与 opencode serve 占用的 4098 冲突）
  webPort = await getAvailablePort();
  webServer = await startApiServer({
    port: webPort,
    host: '127.0.0.1',
    enableCodeHub: true,
    enableStatic: false,
    codehubConfigPath: configPath,
    logger: () => undefined,
  });
});

afterAll(async () => {
  if (webServer) {
    await webServer.stop();
  }
  if (mockHandle) {
    await mockHandle.close();
  }
});

async function webApi(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${webPort}/api/v1/codehub${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

// ==================== 1. 健康检查 ====================

describe('1. 健康检查', () => {
  it('GET /api/v1/health 返回 200 + { status: "ok" }', async () => {
    const res = await fetch(`http://127.0.0.1:${webPort}/api/v1/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });
});

// ==================== 2. CodeHub 配置读取 ====================

describe('2. CodeHub 配置读取', () => {
  it('GET /api/v1/codehub/config 返回 200 + 配置对象', async () => {
    const res = await webApi('/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      config: { baseUrl: string; token: string; projectId: string };
    };
    expect(body.ok).toBe(true);
    expect(body.config).toBeDefined();
    // baseUrl 应指向 mock 服务
    expect(body.config.baseUrl).toBe(mockHandle.baseUrl);
    // token 应被脱敏处理（包含 ****）
    expect(body.config.token).toContain('****');
    expect(body.config.projectId).toBe(PROJECT_ID);
  });
});

// ==================== 3. MR 列表转发 ====================

describe('3. MR 列表转发', () => {
  it('GET /api/v1/codehub/mrs?state=all 返回 200 + 5 个 MR', async () => {
    // 注：Web API 默认 state=open（仅返回 open 状态），需显式传 state=all 获取全部
    const res = await webApi('/mrs?state=all');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      mrs: unknown[];
      total: number;
    };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.mrs)).toBe(true);
    expect(body.mrs.length).toBe(5);
    expect(body.total).toBe(5);
  });

  it('GET /api/v1/codehub/mrs 默认返回 open 状态的 MR', async () => {
    const res = await webApi('/mrs');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      mrs: Array<{ state: string }>;
      total: number;
    };
    expect(body.ok).toBe(true);
    expect(body.mrs.length).toBe(3);
    expect(body.mrs.every((mr) => mr.state === 'open')).toBe(true);
  });
});

// ==================== 4. MR 详情转发 ====================

describe('4. MR 详情转发', () => {
  it('GET /api/v1/codehub/mrs/1 返回 200 + MR 详情', async () => {
    const res = await webApi('/mrs/1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      mr: { iid: number; title: string };
    };
    expect(body.ok).toBe(true);
    expect(body.mr).toBeDefined();
    expect(body.mr.iid).toBe(1);
    expect(typeof body.mr.title).toBe('string');
    expect(body.mr.title.length).toBeGreaterThan(0);
  });
});

// ==================== 5. MR Diff 转发 ====================

describe('5. MR Diff 转发', () => {
  it('GET /api/v1/codehub/mrs/1/diff 返回 200 + diff 对象', async () => {
    const res = await webApi('/mrs/1/diff');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      diff: {
        changes: unknown[];
        diff_refs: { base_sha: string; head_sha: string; start_sha: string };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.diff).toBeDefined();
    expect(Array.isArray(body.diff.changes)).toBe(true);
    expect(body.diff.changes.length).toBeGreaterThanOrEqual(1);
    expect(body.diff.diff_refs).toBeDefined();
    expect(body.diff.diff_refs.base_sha).toBeDefined();
    expect(body.diff.diff_refs.head_sha).toBeDefined();
    expect(body.diff.diff_refs.start_sha).toBeDefined();
  });
});

// ==================== 6. MR 评论列表转发 ====================

describe('6. MR 评论列表转发', () => {
  it('GET /api/v1/codehub/mrs/1/comments 返回 200 + 评论列表', async () => {
    const res = await webApi('/mrs/1/comments');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      comments: unknown[];
      count: number;
    };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.comments)).toBe(true);
    expect(body.count).toBe(body.comments.length);
  });
});

// ==================== 7. 创建 MR 评论转发 ====================

describe('7. 创建 MR 评论转发', () => {
  it('POST /api/v1/codehub/mrs/1/comments 创建评论并验证 mock 收到', async () => {
    const commentBody = `通过 Web API 创建的评论-${Date.now()}`;

    // 先获取评论数
    const beforeRes = await webApi('/mrs/1/comments');
    const beforeBody = (await beforeRes.json()) as { count: number };
    const beforeCount = beforeBody.count;

    // 通过 Web API 创建评论
    const createRes = await webApi('/mrs/1/comments', {
      method: 'POST',
      body: JSON.stringify({ body: commentBody }),
    });
    expect(createRes.status).toBe(200);
    const createBody = (await createRes.json()) as {
      ok: boolean;
      comment: { id: number; body: string; created_at: string };
    };
    expect(createBody.ok).toBe(true);
    expect(createBody.comment).toBeDefined();
    expect(typeof createBody.comment.id).toBe('number');
    expect(typeof createBody.comment.created_at).toBe('string');
    expect(createBody.comment.body).toBe(commentBody);

    // 再 GET 评论列表，验证新评论存在
    const afterRes = await webApi('/mrs/1/comments');
    expect(afterRes.status).toBe(200);
    const afterBody = (await afterRes.json()) as {
      comments: Array<{ id: number; body: string }>;
      count: number;
    };
    expect(afterBody.count).toBe(beforeCount + 1);
    const found = afterBody.comments.find((c) => c.id === createBody.comment.id);
    expect(found).toBeDefined();
    expect(found?.body).toBe(commentBody);
  });
});

// ==================== 8. 创建 Issue 转发（错误处理） ====================

describe('8. 创建 Issue 转发（错误处理）', () => {
  it('POST /api/v1/codehub/mrs/1/issue 无 findings 时返回 400', async () => {
    // 由于没有 findings（未运行审查），应返回 400 错误
    const res = await webApi('/mrs/1/issue', {
      method: 'POST',
      body: JSON.stringify({ labels: ['bug'] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('No findings found');
  });
});

// ==================== 9. 分支列表转发（Web API 未直接暴露 CodeHub 分支端点） ====================
//
// codehub-routes.ts 中分支端点位于 /api/v1/codehub/repos/:projectId/branches，
// 依赖 RepoManager 本地仓库，且非直接 CodeHub 转发，故此处跳过。
