import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Finding, RepoConfig } from './types.js';
import { CodeHubClient } from './codehub-client.js';
import { RepoManager, DEFAULT_REPO_BASE_DIR } from './repo-manager.js';
import {
  loadCodeHubConfig,
  saveCodeHubConfig,
  maskToken,
  type CodeHubFullConfig,
} from './codehub-config.js';
import { createMultiRepoManager, type MultiRepoManager } from './multi-repo-manager.js';
import { publishFindingsAsIssue, saveReportToFile } from './codehub-publisher.js';
import { loadOpencodeConfig, saveOpencodeConfig } from './opencode-config-manager.js';
import type { OpencodeConfig } from './opencode-config-manager.js';
import {
  loadOpencodeManagerConfig,
  saveOpencodeManagerConfig,
  type OpencodeManagerConfig,
} from './opencode-manager-config.js';
import { OpencodeProcessManager } from './opencode-process-manager.js';
import { runReviewViaOpencode, historyStore } from './review-runner.js';
import { createMRSyncScheduler, type MRSyncScheduler } from './mr-sync-scheduler.js';
import { DEFAULT_CONFIG_FILE } from './codehub-config.js';

/**
 * 按 configPath 缓存的 MultiRepoManager / MRSyncScheduler 实例映射。
 * 原因：原实现将 repoManager 作为模块级单例（使用 DEFAULT_CONFIG_FILE），
 * 导致 createCodeHubRoutesHandler({ configPath }) 传入的自定义路径被忽略。
 * 使用按 configPath 索引的缓存，可保持同一进程内多次 handler 调用共享实例，
 * 同时让 cli.ts 的 getSyncScheduler() 与 handler 内的 repoManager 保持一致。
 */
const repoManagersByPath = new Map<string, MultiRepoManager>();
const schedulersByPath = new Map<string, MRSyncScheduler>();

function resolveConfigPath(configPath: string | undefined): string {
  const resolved = configPath ?? DEFAULT_CONFIG_FILE;
  if (!repoManagersByPath.has(resolved)) {
    const manager = createMultiRepoManager(resolved);
    repoManagersByPath.set(resolved, manager);
    const scheduler = createMRSyncScheduler({
      repoManager: manager,
      syncIntervalMs: loadCodeHubConfig(resolved).syncIntervalMs,
    });
    schedulersByPath.set(resolved, scheduler);
  }
  return resolved;
}

/**
 * 获取当前活跃配置路径下的 MR 同步调度器。
 * 若尚未初始化（createCodeHubRoutesHandler 未调用），则使用默认路径懒初始化。
 */
export function getSyncScheduler(): MRSyncScheduler {
  const path = resolveConfigPath(undefined);
  return schedulersByPath.get(path)!;
}

/**
 * 仅用于测试：清空所有 configPath 缓存的 repoManager / scheduler 实例。
 * 避免多测试文件运行在同一进程中时，不同 configPath 共享的模块级 Map 发生交叉污染。
 */
export function _resetRepoManagerCacheForTests(): void {
  repoManagersByPath.clear();
  schedulersByPath.clear();
}

interface CodeHubRoutesOptions {
  configPath?: string;
  repoBaseDir?: string;
  reviewFindingsStore?: Map<string, Finding[]>;
  opencodeProcessManager?: OpencodeProcessManager;
  opencodeConfigPath?: string;
}

interface ParsedRoute {
  segments: string[];
  query: Record<string, string>;
  method: string;
}

function parseRoute(req: IncomingMessage): ParsedRoute {
  const url = req.url ?? '/';
  const [pathPart, queryPart] = url.split('?');
  const segments = pathPart.split('/').filter(Boolean);

  const query: Record<string, string> = {};
  if (queryPart) {
    for (const pair of queryPart.split('&')) {
      const [k, v] = pair.split('=');
      if (k) {
        query[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
      }
    }
  }

  return {
    segments,
    query,
    method: req.method ?? 'GET',
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json, 'utf-8'),
  });
  res.end(json);
}

async function readBody(req: IncomingMessage, maxBytes = 10 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
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
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    req.on('error', (err) => reject(err));
  });
}

/** 异步等待辅助（用于批量评论间隔，避免触发速率限制） */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 处理 /api/v1/opencode/* 路由。
 *
 * 端点：
 * - GET  /api/v1/opencode/config        读取 opencode.jsonc 配置
 * - PUT  /api/v1/opencode/config        写入 opencode.jsonc 配置
 * - POST /api/v1/opencode/serve/start   启动 opencode serve 子进程
 * - POST /api/v1/opencode/serve/stop    停止 opencode serve 子进程
 * - GET  /api/v1/opencode/serve/status  查询 opencode serve 进程状态
 *
 * 若 opencodeProcessManager 未提供，所有 opencode 路由返回 500。
 */
async function handleOpencodeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  route: ParsedRoute,
  opencodeProcessManager: OpencodeProcessManager | undefined,
  opencodeConfigPath: string | undefined,
  resolvedConfigPath: string,
): Promise<boolean> {
  if (!opencodeProcessManager) {
    sendJson(res, 500, { ok: false, error: 'opencode process manager not configured' });
    return true;
  }

  const resource = route.segments[3];
  const subResource = route.segments[4];

  try {
    // GET /api/v1/opencode/manager-config
    if (resource === 'manager-config' && route.method === 'GET') {
      const config = loadOpencodeManagerConfig();
      sendJson(res, 200, { ok: true, config });
      return true;
    }

    // PUT /api/v1/opencode/manager-config
    if (resource === 'manager-config' && route.method === 'PUT') {
      try {
        const bodyText = await readBody(req);
        const body = JSON.parse(bodyText) as { startCommand?: string; workDir?: string };
        if (body.startCommand === undefined && body.workDir === undefined) {
          sendJson(res, 400, { ok: false, error: 'at least one of startCommand or workDir is required' });
          return true;
        }
        const existing = loadOpencodeManagerConfig();
        const merged: OpencodeManagerConfig = {
          startCommand: body.startCommand ?? existing.startCommand,
          workDir: body.workDir ?? existing.workDir,
        };
        const saved = saveOpencodeManagerConfig(merged);
        sendJson(res, 200, { ok: true, config: saved });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendJson(res, 400, { ok: false, error: message });
      }
      return true;
    }

    // GET /api/v1/opencode/config
    if (resource === 'config' && route.method === 'GET') {
      const config = loadOpencodeConfig(opencodeConfigPath);
      sendJson(res, 200, { ok: true, config });
      return true;
    }

    // PUT /api/v1/opencode/config
    if (resource === 'config' && route.method === 'PUT') {
      const bodyText = await readBody(req);
      const body = JSON.parse(bodyText) as OpencodeConfig;
      saveOpencodeConfig(body, opencodeConfigPath);
      sendJson(res, 200, { ok: true });
      return true;
    }

    // POST /api/v1/opencode/serve/start
    if (resource === 'serve' && subResource === 'start' && route.method === 'POST') {
      let opts: { hostname?: string; port?: number; commandTemplate?: string; workDir?: string } = {};
      try {
        const bodyText = await readBody(req);
        if (bodyText) {
          const body = JSON.parse(bodyText) as {
            hostname?: string;
            port?: number;
            commandTemplate?: string;
            workDir?: string;
          };
          opts = body;
        }
      } catch {
        // 忽略 body 解析错误，使用默认值
      }
      const managerConfig = loadOpencodeManagerConfig();
      const result = await opencodeProcessManager.start({
        hostname: opts.hostname,
        port: opts.port,
        commandTemplate: opts.commandTemplate ?? managerConfig.startCommand,
        workDir: opts.workDir ?? managerConfig.workDir,
        opencodeConfigPath,
        codehubConfigPath: resolvedConfigPath,
      });
      sendJson(res, 200, result);
      return true;
    }

    // POST /api/v1/opencode/serve/stop
    if (resource === 'serve' && subResource === 'stop' && route.method === 'POST') {
      const result = await opencodeProcessManager.stop();
      sendJson(res, 200, result);
      return true;
    }

    // GET /api/v1/opencode/serve/status
    if (resource === 'serve' && subResource === 'status' && route.method === 'GET') {
      const status = opencodeProcessManager.getStatus();
      sendJson(res, 200, { ok: true, status });
      return true;
    }

    sendJson(res, 404, { ok: false, error: `Not found: ${route.method} /${route.segments.join('/')}` });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { ok: false, error: message });
    return true;
  }
}

export function createCodeHubRoutesHandler(options: CodeHubRoutesOptions = {}) {
  // 关键：使用 resolveConfigPath 按 options.configPath 初始化 repoManager/scheduler，
  // 修复原模块级单例始终用 DEFAULT_CONFIG_FILE、忽略自定义 configPath 的缺陷
  const resolvedConfigPath = resolveConfigPath(options.configPath);
  const repoManager = repoManagersByPath.get(resolvedConfigPath)!;
  const syncScheduler = schedulersByPath.get(resolvedConfigPath)!;
  const reviewFindingsStore = options.reviewFindingsStore ?? new Map<string, Finding[]>();
  const opencodeProcessManager = options.opencodeProcessManager;
  const opencodeConfigPath = options.opencodeConfigPath;

  const getConfig = (): CodeHubFullConfig => {
    return loadCodeHubConfig(resolvedConfigPath);
  };

  const getClient = (repoId?: string): CodeHubClient => {
    const client = repoManager.getClient(repoId);
    if (!client) {
      throw new Error('No active CodeHub repo configured. Please add a repo via /api/v1/codehub/repos-config.');
    }
    return client;
  };

  const getRepoManager = (repoId?: string): RepoManager => {
    const repo = repoManager.getRepo(repoId);
    const baseDir = options.repoBaseDir ?? repo?.repoDir ?? DEFAULT_REPO_BASE_DIR;
    return new RepoManager({
      baseDir,
      codehubConfig: repo
        ? { baseUrl: repo.baseUrl, token: repo.token, projectId: String(repo.projectId) }
        : undefined,
    });
  };

  return async function handleCodeHubRoutes(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const route = parseRoute(req);

    // opencode 路由前缀：/api/v1/opencode/*
    const isOpencodePath =
      route.segments.length >= 3 &&
      route.segments[0] === 'api' &&
      route.segments[1] === 'v1' &&
      route.segments[2] === 'opencode';

    if (isOpencodePath) {
      return handleOpencodeRoutes(req, res, route, opencodeProcessManager, opencodeConfigPath, resolvedConfigPath);
    }

    // services 路由前缀：/api/v1/services/*
    const isServicesPath =
      route.segments.length >= 3 &&
      route.segments[0] === 'api' &&
      route.segments[1] === 'v1' &&
      route.segments[2] === 'services';

    if (isServicesPath) {
      const serviceResource = route.segments[3]; // 'start'
      if (serviceResource === 'start' && route.method === 'POST') {
        try {
          const bodyText = await readBody(req);
          const body = bodyText ? (JSON.parse(bodyText) as { service?: 'backend' | 'frontend' }) : {};
          const serviceName = body.service;
          if (!serviceName || (serviceName !== 'backend' && serviceName !== 'frontend')) {
            sendJson(res, 400, { ok: false, error: 'service must be "backend" or "frontend"' });
            return true;
          }
          // 后端服务使用 node dist/cli.js serve；前端服务使用 npm run dev
          const isBackend = serviceName === 'backend';
          const command = isBackend ? 'node dist/cli.js serve' : 'npm run dev';
          // 智能检测项目根目录：若当前 cwd 已含 dist/cli.js 则直接使用，否则向 code-review-pkg/web 子目录查找
          const projectRoot = process.cwd();
          const backendCwd = existsSync(resolve(projectRoot, 'dist', 'cli.js'))
            ? projectRoot
            : resolve(projectRoot, 'code-review-pkg');
          const frontendCwd = existsSync(resolve(projectRoot, 'web', 'package.json'))
            ? resolve(projectRoot, 'web')
            : resolve(projectRoot, '..', 'web');
          const cwd = isBackend ? backendCwd : frontendCwd;
          let child: ChildProcess;
          if (isBackend) {
            // 后端：node dist/cli.js serve（不依赖 npm 脚本）
            child = spawn(process.execPath, ['dist/cli.js', 'serve'], {
              stdio: ['ignore', 'pipe', 'pipe'],
              cwd,
            });
          } else {
            // 前端：npm run dev（Windows 上 npm 实际为 npm.cmd）
            const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
            child = spawn(npmBin, ['run', 'dev'], {
              stdio: ['ignore', 'pipe', 'pipe'],
              cwd,
            });
          }
          // 监听 spawn error 事件，避免 unhandled error 导致进程崩溃
          child.on('error', (err: NodeJS.ErrnoException) => {
            console.error(`[services/start] Failed to spawn '${command}' in '${cwd}': ${err.message}`);
          });
          if (child.pid) {
            sendJson(res, 200, { ok: true, pid: child.pid, command, service: serviceName, cwd });
          } else {
            sendJson(res, 500, { ok: false, error: `Failed to start ${serviceName} service` });
          }
          return true;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendJson(res, 500, { ok: false, error: message });
          return true;
        }
      }
      sendJson(res, 404, { ok: false, error: `Not found: ${route.method} /${route.segments.join('/')}` });
      return true;
    }

    const isCodeHubPath =
      route.segments.length >= 4 &&
      route.segments[0] === 'api' &&
      route.segments[1] === 'v1' &&
      route.segments[2] === 'codehub';

    if (!isCodeHubPath) {
      return false;
    }

    const resource = route.segments[3];
    const id = route.segments[4];
    const subResource = route.segments[5];

    try {
      // Config test endpoint (must be checked before generic config POST handler)
      if (resource === 'config' && id === 'test') {
        if (route.method === 'POST') {
          try {
            const client = getClient(route.query.repoId);
            const ok = await client.testConnection();
            sendJson(res, 200, { ok, message: ok ? 'Connection successful' : 'Connection failed' });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 200, { ok: false, message });
          }
          return true;
        }
      }

      // Config endpoints
      if (resource === 'config') {
        if (route.method === 'GET') {
          const config = getConfig();
          // 多仓结构：对 repos 数组中每个仓库的 token 脱敏
          const safeRepos = config.repos.map((r) => ({
            ...r,
            token: r.token ? maskToken(r.token) : '',
          }));
          // 向后兼容：暴露 active 仓库的 baseUrl/token/projectId/repoBaseDir 为顶层字段，
          // 匹配旧单仓 API 契约（前端 Settings 仍依赖这些字段渲染 CodeHub 配置 Tab）
          const activeRepo =
            safeRepos.find((r) => r.repoId === config.activeRepoId) ?? safeRepos[0] ?? null;
          const safeConfig = {
            ...config,
            repos: safeRepos,
            baseUrl: activeRepo?.baseUrl ?? '',
            token: activeRepo?.token ?? '',
            projectId: activeRepo ? String(activeRepo.projectId) : '',
            repoBaseDir: activeRepo?.repoDir ?? '',
          };
          sendJson(res, 200, { ok: true, config: safeConfig });
          return true;
        }

        if (route.method === 'POST') {
          const bodyText = await readBody(req);
          const body = JSON.parse(bodyText) as Partial<CodeHubFullConfig>;
          const saved = saveCodeHubConfig(body, resolvedConfigPath);
          const safeRepos = saved.repos.map((r) => ({
            ...r,
            token: r.token ? maskToken(r.token) : '',
          }));
          const activeRepo =
            safeRepos.find((r) => r.repoId === saved.activeRepoId) ?? safeRepos[0] ?? null;
          const safeConfig = {
            ...saved,
            repos: safeRepos,
            baseUrl: activeRepo?.baseUrl ?? '',
            token: activeRepo?.token ?? '',
            projectId: activeRepo ? String(activeRepo.projectId) : '',
            repoBaseDir: activeRepo?.repoDir ?? '',
          };
          sendJson(res, 200, { ok: true, config: safeConfig });
          return true;
        }
      }

      // 多仓配置管理端点（/api/v1/codehub/repos-config）
      if (resource === 'repos-config') {
        // GET /api/v1/codehub/repos-config — 列出所有仓库配置（token 脱敏）
        if (!id && route.method === 'GET') {
          const repos = repoManager.listRepos();
          const safeRepos = repos.map((r) => ({
            ...r,
            token: r.token ? maskToken(r.token) : '',
          }));
          sendJson(res, 200, {
            ok: true,
            repos: safeRepos,
            activeRepoId: repoManager.getActiveRepoId(),
          });
          return true;
        }

        // POST /api/v1/codehub/repos-config — 新增仓库配置
        if (!id && route.method === 'POST') {
          const bodyText = await readBody(req);
          const body = JSON.parse(bodyText) as {
            name: string;
            baseUrl: string;
            token: string;
            projectId: number | string;
            repoDir?: string;
          };
          if (!body.name || !body.baseUrl || !body.token || body.projectId === undefined) {
            sendJson(res, 400, {
              ok: false,
              error: 'name, baseUrl, token, projectId are required',
            });
            return true;
          }
          const repo = repoManager.addRepo({
            name: body.name,
            baseUrl: body.baseUrl,
            token: body.token,
            projectId: body.projectId,
            repoDir: body.repoDir,
          });
          const safeRepo = { ...repo, token: maskToken(repo.token) };
          sendJson(res, 201, { ok: true, repo: safeRepo });
          return true;
        }

        if (id) {
          // PUT /api/v1/codehub/repos-config/:repoId — 更新仓库配置
          if (!subResource && route.method === 'PUT') {
            const bodyText = await readBody(req);
            const patch = JSON.parse(bodyText) as Partial<Omit<RepoConfig, 'repoId'>>;
            const updated = repoManager.updateRepo(id, patch);
            if (!updated) {
              sendJson(res, 404, { ok: false, error: 'Repo not found' });
              return true;
            }
            const safeRepo = { ...updated, token: maskToken(updated.token) };
            sendJson(res, 200, { ok: true, repo: safeRepo });
            return true;
          }

          // DELETE /api/v1/codehub/repos-config/:repoId — 删除仓库配置
          if (!subResource && route.method === 'DELETE') {
            const activeRepoId = repoManager.deleteRepo(id);
            sendJson(res, 200, { ok: true, activeRepoId });
            return true;
          }

          // POST /api/v1/codehub/repos-config/:repoId/activate — 激活仓库
          if (subResource === 'activate' && route.method === 'POST') {
            const ok = repoManager.activateRepo(id);
            if (!ok) {
              sendJson(res, 404, { ok: false, error: 'Repo not found' });
              return true;
            }
            sendJson(res, 200, {
              ok: true,
              activeRepoId: repoManager.getActiveRepoId(),
            });
            return true;
          }
        }
      }

      // MR endpoints
      if (resource === 'mrs') {
        // Task 7：同步调度路由（sync 为保留字，需在 mrs/:mrIid 之前匹配，且不依赖 getClient）
        if (id === 'sync') {
          // POST /api/v1/codehub/mrs/sync — 手动触发一次同步
          if (!subResource && route.method === 'POST') {
            const result = await syncScheduler.syncOnce();
            sendJson(res, 200, { ok: true, ...result });
            return true;
          }
          // GET /api/v1/codehub/mrs/sync/status — 查询同步状态
          if (subResource === 'status' && route.method === 'GET') {
            const status = syncScheduler.getStatus();
            sendJson(res, 200, { ok: true, ...status });
            return true;
          }
          // POST /api/v1/codehub/mrs/sync/pause — 暂停定时同步
          if (subResource === 'pause' && route.method === 'POST') {
            syncScheduler.pause();
            sendJson(res, 200, { ok: true, paused: true });
            return true;
          }
          // POST /api/v1/codehub/mrs/sync/resume — 恢复定时同步
          if (subResource === 'resume' && route.method === 'POST') {
            syncScheduler.resume();
            sendJson(res, 200, {
              ok: true,
              paused: false,
              nextSyncAt: syncScheduler.getStatus().nextSyncAt,
            });
            return true;
          }
          sendJson(res, 404, { ok: false, error: `Not found: ${route.method} /${route.segments.join('/')}` });
          return true;
        }

        const client = getClient(route.query.repoId);

        if (!id) {
          // GET /api/v1/codehub/mrs
          if (route.method === 'GET') {
            const state = (route.query.state as 'open' | 'closed' | 'merged' | 'all') ?? 'open';
            const page = route.query.page ? parseInt(route.query.page, 10) : undefined;
            const perPage = route.query.per_page ? parseInt(route.query.per_page, 10) : undefined;
            const search = route.query.search;
            const orderBy = (route.query.order_by as 'created_at' | 'updated_at' | 'title') ?? undefined;
            const sort = (route.query.sort as 'asc' | 'desc') ?? undefined;
            const sourceBranch = route.query.source_branch;
            const targetBranch = route.query.target_branch;

            const result = await client.getMRList({
              state,
              page,
              perPage,
              search,
              orderBy,
              sort,
              sourceBranch,
              targetBranch,
            });
            sendJson(res, 200, { ok: true, ...result });
            return true;
          }
        }

        if (id) {
          const mrIid = parseInt(id, 10);
          if (Number.isNaN(mrIid)) {
            sendJson(res, 400, { ok: false, error: 'Invalid MR IID' });
            return true;
          }

          // GET /api/v1/codehub/mrs/:mrIid
          if (!subResource && route.method === 'GET') {
            const mr = await client.getMR(mrIid);
            sendJson(res, 200, { ok: true, mr });
            return true;
          }

          // GET /api/v1/codehub/mrs/:mrIid/diff
          if (subResource === 'diff' && route.method === 'GET') {
            const diff = await client.getMRDiff(mrIid);
            sendJson(res, 200, { ok: true, diff });
            return true;
          }

          // POST /api/v1/codehub/mrs/:mrIid/review
          if (subResource === 'review' && route.method === 'POST') {
            try {
              const findings = await runReviewViaOpencode(client, mrIid);
              reviewFindingsStore.set(`mr:${mrIid}`, findings);
              sendJson(res, 200, { ok: true, findings, count: findings.length, mrIid });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              sendJson(res, 500, { ok: false, error: message });
            }
            return true;
          }

          // GET /api/v1/codehub/mrs/:mrIid/findings
          if (subResource === 'findings' && route.method === 'GET') {
            const findings = reviewFindingsStore.get(`mr:${mrIid}`) ?? [];
            sendJson(res, 200, {
              ok: true,
              findings,
              count: findings.length,
              mrIid,
            });
            return true;
          }

          // POST /api/v1/codehub/mrs/:mrIid/findings/:findingId/comment
          // 将指定 finding 格式化为 MR 评论并发布
          if (subResource === 'findings' && route.method === 'POST' && route.segments[6]) {
            const findingId = route.segments[6];
            const action = route.segments[7];
            if (action === 'comment') {
              const findings = reviewFindingsStore.get(`mr:${mrIid}`) ?? [];
              const finding = findings.find((f) => f.id === findingId);
              if (!finding) {
                sendJson(res, 404, { ok: false, error: 'finding not found' });
                return true;
              }
              // 格式化 finding 为评论 body
              const severityEmoji: Record<string, string> = {
                critical: '🔴',
                high: '🟠',
                medium: '🟡',
                low: '🔵',
                info: '⚪',
              };
              const emoji = severityEmoji[finding.severity] ?? '⚪';
              const bodyParts: string[] = [
                `${emoji} **[${finding.severity.toUpperCase()}]** ${finding.message.split('\n')[0]}`,
                '',
                `**File:** \`${finding.file}:${finding.line}\``,
              ];
              if (finding.ruleId) bodyParts.push(`**Rule:** \`${finding.ruleId}\``);
              bodyParts.push('', '**Description:**', finding.message);
              if (finding.suggestion) {
                bodyParts.push('', '**Suggestion:**', finding.suggestion);
              }
              bodyParts.push('', '<!-- code-review:finding -->');
              const commentBody = bodyParts.join('\n');

              try {
                const commentOptions: {
                  path?: string;
                  line?: number;
                  lineType?: 'new' | 'old';
                } = {};
                if (finding.line && finding.line > 0) {
                  commentOptions.path = finding.file;
                  commentOptions.line = finding.line;
                  commentOptions.lineType = 'new';
                }
                const comment = await client.createMRComment(
                  mrIid,
                  commentBody,
                  commentOptions,
                );
                sendJson(res, 200, { ok: true, comment });
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                sendJson(res, 500, { ok: false, error: message });
              }
              return true;
            }
          }

          // POST /api/v1/codehub/mrs/:mrIid/issue — 将检视结果一键提为 CodeHub Issue
          if (subResource === 'issue' && route.method === 'POST') {
            const findings = reviewFindingsStore.get(`mr:${mrIid}`) ?? [];
            if (findings.length === 0) {
              sendJson(res, 400, {
                ok: false,
                error: 'No findings found for this MR. Please run review first.',
              });
              return true;
            }
            let labels: string[] | undefined;
            try {
              const bodyText = await readBody(req);
              if (bodyText) {
                const body = JSON.parse(bodyText) as { labels?: string[] };
                labels = body.labels;
              }
            } catch {
              // 忽略 body 解析错误
            }
            const client = getClient(route.query.repoId);
            const mr = await client.getMR(mrIid).catch(() => undefined);
            const result = await publishFindingsAsIssue({
              client,
              findings,
              mrIid,
              mrTitle: mr?.title,
              labels,
            });
            const statusCode = result.ok ? 200 : 500;
            sendJson(res, statusCode, result);
            return true;
          }

          // POST /api/v1/codehub/mrs/:mrIid/report — 将检视报告保存为本地 Markdown 文件
          if (subResource === 'report' && route.method === 'POST') {
            const findings = reviewFindingsStore.get(`mr:${mrIid}`) ?? [];
            if (findings.length === 0) {
              sendJson(res, 400, {
                ok: false,
                error: 'No findings found for this MR. Please run review first.',
              });
              return true;
            }
            let filePath: string | undefined;
            try {
              const bodyText = await readBody(req);
              if (bodyText) {
                const body = JSON.parse(bodyText) as { filePath?: string };
                filePath = body.filePath;
              }
            } catch {
              // 忽略 body 解析错误
            }
            if (!filePath) {
              const ts = new Date().toISOString().replace(/[:.]/g, '-');
              filePath = `.code-review-reports/mr-${mrIid}-${ts}.md`;
            }
            const client = getClient(route.query.repoId);
            const mr = await client.getMR(mrIid).catch(() => undefined);
            try {
              await saveReportToFile(findings, filePath, {
                mrIid,
                mrTitle: mr?.title,
              });
              sendJson(res, 200, {
                ok: true,
                filePath,
                findingsCount: findings.length,
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              sendJson(res, 500, { ok: false, error: message });
            }
            return true;
          }

          // Task 8：POST /api/v1/codehub/mrs/:mrIid/comments/batch — 批量提交 findings 为 MR 评论
          // 需在通用 comments 路由之前匹配，避免 batch 被当作普通评论处理
          if (subResource === 'comments' && route.segments[6] === 'batch' && route.method === 'POST') {
            const findings = reviewFindingsStore.get(`mr:${mrIid}`) ?? [];
            if (findings.length === 0) {
              sendJson(res, 400, {
                ok: false,
                error: 'No findings found for this MR. Please run review first.',
              });
              return true;
            }
            const severityEmoji: Record<string, string> = {
              critical: '🔴',
              high: '🟠',
              medium: '🟡',
              low: '🔵',
              info: '⚪',
            };
            const results: Array<{
              findingId: string;
              ok: boolean;
              commentId?: number;
              error?: string;
            }> = [];
            let success = 0;
            let failed = 0;
            const submittedFindingIds: string[] = [];
            for (const finding of findings) {
              const emoji = severityEmoji[finding.severity] ?? '⚪';
              const bodyParts: string[] = [
                `${emoji} **[${finding.severity.toUpperCase()}]** ${finding.message.split('\n')[0]}`,
                '',
                `**File:** \`${finding.file}:${finding.line}\``,
              ];
              if (finding.ruleId) bodyParts.push(`**Rule:** \`${finding.ruleId}\``);
              bodyParts.push('', '**Description:**', finding.message);
              if (finding.suggestion) {
                bodyParts.push('', '**Suggestion:**', finding.suggestion);
              }
              bodyParts.push('', '<!-- code-review:finding -->');
              const commentBody = bodyParts.join('\n');
              const findingId = finding.id ?? '';
              try {
                // finding 缺 line 时提交为普通评论（不带 position）
                const commentOptions: {
                  path?: string;
                  line?: number;
                  lineType?: 'new' | 'old';
                } = {};
                if (finding.line && finding.line > 0) {
                  commentOptions.path = finding.file;
                  commentOptions.line = finding.line;
                  commentOptions.lineType = 'new';
                }
                const comment = await client.createMRComment(mrIid, commentBody, commentOptions);
                success++;
                if (findingId) submittedFindingIds.push(findingId);
                results.push({ findingId, ok: true, commentId: comment?.id });
              } catch (err) {
                // 部分失败继续提交其余
                failed++;
                const message = err instanceof Error ? err.message : String(err);
                results.push({ findingId, ok: false, error: message });
              }
              // 每条评论间隔 200ms，避免触发速率限制
              await sleep(200);
            }
            // 成功提交的 findings 写入历史记录
            if (submittedFindingIds.length > 0) {
              const repoId = route.query.repoId ?? repoManager.getActiveRepoId() ?? '';
              historyStore.markSubmitted(mrIid, repoId, submittedFindingIds);
            }
            sendJson(res, 200, {
              ok: true,
              total: findings.length,
              success,
              failed,
              results,
            });
            return true;
          }

          // Task 8：GET /api/v1/codehub/mrs/:mrIid/merge/check — 检查 MR 是否可合入
          // critical/high findings 视为阻断项
          if (subResource === 'merge' && route.segments[6] === 'check' && route.method === 'GET') {
            const findings = reviewFindingsStore.get(`mr:${mrIid}`) ?? [];
            const blockingFindings = findings.filter(
              (f) => f.severity === 'critical' || f.severity === 'high',
            );
            const canMerge = blockingFindings.length === 0;
            const warnings: string[] = [];
            if (!canMerge) {
              warnings.push(`存在 ${blockingFindings.length} 条 critical/high 问题`);
              const repoId = route.query.repoId ?? repoManager.getActiveRepoId() ?? '';
              historyStore.markBlockedMerge(mrIid, repoId);
            }
            sendJson(res, 200, { ok: true, canMerge, blockingFindings, warnings });
            return true;
          }

          // Task 8：POST /api/v1/codehub/mrs/:mrIid/merge — 合入 MR
          // body: { mergeMethod?: 'merge'|'squash'|'rebase', force?: boolean }，默认 squash
          if (subResource === 'merge' && !route.segments[6] && route.method === 'POST') {
            const findings = reviewFindingsStore.get(`mr:${mrIid}`) ?? [];
            const blockingFindings = findings.filter(
              (f) => f.severity === 'critical' || f.severity === 'high',
            );
            const canMerge = blockingFindings.length === 0;
            let mergeMethod: 'merge' | 'squash' | 'rebase' = 'squash';
            let force = false;
            try {
              const bodyText = await readBody(req);
              if (bodyText) {
                const body = JSON.parse(bodyText) as {
                  mergeMethod?: 'merge' | 'squash' | 'rebase';
                  force?: boolean;
                };
                if (body.mergeMethod) mergeMethod = body.mergeMethod;
                if (body.force) force = true;
              }
            } catch {
              // 忽略 body 解析错误
            }
            // 阻断且未强制时返回 409
            if (!canMerge && !force) {
              sendJson(res, 409, {
                ok: false,
                error: 'blocked by unresolved critical findings',
                blockingFindings,
              });
              return true;
            }
            // 阻断但 force=true 时仍标记阻断记录，然后强制合入
            if (!canMerge && force) {
              const repoId = route.query.repoId ?? repoManager.getActiveRepoId() ?? '';
              historyStore.markBlockedMerge(mrIid, repoId);
            }
            await client.mergeMR(mrIid, mergeMethod);
            sendJson(res, 200, { ok: true, merged: true, mrState: 'merged' });
            return true;
          }

          // Comments endpoints
          if (subResource === 'comments') {
            // GET /api/v1/codehub/mrs/:mrIid/comments
            if (route.method === 'GET') {
              const comments = await client.getMRComments(mrIid);
              sendJson(res, 200, { ok: true, comments, count: comments.length });
              return true;
            }

            // POST /api/v1/codehub/mrs/:mrIid/comments
            if (route.method === 'POST') {
              const bodyText = await readBody(req);
              const body = JSON.parse(bodyText) as {
                body: string;
                path?: string;
                line?: number;
                line_type?: 'new' | 'old';
              };

              if (!body.body) {
                sendJson(res, 400, { ok: false, error: 'Comment body is required' });
                return true;
              }

              const comment = await client.createMRComment(mrIid, body.body, {
                path: body.path,
                line: body.line,
                lineType: body.line_type,
              });
              sendJson(res, 200, { ok: true, comment });
              return true;
            }
          }

          // DELETE /api/v1/codehub/mrs/:mrIid/comments/:commentId
          if (subResource === 'comments' && route.segments[6]) {
            const commentId = parseInt(route.segments[6], 10);
            if (!Number.isNaN(commentId) && route.method === 'DELETE') {
              await client.deleteMRComment(mrIid, commentId);
              sendJson(res, 200, { ok: true });
              return true;
            }
          }
        }
      }

      // Repo endpoints（本地 git 仓库管理，区别于多仓配置管理 repos-config）
      if (resource === 'repos') {
        const gitRepoManager = getRepoManager(route.query.repoId);

        if (!id && route.method === 'GET') {
          const repos = await gitRepoManager.listRepos();
          sendJson(res, 200, { ok: true, repos, count: repos.length });
          return true;
        }

        if (id) {
          const projectId = decodeURIComponent(id);

          // GET /api/v1/codehub/repos/:projectId
          if (!subResource && route.method === 'GET') {
            if (gitRepoManager.repoExists(projectId)) {
              const info = await gitRepoManager.getRepoInfo(projectId);
              sendJson(res, 200, { ok: true, repo: info });
            } else {
              sendJson(res, 404, { ok: false, error: 'Repository not found' });
            }
            return true;
          }

          // POST /api/v1/codehub/repos/:projectId/clone
          if (subResource === 'clone' && route.method === 'POST') {
            try {
              const bodyText = await readBody(req);
              const body = bodyText ? (JSON.parse(bodyText) as { branch?: string; depth?: number }) : {};
              const info = await gitRepoManager.cloneRepo(projectId, {
                branch: body.branch,
                depth: body.depth,
              });
              sendJson(res, 200, { ok: true, repo: info });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              sendJson(res, 400, { ok: false, error: message });
            }
            return true;
          }

          // POST /api/v1/codehub/repos/:projectId/fetch
          if (subResource === 'fetch' && route.method === 'POST') {
            try {
              const info = await gitRepoManager.fetchRepo(projectId);
              sendJson(res, 200, { ok: true, repo: info });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              sendJson(res, 400, { ok: false, error: message });
            }
            return true;
          }

          // POST /api/v1/codehub/repos/:projectId/pull
          if (subResource === 'pull' && route.method === 'POST') {
            try {
              const info = await gitRepoManager.pullRepo(projectId);
              sendJson(res, 200, { ok: true, repo: info });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              sendJson(res, 400, { ok: false, error: message });
            }
            return true;
          }

          // POST /api/v1/codehub/repos/:projectId/checkout
          if (subResource === 'checkout' && route.method === 'POST') {
            try {
              const bodyText = await readBody(req);
              const body = JSON.parse(bodyText) as { branch: string };
              if (!body.branch) {
                sendJson(res, 400, { ok: false, error: 'Branch is required' });
                return true;
              }
              const info = await gitRepoManager.checkoutBranch(projectId, body.branch);
              sendJson(res, 200, { ok: true, repo: info });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              sendJson(res, 400, { ok: false, error: message });
            }
            return true;
          }

          // GET /api/v1/codehub/repos/:projectId/branches
          if (subResource === 'branches' && route.method === 'GET') {
            try {
              const branches = await gitRepoManager.getBranches(projectId);
              sendJson(res, 200, { ok: true, branches, count: branches.length });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              sendJson(res, 400, { ok: false, error: message });
            }
            return true;
          }

          // DELETE /api/v1/codehub/repos/:projectId
          if (!subResource && route.method === 'DELETE') {
            try {
              await gitRepoManager.deleteRepo(projectId);
              sendJson(res, 200, { ok: true });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              sendJson(res, 400, { ok: false, error: message });
            }
            return true;
          }
        }
      }

      // Dashboard endpoint
      if (resource === 'dashboard' && route.method === 'GET') {
        const client = getClient(route.query.repoId);
        const [openMrs, mergedMrs, closedMrs] = await Promise.all([
          client.getMRList({ state: 'open', perPage: 100 }).catch(() => ({ mrs: [], total: 0 })),
          client.getMRList({ state: 'merged', perPage: 100 }).catch(() => ({ mrs: [], total: 0 })),
          client.getMRList({ state: 'closed', perPage: 100 }).catch(() => ({ mrs: [], total: 0 })),
        ]);

        let totalFindings = 0;
        const findingsBySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
        for (const [key, findings] of reviewFindingsStore.entries()) {
          if (key.startsWith('mr:')) {
            totalFindings += findings.length;
            for (const f of findings) {
              const sev = f.severity as keyof typeof findingsBySeverity;
              if (findingsBySeverity[sev] !== undefined) {
                findingsBySeverity[sev]++;
              }
            }
          }
        }

        const dashboard = {
          totalMRs: openMrs.total + mergedMrs.total + closedMrs.total,
          openMRs: openMrs.total,
          mergedMRs: mergedMrs.total,
          closedMRs: closedMrs.total,
          totalFindings,
          findingsBySeverity,
          pendingReviews: openMrs.total,
          reviewedToday: 0,
          reviewedThisWeek: 0,
          trend: [] as Array<{ date: string; reviews: number; findings: number }>,
        };

        sendJson(res, 200, { ok: true, dashboard });
        return true;
      }

      sendJson(res, 404, { ok: false, error: `Not found: ${route.method} /${route.segments.join('/')}` });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = message.includes('not valid') || message.includes('required') ? 400 : 500;
      sendJson(res, statusCode, { ok: false, error: message });
      return true;
    }
  };
}
