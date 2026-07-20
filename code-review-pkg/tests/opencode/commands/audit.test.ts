import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AuditLogger,
  logAction,
  getAuditLog,
  readAuditLogFile,
  DEFAULT_AUDIT_LOG_FILE,
  DEFAULT_AUDIT_HISTORY_LIMIT,
} from '../../../src/audit-logger.js';
import type { AuditLogEntry, AuditQueryOptions, AuditResult } from '../../../src/audit-logger.js';
import type { Finding } from '../../../src/types.js';

function makeFinding(partial: Partial<Finding> = {}): Finding {
  return {
    file: 'src/app.ts',
    line: 10,
    severity: 'high',
    category: 'security',
    message: 'SQL injection',
    confidence: 0.9,
    source: 'rule',
    ...partial,
  };
}

// ---- CLI 测试辅助 ----

interface TestState {
  exitError: Error | null;
  stdout: string[];
  stderr: string[];
}

const testState: TestState = {
  exitError: null,
  stdout: [],
  stderr: [],
};

async function loadCli(opts: {
  argv: string[];
  env?: Record<string, string>;
}): Promise<{
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}> {
  const { argv, env = {} } = opts;

  testState.exitError = null;
  testState.stdout = [];
  testState.stderr = [];

  const origArgv = process.argv;
  process.argv = ['node', '/tmp/cli.js', ...argv];

  const origEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    origEnv[k] = process.env[k];
    process.env[k] = v;
  }

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
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    vi.resetModules();
  }
}

// ==================== 常量 ====================

describe('审计日志常量', () => {
  it('DEFAULT_AUDIT_LOG_FILE 默认文件名', () => {
    expect(DEFAULT_AUDIT_LOG_FILE).toBe('.code-review-audit.log');
  });

  it('DEFAULT_AUDIT_HISTORY_LIMIT 默认 1000', () => {
    expect(DEFAULT_AUDIT_HISTORY_LIMIT).toBe(1000);
  });
});

// ==================== AuditLogger 类 ====================

describe('AuditLogger', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    logger = new AuditLogger();
  });

  describe('构造器', () => {
    it('默认空实例', () => {
      expect(logger.size()).toBe(0);
    });

    it('支持 initialEntries 初始化', () => {
      const now = Date.now();
      const entries: AuditLogEntry[] = [
        {
          id: 'a1',
          timestamp: now - 1000,
          user: 'alice',
          action: 'review',
          args: [],
          result: 'success',
        },
        {
          id: 'a2',
          timestamp: now,
          user: 'bob',
          action: 'scan',
          args: [],
          result: 'success',
        },
      ];
      const l = new AuditLogger({ initialEntries: entries });
      expect(l.size()).toBe(2);
      // 倒序：最新在前
      expect(l.getAll()[0].id).toBe('a2');
    });

    it('historyLimit 截断 initialEntries', () => {
      const entries: AuditLogEntry[] = [];
      for (let i = 0; i < 10; i++) {
        entries.push({
          id: `a${i}`,
          timestamp: i,
          user: 'u',
          action: 'review',
          args: [],
          result: 'success',
        });
      }
      const l = new AuditLogger({ initialEntries: entries, historyLimit: 5 });
      expect(l.size()).toBe(5);
    });
  });

  describe('logAction', () => {
    it('记录基本字段', () => {
      const entry = logger.logAction({
        user: 'alice',
        action: 'review',
        args: ['--incremental'],
        result: 'success',
      });
      expect(entry.id).toBeTruthy();
      expect(entry.timestamp).toBeGreaterThan(0);
      expect(entry.user).toBe('alice');
      expect(entry.action).toBe('review');
      expect(entry.args).toEqual(['--incremental']);
      expect(entry.result).toBe('success');
    });

    it('未指定 user 时默认 anonymous', () => {
      const entry = logger.logAction({
        action: 'review',
        args: [],
        result: 'success',
      });
      expect(entry.user).toBe('anonymous');
    });

    it('自动生成 id 与 timestamp', () => {
      const before = Date.now();
      const entry = logger.logAction({
        action: 'review',
        args: [],
        result: 'success',
      });
      expect(entry.id).toMatch(/^audit-/);
      expect(entry.timestamp).toBeGreaterThanOrEqual(before);
    });

    it('自动填充 findingsCount', () => {
      const findings = [makeFinding(), makeFinding({ line: 20 })];
      const entry = logger.logAction({
        action: 'review',
        args: [],
        result: 'success',
        findings,
      });
      expect(entry.findingsCount).toBe(2);
    });

    it('显式 findingsCount 优先于 findings.length', () => {
      const entry = logger.logAction({
        action: 'review',
        args: [],
        result: 'success',
        findings: [makeFinding()],
        findingsCount: 99,
      });
      expect(entry.findingsCount).toBe(99);
    });

    it('未提供 findings 时 findingsCount 为 undefined', () => {
      const entry = logger.logAction({
        action: 'review',
        args: [],
        result: 'success',
      });
      expect(entry.findings).toBeUndefined();
      expect(entry.findingsCount).toBeUndefined();
    });

    it('记录 durationMs 与 error 字段', () => {
      const entry = logger.logAction({
        action: 'review',
        args: [],
        result: 'failure',
        durationMs: 1234,
        error: 'connection refused',
      });
      expect(entry.durationMs).toBe(1234);
      expect(entry.error).toBe('connection refused');
      expect(entry.result).toBe('failure');
    });

    it('记录 metadata 字段', () => {
      const entry = logger.logAction({
        action: 'rules',
        args: ['disable', 'SEC001'],
        result: 'success',
        metadata: { ruleId: 'SEC001', before: 'enabled', after: 'disabled' },
      });
      expect(entry.metadata).toEqual({ ruleId: 'SEC001', before: 'enabled', after: 'disabled' });
    });

    it('记录 denied 结果', () => {
      const entry = logger.logAction({
        action: 'rules',
        args: ['disable', 'SEC001'],
        result: 'denied',
        error: 'permission denied',
        metadata: { user: 'carol', role: 'viewer', requiredPermission: 'rules:disable' },
      });
      expect(entry.result).toBe('denied');
      expect(entry.metadata?.role).toBe('viewer');
    });

    it('新日志插入到内存头部（最新在前）', () => {
      logger.logAction({ action: 'first', args: [], result: 'success' });
      logger.logAction({ action: 'second', args: [], result: 'success' });
      logger.logAction({ action: 'third', args: [], result: 'success' });
      const all = logger.getAll();
      expect(all[0].action).toBe('third');
      expect(all[1].action).toBe('second');
      expect(all[2].action).toBe('first');
    });

    it('返回的条目是副本（修改不影响内部）', () => {
      const entry = logger.logAction({ action: 'review', args: [], result: 'success' });
      entry.action = 'modified';
      expect(logger.getAll()[0].action).toBe('review');
    });
  });

  describe('query', () => {
    beforeEach(() => {
      const base = Date.now();
      logger.logAction({ user: 'alice', action: 'review', args: [], result: 'success', timestamp: base - 3000 });
      logger.logAction({ user: 'alice', action: 'scan', args: [], result: 'success', timestamp: base - 2000 });
      logger.logAction({ user: 'bob', action: 'review', args: [], result: 'failure', timestamp: base - 1000, error: 'oom' });
      logger.logAction({ user: 'carol', action: 'rules disable', args: ['SEC001'], result: 'denied', timestamp: base });
    });

    it('按 user 过滤', () => {
      const result = logger.query({ user: 'alice' });
      expect(result).toHaveLength(2);
      expect(result.every((e) => e.user === 'alice')).toBe(true);
    });

    it('按 action 精确过滤', () => {
      const result = logger.query({ action: 'review' });
      expect(result).toHaveLength(2);
    });

    it('按 actionPrefix 过滤', () => {
      const result = logger.query({ actionPrefix: 'rules' });
      expect(result).toHaveLength(1);
      expect(result[0].action).toBe('rules disable');
    });

    it('按 result 过滤', () => {
      const result = logger.query({ result: 'denied' });
      expect(result).toHaveLength(1);
      expect(result[0].user).toBe('carol');
    });

    it('按时间范围过滤（fromTimestamp 包含）', () => {
      const base = Date.now();
      const result = logger.query({ fromTimestamp: base - 1500 });
      // 应包含 base-1000 与 base 两条
      expect(result.length).toBeLessThanOrEqual(2);
      for (const e of result) {
        expect(e.timestamp).toBeGreaterThanOrEqual(base - 1500);
      }
    });

    it('按时间范围过滤（toTimestamp 不包含）', () => {
      const base = Date.now();
      const result = logger.query({ toTimestamp: base - 1500 });
      for (const e of result) {
        expect(e.timestamp).toBeLessThan(base - 1500);
      }
    });

    it('limit 限制返回条数', () => {
      const result = logger.query({ limit: 2 });
      expect(result).toHaveLength(2);
    });

    it('默认 limit 为 100', () => {
      // 添加 100 条以上
      const l = new AuditLogger();
      for (let i = 0; i < 150; i++) {
        l.logAction({ action: 'review', args: [], result: 'success' });
      }
      const result = l.query({});
      expect(result.length).toBe(100);
    });

    it('组合多个条件', () => {
      const result = logger.query({ user: 'alice', result: 'success', action: 'review' });
      expect(result).toHaveLength(1);
      expect(result[0].user).toBe('alice');
    });

    it('返回结果按时间倒序', () => {
      const result = logger.query({});
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].timestamp).toBeGreaterThanOrEqual(result[i].timestamp);
      }
    });

    it('无匹配时返回空数组', () => {
      const result = logger.query({ user: 'nonexistent' });
      expect(result).toEqual([]);
    });
  });

  describe('getAll / size / clear', () => {
    it('getAll 返回内存全部日志', () => {
      logger.logAction({ action: 'a', args: [], result: 'success' });
      logger.logAction({ action: 'b', args: [], result: 'success' });
      expect(logger.getAll()).toHaveLength(2);
    });

    it('size 返回日志数量', () => {
      logger.logAction({ action: 'a', args: [], result: 'success' });
      expect(logger.size()).toBe(1);
    });

    it('clear 清空内存缓存', () => {
      logger.logAction({ action: 'a', args: [], result: 'success' });
      logger.clear();
      expect(logger.size()).toBe(0);
    });

    it('historyLimit 截断内存缓存', () => {
      const l = new AuditLogger({ historyLimit: 3 });
      for (let i = 0; i < 10; i++) {
        l.logAction({ action: `a${i}`, args: [], result: 'success' });
      }
      expect(l.size()).toBe(3);
      // 最新 3 条
      expect(l.getAll()[0].action).toBe('a9');
      expect(l.getAll()[2].action).toBe('a7');
    });
  });
});

// ==================== 持久化 ====================

describe('AuditLogger 持久化', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'audit-test-'));
    filePath = join(tmpDir, 'audit.log');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('logAction 自动追加到磁盘文件', () => {
    const logger = new AuditLogger({ filePath });
    logger.logAction({
      user: 'alice',
      action: 'review',
      args: [],
      result: 'success',
    });
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('review');
    expect(content).toContain('alice');
  });

  it('logAction 父目录不存在时自动创建', () => {
    const nested = join(tmpDir, 'a', 'b', 'audit.log');
    const logger = new AuditLogger({ filePath: nested });
    logger.logAction({ action: 'review', args: [], result: 'success' });
    expect(existsSync(nested)).toBe(true);
  });

  it('logAction 多次追加写入多行 JSON Lines', () => {
    const logger = new AuditLogger({ filePath });
    logger.logAction({ action: 'first', args: [], result: 'success' });
    logger.logAction({ action: 'second', args: [], result: 'success' });
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(2);
  });

  it('persist 覆盖写入磁盘', () => {
    const logger = new AuditLogger();
    logger.logAction({ action: 'first', args: [], result: 'success' });
    logger.logAction({ action: 'second', args: [], result: 'success' });
    logger.persist(filePath);
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('first');
    expect(content).toContain('second');
  });

  it('persist 未指定 filePath 抛错', () => {
    const logger = new AuditLogger();
    expect(() => logger.persist()).toThrow();
  });

  it('loadFromFile 从磁盘加载历史', () => {
    const logger = new AuditLogger({ filePath });
    const base = Date.now();
    logger.logAction({ user: 'alice', action: 'review', args: [], result: 'success', timestamp: base });
    logger.logAction({ user: 'bob', action: 'scan', args: [], result: 'success', timestamp: base + 1000 });

    const loaded = AuditLogger.loadFromFile(filePath);
    expect(loaded.size()).toBe(2);
    expect(loaded.getAll()[0].user).toBe('bob'); // 最新在前
  });

  it('loadFromFile 文件不存在时返回空实例', () => {
    const loaded = AuditLogger.loadFromFile(join(tmpDir, 'non-existent.log'));
    expect(loaded.size()).toBe(0);
  });

  it('loadFromFile 解析失败时返回空实例', () => {
    writeFileSync(filePath, 'not valid json\nalso not json\n', 'utf-8');
    const loaded = AuditLogger.loadFromFile(filePath);
    expect(loaded.size()).toBe(0);
  });

  it('readAuditLogFile 返回 JSON Lines 解析结果', () => {
    const logger = new AuditLogger({ filePath });
    logger.logAction({ user: 'alice', action: 'review', args: [], result: 'success' });
    const entries = readAuditLogFile(filePath);
    expect(entries).toHaveLength(1);
    expect(entries[0].user).toBe('alice');
  });

  it('readAuditLogFile 文件不存在时返回空数组', () => {
    const entries = readAuditLogFile(join(tmpDir, 'non-existent.log'));
    expect(entries).toEqual([]);
  });

  it('readAuditLogFile 跳过解析失败的行', () => {
    const valid = JSON.stringify({
      id: 'a1',
      timestamp: Date.now(),
      user: 'alice',
      action: 'review',
      args: [],
      result: 'success',
    });
    writeFileSync(filePath, `not json\n${valid}\nalso not json\n`, 'utf-8');
    const entries = readAuditLogFile(filePath);
    expect(entries).toHaveLength(1);
  });

  it('readAuditLogFile 按时间倒序返回', () => {
    const now = Date.now();
    const older = JSON.stringify({
      id: 'a1',
      timestamp: now - 1000,
      user: 'alice',
      action: 'first',
      args: [],
      result: 'success',
    });
    const newer = JSON.stringify({
      id: 'a2',
      timestamp: now,
      user: 'bob',
      action: 'second',
      args: [],
      result: 'success',
    });
    writeFileSync(filePath, `${older}\n${newer}\n`, 'utf-8');
    const entries = readAuditLogFile(filePath);
    expect(entries[0].id).toBe('a2');
    expect(entries[1].id).toBe('a1');
  });
});

// ==================== 便捷函数 ====================

describe('logAction 便捷函数', () => {
  it('不传 logger 时使用默认空实例', () => {
    const entry = logAction({ action: 'review', args: [], result: 'success' });
    expect(entry.id).toMatch(/^audit-/);
    expect(entry.action).toBe('review');
  });

  it('传入 logger 时复用实例', () => {
    const logger = new AuditLogger();
    logAction({ action: 'review', args: [], result: 'success' }, logger);
    expect(logger.size()).toBe(1);
  });
});

describe('getAuditLog 便捷函数', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'audit-test-'));
    filePath = join(tmpDir, 'audit.log');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('从磁盘读取并按条件查询', () => {
    const logger = new AuditLogger({ filePath });
    logger.logAction({ user: 'alice', action: 'review', args: [], result: 'success' });
    logger.logAction({ user: 'bob', action: 'scan', args: [], result: 'success' });

    const entries = getAuditLog({ filePath, user: 'alice' });
    expect(entries).toHaveLength(1);
    expect(entries[0].user).toBe('alice');
  });

  it('未指定 filePath 时返回空数组', () => {
    const entries = getAuditLog({ user: 'alice' });
    expect(entries).toEqual([]);
  });

  it('文件不存在时返回空数组', () => {
    const entries = getAuditLog({ filePath: join(tmpDir, 'non-existent.log') });
    expect(entries).toEqual([]);
  });
});

// ==================== 类型导出 ====================

describe('类型导出', () => {
  it('AuditResult 类型包含 success / failure / denied', () => {
    const r1: AuditResult = 'success';
    const r2: AuditResult = 'failure';
    const r3: AuditResult = 'denied';
    expect(r1).toBe('success');
    expect(r2).toBe('failure');
    expect(r3).toBe('denied');
  });

  it('AuditLogEntry 结构正确', () => {
    const entry: AuditLogEntry = {
      id: 'audit-1',
      timestamp: Date.now(),
      user: 'alice',
      action: 'review',
      args: ['--incremental'],
      result: 'success',
      findingsCount: 3,
    };
    expect(entry.user).toBe('alice');
  });

  it('AuditQueryOptions 结构正确', () => {
    const opts: AuditQueryOptions = {
      user: 'alice',
      action: 'review',
      limit: 10,
      fromDisk: true,
    };
    expect(opts.user).toBe('alice');
  });
});

// ==================== CLI 集成：audit 命令 ====================

describe('CLI: audit 命令', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'audit-cli-'));
    filePath = join(tmpDir, 'audit.log');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('查询全部审计日志', async () => {
    // 准备审计日志文件
    const logger = new AuditLogger({ filePath });
    logger.logAction({ user: 'alice', action: 'review', args: [], result: 'success' });
    logger.logAction({ user: 'bob', action: 'scan', args: [], result: 'success' });

    const { stdout, exitCode } = await loadCli({
      argv: ['audit', '--file', filePath],
      env: {},
    });

    expect(exitCode).toBeNull();
    const output = stdout.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(2);
    expect(parsed.some((e: AuditLogEntry) => e.user === 'alice')).toBe(true);
    expect(parsed.some((e: AuditLogEntry) => e.user === 'bob')).toBe(true);
  });

  it('按用户过滤', async () => {
    const logger = new AuditLogger({ filePath });
    logger.logAction({ user: 'alice', action: 'review', args: [], result: 'success' });
    logger.logAction({ user: 'bob', action: 'scan', args: [], result: 'success' });

    const { stdout, exitCode } = await loadCli({
      argv: ['audit', '--file', filePath, '--user', 'alice'],
      env: {},
    });

    expect(exitCode).toBeNull();
    const parsed = JSON.parse(stdout.join('\n'));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].user).toBe('alice');
  });

  it('按 action 过滤', async () => {
    const logger = new AuditLogger({ filePath });
    logger.logAction({ action: 'review', args: [], result: 'success' });
    logger.logAction({ action: 'scan', args: [], result: 'success' });

    const { stdout, exitCode } = await loadCli({
      argv: ['audit', '--file', filePath, '--action', 'review'],
      env: {},
    });

    expect(exitCode).toBeNull();
    const parsed = JSON.parse(stdout.join('\n'));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].action).toBe('review');
  });

  it('按 result 过滤', async () => {
    const logger = new AuditLogger({ filePath });
    logger.logAction({ action: 'review', args: [], result: 'success' });
    logger.logAction({ action: 'scan', args: [], result: 'failure', error: 'oom' });

    const { stdout, exitCode } = await loadCli({
      argv: ['audit', '--file', filePath, '--result', 'failure'],
      env: {},
    });

    expect(exitCode).toBeNull();
    const parsed = JSON.parse(stdout.join('\n'));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].result).toBe('failure');
  });

  it('按 limit 限制返回条数', async () => {
    const logger = new AuditLogger({ filePath });
    for (let i = 0; i < 5; i++) {
      logger.logAction({ action: 'review', args: [], result: 'success' });
    }

    const { stdout, exitCode } = await loadCli({
      argv: ['audit', '--file', filePath, '--limit', '2'],
      env: {},
    });

    expect(exitCode).toBeNull();
    const parsed = JSON.parse(stdout.join('\n'));
    expect(parsed).toHaveLength(2);
  });

  it('空审计日志返回空数组', async () => {
    const { stdout, exitCode } = await loadCli({
      argv: ['audit', '--file', filePath],
      env: {},
    });

    expect(exitCode).toBeNull();
    const parsed = JSON.parse(stdout.join('\n'));
    expect(parsed).toEqual([]);
  });

  it('缺少 --file 时输出 Usage', async () => {
    const { stderr, exitCode } = await loadCli({
      argv: ['audit'],
      env: {},
    });

    expect(exitCode).toBe(1);
    expect(stderr.some((s) => s.includes('Usage'))).toBe(true);
  });

  it('文件不存在时返回空数组', async () => {
    const { stdout, exitCode } = await loadCli({
      argv: ['audit', '--file', join(tmpDir, 'non-existent.log')],
      env: {},
    });

    expect(exitCode).toBeNull();
    const parsed = JSON.parse(stdout.join('\n'));
    expect(parsed).toEqual([]);
  });
});

// ==================== audit.md 命令文件 ====================

describe('audit.md 命令文件', () => {
  const COMMAND_PATH = join(__dirname, '../../../opencode-config/.opencode/commands/audit.md');

  it('文件存在', () => {
    expect(existsSync(COMMAND_PATH)).toBe(true);
  });

  it('包含 frontmatter 描述', () => {
    const content = readFileSync(COMMAND_PATH, 'utf-8');
    expect(content).toContain('---');
    expect(content).toContain('description:');
    expect(content).toContain('agent: code-reviewer');
  });

  it('声明 audit 子命令', () => {
    const content = readFileSync(COMMAND_PATH, 'utf-8');
    expect(content).toContain('audit');
  });

  it('包含 audit 命令示例', () => {
    const content = readFileSync(COMMAND_PATH, 'utf-8');
    expect(content).toContain('code-review audit');
  });
});
