import { describe, it, expect, vi } from 'vitest';
import { LARGE_PR_THRESHOLD, DEFAULT_BATCH_SIZE } from '../../../src/constants.js';

function generateLargeDiff(fileCount: number): string {
  const parts: string[] = [];
  for (let i = 0; i < fileCount; i++) {
    parts.push(`diff --git a/src/file${i}.ts b/src/file${i}.ts
index abc${i}..def${i} 100644
--- a/src/file${i}.ts
+++ b/src/file${i}.ts
@@ -1,3 +1,5 @@
 export function fn${i}() {
-  return ${i};
+  const x = ${i};
+  return x;
 }
`);
  }
  return parts.join('\n');
}

interface TestState {
  stdin: string;
  exitError: Error | null;
  stdout: string[];
  stderr: string[];
  runPipelineBatchedCalls: number;
  runSecurityPipelineBatchedCalls: number;
  runPipelineCalls: number;
  runSecurityPipelineCalls: number;
}

const testState: TestState = {
  stdin: '',
  exitError: null,
  stdout: [],
  stderr: [],
  runPipelineBatchedCalls: 0,
  runSecurityPipelineBatchedCalls: 0,
  runPipelineCalls: 0,
  runSecurityPipelineCalls: 0,
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

vi.mock('../../../src/pipeline.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/pipeline.js')>();
  return {
    ...actual,
    runPipeline: vi.fn(async (...args: unknown[]) => {
      testState.runPipelineCalls++;
      return actual.runPipeline(...args as Parameters<typeof actual.runPipeline>);
    }),
    runSecurityPipeline: vi.fn(async (...args: unknown[]) => {
      testState.runSecurityPipelineCalls++;
      return actual.runSecurityPipeline(...args as Parameters<typeof actual.runSecurityPipeline>);
    }),
    runPipelineBatched: vi.fn(async (...args: unknown[]) => {
      testState.runPipelineBatchedCalls++;
      return actual.runPipelineBatched(...args as Parameters<typeof actual.runPipelineBatched>);
    }),
    runSecurityPipelineBatched: vi.fn(async (...args: unknown[]) => {
      testState.runSecurityPipelineBatchedCalls++;
      return actual.runSecurityPipelineBatched(...args as Parameters<typeof actual.runSecurityPipelineBatched>);
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
  testState.runPipelineBatchedCalls = 0;
  testState.runSecurityPipelineBatchedCalls = 0;
  testState.runPipelineCalls = 0;
  testState.runSecurityPipelineCalls = 0;

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

describe('大 PR 分批处理', () => {
  it(`大 PR（文件数 >= ${LARGE_PR_THRESHOLD}）触发分批处理`, async () => {
    const largeDiff = generateLargeDiff(LARGE_PR_THRESHOLD + 5);
    await loadCli({
      argv: ['review'],
      stdin: largeDiff,
    });

    expect(testState.runPipelineBatchedCalls).toBe(1);
    expect(testState.runPipelineCalls).toBe(0);
  });

  it(`小 PR（文件数 < ${LARGE_PR_THRESHOLD}）不触发分批处理`, async () => {
    const smallDiff = generateLargeDiff(Math.floor(LARGE_PR_THRESHOLD / 2));
    await loadCli({
      argv: ['review'],
      stdin: smallDiff,
    });

    expect(testState.runPipelineBatchedCalls).toBe(0);
    expect(testState.runPipelineCalls).toBe(1);
  });

  it(`security-review 大 PR（文件数 >= ${LARGE_PR_THRESHOLD}）触发分批处理`, async () => {
    const largeDiff = generateLargeDiff(LARGE_PR_THRESHOLD + 10);
    await loadCli({
      argv: ['security-review'],
      stdin: largeDiff,
    });

    expect(testState.runSecurityPipelineBatchedCalls).toBe(1);
    expect(testState.runSecurityPipelineCalls).toBe(0);
  });

  it(`security-review 小 PR（文件数 < ${LARGE_PR_THRESHOLD}）不触发分批处理`, async () => {
    const smallDiff = generateLargeDiff(Math.floor(LARGE_PR_THRESHOLD / 2));
    await loadCli({
      argv: ['security-review'],
      stdin: smallDiff,
    });

    expect(testState.runSecurityPipelineBatchedCalls).toBe(0);
    expect(testState.runSecurityPipelineCalls).toBe(1);
  });

  it('分批处理使用 LARGE_PR_THRESHOLD 作为阈值', async () => {
    const largeDiff = generateLargeDiff(LARGE_PR_THRESHOLD);
    await loadCli({
      argv: ['review'],
      stdin: largeDiff,
    });

    expect(testState.runPipelineBatchedCalls).toBe(1);
  });
});