import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseDiff } from '../../../src/diff-parser.js';
import {
  createStreamingEmitter,
  StreamingEmitter,
  streamProcessFiles,
  errorToPayload,
  type StreamStartPayload,
  type StreamCompletePayload,
  type StreamErrorPayload,
} from '../../../src/streaming-output.js';
import type { Finding, FileDiff } from '../../../src/types.js';

// ── 测试 fixtures ──

const TWO_FILES_DIFF = `diff --git a/src/a.ts b/src/a.ts
index aaa..bbb 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
-const a = 1;
+const a = 2;

diff --git a/src/b.ts b/src/b.ts
index ccc..ddd 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,1 +1,1 @@
-const b = 1;
+const b = 2;
`;

function makeFinding(file: string, line: number = 1): Finding {
  return {
    file,
    line,
    severity: 'low',
    category: 'quality',
    message: 'test finding',
    confidence: 0.7,
    source: 'rule',
  };
}

// ── 模块单元测试 ──

describe('streaming-output 模块', () => {
  describe('createStreamingEmitter', () => {
    it('返回 StreamingEmitter 实例', () => {
      const emitter = createStreamingEmitter();
      expect(emitter).toBeInstanceOf(StreamingEmitter);
    });

    it('未提供 writer 时仍可触发事件', () => {
      const emitter = createStreamingEmitter();
      const received: StreamStartPayload[] = [];
      emitter.on('start', (p) => received.push(p));
      emitter.emit('start', { totalFiles: 5 });
      expect(received).toHaveLength(1);
      expect(received[0].totalFiles).toBe(5);
    });

    it('提供 writer 时 emitSSE 写出 SSE 格式', () => {
      const written: string[] = [];
      const emitter = createStreamingEmitter((chunk) => written.push(chunk));
      emitter.emitSSE('start', { totalFiles: 3 });
      expect(written).toHaveLength(1);
      expect(written[0]).toContain('event: start');
      expect(written[0]).toContain('"totalFiles":3');
      expect(written[0]).toMatch(/\n\n$/);
    });
  });

  describe('StreamingEmitter.serializeSSE', () => {
    it('start 事件序列化正确', () => {
      const sse = StreamingEmitter.serializeSSE('start', { totalFiles: 10 });
      expect(sse).toBe('event: start\ndata: {"totalFiles":10}\n\n');
    });

    it('file_start 事件序列化正确', () => {
      const sse = StreamingEmitter.serializeSSE('file_start', {
        file: 'src/a.ts',
        index: 0,
        total: 5,
      });
      expect(sse).toContain('event: file_start');
      expect(sse).toContain('"file":"src/a.ts"');
      expect(sse).toContain('"index":0');
      expect(sse).toContain('"total":5');
    });

    it('complete 事件序列化正确', () => {
      const sse = StreamingEmitter.serializeSSE('complete', {
        totalFiles: 5,
        findingsCount: 12,
        durationMs: 1000,
        failedFiles: 0,
      });
      expect(sse).toContain('event: complete');
      expect(sse).toContain('"findingsCount":12');
    });

    it('error 事件序列化正确', () => {
      const sse = StreamingEmitter.serializeSSE('error', {
        message: 'boom',
        stage: 'review',
      });
      expect(sse).toContain('event: error');
      expect(sse).toContain('"message":"boom"');
    });

    it('file_complete 事件序列化包含 findings 数组', () => {
      const findings = [makeFinding('a.ts')];
      const sse = StreamingEmitter.serializeSSE('file_complete', {
        file: 'a.ts',
        index: 0,
        total: 1,
        findings,
      });
      expect(sse).toContain('event: file_complete');
      expect(sse).toContain('"findings"');
    });

    it('SSE 格式以两个换行结束', () => {
      const sse = StreamingEmitter.serializeSSE('start', { totalFiles: 1 });
      expect(sse.endsWith('\n\n')).toBe(true);
    });
  });

  describe('StreamingEmitter on/once/off/emit', () => {
    it('on + emit 触发监听器', () => {
      const emitter = new StreamingEmitter();
      const received: string[] = [];
      emitter.on('file_start', (p) => received.push(p.file));
      emitter.emit('file_start', { file: 'a.ts', index: 0, total: 1 });
      expect(received).toEqual(['a.ts']);
    });

    it('once 仅触发一次', () => {
      const emitter = new StreamingEmitter();
      let count = 0;
      emitter.once('start', () => count++);
      emitter.emit('start', { totalFiles: 1 });
      emitter.emit('start', { totalFiles: 2 });
      expect(count).toBe(1);
    });

    it('off 取消监听器', () => {
      const emitter = new StreamingEmitter();
      let count = 0;
      const listener = () => count++;
      emitter.on('start', listener);
      emitter.emit('start', { totalFiles: 1 });
      emitter.off('start', listener);
      emitter.emit('start', { totalFiles: 2 });
      expect(count).toBe(1);
    });

    it('监听器抛错被吞掉，不影响其他监听器', () => {
      const emitter = new StreamingEmitter();
      const received: number[] = [];
      emitter.on('start', () => {
        throw new Error('boom');
      });
      emitter.on('start', (p) => received.push(p.totalFiles));
      emitter.emit('start', { totalFiles: 5 });
      // 第二个监听器仍被触发
      expect(received).toEqual([5]);
    });

    it('listenerCount 返回监听器数', () => {
      const emitter = new StreamingEmitter();
      emitter.on('start', () => {});
      emitter.on('start', () => {});
      expect(emitter.listenerCount('start')).toBe(2);
      expect(emitter.listenerCount('complete')).toBe(0);
    });

    it('removeAllListeners 清空监听器', () => {
      const emitter = new StreamingEmitter();
      emitter.on('start', () => {});
      emitter.on('complete', () => {});
      emitter.removeAllListeners('start');
      expect(emitter.listenerCount('start')).toBe(0);
      expect(emitter.listenerCount('complete')).toBe(1);
      emitter.removeAllListeners();
      expect(emitter.listenerCount('complete')).toBe(0);
    });
  });

  describe('StreamingEmitter 便捷发送方法', () => {
    it('sendStart 触发 start 事件 + SSE', () => {
      const written: string[] = [];
      const emitter = new StreamingEmitter((c) => written.push(c));
      const received: StreamStartPayload[] = [];
      emitter.on('start', (p) => received.push(p));
      emitter.sendStart({ totalFiles: 5, startTime: 1000 });
      expect(received).toHaveLength(1);
      expect(received[0].totalFiles).toBe(5);
      expect(written[0]).toContain('event: start');
    });

    it('sendFileStart 触发 file_start + SSE', () => {
      const written: string[] = [];
      const emitter = new StreamingEmitter((c) => written.push(c));
      emitter.sendFileStart({ file: 'a.ts', index: 0, total: 3 });
      expect(written[0]).toContain('event: file_start');
    });

    it('sendFileComplete 触发 file_complete + SSE', () => {
      const written: string[] = [];
      const emitter = new StreamingEmitter((c) => written.push(c));
      const findings = [makeFinding('a.ts')];
      emitter.sendFileComplete({
        file: 'a.ts',
        index: 0,
        total: 1,
        findings,
        durationMs: 100,
      });
      expect(written[0]).toContain('event: file_complete');
      expect(written[0]).toContain('"durationMs":100');
    });

    it('sendComplete 触发 complete + SSE', () => {
      const written: string[] = [];
      const emitter = new StreamingEmitter((c) => written.push(c));
      emitter.sendComplete({
        totalFiles: 3,
        findingsCount: 5,
        durationMs: 500,
        failedFiles: 0,
      });
      expect(written[0]).toContain('event: complete');
    });

    it('sendError 触发 error + SSE', () => {
      const written: string[] = [];
      const emitter = new StreamingEmitter((c) => written.push(c));
      emitter.sendError({ message: 'failed', stage: 'process' });
      expect(written[0]).toContain('event: error');
      expect(written[0]).toContain('"message":"failed"');
    });
  });

  describe('StreamingEmitter.getProgress', () => {
    it('未 start 时返回 0', () => {
      const emitter = new StreamingEmitter();
      expect(emitter.getProgress()).toBe(0);
    });

    it('start 后 totalFiles=0 返回 100', () => {
      const emitter = new StreamingEmitter();
      emitter.emit('start', { totalFiles: 0 });
      expect(emitter.getProgress()).toBe(100);
    });

    it('处理过程中返回百分比', () => {
      const emitter = new StreamingEmitter();
      emitter.emit('start', { totalFiles: 4 });
      expect(emitter.getProgress()).toBe(0);
      emitter.emit('file_complete', {
        file: 'a',
        index: 0,
        total: 4,
        findings: [],
      });
      expect(emitter.getProgress()).toBe(25);
      emitter.emit('file_complete', {
        file: 'b',
        index: 1,
        total: 4,
        findings: [],
      });
      expect(emitter.getProgress()).toBe(50);
    });

    it('complete 后固定 100', () => {
      const emitter = new StreamingEmitter();
      emitter.emit('start', { totalFiles: 2 });
      emitter.emit('complete', {
        totalFiles: 2,
        findingsCount: 0,
        durationMs: 100,
      });
      expect(emitter.getProgress()).toBe(100);
    });
  });

  describe('errorToPayload', () => {
    it('Error 对象转 payload', () => {
      const err = new Error('test error');
      const payload = errorToPayload(err);
      expect(payload.message).toBe('test error');
      expect(payload.stack).toBeDefined();
    });

    it('非 Error 对象转 payload', () => {
      const payload = errorToPayload('string error');
      expect(payload.message).toBe('string error');
    });

    it('带 stage 与 file 参数', () => {
      const payload = errorToPayload(new Error('x'), 'review', 'a.ts');
      expect(payload.stage).toBe('review');
      expect(payload.file).toBe('a.ts');
    });
  });

  describe('streamProcessFiles', () => {
    it('对每个文件发送 file_start + file_complete 事件', async () => {
      const diffs = parseDiff(TWO_FILES_DIFF);
      const emitter = new StreamingEmitter();
      const events: Array<{ type: string; payload: unknown }> = [];
      emitter.on('start', (p) => events.push({ type: 'start', payload: p }));
      emitter.on('file_start', (p) => events.push({ type: 'file_start', payload: p }));
      emitter.on('file_complete', (p) => events.push({ type: 'file_complete', payload: p }));
      emitter.on('complete', (p) => events.push({ type: 'complete', payload: p }));
      emitter.on('error', (p) => events.push({ type: 'error', payload: p }));

      const result = await streamProcessFiles(emitter, diffs, async (diff) => {
        return [makeFinding(diff.path)];
      });

      // 2 文件 → 2 file_start + 2 file_complete + 1 start + 1 complete
      const types = events.map((e) => e.type);
      expect(types).toEqual([
        'start',
        'file_start',
        'file_complete',
        'file_start',
        'file_complete',
        'complete',
      ]);
      expect(result.allFindings).toHaveLength(2);
      expect(result.failedFiles).toBe(0);
    });

    it('处理失败时发送 error + 空 file_complete 推进进度', async () => {
      const diffs: FileDiff[] = [
        { path: 'fail.ts', status: 'modified', hunks: [] },
        { path: 'ok.ts', status: 'modified', hunks: [] },
      ];
      const emitter = new StreamingEmitter();
      const errorEvents: StreamErrorPayload[] = [];
      emitter.on('error', (p) => errorEvents.push(p));

      const result = await streamProcessFiles(emitter, diffs, async (diff) => {
        if (diff.path === 'fail.ts') {
          throw new Error('processing failed');
        }
        return [makeFinding(diff.path)];
      });

      expect(result.failedFiles).toBe(1);
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].message).toContain('processing failed');
      expect(errorEvents[0].file).toBe('fail.ts');
      // 仍收集到 ok.ts 的 finding
      expect(result.allFindings).toHaveLength(1);
    });

    it('空文件列表只发 start + complete', async () => {
      const emitter = new StreamingEmitter();
      const events: string[] = [];
      emitter.on('start', () => events.push('start'));
      emitter.on('file_start', () => events.push('file_start'));
      emitter.on('file_complete', () => events.push('file_complete'));
      emitter.on('complete', () => events.push('complete'));

      const result = await streamProcessFiles(emitter, [], async () => []);
      expect(events).toEqual(['start', 'complete']);
      expect(result.allFindings).toHaveLength(0);
      expect(result.failedFiles).toBe(0);
    });

    it('complete 事件包含正确统计', async () => {
      const diffs = parseDiff(TWO_FILES_DIFF);
      const emitter = new StreamingEmitter();
      let completePayload: StreamCompletePayload | null = null;
      emitter.on('complete', (p) => {
        completePayload = p;
      });

      await streamProcessFiles(emitter, diffs, async (diff) => {
        return [makeFinding(diff.path)];
      });

      expect(completePayload).not.toBeNull();
      expect(completePayload!.totalFiles).toBe(2);
      expect(completePayload!.findingsCount).toBe(2);
      expect(completePayload!.failedFiles).toBe(0);
      expect(completePayload!.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});

// ── CLI 集成测试：review --stream 输出 SSE ──

interface TestState {
  stdin: string;
  exitError: Error | null;
  stdout: string;
  stderr: string[];
}

const testState: TestState = {
  stdin: '',
  exitError: null,
  stdout: '',
  stderr: [],
};

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn((...args: unknown[]) => {
      const fd = args[0];
      if (fd === 0 || fd === '0') {
        return testState.stdin;
      }
      return (actual.readFileSync as (...a: unknown[]) => unknown)(...args);
    }),
  };
});

async function loadCli(opts: {
  argv: string[];
  stdin?: string;
}): Promise<{
  stdout: string;
  stderr: string[];
  exitCode: number | null;
}> {
  const { argv, stdin = '' } = opts;

  testState.stdin = stdin;
  testState.exitError = null;
  testState.stdout = '';
  testState.stderr = [];

  const origArgv = process.argv;
  process.argv = ['node', '/tmp/cli.js', ...argv];

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    testState.stdout += args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ') + '\n';
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    testState.stderr.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });
  // 拦截 process.stdout.write 以捕获 SSE 输出
  const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    if (typeof chunk === 'string') {
      testState.stdout += chunk;
    }
    return true;
  });

  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    const err = new Error(`__PROCESS_EXIT_${code ?? 0}__`);
    testState.exitError = err;
    throw err;
  }) as never);

  vi.resetModules();

  try {
    await import('../../../src/cli.js');
    return {
      stdout: testState.stdout,
      stderr: [...testState.stderr],
      exitCode: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const match = msg.match(/^__PROCESS_EXIT_(\d+)__$/);
    if (match) {
      return {
        stdout: testState.stdout,
        stderr: [...testState.stderr],
        exitCode: parseInt(match[1], 10),
      };
    }
    throw err;
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    writeSpy.mockRestore();
    exitSpy.mockRestore();
    process.argv = origArgv;
    vi.resetModules();
  }
}

describe('review --stream CLI 集成', () => {
  beforeEach(() => {
    testState.stdin = '';
    testState.stdout = '';
    testState.stderr = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('--stream 输出 SSE 格式事件', async () => {
    const { stdout, exitCode } = await loadCli({
      argv: ['review', '--stream'],
      stdin: TWO_FILES_DIFF,
    });

    expect(exitCode).toBeNull();
    // 应包含 SSE 事件标记
    expect(stdout).toContain('event: start');
    expect(stdout).toContain('event: file_start');
    expect(stdout).toContain('event: file_complete');
    expect(stdout).toContain('event: complete');
  });

  it('--stream 输出 start 事件含 totalFiles', async () => {
    const { stdout } = await loadCli({
      argv: ['review', '--stream'],
      stdin: TWO_FILES_DIFF,
    });
    // 2 文件
    expect(stdout).toContain('"totalFiles":2');
  });

  it('--stream 为每个文件输出 file_start/file_complete', async () => {
    const { stdout } = await loadCli({
      argv: ['review', '--stream'],
      stdin: TWO_FILES_DIFF,
    });
    // 2 个 file_start 和 2 个 file_complete
    const fileStartCount = (stdout.match(/event: file_start/g) || []).length;
    const fileCompleteCount = (stdout.match(/event: file_complete/g) || []).length;
    expect(fileStartCount).toBe(2);
    expect(fileCompleteCount).toBe(2);
  });

  it('--stream complete 事件含 findingsCount 与 durationMs', async () => {
    const { stdout } = await loadCli({
      argv: ['review', '--stream'],
      stdin: TWO_FILES_DIFF,
    });
    expect(stdout).toContain('"findingsCount":0');
    expect(stdout).toContain('"durationMs":');
  });

  it('trivial changes + --stream 输出完整事件序列后退出', async () => {
    const whitespaceDiff = `diff --git a/src/a.ts b/src/a.ts
index aaa..bbb 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
-  
+   
`;
    const { stdout, stderr, exitCode } = await loadCli({
      argv: ['review', '--stream'],
      stdin: whitespaceDiff,
    });

    expect(exitCode).toBeNull();
    // precheck 应跳过
    const errText = stderr.join('\n');
    expect(errText).toMatch(/precheck|trivial/i);
    // SSE 仍输出 start + complete
    expect(stdout).toContain('event: start');
    expect(stdout).toContain('event: complete');
  });

  it('未指定 --stream 时正常 review 流程（非 SSE 输出）', async () => {
    const { stdout, exitCode } = await loadCli({
      argv: ['review'],
      stdin: TWO_FILES_DIFF,
    });

    expect(exitCode).toBeNull();
    // 非 SSE 模式：输出 prompt（包含文件路径）
    expect(stdout).toContain('src/a.ts');
    expect(stdout).toContain('src/b.ts');
    // 不应输出 SSE 标记
    expect(stdout).not.toContain('event: start');
  });
});
