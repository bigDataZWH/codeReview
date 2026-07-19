import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SAMPLE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 import { foo } from './foo';
-const x = 1;
+const x = 2;
+console.log("debug");
 export default x;
`;

const MOCK_IMPACT_RESULT = JSON.stringify([
  {
    affectedFiles: ['src/app.ts', 'src/foo.ts'],
    indirectAffectedFiles: ['src/utils.ts', 'tests/app.test.ts'],
    testCoverage: 'partial',
    riskScore: 6,
    description: '变更影响核心模块，需关注测试覆盖',
  },
]);

interface TestState {
  stdin: string;
  exitError: Error | null;
  stdout: string[];
  stderr: string[];
  callLLMCalls: Array<{ prompt: string; config: unknown }>;
  llmResponse: string | null;
  llmError: Error | null;
}

const testState: TestState = {
  stdin: '',
  exitError: null,
  stdout: [],
  stderr: [],
  callLLMCalls: [],
  llmResponse: null,
  llmError: null,
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
  exitCode: number | null;
  callLLMCalls: Array<{ prompt: string; config: unknown }>;
}> {
  const { argv, stdin = '', llm } = opts;

  testState.stdin = stdin;
  testState.exitError = null;
  testState.stdout = [];
  testState.stderr = [];
  testState.callLLMCalls = [];
  testState.llmResponse = llm?.response ?? null;
  testState.llmError = llm?.error ?? null;

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
      callLLMCalls: [...testState.callLLMCalls],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const match = msg.match(/^__PROCESS_EXIT_(\d+)__$/);
    if (match) {
      return {
        stdout: [...testState.stdout],
        stderr: [...testState.stderr],
        exitCode: parseInt(match[1], 10),
        callLLMCalls: [...testState.callLLMCalls],
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

describe('impact 命令', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'impact-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('输出 impact prompt', async () => {
    const { stdout, exitCode } = await loadCli({
      argv: ['impact'],
      stdin: SAMPLE_DIFF,
    });

    expect(exitCode).toBeNull();
    expect(stdout.length).toBeGreaterThan(0);
    const prompt = stdout.join('\n');
    expect(prompt).toContain('影响');
    expect(prompt).toContain('src/app.ts');
  });

  it('空 diff 也能处理', async () => {
    const { stdout } = await loadCli({
      argv: ['impact'],
      stdin: '',
    });

    expect(stdout.length).toBeGreaterThan(0);
  });

  describe('with --execute flag', () => {
    const LLM_CONFIG_JSON = '{"provider":"openai","apiKey":"test","model":"gpt-4"}';

    it('calls LLM with impact-analyzer agent and outputs JSON', async () => {
      const { stdout, exitCode, callLLMCalls } = await loadCli({
        argv: ['impact', '--execute', '--llm-config', LLM_CONFIG_JSON],
        stdin: SAMPLE_DIFF,
        llm: { response: MOCK_IMPACT_RESULT },
      });

      expect(exitCode).toBeNull();
      expect(callLLMCalls.length).toBe(1);
      expect(callLLMCalls[0].config).toEqual({
        provider: 'openai',
        apiKey: 'test',
        model: 'gpt-4',
      });
      expect(typeof callLLMCalls[0].prompt).toBe('string');
      expect(callLLMCalls[0].prompt.length).toBeGreaterThan(0);
      expect(callLLMCalls[0].prompt).toContain('src/app.ts');

      const output = stdout.join('\n');
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
      expect(parsed[0]).toHaveProperty('affectedFiles');
      expect(parsed[0]).toHaveProperty('indirectAffectedFiles');
      expect(parsed[0]).toHaveProperty('testCoverage');
      expect(parsed[0]).toHaveProperty('riskScore');
      expect(parsed[0]).toHaveProperty('description');
    });

    it('outputs prompt only when --execute is NOT provided', async () => {
      const { stdout, exitCode, callLLMCalls } = await loadCli({
        argv: ['impact'],
        stdin: SAMPLE_DIFF,
        llm: { response: MOCK_IMPACT_RESULT },
      });

      expect(exitCode).toBeNull();
      expect(callLLMCalls.length).toBe(0);
      const prompt = stdout.join('\n');
      expect(prompt).toContain('影响');
      expect(prompt).toContain('src/app.ts');
      expect(() => JSON.parse(prompt)).toThrow();
    });

    it('errors when --execute is provided but --llm-config is missing', async () => {
      const { stderr, exitCode, callLLMCalls } = await loadCli({
        argv: ['impact', '--execute'],
        stdin: SAMPLE_DIFF,
      });

      expect(exitCode).toBe(1);
      expect(stderr.some((s) => s.includes('LLM config required'))).toBe(true);
      expect(callLLMCalls.length).toBe(0);
    });

    it('handles LLM call failure gracefully', async () => {
      const { stderr, exitCode, callLLMCalls } = await loadCli({
        argv: ['impact', '--execute', '--llm-config', LLM_CONFIG_JSON],
        stdin: SAMPLE_DIFF,
        llm: { error: new Error('LLM API error: 503 Service Unavailable') },
      });

      expect(exitCode).toBe(1);
      expect(callLLMCalls.length).toBe(1);
      expect(stderr.some((s) => s.includes('LLM call failed'))).toBe(true);
      expect(stderr.some((s) => s.includes('503 Service Unavailable'))).toBe(true);
    });

    it('errors when --llm-config is invalid JSON', async () => {
      const { stderr, exitCode, callLLMCalls } = await loadCli({
        argv: ['impact', '--execute', '--llm-config', '{not valid json'],
        stdin: SAMPLE_DIFF,
      });

      expect(exitCode).toBe(1);
      expect(stderr.some((s) => s.includes('valid JSON'))).toBe(true);
      expect(callLLMCalls.length).toBe(0);
    });
  });
});