import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  StateStore,
  createSession,
  getSession,
  updateSessionStatus,
  listSessions,
  saveFindings,
  getFindingsBySession,
  getFindingsByFile,
  resumeInterruptedSessions,
  getTrendStats,
  type SessionStatus,
} from '../src/state.js';
import type { Finding } from '../src/types.js';

/** 构造一条测试 finding */
function makeFinding(partial: Partial<Finding> = {}): Finding {
  return {
    file: 'src/index.ts',
    line: 10,
    severity: 'high',
    category: 'security',
    message: 'SQL injection',
    confidence: 0.9,
    source: 'rule',
    ...partial,
  };
}

describe('StateStore 基础设施', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
  });

  it('默认使用内存模式创建实例', () => {
    expect(store).toBeInstanceOf(StateStore);
    expect(store.isPersistent()).toBe(false);
  });

  it('支持持久化模式（JSON 文件）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'state-test-'));
    try {
      const file = join(dir, 'state.json');
      const s = new StateStore({ persistFile: file });
      expect(s.isPersistent()).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('close 后清空内存数据', () => {
    store.createSession({ id: 's1', filesTotal: 5 });
    store.close();
    expect(store.listSessions()).toHaveLength(0);
  });

  it('close 幂等：重复调用不抛错', () => {
    store.createSession({ id: 'c', filesTotal: 1 });
    store.close();
    expect(() => store.close()).not.toThrow();
  });
});

describe('会话 CRUD', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
  });

  it('createSession 创建新会话并返回会话对象', () => {
    const session = store.createSession({ id: 'sess-1', filesTotal: 10 });
    expect(session.id).toBe('sess-1');
    expect(session.status).toBe('pending');
    expect(session.filesTotal).toBe(10);
    expect(session.filesProcessed).toBe(0);
    expect(session.createdAt).toBeTypeOf('number');
    expect(session.updatedAt).toBeTypeOf('number');
  });

  it('createSession 在 ID 冲突时抛出错误', () => {
    store.createSession({ id: 'dup', filesTotal: 1 });
    expect(() => store.createSession({ id: 'dup', filesTotal: 1 })).toThrow(/already exists|已存在/);
  });

  it('getSession 返回已存在的会话', () => {
    store.createSession({ id: 's2', filesTotal: 3 });
    const got = store.getSession('s2');
    expect(got).not.toBeNull();
    expect(got?.id).toBe('s2');
    expect(got?.filesTotal).toBe(3);
  });

  it('getSession 对不存在的会话返回 null', () => {
    expect(store.getSession('not-exist')).toBeNull();
  });

  it('独立函数 createSession / getSession 等价于实例方法', () => {
    const s = createSession({ id: 'fn-1', filesTotal: 7 });
    expect(s.id).toBe('fn-1');
    const g = getSession('fn-1');
    expect(g?.filesTotal).toBe(7);
  });

  it('listSessions 返回所有会话列表', () => {
    store.createSession({ id: 'a', filesTotal: 1 });
    store.createSession({ id: 'b', filesTotal: 2 });
    store.createSession({ id: 'c', filesTotal: 3 });
    const list = store.listSessions();
    expect(list).toHaveLength(3);
    expect(list.map((s) => s.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('listSessions 支持按状态过滤', () => {
    store.createSession({ id: 'a', filesTotal: 1 });
    store.createSession({ id: 'b', filesTotal: 1 });
    store.updateSessionStatus('b', 'running');
    const running = store.listSessions({ status: 'running' });
    expect(running).toHaveLength(1);
    expect(running[0].id).toBe('b');
  });

  it('listSessions 默认按 createdAt 倒序', () => {
    store.createSession({ id: 'old', filesTotal: 1 });
    store.createSession({ id: 'new', filesTotal: 1 });
    const list = store.listSessions();
    expect(list[0].id).toBe('new');
    expect(list[1].id).toBe('old');
  });

  it('deleteSession 删除会话', () => {
    store.createSession({ id: 'x', filesTotal: 1 });
    expect(store.deleteSession('x')).toBe(true);
    expect(store.getSession('x')).toBeNull();
  });

  it('deleteSession 删除不存在的会话返回 false', () => {
    expect(store.deleteSession('missing')).toBe(false);
  });

  it('deleteSession 同时删除关联的 findings', () => {
    store.createSession({ id: 'y', filesTotal: 1 });
    store.saveFindings('y', [makeFinding({ file: 'a.ts' })]);
    store.deleteSession('y');
    expect(store.getFindingsBySession('y')).toHaveLength(0);
  });
});

describe('会话状态机', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
  });

  it('初始状态为 pending', () => {
    const s = store.createSession({ id: 'sm-1', filesTotal: 1 });
    expect(s.status).toBe('pending');
  });

  it('pending → running 转换合法', () => {
    store.createSession({ id: 'sm-2', filesTotal: 1 });
    const updated = store.updateSessionStatus('sm-2', 'running');
    expect(updated?.status).toBe('running');
  });

  it('running → completed 转换合法', () => {
    store.createSession({ id: 'sm-3', filesTotal: 1 });
    store.updateSessionStatus('sm-3', 'running');
    const updated = store.updateSessionStatus('sm-3', 'completed');
    expect(updated?.status).toBe('completed');
    expect(updated?.finishedAt).toBeTypeOf('number');
  });

  it('running → failed 转换合法', () => {
    store.createSession({ id: 'sm-4', filesTotal: 1 });
    store.updateSessionStatus('sm-4', 'running');
    const updated = store.updateSessionStatus('sm-4', 'failed', 'API timeout');
    expect(updated?.status).toBe('failed');
    expect(updated?.error).toBe('API timeout');
    expect(updated?.finishedAt).toBeTypeOf('number');
  });

  it('running → failed 不传 error 时不设置 error 字段', () => {
    store.createSession({ id: 'sm-4b', filesTotal: 1 });
    store.updateSessionStatus('sm-4b', 'running');
    const updated = store.updateSessionStatus('sm-4b', 'failed');
    expect(updated?.status).toBe('failed');
    expect(updated?.error).toBeUndefined();
  });

  it('pending → failed 转换合法（初始化失败场景）', () => {
    store.createSession({ id: 'sm-4c', filesTotal: 1 });
    const updated = store.updateSessionStatus('sm-4c', 'failed', 'init failed');
    expect(updated?.status).toBe('failed');
    expect(updated?.error).toBe('init failed');
  });

  it('pending → completed 非法转换抛出错误', () => {
    store.createSession({ id: 'sm-5', filesTotal: 1 });
    expect(() => store.updateSessionStatus('sm-5', 'completed')).toThrow(/invalid|非法/);
  });

  it('completed → running 非法转换抛出错误', () => {
    store.createSession({ id: 'sm-6', filesTotal: 1 });
    store.updateSessionStatus('sm-6', 'running');
    store.updateSessionStatus('sm-6', 'completed');
    expect(() => store.updateSessionStatus('sm-6', 'running')).toThrow(/invalid|非法/);
  });

  it('failed → running 非法转换抛出错误', () => {
    store.createSession({ id: 'sm-7', filesTotal: 1 });
    store.updateSessionStatus('sm-7', 'running');
    store.updateSessionStatus('sm-7', 'failed', 'err');
    expect(() => store.updateSessionStatus('sm-7', 'running')).toThrow(/invalid|非法/);
  });

  it('更新不存在的会话返回 null', () => {
    expect(store.updateSessionStatus('ghost', 'running')).toBeNull();
  });

  it('incrementFilesProcessed 累加已处理文件数', () => {
    store.createSession({ id: 'cnt', filesTotal: 5 });
    store.updateSessionStatus('cnt', 'running');
    store.incrementFilesProcessed('cnt');
    store.incrementFilesProcessed('cnt', 2);
    const s = store.getSession('cnt');
    expect(s?.filesProcessed).toBe(3);
  });

  it('incrementFilesProcessed 对不存在的会话返回 null', () => {
    expect(store.incrementFilesProcessed('ghost')).toBeNull();
  });

  it('updateSessionStatus 更新时间戳 updatedAt', async () => {
    store.createSession({ id: 'ts', filesTotal: 1 });
    const before = store.getSession('ts')!.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    store.updateSessionStatus('ts', 'running');
    const after = store.getSession('ts')!.updatedAt;
    expect(after).toBeGreaterThan(before);
  });
});

describe('findings 持久化', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
    store.createSession({ id: 'f-sess', filesTotal: 3 });
  });

  it('saveFindings 存储 findings 并返回保存数量', () => {
    const findings = [
      makeFinding({ file: 'a.ts', line: 1 }),
      makeFinding({ file: 'b.ts', line: 2 }),
    ];
    const n = store.saveFindings('f-sess', findings);
    expect(n).toBe(2);
  });

  it('getFindingsBySession 返回该会话所有 findings', () => {
    store.saveFindings('f-sess', [
      makeFinding({ file: 'a.ts' }),
      makeFinding({ file: 'b.ts' }),
    ]);
    const list = store.getFindingsBySession('f-sess');
    expect(list).toHaveLength(2);
  });

  it('getFindingsBySession 对无 findings 的会话返回空数组', () => {
    expect(store.getFindingsBySession('f-sess')).toHaveLength(0);
  });

  it('getFindingsBySession 对不存在的会话返回空数组', () => {
    expect(store.getFindingsBySession('ghost')).toHaveLength(0);
  });

  it('getFindingsByFile 按文件路径过滤 findings', () => {
    store.saveFindings('f-sess', [
      makeFinding({ file: 'a.ts', line: 1 }),
      makeFinding({ file: 'a.ts', line: 2 }),
      makeFinding({ file: 'b.ts', line: 3 }),
    ]);
    const list = store.getFindingsByFile('f-sess', 'a.ts');
    expect(list).toHaveLength(2);
    expect(list.every((f) => f.file === 'a.ts')).toBe(true);
  });

  it('getFindingsByFile 支持跨会话查询（all=true）', () => {
    store.createSession({ id: 'f-sess2', filesTotal: 1 });
    store.saveFindings('f-sess', [makeFinding({ file: 'shared.ts' })]);
    store.saveFindings('f-sess2', [makeFinding({ file: 'shared.ts' })]);
    const list = store.getFindingsByFile('shared.ts' as any, undefined as any, { allSessions: true });
    expect(list).toHaveLength(2);
  });

  it('saveFindings 多次调用累加而非覆盖', () => {
    store.saveFindings('f-sess', [makeFinding({ file: 'a.ts' })]);
    store.saveFindings('f-sess', [makeFinding({ file: 'b.ts' })]);
    expect(store.getFindingsBySession('f-sess')).toHaveLength(2);
  });

  it('saveFindings 对不存在的会话抛出错误', () => {
    expect(() => store.saveFindings('ghost', [makeFinding()])).toThrow(/not found|不存在/);
  });

  it('saveFindings 空数组返回 0', () => {
    expect(store.saveFindings('f-sess', [])).toBe(0);
  });

  it('getFindingsByFile 未传 sessionId/file 时返回空数组', () => {
    store.saveFindings('f-sess', [makeFinding({ file: 'a.ts' })]);
    expect(store.getFindingsByFile('', '')).toHaveLength(0);
    expect(store.getFindingsByFile('ghost-session', 'a.ts')).toHaveLength(0);
  });

  it('getFindingsByFile 不存在的 file 返回空数组', () => {
    store.saveFindings('f-sess', [makeFinding({ file: 'a.ts' })]);
    expect(store.getFindingsByFile('f-sess', 'nope.ts')).toHaveLength(0);
  });
});

describe('断点续审', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
  });

  it('resumeInterruptedSessions 返回所有 running 状态会话', () => {
    store.createSession({ id: 'r1', filesTotal: 2 });
    store.createSession({ id: 'r2', filesTotal: 2 });
    store.createSession({ id: 'r3', filesTotal: 2 });
    store.updateSessionStatus('r1', 'running');
    store.updateSessionStatus('r2', 'running');
    store.updateSessionStatus('r3', 'running');
    store.updateSessionStatus('r3', 'completed');
    const interrupted = store.resumeInterruptedSessions();
    expect(interrupted).toHaveLength(2);
    expect(interrupted.map((s) => s.id).sort()).toEqual(['r1', 'r2']);
  });

  it('resumeInterruptedSessions 无中断会话时返回空数组', () => {
    store.createSession({ id: 'r4', filesTotal: 1 });
    store.updateSessionStatus('r4', 'running');
    store.updateSessionStatus('r4', 'completed');
    expect(store.resumeInterruptedSessions()).toHaveLength(0);
  });

  it('resumeInterruptedSessions 同时把 pending 会话视为可恢复', () => {
    store.createSession({ id: 'p1', filesTotal: 1 });
    store.createSession({ id: 'p2', filesTotal: 1 });
    store.updateSessionStatus('p2', 'running');
    const list = store.resumeInterruptedSessions();
    expect(list).toHaveLength(2);
  });

  it('resumeInterruptedSessions 自定义可恢复状态集合', () => {
    store.createSession({ id: 'c1', filesTotal: 1 });
    store.updateSessionStatus('c1', 'running');
    store.updateSessionStatus('c1', 'failed', 'oops');
    const list = store.resumeInterruptedSessions({ recoverableStatuses: ['failed'] });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('c1');
  });

  it('resumeInterruptedSessions 同 createdAt 时按插入顺序升序', () => {
    const now = Date.now();
    store.createSession({ id: 'same-a', filesTotal: 1, createdAt: now });
    store.createSession({ id: 'same-b', filesTotal: 1, createdAt: now });
    store.updateSessionStatus('same-a', 'running');
    store.updateSessionStatus('same-b', 'running');
    const list = store.resumeInterruptedSessions();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('same-a'); // 插入顺序在前
    expect(list[1].id).toBe('same-b');
  });
});

describe('历史趋势统计 getTrendStats', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
  });

  it('空仓库返回零统计', () => {
    const stats = store.getTrendStats();
    expect(stats.totalSessions).toBe(0);
    expect(stats.totalFindings).toBe(0);
    expect(stats.completedSessions).toBe(0);
    expect(stats.failedSessions).toBe(0);
    expect(stats.avgFindingsPerSession).toBe(0);
  });

  it('统计会话总数与按状态分布', () => {
    store.createSession({ id: 't1', filesTotal: 1 });
    store.createSession({ id: 't2', filesTotal: 1 });
    store.createSession({ id: 't3', filesTotal: 1 });
    store.updateSessionStatus('t1', 'running');
    store.updateSessionStatus('t1', 'completed');
    store.updateSessionStatus('t2', 'running');
    store.updateSessionStatus('t2', 'failed', 'err');
    const stats = store.getTrendStats();
    expect(stats.totalSessions).toBe(3);
    expect(stats.completedSessions).toBe(1);
    expect(stats.failedSessions).toBe(1);
    expect(stats.runningSessions).toBe(0);
    expect(stats.pendingSessions).toBe(1);
  });

  it('统计 findings 总数与每会话平均', () => {
    store.createSession({ id: 't4', filesTotal: 1 });
    store.createSession({ id: 't5', filesTotal: 1 });
    store.updateSessionStatus('t4', 'running');
    store.updateSessionStatus('t4', 'completed');
    store.updateSessionStatus('t5', 'running');
    store.updateSessionStatus('t5', 'completed');
    store.saveFindings('t4', [makeFinding(), makeFinding(), makeFinding()]);
    store.saveFindings('t5', [makeFinding()]);
    const stats = store.getTrendStats();
    expect(stats.totalFindings).toBe(4);
    expect(stats.completedSessions).toBe(2);
    expect(stats.avgFindingsPerSession).toBeCloseTo(2, 5);
  });

  it('按 severity 分布统计', () => {
    store.createSession({ id: 'sev', filesTotal: 1 });
    store.updateSessionStatus('sev', 'running');
    store.updateSessionStatus('sev', 'completed');
    store.saveFindings('sev', [
      makeFinding({ severity: 'critical' }),
      makeFinding({ severity: 'critical' }),
      makeFinding({ severity: 'high' }),
      makeFinding({ severity: 'low' }),
      makeFinding({ severity: 'info' }),
    ]);
    const stats = store.getTrendStats();
    expect(stats.bySeverity.critical).toBe(2);
    expect(stats.bySeverity.high).toBe(1);
    expect(stats.bySeverity.medium ?? 0).toBe(0);
    expect(stats.bySeverity.low).toBe(1);
    expect(stats.bySeverity.info).toBe(1);
  });

  it('按 category 分布统计', () => {
    store.createSession({ id: 'cat', filesTotal: 1 });
    store.updateSessionStatus('cat', 'running');
    store.updateSessionStatus('cat', 'completed');
    store.saveFindings('cat', [
      makeFinding({ category: 'security' }),
      makeFinding({ category: 'security' }),
      makeFinding({ category: 'performance' }),
    ]);
    const stats = store.getTrendStats();
    expect(stats.byCategory.security).toBe(2);
    expect(stats.byCategory.performance).toBe(1);
  });

  it('支持按时间范围过滤', () => {
    const now = Date.now();
    const longAgo = now - 10_000_000;
    store.createSession({ id: 'old', filesTotal: 1, createdAt: longAgo });
    store.createSession({ id: 'recent', filesTotal: 1, createdAt: now });
    store.updateSessionStatus('old', 'running');
    store.updateSessionStatus('old', 'completed');
    store.updateSessionStatus('recent', 'running');
    store.updateSessionStatus('recent', 'completed');
    const stats = store.getTrendStats({ since: now - 1_000 });
    expect(stats.totalSessions).toBe(1);
    expect(stats.completedSessions).toBe(1);
  });

  it('容忍异常 finding 字段（severity 缺失/未知、category 缺失）', () => {
    store.createSession({ id: 'edge', filesTotal: 1 });
    store.updateSessionStatus('edge', 'running');
    store.updateSessionStatus('edge', 'completed');
    store.saveFindings('edge', [
      makeFinding({ severity: 'unknown' as any, category: undefined as any }),
      makeFinding({ severity: undefined as any, category: undefined as any }),
    ]);
    const stats = store.getTrendStats();
    expect(stats.totalFindings).toBe(2);
    // 未知 severity 不计入 bySeverity
    expect(stats.bySeverity.unknown).toBeUndefined();
    // category 缺失归为 'unknown'
    expect(stats.byCategory.unknown).toBe(2);
    // severity=undefined 回退到 'info'
    expect(stats.bySeverity.info).toBe(1);
  });

  it('无 completed 会话时 avgFindingsPerSession 为 0', () => {
    store.createSession({ id: 'no-comp', filesTotal: 1 });
    store.updateSessionStatus('no-comp', 'running');
    store.saveFindings('no-comp', [makeFinding()]);
    const stats = store.getTrendStats();
    expect(stats.completedSessions).toBe(0);
    expect(stats.avgFindingsPerSession).toBe(0);
  });
});

describe('持久化到 JSON 文件', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'state-persist-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('写入数据后落盘到 JSON 文件', () => {
    const file = join(dir, 'state.json');
    const s1 = new StateStore({ persistFile: file });
    s1.createSession({ id: 'p-1', filesTotal: 1 });
    s1.updateSessionStatus('p-1', 'running');
    s1.updateSessionStatus('p-1', 'completed');
    s1.saveFindings('p-1', [makeFinding({ file: 'x.ts' })]);
    s1.flush();
    expect(existsSync(file)).toBe(true);
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    expect(raw.sessions).toHaveLength(1);
    expect(raw.sessions[0].id).toBe('p-1');
    expect(raw.findings).toHaveLength(1);
  });

  it('重启实例后能从文件加载历史数据', () => {
    const file = join(dir, 'state.json');
    const s1 = new StateStore({ persistFile: file });
    s1.createSession({ id: 'p-2', filesTotal: 2 });
    s1.updateSessionStatus('p-2', 'running');
    s1.saveFindings('p-2', [makeFinding({ file: 'y.ts' })]);
    s1.flush();
    s1.close();

    const s2 = new StateStore({ persistFile: file });
    const got = s2.getSession('p-2');
    expect(got?.id).toBe('p-2');
    expect(got?.status).toBe('running');
    expect(s2.getFindingsBySession('p-2')).toHaveLength(1);
  });

  it('文件不存在时持久化模式仍可正常工作', () => {
    const file = join(dir, 'never-existed.json');
    const s = new StateStore({ persistFile: file });
    expect(s.isPersistent()).toBe(true);
    s.createSession({ id: 'fresh', filesTotal: 1 });
    expect(s.getSession('fresh')?.id).toBe('fresh');
  });

  it('persistFile 为空字符串时退化为内存模式', () => {
    const s = new StateStore({ persistFile: '' });
    expect(s.isPersistent()).toBe(false);
  });

  it('加载损坏的 JSON 文件时静默回退到空状态', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const file = join(dir, 'broken.json');
    writeFileSync(file, 'not-json {{{', 'utf8');
    const s = new StateStore({ persistFile: file });
    expect(s.listSessions()).toHaveLength(0);
    // 写入新数据应正常工作
    s.createSession({ id: 'after-load', filesTotal: 1 });
    expect(s.getSession('after-load')?.id).toBe('after-load');
    warnSpy.mockRestore();
  });

  it('加载损坏的 JSON 文件时记录 warn 日志（含 [state] 前缀）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const file = join(dir, 'broken-warn.json');
    writeFileSync(file, 'not-json {{{', 'utf8');
    const s = new StateStore({ persistFile: file });
    expect(s.listSessions()).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    const allCalls = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(allCalls.some((s) => s.includes('[state]'))).toBe(true);
    warnSpy.mockRestore();
  });

  it('persistFile 位于不存在的子目录时自动创建', () => {
    const nested = join(dir, 'nested', 'sub', 'state.json');
    const s = new StateStore({ persistFile: nested });
    s.createSession({ id: 'auto-dir', filesTotal: 1 });
    s.flush();
    expect(existsSync(nested)).toBe(true);
  });

  it('autoFlush 关闭时不自动落盘，需手动 flush', () => {
    const file = join(dir, 'manual.json');
    const s = new StateStore({ persistFile: file, autoFlush: false });
    s.createSession({ id: 'no-auto', filesTotal: 1 });
    // autoFlush=false 不应自动写入
    expect(existsSync(file)).toBe(false);
    s.flush();
    expect(existsSync(file)).toBe(true);
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    expect(raw.sessions[0].id).toBe('no-auto');
  });

  it('flush 时若不启用持久化为 no-op', () => {
    const s = new StateStore();
    expect(() => s.flush()).not.toThrow();
  });
});

describe('模块级 API（默认实例）', () => {
  beforeEach(() => {
    // 模块级默认实例在每个测试间可能污染，重置一下
    const tmp = new StateStore();
    tmp.resetDefault();
  });

  it('模块级 createSession 与实例方法行为一致', () => {
    const s = createSession({ id: 'm-1', filesTotal: 4 });
    expect(s.id).toBe('m-1');
    expect(getSession('m-1')?.filesTotal).toBe(4);
  });

  it('模块级 updateSessionStatus 转换状态', () => {
    createSession({ id: 'm-2', filesTotal: 1 });
    const updated = updateSessionStatus('m-2', 'running');
    expect(updated?.status).toBe('running');
  });

  it('模块级 listSessions 返回所有会话', () => {
    createSession({ id: 'm-3', filesTotal: 1 });
    createSession({ id: 'm-4', filesTotal: 1 });
    expect(listSessions().length).toBeGreaterThanOrEqual(2);
  });

  it('模块级 saveFindings / getFindingsBySession 持久化数据', () => {
    createSession({ id: 'm-5', filesTotal: 1 });
    updateSessionStatus('m-5', 'running');
    saveFindings('m-5', [makeFinding({ file: 'z.ts' })]);
    expect(getFindingsBySession('m-5')).toHaveLength(1);
    expect(getFindingsByFile('m-5', 'z.ts')).toHaveLength(1);
  });

  it('模块级 resumeInterruptedSessions 返回 running 会话', () => {
    createSession({ id: 'm-6', filesTotal: 1 });
    updateSessionStatus('m-6', 'running');
    const list = resumeInterruptedSessions();
    expect(list.some((s) => s.id === 'm-6')).toBe(true);
  });

  it('模块级 getTrendStats 返回统计', () => {
    createSession({ id: 'm-7', filesTotal: 1 });
    updateSessionStatus('m-7', 'running');
    updateSessionStatus('m-7', 'completed');
    saveFindings('m-7', [makeFinding()]);
    const stats = getTrendStats();
    expect(stats.totalSessions).toBeGreaterThanOrEqual(1);
    expect(stats.totalFindings).toBeGreaterThanOrEqual(1);
  });
});

describe('SessionStatus 类型与状态集合', () => {
  it('合法状态集合包含 pending/running/completed/failed', () => {
    const valid: SessionStatus[] = ['pending', 'running', 'completed', 'failed'];
    expect(valid).toContain('pending');
    expect(valid).toContain('running');
    expect(valid).toContain('completed');
    expect(valid).toContain('failed');
  });
});
