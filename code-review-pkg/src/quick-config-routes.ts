// src/quick-config-routes.ts — 一键配置路由
//
// 功能：
// - GET  /opencode/health           → 返回 checkEnvironment() 结果
// - POST /opencode/quick-configure  → 接收配置并保存
// - POST /services/start-all        → 启动所有服务（opencode → api → web）

import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkEnvironment, type EnvironmentCheckResult } from './environment-checker.js';
import { saveCodeHubConfig } from './codehub-config.js';
import type { MultiRepoConfig } from './types.js';
import { saveOpencodeManagerConfig } from './opencode-manager-config.js';
import type { OpencodeManagerConfig } from './opencode-manager-config.js';
import { OpencodeProcessManager } from './opencode-process-manager.js';

/** 快速配置请求体 */
export interface QuickConfigureRequest {
  codehub: {
    name: string;
    baseUrl: string;
    token: string;
    projectId: string;
  };
  reviewConfig?: {
    defaultStrength?: 'lenient' | 'standard' | 'strict';
    securityReview?: boolean;
    defaultLanguage?: string;
  };
  opencodeManager?: {
    startCommand: string;
    workDir: string;
  };
}

/** 单个服务启动结果 */
export interface ServiceStartResult {
  started: boolean;
  pid?: number;
  error?: string;
}

/** start-all 响应 */
export interface StartAllResponse {
  ok: boolean;
  services: {
    opencode: ServiceStartResult;
    api: ServiceStartResult;
    web: ServiceStartResult;
  };
}

/** 路由注册选项 */
export interface QuickConfigRoutesOptions {
  opencodeProcessManager: OpencodeProcessManager;
  codehubConfigPath?: string;
  opencodeConfigPath?: string;
  logger?: (message: string, ...args: unknown[]) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

/**
 * 启动 opencode serve 并等待就绪（通过 HTTP 探测）。
 */
async function startOpencodeAndWait(
  manager: OpencodeProcessManager,
  logger?: (message: string, ...args: unknown[]) => void,
): Promise<ServiceStartResult> {
  const result = await manager.start();
  if (!result.ok) {
    return { started: false, error: result.error };
  }

  logger?.('[quick-config] opencode started, waiting for readiness...');

  const maxWaitMs = 30_000;
  const intervalMs = 1000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const status = manager.getStatus();
    if (status.running && status.port) {
      try {
        const resp = await fetch(`http://${status.hostname ?? '127.0.0.1'}:${status.port}/health`);
        if (resp.ok) {
          logger?.('[quick-config] opencode is ready');
          return { started: true, pid: status.pid };
        }
      } catch {
        // 服务尚未就绪，继续等待
      }
    }
    await sleep(intervalMs);
  }

  const status = manager.getStatus();
  if (status.running) {
    logger?.('[quick-config] opencode running but health check timed out');
    return { started: true, pid: status.pid };
  }

  return { started: false, error: 'opencode failed to become ready within timeout' };
}

/**
 * 启动 API 服务（node dist/cli.js serve）。
 */
function startApiService(logger?: (message: string, ...args: unknown[]) => void): ServiceStartResult {
  const projectRoot = process.cwd();
  const cwd = existsSync(resolve(projectRoot, 'dist', 'cli.js'))
    ? projectRoot
    : resolve(projectRoot, 'code-review-pkg');

  try {
    const child = spawn(process.execPath, ['dist/cli.js', 'serve'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
      detached: false,
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      logger?.('[quick-config] api service spawn error:', err.message);
    });

    if (child.pid) {
      logger?.('[quick-config] api service started, pid:', child.pid);
      return { started: true, pid: child.pid };
    }

    return { started: false, error: 'Failed to spawn api service' };
  } catch (err) {
    return { started: false, error: (err as Error).message };
  }
}

/**
 * 启动 Web 前端服务（npm run dev）。
 */
function startWebService(logger?: (message: string, ...args: unknown[]) => void): ServiceStartResult {
  const projectRoot = process.cwd();
  const cwd = existsSync(resolve(projectRoot, 'web', 'package.json'))
    ? resolve(projectRoot, 'web')
    : resolve(projectRoot, '..', 'web');

  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  try {
    const child = spawn(npmBin, ['run', 'dev'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
      detached: false,
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      logger?.('[quick-config] web service spawn error:', err.message);
    });

    if (child.pid) {
      logger?.('[quick-config] web service started, pid:', child.pid);
      return { started: true, pid: child.pid };
    }

    return { started: false, error: 'Failed to spawn web service' };
  } catch (err) {
    return { started: false, error: (err as Error).message };
  }
}

/**
 * 注册一键配置路由。
 *
 * @returns 路由处理函数 (req, res) => Promise<boolean>
 */
export function createQuickConfigRoutesHandler(options: QuickConfigRoutesOptions) {
  const { opencodeProcessManager, codehubConfigPath, opencodeConfigPath, logger } = options;

  return async function handleQuickConfigRoutes(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const url = req.url ?? '/';
    const path = url.split('?')[0];
    const method = req.method ?? 'GET';

    // GET /api/v1/opencode/health
    if (path === '/api/v1/opencode/health' && method === 'GET') {
      try {
        const result: EnvironmentCheckResult = await checkEnvironment({
          codehubConfigPath,
          opencodeConfigPath,
        });
        sendJson(res, 200, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { ok: false, error: message });
      }
      return true;
    }

    // POST /api/v1/opencode/quick-configure
    if (path === '/api/v1/opencode/quick-configure' && method === 'POST') {
      try {
        const bodyText = await readBody(req);
        const body = JSON.parse(bodyText) as QuickConfigureRequest;

        if (!body.codehub?.name || !body.codehub?.baseUrl || !body.codehub?.token || !body.codehub?.projectId) {
          sendJson(res, 400, {
            ok: false,
            error: 'codehub.name, codehub.baseUrl, codehub.token, codehub.projectId are required',
          });
          return true;
        }

        const repoId = `repo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const multiConfig: Partial<MultiRepoConfig> = {
          repos: [
            {
              repoId,
              name: body.codehub.name,
              baseUrl: body.codehub.baseUrl,
              token: body.codehub.token,
              projectId: body.codehub.projectId,
            },
          ],
          activeRepoId: repoId,
          reviewConfig: body.reviewConfig,
        };

        const saved = saveCodeHubConfig(multiConfig, codehubConfigPath);

        let opencodeManagerSaved: OpencodeManagerConfig | null = null;
        if (body.opencodeManager) {
          opencodeManagerSaved = saveOpencodeManagerConfig({
            startCommand: body.opencodeManager.startCommand,
            workDir: body.opencodeManager.workDir,
          });
        }

        sendJson(res, 200, {
          ok: true,
          config: saved,
          opencodeManager: opencodeManagerSaved,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { ok: false, error: message });
      }
      return true;
    }

    // POST /api/v1/services/start-all
    if (path === '/api/v1/services/start-all' && method === 'POST') {
      logger?.('[quick-config] starting all services...');

      const opencodeResult = await startOpencodeAndWait(opencodeProcessManager, logger);
      let apiResult: ServiceStartResult = { started: false, error: 'opencode not ready' };
      let webResult: ServiceStartResult = { started: false, error: 'opencode not ready' };

      if (opencodeResult.started) {
        apiResult = startApiService(logger);
        webResult = startWebService(logger);
      }

      const allOk = opencodeResult.started && apiResult.started && webResult.started;
      const response: StartAllResponse = {
        ok: allOk,
        services: {
          opencode: opencodeResult,
          api: apiResult,
          web: webResult,
        },
      };

      sendJson(res, allOk ? 200 : 503, response);
      return true;
    }

    return false;
  };
}