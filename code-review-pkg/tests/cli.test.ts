import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── 测试用 diff 文本 ──

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

const EMPTY_DIFF = '';

// ── 通过 vi.mock 拦截 node:fs 的 readFileSync ──
// 我们用一个全局变量保存当前测试用例的 stdin 内容和 process.exit 触发的错误
// 这样可以在 mock 内部动态返回不同值

interface TestState {
  stdin: string;
  exitError: Error | null;
  stdout: string[];
  stderr: string[];
  // init 命令状态
  initMode: boolean;
  readlineAnswers: string[];
  readlineError: Error | null;
  writeFilesError: Error | null;
  existingFiles: Set<string>;
  generateConfigCalls: unknown[][];
  initWriteCalls: Array<{ path: string; content: string }>;
  // --execute 模式状态
  callLLMCalls: Array<{ prompt: string; config: unknown }>;
  llmResponse: string | null;
  llmError: Error | null;
}

const testState: TestState = {
  stdin: '',
  exitError: null,
  stdout: [],
  stderr: [],
  initMode: false,
  readlineAnswers: [],
  readlineError: null,
  writeFilesError: null,
  existingFiles: new Set(),
  generateConfigCalls: [],
  initWriteCalls: [],
  callLLMCalls: [],
  llmResponse: null,
  llmError: null,
};

// 必须 hoist 的 mock：拦截 node:fs
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn((...args: unknown[]) => {
      const fd = args[0];
      if (fd === 0 || fd === '0') {
        return testState.stdin;
      }
      // 其他路径走真实实现
      return (actual.readFileSync as (...a: unknown[]) => unknown)(...args);
    }),
    // init 命令相关：仅在 initMode 时拦截，避免影响其他测试
    writeFileSync: vi.fn((...args: unknown[]) => {
      if (testState.initMode) {
        if (testState.writeFilesError) throw testState.writeFilesError;
        testState.initWriteCalls.push({
          path: String(args[0]),
          content: String(args[1]),
        });
        return undefined;
      }
      return (actual.writeFileSync as (...a: unknown[]) => unknown)(...args);
    }),
    mkdirSync: vi.fn((...args: unknown[]) => {
      if (testState.initMode) return undefined;
      return (actual.mkdirSync as (...a: unknown[]) => unknown)(...args);
    }),
    existsSync: vi.fn((...args: unknown[]) => {
      if (testState.initMode) {
        return testState.existingFiles.has(String(args[0]));
      }
      return (actual.existsSync as (...a: unknown[]) => unknown)(...args);
    }),
  };
});

// 拦截 node:readline/promises，模拟用户交互输入
vi.mock('node:readline/promises', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn(async (_prompt: string) => {
      if (testState.readlineError) throw testState.readlineError;
      return testState.readlineAnswers.shift() ?? '';
    }),
    close: vi.fn(),
  })),
}));

// 拦截 init-wizard.js 的 generateConfig，记录调用参数（仍走真实实现）
vi.mock('../src/init-wizard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/init-wizard.js')>();
  return {
    ...actual,
    generateConfig: vi.fn((...args: unknown[]) => {
      testState.generateConfigCalls.push(args);
      return actual.generateConfig(...(args as Parameters<typeof actual.generateConfig>));
    }),
  };
});

// 拦截 ai-reflection.js 的 callLLM，记录调用并返回 mock 响应
vi.mock('../src/ai-reflection.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ai-reflection.js')>();
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

// 重置模块缓存，确保 cli.ts 顶级代码每次重新执行
async function loadCli(opts: {
  argv: string[];
  stdin?: string;
  env?: Record<string, string | undefined>;
  init?: {
    answers?: string[];
    readlineError?: Error | null;
    writeFilesError?: Error | null;
    existingFiles?: string[];
  };
  llm?: {
    response?: string | null;
    error?: Error | null;
  };
}): Promise<{
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
  generateConfigCalls: unknown[][];
  writeCalls: Array<{ path: string; content: string }>;
  callLLMCalls: Array<{ prompt: string; config: unknown }>;
}> {
  const { argv, stdin = '', env = {}, init, llm } = opts;

  // 重置测试状态
  testState.stdin = stdin;
  testState.exitError = null;
  testState.stdout = [];
  testState.stderr = [];

  // init 命令状态
  testState.initMode = !!init;
  testState.readlineAnswers = init?.answers ? [...init.answers] : [];
  testState.readlineError = init?.readlineError ?? null;
  testState.writeFilesError = init?.writeFilesError ?? null;
  testState.existingFiles = new Set(init?.existingFiles ?? []);
  testState.generateConfigCalls = [];
  testState.initWriteCalls = [];

  // --execute 模式状态
  testState.callLLMCalls = [];
  testState.llmResponse = llm?.response ?? null;
  testState.llmError = llm?.error ?? null;

  // 保存原始状态
  const origArgv = process.argv;
  const origEnv = { ...process.env };

  // 覆盖 process.argv: ['node', 'cli.js', ...args]
  process.argv = ['node', '/tmp/cli.js', ...argv];

  // 覆盖环境变量
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }

  // 收集 console 输出
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    testState.stdout.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    testState.stderr.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });

  // mock process.exit（不真正退出，抛出错误以中断 cli.ts 后续执行）
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    const err = new Error(`__PROCESS_EXIT_${code ?? 0}__`);
    testState.exitError = err;
    throw err;
  }) as never);

  // 重置模块缓存，确保 cli.ts 顶级代码重新执行
  vi.resetModules();

  try {
    await import('../src/cli.js');
    return {
      stdout: [...testState.stdout],
      stderr: [...testState.stderr],
      exitCode: null,
      generateConfigCalls: [...testState.generateConfigCalls],
      writeCalls: [...testState.initWriteCalls],
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
        generateConfigCalls: [...testState.generateConfigCalls],
        writeCalls: [...testState.initWriteCalls],
        callLLMCalls: [...testState.callLLMCalls],
      };
    }
    throw err;
  } finally {
    // 恢复
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    process.argv = origArgv;
    // 恢复环境变量
    for (const k of Object.keys(env)) {
      const origVal = origEnv[k];
      if (origVal === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = origVal;
      }
    }
    vi.resetModules();
  }
}

// ── 测试 ──

describe('CLI', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cli-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ==================== parse 命令 ====================
  describe('parse 命令', () => {
    it('从 stdin 读取 diff 并输出 JSON', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: ['parse'],
        stdin: SAMPLE_DIFF,
      });

      expect(exitCode).toBeNull();
      expect(stdout.length).toBeGreaterThan(0);

      const parsed = JSON.parse(stdout.join('\n'));
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
      expect(parsed[0].path).toBe('src/app.ts');
      expect(parsed[0].hunks.length).toBeGreaterThan(0);
    });

    it('空 diff 输出空数组', async () => {
      const { stdout } = await loadCli({
        argv: ['parse'],
        stdin: EMPTY_DIFF,
      });

      const parsed = JSON.parse(stdout.join('\n'));
      expect(parsed).toEqual([]);
    });

    it('多文件 diff 正确解析', async () => {
      const multiDiff = `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
-a
+b
+c
diff --git a/b.ts b/b.ts
index 3..4 100644
--- a/b.ts
+++ b/b.ts
@@ -1,1 +1,1 @@
-x
+y
`;
      const { stdout } = await loadCli({
        argv: ['parse'],
        stdin: multiDiff,
      });

      const parsed = JSON.parse(stdout.join('\n'));
      expect(parsed.length).toBe(2);
      expect(parsed[0].path).toBe('a.ts');
      expect(parsed[1].path).toBe('b.ts');
    });
  });

  // ==================== review 命令 ====================
  describe('review 命令', () => {
    it('输出 review prompt', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: ['review'],
        stdin: SAMPLE_DIFF,
      });

      expect(exitCode).toBeNull();
      expect(stdout.length).toBeGreaterThan(0);
      const prompt = stdout.join('\n');
      expect(prompt).toContain('Code Review');
      expect(prompt).toContain('src/app.ts');
    });

    it('空 diff 也能处理', async () => {
      const { stdout } = await loadCli({
        argv: ['review'],
        stdin: EMPTY_DIFF,
      });

      expect(stdout.length).toBeGreaterThan(0);
    });
  });

  // ==================== security-review 命令 ====================
  describe('security-review 命令', () => {
    it('输出 security review prompt', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: ['security-review'],
        stdin: SAMPLE_DIFF,
      });

      expect(exitCode).toBeNull();
      expect(stdout.length).toBeGreaterThan(0);
      const prompt = stdout.join('\n');
      expect(prompt.toLowerCase()).toContain('security');
    });
  });

  // ==================== scan 命令 ====================
  describe('scan 命令', () => {
    it('输出 scan prompt', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: ['scan'],
        stdin: SAMPLE_DIFF,
      });

      expect(exitCode).toBeNull();
      expect(stdout.length).toBeGreaterThan(0);
      const prompt = stdout.join('\n');
      expect(prompt).toContain('Scan');
      expect(prompt).toContain('src/app.ts');
    });
  });

  // ==================== impact 命令 ====================
  describe('impact 命令', () => {
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
  });

  // ==================== review 命令 with --execute ====================
  describe('review command with --execute flag', () => {
    const LLM_CONFIG_JSON = '{"provider":"openai","apiKey":"test","model":"gpt-4"}';
    const MOCK_FINDINGS = [
      {
        file: 'src/app.ts',
        line: 3,
        severity: 'high',
        category: 'style',
        message: 'Avoid console.log in production code',
        confidence: 0.9,
        source: 'ai',
      },
    ];

    it('calls LLM and outputs findings JSON when --execute is provided', async () => {
      const { stdout, exitCode, callLLMCalls } = await loadCli({
        argv: ['review', '--execute', '--llm-config', LLM_CONFIG_JSON],
        stdin: SAMPLE_DIFF,
        llm: { response: JSON.stringify(MOCK_FINDINGS) },
      });

      expect(exitCode).toBeNull();
      // callLLM 被调用一次
      expect(callLLMCalls.length).toBe(1);
      // 第二个参数是 LLMProviderConfig
      expect(callLLMCalls[0].config).toEqual({
        provider: 'openai',
        apiKey: 'test',
        model: 'gpt-4',
      });
      // 第一个参数是 prompt（非空字符串，包含 diff 信息）
      expect(typeof callLLMCalls[0].prompt).toBe('string');
      expect(callLLMCalls[0].prompt.length).toBeGreaterThan(0);
      expect(callLLMCalls[0].prompt).toContain('src/app.ts');

      // 输出可以 JSON.parse，且包含 findings
      const output = stdout.join('\n');
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
      expect(parsed[0].file).toBe('src/app.ts');
      expect(parsed[0].severity).toBe('high');
    });

    it('outputs prompt only when --execute is NOT provided (backward compat)', async () => {
      const { stdout, exitCode, callLLMCalls } = await loadCli({
        argv: ['review'],
        stdin: SAMPLE_DIFF,
        llm: { response: JSON.stringify(MOCK_FINDINGS) },
      });

      expect(exitCode).toBeNull();
      // callLLM 未被调用
      expect(callLLMCalls.length).toBe(0);
      // 输出包含 prompt 文本，不是 JSON 数组
      const prompt = stdout.join('\n');
      expect(prompt).toContain('Code Review');
      expect(prompt).toContain('src/app.ts');
      // 不应该是合法的 JSON 数组（prompt 是文本）
      expect(() => JSON.parse(prompt)).toThrow();
    });

    it('errors when --execute is provided but --llm-config is missing', async () => {
      const { stderr, exitCode, callLLMCalls } = await loadCli({
        argv: ['review', '--execute'],
        stdin: SAMPLE_DIFF,
      });

      expect(exitCode).toBe(1);
      expect(stderr.some((s) => s.includes('LLM config required'))).toBe(true);
      // callLLM 未被调用
      expect(callLLMCalls.length).toBe(0);
    });

    it('handles LLM call failure gracefully', async () => {
      const { stderr, exitCode, callLLMCalls } = await loadCli({
        argv: ['review', '--execute', '--llm-config', LLM_CONFIG_JSON],
        stdin: SAMPLE_DIFF,
        llm: { error: new Error('LLM API error: 503 Service Unavailable') },
      });

      expect(exitCode).toBe(1);
      // callLLM 被调用但抛出错误
      expect(callLLMCalls.length).toBe(1);
      expect(stderr.some((s) => s.includes('LLM call failed'))).toBe(true);
      expect(stderr.some((s) => s.includes('503 Service Unavailable'))).toBe(true);
    });

    it('errors when --llm-config is invalid JSON', async () => {
      const { stderr, exitCode, callLLMCalls } = await loadCli({
        argv: ['review', '--execute', '--llm-config', '{not valid json'],
        stdin: SAMPLE_DIFF,
      });

      expect(exitCode).toBe(1);
      expect(stderr.some((s) => s.includes('valid JSON'))).toBe(true);
      // callLLM 未被调用
      expect(callLLMCalls.length).toBe(0);
    });
  });

  // ==================== publish 命令 ====================
  describe('publish 命令', () => {
    it('缺少必要参数时输出 usage 并退出 1', async () => {
      const { stderr, exitCode } = await loadCli({
        argv: ['publish', '--owner', 'o'],
        stdin: '',
      });

      expect(exitCode).toBe(1);
      expect(stderr.some((s) => s.includes('Usage'))).toBe(true);
    });

    it('缺少 token 时输出错误并退出 1', async () => {
      const { stderr, exitCode } = await loadCli({
        argv: [
          'publish',
          '--owner', 'o',
          '--repo', 'r',
          '--pr', '1',
          '--file', '/tmp/nonexistent.json',
        ],
        stdin: '',
        env: { GITHUB_TOKEN: undefined },
      });

      expect(exitCode).toBe(1);
      expect(stderr.some((s) => s.includes('token') || s.includes('GITHUB_TOKEN'))).toBe(true);
    });

    it('使用 GITHUB_TOKEN 环境变量并通过文件读取 findings', async () => {
      // 准备 findings 文件
      const findingsFile = join(tmpDir, 'findings.json');
      const findings = [
        {
          file: 'src/app.ts',
          line: 1,
          severity: 'medium',
          category: 'style',
          message: 'test',
          confidence: 0.7,
          source: 'rule',
        },
      ];
      writeFileSync(findingsFile, JSON.stringify(findings));

      // mock fetch 避免真实调用 GitHub
      const fetchOrig = globalThis.fetch;
      globalThis.fetch = (async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('/pulls/1/comments') && !urlStr.includes('/issues/')) {
          return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (urlStr.includes('/issues/1/comments')) {
          return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (urlStr.endsWith('/comments') && !urlStr.includes('/issues/')) {
          return new Response('{"id":99}', { status: 201, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('{"id":100}', { status: 201, headers: { 'Content-Type': 'application/json' } });
      }) as typeof fetch;

      try {
        const { stdout, exitCode } = await loadCli({
          argv: [
            'publish',
            '--owner', 'owner',
            '--repo', 'repo',
            '--pr', '1',
            '--file', findingsFile,
            '--mode', 'replace',
          ],
          stdin: '',
          env: { GITHUB_TOKEN: 'ghp_test_token' },
        });

        expect(exitCode).toBeNull();
        expect(stdout.some((s) => s.includes('Published'))).toBe(true);
      } finally {
        globalThis.fetch = fetchOrig;
      }
    });

    it('使用 --token 显式参数', async () => {
      const findingsFile = join(tmpDir, 'findings.json');
      writeFileSync(findingsFile, JSON.stringify([]));

      const fetchOrig = globalThis.fetch;
      globalThis.fetch = (async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('/pulls/2/comments') && !urlStr.includes('/issues/')) {
          return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (urlStr.includes('/issues/2/comments')) {
          return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as typeof fetch;

      try {
        const { stdout, exitCode } = await loadCli({
          argv: [
            'publish',
            '--owner', 'owner',
            '--repo', 'repo',
            '--pr', '2',
            '--file', findingsFile,
            '--token', 'ghp_explicit_token',
          ],
          stdin: '',
        });

        expect(exitCode).toBeNull();
        expect(stdout.some((s) => s.includes('Published'))).toBe(true);
      } finally {
        globalThis.fetch = fetchOrig;
      }
    });

    it('--mode incremental 模式可正常调用', async () => {
      const findingsFile = join(tmpDir, 'findings.json');
      writeFileSync(
        findingsFile,
        JSON.stringify([
          {
            file: 'src/app.ts',
            line: 1,
            severity: 'high',
            category: 'security',
            message: 'sql injection',
            confidence: 0.9,
            source: 'rule',
          },
        ]),
      );

      const fetchOrig = globalThis.fetch;
      globalThis.fetch = (async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('/pulls/3/comments') && !urlStr.includes('/issues/')) {
          return new Response(
            JSON.stringify([
              { id: 1, path: 'src/app.ts', line: 1, body: 'old sql injection issue' },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (urlStr.includes('/issues/3/comments')) {
          return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('{"id":200}', { status: 201, headers: { 'Content-Type': 'application/json' } });
      }) as typeof fetch;

      try {
        const { exitCode } = await loadCli({
          argv: [
            'publish',
            '--owner', 'owner',
            '--repo', 'repo',
            '--pr', '3',
            '--file', findingsFile,
            '--token', 'ghp_token',
            '--mode', 'incremental',
          ],
          stdin: '',
        });

        expect(exitCode).toBeNull();
      } finally {
        globalThis.fetch = fetchOrig;
      }
    });
  });

  // ==================== 帮助 / 默认分支 ====================
  describe('无命令参数时显示帮助', () => {
    it('无参数输出 usage 信息', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: [],
        stdin: '',
      });

      expect(exitCode).toBeNull();
      expect(stdout.length).toBeGreaterThan(0);
      const help = stdout.join('\n');
      expect(help).toContain('code-review');
      expect(help).toContain('Usage');
      expect(help).toContain('parse');
      expect(help).toContain('review');
      expect(help).toContain('security-review');
      expect(help).toContain('scan');
      expect(help).toContain('impact');
      expect(help).toContain('publish');
    });

    it('未知命令输出帮助', async () => {
      const { stdout } = await loadCli({
        argv: ['unknown-command'],
        stdin: '',
      });

      const help = stdout.join('\n');
      expect(help).toContain('code-review');
      expect(help).toContain('Usage');
    });
  });

  // ==================== init 命令 ====================
  describe('init 命令', () => {
    it('用户完成向导后生成配置文件并写盘', async () => {
      // 模拟用户依次输入：1.typescript / 2.standard / y.启用安全 / 2.github-actions
      const { stdout, exitCode, generateConfigCalls, writeCalls } = await loadCli({
        argv: ['init'],
        init: {
          answers: ['1', '2', 'y', '2'],
        },
      });

      expect(exitCode).toBeNull();

      // generateConfig 被调用一次，参数包含用户选择
      expect(generateConfigCalls.length).toBe(1);
      expect(generateConfigCalls[0][0]).toEqual({
        language: 'typescript',
        reviewStrength: 'standard',
        securityReview: true,
        deployment: 'github-actions',
      });

      // opencode.jsonc 被写入
      const openCodeWrite = writeCalls.find((c) => c.path.endsWith('opencode.jsonc'));
      expect(openCodeWrite).toBeDefined();
      // github-actions 部署应生成 workflow 文件
      const workflowWrite = writeCalls.find((c) => c.path.includes('code-review.yml'));
      expect(workflowWrite).toBeDefined();

      // 控制台输出 success message
      const out = stdout.join('\n');
      expect(out).toContain('初始化完成');
      expect(out).toContain('opencode.jsonc');
    });

    it('用户取消（Ctrl+C 模拟 readline 抛错）时退出码 1', async () => {
      const { stderr, exitCode, generateConfigCalls } = await loadCli({
        argv: ['init'],
        init: {
          answers: [],
          readlineError: new Error('SIGINT'),
        },
      });

      expect(exitCode).toBe(1);
      // 向导被中断，generateConfig 不应被调用
      expect(generateConfigCalls.length).toBe(0);
      expect(stderr.some((s) => s.includes('初始化失败'))).toBe(true);
    });

    it('writeFile 抛错时被捕获并退出码 1', async () => {
      const { stderr, exitCode, generateConfigCalls } = await loadCli({
        argv: ['init'],
        init: {
          answers: ['1', '2', 'y', '1'],
          writeFilesError: new Error('EACCES: permission denied'),
        },
      });

      // 向导已完成，generateConfig 已被调用
      expect(generateConfigCalls.length).toBe(1);
      expect(generateConfigCalls[0][0]).toMatchObject({
        language: 'typescript',
        reviewStrength: 'standard',
        securityReview: true,
        deployment: 'cli',
      });
      // 写盘失败被捕获，退出码 1
      expect(exitCode).toBe(1);
      expect(stderr.some((s) => s.includes('初始化失败'))).toBe(true);
      expect(stderr.some((s) => s.includes('EACCES'))).toBe(true);
    });
  });
});
