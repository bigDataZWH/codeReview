import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { publishReview } from '../src/comment-publisher.js';
import type { PublishOptions, Finding, PublishResult } from '../src/types.js';

// ---- 辅助函数 ----

function makeFinding(overrides: Partial<Finding> & { file: string; line: number }): Finding {
  return {
    severity: 'medium',
    category: 'security',
    message: 'test finding message',
    confidence: 0.7,
    source: 'rule',
    ...overrides,
  };
}

function makeOptions(overrides: Partial<PublishOptions> = {}): PublishOptions {
  return {
    findings: [],
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 42,
    token: 'ghp_test_token',
    ...overrides,
  };
}

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : status === 201 ? 'Created' : status === 401 ? 'Unauthorized' : status === 404 ? 'Not Found' : 'Internal Server Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeEmptyResponse(status: number = 200): Response {
  return new Response('', {
    status,
    statusText: status === 200 ? 'OK' : 'No Content',
    headers: {},
  });
}

// ---- 测试 ----

describe('comment-publisher', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==================== fetchExistingComments ====================
  describe('fetchExistingComments（通过 publishReview 间接测试）', () => {
    it('获取已有 review comments — 成功返回 review comments 列表', async () => {
      const reviewComments = [
        { id: 101, path: 'src/app.ts', line: 10, body: '## [medium] security\n\nold finding' },
        { id: 102, path: 'src/lib.ts', line: 5, body: '## [high] bug\n\nold bug' },
      ];

      vi.spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request) => {
        const urlStr = url.toString();
        // GET /pulls/{pr}/comments (review comments)
        if (urlStr.includes('/pulls/42/comments') && !urlStr.includes('/issues/')) {
          return Promise.resolve(makeJsonResponse(200, reviewComments));
        }
        // GET /issues/{pr}/comments
        if (urlStr.includes('/issues/42/comments')) {
          return Promise.resolve(makeJsonResponse(200, []));
        }
        return Promise.resolve(makeJsonResponse(404, {}));
      });

      const options = makeOptions({ mode: 'replace', findings: [] });
      const result = await publishReview(options);

      expect(result.inlineCount).toBe(0);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/pulls/42/comments'),
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('获取已有 issue comments — 用于找 summary 评论', async () => {
      const issueComments = [
        { id: 200, body: 'some unrelated comment' },
        { id: 201, body: '## Code Review Summary\n\n**3 findings** ...\n\n<!-- code-review:summary -->' },
      ];

      vi.spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('/pulls/42/comments') && !urlStr.includes('/issues/')) {
          return Promise.resolve(makeJsonResponse(200, []));
        }
        if (urlStr.includes('/issues/42/comments')) {
          return Promise.resolve(makeJsonResponse(200, issueComments));
        }
        return Promise.resolve(makeJsonResponse(404, {}));
      });

      const options = makeOptions({ mode: 'replace', findings: [] });
      await publishReview(options);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/issues/42/comments'),
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('API 错误处理 — 401 Unauthorized 抛出错误', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('/pulls/42/comments') && !urlStr.includes('/issues/')) {
          return Promise.resolve(makeJsonResponse(401, { message: 'Bad credentials' }));
        }
        return Promise.resolve(makeJsonResponse(404, {}));
      });

      const options = makeOptions({ mode: 'replace', findings: [] });
      await expect(publishReview(options)).rejects.toThrow(/401|Bad credentials/i);
    });

    it('API 错误处理 — 500 Internal Server Error 抛出错误', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('/pulls/42/comments') && !urlStr.includes('/issues/')) {
          return Promise.resolve(makeJsonResponse(500, { message: 'Internal Server Error' }));
        }
        return Promise.resolve(makeJsonResponse(404, {}));
      });

      const options = makeOptions({ mode: 'replace', findings: [] });
      await expect(publishReview(options)).rejects.toThrow(/500|Internal Server Error/i);
    });

    it('API 错误响应 body 非 JSON 时记录 warn 日志（含 [comment-publisher] 前缀）', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // 返回 500 状态码 + 非 JSON body（json() 抛错）
      vi.spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('/pulls/42/comments') && !urlStr.includes('/issues/')) {
          return Promise.resolve(
            new Response('not-json-body', {
              status: 500,
              statusText: 'Internal Server Error',
              headers: { 'Content-Type': 'text/plain' },
            }),
          );
        }
        return Promise.resolve(makeJsonResponse(404, {}));
      });

      const options = makeOptions({ mode: 'replace', findings: [] });
      await expect(publishReview(options)).rejects.toThrow(/500/i);
      expect(warnSpy).toHaveBeenCalled();
      const allCalls = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(allCalls.some((s) => s.includes('[comment-publisher]'))).toBe(true);
      warnSpy.mockRestore();
    });
  });

  // ==================== publishInlineComments ====================
  describe('publishInlineComments', () => {
    it('单个 finding — 创建一个行内评论', async () => {
      const findings = [
        makeFinding({ file: 'src/app.ts', line: 10, severity: 'high', category: 'bug', message: 'null pointer dereference' }),
      ];

      vi.spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        // GET review comments
        if (urlStr.includes('/pulls/42/comments') && init?.method !== 'POST' && init?.method !== 'DELETE') {
          return Promise.resolve(makeJsonResponse(200, []));
        }
        // GET issue comments
        if (urlStr.includes('/issues/42/comments') && init?.method !== 'POST' && init?.method !== 'PATCH') {
          return Promise.resolve(makeJsonResponse(200, []));
        }
        // POST review comment
        if (init?.method === 'POST' && urlStr.includes('/pulls/42/comments')) {
          const body = JSON.parse((init?.body as string) ?? '{}');
          expect(body.path).toBe('src/app.ts');
          expect(body.line).toBe(10);
          expect(body.body).toContain('null pointer dereference');
          expect(body.body).toContain('[high]');
          expect(body.body).toContain('bug');
          return Promise.resolve(makeJsonResponse(201, { id: 301 }));
        }
        // POST issue comment (summary)
        if (init?.method === 'POST' && urlStr.includes('/issues/42/comments')) {
          return Promise.resolve(makeJsonResponse(201, { id: 302 }));
        }
        return Promise.resolve(makeJsonResponse(404, {}));
      });

      const options = makeOptions({ mode: 'replace', findings });
      const result = await publishReview(options);

      expect(result.inlineCount).toBe(1);
      expect(result.summaryUpdated).toBe(true);
    });

    it('多个 findings — 批量创建行内评论', async () => {
      const findings = [
        makeFinding({ file: 'src/app.ts', line: 10, severity: 'critical', category: 'security', message: 'sql injection' }),
        makeFinding({ file: 'src/lib.ts', line: 20, severity: 'medium', category: 'style', message: 'naming convention' }),
        makeFinding({ file: 'src/app.ts', line: 30, severity: 'low', category: 'perf', message: 'inefficient loop' }),
      ];

      let postCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('/pulls/42/comments') && init?.method !== 'POST' && init?.method !== 'DELETE') {
          return Promise.resolve(makeJsonResponse(200, []));
        }
        if (urlStr.includes('/issues/42/comments') && init?.method !== 'POST' && init?.method !== 'PATCH') {
          return Promise.resolve(makeJsonResponse(200, []));
        }
        if (init?.method === 'POST' && urlStr.includes('/pulls/42/comments')) {
          postCount++;
          return Promise.resolve(makeJsonResponse(201, { id: 300 + postCount }));
        }
        if (init?.method === 'POST' && urlStr.includes('/issues/42/comments')) {
          return Promise.resolve(makeJsonResponse(201, { id: 399 }));
        }
        return Promise.resolve(makeJsonResponse(404, {}));
      });

      const options = makeOptions({ mode: 'replace', findings });
      const result = await publishReview(options);

      expect(result.inlineCount).toBe(3);
      expect(postCount).toBe(3);
    });

    it('跳过无行号的 finding — line=0 的 finding 不发布', async () => {
      const findings = [
        makeFinding({ file: 'src/app.ts', line: 10, severity: 'high', category: 'bug', message: 'valid finding' }),
        makeFinding({ file: 'src/app.ts', line: 0, severity: 'medium', category: 'style', message: 'no line finding' }),
      ];

      let postCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('/pulls/42/comments') && init?.method !== 'POST' && init?.method !== 'DELETE') {
          return Promise.resolve(makeJsonResponse(200, []));
        }
        if (urlStr.includes('/issues/42/comments') && init?.method !== 'POST' && init?.method !== 'PATCH') {
          return Promise.resolve(makeJsonResponse(200, []));
        }
        if (init?.method === 'POST' && urlStr.includes('/pulls/42/comments')) {
          postCount++;
          const body = JSON.parse((init?.body as string) ?? '{}');
          expect(body.line).not.toBe(0);
          return Promise.resolve(makeJsonResponse(201, { id: 400 + postCount }));
        }
        if (init?.method === 'POST' && urlStr.includes('/issues/42/comments')) {
          return Promise.resolve(makeJsonResponse(201, { id: 499 }));
        }
        return Promise.resolve(makeJsonResponse(404, {}));
      });

      const options = makeOptions({ mode: 'replace', findings });
      const result = await publishReview(options);

      expect(result.inlineCount).toBe(1);
      expect(result.skipped).toBe(1);
      expect(postCount).toBe(1);
    });
  });

  // ==================== publishSummaryComment ====================
  describe('publishSummaryComment', () => {
    it('新建 summary — POST 创建 issue comment', async () => {
      const findings = [
        makeFinding({ file: 'src/app.ts', line: 10, severity: 'high', category: 'security', message: 'sql injection' }),
      ];

      let summaryCreated = false;
      vi.spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('/pulls/42/comments') && init?.method !== 'POST' && init?.method !== 'DELETE') {
          return Promise.resolve(makeJsonResponse(200, []));
        }
        if (urlStr.includes('/issues/42/comments') && init?.method !== 'POST' && init?.method !== 'PATCH') {
          return Promise.resolve(makeJsonResponse(200, []));
        }
        if (init?.method === 'POST' && urlStr.includes('/pulls/42/comments')) {
          return Promise.resolve(makeJsonResponse(201, { id: 500 }));
        }
        if (init?.method === 'POST' && urlStr.includes('/issues/42/comments')) {
          summaryCreated = true;
          const bodyStr = (init?.body as string) ?? '';
          expect(bodyStr).toContain('Code Review Summary');
          expect(bodyStr).toContain('code-review:summary');
          expect(bodyStr).toContain('1 findings');
          expect(bodyStr).toContain('1 high');
          return Promise.resolve(makeJsonResponse(201, { id: 501 }));
        }
        return Promise.resolve(makeJsonResponse(404, {}));
      });

      const options = makeOptions({ mode: 'replace', findings });
      const result = await publishReview(options);

      expect(summaryCreated).toBe(true);
      expect(result.summaryUpdated).toBe(true);
    });

    it('更新已有 summary (sticky) — PATCH 更新已有评论', async () => {
      const findings = [
        makeFinding({ file: 'src/app.ts', line: 10, severity: 'critical', category: 'security', message: 'xss' }),
      ];

      const existingIssueComments = [
        { id: 600, body: '## Code Review Summary\n\n**0 findings** (0 critical, 0 high, 0 medium, 0 low)\n\n<!-- code-review:summary -->' },
      ];

      let patched = false;
      vi.spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        // GET review comments
        if (urlStr.includes('/pulls/42/comments') && init?.method !== 'POST' && init?.method !== 'DELETE') {
          return Promise.resolve(makeJsonResponse(200, []));
        }
        // GET issue comments
        if (urlStr.includes('/issues/42/comments') && init?.method === 'GET') {
          return Promise.resolve(makeJsonResponse(200, existingIssueComments));
        }
        // DELETE review comment (should not happen for empty review comments)
        if (init?.method === 'DELETE' && urlStr.includes('/pulls/42/comments')) {
          return Promise.resolve(makeEmptyResponse(200));
        }
        // DELETE issue comment (old summary found by marker) - replace mode deletes it
        if (init?.method === 'DELETE' && urlStr.includes('/issues/42/comments')) {
          return Promise.resolve(makeEmptyResponse(200));
        }
        // POST review comment
        if (init?.method === 'POST' && urlStr.includes('/pulls/42/comments')) {
          return Promise.resolve(makeJsonResponse(201, { id: 601 }));
        }
        // POST issue comment (new summary after deleting old)
        if (init?.method === 'POST' && urlStr.includes('/issues/42/comments')) {
          return Promise.resolve(makeJsonResponse(201, { id: 602 }));
        }
        // PATCH issue comment (sticky update)
        if (init?.method === 'PATCH' && urlStr.includes('/issues/42/comments')) {
          patched = true;
          const bodyStr = (init?.body as string) ?? '';
          expect(bodyStr).toContain('Code Review Summary');
          expect(bodyStr).toContain('1 findings');
          expect(bodyStr).toContain('1 critical');
          return Promise.resolve(makeJsonResponse(200, { id: 600, body: 'updated' }));
        }
        return Promise.resolve(makeJsonResponse(404, {}));
      });

      // Use incremental mode to test PATCH (incremental won't delete old summary)
      const options = makeOptions({ mode: 'incremental', findings });
      const result = await publishReview(options);

      expect(patched).toBe(true);
      expect(result.summaryUpdated).toBe(true);
    });

    it('replace 模式 — 删除旧 summary 评论再创建新的', async () => {
      const findings = [
        makeFinding({ file: 'src/app.ts', line: 10, severity: 'high', category: 'bug', message: 'off by one' }),
      ];

      const existingReviewComments = [
        { id: 700, path: 'src/app.ts', line: 10, body: 'old review comment' },
      ];

      const existingIssueComments = [
        { id: 701, body: '## Code Review Summary\n\n**1 findings**\n\n<!-- code-review:summary -->' },
      ];

      const deletedIds: number[] = [];
      let newSummaryCreated = false;

      vi.spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        // GET review comments
        if (urlStr.includes('/pulls/42/comments') && init?.method === 'GET') {
          return Promise.resolve(makeJsonResponse(200, existingReviewComments));
        }
        // GET issue comments
        if (urlStr.includes('/issues/42/comments') && init?.method === 'GET') {
          return Promise.resolve(makeJsonResponse(200, existingIssueComments));
        }
        // DELETE review comment
        if (init?.method === 'DELETE' && urlStr.includes('/pulls/42/comments/700')) {
          deletedIds.push(700);
          return Promise.resolve(makeEmptyResponse(200));
        }
        // DELETE issue comment (old summary)
        if (init?.method === 'DELETE' && urlStr.includes('/issues/42/comments/701')) {
          deletedIds.push(701);
          return Promise.resolve(makeEmptyResponse(200));
        }
        // POST review comment
        if (init?.method === 'POST' && urlStr.includes('/pulls/42/comments')) {
          return Promise.resolve(makeJsonResponse(201, { id: 702 }));
        }
        // POST issue comment (new summary)
        if (init?.method === 'POST' && urlStr.includes('/issues/42/comments')) {
          newSummaryCreated = true;
          return Promise.resolve(makeJsonResponse(201, { id: 703 }));
        }
        return Promise.resolve(makeJsonResponse(404, {}));
      });

      const options = makeOptions({ mode: 'replace', findings });
      const result = await publishReview(options);

      expect(deletedIds).toContain(700);
      expect(deletedIds).toContain(701);
      expect(newSummaryCreated).toBe(true);
      expect(result.inlineCount).toBe(1);
      expect(result.summaryUpdated).toBe(true);
    });
  });

  // ==================== publishReview（编排函数） ====================
  describe('publishReview（编排函数）', () => {
    it('replace 模式完整流程 — 获取旧评论 -> 删除 -> 发布新 inline + summary', async () => {
      const findings = [
        makeFinding({ file: 'src/a.ts', line: 1, severity: 'critical', category: 'security', message: 'remote code execution' }),
        makeFinding({ file: 'src/b.ts', line: 2, severity: 'high', category: 'bug', message: 'null pointer' }),
      ];

      const existingReviewComments = [
        { id: 800, path: 'src/old.ts', line: 5, body: 'old comment 1' },
        { id: 801, path: 'src/old.ts', line: 10, body: 'old comment 2' },
      ];

      const existingIssueComments = [
        { id: 802, body: 'unrelated' },
        { id: 803, body: '## Code Review Summary\n\n**2 findings**\n\n<!-- code-review:summary -->' },
      ];

      const deletedIds: number[] = [];
      const postedReviewComments: unknown[] = [];
      let newSummaryCreated = false;

      vi.spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();

        // GET review comments
        if (urlStr.includes('/pulls/42/comments') && init?.method === 'GET') {
          return Promise.resolve(makeJsonResponse(200, existingReviewComments));
        }
        // GET issue comments
        if (urlStr.includes('/issues/42/comments') && init?.method === 'GET') {
          return Promise.resolve(makeJsonResponse(200, existingIssueComments));
        }
        // DELETE old review comments
        if (init?.method === 'DELETE' && urlStr.match(/\/pulls\/42\/comments\/\d+/)) {
          const idMatch = urlStr.match(/\/(\d+)$/);
          if (idMatch) deletedIds.push(parseInt(idMatch[1]));
          return Promise.resolve(makeEmptyResponse(200));
        }
        // DELETE old summary issue comment
        if (init?.method === 'DELETE' && urlStr.match(/\/issues\/42\/comments\/\d+/)) {
          const idMatch = urlStr.match(/\/(\d+)$/);
          if (idMatch) deletedIds.push(parseInt(idMatch[1]));
          return Promise.resolve(makeEmptyResponse(200));
        }
        // POST new review comments
        if (init?.method === 'POST' && urlStr.includes('/pulls/42/comments')) {
          const body = JSON.parse((init?.body as string) ?? '{}');
          postedReviewComments.push(body);
          return Promise.resolve(makeJsonResponse(201, { id: 900 + postedReviewComments.length }));
        }
        // POST new summary
        if (init?.method === 'POST' && urlStr.includes('/issues/42/comments')) {
          newSummaryCreated = true;
          const bodyStr = (init?.body as string) ?? '';
          expect(bodyStr).toContain('2 findings');
          expect(bodyStr).toContain('1 critical');
          expect(bodyStr).toContain('1 high');
          return Promise.resolve(makeJsonResponse(201, { id: 999 }));
        }
        return Promise.resolve(makeJsonResponse(404, {}));
      });

      const options = makeOptions({ mode: 'replace', findings });
      const result = await publishReview(options);

      // 验证旧评论被删除
      expect(deletedIds).toContain(800);
      expect(deletedIds).toContain(801);
      expect(deletedIds).toContain(803); // old summary
      // 验证新评论发布
      expect(result.inlineCount).toBe(2);
      expect(postedReviewComments).toHaveLength(2);
      expect(newSummaryCreated).toBe(true);
      expect(result.summaryUpdated).toBe(true);
    });

    it('incremental 模式 — 获取旧评论 -> IoU 去重 -> 仅发布新 finding', async () => {
      const newFindings = [
        // 这个 finding 与已有评论相同（同文件同行），应被去重
        makeFinding({ file: 'src/app.ts', line: 10, severity: 'high', category: 'bug', message: 'null pointer dereference in function' }),
        // 这个 finding 是新的，应发布
        makeFinding({ file: 'src/new.ts', line: 5, severity: 'medium', category: 'style', message: 'naming convention violation' }),
      ];

      const existingReviewComments = [
        { id: 1000, path: 'src/app.ts', line: 10, body: '## [high] bug\n\nnull pointer dereference in function\n\nuse optional chaining' },
      ];

      const existingIssueComments = [
        { id: 1001, body: '## Code Review Summary\n\n**1 findings**\n\n<!-- code-review:summary -->' },
      ];

      const postedComments: unknown[] = [];

      vi.spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();

        // GET review comments
        if (urlStr.includes('/pulls/42/comments') && init?.method === 'GET') {
          return Promise.resolve(makeJsonResponse(200, existingReviewComments));
        }
        // GET issue comments
        if (urlStr.includes('/issues/42/comments') && init?.method === 'GET') {
          return Promise.resolve(makeJsonResponse(200, existingIssueComments));
        }
        // POST review comment
        if (init?.method === 'POST' && urlStr.includes('/pulls/42/comments')) {
          const body = JSON.parse((init?.body as string) ?? '{}');
          postedComments.push(body);
          return Promise.resolve(makeJsonResponse(201, { id: 1100 }));
        }
        // PATCH summary (incremental mode should update existing summary)
        if (init?.method === 'PATCH' && urlStr.includes('/issues/42/comments/1001')) {
          return Promise.resolve(makeJsonResponse(200, { id: 1001, body: 'updated' }));
        }
        // POST issue comment
        if (init?.method === 'POST' && urlStr.includes('/issues/42/comments')) {
          return Promise.resolve(makeJsonResponse(201, { id: 1101 }));
        }
        return Promise.resolve(makeJsonResponse(404, {}));
      });

      const options = makeOptions({ mode: 'incremental', findings: newFindings });
      const result = await publishReview(options);

      // 只应发布 1 个新 finding（src/new.ts 的），src/app.ts 的被去重
      expect(result.inlineCount).toBe(1);
      expect(result.skipped).toBe(1);
      expect(postedComments).toHaveLength(1);
      expect((postedComments[0] as { path: string }).path).toBe('src/new.ts');
    });

    it('空 findings — 不发布任何评论', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('/pulls/42/comments') && init?.method === 'GET') {
          return Promise.resolve(makeJsonResponse(200, []));
        }
        if (urlStr.includes('/issues/42/comments') && init?.method === 'GET') {
          return Promise.resolve(makeJsonResponse(200, []));
        }
        return Promise.resolve(makeJsonResponse(404, {}));
      });

      const options = makeOptions({ mode: 'replace', findings: [] });
      const result = await publishReview(options);

      expect(result.inlineCount).toBe(0);
      expect(result.summaryUpdated).toBe(false);
      expect(result.skipped).toBe(0);
    });

    it('混合 severities — 正确统计 critical/high/medium/low 数量', async () => {
      const findings = [
        makeFinding({ file: 'src/a.ts', line: 1, severity: 'critical', category: 'security', message: 'rce' }),
        makeFinding({ file: 'src/b.ts', line: 2, severity: 'high', category: 'bug', message: 'null' }),
        makeFinding({ file: 'src/c.ts', line: 3, severity: 'high', category: 'security', message: 'xss' }),
        makeFinding({ file: 'src/d.ts', line: 4, severity: 'medium', category: 'style', message: 'naming' }),
        makeFinding({ file: 'src/e.ts', line: 5, severity: 'medium', category: 'perf', message: 'slow' }),
        makeFinding({ file: 'src/f.ts', line: 6, severity: 'medium', category: 'style', message: 'format' }),
        makeFinding({ file: 'src/g.ts', line: 7, severity: 'low', category: 'doc', message: 'typo' }),
      ];

      let summaryBody = '';
      vi.spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('/pulls/42/comments') && init?.method === 'GET') {
          return Promise.resolve(makeJsonResponse(200, []));
        }
        if (urlStr.includes('/issues/42/comments') && init?.method === 'GET') {
          return Promise.resolve(makeJsonResponse(200, []));
        }
        if (init?.method === 'POST' && urlStr.includes('/pulls/42/comments')) {
          return Promise.resolve(makeJsonResponse(201, { id: 1200 }));
        }
        if (init?.method === 'POST' && urlStr.includes('/issues/42/comments')) {
          const body = (init?.body as string) ?? '';
          summaryBody = body;
          return Promise.resolve(makeJsonResponse(201, { id: 1201 }));
        }
        return Promise.resolve(makeJsonResponse(404, {}));
      });

      const options = makeOptions({ mode: 'replace', findings });
      const result = await publishReview(options);

      expect(result.inlineCount).toBe(7);
      expect(summaryBody).toContain('7 findings');
      expect(summaryBody).toContain('1 critical');
      expect(summaryBody).toContain('2 high');
      expect(summaryBody).toContain('3 medium');
      expect(summaryBody).toContain('1 low');
    });
  });
});
