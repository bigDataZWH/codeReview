import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseDiff } from '../../../src/diff-parser.js';
import {
  computeFileDiffHash,
  loadLastReviewState,
  computeIncrementalDiff,
  serializeDiffsToDiffText,
  saveIncrementalState,
  mergeIncrementalFindings,
  DEFAULT_INCREMENTAL_STATE_FILE,
} from '../../../src/incremental-review.js';
import { StateStore } from '../../../src/state.js';
import type { Finding, FileDiff } from '../../../src/types.js';

// ── 测试用 diff（含两个文件，便于验证只审查变更文件） ──

const DIFF_TWO_FILES = `diff --git a/src/a.ts b/src/a.ts
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

const DIFF_ONE_FILE = `diff --git a/src/a.ts b/src/a.ts
index aaa..bbb 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
-const a = 1;
+const a = 2;
`;

function makeFinding(partial: Partial<Finding> = {}): Finding {
  return {
    file: 'src/a.ts',
    line: 1,
    severity: 'high',
    category: 'security',
    message: 'test finding',
    confidence: 0.9,
    source: 'rule',
    ...partial,
  };
}

// ── 模块函数单元测试（不经过 CLI） ──

describe('incremental-review 模块', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'incr-mod-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('computeFileDiffHash', () => {
    it('相同 FileDiff 产生相同哈希', () => {
      const diffs = parseDiff(DIFF_ONE_FILE);
      const h1 = computeFileDiffHash(diffs[0]);
      const h2 = computeFileDiffHash(diffs[0]);
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('内容不同产生不同哈希', () => {
      const diffs1 = parseDiff(DIFF_ONE_FILE);
      const diffs2 = parseDiff(
        DIFF_ONE_FILE.replace('const a = 2;', 'const a = 3;'),
      );
      const h1 = computeFileDiffHash(diffs1[0]);
      const h2 = computeFileDiffHash(diffs2[0]);
      expect(h1).not.toBe(h2);
    });

    it('路径不同产生不同哈希', () => {
      const diffs1 = parseDiff(DIFF_ONE_FILE);
      const diffs2 = parseDiff(
        DIFF_ONE_FILE.replace(/src\/a\.ts/g, 'src/c.ts'),
      );
      const h1 = computeFileDiffHash(diffs1[0]);
      const h2 = computeFileDiffHash(diffs2[0]);
      expect(h1).not.toBe(h2);
    });
  });

  describe('loadLastReviewState', () => {
    it('stateFile 不存在时返回空状态', () => {
      const result = loadLastReviewState({
        stateFile: join(tmpDir, 'never.json'),
      });
      expect(result.hasPreviousState).toBe(false);
      expect(result.lastReviewedAt).toBe(0);
      expect(result.fileHashes).toEqual({});
      expect(result.findings).toEqual([]);
    });

    it('从 stateFile 读取哈希和 findings', () => {
      const stateFile = join(tmpDir, 'state.json');
      const findings = [makeFinding({ file: 'src/a.ts', line: 5 })];
      const state = {
        version: 1 as const,
        lastReviewedAt: 1234567890,
        fileHashes: { 'src/a.ts': 'hash-a' },
        findings,
      };
      saveIncrementalState(stateFile, state);

      const result = loadLastReviewState({ stateFile });
      expect(result.hasPreviousState).toBe(true);
      expect(result.lastReviewedAt).toBe(1234567890);
      expect(result.fileHashes).toEqual({ 'src/a.ts': 'hash-a' });
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].file).toBe('src/a.ts');
    });

    it('损坏的 JSON 文件静默回退到空状态', () => {
      const stateFile = join(tmpDir, 'broken.json');
      writeFileSync(stateFile, 'not json {{{', 'utf8');
      const result = loadLastReviewState({ stateFile });
      expect(result.hasPreviousState).toBe(false);
      expect(result.findings).toEqual([]);
    });

    it('version 不匹配时回退到空状态', () => {
      const stateFile = join(tmpDir, 'wrong-version.json');
      writeFileSync(
        stateFile,
        JSON.stringify({ version: 99, fileHashes: {}, findings: [] }),
        'utf8',
      );
      const result = loadLastReviewState({ stateFile });
      expect(result.hasPreviousState).toBe(false);
    });

    it('从 StateStore + sessionId 读取 findings', () => {
      const store = new StateStore();
      store.createSession({ id: 'sess-1', filesTotal: 1 });
      store.updateSessionStatus('sess-1', 'running');
      store.saveFindings('sess-1', [makeFinding({ file: 'src/a.ts' })]);

      const result = loadLastReviewState({ store, sessionId: 'sess-1' });
      expect(result.hasPreviousState).toBe(true);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].file).toBe('src/a.ts');
      // StateStore 来源不提供文件哈希
      expect(result.fileHashes).toEqual({});
    });

    it('无任何来源时返回空状态', () => {
      const result = loadLastReviewState();
      expect(result.hasPreviousState).toBe(false);
      expect(result.findings).toEqual([]);
    });
  });

  describe('computeIncrementalDiff', () => {
    it('无历史状态时所有文件视为新增', () => {
      const diffs = parseDiff(DIFF_TWO_FILES);
      const result = computeIncrementalDiff(diffs, {
        lastReviewedAt: 0,
        fileHashes: {},
        findings: [],
        hasPreviousState: false,
      });
      expect(result.addedFiles.sort()).toEqual(['src/a.ts', 'src/b.ts']);
      expect(result.changedDiffs).toHaveLength(2);
      expect(result.unchangedFiles).toEqual([]);
      expect(result.removedFiles).toEqual([]);
    });

    it('哈希相同的文件归为 unchanged', () => {
      const diffs = parseDiff(DIFF_TWO_FILES);
      const hashA = computeFileDiffHash(diffs[0]);
      const hashB = computeFileDiffHash(diffs[1]);
      const result = computeIncrementalDiff(diffs, {
        lastReviewedAt: 1,
        fileHashes: { 'src/a.ts': hashA, 'src/b.ts': hashB },
        findings: [],
        hasPreviousState: true,
      });
      expect(result.changedDiffs).toEqual([]);
      expect(result.unchangedFiles.sort()).toEqual(['src/a.ts', 'src/b.ts']);
      expect(result.addedFiles).toEqual([]);
      expect(result.removedFiles).toEqual([]);
    });

    it('哈希不同的文件归为变更', () => {
      const diffs = parseDiff(DIFF_TWO_FILES);
      const hashA = computeFileDiffHash(diffs[0]);
      const result = computeIncrementalDiff(diffs, {
        lastReviewedAt: 1,
        fileHashes: { 'src/a.ts': hashA, 'src/b.ts': 'stale-hash' },
        findings: [],
        hasPreviousState: true,
      });
      expect(result.changedDiffs).toHaveLength(1);
      expect(result.changedDiffs[0].path).toBe('src/b.ts');
      expect(result.unchangedFiles).toEqual(['src/a.ts']);
      expect(result.addedFiles).toEqual([]);
    });

    it('旧状态有但当前 diff 无的文件归为 removed', () => {
      const diffs = parseDiff(DIFF_ONE_FILE);
      const hashA = computeFileDiffHash(diffs[0]);
      const result = computeIncrementalDiff(diffs, {
        lastReviewedAt: 1,
        fileHashes: { 'src/a.ts': hashA, 'src/deleted.ts': 'old-hash' },
        findings: [],
        hasPreviousState: true,
      });
      expect(result.removedFiles).toEqual(['src/deleted.ts']);
      expect(result.unchangedFiles).toEqual(['src/a.ts']);
    });

    it('currentHashes 包含所有当前文件的最新哈希', () => {
      const diffs = parseDiff(DIFF_TWO_FILES);
      const result = computeIncrementalDiff(diffs, {
        lastReviewedAt: 0,
        fileHashes: {},
        findings: [],
        hasPreviousState: false,
      });
      expect(Object.keys(result.currentHashes).sort()).toEqual([
        'src/a.ts',
        'src/b.ts',
      ]);
      expect(result.currentHashes['src/a.ts']).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('serializeDiffsToDiffText', () => {
    it('空数组返回空字符串', () => {
      expect(serializeDiffsToDiffText([])).toBe('');
    });

    it('序列化后能被 parseDiff 重新解析', () => {
      const diffs = parseDiff(DIFF_TWO_FILES);
      const text = serializeDiffsToDiffText(diffs);
      const reparsed = parseDiff(text);
      expect(reparsed).toHaveLength(2);
      expect(reparsed[0].path).toBe('src/a.ts');
      expect(reparsed[1].path).toBe('src/b.ts');
      // 行内容一致
      expect(reparsed[0].hunks[0].lines).toEqual(diffs[0].hunks[0].lines);
    });

    it('只序列化子集时只包含对应文件', () => {
      const diffs = parseDiff(DIFF_TWO_FILES);
      const text = serializeDiffsToDiffText([diffs[1]]);
      const reparsed = parseDiff(text);
      expect(reparsed).toHaveLength(1);
      expect(reparsed[0].path).toBe('src/b.ts');
    });
  });

  describe('mergeIncrementalFindings', () => {
    it('变更文件的旧 findings 被丢弃，未变更文件的旧 findings 保留', () => {
      const previous = [
        makeFinding({ file: 'src/a.ts', line: 1, message: 'old-a' }),
        makeFinding({ file: 'src/b.ts', line: 2, message: 'old-b' }),
        makeFinding({ file: 'src/c.ts', line: 3, message: 'old-c' }),
      ];
      const newFindings = [
        makeFinding({ file: 'src/b.ts', line: 99, message: 'new-b' }),
      ];
      const merged = mergeIncrementalFindings(previous, ['src/b.ts'], newFindings);
      // src/b.ts 旧 finding 被丢弃，src/a.ts 和 src/c.ts 保留
      expect(merged).toHaveLength(3);
      expect(merged.map((f) => f.file).sort()).toEqual([
        'src/a.ts',
        'src/b.ts',
        'src/c.ts',
      ]);
      const bFinding = merged.find((f) => f.file === 'src/b.ts');
      expect(bFinding?.message).toBe('new-b');
    });

    it('新增文件的旧 findings 不存在时正常追加新 findings', () => {
      const merged = mergeIncrementalFindings([], ['src/new.ts'], [
        makeFinding({ file: 'src/new.ts', line: 1 }),
      ]);
      expect(merged).toHaveLength(1);
    });
  });

  describe('saveIncrementalState', () => {
    it('写入文件并在父目录不存在时自动创建', () => {
      const nested = join(tmpDir, 'nested', 'sub', 'state.json');
      saveIncrementalState(nested, {
        version: 1,
        lastReviewedAt: 42,
        fileHashes: { 'x.ts': 'h' },
        findings: [],
      });
      expect(existsSync(nested)).toBe(true);
      const raw = JSON.parse(readFileSync(nested, 'utf8'));
      expect(raw.version).toBe(1);
      expect(raw.lastReviewedAt).toBe(42);
      expect(raw.fileHashes).toEqual({ 'x.ts': 'h' });
    });
  });

  describe('DEFAULT_INCREMENTAL_STATE_FILE', () => {
    it('默认状态文件名为 .code-review-incremental.json', () => {
      expect(DEFAULT_INCREMENTAL_STATE_FILE).toBe('.code-review-incremental.json');
    });
  });
});

// ── CLI 集成测试 ──

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

describe('review --incremental 命令', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'incr-cli-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('无历史状态时审查全部文件（视为新增）', async () => {
    const stateFile = join(tmpDir, 'state.json');
    const { stdout, exitCode } = await loadCli({
      argv: ['review', '--incremental', '--state-file', stateFile],
      stdin: DIFF_TWO_FILES,
    });

    expect(exitCode).toBeNull();
    const prompt = stdout.join('\n');
    // 两文件均视为变更，prompt 中应都出现
    expect(prompt).toContain('src/a.ts');
    expect(prompt).toContain('src/b.ts');
    // 状态文件被写入
    expect(existsSync(stateFile)).toBe(true);
  });

  it('仅审查变更文件，未变更文件不出现在 prompt 中', async () => {
    const stateFile = join(tmpDir, 'state.json');
    const diffs = parseDiff(DIFF_TWO_FILES);
    const hashA = computeFileDiffHash(diffs[0]); // src/a.ts 哈希
    // 写入旧状态：src/a.ts 哈希匹配（未变更），src/b.ts 哈希不匹配（变更）
    saveIncrementalState(stateFile, {
      version: 1,
      lastReviewedAt: 1,
      fileHashes: { 'src/a.ts': hashA, 'src/b.ts': 'stale-hash' },
      findings: [makeFinding({ file: 'src/a.ts', line: 1, message: 'old-a' })],
    });

    const { stdout, exitCode } = await loadCli({
      argv: ['review', '--incremental', '--state-file', stateFile],
      stdin: DIFF_TWO_FILES,
    });

    expect(exitCode).toBeNull();
    const prompt = stdout.join('\n');
    // src/b.ts 是变更文件，应该出现在 prompt 中
    expect(prompt).toContain('src/b.ts');
    // src/a.ts 是未变更文件，不应出现在文件列表中
    // 通过检查文件列表行 `- `src/a.ts`` 来判定
    expect(prompt).not.toMatch(/- `src\/a\.ts`/);
  });

  it('所有文件未变更时输出旧 findings 并跳过 LLM 调用', async () => {
    const stateFile = join(tmpDir, 'state.json');
    const diffs = parseDiff(DIFF_TWO_FILES);
    const hashA = computeFileDiffHash(diffs[0]);
    const hashB = computeFileDiffHash(diffs[1]);
    const oldFindings = [
      makeFinding({ file: 'src/a.ts', line: 1, message: 'old-a' }),
      makeFinding({ file: 'src/b.ts', line: 2, message: 'old-b' }),
    ];
    saveIncrementalState(stateFile, {
      version: 1,
      lastReviewedAt: 1,
      fileHashes: { 'src/a.ts': hashA, 'src/b.ts': hashB },
      findings: oldFindings,
    });

    const { stdout, callLLMCalls, exitCode } = await loadCli({
      argv: ['review', '--incremental', '--state-file', stateFile],
      stdin: DIFF_TWO_FILES,
    });

    expect(exitCode).toBeNull();
    // 没有 LLM 调用
    expect(callLLMCalls.length).toBe(0);
    // 输出旧 findings 的 JSON
    const output = stdout.join('\n');
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((f: Finding) => f.file).sort()).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
  });

  it('--execute 模式下合并旧 findings 与新 findings', async () => {
    const LLM_CONFIG_JSON = '{"provider":"openai","apiKey":"test","model":"gpt-4"}';
    const stateFile = join(tmpDir, 'state.json');
    const diffs = parseDiff(DIFF_TWO_FILES);
    const hashA = computeFileDiffHash(diffs[0]);
    // 旧状态：src/a.ts 未变更（带旧 finding），src/b.ts 变更
    saveIncrementalState(stateFile, {
      version: 1,
      lastReviewedAt: 1,
      fileHashes: { 'src/a.ts': hashA, 'src/b.ts': 'stale-hash' },
      findings: [
        makeFinding({ file: 'src/a.ts', line: 1, message: 'old-a' }),
      ],
    });

    // LLM 只对 src/b.ts 返回新 finding
    const newFindings = [
      makeFinding({ file: 'src/b.ts', line: 99, message: 'new-b', severity: 'low' }),
    ];

    const { stdout, callLLMCalls, exitCode } = await loadCli({
      argv: [
        'review',
        '--incremental',
        '--state-file',
        stateFile,
        '--execute',
        '--llm-config',
        LLM_CONFIG_JSON,
      ],
      stdin: DIFF_TWO_FILES,
      llm: { response: JSON.stringify(newFindings) },
    });

    expect(exitCode).toBeNull();
    // LLM 仅被调用一次（只审查变更文件）
    expect(callLLMCalls.length).toBe(1);
    // LLM 的 prompt 仅包含 src/b.ts
    expect(callLLMCalls[0].prompt).toContain('src/b.ts');
    expect(callLLMCalls[0].prompt).not.toMatch(/- `src\/a\.ts`/);

    // 输出合并后的 findings
    const output = stdout.join('\n');
    const parsed = JSON.parse(output) as Finding[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    // src/a.ts 旧 finding 保留
    const aFinding = parsed.find((f) => f.file === 'src/a.ts');
    expect(aFinding?.message).toBe('old-a');
    // src/b.ts 新 finding 追加
    const bFinding = parsed.find((f) => f.file === 'src/b.ts');
    expect(bFinding?.message).toBe('new-b');

    // 状态文件被更新，包含合并后的 findings
    const savedState = JSON.parse(readFileSync(stateFile, 'utf8'));
    expect(savedState.findings).toHaveLength(2);
    expect(savedState.fileHashes['src/a.ts']).toBe(hashA);
    // src/b.ts 的哈希被更新为当前值
    const currentHashB = computeFileDiffHash(diffs[1]);
    expect(savedState.fileHashes['src/b.ts']).toBe(currentHashB);
  });

  it('未指定 --state-file 时使用默认路径', async () => {
    // 在 tmpDir 中执行，验证默认文件名被使用
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const { stdout, exitCode } = await loadCli({
        argv: ['review', '--incremental'],
        stdin: DIFF_ONE_FILE,
      });

      expect(exitCode).toBeNull();
      const prompt = stdout.join('\n');
      expect(prompt).toContain('src/a.ts');
      // 默认状态文件被创建在 cwd
      const defaultPath = join(tmpDir, DEFAULT_INCREMENTAL_STATE_FILE);
      expect(existsSync(defaultPath)).toBe(true);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('增量审查后再次运行同一 diff 应跳过所有文件', async () => {
    const stateFile = join(tmpDir, 'state.json');

    // 第一次运行：建立状态
    await loadCli({
      argv: ['review', '--incremental', '--state-file', stateFile],
      stdin: DIFF_TWO_FILES,
    });
    expect(existsSync(stateFile)).toBe(true);

    // 第二次运行同一 diff：所有文件未变更
    const { stdout, callLLMCalls, exitCode } = await loadCli({
      argv: ['review', '--incremental', '--state-file', stateFile],
      stdin: DIFF_TWO_FILES,
    });

    expect(exitCode).toBeNull();
    expect(callLLMCalls.length).toBe(0);
    // 输出空 findings JSON
    const output = stdout.join('\n');
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(0);
  });

  it('增量审查提示信息显示在 stderr', async () => {
    const stateFile = join(tmpDir, 'state.json');
    const diffs = parseDiff(DIFF_TWO_FILES);
    const hashA = computeFileDiffHash(diffs[0]);
    saveIncrementalState(stateFile, {
      version: 1,
      lastReviewedAt: 1,
      fileHashes: { 'src/a.ts': hashA, 'src/b.ts': 'stale-hash' },
      findings: [],
    });

    const { stderr, exitCode } = await loadCli({
      argv: ['review', '--incremental', '--state-file', stateFile],
      stdin: DIFF_TWO_FILES,
    });

    expect(exitCode).toBeNull();
    const errText = stderr.join('\n');
    expect(errText).toContain('[incremental]');
    expect(errText).toMatch(/1 changed file/);
    expect(errText).toMatch(/1 unchanged/);
  });

  it('不传 --incremental 时走原始 review 流程（不影响向后兼容）', async () => {
    const { stdout, exitCode } = await loadCli({
      argv: ['review'],
      stdin: DIFF_TWO_FILES,
    });

    expect(exitCode).toBeNull();
    const prompt = stdout.join('\n');
    expect(prompt).toContain('src/a.ts');
    expect(prompt).toContain('src/b.ts');
  });
});
