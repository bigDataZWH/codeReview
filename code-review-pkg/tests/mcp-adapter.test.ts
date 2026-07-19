import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import {
  isMCPAvailable,
  getReviewContext,
  getImpactRadius,
  formatMCPContext,
  _resetMCPState,
} from '../src/mcp-adapter.js';
import type { MCPContextResult } from '../src/types.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

const mockedSpawn = vi.mocked(spawn);
const mockedSpawnSync = vi.mocked(spawnSync);

function createMockChildProcess() {
  const mockStdout = { on: vi.fn() };
  const mockStderr = { on: vi.fn() };
  const mockStdin = { write: vi.fn(), end: vi.fn() };
  const mockProc = {
    stdin: mockStdin,
    stdout: mockStdout,
    stderr: mockStderr,
    on: vi.fn(),
    kill: vi.fn(),
    pid: 12345,
  };
  return { mockProc, mockStdout, mockStdin, mockStderr };
}

beforeEach(() => {
  vi.resetAllMocks();
  _resetMCPState();
  // Default: MCP command not found
  mockedSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '' } as any);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Round 34: isMCPAvailable (原有测试) ──

describe('isMCPAvailable', () => {
  it('当前为降级实现，始终返回 false', () => {
    expect(isMCPAvailable()).toBe(false);
  });
});

describe('getReviewContext', () => {
  it('降级实现返回空上下文', async () => {
    const ctx = await getReviewContext(['src/app.ts']);
    expect(ctx).toBeDefined();
    expect(ctx.codeSnippets).toEqual({});
    expect(ctx.blastRadius).toEqual([]);
    expect(ctx.riskScore).toBe(0);
  });
});

describe('getImpactRadius', () => {
  it('降级实现返回空数组', async () => {
    const result = await getImpactRadius(['src/app.ts']);
    expect(result).toEqual([]);
  });
});

// ── formatMCPContext (原有测试) ──

describe('formatMCPContext', () => {
  it('formats empty context', () => {
    const ctx: MCPContextResult = { filePaths: [], codeSnippets: {}, blastRadius: [], riskScore: 0 };
    expect(formatMCPContext(ctx)).toContain('no MCP context');
  });

  it('formats context with blast radius and risk score', () => {
    const ctx: MCPContextResult = {
      filePaths: ['src/app.ts'],
      codeSnippets: {},
      blastRadius: [{ path: 'src/handler.ts', type: 'caller', relation: 'calls' }],
      riskScore: 0.8,
    };
    const text = formatMCPContext(ctx);
    expect(text).toContain('src/app.ts');
    expect(text).toContain('0.8');
    expect(text).toContain('src/handler.ts');
  });

  it('formats code snippets', () => {
    const ctx: MCPContextResult = {
      filePaths: ['a.ts'],
      codeSnippets: { 'a.ts': 'function foo() { return 1; }' },
      blastRadius: [],
      riskScore: 0,
    };
    const text = formatMCPContext(ctx);
    expect(text).toContain('Code Snippets');
    expect(text).toContain('a.ts:');
  });
});

// ── MCPClient ──

describe('MCPClient', () => {
  it('用默认配置创建实例', async () => {
    mockedSpawnSync.mockReturnValue({ status: 0 } as any);
    const { mockProc } = createMockChildProcess();
    mockedSpawn.mockReturnValue(mockProc as any);

    const promise = getReviewContext(['src/a.ts']);

    // Flush microtask queue so connect() completes and sendRequest executes
    await Promise.resolve();

    // Verify spawn called with default command
    expect(mockedSpawn).toHaveBeenCalledWith(
      'code-review-graph',
      ['serve'],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
    );

    // Resolve the pending request so the test completes cleanly
    const dataCb = mockProc.stdout.on.mock.calls.find((c: any[]) => c[0] === 'data')![1];
    dataCb(Buffer.from(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { files: ['src/a.ts'], snippets: {}, blastRadius: [], riskScore: 0 },
    })));
    await promise;
  });

  it('connect / disconnect — 验证启动和关闭', async () => {
    mockedSpawnSync.mockReturnValue({ status: 0 } as any);
    const { mockProc } = createMockChildProcess();
    mockedSpawn.mockReturnValue(mockProc as any);

    const promise = getReviewContext(['src/a.ts']);

    // Flush microtask queue so connect() completes and sendRequest executes
    await Promise.resolve();

    // Verify connect: spawn called with correct args
    expect(mockedSpawn).toHaveBeenCalledWith('code-review-graph', ['serve'], expect.any(Object));
    expect(mockProc.stdout.on).toHaveBeenCalledWith('data', expect.any(Function));
    expect(mockProc.stderr.on).toHaveBeenCalledWith('data', expect.any(Function));
    expect(mockProc.on).toHaveBeenCalledWith('close', expect.any(Function));
    expect(mockProc.on).toHaveBeenCalledWith('error', expect.any(Function));

    // Complete the request
    const dataCb = mockProc.stdout.on.mock.calls.find((c: any[]) => c[0] === 'data')![1];
    dataCb(Buffer.from(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { files: [], snippets: {}, blastRadius: [], riskScore: 0 },
    })));
    await promise;

    // Reset triggers disconnect
    _resetMCPState();
    expect(mockProc.kill).toHaveBeenCalled();
  });

  it('sendRequest — 正确发送和接收 JSON-RPC', async () => {
    mockedSpawnSync.mockReturnValue({ status: 0 } as any);
    const { mockProc, mockStdin } = createMockChildProcess();
    mockedSpawn.mockReturnValue(mockProc as any);

    const promise = getReviewContext(['src/a.ts']);

    // Flush microtask queue so connect() completes and sendRequest executes
    await Promise.resolve();

    // Verify JSON-RPC 2.0 message format
    const writeArg = mockStdin.write.mock.calls[0][0] as string;
    const msg = JSON.parse(writeArg);
    expect(msg.jsonrpc).toBe('2.0');
    expect(msg.id).toBe(1);
    expect(msg.method).toBe('tools/call');
    expect(writeArg.endsWith('\n')).toBe(true);

    // Simulate response with matching id
    const dataCb = mockProc.stdout.on.mock.calls.find((c: any[]) => c[0] === 'data')![1];
    dataCb(Buffer.from(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { files: ['src/a.ts'], snippets: {}, blastRadius: [], riskScore: 0 },
    })));

    const result = await promise;
    expect(result.filePaths).toEqual(['src/a.ts']);
  });

  it('callTool — 通过 sendRequest 调用 tools/call 返回 result', async () => {
    mockedSpawnSync.mockReturnValue({ status: 0 } as any);
    const { mockProc, mockStdin } = createMockChildProcess();
    mockedSpawn.mockReturnValue(mockProc as any);

    const mcpResult = {
      files: ['src/a.ts'],
      snippets: { 'src/a.ts': 'const x = 1;' },
      blastRadius: [{ path: 'src/b.ts', type: 'caller', relation: 'calls' }],
      riskScore: 0.7,
    };

    const promise = getReviewContext(['src/a.ts']);

    // Flush microtask queue so connect() completes and sendRequest executes
    await Promise.resolve();

    // Verify tools/call method and params
    const writeArg = mockStdin.write.mock.calls[0][0] as string;
    const parsed = JSON.parse(writeArg);
    expect(parsed.method).toBe('tools/call');
    expect(parsed.params.name).toBe('review_context');
    expect(parsed.params.arguments).toEqual({ filePaths: ['src/a.ts'] });

    // Simulate tool result
    const dataCb = mockProc.stdout.on.mock.calls.find((c: any[]) => c[0] === 'data')![1];
    dataCb(Buffer.from(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: mcpResult,
    })));

    const result = await promise;
    expect(result.filePaths).toEqual(['src/a.ts']);
    expect(result.codeSnippets).toEqual({ 'src/a.ts': 'const x = 1;' });
    expect(result.blastRadius).toEqual([{ path: 'src/b.ts', type: 'caller', relation: 'calls' }]);
    expect(result.riskScore).toBe(0.7);
  });

  it('MCP Server 返回错误时正确处理', async () => {
    mockedSpawnSync.mockReturnValue({ status: 0 } as any);
    const { mockProc } = createMockChildProcess();
    mockedSpawn.mockReturnValue(mockProc as any);

    const promise = getReviewContext(['src/a.ts']);

    // Flush microtask queue so connect() completes and sendRequest executes
    await Promise.resolve();

    // Simulate error response
    const dataCb = mockProc.stdout.on.mock.calls.find((c: any[]) => c[0] === 'data')![1];
    dataCb(Buffer.from(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32600, message: 'Invalid Request' },
    })));

    // getReviewContext catches the error and falls back
    const result = await promise;
    expect(result.filePaths).toEqual(['src/a.ts']);
    expect(result.codeSnippets).toEqual({});
    expect(result.blastRadius).toEqual([]);
    expect(result.riskScore).toBe(0);
  });

  it('请求超时时 reject 并降级', async () => {
    vi.useFakeTimers();
    mockedSpawnSync.mockReturnValue({ status: 0 } as any);
    const { mockProc } = createMockChildProcess();
    mockedSpawn.mockReturnValue(mockProc as any);

    const promise = getReviewContext(['src/a.ts']);

    // Don't simulate response — let timeout fire
    await vi.advanceTimersByTimeAsync(30001);

    const result = await promise;
    // Should fall back to basic context
    expect(result.filePaths).toEqual(['src/a.ts']);
    expect(result.codeSnippets).toEqual({});
  });
});

// ── isMCPAvailable (完整实现) ──

describe('isMCPAvailable (完整实现)', () => {
  it('成功 — mock spawnSync 返回 status 0，返回 true', () => {
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: '/usr/bin/code-review-graph', stderr: '' } as any);
    expect(isMCPAvailable()).toBe(true);
  });

  it('失败 — mock spawnSync 抛出错误，返回 false', () => {
    mockedSpawnSync.mockImplementation(() => { throw new Error('not found'); });
    expect(isMCPAvailable()).toBe(false);
  });
});

// ── 降级处理 ──

describe('降级处理', () => {
  it('MCP 不可用时 getReviewContext 回退到基本上下文', async () => {
    // Default mock: spawnSync returns status 1 (command not found)
    const ctx = await getReviewContext(['src/a.ts', 'src/b.ts']);
    expect(ctx.filePaths).toEqual(['src/a.ts', 'src/b.ts']);
    expect(ctx.codeSnippets).toEqual({});
    expect(ctx.blastRadius).toEqual([]);
    expect(ctx.riskScore).toBe(0);
  });
});

// ── getReviewContext (完整实现) ──

describe('getReviewContext (完整实现)', () => {
  it('成功调用 — mock MCP 返回 review_context 工具结果', async () => {
    mockedSpawnSync.mockReturnValue({ status: 0 } as any);
    const { mockProc } = createMockChildProcess();
    mockedSpawn.mockReturnValue(mockProc as any);

    const promise = getReviewContext(['src/a.ts', 'src/b.ts']);

    // Flush microtask queue so connect() completes and sendRequest executes
    await Promise.resolve();

    const dataCb = mockProc.stdout.on.mock.calls.find((c: any[]) => c[0] === 'data')![1];
    dataCb(Buffer.from(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        snippets: {
          'src/a.ts': 'export function a() {}',
          'src/b.ts': 'import { a } from "./a"',
        },
        blastRadius: [
          { path: 'src/c.ts', type: 'callee', relation: 'called by' },
          { path: 'src/a.test.ts', type: 'test', relation: 'tests' },
        ],
        riskScore: 0.85,
      },
    })));

    const result = await promise;
    expect(result.filePaths).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(result.codeSnippets).toEqual({
      'src/a.ts': 'export function a() {}',
      'src/b.ts': 'import { a } from "./a"',
    });
    expect(result.blastRadius).toEqual([
      { path: 'src/c.ts', type: 'callee', relation: 'called by' },
      { path: 'src/a.test.ts', type: 'test', relation: 'tests' },
    ]);
    expect(result.riskScore).toBe(0.85);
  });

  it('MCP 不可用 — 返回降级上下文', async () => {
    // Command exists (isMCPAvailable returns true) but spawn fails
    mockedSpawnSync.mockReturnValue({ status: 0 } as any);
    mockedSpawn.mockImplementation(() => { throw new Error('spawn failed'); });

    const ctx = await getReviewContext(['src/x.ts']);
    expect(ctx.filePaths).toEqual(['src/x.ts']);
    expect(ctx.codeSnippets).toEqual({});
    expect(ctx.blastRadius).toEqual([]);
    expect(ctx.riskScore).toBe(0);
  });
});

// ── getImpactRadius (完整实现) ──

describe('getImpactRadius (完整实现)', () => {
  it('成功调用 — mock MCP 返回 impact_radius 工具结果', async () => {
    mockedSpawnSync.mockReturnValue({ status: 0 } as any);
    const { mockProc } = createMockChildProcess();
    mockedSpawn.mockReturnValue(mockProc as any);

    const promise = getImpactRadius(['src/a.ts']);

    // Flush microtask queue so connect() completes and sendRequest executes
    await Promise.resolve();

    const dataCb = mockProc.stdout.on.mock.calls.find((c: any[]) => c[0] === 'data')![1];
    dataCb(Buffer.from(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: [
        { path: 'src/b.ts', type: 'caller', relation: 'calls a()' },
        { path: 'src/c.ts', type: 'callee', relation: 'called by a()' },
        { path: 'src/a.test.ts', type: 'test', relation: 'tests a()' },
      ],
    })));

    const result = await promise;
    expect(result).toEqual([
      { path: 'src/b.ts', type: 'caller', relation: 'calls a()' },
      { path: 'src/c.ts', type: 'callee', relation: 'called by a()' },
      { path: 'src/a.test.ts', type: 'test', relation: 'tests a()' },
    ]);
  });

  it('MCP 不可用 — 返回空数组', async () => {
    mockedSpawnSync.mockReturnValue({ status: 0 } as any);
    mockedSpawn.mockImplementation(() => { throw new Error('spawn failed'); });

    const result = await getImpactRadius(['src/x.ts']);
    expect(result).toEqual([]);
  });
});