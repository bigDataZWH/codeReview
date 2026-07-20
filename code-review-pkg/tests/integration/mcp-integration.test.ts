// tests/integration/mcp-integration.test.ts
// Task 11: MCP 与真实 code-review-graph 子进程的集成测试
//
// 与 tests/mcp-adapter.test.ts 不同：本文件不 mock `node:child_process`，
// 而是在 `code-review-graph` 二进制可用时启动真实子进程，验证 JSON-RPC 通信。
// 二进制不可用时（如 CI 环境）整体 skip，不视为失败。

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { getReviewContext, isMCPAvailable, _resetMCPState } from '../../src/mcp-adapter.js';
import type { MCPContextResult } from '../../src/types.js';

// ── 检测 code-review-graph 二进制是否可用 ──

const isGraphAvailable = (() => {
  try {
    const result = spawnSync('which', ['code-review-graph'], { encoding: 'utf-8' });
    return result.status === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
})();

// 或者直接尝试启动 (--version)
const canSpawn = (() => {
  try {
    const result = spawnSync('code-review-graph', ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
})();

const shouldRun = isGraphAvailable || canSpawn;

// ── SubTask 11.2-11.4：真实子进程集成测试 ──
// 仅在二进制可用时执行；否则整个 describe 被 skip。

describe.skipIf(!shouldRun)('MCP integration with real code-review-graph', () => {
  beforeAll(() => {
    // 清除 isMCPAvailable 的模块级缓存，确保本测试组真实探测二进制
    _resetMCPState();
  });

  afterAll(() => {
    // SubTask 11.4：测试结束后清理子进程与模块级状态
    _resetMCPState();
  });

  // SubTask 11.1：检测 code-review-graph 二进制是否可用
  it('isMCPAvailable returns true when binary exists', () => {
    const available = isMCPAvailable();
    expect(available).toBe(true);
  });

  // SubTask 11.3：调用 getReviewContext 验证返回 MCPContextResult 结构
  it('getReviewContext returns valid MCPContextResult', async () => {
    const filePaths = ['src/test.ts'];
    const result = await getReviewContext(filePaths);

    expect(result).toBeDefined();
    expect(result.filePaths).toEqual(filePaths);
    // codeSnippets 是 Record<string, string>（对象），非数组
    expect(typeof result.codeSnippets).toBe('object');
    expect(result.codeSnippets).not.toBeNull();
    expect(Array.isArray(result.blastRadius)).toBe(true);
    expect(typeof result.riskScore).toBe('number');
  });

  it('getReviewContext handles empty filePaths gracefully', async () => {
    const result: MCPContextResult = await getReviewContext([]);
    expect(result).toBeDefined();
    expect(result.filePaths).toEqual([]);
  });
});

// ── 兜底：当 shouldRun 为 false 时也至少有一个 skip 标记的 describe ──
// 避免"没有任何 it 被收集"的警告，并在输出中明确 skip 原因。

describe.skipIf(shouldRun)('MCP integration (SKIPPED: code-review-graph binary not available)', () => {
  it.skip('should run integration tests when code-review-graph is installed', () => {
    // 占位：避免 describe 没有任何 it 的警告
  });
});
