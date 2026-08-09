// tests/findings-history-store.test.ts
// Task 19.1：findings-history-store.ts 单元测试
// 覆盖 add / addBatch / markSubmitted / markBlockedMerge / query / getAll / clear

import { describe, it, expect, beforeEach } from 'vitest';
import { createFindingsHistoryStore } from '../src/findings-history-store.js';
import type { FindingHistoryRecord } from '../src/findings-history-store.js';
import type { Finding } from '../src/types.js';

// ==================== 辅助构造函数 ====================

/** 构造一条 Finding */
function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    file: overrides.file ?? 'src/app.ts',
    line: overrides.line ?? 1,
    severity: overrides.severity ?? 'medium',
    category: overrides.category ?? 'quality',
    message: overrides.message ?? '示例问题',
    confidence: overrides.confidence ?? 0.9,
    source: overrides.source ?? 'rule',
    ruleId: overrides.ruleId,
    id: overrides.id ?? 'finding-1',
    ...overrides,
  };
}

/** 构造一条不含 historyId 的记录（用于 add/addBatch 入参） */
function makeRecordInput(overrides: Partial<Omit<FindingHistoryRecord, 'historyId'>> = {}): Omit<FindingHistoryRecord, 'historyId'> {
  return {
    mrIid: overrides.mrIid ?? 1,
    repoId: overrides.repoId ?? 'repo-1',
    author: overrides.author ?? 'zhangsan',
    finding: overrides.finding ?? makeFinding(),
    reviewedAt: overrides.reviewedAt ?? '2026-08-01T10:00:00.000Z',
    submitted: overrides.submitted ?? false,
    resolved: overrides.resolved ?? false,
    blockedMerge: overrides.blockedMerge ?? false,
    ...overrides,
  };
}

// ==================== add ====================

describe('createFindingsHistoryStore — add', () => {
  let store: ReturnType<typeof createFindingsHistoryStore>;

  beforeEach(() => {
    store = createFindingsHistoryStore();
  });

  it('add 返回包含 historyId 的完整记录', () => {
    const input = makeRecordInput();
    const record = store.add(input);
    expect(record.historyId).toBeTruthy();
    expect(record.historyId).toMatch(/^fh-/);
    // 原始字段保留
    expect(record.mrIid).toBe(input.mrIid);
    expect(record.repoId).toBe(input.repoId);
    expect(record.author).toBe(input.author);
    expect(record.finding).toEqual(input.finding);
  });

  it('add 后通过 getAll 可读到该记录', () => {
    const record = store.add(makeRecordInput({ mrIid: 42 }));
    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].historyId).toBe(record.historyId);
    expect(all[0].mrIid).toBe(42);
  });

  it('多次 add 生成不同 historyId', () => {
    const r1 = store.add(makeRecordInput());
    const r2 = store.add(makeRecordInput());
    expect(r1.historyId).not.toBe(r2.historyId);
    expect(store.getAll()).toHaveLength(2);
  });
});

// ==================== addBatch ====================

describe('createFindingsHistoryStore — addBatch', () => {
  let store: ReturnType<typeof createFindingsHistoryStore>;

  beforeEach(() => {
    store = createFindingsHistoryStore();
  });

  it('addBatch 返回包含 historyId 的完整记录数组', () => {
    const inputs = [
      makeRecordInput({ mrIid: 1 }),
      makeRecordInput({ mrIid: 2 }),
      makeRecordInput({ mrIid: 3 }),
    ];
    const records = store.addBatch(inputs);
    expect(records).toHaveLength(3);
    for (const r of records) {
      expect(r.historyId).toBeTruthy();
      expect(r.historyId).toMatch(/^fh-/);
    }
    // 每条 historyId 唯一
    const ids = records.map((r) => r.historyId);
    expect(new Set(ids).size).toBe(3);
  });

  it('addBatch 后 getAll 返回全部记录', () => {
    store.addBatch([makeRecordInput(), makeRecordInput()]);
    expect(store.getAll()).toHaveLength(2);
  });

  it('addBatch 空数组返回空数组', () => {
    const records = store.addBatch([]);
    expect(records).toEqual([]);
    expect(store.getAll()).toHaveLength(0);
  });

  it('add 与 addBatch 可混用', () => {
    store.add(makeRecordInput());
    store.addBatch([makeRecordInput(), makeRecordInput()]);
    expect(store.getAll()).toHaveLength(3);
  });
});

// ==================== markSubmitted ====================

describe('createFindingsHistoryStore — markSubmitted', () => {
  let store: ReturnType<typeof createFindingsHistoryStore>;

  beforeEach(() => {
    store = createFindingsHistoryStore();
  });

  it('按 mrIid+repoId+findingIds 标记 submitted=true 并记录 submittedAt', () => {
    const r1 = store.add(makeRecordInput({
      mrIid: 1,
      repoId: 'r1',
      finding: makeFinding({ id: 'f1' }),
    }));
    store.add(makeRecordInput({
      mrIid: 1,
      repoId: 'r1',
      finding: makeFinding({ id: 'f2' }),
    }));

    store.markSubmitted(1, 'r1', ['f1']);

    const all = store.getAll();
    const f1Record = all.find((r) => r.finding.id === 'f1');
    const f2Record = all.find((r) => r.finding.id === 'f2');
    expect(f1Record?.submitted).toBe(true);
    expect(f1Record?.submittedAt).toBeTruthy();
    expect(f2Record?.submitted).toBe(false);
    expect(f2Record?.submittedAt).toBeUndefined();
  });

  it('只匹配指定 mrIid+repoId 的记录（不影响其他 MR）', () => {
    store.add(makeRecordInput({
      mrIid: 1,
      repoId: 'r1',
      finding: makeFinding({ id: 'f1' }),
    }));
    store.add(makeRecordInput({
      mrIid: 2,
      repoId: 'r1',
      finding: makeFinding({ id: 'f1' }),
    }));

    store.markSubmitted(1, 'r1', ['f1']);

    const all = store.getAll();
    const mr1Record = all.find((r) => r.mrIid === 1);
    const mr2Record = all.find((r) => r.mrIid === 2);
    expect(mr1Record?.submitted).toBe(true);
    expect(mr2Record?.submitted).toBe(false);
  });

  it('只匹配指定 repoId（不影响其他仓库同 mrIid）', () => {
    store.add(makeRecordInput({
      mrIid: 1,
      repoId: 'r1',
      finding: makeFinding({ id: 'f1' }),
    }));
    store.add(makeRecordInput({
      mrIid: 1,
      repoId: 'r2',
      finding: makeFinding({ id: 'f1' }),
    }));

    store.markSubmitted(1, 'r1', ['f1']);

    const all = store.getAll();
    const r1Record = all.find((r) => r.repoId === 'r1');
    const r2Record = all.find((r) => r.repoId === 'r2');
    expect(r1Record?.submitted).toBe(true);
    expect(r2Record?.submitted).toBe(false);
  });

  it('findingIds 为空数组时不做任何标记', () => {
    store.add(makeRecordInput({ mrIid: 1, repoId: 'r1', finding: makeFinding({ id: 'f1' }) }));
    store.markSubmitted(1, 'r1', []);
    expect(store.getAll()[0].submitted).toBe(false);
  });

  it('findingIds 不匹配时不标记任何记录', () => {
    store.add(makeRecordInput({ mrIid: 1, repoId: 'r1', finding: makeFinding({ id: 'f1' }) }));
    store.markSubmitted(1, 'r1', ['nonexistent']);
    expect(store.getAll()[0].submitted).toBe(false);
  });

  it('submittedAt 为 ISO 时间戳', () => {
    store.add(makeRecordInput({ mrIid: 1, repoId: 'r1', finding: makeFinding({ id: 'f1' }) }));
    store.markSubmitted(1, 'r1', ['f1']);
    const record = store.getAll()[0];
    expect(record.submittedAt).toBeTruthy();
    // 验证是合法的 ISO 时间戳
    expect(new Date(record.submittedAt!).toISOString()).toBe(record.submittedAt);
  });
});

// ==================== markBlockedMerge ====================

describe('createFindingsHistoryStore — markBlockedMerge', () => {
  let store: ReturnType<typeof createFindingsHistoryStore>;

  beforeEach(() => {
    store = createFindingsHistoryStore();
  });

  it('将指定 MR 的全部记录 blockedMerge 置为 true', () => {
    store.add(makeRecordInput({ mrIid: 1, repoId: 'r1' }));
    store.add(makeRecordInput({ mrIid: 1, repoId: 'r1' }));
    store.add(makeRecordInput({ mrIid: 2, repoId: 'r1' }));

    store.markBlockedMerge(1, 'r1');

    const all = store.getAll();
    for (const r of all) {
      if (r.mrIid === 1 && r.repoId === 'r1') {
        expect(r.blockedMerge).toBe(true);
      } else {
        expect(r.blockedMerge).toBe(false);
      }
    }
  });

  it('只影响指定 repoId（不影响其他仓库同 mrIid）', () => {
    store.add(makeRecordInput({ mrIid: 1, repoId: 'r1' }));
    store.add(makeRecordInput({ mrIid: 1, repoId: 'r2' }));

    store.markBlockedMerge(1, 'r1');

    const all = store.getAll();
    const r1Record = all.find((r) => r.repoId === 'r1');
    const r2Record = all.find((r) => r.repoId === 'r2');
    expect(r1Record?.blockedMerge).toBe(true);
    expect(r2Record?.blockedMerge).toBe(false);
  });

  it('mrIid+repoId 不匹配时不影响任何记录', () => {
    store.add(makeRecordInput({ mrIid: 1, repoId: 'r1' }));
    store.markBlockedMerge(99, 'r1');
    expect(store.getAll()[0].blockedMerge).toBe(false);
  });
});

// ==================== query ====================

describe('createFindingsHistoryStore — query', () => {
  let store: ReturnType<typeof createFindingsHistoryStore>;

  beforeEach(() => {
    store = createFindingsHistoryStore();
    // 预置数据
    store.add(makeRecordInput({
      mrIid: 1,
      repoId: 'r1',
      author: 'zhangsan',
      reviewedAt: '2026-08-01T10:00:00.000Z',
    }));
    store.add(makeRecordInput({
      mrIid: 2,
      repoId: 'r1',
      author: 'lisi',
      reviewedAt: '2026-08-05T10:00:00.000Z',
    }));
    store.add(makeRecordInput({
      mrIid: 1,
      repoId: 'r2',
      author: 'zhangsan',
      reviewedAt: '2026-08-10T10:00:00.000Z',
    }));
  });

  it('无 filter 时返回全部记录', () => {
    const result = store.query();
    expect(result).toHaveLength(3);
  });

  it('按 mrIid 过滤', () => {
    const result = store.query({ mrIid: 1 });
    expect(result).toHaveLength(2);
    for (const r of result) {
      expect(r.mrIid).toBe(1);
    }
  });

  it('按 repoId 过滤', () => {
    const result = store.query({ repoId: 'r1' });
    expect(result).toHaveLength(2);
    for (const r of result) {
      expect(r.repoId).toBe('r1');
    }
  });

  it('按 since 过滤（reviewedAt >= since）', () => {
    const result = store.query({ since: '2026-08-05T00:00:00.000Z' });
    expect(result).toHaveLength(2);
    for (const r of result) {
      expect(r.reviewedAt >= '2026-08-05T00:00:00.000Z').toBe(true);
    }
  });

  it('按 until 过滤（reviewedAt <= until）', () => {
    const result = store.query({ until: '2026-08-05T23:59:59.000Z' });
    expect(result).toHaveLength(2);
    for (const r of result) {
      expect(r.reviewedAt <= '2026-08-05T23:59:59.000Z').toBe(true);
    }
  });

  it('组合 since+until 过滤', () => {
    const result = store.query({
      since: '2026-08-02T00:00:00.000Z',
      until: '2026-08-09T23:59:59.000Z',
    });
    expect(result).toHaveLength(1);
    expect(result[0].mrIid).toBe(2);
  });

  it('组合 mrIid+repoId 过滤', () => {
    const result = store.query({ mrIid: 1, repoId: 'r1' });
    expect(result).toHaveLength(1);
  });

  it('since+until 边界：since 恰好等于 reviewedAt 时包含该记录', () => {
    const result = store.query({ since: '2026-08-01T10:00:00.000Z' });
    expect(result).toHaveLength(3);
  });

  it('until 边界：until 恰好等于 reviewedAt 时包含该记录', () => {
    const result = store.query({ until: '2026-08-01T10:00:00.000Z' });
    expect(result).toHaveLength(1);
    expect(result[0].reviewedAt).toBe('2026-08-01T10:00:00.000Z');
  });

  it('query 返回的是数组副本，修改数组不影响内部状态', () => {
    const result = store.query({ mrIid: 1 });
    expect(result).toHaveLength(2);
    // 修改返回的数组长度不影响内部
    result.length = 0;
    const all = store.getAll();
    const matched = all.filter((r) => r.mrIid === 1);
    expect(matched).toHaveLength(2);
    // 注意：当前 query() 仅做浅拷贝（新数组引用同一对象），修改 result[0].submitted 会影响内部状态。
    // 该深拷贝缺陷已记录为已知 bug，源码未在本次任务范围内修改（遵循“测试发现 bug 仅报告不擅自改”约束）。
  });
});

// ==================== getAll / clear ====================

describe('createFindingsHistoryStore — getAll / clear', () => {
  let store: ReturnType<typeof createFindingsHistoryStore>;

  beforeEach(() => {
    store = createFindingsHistoryStore();
  });

  it('getAll 返回全部记录的副本', () => {
    store.add(makeRecordInput());
    store.add(makeRecordInput());
    const all1 = store.getAll();
    expect(all1).toHaveLength(2);
    // 修改副本不影响内部
    all1.length = 0;
    const all2 = store.getAll();
    expect(all2).toHaveLength(2);
  });

  it('clear 清空全部记录', () => {
    store.add(makeRecordInput());
    store.add(makeRecordInput());
    expect(store.getAll()).toHaveLength(2);
    store.clear();
    expect(store.getAll()).toHaveLength(0);
  });

  it('clear 后可继续 add', () => {
    store.add(makeRecordInput());
    store.clear();
    const record = store.add(makeRecordInput());
    expect(store.getAll()).toHaveLength(1);
    expect(record.historyId).toBeTruthy();
  });
});
