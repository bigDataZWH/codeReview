// src/reports-routes.ts — Task 9.3：报表路由处理器
//
// 暴露 /api/v1/reports/* 下的报表查询端点，复用 reports.ts 的纯计算函数与
// review-runner.ts 的 historyStore 单例。
// 处理器风格沿用 codehub-routes.ts：导出工厂 createReportsRoutesHandler，
// 返回 (req, res) => Promise<boolean>，匹配前缀时返回 true。

import type { IncomingMessage, ServerResponse } from 'node:http';
import { historyStore } from './review-runner.js';
import {
  computeOverview,
  computeTrend,
  computeByRule,
  computeByAuthor,
  computeByRepo,
} from './reports.js';
import { loadCodeHubConfig } from './codehub-config.js';

/** 报表路由处理器选项 */
export interface ReportsRoutesOptions {
  /** CodeHub 配置文件路径（用于构建 repoId->name 映射，默认走 loadCodeHubConfig 默认路径） */
  configPath?: string;
}

/** 解析 URL 为 path 段与 query 参数 */
function parseRoute(req: IncomingMessage): {
  segments: string[];
  query: Record<string, string>;
  method: string;
} {
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

/** 发送 JSON 响应 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json, 'utf-8'),
  });
  res.end(json);
}

/** range 参数支持的取值映射（7d/30d/90d → 天数） */
const RANGE_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

/**
 * 创建报表路由处理器。
 *
 * 端点：
 * - GET /api/v1/reports/overview        总览指标（接纳率/拦截/检视数等）
 * - GET /api/v1/reports/trend?range=30d 检视趋势（range 支持 7d/30d/90d，默认 30d）
 * - GET /api/v1/reports/by-rule         按规则聚合
 * - GET /api/v1/reports/by-author       按作者聚合
 * - GET /api/v1/reports/by-repo         按仓库聚合（含 repoId->name 映射）
 *
 * @returns 处理器函数：匹配 /api/v1/reports/* 前缀时返回 true，否则返回 false
 */
export function createReportsRoutesHandler(options: ReportsRoutesOptions = {}) {
  const configPath = options.configPath;

  /** 构建 repoId -> name 映射（从 CodeHub 多仓配置读取） */
  const buildRepoNameMap = (): Map<string, string> => {
    const cfg = loadCodeHubConfig(configPath);
    const map = new Map<string, string>();
    for (const r of cfg.repos) {
      map.set(r.repoId, r.name);
    }
    return map;
  };

  return async function handleReportsRoutes(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const route = parseRoute(req);

    // 仅处理 /api/v1/reports/* 前缀；非匹配路径交还主分发器
    const isReportsPath =
      route.segments.length >= 3 &&
      route.segments[0] === 'api' &&
      route.segments[1] === 'v1' &&
      route.segments[2] === 'reports';

    if (!isReportsPath) {
      return false;
    }

    // 报表端点仅支持 GET
    if (route.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: `Method not allowed: ${route.method}` });
      return true;
    }

    const resource = route.segments[3];

    try {
      switch (resource) {
        // 总览指标
        case 'overview': {
          const overview = computeOverview(historyStore.getAll());
          sendJson(res, 200, { ok: true, overview });
          return true;
        }
        // 检视趋势（按日）
        case 'trend': {
          const range = route.query.range;
          const days = RANGE_DAYS[range ?? ''] ?? 30;
          const trend = computeTrend(historyStore.getAll(), days);
          sendJson(res, 200, { ok: true, trend });
          return true;
        }
        // 按规则聚合
        case 'by-rule': {
          const items = computeByRule(historyStore.getAll());
          sendJson(res, 200, { ok: true, items });
          return true;
        }
        // 按作者聚合
        case 'by-author': {
          const items = computeByAuthor(historyStore.getAll());
          sendJson(res, 200, { ok: true, items });
          return true;
        }
        // 按仓库聚合
        case 'by-repo': {
          const items = computeByRepo(historyStore.getAll(), buildRepoNameMap());
          sendJson(res, 200, { ok: true, items });
          return true;
        }
        // 未知资源
        default: {
          sendJson(res, 404, { ok: false, error: `Unknown reports resource: ${resource}` });
          return true;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { ok: false, error: message });
      return true;
    }
  };
}
