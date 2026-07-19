import { describe, it, expect, afterEach, vi } from 'vitest';
import { FeedbackStore } from '../../../src/feedback.js';

const SAMPLE_SESSIONS = JSON.stringify([
  { id: 's1', status: 'completed', filesTotal: 10, filesProcessed: 10, createdAt: 1, updatedAt: 1 },
  { id: 's2', status: 'completed', filesTotal: 5, filesProcessed: 5, createdAt: 2, updatedAt: 2 },
]);

const SAMPLE_FINDINGS = JSON.stringify([
  { file: 'src/app.ts', line: 5, severity: 'critical', category: 'security', message: 'SQL injection', confidence: 0.9, source: 'rule' },
  { file: 'src/app.ts', line: 15, severity: 'high', category: 'security', message: 'XSS vulnerability', confidence: 0.85, source: 'ai' },
  { file: 'src/utils.ts', line: 10, severity: 'medium', category: 'performance', message: 'N+1 query', confidence: 0.7, source: 'rule' },
  { file: 'src/utils.ts', line: 20, severity: 'low', category: 'style', message: 'Unused import', confidence: 0.5, source: 'ai' },
  { file: 'src/config.ts', line: 8, severity: 'info', category: 'maintainability', message: 'Missing JSDoc', confidence: 0.3, source: 'rule' },
]);

const SAMPLE_FEEDBACK = JSON.stringify([
  { findingId: 'f1', action: 'accept', reason: 'Valid finding' },
  { findingId: 'f2', action: 'accept', reason: 'Valid finding' },
  { findingId: 'f3', action: 'reject', reason: 'False positive' },
  { findingId: 'f4', action: 'reject', reason: 'False positive' },
  { findingId: 'f5', action: 'modify', reason: 'Partial fix needed' },
]);

interface TestState {
  stdin: string;
  stdout: string[];
  stderr: string[];
  exitError: Error | null;
}

const testState: TestState = {
  stdin: '',
  stdout: [],
  stderr: [],
  exitError: null,
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
  stdout: string[];
  stderr: string[];
}> {
  const { argv, stdin = '' } = opts;

  testState.stdin = stdin;
  testState.stdout = [];
  testState.stderr = [];
  testState.exitError = null;

  const origArgv = process.argv;
  process.argv = ['node', '/tmp/cli.js', ...argv];

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

  vi.resetModules();

  try {
    await import('../../../src/cli.js');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.startsWith('__PROCESS_EXIT_')) {
      throw err;
    }
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    process.argv = origArgv;
    vi.resetModules();
  }

  return {
    stdout: [...testState.stdout],
    stderr: [...testState.stderr],
  };
}

describe('metrics command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('输出会话级 KPI：finding 总数', async () => {
    const { stdout } = await loadCli({
      argv: ['metrics', '--sessions', SAMPLE_SESSIONS, '--findings', SAMPLE_FINDINGS, '--feedback', SAMPLE_FEEDBACK],
    });

    const output = stdout.join('\n');
    const parsed = JSON.parse(output);
    const totalFindings = Object.values(parsed.quality.severityDistribution).reduce((sum: number, count: number) => sum + count, 0);
    expect(totalFindings).toBe(5);
  });

  it('输出会话级 KPI：严重度分布', async () => {
    const { stdout } = await loadCli({
      argv: ['metrics', '--sessions', SAMPLE_SESSIONS, '--findings', SAMPLE_FINDINGS, '--feedback', SAMPLE_FEEDBACK],
    });

    const output = stdout.join('\n');
    expect(output).toContain('severityDistribution');
    expect(output).toContain('critical');
    expect(output).toContain('high');
    expect(output).toContain('medium');
    expect(output).toContain('low');
    expect(output).toContain('info');
  });

  it('输出会话级 KPI：误报率（false positive rate = rejectRate）', async () => {
    const { stdout } = await loadCli({
      argv: ['metrics', '--sessions', SAMPLE_SESSIONS, '--findings', SAMPLE_FINDINGS, '--feedback', SAMPLE_FEEDBACK],
    });

    const output = stdout.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('quality');
    expect(parsed.quality).toHaveProperty('rejectRate');
    expect(parsed.quality.rejectRate).toBeCloseTo(0.4, 5);
  });

  it('输出覆盖率指标', async () => {
    const { stdout } = await loadCli({
      argv: ['metrics', '--sessions', SAMPLE_SESSIONS, '--findings', SAMPLE_FINDINGS, '--feedback', SAMPLE_FEEDBACK],
    });

    const output = stdout.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('coverage');
    expect(parsed.coverage.prCoverage).toBe(1);
    expect(parsed.coverage.fileCoverage).toBe(1);
    expect(parsed.coverage.totalSessions).toBe(2);
  });

  it('输出效率指标（修复率）', async () => {
    const { stdout } = await loadCli({
      argv: ['metrics', '--sessions', SAMPLE_SESSIONS, '--findings', SAMPLE_FINDINGS, '--feedback', SAMPLE_FEEDBACK],
    });

    const output = stdout.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('efficiency');
    expect(parsed.efficiency.fixRate).toBeCloseTo(0.4, 5);
  });

  it('空输入返回零值指标', async () => {
    const { stdout } = await loadCli({
      argv: ['metrics', '--sessions', '[]', '--findings', '[]', '--feedback', '[]'],
    });

    const output = stdout.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.coverage.prCoverage).toBe(0);
    expect(parsed.coverage.fileCoverage).toBe(0);
    expect(parsed.quality.avgFindingsPerFile).toBe(0);
    expect(parsed.cost.tokenConsumed).toBe(0);
  });

  it('缺少必要参数时输出错误', async () => {
    const { stderr } = await loadCli({
      argv: ['metrics'],
    });

    expect(stderr.some((s) => s.includes('--sessions'))).toBe(true);
    expect(stderr.some((s) => s.includes('--findings'))).toBe(true);
    expect(stderr.some((s) => s.includes('--feedback'))).toBe(true);
  });
});