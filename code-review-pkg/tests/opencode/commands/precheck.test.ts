import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseDiff } from '../../../src/diff-parser.js';
import {
  performPreCheck,
  isCommentLine,
  isOnlyCommentChange,
  isOnlyFormatChange,
  classifyDiff,
  type PreCheckResult,
} from '../../../src/precheck.js';
import type { FileDiff } from '../../../src/types.js';

// ── 测试 fixtures ──

const WHITESPACE_ONLY_DIFF = `diff --git a/src/a.ts b/src/a.ts
index aaa..bbb 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 const a = 1;
 
-  
+   
 const b = 2;
`;

const COMMENT_ONLY_DIFF = `diff --git a/src/a.ts b/src/a.ts
index aaa..bbb 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1;
-// old comment
+// new comment
+// another comment
 const b = 2;
`;

const FORMAT_ONLY_DIFF = `diff --git a/src/a.ts b/src/a.ts
index aaa..bbb 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
-const x=1;
+const x = 1;
-const y=2;
+const   y = 2;
`;

const SUBSTANTIVE_DIFF = `diff --git a/src/a.ts b/src/a.ts
index aaa..bbb 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
-const a = 1;
+const a = 2;
 const b = 2;
`;

const TWO_FILES_TRIVIAL_DIFF = `diff --git a/src/a.ts b/src/a.ts
index aaa..bbb 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
-// old
+// new

diff --git a/src/b.ts b/src/b.ts
index ccc..ddd 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,1 +1,1 @@
-  
+    
`;

const MIXED_DIFF = `diff --git a/src/trivial.ts b/src/trivial.ts
index aaa..bbb 100644
--- a/src/trivial.ts
+++ b/src/trivial.ts
@@ -1,1 +1,1 @@
-// old comment
+// new comment

diff --git a/src/real.ts b/src/real.ts
index ccc..ddd 100644
--- a/src/real.ts
+++ b/src/real.ts
@@ -1,1 +1,1 @@
-const a = 1;
+const a = 2;
`;

// ── 模块单元测试 ──

describe('precheck 模块', () => {
  describe('isCommentLine', () => {
    it('识别 // 单行注释', () => {
      expect(isCommentLine('// comment')).toBe(true);
      expect(isCommentLine('  // indented')).toBe(true);
    });

    it('识别 # 单行注释', () => {
      expect(isCommentLine('# python comment')).toBe(true);
      expect(isCommentLine('  # shell')).toBe(true);
    });

    it('识别 -- 单行注释', () => {
      expect(isCommentLine('-- SQL comment')).toBe(true);
    });

    it('识别 ; 单行注释', () => {
      expect(isCommentLine('; Lisp comment')).toBe(true);
    });

    it('识别 VB 单引号注释', () => {
      expect(isCommentLine("' VB comment")).toBe(true);
    });

    it('识别 /* 块注释起始', () => {
      expect(isCommentLine('/* block start */')).toBe(true);
      expect(isCommentLine('  /* indented block')).toBe(true);
    });

    it('识别 * 块注释续行', () => {
      expect(isCommentLine(' * continuation')).toBe(true);
    });

    it('识别 <!-- HTML 注释', () => {
      expect(isCommentLine('<!-- html comment -->')).toBe(true);
      expect(isCommentLine('  <!-- indented')).toBe(true);
    });

    it('识别 """ Python docstring', () => {
      expect(isCommentLine('"""docstring"""')).toBe(true);
      expect(isCommentLine("'''docstring'''")).toBe(true);
    });

    it('空行视为 trivial', () => {
      expect(isCommentLine('')).toBe(true);
      expect(isCommentLine('   ')).toBe(true);
      expect(isCommentLine('\t\t')).toBe(true);
    });

    it('代码行不被识别为注释', () => {
      expect(isCommentLine('const x = 1;')).toBe(false);
      expect(isCommentLine('function foo() {')).toBe(false);
      expect(isCommentLine('return result;')).toBe(false);
    });
  });

  describe('isOnlyCommentChange', () => {
    it('所有 add/delete 均为注释行时返回 true', () => {
      const diffs = parseDiff(COMMENT_ONLY_DIFF);
      expect(isOnlyCommentChange(diffs[0])).toBe(true);
    });

    it('存在非注释行时返回 false', () => {
      const diffs = parseDiff(SUBSTANTIVE_DIFF);
      expect(isOnlyCommentChange(diffs[0])).toBe(false);
    });

    it('无 hunk 时返回 false', () => {
      const empty: FileDiff = { path: 'a.ts', status: 'modified', hunks: [] };
      expect(isOnlyCommentChange(empty)).toBe(false);
    });
  });

  describe('isOnlyFormatChange', () => {
    it('配对的 add/delete 仅空白差异时返回 true', () => {
      const diffs = parseDiff(FORMAT_ONLY_DIFF);
      expect(isOnlyFormatChange(diffs[0])).toBe(true);
    });

    it('内容实质不同时返回 false', () => {
      const diffs = parseDiff(SUBSTANTIVE_DIFF);
      expect(isOnlyFormatChange(diffs[0])).toBe(false);
    });

    it('行数不等的纯空白变更返回 true', () => {
      const diffs = parseDiff(WHITESPACE_ONLY_DIFF);
      // 注意：这里仅空白，配对失败但全部空白，仍应视为 format
      expect(isOnlyFormatChange(diffs[0])).toBe(true);
    });

    it('无 hunk 时返回 false', () => {
      const empty: FileDiff = { path: 'a.ts', status: 'modified', hunks: [] };
      expect(isOnlyFormatChange(empty)).toBe(false);
    });
  });

  describe('classifyDiff', () => {
    it('纯空白变更归为 whitespace', () => {
      const diffs = parseDiff(WHITESPACE_ONLY_DIFF);
      expect(classifyDiff(diffs[0])).toBe('whitespace');
    });

    it('纯注释变更归为 comment', () => {
      const diffs = parseDiff(COMMENT_ONLY_DIFF);
      expect(classifyDiff(diffs[0])).toBe('comment');
    });

    it('纯格式变更归为 format', () => {
      const diffs = parseDiff(FORMAT_ONLY_DIFF);
      expect(classifyDiff(diffs[0])).toBe('format');
    });

    it('实质变更归为 substantive', () => {
      const diffs = parseDiff(SUBSTANTIVE_DIFF);
      expect(classifyDiff(diffs[0])).toBe('substantive');
    });

    it('无 hunk 归为 substantive', () => {
      const empty: FileDiff = { path: 'a.ts', status: 'modified', hunks: [] };
      expect(classifyDiff(empty)).toBe('substantive');
    });
  });

  describe('performPreCheck', () => {
    it('空 diff 数组时应跳过', () => {
      const result = performPreCheck([]);
      expect(result.shouldSkip).toBe(true);
      expect(result.reason).toBe('empty diff');
      expect(result.stats.filesChanged).toBe(0);
      expect(result.stats.modifiedLines).toBe(0);
      expect(result.stats.trivialFiles).toBe(0);
      expect(result.stats.nonTrivialFiles).toBe(0);
    });

    it('仅空白变更时跳过', () => {
      const diffs = parseDiff(WHITESPACE_ONLY_DIFF);
      const result = performPreCheck(diffs);
      expect(result.shouldSkip).toBe(true);
      expect(result.reason).toContain('trivial');
      expect(result.reason).toContain('whitespace-only');
      expect(result.stats.whitespaceOnlyFiles).toBe(1);
      expect(result.stats.trivialFiles).toBe(1);
      expect(result.stats.nonTrivialFiles).toBe(0);
    });

    it('仅注释变更时跳过', () => {
      const diffs = parseDiff(COMMENT_ONLY_DIFF);
      const result = performPreCheck(diffs);
      expect(result.shouldSkip).toBe(true);
      expect(result.reason).toContain('comment-only');
      expect(result.stats.commentOnlyFiles).toBe(1);
      expect(result.stats.trivialFiles).toBe(1);
    });

    it('仅格式变更时跳过', () => {
      const diffs = parseDiff(FORMAT_ONLY_DIFF);
      const result = performPreCheck(diffs);
      expect(result.shouldSkip).toBe(true);
      expect(result.reason).toContain('format-only');
      expect(result.stats.formatOnlyFiles).toBe(1);
      expect(result.stats.trivialFiles).toBe(1);
    });

    it('多文件均 trivial 时跳过，统计按类型计数', () => {
      const diffs = parseDiff(TWO_FILES_TRIVIAL_DIFF);
      const result = performPreCheck(diffs);
      expect(result.shouldSkip).toBe(true);
      expect(result.stats.filesChanged).toBe(2);
      // 一个是 comment-only，一个是 whitespace-only
      expect(result.stats.commentOnlyFiles + result.stats.whitespaceOnlyFiles).toBe(2);
      expect(result.stats.trivialFiles).toBe(2);
      expect(result.stats.nonTrivialFiles).toBe(0);
    });

    it('混合 trivial 和 substantive 时不跳过', () => {
      const diffs = parseDiff(MIXED_DIFF);
      const result = performPreCheck(diffs);
      expect(result.shouldSkip).toBe(false);
      expect(result.reason).toBe('');
      expect(result.stats.filesChanged).toBe(2);
      expect(result.stats.nonTrivialFiles).toBe(1);
      expect(result.stats.trivialFiles).toBe(1);
    });

    it('统计 insertions/deletions/modifiedLines 正确', () => {
      const diffs = parseDiff(SUBSTANTIVE_DIFF);
      const result = performPreCheck(diffs);
      // 单行删除 + 单行新增
      expect(result.stats.insertions).toBe(1);
      expect(result.stats.deletions).toBe(1);
      expect(result.stats.modifiedLines).toBe(2);
    });

    it('返回对象包含 stats 字段', () => {
      const result: PreCheckResult = performPreCheck([]);
      expect(result).toHaveProperty('shouldSkip');
      expect(result).toHaveProperty('reason');
      expect(result).toHaveProperty('stats');
      expect(result.stats).toHaveProperty('filesChanged');
      expect(result.stats).toHaveProperty('insertions');
      expect(result.stats).toHaveProperty('deletions');
      expect(result.stats).toHaveProperty('modifiedLines');
      expect(result.stats).toHaveProperty('whitespaceOnlyFiles');
      expect(result.stats).toHaveProperty('commentOnlyFiles');
      expect(result.stats).toHaveProperty('formatOnlyFiles');
      expect(result.stats).toHaveProperty('trivialFiles');
      expect(result.stats).toHaveProperty('nonTrivialFiles');
    });
  });
});

// ── CLI 集成测试：review 命令应跳过 trivial changes ──

interface TestState {
  stdin: string;
  exitError: Error | null;
  stdout: string[];
  stderr: string[];
  runPipelineCalls: number;
  runPipelineBatchedCalls: number;
}

const testState: TestState = {
  stdin: '',
  exitError: null,
  stdout: [],
  stderr: [],
  runPipelineCalls: 0,
  runPipelineBatchedCalls: 0,
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
    runPipelineBatched: vi.fn(async (...args: unknown[]) => {
      testState.runPipelineBatchedCalls++;
      return actual.runPipelineBatched(...args as Parameters<typeof actual.runPipelineBatched>);
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
  testState.runPipelineCalls = 0;
  testState.runPipelineBatchedCalls = 0;

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

describe('review 命令预检集成', () => {
  beforeEach(() => {
    testState.stdin = '';
    testState.stdout = [];
    testState.stderr = [];
    testState.runPipelineCalls = 0;
    testState.runPipelineBatchedCalls = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('trivial changes（仅空白）跳过 LLM 调用与 pipeline', async () => {
    const { stdout, stderr, exitCode } = await loadCli({
      argv: ['review'],
      stdin: WHITESPACE_ONLY_DIFF,
    });

    expect(exitCode).toBeNull();
    // pipeline 不应被调用
    expect(testState.runPipelineCalls).toBe(0);
    expect(testState.runPipelineBatchedCalls).toBe(0);
    // stderr 应包含 precheck 信息
    const errText = stderr.join('\n');
    expect(errText).toMatch(/precheck|trivial/i);
    // stdout 输出空 findings JSON
    const out = stdout.join('\n');
    expect(out).toBe('[]');
  });

  it('trivial changes（仅注释）跳过 LLM 调用', async () => {
    const { exitCode } = await loadCli({
      argv: ['review'],
      stdin: COMMENT_ONLY_DIFF,
    });

    expect(exitCode).toBeNull();
    expect(testState.runPipelineCalls).toBe(0);
    expect(testState.runPipelineBatchedCalls).toBe(0);
  });

  it('trivial changes（仅格式）跳过 LLM 调用', async () => {
    const { exitCode } = await loadCli({
      argv: ['review'],
      stdin: FORMAT_ONLY_DIFF,
    });

    expect(exitCode).toBeNull();
    expect(testState.runPipelineCalls).toBe(0);
    expect(testState.runPipelineBatchedCalls).toBe(0);
  });

  it('混合 trivial 与 substantive 不跳过，仍调用 pipeline', async () => {
    const { exitCode } = await loadCli({
      argv: ['review'],
      stdin: MIXED_DIFF,
    });

    expect(exitCode).toBeNull();
    // 混合时应调用 pipeline
    expect(testState.runPipelineCalls + testState.runPipelineBatchedCalls).toBeGreaterThanOrEqual(1);
  });

  it('纯 substantive 不跳过，调用 pipeline', async () => {
    const { exitCode } = await loadCli({
      argv: ['review'],
      stdin: SUBSTANTIVE_DIFF,
    });

    expect(exitCode).toBeNull();
    expect(testState.runPipelineCalls).toBe(1);
  });

  it('空 diff 输入也跳过 pipeline', async () => {
    const { exitCode } = await loadCli({
      argv: ['review'],
      stdin: '',
    });

    expect(exitCode).toBeNull();
    expect(testState.runPipelineCalls).toBe(0);
  });
});
