import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { MCPContextResult, BlastRadiusItem, MCPClientConfig } from './types.js';
import type { CacheManager } from './cache.js';

// ── Module-level state ──

let mcpAvailableCache: boolean | undefined;
let client: MCPClient | undefined;

/** Reset internal state (testing only) */
export function _resetMCPState(): void {
  mcpAvailableCache = undefined;
  if (client) {
    client.disconnect();
    client = undefined;
  }
}

// ── Internal types ──

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── MCPClient (internal, not exported) ──

class MCPClient {
  private proc?: ChildProcess;
  private requestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private readonly config: {
    command: string[];
    cwd: string;
    timeout: number;
    env: Record<string, string>;
  };

  constructor(config?: MCPClientConfig) {
    this.config = {
      command: config?.command ?? ['code-review-graph', 'serve'],
      cwd: config?.cwd ?? process.cwd(),
      timeout: config?.timeout ?? 30000,
      env: config?.env ?? {},
    };
  }

  async connect(): Promise<void> {
    this.proc = spawn(this.config.command[0], this.config.command.slice(1), {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout?.on('data', (data: Buffer) => {
      const str = data.toString();
      for (const line of str.split('\n')) {
        if (line.trim()) {
          this.handleMessage(line);
        }
      }
    });

    this.proc.stderr?.on('data', () => {
      // Ignore stderr output
    });

    this.proc.on('close', () => {
      this.cleanup();
    });

    this.proc.on('error', () => {
      this.cleanup();
    });
  }

  async disconnect(): Promise<void> {
    this.cleanup();
    if (this.proc) {
      this.proc.kill();
      this.proc = undefined;
    }
  }

  private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (!this.proc || !this.proc.stdin) {
        reject(new Error('MCP not connected'));
        return;
      }

      const id = ++this.requestId;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request '${method}' timed out`));
      }, this.config.timeout);

      this.pendingRequests.set(id, { resolve, reject, timer });

      const message = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params: params ?? {},
      });

      this.proc.stdin.write(message + '\n');
    });
  }

  async callTool(name: string, args?: Record<string, unknown>): Promise<unknown> {
    return this.sendRequest('tools/call', { name, arguments: args });
  }

  private handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data);
      if (typeof msg.id === 'number' && this.pendingRequests.has(msg.id)) {
        const pending = this.pendingRequests.get(msg.id)!;
        this.pendingRequests.delete(msg.id);
        clearTimeout(pending.timer);

        if (msg.error) {
          pending.reject(new Error(msg.error.message || 'MCP error'));
        } else {
          pending.resolve(msg.result);
        }
      }
    } catch {
      // Ignore invalid JSON lines
    }
  }

  private cleanup(): void {
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(new Error('MCP connection closed'));
    });
    this.pendingRequests.clear();
  }
}

// ── Exported functions ──

export async function getReviewContext(
  filePaths: string[],
  _mcpEndpoint?: string,
): Promise<MCPContextResult> {
  try {
    if (!isMCPAvailable()) {
      return fallbackContext(filePaths);
    }
    if (!client) {
      const c = new MCPClient();
      await c.connect();
      client = c;
    }
    const result = await client.callTool('review_context', { filePaths });
    if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      return {
        filePaths: Array.isArray(r.files) ? (r.files as string[]) : filePaths,
        codeSnippets: (r.snippets as Record<string, string>) ?? {},
        blastRadius: mapBlastRadius(r.blastRadius),
        riskScore: typeof r.riskScore === 'number' ? r.riskScore : 0,
      };
    }
  } catch {
    // Fallback on any error
  }
  return fallbackContext(filePaths);
}

export async function getImpactRadius(filePaths: string[]): Promise<BlastRadiusItem[]> {
  try {
    if (!isMCPAvailable()) return [];
    if (!client) {
      const c = new MCPClient();
      await c.connect();
      client = c;
    }
    const result = await client.callTool('impact_radius', { filePaths });
    if (Array.isArray(result)) {
      return mapBlastRadius(result);
    }
  } catch {
    // Fallback on any error
  }
  return [];
}

export function isMCPAvailable(): boolean {
  if (mcpAvailableCache !== undefined) return mcpAvailableCache;
  try {
    const result = spawnSync('which', ['code-review-graph'], { stdio: 'pipe' });
    mcpAvailableCache = result.status === 0;
  } catch {
    mcpAvailableCache = false;
  }
  return mcpAvailableCache;
}

export function formatMCPContext(context: MCPContextResult): string {
  const parts: string[] = [];

  parts.push(`Files: ${context.filePaths.join(', ') || '(none)'}`);

  if (context.riskScore > 0) {
    parts.push(`Risk Score: ${context.riskScore}`);
  }

  if (context.blastRadius.length > 0) {
    parts.push('Blast Radius:');
    for (const item of context.blastRadius) {
      parts.push(`  - ${item.path} (${item.type}: ${item.relation})`);
    }
  }

  const snippetKeys = Object.keys(context.codeSnippets);
  if (snippetKeys.length > 0) {
    parts.push('Code Snippets:');
    for (const path of snippetKeys) {
      parts.push(`  ${path}: ${context.codeSnippets[path].substring(0, 100)}...`);
    }
  }

  if (parts.length <= 1) {
    return '(no MCP context available)';
  }

  return parts.join('\n');
}

// ── Helpers ──

function fallbackContext(filePaths: string[]): MCPContextResult {
  return { filePaths, codeSnippets: {}, blastRadius: [], riskScore: 0 };
}

function mapBlastRadius(raw: unknown): BlastRadiusItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: unknown) => {
    const r = item as Record<string, string>;
    return {
      path: r.path,
      type: (r.type as BlastRadiusItem['type']) ?? 'caller',
      relation: r.relation,
    };
  });
}

// ── 迭代 4：MCP 上下文缓存 ──

/** MCP 上下文缓存键前缀 */
const MCP_CACHE_PREFIX = 'ocr:mcp:ctx:';

/**
 * 重置 MCP 上下文模块级缓存状态（仅供测试，保留以兼容既有测试调用）。
 *
 * 注：缓存实例由调用方通过 getReviewContextWithCache 的 cache 参数注入，
 * 模块本身不再持有可变状态，因此本函数为空操作。
 */
export function _resetMCPContextCache(): void {
  // no-op：保留导出以兼容测试调用
}

/**
 * 计算 key 对应的稳定 SHA-256 hex 哈希。
 */
function hashKey(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * 带缓存的 MCP 上下文查询。
 *
 * 缓存键基于文件路径列表的稳定哈希，相同路径列表第二次查询将命中缓存。
 * 当 cache 未提供时，回退到无缓存的 getReviewContext。
 *
 * @param filePaths 文件路径列表
 * @param cache 缓存管理器实例
 * @param mcpEndpoint MCP 端点（可选）
 * @param ttl 缓存 TTL（毫秒，可选）
 */
export async function getReviewContextWithCache(
  filePaths: string[],
  cache?: CacheManager,
  mcpEndpoint?: string,
  ttl?: number,
): Promise<MCPContextResult> {
  if (!cache) {
    return getReviewContext(filePaths, mcpEndpoint);
  }
  const key = `${MCP_CACHE_PREFIX}${hashKey(filePaths.join('\n'))}`;
  return cache.getOrCreate<MCPContextResult>(
    key,
    () => getReviewContext(filePaths, mcpEndpoint),
    ttl !== undefined ? { ttl } : undefined,
  );
}