import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  exitCode: number | null;
}> {
  const { argv, stdin = '' } = opts;

  testState.stdin = stdin;
  testState.exitError = null;
  testState.stdout = [];
  testState.stderr = [];

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

describe('dashboard 命令', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('输出仪表盘数据 JSON', async () => {
    const now = Date.now();
    const inputData = JSON.stringify({
      sessions: [
        { id: 's1', status: 'completed', filesTotal: 10, filesProcessed: 10, createdAt: now - 86400 * 1000, updatedAt: now - 86400 * 1000 },
        { id: 's2', status: 'completed', filesTotal: 5, filesProcessed: 5, createdAt: now, updatedAt: now },
      ],
      findings: [
        { file: 'src/a.ts', line: 10, severity: 'high', category: 'security', message: 'SQL injection', confidence: 0.9, source: 'rule' },
        { file: 'src/b.ts', line: 20, severity: 'medium', category: 'quality', message: 'Code smell', confidence: 0.7, source: 'ai' },
      ],
      tokenConsumed: 1000,
    });

    const { stdout, exitCode } = await loadCli({
      argv: ['dashboard'],
      stdin: inputData,
    });

    expect(exitCode).toBeNull();
    expect(stdout.length).toBe(1);

    const output = JSON.parse(stdout[0]);
    expect(output.kpi).toBeDefined();
    expect(output.charts).toBeDefined();
    expect(output.metrics).toBeDefined();
  });

  it('仪表盘包含 KPI 数据', async () => {
    const now = Date.now();
    const inputData = JSON.stringify({
      sessions: [
        { id: 's1', status: 'completed', filesTotal: 10, filesProcessed: 10, createdAt: now, updatedAt: now },
      ],
      findings: [
        { file: 'src/a.ts', line: 10, severity: 'high', category: 'security', message: 'Issue', confidence: 0.9, source: 'rule' },
      ],
      tokenConsumed: 500,
    });

    const { stdout } = await loadCli({
      argv: ['dashboard'],
      stdin: inputData,
    });

    const output = JSON.parse(stdout[0]);
    expect(output.kpi.prCoverage).toBe(1);
    expect(output.kpi.fileCoverage).toBe(1);
    expect(output.kpi.totalFindings).toBe(1);
    expect(output.kpi.totalSessions).toBe(1);
    expect(output.kpi.totalTokens).toBe(500);
  });

  it('仪表盘包含趋势图表数据', async () => {
    const now = Date.now();
    const inputData = JSON.stringify({
      sessions: [
        { id: 's1', status: 'completed', filesTotal: 1, filesProcessed: 1, createdAt: now - 2 * 86400 * 1000, updatedAt: now - 2 * 86400 * 1000 },
        { id: 's2', status: 'completed', filesTotal: 1, filesProcessed: 1, createdAt: now - 86400 * 1000, updatedAt: now - 86400 * 1000 },
        { id: 's3', status: 'completed', filesTotal: 1, filesProcessed: 1, createdAt: now, updatedAt: now },
      ],
      findings: [],
      tokenConsumed: 0,
      findingsBySession: {
        s1: [{ file: 'a.ts', line: 1, severity: 'high', category: 'security', message: '1', confidence: 0.9, source: 'rule' }],
        s2: [{ file: 'b.ts', line: 1, severity: 'medium', category: 'quality', message: '2', confidence: 0.7, source: 'ai' }, { file: 'c.ts', line: 1, severity: 'low', category: 'style', message: '3', confidence: 0.5, source: 'rule' }],
        s3: [{ file: 'd.ts', line: 1, severity: 'critical', category: 'security', message: '4', confidence: 1.0, source: 'rule' }],
      },
    });

    const { stdout } = await loadCli({
      argv: ['dashboard'],
      stdin: inputData,
    });

    const output = JSON.parse(stdout[0]);
    expect(output.charts.trendLine).toBeDefined();
    expect(output.charts.trendLine.length).toBeGreaterThan(0);

    const totalFindings = output.charts.trendLine.reduce((s: number, b: { findingCount: number }) => s + b.findingCount, 0);
    expect(totalFindings).toBe(4);
  });

  it('仪表盘包含严重度分布饼图数据', async () => {
    const inputData = JSON.stringify({
      sessions: [],
      findings: [
        { file: 'a.ts', line: 1, severity: 'critical', category: 'security', message: 'c', confidence: 0.9, source: 'rule' },
        { file: 'b.ts', line: 1, severity: 'high', category: 'security', message: 'h', confidence: 0.8, source: 'ai' },
        { file: 'c.ts', line: 1, severity: 'medium', category: 'quality', message: 'm', confidence: 0.7, source: 'rule' },
      ],
      tokenConsumed: 0,
    });

    const { stdout } = await loadCli({
      argv: ['dashboard'],
      stdin: inputData,
    });

    const output = JSON.parse(stdout[0]);
    expect(output.charts.severityPie).toBeDefined();
    expect(output.charts.severityPie.critical).toBe(1);
    expect(output.charts.severityPie.high).toBe(1);
    expect(output.charts.severityPie.medium).toBe(1);
  });

  it('仪表盘包含类别分布柱状图数据', async () => {
    const inputData = JSON.stringify({
      sessions: [],
      findings: [
        { file: 'a.ts', line: 1, severity: 'high', category: 'security', message: 's1', confidence: 0.9, source: 'rule' },
        { file: 'b.ts', line: 1, severity: 'medium', category: 'security', message: 's2', confidence: 0.8, source: 'ai' },
        { file: 'c.ts', line: 1, severity: 'low', category: 'quality', message: 'q1', confidence: 0.7, source: 'rule' },
        { file: 'd.ts', line: 1, severity: 'high', category: 'performance', message: 'p1', confidence: 0.9, source: 'rule' },
      ],
      tokenConsumed: 0,
    });

    const { stdout } = await loadCli({
      argv: ['dashboard'],
      stdin: inputData,
    });

    const output = JSON.parse(stdout[0]);
    expect(output.charts.categoryBar).toBeDefined();
    expect(output.charts.categoryBar.security).toBe(2);
    expect(output.charts.categoryBar.quality).toBe(1);
    expect(output.charts.categoryBar.performance).toBe(1);
  });

  it('空输入返回零值仪表盘数据', async () => {
    const { stdout, exitCode } = await loadCli({
      argv: ['dashboard'],
      stdin: '',
    });

    expect(exitCode).toBeNull();
    const output = JSON.parse(stdout[0]);
    expect(output.kpi.prCoverage).toBe(0);
    expect(output.kpi.fileCoverage).toBe(0);
    expect(output.kpi.totalFindings).toBe(0);
    expect(output.kpi.totalSessions).toBe(0);
  });

  it('无效 JSON 输入时报错', async () => {
    const { stderr, exitCode } = await loadCli({
      argv: ['dashboard'],
      stdin: 'invalid json',
    });

    expect(exitCode).toBe(1);
    expect(stderr.some((s) => s.includes('Invalid JSON'))).toBe(true);
  });
});