import { describe, it, expect, afterAll } from 'vitest';
import { publishReview } from '../../src/comment-publisher.js';
import type { Finding } from '../../src/types.js';

// ── 环境变量检测 ──
// 需要全部 4 个变量才会运行真实 GitHub API 端到端测试；否则 skip。
const hasTestEnv =
  !!process.env.GITHUB_TEST_TOKEN &&
  !!process.env.TEST_PR_NUMBER &&
  !!process.env.TEST_REPO_OWNER &&
  !!process.env.TEST_REPO_NAME;

const TEST_TOKEN = process.env.GITHUB_TEST_TOKEN ?? '';
const TEST_PR_NUMBER = process.env.TEST_PR_NUMBER ? parseInt(process.env.TEST_PR_NUMBER, 10) : 0;
const TEST_OWNER = process.env.TEST_REPO_OWNER ?? '';
const TEST_REPO = process.env.TEST_REPO_NAME ?? '';

// 测试用的 marker，便于后续清理：用 runId 区分多次运行，避免误删他人评论
const RUN_ID = process.env.GITHUB_TEST_RUN_ID ?? `${Date.now()}-${process.pid}`;
const TEST_MARKER = `<!-- code-review-e2e-${RUN_ID} -->`;

// ── GitHub API 辅助（仅用于验证 + 清理，不通过 publishReview） ──

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${TEST_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'code-review-e2e-test',
  };
}

interface GitHubReviewComment {
  id: number;
  body: string;
  path: string;
  line: number | null;
}

async function listReviewComments(): Promise<GitHubReviewComment[]> {
  const url = `https://api.github.com/repos/${TEST_OWNER}/${TEST_REPO}/pulls/${TEST_PR_NUMBER}/comments`;
  const res = await fetch(url, { method: 'GET', headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`GitHub API GET review comments failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as GitHubReviewComment[];
}

async function deleteReviewComment(commentId: number): Promise<void> {
  const url = `https://api.github.com/repos/${TEST_OWNER}/${TEST_REPO}/pulls/${TEST_PR_NUMBER}/comments/${commentId}`;
  const res = await fetch(url, { method: 'DELETE', headers: authHeaders() });
  // 204 No Content 是正常成功
  if (!res.ok && res.status !== 204) {
    throw new Error(`GitHub API DELETE comment ${commentId} failed: ${res.status} ${res.statusText}`);
  }
}

// ── 真实 GitHub API 端到端测试（仅当环境变量齐全时运行） ──

describe.skipIf(!hasTestEnv)('GitHub API end-to-end publish', () => {
  afterAll(async () => {
    // 清理：删除本次测试运行创建的所有评论（按 marker 识别，避免污染真实 PR）
    try {
      const comments = await listReviewComments();
      const testComments = comments.filter((c) => c.body?.includes(TEST_MARKER));
      for (const comment of testComments) {
        try {
          await deleteReviewComment(comment.id);
        } catch (err) {
          console.warn(`Failed to cleanup comment ${comment.id}:`, err);
        }
      }
    } catch (err) {
      console.warn('Cleanup failed:', err);
    }
  });

  it('publishes inline comments and summary to a real PR via publishReview', async () => {
    // 注意：GitHub PR review comment 要求 path 必须在 PR diff 中存在。
    // 这里使用 README.md 作为默认路径；测试 PR 必须修改了该文件。
    const findings: Finding[] = [
      {
        file: 'README.md',
        line: 1,
        severity: 'low',
        category: 'test',
        message: `${TEST_MARKER}\n## E2E Test Inline Comment\n\nThis is a test comment from code-review e2e tests.\nTimestamp: ${new Date().toISOString()}`,
        confidence: 0.5,
        source: 'ai',
      },
    ];

    const result = await publishReview({
      findings,
      owner: TEST_OWNER,
      repo: TEST_REPO,
      prNumber: TEST_PR_NUMBER,
      token: TEST_TOKEN,
      mode: 'incremental',
    });

    // PublishResult 真实字段：inlineCount / summaryUpdated / skipped
    // 注意：源码 PublishResult 没有 success / publishedCount / commentIds 字段，
    // 因此用 inlineCount 验证发布是否成功。
    expect(result.inlineCount).toBeGreaterThan(0);
    expect(result.summaryUpdated).toBe(true);
  });

  it('verifies comments are visible via GitHub API', async () => {
    const comments = await listReviewComments();
    // 验证我们带 marker 的测试评论确实存在
    const testComments = comments.filter((c) => c.body?.includes(TEST_MARKER));
    expect(testComments.length).toBeGreaterThan(0);
  });
});

// ── 未设置环境变量时显示占位 skip，提示如何启用 ──

describe.skipIf(hasTestEnv)('GitHub API end-to-end publish (SKIPPED: env vars not set)', () => {
  it.skip('should run e2e tests when GITHUB_TEST_TOKEN, TEST_PR_NUMBER, TEST_REPO_OWNER, TEST_REPO_NAME are set', () => {
    // 占位：环境变量齐全后 describe.skipIf(!hasTestEnv) 会自动启用上面的真实测试。
  });
});
