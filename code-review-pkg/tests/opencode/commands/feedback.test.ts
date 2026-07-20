import { describe, it, expect, vi, afterEach } from 'vitest';

interface TestState {
  stdin: string;
  exitError: Error | null;
  stdout: string[];
  stderr: string[];
}

const testState: TestState = {
  stdin: '',
  exitError: null,
  stdout: [],
  stderr: [],
};

async function loadCli(opts: {
  argv: string[];
  stdin?: string;
}): Promise<{
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}> {
  const { argv, stdin = '' } = opts;

  testState.stdin = stdin;
  testState.exitError = null;
  testState.stdout = [];
  testState.stderr = [];

  const origArgv = process.argv;
  process.argv = ['node', '/tmp/cli.js', ...argv];

  vi.resetModules();

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    testState.stdout.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    testState.stderr.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });

  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    const err = new Error(`__PROCESS_EXIT_${code ?? 0}__`);
    testState.exitError = err;
    throw err;
  }) as never);

  try {
    await import('../../../src/cli.js');
    return {
      stdout: [...testState.stdout],
      stderr: [...testState.stderr],
      exitCode: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const match = msg.match(/^__PROCESS_EXIT_(\d+)__$/);
    if (match) {
      return {
        stdout: [...testState.stdout],
        stderr: [...testState.stderr],
        exitCode: parseInt(match[1], 10),
      };
    }
    throw err;
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    process.argv = origArgv;
    vi.resetModules();
  }
}

describe('feedback 命令', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('标记误报 false-positive', () => {
    it('反馈 finding-id false-positive 标记为误报', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: ['feedback', 'finding-123', 'false-positive'],
      });

      expect(exitCode).toBeNull();
      expect(stdout.some((s) => s.includes('finding-123'))).toBe(true);
      expect(stdout.some((s) => s.includes('false positive'))).toBe(true);
    });

    it('false-positive 支持自定义原因', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: ['feedback', 'finding-456', 'false-positive', '--reason', '不是问题'],
      });

      expect(exitCode).toBeNull();
      expect(stdout.some((s) => s.includes('不是问题'))).toBe(true);
    });
  });

  describe('接受 finding accept', () => {
    it('反馈 finding-id accept 标记为接受', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: ['feedback', 'finding-789', 'accept'],
      });

      expect(exitCode).toBeNull();
      expect(stdout.some((s) => s.includes('finding-789'))).toBe(true);
      expect(stdout.some((s) => s.includes('Accepted'))).toBe(true);
    });

    it('accept 支持自定义原因', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: ['feedback', 'finding-000', 'accept', '--reason', '同意修复'],
      });

      expect(exitCode).toBeNull();
      expect(stdout.some((s) => s.includes('同意修复'))).toBe(true);
    });
  });

  describe('参数校验', () => {
    it('缺少 finding-id 时输出帮助信息', async () => {
      const { stderr, exitCode } = await loadCli({
        argv: ['feedback'],
      });

      expect(exitCode).toBe(1);
      expect(stderr.some((s) => s.includes('Usage'))).toBe(true);
    });

    it('缺少 action 时输出帮助信息', async () => {
      const { stderr, exitCode } = await loadCli({
        argv: ['feedback', 'finding-123'],
      });

      expect(exitCode).toBe(1);
      expect(stderr.some((s) => s.includes('Usage'))).toBe(true);
    });

    it('无效 action 时输出错误', async () => {
      const { stderr, exitCode } = await loadCli({
        argv: ['feedback', 'finding-123', 'invalid-action'],
      });

      expect(exitCode).toBe(1);
      expect(stderr.some((s) => s.includes('invalid'))).toBe(true);
    });
  });
});