import { describe, it, expect, afterEach, vi } from 'vitest';

const SAMPLE_FINDINGS = JSON.stringify([
  {
    file: 'src/app.ts',
    line: 5,
    severity: 'high',
    category: 'security',
    message: 'SQL injection vulnerability',
    suggestion: 'Use parameterized queries',
    confidence: 0.8,
    source: 'rule',
  },
  {
    file: 'src/utils.ts',
    line: 10,
    severity: 'low',
    category: 'style',
    message: 'Avoid console.log in production',
    confidence: 0.5,
    source: 'ai',
  },
]);

const MOCK_CONFIDENCE_RESPONSE = JSON.stringify([
  { id: 0, confidence: 0.9 },
  { id: 1, confidence: 0.3 },
]);

interface TestState {
  stdin: string;
  stdout: string[];
  stderr: string[];
  callLLMCalls: Array<{ prompt: string; config: unknown }>;
  llmResponse: string | null;
  llmError: Error | null;
  exitError: Error | null;
}

const testState: TestState = {
  stdin: '',
  stdout: [],
  stderr: [],
  callLLMCalls: [],
  llmResponse: null,
  llmError: null,
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

vi.mock('../../../src/ai-reflection.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ai-reflection.js')>();
  return {
    ...actual,
    callLLM: vi.fn(async (...args: unknown[]) => {
      testState.callLLMCalls.push({
        prompt: String(args[0]),
        config: args[1],
      });
      if (testState.llmError) throw testState.llmError;
      return testState.llmResponse ?? '[]';
    }),
  };
});

async function loadCli(opts: {
  argv: string[];
  stdin?: string;
  llm?: {
    response?: string | null;
    error?: Error | null;
  };
}): Promise<{
  stdout: string[];
  stderr: string[];
  callLLMCalls: Array<{ prompt: string; config: unknown }>;
}> {
  const { argv, stdin = '', llm } = opts;

  testState.stdin = stdin;
  testState.stdout = [];
  testState.stderr = [];
  testState.callLLMCalls = [];
  testState.llmResponse = llm?.response ?? null;
  testState.llmError = llm?.error ?? null;
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
    callLLMCalls: [...testState.callLLMCalls],
  };
}

describe('reflect command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('读取 findings JSON 并输出反思 prompt', async () => {
    const { stdout } = await loadCli({
      argv: ['reflect'],
      stdin: SAMPLE_FINDINGS,
    });

    expect(stdout.length).toBeGreaterThan(0);
    const prompt = stdout.join('\n');
    expect(prompt).toContain('code review quality evaluator');
    expect(prompt).toContain('src/app.ts');
    expect(prompt).toContain('SQL injection vulnerability');
    expect(prompt).toContain('src/utils.ts');
    expect(prompt).toContain('console.log');
  });

  it('空 findings 数组输出空 prompt', async () => {
    const { stdout } = await loadCli({
      argv: ['reflect'],
      stdin: '[]',
    });

    expect(stdout.join('\n').trim()).toBe('');
  });

  it('--execute 模式下调用 LLM 并输出置信度数组', async () => {
    const LLM_CONFIG_JSON = '{"provider":"openai","apiKey":"test","model":"gpt-4"}';
    const { stdout, callLLMCalls } = await loadCli({
      argv: ['reflect', '--execute', '--llm-config', LLM_CONFIG_JSON],
      stdin: SAMPLE_FINDINGS,
      llm: { response: MOCK_CONFIDENCE_RESPONSE },
    });

    expect(callLLMCalls.length).toBe(1);
    expect(callLLMCalls[0].config).toEqual({
      provider: 'openai',
      apiKey: 'test',
      model: 'gpt-4',
    });

    const output = stdout.join('\n');
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed[0]).toHaveProperty('id', 0);
    expect(parsed[0]).toHaveProperty('confidence', 0.9);
    expect(parsed[1]).toHaveProperty('id', 1);
    expect(parsed[1]).toHaveProperty('confidence', 0.3);
  });

  it('缺少 --llm-config 时输出错误', async () => {
    const { stderr } = await loadCli({
      argv: ['reflect', '--execute'],
      stdin: SAMPLE_FINDINGS,
    });

    expect(stderr.some((s) => s.includes('LLM config required'))).toBe(true);
  });

  it('无效 JSON 输入时抛出解析错误', async () => {
    await expect(
      loadCli({
        argv: ['reflect'],
        stdin: 'not valid json',
      }),
    ).rejects.toThrow();
  });
});