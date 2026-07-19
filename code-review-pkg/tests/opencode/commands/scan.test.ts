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
 export default x;
`;

const DIFF_WITH_GENERATED_FILE = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,2 @@
-const x = 1;
+const x = 2;

diff --git a/src/api.generated.ts b/src/api.generated.ts
index def5678..ghi9012 100644
--- a/src/api.generated.ts
+++ b/src/api.generated.ts
@@ -1 +1 @@
-// @generated Do not edit
+// @generated Do not edit manually
`;

const DIFF_WITH_MULTI_LANG = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-const x = 1;
+const x = 2;

diff --git a/script.py b/script.py
index def5678..ghi9012 100644
--- a/script.py
+++ b/script.py
@@ -1 +1 @@
-x = 1
+x = 2

diff --git a/main.go b/main.go
index ghi9012..jkl3456 100644
--- a/main.go
+++ b/main.go
@@ -1 +1 @@
-var x = 1
+var x = 2
`;

const DIFF_WITH_MULTIPLE_FILES = `diff --git a/src/a.ts b/src/a.ts
index abc1234..def5678 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-const a = 1;
+const a = 2;

diff --git a/src/b.ts b/src/b.ts
index def5678..ghi9012 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1 @@
-const b = 1;
+const b = 2;

diff --git a/src/c.ts b/src/c.ts
index ghi9012..jkl3456 100644
--- a/src/c.ts
+++ b/src/c.ts
@@ -1 +1 @@
-const c = 1;
+const c = 2;

diff --git a/src/d.ts b/src/d.ts
index jkl3456..mno7890 100644
--- a/src/d.ts
+++ b/src/d.ts
@@ -1 +1 @@
-const d = 1;
+const d = 2;
`;

const DIFF_WITH_EXCLUDE_DIR = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-const x = 1;
+const x = 2;

diff --git a/vendor/library.ts b/vendor/library.ts
index def5678..ghi9012 100644
--- a/vendor/library.ts
+++ b/vendor/library.ts
@@ -1 +1 @@
-function foo() {}
+function foo() { return 1; }
`;

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

describe('scan 命令', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'scan-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('输出 scan prompt', async () => {
    const { stdout, exitCode } = await loadCli({
      argv: ['scan'],
      stdin: SAMPLE_DIFF,
    });

    expect(exitCode).toBeNull();
    expect(stdout.length).toBeGreaterThan(0);
    const prompt = stdout.join('\n');
    expect(prompt).toContain('Full Code Scan');
    expect(prompt).toContain('src/app.ts');
  });

  it('空 diff 也能处理', async () => {
    const { stdout } = await loadCli({
      argv: ['scan'],
      stdin: '',
    });

    expect(stdout.length).toBeGreaterThan(0);
  });

  describe('生成文件排除', () => {
    it('排除包含 @generated 标记的文件', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: ['scan'],
        stdin: DIFF_WITH_GENERATED_FILE,
      });

      expect(exitCode).toBeNull();
      const prompt = stdout.join('\n');
      expect(prompt).toContain('src/app.ts');
      expect(prompt).not.toContain('api.generated.ts');
    });
  });

  describe('语言识别', () => {
    it('识别 TypeScript 文件', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: ['scan', '--language', 'typescript'],
        stdin: DIFF_WITH_MULTI_LANG,
      });

      expect(exitCode).toBeNull();
      const prompt = stdout.join('\n');
      expect(prompt).toContain('src/app.ts');
      expect(prompt).not.toContain('script.py');
      expect(prompt).not.toContain('main.go');
    });

    it('识别 Python 文件', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: ['scan', '--language', 'python'],
        stdin: DIFF_WITH_MULTI_LANG,
      });

      expect(exitCode).toBeNull();
      const prompt = stdout.join('\n');
      expect(prompt).toContain('script.py');
      expect(prompt).not.toContain('src/app.ts');
      expect(prompt).not.toContain('main.go');
    });

    it('支持多种语言', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: ['scan', '--language', 'typescript', '--language', 'python'],
        stdin: DIFF_WITH_MULTI_LANG,
      });

      expect(exitCode).toBeNull();
      const prompt = stdout.join('\n');
      expect(prompt).toContain('src/app.ts');
      expect(prompt).toContain('script.py');
      expect(prompt).not.toContain('main.go');
    });
  });

  describe('--limit 参数', () => {
    it('限制输出文件数量', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: ['scan', '--limit', '2'],
        stdin: DIFF_WITH_MULTIPLE_FILES,
      });

      expect(exitCode).toBeNull();
      const prompt = stdout.join('\n');
      const fileListLines = prompt.split('\n').filter((l) => l.startsWith('- `'));
      expect(fileListLines.length).toBeLessThanOrEqual(2);
    });

    it('limit 为 0 时不限制', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: ['scan', '--limit', '0'],
        stdin: DIFF_WITH_MULTIPLE_FILES,
      });

      expect(exitCode).toBeNull();
      const prompt = stdout.join('\n');
      const fileListLines = prompt.split('\n').filter((l) => l.startsWith('- `'));
      expect(fileListLines.length).toBe(4);
    });
  });

  describe('--exclude 参数', () => {
    it('排除指定目录', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: ['scan', '--exclude', 'vendor/**'],
        stdin: DIFF_WITH_EXCLUDE_DIR,
      });

      expect(exitCode).toBeNull();
      const prompt = stdout.join('\n');
      expect(prompt).toContain('src/app.ts');
      expect(prompt).not.toContain('vendor/library.ts');
    });

    it('支持多个排除模式', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: ['scan', '--exclude', 'vendor/**', '--exclude', 'node_modules/**'],
        stdin: DIFF_WITH_EXCLUDE_DIR,
      });

      expect(exitCode).toBeNull();
      const prompt = stdout.join('\n');
      expect(prompt).toContain('src/app.ts');
    });
  });

  describe('with --execute flag', () => {
    const LLM_CONFIG_JSON = '{"provider":"openai","apiKey":"test","model":"gpt-4"}';

    it('calls LLM with code-reviewer agent and outputs JSON', async () => {
      const { stdout, exitCode, callLLMCalls } = await loadCli({
        argv: ['scan', '--execute', '--llm-config', LLM_CONFIG_JSON],
        stdin: SAMPLE_DIFF,
        llm: { response: '[]' },
      });

      expect(exitCode).toBeNull();
      expect(callLLMCalls.length).toBe(1);
      expect(typeof callLLMCalls[0].prompt).toBe('string');
      expect(callLLMCalls[0].prompt.length).toBeGreaterThan(0);
    });

    it('errors when --execute is provided but --llm-config is missing', async () => {
      const { stderr, exitCode, callLLMCalls } = await loadCli({
        argv: ['scan', '--execute'],
        stdin: SAMPLE_DIFF,
      });

      expect(exitCode).toBe(1);
      expect(stderr.some((s) => s.includes('LLM config required'))).toBe(true);
      expect(callLLMCalls.length).toBe(0);
    });
  });
});