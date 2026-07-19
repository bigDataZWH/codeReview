import type { Finding, ExistingComment, PublishOptions, PublishResult } from './types.js';
import { deduplicateFindings } from './post-processor.js';

// ==================== 常量 ====================

/** Summary 评论标记，用于识别 sticky summary 评论 */
const SUMMARY_MARKER = '<!-- opencode-code-review:summary -->';

/** GitHub API 基础 URL */
const GITHUB_API_BASE = 'https://api.github.com';

// ==================== 内部辅助类型 ====================

/** GitHub API 返回的 review comment 结构 */
interface GitHubReviewComment {
  id: number;
  path: string;
  line: number | null;
  body: string;
}

/** GitHub API 返回的 issue comment 结构 */
interface GitHubIssueComment {
  id: number;
  body: string;
}

/** 创建评论的 API 响应 */
interface GitHubCommentResponse {
  id: number;
}

// ==================== GitHub API 请求辅助 ====================

/** 构建通用请求头 */
function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'opencode-code-review',
    'Content-Type': 'application/json',
  };
}

/** 发起 GitHub API 请求并处理错误 */
async function githubFetch(
  url: string,
  options: RequestInit,
): Promise<Response> {
  const response = await fetch(url, options);
  // DELETE 请求返回 204 No Content 是正常的
  if (!response.ok && response.status !== 204) {
    let errorMessage = `GitHub API error: ${response.status} ${response.statusText}`;
    try {
      const body = await response.json() as { message?: string };
      if (body.message) {
        errorMessage = `${response.status} ${body.message}`;
      }
    } catch {
      // ignore JSON parse error
    }
    throw new Error(errorMessage);
  }
  return response;
}

// ==================== fetchExistingComments ====================

/**
 * 获取已有的 PR review comments 和 issue comments。
 * 返回合并后的 ExistingComment 列表。
 */
async function fetchExistingComments(options: PublishOptions): Promise<{
  reviewComments: ExistingComment[];
  reviewCommentIds: number[];
  summaryCommentId: number | undefined;
  summaryIssueCommentId: number | undefined;
}> {
  const { owner, repo, prNumber, token } = options;
  const headers = buildHeaders(token);

  // 获取 review comments
  const reviewUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}/comments`;
  const reviewRes = await githubFetch(reviewUrl, { method: 'GET', headers });
  const reviewData = (await reviewRes.json()) as GitHubReviewComment[];

  const reviewComments: ExistingComment[] = reviewData.map((c) => ({
    file: c.path,
    line: c.line ?? 0,
    body: c.body,
  }));

  const reviewCommentIds = reviewData.map((c) => c.id);

  // 获取 issue comments（用于找 summary）
  const issueUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${prNumber}/comments`;
  const issueRes = await githubFetch(issueUrl, { method: 'GET', headers });
  const issueData = (await issueRes.json()) as GitHubIssueComment[];

  // 查找已有 summary 评论
  let summaryIssueCommentId: number | undefined;
  let summaryCommentId: number | undefined;

  for (const comment of issueData) {
    if (comment.body.includes(SUMMARY_MARKER)) {
      summaryIssueCommentId = comment.id;
      summaryCommentId = options.summaryCommentId ?? comment.id;
      break;
    }
  }

  return {
    reviewComments,
    reviewCommentIds,
    summaryCommentId,
    summaryIssueCommentId,
  };
}

// ==================== 删除评论 ====================

/**
 * 删除单个 review comment。
 */
async function deleteReviewComment(
  owner: string,
  repo: string,
  prNumber: number,
  commentId: number,
  token: string,
): Promise<void> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}/comments/${commentId}`;
  await githubFetch(url, { method: 'DELETE', headers: buildHeaders(token) });
}

/**
 * 删除单个 issue comment。
 */
async function deleteIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
  commentId: number,
  token: string,
): Promise<void> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}/comments/${commentId}`;
  await githubFetch(url, { method: 'DELETE', headers: buildHeaders(token) });
}

// ==================== publishInlineComments ====================

/**
 * 格式化行内评论 body。
 */
function formatInlineCommentBody(finding: Finding): string {
  let body = `## [${finding.severity}] ${finding.category}\n\n${finding.message}`;
  if (finding.suggestion) {
    body += `\n\n${finding.suggestion}`;
  }
  return body;
}

/**
 * 发布行内评论（review comments）。
 * 跳过 line=0 的 finding。
 * 返回成功发布的评论数。
 */
async function publishInlineComments(
  options: PublishOptions,
  findings: Finding[],
): Promise<{ count: number; skipped: number }> {
  const { owner, repo, prNumber, token } = options;
  const headers = buildHeaders(token);
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}/comments`;

  let count = 0;
  let skipped = 0;

  for (const finding of findings) {
    // 跳过无行号的 finding
    if (finding.line <= 0) {
      skipped++;
      continue;
    }

    const body = formatInlineCommentBody(finding);
    await githubFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        body,
        path: finding.file,
        line: finding.line,
      }),
    });
    count++;
  }

  return { count, skipped };
}

// ==================== publishSummaryComment ====================

/**
 * 格式化 summary 评论 body。
 */
function formatSummaryBody(findings: Finding[]): string {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    if (f.severity in counts) {
      counts[f.severity as keyof typeof counts]++;
    }
  }
  const total = findings.length;

  let body = `## Code Review Summary\n\n`;
  body += `**${total} findings** (${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low)\n\n`;
  body += SUMMARY_MARKER;

  return body;
}

/**
 * 发布或更新 summary 评论。
 * - 如果有 summaryId，使用 PATCH 更新已有评论（sticky 模式）
 * - 如果没有 summaryId，使用 POST 创建新评论
 */
async function publishSummaryComment(
  options: PublishOptions,
  findings: Finding[],
  summaryId?: number,
): Promise<{ id: number; updated: boolean }> {
  const { owner, repo, prNumber, token } = options;
  const headers = buildHeaders(token);
  const body = formatSummaryBody(findings);

  if (summaryId) {
    // PATCH 更新已有 summary（sticky 模式）
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${prNumber}/comments/${summaryId}`;
    const res = await githubFetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ body }),
    });
    const data = (await res.json()) as GitHubCommentResponse;
    return { id: data.id, updated: true };
  } else {
    // POST 创建新 summary
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${prNumber}/comments`;
    const res = await githubFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body }),
    });
    const data = (await res.json()) as GitHubCommentResponse;
    return { id: data.id, updated: true };
  }
}

// ==================== 主导出函数：publishReview ====================

/**
 * 将审查发现发布为 PR 评论。
 *
 * 支持两种模式：
 * - `replace`: 删除所有旧评论，重新发布所有 findings
 * - `incremental`: 获取旧评论，IoU 去重，仅发布新 findings
 */
export async function publishReview(options: PublishOptions): Promise<PublishResult> {
  const { findings, mode = 'replace' } = options;

  // 空 findings，不发布任何评论
  if (findings.length === 0) {
    // 但仍需获取已有评论用于 replace 模式的清理
    if (mode === 'replace') {
      const existing = await fetchExistingComments(options);
      // 删除旧评论
      for (const id of existing.reviewCommentIds) {
        await deleteReviewComment(options.owner, options.repo, options.prNumber, id, options.token);
      }
      if (existing.summaryIssueCommentId) {
        await deleteIssueComment(options.owner, options.repo, options.prNumber, existing.summaryIssueCommentId, options.token);
      }
    }
    return { inlineCount: 0, summaryUpdated: false, skipped: 0 };
  }

  if (mode === 'replace') {
    return publishReviewReplace(options);
  } else {
    return publishReviewIncremental(options);
  }
}

/**
 * Replace 模式：删除所有旧评论 -> 发布所有 findings。
 */
async function publishReviewReplace(options: PublishOptions): Promise<PublishResult> {
  const existing = await fetchExistingComments(options);

  // 删除旧 review comments
  for (const id of existing.reviewCommentIds) {
    await deleteReviewComment(options.owner, options.repo, options.prNumber, id, options.token);
  }

  // 删除旧 summary issue comment
  if (existing.summaryIssueCommentId) {
    await deleteIssueComment(options.owner, options.repo, options.prNumber, existing.summaryIssueCommentId, options.token);
  }

  // 发布新的行内评论
  const { count: inlineCount, skipped } = await publishInlineComments(options, options.findings);

  // 发布新的 summary（已有 summary 被删除，所以总是新建）
  const summaryResult = await publishSummaryComment(options, options.findings);

  return {
    inlineCount,
    summaryUpdated: summaryResult.updated,
    skipped,
  };
}

/**
 * Incremental 模式：获取旧评论 -> IoU 去重 -> 仅发布新 findings。
 */
async function publishReviewIncremental(options: PublishOptions): Promise<PublishResult> {
  const existing = await fetchExistingComments(options);

  // 使用 deduplicateFindings 过滤掉与已有评论重复的 findings
  const totalBefore = options.findings.length;
  const newFindings = deduplicateFindings(options.findings, existing.reviewComments);
  const skipped = totalBefore - newFindings.length;

  // 发布新行内评论
  const { count: inlineCount } = await publishInlineComments(options, newFindings);

  // 更新或创建 summary
  let summaryUpdated = false;
  if (newFindings.length > 0 || existing.summaryCommentId) {
    const summaryResult = await publishSummaryComment(
      options,
      newFindings.length > 0 ? newFindings : options.findings,
      existing.summaryIssueCommentId,
    );
    summaryUpdated = summaryResult.updated;
  }

  return {
    inlineCount,
    summaryUpdated,
    skipped,
  };
}
