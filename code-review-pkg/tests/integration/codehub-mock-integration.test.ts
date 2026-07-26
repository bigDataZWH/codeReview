// tests/integration/codehub-mock-integration.test.ts
// Task 6：Mock CodeHub Server 集成测试
// 直接测试 startMockCodeHubServer，验证所有端点的正确响应

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startMockCodeHubServer, type MockCodeHubServerHandle } from '../../src/mock-codehub-server.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', '..', 'mock-codehub-fixtures');

const TOKEN = 'mock-token';
const PROJECT_ID = '1';

let handle: MockCodeHubServerHandle;

beforeAll(async () => {
  handle = await startMockCodeHubServer({
    port: 9091,
    hostname: '127.0.0.1',
    fixturesDir: FIXTURES_DIR,
  });
});

afterAll(async () => {
  await handle.close();
});

async function apiCall(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${handle.baseUrl}/api/v3/projects/${PROJECT_ID}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      'PRIVATE-TOKEN': TOKEN,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

// ==================== 1. 项目信息端点 ====================

describe('1. 项目信息端点', () => {
  it('GET / 返回 200 + 项目对象，包含必要字段', async () => {
    const res = await apiCall('');
    expect(res.status).toBe(200);
    const project = (await res.json()) as Record<string, unknown>;
    expect(project).toHaveProperty('id');
    expect(project).toHaveProperty('name');
    expect(project).toHaveProperty('path_with_namespace');
    expect(project).toHaveProperty('default_branch');
  });
});

// ==================== 2. MR 列表端点 ====================

describe('2. MR 列表端点', () => {
  it('GET /merge_requests 返回 200 + 5 个 MR', async () => {
    const res = await apiCall('/merge_requests');
    expect(res.status).toBe(200);
    const mrs = (await res.json()) as Array<{ state: string }>;
    expect(Array.isArray(mrs)).toBe(true);
    expect(mrs.length).toBe(5);
  });

  it('GET /merge_requests?state=open 过滤后返回 open 状态的 MR', async () => {
    const res = await apiCall('/merge_requests?state=open');
    expect(res.status).toBe(200);
    const mrs = (await res.json()) as Array<{ state: string }>;
    expect(mrs.length).toBe(3);
    expect(mrs.every((mr) => mr.state === 'open')).toBe(true);
  });

  it('GET /merge_requests?state=merged 过滤后返回 merged 状态的 MR', async () => {
    const res = await apiCall('/merge_requests?state=merged');
    expect(res.status).toBe(200);
    const mrs = (await res.json()) as Array<{ state: string }>;
    expect(mrs.length).toBe(1);
    expect(mrs.every((mr) => mr.state === 'merged')).toBe(true);
  });

  it('GET /merge_requests?state=closed 过滤后返回 closed 状态的 MR', async () => {
    const res = await apiCall('/merge_requests?state=closed');
    expect(res.status).toBe(200);
    const mrs = (await res.json()) as Array<{ state: string }>;
    expect(mrs.length).toBe(1);
    expect(mrs.every((mr) => mr.state === 'closed')).toBe(true);
  });
});

// ==================== 3. MR 详情端点 ====================

describe('3. MR 详情端点', () => {
  it('GET /merge_requests/1 返回 200 + MR 1 详情', async () => {
    const res = await apiCall('/merge_requests/1');
    expect(res.status).toBe(200);
    const mr = (await res.json()) as { iid: number; title: string };
    expect(mr.iid).toBe(1);
    expect(typeof mr.title).toBe('string');
    expect(mr.title.length).toBeGreaterThan(0);
  });

  it('GET /merge_requests/9999 返回 404 + Not Found', async () => {
    const res = await apiCall('/merge_requests/9999');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('Not Found');
  });
});

// ==================== 4. MR Diff 端点 ====================

describe('4. MR Diff 端点', () => {
  it('GET /merge_requests/1/diffs?unidiff=true 返回 200 + diff 对象', async () => {
    const res = await apiCall('/merge_requests/1/diffs?unidiff=true');
    expect(res.status).toBe(200);
    const diff = (await res.json()) as {
      changes: unknown[];
      diff_refs: { base_sha: string; head_sha: string; start_sha: string };
    };
    expect(Array.isArray(diff.changes)).toBe(true);
    expect(diff.changes.length).toBeGreaterThanOrEqual(1);
    expect(diff.diff_refs).toBeDefined();
    expect(diff.diff_refs.base_sha).toBeDefined();
    expect(diff.diff_refs.head_sha).toBeDefined();
    expect(diff.diff_refs.start_sha).toBeDefined();
  });
});

// ==================== 5. MR 评论端点 ====================

describe('5. MR 评论端点', () => {
  it('GET /merge_requests/1/notes 返回 200 + 评论数组', async () => {
    const res = await apiCall('/merge_requests/1/notes');
    expect(res.status).toBe(200);
    const comments = (await res.json()) as unknown[];
    expect(Array.isArray(comments)).toBe(true);
    expect(comments.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /merge_requests/1/notes 返回 201 + 新评论对象', async () => {
    const res = await apiCall('/merge_requests/1/notes', {
      method: 'POST',
      body: JSON.stringify({ body: '测试评论' }),
    });
    expect(res.status).toBe(201);
    const comment = (await res.json()) as {
      id: number;
      created_at: string;
      body: string;
    };
    expect(typeof comment.id).toBe('number');
    expect(typeof comment.created_at).toBe('string');
    expect(comment.body).toBe('测试评论');
  });

  it('POST 后 GET 验证评论数增加', async () => {
    const beforeRes = await apiCall('/merge_requests/1/notes');
    const before = (await beforeRes.json()) as unknown[];
    const beforeCount = before.length;

    const postRes = await apiCall('/merge_requests/1/notes', {
      method: 'POST',
      body: JSON.stringify({ body: '另一条测试评论' }),
    });
    expect(postRes.status).toBe(201);

    const afterRes = await apiCall('/merge_requests/1/notes');
    const after = (await afterRes.json()) as unknown[];
    expect(after.length).toBe(beforeCount + 1);
  });

  it('DELETE /merge_requests/1/notes/:noteId 返回 204', async () => {
    // 先创建一条评论用于删除
    const createRes = await apiCall('/merge_requests/1/notes', {
      method: 'POST',
      body: JSON.stringify({ body: '待删除评论' }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: number };

    const deleteRes = await apiCall(`/merge_requests/1/notes/${created.id}`, {
      method: 'DELETE',
    });
    expect(deleteRes.status).toBe(204);
  });
});

// ==================== 6. Issue 端点 ====================

describe('6. Issue 端点', () => {
  it('GET /issues 返回 200 + Issue 数组', async () => {
    const res = await apiCall('/issues');
    expect(res.status).toBe(200);
    const issues = (await res.json()) as unknown[];
    expect(Array.isArray(issues)).toBe(true);
  });

  it('POST /issues 返回 201 + 新 Issue 对象', async () => {
    const res = await apiCall('/issues', {
      method: 'POST',
      body: JSON.stringify({ title: '测试Issue', description: '测试描述' }),
    });
    expect(res.status).toBe(201);
    const issue = (await res.json()) as {
      iid: number;
      created_at: string;
      title: string;
      description: string;
    };
    expect(typeof issue.iid).toBe('number');
    expect(typeof issue.created_at).toBe('string');
    expect(issue.title).toBe('测试Issue');
    expect(issue.description).toBe('测试描述');
  });

  it('POST 后 GET 验证 Issue 数增加', async () => {
    const beforeRes = await apiCall('/issues');
    const before = (await beforeRes.json()) as unknown[];
    const beforeCount = before.length;

    const postRes = await apiCall('/issues', {
      method: 'POST',
      body: JSON.stringify({ title: '另一个测试Issue' }),
    });
    expect(postRes.status).toBe(201);

    const afterRes = await apiCall('/issues');
    const after = (await afterRes.json()) as unknown[];
    expect(after.length).toBe(beforeCount + 1);
  });
});

// ==================== 7. 分支端点 ====================

describe('7. 分支端点', () => {
  it('GET /repository/branches 返回 200 + 分支数组', async () => {
    const res = await apiCall('/repository/branches');
    expect(res.status).toBe(200);
    const branches = (await res.json()) as Array<{ name: string }>;
    expect(Array.isArray(branches)).toBe(true);
    expect(branches.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /repository/branches/main 返回 200 + 分支详情', async () => {
    const res = await apiCall('/repository/branches/main');
    expect(res.status).toBe(200);
    const branch = (await res.json()) as { name: string };
    expect(branch.name).toBe('main');
  });

  it('GET /repository/branches/nonexistent 返回 404', async () => {
    const res = await apiCall('/repository/branches/nonexistent');
    expect(res.status).toBe(404);
  });
});

// ==================== 8. 鉴权测试 ====================

describe('8. 鉴权测试', () => {
  it('请求不带 PRIVATE-TOKEN header 返回 401', async () => {
    const url = `${handle.baseUrl}/api/v3/projects/${PROJECT_ID}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('Unauthorized');
  });

  it('请求带空 token 返回 401', async () => {
    const url = `${handle.baseUrl}/api/v3/projects/${PROJECT_ID}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'PRIVATE-TOKEN': '',
        'Content-Type': 'application/json',
      },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('Unauthorized');
  });

  it('请求带任意非空 token 正常响应', async () => {
    const url = `${handle.baseUrl}/api/v3/projects/${PROJECT_ID}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'PRIVATE-TOKEN': 'any-non-empty-token',
        'Content-Type': 'application/json',
      },
    });
    expect(res.status).toBe(200);
  });
});

// ==================== 9. 内存状态一致性 ====================

describe('9. 内存状态一致性', () => {
  it('POST 创建评论 → GET 评论列表 → 验证新评论在列表中', async () => {
    const uniqueBody = `状态一致性测试评论-${Date.now()}`;
    const createRes = await apiCall('/merge_requests/1/notes', {
      method: 'POST',
      body: JSON.stringify({ body: uniqueBody }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: number; body: string };

    const listRes = await apiCall('/merge_requests/1/notes');
    expect(listRes.status).toBe(200);
    const comments = (await listRes.json()) as Array<{ id: number; body: string }>;
    const found = comments.find((c) => c.id === created.id);
    expect(found).toBeDefined();
    expect(found?.body).toBe(uniqueBody);
  });

  it('POST 创建 Issue → GET Issue 列表 → 验证新 Issue 在列表中', async () => {
    const uniqueTitle = `状态一致性测试Issue-${Date.now()}`;
    const createRes = await apiCall('/issues', {
      method: 'POST',
      body: JSON.stringify({ title: uniqueTitle, description: '验证一致性' }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { iid: number; title: string };

    const listRes = await apiCall('/issues');
    expect(listRes.status).toBe(200);
    const issues = (await listRes.json()) as Array<{ iid: number; title: string }>;
    const found = issues.find((i) => i.iid === created.iid);
    expect(found).toBeDefined();
    expect(found?.title).toBe(uniqueTitle);
  });
});
