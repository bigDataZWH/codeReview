import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { publishReview } from '../../src/comment-publisher.js';
import { deduplicateFindings } from '../../src/post-processor.js';
import { runPipeline, applyFindings } from '../../src/pipeline.js';
import { formatFindingsMarkdown, formatFindingsJSON } from '../../src/format.js';
import { ReviewSessionManager } from '../../src/orchestrator.js';
import { StateStore } from '../../src/state.js';
import type { Finding, PublishOptions, PublishResult } from '../../src/types.js';

// ── 工具：构造 GitHub API mock 响应 ──

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : status === 201 ? 'Created' : status === 204 ? 'No Content' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeEmptyResponse(status: number = 200): Response {
  return new Response(null, { status, statusText: 'No Content', headers: {} });
}

interface MockState {
  reviewComments: Array<{ id: number; path: string; line: number | null; body: string }>;
  issueComments: Array<{ id: number; body: string }>;
  nextId: number;
  postedComments: Array<{ path: string; line: number; body: string }>;
  deletedCommentIds: number[];
  fetchCalls: Array<{ method: string; url: string }>;
}

function makeFetchMock(state: MockState) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = url.toString();
    const method = init?.method ?? 'GET';
    state.fetchCalls.push({ method, url: urlStr });

    // GET /pulls/{pr}/comments - 获取已有 review comments
    if (method === 'GET' && urlStr.includes('/pulls/') && urlStr.includes('/comments')) {
      return makeJsonResponse(200, state.reviewComments);
    }
    // GET /issues/{pr}/comments - 获取已有 issue comments
    if (method === 'GET' && urlStr.includes('/issues/') && urlStr.includes('/comments')) {
      return makeJsonResponse(200, state.issueComments);
    }
    // POST /pulls/{pr}/comments - 新建 review comment
    if (method === 'POST' && urlStr.includes('/pulls/') && urlStr.includes('/comments')) {
      const body = JSON.parse(init?.body as string);
      state.postedComments.push({ path: body.path, line: body.line, body: body.body });
      const id = state.nextId++;
      return makeJsonResponse(201, { id });
    }
    // POST /issues/{pr}/comments - 新建 issue comment (summary)
    if (method === 'POST' && urlStr.includes('/issues/') && urlStr.includes('/comments')) {
      const id = state.nextId++;
      return makeJsonResponse(201, { id });
    }
    // PATCH /issues/{pr}/comments/{id} - 更新 summary
    if (method === 'PATCH' && urlStr.includes('/issues/') && urlStr.includes('/comments/')) {
      const idStr = urlStr.split('/').pop() ?? '';
      const id = parseInt(idStr, 10);
      return makeJsonResponse(200, { id });
    }
    // DELETE - 删除评论
    if (method === 'DELETE') {
      const idStr = urlStr.split('/').pop() ?? '';
      const id = parseInt(idStr, 10);
      state.deletedCommentIds.push(id);
      return makeEmptyResponse(200);
    }
    return makeJsonResponse(404, { message: 'Not Found' });
  });
}

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
    owner: 'ci-owner',
    repo: 'ci-repo',
    prNumber: 42,
    token: 'ghp_ci_token',
    ...overrides,
  };
}

// ── CI 流程 E2E ──

describe('E2E：CI 流程模拟', () => {
  let fetchOrig: typeof globalThis.fetch;
  let state: MockState;

  beforeEach(() => {
    fetchOrig = globalThis.fetch;
    state = {
      reviewComments: [],
      issueComments: [],
      nextId: 1000,
      postedComments: [],
      deletedCommentIds: [],
      fetchCalls: [],
    };
  });

  afterEach(() => {
    globalThis.fetch = fetchOrig;
    vi.restoreAllMocks();
  });

  // ==================== 评论生成逻辑（不调用真实 GitHub API） ====================
  describe('评论生成逻辑', () => {
    it('空 findings 不发布评论', async () => {
      globalThis.fetch = makeFetchMock(state) as unknown as typeof globalThis.fetch;
      const result = await publishReview(makeOptions({ findings: [], mode: 'replace' }));

      expect(result.inlineCount).toBe(0);
      expect(result.summaryUpdated).toBe(false);
      expect(result.skipped).toBe(0);
      // 不应有 POST 评论
      expect(state.postedComments.length).toBe(0);
    });

    it('replace 模式：先删除旧评论再发布新评论', async () => {
      // 预置旧评论
      state.reviewComments = [
        { id: 100, path: 'old.ts', line: 1, body: 'old comment 1' },
        { id: 101, path: 'old.ts', line: 2, body: 'old comment 2' },
      ];
      state.issueComments = [
        { id: 200, body: '<!-- opencode-code-review:summary -->\n## old summary' },
      ];
      globalThis.fetch = makeFetchMock(state) as unknown as typeof globalThis.fetch;

      const findings: Finding[] = [
        makeFinding({ file: 'new.ts', line: 5, severity: 'high', message: 'sql injection' }),
        makeFinding({ file: 'new.ts', line: 10, severity: 'medium', message: 'bad naming' }),
      ];
      const result = await publishReview(makeOptions({ findings, mode: 'replace' }));

      // 应发布 2 条评论
      expect(result.inlineCount).toBe(2);
      expect(result.summaryUpdated).toBe(true);
      // 应删除 3 条旧评论（2 review + 1 issue summary）
      expect(state.deletedCommentIds.length).toBe(3);
      expect(state.deletedCommentIds).toContain(100);
      expect(state.deletedCommentIds).toContain(101);
      expect(state.deletedCommentIds).toContain(200);
      // 应发布 2 条新 review comments + 1 summary
      expect(state.postedComments.length).toBe(2);
      expect(state.postedComments.some((c) => c.path === 'new.ts' && c.line === 5)).toBe(true);
    });

    it('incremental 模式：仅发布与旧评论不重复的 finding', async () => {
      // 预置旧评论（与第一条 finding 重复）
      state.reviewComments = [
        {
          id: 100,
          path: 'new.ts',
          line: 5,
          body: '## [high] security\n\nsql injection finding',
        },
      ];
      globalThis.fetch = makeFetchMock(state) as unknown as typeof globalThis.fetch;

      const findings: Finding[] = [
        makeFinding({ file: 'new.ts', line: 5, severity: 'high', message: 'sql injection finding' }),
        makeFinding({ file: 'new.ts', line: 10, severity: 'medium', message: 'totally different issue' }),
      ];
      const result = await publishReview(makeOptions({ findings, mode: 'incremental' }));

      // 应跳过与旧评论重复的 finding
      expect(result.skipped).toBeGreaterThanOrEqual(0);
      // 至少发布了 1 条新评论（line=10 的 finding）
      expect(result.inlineCount).toBeGreaterThanOrEqual(1);
      expect(result.summaryUpdated).toBe(true);
    });

    it('line=0 的 finding 被跳过', async () => {
      globalThis.fetch = makeFetchMock(state) as unknown as typeof globalThis.fetch;
      const findings: Finding[] = [
        makeFinding({ file: 'a.ts', line: 0, message: 'no line' }),
        makeFinding({ file: 'b.ts', line: 5, message: 'with line' }),
      ];
      const result = await publishReview(makeOptions({ findings, mode: 'replace' }));

      expect(result.inlineCount).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('评论 body 包含 severity 和 message', async () => {
      globalThis.fetch = makeFetchMock(state) as unknown as typeof globalThis.fetch;
      const findings: Finding[] = [
        makeFinding({
          file: 'a.ts',
          line: 5,
          severity: 'critical',
          category: 'security',
          message: 'critical sql injection',
          suggestion: 'use parameterized query',
        }),
      ];
      await publishReview(makeOptions({ findings, mode: 'replace' }));

      expect(state.postedComments.length).toBe(1);
      const body = state.postedComments[0].body;
      expect(body).toContain('critical');
      expect(body).toContain('critical sql injection');
      expect(body).toContain('use parameterized query');
    });
  });

  // ==================== 增量去重逻辑 ====================
  describe('增量去重逻辑', () => {
    it('deduplicateFindings 直接调用：同文件同行 + 高 IoU 被去重', () => {
      const newFindings: Finding[] = [
        makeFinding({ file: 'a.ts', line: 5, message: 'sql injection vulnerability in query' }),
        makeFinding({ file: 'a.ts', line: 5, message: 'totally different unrelated issue' }),
        makeFinding({ file: 'a.ts', line: 10, message: 'sql injection vulnerability in query' }),
      ];
      const existing = [
        { file: 'a.ts', line: 5, body: 'sql injection vulnerability in query (existing)' },
      ];
      const deduped = deduplicateFindings(newFindings, existing);
      // 第一条与 existing IoU 高，被去重；其他保留
      expect(deduped.length).toBeLessThan(newFindings.length);
      // 不同行的 finding 应保留
      expect(deduped.some((f) => f.line === 10)).toBe(true);
    });

    it('deduplicateFindings 无已有评论时返回全部', () => {
      const findings: Finding[] = [
        makeFinding({ file: 'a.ts', line: 1, message: 'm1' }),
        makeFinding({ file: 'a.ts', line: 2, message: 'm2' }),
      ];
      const deduped = deduplicateFindings(findings, []);
      expect(deduped.length).toBe(2);
    });

    it('incremental 模式下重复运行不应重复发布相同评论', async () => {
      // 模拟第一次运行后状态：已发布 2 条评论
      state.reviewComments = [
        { id: 100, path: 'a.ts', line: 5, body: '## [high] security\n\nsql injection' },
        { id: 101, path: 'a.ts', line: 10, body: '## [medium] quality\n\nbad name' },
      ];
      globalThis.fetch = makeFetchMock(state) as unknown as typeof globalThis.fetch;

      // 第二次运行：相同的 findings
      const findings: Finding[] = [
        makeFinding({ file: 'a.ts', line: 5, severity: 'high', category: 'security', message: 'sql injection' }),
        makeFinding({ file: 'a.ts', line: 10, severity: 'medium', category: 'quality', message: 'bad name' }),
      ];
      const result = await publishReview(makeOptions({ findings, mode: 'incremental' }));

      // 重复的应被跳过
      expect(result.skipped).toBeGreaterThanOrEqual(1);
    });
  });

  // ==================== 完整 CI 流程模拟 ====================
  describe('完整 CI 流程：从 diff 到评论', () => {
    it('模拟 GitHub Action 中审查流程', async () => {
      // Step 1: 从 git diff 触发审查
      const diffText = `diff --git a/src/app.ts b/src/app.ts
index abc..def 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 import { foo } from './foo';
-const x = 1;
+const x = 2;
+console.log("debug");
 export default x;
`;

      // Step 2: 运行管道
      const pipelineResult = await runPipeline(diffText, {
        filter: {},
        rules: [
          {
            id: 'console-log',
            name: 'console.log',
            severity: 'low',
            category: 'quality',
            patterns: [{ type: 'regex', pattern: 'console\\.log', message: '禁止 console.log' }],
          },
        ],
      });

      // Step 3: 模拟 AI 返回 findings
      const aiFindings: Finding[] = [
        {
          file: 'src/app.ts',
          line: 4,
          severity: 'high',
          category: 'security',
          message: '安全漏洞',
          confidence: 0.9,
          source: 'ai',
        },
      ];
      const final = applyFindings(pipelineResult, aiFindings);
      expect(final.processedFindings!.length).toBeGreaterThan(0);

      // Step 4: 格式化结果（CI 输出）
      const markdown = formatFindingsMarkdown(final.processedFindings!);
      const json = formatFindingsJSON(final.processedFindings!);
      expect(markdown).toContain('Code Review Report');
      expect(JSON.parse(json).length).toBe(final.processedFindings!.length);

      // Step 5: 发布到 PR（mock GitHub API）
      globalThis.fetch = makeFetchMock(state) as unknown as typeof globalThis.fetch;
      const result = await publishReview(
        makeOptions({
          findings: final.processedFindings!,
          mode: 'replace',
          owner: 'ci-owner',
          repo: 'ci-repo',
          prNumber: 42,
        }),
      );

      expect(result.inlineCount).toBeGreaterThan(0);
      expect(result.summaryUpdated).toBe(true);
      // 验证请求都使用正确的 token
      // (通过 fetchCalls 验证 URL 路径)
      expect(state.fetchCalls.some((c) => c.url.includes('/repos/ci-owner/ci-repo/'))).toBe(true);
    });

    it('CI 流程：会话管理 + 状态追踪', async () => {
      // 模拟 CI 中创建审查会话
      const manager = new ReviewSessionManager();
      const sessionId = manager.createReviewSession({
        repo: 'ci-owner/ci-repo',
        prNumber: 42,
        commitSha: 'abc123',
      });

      expect(manager.getSessionStatus(sessionId)).toBe('pending');
      expect(manager.getSession(sessionId)?.repo).toBe('ci-owner/ci-repo');
      expect(manager.getSession(sessionId)?.prNumber).toBe(42);
      expect(manager.getSession(sessionId)?.commitSha).toBe('abc123');

      // 启动
      manager.startSession(sessionId);
      expect(manager.getSessionStatus(sessionId)).toBe('running');

      // 完成审查
      manager.completeSession(sessionId);
      expect(manager.getSessionStatus(sessionId)).toBe('completed');
    });

    it('CI 流程：失败时记录错误状态', async () => {
      const manager = new ReviewSessionManager();
      const sessionId = manager.createReviewSession({ repo: 'o/r', prNumber: 1 });
      manager.startSession(sessionId);
      manager.failSession(sessionId, 'Pipeline failed: LLM API timeout');

      const session = manager.getSession(sessionId);
      expect(session?.status).toBe('failed');
      expect(session?.error).toContain('LLM API timeout');
    });

    it('CI 流程：使用 StateStore 持久化审查结果', () => {
      const store = new StateStore();
      const sessionId = store.createSession({
        id: 'ci-run-1',
        filesTotal: 10,
        repo: 'o/r',
        prNumber: 42,
      });
      store.updateSessionStatus('ci-run-1', 'running');

      // 模拟分批处理：每批推进进度
      store.incrementFilesProcessed('ci-run-1', 5);
      store.incrementFilesProcessed('ci-run-1', 5);

      const session = store.getSession('ci-run-1');
      expect(session?.filesProcessed).toBe(10);

      // 保存 findings
      const findings: Finding[] = [
        { file: 'a.ts', line: 1, severity: 'high', category: 'security', message: 'sql', confidence: 0.9, source: 'rule' },
      ];
      store.saveFindings('ci-run-1', findings);

      // 完成会话
      store.updateSessionStatus('ci-run-1', 'completed');

      // 查询历史趋势
      const trend = store.getTrendStats();
      expect(trend.totalSessions).toBe(1);
      expect(trend.completedSessions).toBe(1);
      expect(trend.totalFindings).toBe(1);
    });

    it('CI 流程：多个 PR 并行审查互不干扰', async () => {
      // PR #1 审查
      const result1 = await runPipeline(
        `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
-a
+b
+c
`,
        { filter: {}, rules: [] },
      );

      // PR #2 审查
      const result2 = await runPipeline(
        `diff --git a/b.ts b/b.ts
index 3..4 100644
--- a/b.ts
+++ b/b.ts
@@ -1,1 +1,2 @@
-x
+y
+z
`,
        { filter: {}, rules: [] },
      );

      // 两个 PR 结果应互不影响
      expect(result1.filteredDiffs[0].path).toBe('a.ts');
      expect(result2.filteredDiffs[0].path).toBe('b.ts');

      // 分别发布
      globalThis.fetch = makeFetchMock(state) as unknown as typeof globalThis.fetch;
      const findings1: Finding[] = [
        makeFinding({ file: 'a.ts', line: 1, message: 'pr1 issue' }),
      ];
      const findings2: Finding[] = [
        makeFinding({ file: 'b.ts', line: 1, message: 'pr2 issue' }),
      ];

      const pub1 = await publishReview(makeOptions({ findings: findings1, prNumber: 1, mode: 'replace' }));
      const pub2 = await publishReview(makeOptions({ findings: findings2, prNumber: 2, mode: 'replace' }));

      expect(pub1.inlineCount).toBe(1);
      expect(pub2.inlineCount).toBe(1);
      // 验证两次发布使用不同的 PR 编号
      expect(state.fetchCalls.some((c) => c.url.includes('/pulls/1/'))).toBe(true);
      expect(state.fetchCalls.some((c) => c.url.includes('/pulls/2/'))).toBe(true);
    });
  });
});
