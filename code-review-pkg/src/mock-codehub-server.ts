// src/mock-codehub-server.ts — Task 1 + Task 2：Mock CodeHub Server
//
// 职责：
// 1. 提供 CodeHub API v3 兼容端点的 Mock 服务（用于测试与本地开发）
// 2. 基于 Node.js 内置 http 模块，不引入 express
// 3. 内存状态管理：mrs / comments / issues / branches
// 4. 支持从 fixtures 目录加载初始数据，目录不存在时使用内置默认数据
// 5. PRIVATE-TOKEN 鉴权（空 header 返回 401，非空接受任意值）
//
// 用途：
// - 单元测试/集成测试中替代真实 CodeHub 实例
// - 本地开发调试 CodeHubClient 调用

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  CodeHubMR,
  CodeHubMRDiff,
  CodeHubComment,
  CodeHubIssue,
  CodeHubBranch,
  CodeHubProject,
  CodeHubUser,
} from './types.js';

// ==================== 对外类型 ====================

export interface MockCodeHubServerOptions {
  /** 监听端口（默认 9099） */
  port?: number;
  /** 监听主机（默认 127.0.0.1） */
  hostname?: string;
  /** fixtures 目录（默认 mock-codehub-fixtures，相对于 process.cwd()） */
  fixturesDir?: string;
}

export interface MockCodeHubServerHandle {
  /** 是否成功启动 */
  ok: boolean;
  /** 实际监听端口 */
  port: number;
  /** 实际监听主机 */
  hostname: string;
  /** 基础 URL，例如 http://127.0.0.1:9099 */
  baseUrl: string;
  /** 关闭服务器 */
  close(): Promise<void>;
}

// ==================== 内部类型 ====================

interface MockState {
  project: CodeHubProject;
  mrs: Map<number, CodeHubMR>;
  comments: Map<number, CodeHubComment[]>;
  diffs: Map<number, CodeHubMRDiff>;
  issues: CodeHubIssue[];
  branches: CodeHubBranch[];
  nextCommentId: number;
  nextIssueId: number;
}

interface ParsedUrl {
  segments: string[];
  query: Record<string, string>;
}

interface RouteContext {
  state: MockState;
  req: IncomingMessage;
  res: ServerResponse;
  segments: string[];
  query: Record<string, string>;
}

// ==================== 常量 ====================

const DEFAULT_PORT = 9099;
const DEFAULT_HOSTNAME = '127.0.0.1';
const DEFAULT_FIXTURES_DIR = 'mock-codehub-fixtures';
const MAX_BODY_SIZE = 10 * 1024 * 1024;

const DEFAULT_USER: CodeHubUser = {
  id: 1,
  name: 'Mock User',
  username: 'mockuser',
};

// ==================== 默认数据 ====================

function createDefaultProject(): CodeHubProject {
  return {
    id: 1,
    name: 'demo-project',
    path: 'demo-project',
    path_with_namespace: 'mock/demo-project',
    description: 'Mock project for testing',
    web_url: `http://${DEFAULT_HOSTNAME}:${DEFAULT_PORT}/demo-project`,
    default_branch: 'main',
    visibility: 'private',
    ssh_url_to_repo: `git@${DEFAULT_HOSTNAME}:mock/demo-project.git`,
    http_url_to_repo: `http://${DEFAULT_HOSTNAME}:${DEFAULT_PORT}/mock/demo-project.git`,
    created_at: '2024-01-01T00:00:00Z',
    last_activity_at: '2024-01-01T00:00:00Z',
    star_count: 0,
    forks_count: 0,
    open_issues_count: 0,
  };
}

function createDefaultMRs(): CodeHubMR[] {
  return [
    {
      id: 1,
      iid: 1,
      title: 'feat: add new feature',
      description: 'This MR adds a new feature',
      state: 'open',
      source_branch: 'feature/new-feature',
      target_branch: 'main',
      author: { ...DEFAULT_USER },
      created_at: '2024-01-01T10:00:00Z',
      updated_at: '2024-01-01T10:00:00Z',
      web_url: `http://${DEFAULT_HOSTNAME}:${DEFAULT_PORT}/demo-project/merge_requests/1`,
      source_project_id: 1,
      target_project_id: 1,
      merge_status: 'can_be_merged',
      changes_count: '1',
      user_notes_count: 1,
      labels: [],
      work_in_progress: false,
    },
    {
      id: 2,
      iid: 2,
      title: 'fix: resolve bug',
      description: 'This MR fixes a bug',
      state: 'merged',
      source_branch: 'fix/bug',
      target_branch: 'main',
      author: { ...DEFAULT_USER },
      created_at: '2024-01-02T10:00:00Z',
      updated_at: '2024-01-02T11:00:00Z',
      merged_at: '2024-01-02T11:00:00Z',
      web_url: `http://${DEFAULT_HOSTNAME}:${DEFAULT_PORT}/demo-project/merge_requests/2`,
      source_project_id: 1,
      target_project_id: 1,
      merge_status: 'can_be_merged',
      changes_count: '0',
      user_notes_count: 0,
      labels: [],
      work_in_progress: false,
    },
  ];
}

function createDefaultDiff(mrIid: number): CodeHubMRDiff {
  return {
    id: mrIid,
    iid: mrIid,
    diff_refs: {
      base_sha: '0000000000000000000000000000000000000000',
      head_sha: '1111111111111111111111111111111111111111',
      start_sha: '0000000000000000000000000000000000000000',
    },
    changes: [
      {
        diff: '@@ -1,3 +1,4 @@\n old line\n+new line\n context\n',
        new_path: 'src/index.ts',
        old_path: 'src/index.ts',
        new_file: false,
        renamed_file: false,
        deleted_file: false,
      },
    ],
  };
}

function createDefaultComments(): CodeHubComment[] {
  return [
    {
      id: 1,
      body: 'Looks good to me!',
      author: { ...DEFAULT_USER },
      created_at: '2024-01-01T11:00:00Z',
      updated_at: '2024-01-01T11:00:00Z',
    },
  ];
}

function createDefaultBranches(): CodeHubBranch[] {
  return [
    {
      name: 'main',
      merged: false,
      protected: true,
      default: true,
      can_push: false,
      web_url: `http://${DEFAULT_HOSTNAME}:${DEFAULT_PORT}/demo-project/-/tree/main`,
      commit: {
        id: '2222222222222222222222222222222222222222',
        short_id: '22222222',
        title: 'Initial commit',
        author_name: 'Mock User',
        author_email: 'mock@example.com',
        created_at: '2024-01-01T00:00:00Z',
        message: 'Initial commit\n',
      },
    },
  ];
}

// ==================== 工具函数 ====================

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json, 'utf-8'),
  });
  res.end(json);
}

function sendNoContent(res: ServerResponse): void {
  res.writeHead(204);
  res.end();
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { message });
}

function readBody(req: IncomingMessage, maxBytes = MAX_BODY_SIZE): Promise<string> {
  return new Promise((resolveBody, reject) => {
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
      resolveBody(Buffer.concat(chunks).toString('utf-8'));
    });
    req.on('error', (err) => reject(err));
  });
}

function parseUrl(url: string): ParsedUrl {
  const [pathPart, queryPart] = url.split('?');
  const rawSegments = pathPart.split('/').filter(Boolean);
  const segments = rawSegments.map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });

  const query: Record<string, string> = {};
  if (queryPart) {
    for (const pair of queryPart.split('&')) {
      const eqIdx = pair.indexOf('=');
      let rawKey: string;
      let rawVal: string;
      if (eqIdx === -1) {
        rawKey = pair;
        rawVal = '';
      } else {
        rawKey = pair.slice(0, eqIdx);
        rawVal = pair.slice(eqIdx + 1);
      }
      if (!rawKey) continue;
      try {
        query[decodeURIComponent(rawKey)] = rawVal ? decodeURIComponent(rawVal) : '';
      } catch {
        query[rawKey] = rawVal;
      }
    }
  }

  return { segments, query };
}

// ==================== fixtures 加载 ====================

function loadJsonFile<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null;
    const stat = statSync(filePath);
    if (!stat.isFile()) return null;
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

interface LoadedFixtures {
  project: CodeHubProject | null;
  mrs: CodeHubMR[] | null;
  diffs: Map<number, CodeHubMRDiff>;
  comments: Map<number, CodeHubComment[]>;
  branches: CodeHubBranch[] | null;
  issues: CodeHubIssue[] | null;
  loaded: boolean;
}

function loadFixtures(fixturesDir: string): LoadedFixtures {
  const result: LoadedFixtures = {
    project: null,
    mrs: null,
    diffs: new Map<number, CodeHubMRDiff>(),
    comments: new Map<number, CodeHubComment[]>(),
    branches: null,
    issues: null,
    loaded: false,
  };

  if (!existsSync(fixturesDir) || !statSync(fixturesDir).isDirectory()) {
    return result;
  }
  result.loaded = true;

  result.project = loadJsonFile<CodeHubProject>(join(fixturesDir, 'project.json'));
  result.mrs = loadJsonFile<CodeHubMR[]>(join(fixturesDir, 'mrs.json'));
  result.branches = loadJsonFile<CodeHubBranch[]>(join(fixturesDir, 'branches.json'));
  result.issues = loadJsonFile<CodeHubIssue[]>(join(fixturesDir, 'issues.json'));

  // 加载每个 MR 的 diff 和评论：mr-1-diff.json / mr-1-comments.json ...
  for (let i = 1; i <= 100; i++) {
    const diff = loadJsonFile<CodeHubMRDiff>(join(fixturesDir, `mr-${i}-diff.json`));
    if (diff) {
      result.diffs.set(i, diff);
    }
    const comments = loadJsonFile<CodeHubComment[]>(join(fixturesDir, `mr-${i}-comments.json`));
    if (comments) {
      result.comments.set(i, comments);
    }
  }

  return result;
}

// ==================== 状态构建 ====================

function buildDefaultState(): MockState {
  const mrs = createDefaultMRs();
  const mrsMap = new Map<number, CodeHubMR>();
  for (const mr of mrs) {
    mrsMap.set(mr.iid, mr);
  }

  const comments = new Map<number, CodeHubComment[]>();
  comments.set(1, createDefaultComments());

  const diffs = new Map<number, CodeHubMRDiff>();
  diffs.set(1, createDefaultDiff(1));
  diffs.set(2, createDefaultDiff(2));

  return {
    project: createDefaultProject(),
    mrs: mrsMap,
    comments,
    diffs,
    issues: [],
    branches: createDefaultBranches(),
    nextCommentId: 100,
    nextIssueId: 100,
  };
}

function buildStateFromFixtures(fixturesDir: string): MockState {
  const fixtures = loadFixtures(fixturesDir);
  if (!fixtures.loaded) {
    console.warn(
      `[mock-codehub-server] fixtures directory not found: ${fixturesDir}, using default data`,
    );
    return buildDefaultState();
  }

  const defaultState = buildDefaultState();
  const state: MockState = {
    project: fixtures.project ?? defaultState.project,
    mrs: new Map<number, CodeHubMR>(),
    comments: new Map<number, CodeHubComment[]>(),
    diffs: new Map<number, CodeHubMRDiff>(),
    issues: fixtures.issues ?? [],
    branches: fixtures.branches ?? [],
    nextCommentId: 100,
    nextIssueId: 100,
  };

  const mrsList = fixtures.mrs ?? [];
  for (const mr of mrsList) {
    state.mrs.set(mr.iid, mr);
  }

  for (const [iid, comments] of fixtures.comments) {
    state.comments.set(iid, comments);
  }

  for (const [iid, diff] of fixtures.diffs) {
    state.diffs.set(iid, diff);
  }

  // 根据已加载数据初始化自增计数器
  let maxCommentId = 0;
  for (const comments of state.comments.values()) {
    for (const c of comments) {
      if (c.id > maxCommentId) maxCommentId = c.id;
    }
  }
  state.nextCommentId = Math.max(100, maxCommentId + 1);

  let maxIssueIid = 0;
  for (const issue of state.issues) {
    if (issue.iid > maxIssueIid) maxIssueIid = issue.iid;
  }
  state.nextIssueId = Math.max(100, maxIssueIid + 1);

  return state;
}

// ==================== 鉴权 ====================

function checkAuth(req: IncomingMessage): boolean {
  const token = req.headers['private-token'];
  if (Array.isArray(token)) {
    return token.length > 0 && token[0] !== '';
  }
  return token !== undefined && token !== null && token !== '';
}

// ==================== 路由处理器 ====================

function handleProject(ctx: RouteContext): boolean {
  sendJson(ctx.res, 200, ctx.state.project);
  return true;
}

function handleMRList(ctx: RouteContext): boolean {
  const { state, query, res } = ctx;
  let mrs = Array.from(state.mrs.values());

  if (query.state && query.state !== 'all') {
    mrs = mrs.filter((mr) => mr.state === query.state);
  }

  if (query.search) {
    const search = query.search.toLowerCase();
    mrs = mrs.filter(
      (mr) =>
        mr.title.toLowerCase().includes(search) ||
        mr.description.toLowerCase().includes(search),
    );
  }

  mrs.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const page = query.page ? Math.max(1, parseInt(query.page, 10) || 1) : 1;
  const perPage = query.per_page
    ? Math.max(1, parseInt(query.per_page, 10) || 20)
    : 20;
  const start = (page - 1) * perPage;
  const paged = mrs.slice(start, start + perPage);

  sendJson(res, 200, paged);
  return true;
}

function handleMRDetail(ctx: RouteContext, mrIid: number): boolean {
  const mr = ctx.state.mrs.get(mrIid);
  if (!mr) {
    sendError(ctx.res, 404, 'Not Found');
    return true;
  }
  sendJson(ctx.res, 200, mr);
  return true;
}

function handleMRDiff(ctx: RouteContext, mrIid: number): boolean {
  const diff = ctx.state.diffs.get(mrIid);
  if (!diff) {
    sendError(ctx.res, 404, 'Not Found');
    return true;
  }
  sendJson(ctx.res, 200, diff);
  return true;
}

async function handleMRMerge(ctx: RouteContext, mrIid: number): Promise<boolean> {
  const { state, req, res } = ctx;
  const mr = state.mrs.get(mrIid);
  // iid 不存在返回 404
  if (!mr) {
    sendError(res, 404, 'Not Found');
    return true;
  }

  // 读取请求体（保持与 create 类处理器一致的读取风格，避免请求体未消费）
  try {
    await readBody(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(res, 400, message);
    return true;
  }

  // 更新 MR 状态为已合入，设置 merged_at 时间戳
  const now = new Date().toISOString();
  mr.state = 'merged';
  mr.merged_at = now;
  mr.updated_at = now;

  sendJson(res, 200, mr);
  return true;
}

function handleNotesList(ctx: RouteContext, mrIid: number): boolean {
  const mr = ctx.state.mrs.get(mrIid);
  if (!mr) {
    sendError(ctx.res, 404, 'Not Found');
    return true;
  }
  const comments = ctx.state.comments.get(mrIid) ?? [];
  sendJson(ctx.res, 200, comments);
  return true;
}

async function handleNotesCreate(ctx: RouteContext, mrIid: number): Promise<boolean> {
  const { state, req, res } = ctx;
  const mr = state.mrs.get(mrIid);
  if (!mr) {
    sendError(res, 404, 'Not Found');
    return true;
  }

  let bodyText: string;
  try {
    bodyText = await readBody(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(res, 400, message);
    return true;
  }

  let payload: { body?: string; position?: CodeHubComment['position'] };
  try {
    payload =
      bodyText.trim() === ''
        ? {}
        : (JSON.parse(bodyText) as { body?: string; position?: CodeHubComment['position'] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(res, 400, `Invalid JSON: ${message}`);
    return true;
  }

  if (!payload.body || typeof payload.body !== 'string') {
    sendError(res, 400, 'Missing or invalid "body" field');
    return true;
  }

  const now = new Date().toISOString();
  const comment: CodeHubComment = {
    id: state.nextCommentId++,
    body: payload.body,
    author: { ...DEFAULT_USER },
    created_at: now,
    updated_at: now,
  };
  if (payload.position) {
    comment.position = payload.position;
  }

  const existing = state.comments.get(mrIid) ?? [];
  existing.push(comment);
  state.comments.set(mrIid, existing);

  sendJson(res, 201, comment);
  return true;
}

function handleNoteDelete(ctx: RouteContext, mrIid: number, noteId: number): boolean {
  const { state, res } = ctx;
  const mr = state.mrs.get(mrIid);
  if (!mr) {
    sendError(res, 404, 'Not Found');
    return true;
  }
  const comments = state.comments.get(mrIid) ?? [];
  const idx = comments.findIndex((c) => c.id === noteId);
  if (idx === -1) {
    sendError(res, 404, 'Not Found');
    return true;
  }
  comments.splice(idx, 1);
  state.comments.set(mrIid, comments);
  sendNoContent(res);
  return true;
}

async function handleIssueCreate(ctx: RouteContext): Promise<boolean> {
  const { state, req, res } = ctx;

  let bodyText: string;
  try {
    bodyText = await readBody(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(res, 400, message);
    return true;
  }

  let payload: {
    title?: string;
    description?: string;
    labels?: string | string[];
  };
  try {
    payload =
      bodyText.trim() === ''
        ? {}
        : (JSON.parse(bodyText) as {
            title?: string;
            description?: string;
            labels?: string | string[];
          });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(res, 400, `Invalid JSON: ${message}`);
    return true;
  }

  if (!payload.title || typeof payload.title !== 'string') {
    sendError(res, 400, 'Missing or invalid "title" field');
    return true;
  }

  const now = new Date().toISOString();
  const iid = state.nextIssueId++;
  const labels: string[] = Array.isArray(payload.labels)
    ? payload.labels
    : typeof payload.labels === 'string' && payload.labels
      ? payload.labels
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const issue: CodeHubIssue = {
    id: iid,
    iid,
    title: payload.title,
    description: payload.description ?? '',
    state: 'opened',
    author: { ...DEFAULT_USER },
    labels,
    web_url: `http://${DEFAULT_HOSTNAME}:${DEFAULT_PORT}/demo-project/issues/${iid}`,
    created_at: now,
    updated_at: now,
  };
  state.issues.push(issue);

  sendJson(res, 201, issue);
  return true;
}

function handleIssueList(ctx: RouteContext): boolean {
  const { state, query, res } = ctx;
  let issues = [...state.issues];

  if (query.state && query.state !== 'all') {
    issues = issues.filter((i) => i.state === query.state);
  }

  if (query.labels) {
    const labels = query.labels
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    issues = issues.filter((i) => labels.every((l) => i.labels.includes(l)));
  }

  issues.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const page = query.page ? Math.max(1, parseInt(query.page, 10) || 1) : 1;
  const perPage = query.per_page
    ? Math.max(1, parseInt(query.per_page, 10) || 20)
    : 20;
  const start = (page - 1) * perPage;
  const paged = issues.slice(start, start + perPage);

  sendJson(res, 200, paged);
  return true;
}

function handleBranchList(ctx: RouteContext): boolean {
  const { state, query, res } = ctx;
  let branches = [...state.branches];

  if (query.search) {
    const search = query.search.toLowerCase();
    branches = branches.filter((b) => b.name.toLowerCase().includes(search));
  }

  sendJson(res, 200, branches);
  return true;
}

function handleBranchDetail(ctx: RouteContext, name: string): boolean {
  const branch = ctx.state.branches.find((b) => b.name === name);
  if (!branch) {
    sendError(ctx.res, 404, 'Not Found');
    return true;
  }
  sendJson(ctx.res, 200, branch);
  return true;
}

// ==================== 路由分发 ====================

async function dispatch(ctx: RouteContext): Promise<boolean> {
  const { segments, req } = ctx;
  const method = req.method ?? 'GET';

  // 期望路径前缀：/api/v3/projects/:projectId
  if (segments.length < 4) return false;
  if (segments[0] !== 'api' || segments[1] !== 'v3' || segments[2] !== 'projects') {
    return false;
  }
  // segments[3] = projectId（接受任意值，mock 不区分项目）

  // GET /api/v3/projects/:projectId — 项目信息
  if (segments.length === 4 && method === 'GET') {
    return handleProject(ctx);
  }

  if (segments.length >= 5 && segments[4] === 'merge_requests') {
    // GET /merge_requests — MR 列表
    if (segments.length === 5 && method === 'GET') {
      return handleMRList(ctx);
    }

    if (segments.length >= 6) {
      const mrIid = parseInt(segments[5], 10);
      if (Number.isNaN(mrIid)) {
        sendError(ctx.res, 400, 'Invalid MR IID');
        return true;
      }

      // GET /merge_requests/:iid — MR 详情
      if (segments.length === 6 && method === 'GET') {
        return handleMRDetail(ctx, mrIid);
      }

      // GET /merge_requests/:iid/diffs — MR diff
      if (segments.length === 7 && segments[6] === 'diffs' && method === 'GET') {
        return handleMRDiff(ctx, mrIid);
      }

      // PUT /merge_requests/:iid/merge — 合入 MR
      if (segments.length === 7 && segments[6] === 'merge' && method === 'PUT') {
        return handleMRMerge(ctx, mrIid);
      }

      // /merge_requests/:iid/notes — 评论列表 / 创建评论
      if (segments.length === 7 && segments[6] === 'notes') {
        if (method === 'GET') {
          return handleNotesList(ctx, mrIid);
        }
        if (method === 'POST') {
          return handleNotesCreate(ctx, mrIid);
        }
      }

      // DELETE /merge_requests/:iid/notes/:noteId — 删除评论
      if (
        segments.length === 8 &&
        segments[6] === 'notes' &&
        method === 'DELETE'
      ) {
        const noteId = parseInt(segments[7], 10);
        if (Number.isNaN(noteId)) {
          sendError(ctx.res, 400, 'Invalid note ID');
          return true;
        }
        return handleNoteDelete(ctx, mrIid, noteId);
      }
    }
  }

  // /api/v3/projects/:projectId/issues — Issue 列表 / 创建
  if (segments.length === 5 && segments[4] === 'issues') {
    if (method === 'GET') {
      return handleIssueList(ctx);
    }
    if (method === 'POST') {
      return handleIssueCreate(ctx);
    }
  }

  // /api/v3/projects/:projectId/repository/branches[/:name]
  if (
    segments.length >= 6 &&
    segments[4] === 'repository' &&
    segments[5] === 'branches'
  ) {
    if (segments.length === 6 && method === 'GET') {
      return handleBranchList(ctx);
    }
    if (segments.length === 7 && method === 'GET') {
      return handleBranchDetail(ctx, segments[6]);
    }
  }

  return false;
}

// ==================== 请求处理 ====================

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  state: MockState,
): Promise<void> {
  // CORS 头（便于开发调试）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, PRIVATE-TOKEN, Authorization',
  );

  const method = req.method ?? 'GET';
  if (method === 'OPTIONS') {
    sendNoContent(res);
    return;
  }

  // PRIVATE-TOKEN 鉴权
  if (!checkAuth(req)) {
    sendJson(res, 401, { message: 'Unauthorized' });
    return;
  }

  const url = req.url ?? '/';
  const { segments, query } = parseUrl(url);
  const ctx: RouteContext = { state, req, res, segments, query };

  const handled = await dispatch(ctx);
  if (!handled) {
    sendError(res, 404, 'Not Found');
  }
}

// ==================== 启动函数 ====================

export function startMockCodeHubServer(
  options?: MockCodeHubServerOptions,
): Promise<MockCodeHubServerHandle> {
  const port = options?.port ?? DEFAULT_PORT;
  const hostname = options?.hostname ?? DEFAULT_HOSTNAME;
  const fixturesDirRaw = options?.fixturesDir ?? DEFAULT_FIXTURES_DIR;
  // resolve 处理相对路径（基于 process.cwd()）和绝对路径
  const fixturesDir = resolve(fixturesDirRaw);

  const state = buildStateFromFixtures(fixturesDir);

  const server = createServer((req, res) => {
    handleRequest(req, res, state).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        sendError(res, 500, message);
      }
    });
  });

  return new Promise<MockCodeHubServerHandle>((resolveStart, reject) => {
    server.on('error', (err) => {
      reject(err);
    });
    server.listen(port, hostname, () => {
      const baseUrl = `http://${hostname}:${port}`;
      resolveStart({
        ok: true,
        port,
        hostname,
        baseUrl,
        close: () =>
          new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
          }),
      });
    });
  });
}
