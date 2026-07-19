import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ReviewSessionManager,
  executeDag,
  mergeResults,
  shouldSkipImpactAnalysis,
  buildReviewDag,
  withFallback,
  withRetry,
  getReviewContextWithFallback,
  callModelWithTimeout,
  type ReviewSessionConfig,
  type DagNode,
  type DagContext,
} from '../src/orchestrator.js';
import { StateStore } from '../src/state.js';
import type { Finding, FileDiff, MCPContextResult } from '../src/types.js';

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

/** 构造一个测试 FileDiff */
function makeFileDiff(path: string): FileDiff {
  return {
    path,
    status: 'modified',
    hunks: [],
  };
}

/** 延迟工具 */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ============================================================
// 审查会话管理器 ReviewSessionManager
// ============================================================
describe('审查会话管理器 ReviewSessionManager', () => {
  let manager: ReviewSessionManager;

  beforeEach(() => {
    manager = new ReviewSessionManager();
  });

  describe('createReviewSession', () => {
    it('创建审查会话并返回 session_id', () => {
      const id = manager.createReviewSession({ repo: 'owner/repo', prNumber: 1 });
      expect(id).toBeTypeOf('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('自动生成的 session_id 唯一', () => {
      const id1 = manager.createReviewSession({});
      const id2 = manager.createReviewSession({});
      expect(id1).not.toBe(id2);
    });

    it('支持自定义 session_id', () => {
      const id = manager.createReviewSession({ sessionId: 'custom-1' });
      expect(id).toBe('custom-1');
    });

    it('自定义 session_id 冲突时抛出错误', () => {
      manager.createReviewSession({ sessionId: 'dup' });
      expect(() => manager.createReviewSession({ sessionId: 'dup' })).toThrow(/already exists|已存在/);
    });

    it('创建后状态为 pending', () => {
      const id = manager.createReviewSession({});
      expect(manager.getSessionStatus(id)).toBe('pending');
    });

    it('记录待审查文件数', () => {
      const id = manager.createReviewSession({
        files: [makeFileDiff('a.ts'), makeFileDiff('b.ts')],
      });
      const session = manager.getSession(id);
      expect(session?.filesTotal).toBe(2);
    });

    it('记录仓库与 PR 元信息', () => {
      const id = manager.createReviewSession({
        repo: 'owner/repo',
        prNumber: 42,
        commitSha: 'abc123',
      });
      const session = manager.getSession(id);
      expect(session?.repo).toBe('owner/repo');
      expect(session?.prNumber).toBe(42);
      expect(session?.commitSha).toBe('abc123');
    });
  });

  describe('会话状态转换', () => {
    it('pending → running 转换合法', () => {
      const id = manager.createReviewSession({});
      const updated = manager.startSession(id);
      expect(updated?.status).toBe('running');
      expect(manager.getSessionStatus(id)).toBe('running');
    });

    it('running → completed 转换合法', () => {
      const id = manager.createReviewSession({});
      manager.startSession(id);
      const updated = manager.completeSession(id);
      expect(updated?.status).toBe('completed');
      expect(updated?.finishedAt).toBeTypeOf('number');
    });

    it('running → failed 转换合法', () => {
      const id = manager.createReviewSession({});
      manager.startSession(id);
      const updated = manager.failSession(id, 'API error');
      expect(updated?.status).toBe('failed');
      expect(updated?.error).toBe('API error');
    });

    it('pending → failed 转换合法（初始化失败）', () => {
      const id = manager.createReviewSession({});
      const updated = manager.failSession(id, 'init failed');
      expect(updated?.status).toBe('failed');
      expect(updated?.error).toBe('init failed');
    });

    it('pending → completed 非法转换抛出错误', () => {
      const id = manager.createReviewSession({});
      expect(() => manager.completeSession(id)).toThrow(/invalid|非法/);
    });

    it('对不存在的会话 startSession 返回 null', () => {
      expect(manager.startSession('ghost')).toBeNull();
    });

    it('对不存在的会话 completeSession 返回 null', () => {
      expect(manager.completeSession('ghost')).toBeNull();
    });

    it('对不存在的会话 failSession 返回 null', () => {
      expect(manager.failSession('ghost')).toBeNull();
    });
  });

  describe('resumeSession 断点续审', () => {
    it('恢复 running 状态的会话', () => {
      const id = manager.createReviewSession({});
      manager.startSession(id);
      const resumed = manager.resumeSession(id);
      expect(resumed).not.toBeNull();
      expect(resumed?.id).toBe(id);
      expect(resumed?.status).toBe('running');
    });

    it('恢复 pending 状态的会话', () => {
      const id = manager.createReviewSession({});
      const resumed = manager.resumeSession(id);
      expect(resumed).not.toBeNull();
      expect(resumed?.status).toBe('pending');
    });

    it('completed 会话不可恢复', () => {
      const id = manager.createReviewSession({});
      manager.startSession(id);
      manager.completeSession(id);
      expect(manager.resumeSession(id)).toBeNull();
    });

    it('failed 会话不可恢复', () => {
      const id = manager.createReviewSession({});
      manager.startSession(id);
      manager.failSession(id, 'err');
      expect(manager.resumeSession(id)).toBeNull();
    });

    it('cancelled 会话不可恢复', () => {
      const id = manager.createReviewSession({});
      manager.cancelSession(id);
      expect(manager.resumeSession(id)).toBeNull();
    });

    it('不存在的会话返回 null', () => {
      expect(manager.resumeSession('ghost')).toBeNull();
    });

    it('resumeSession 自动将会话转为 running', () => {
      const id = manager.createReviewSession({});
      manager.resumeSession(id);
      expect(manager.getSessionStatus(id)).toBe('running');
    });
  });

  describe('cancelSession 取消会话', () => {
    it('取消 pending 会话', () => {
      const id = manager.createReviewSession({});
      const cancelled = manager.cancelSession(id);
      expect(cancelled).not.toBeNull();
      expect(manager.getSessionStatus(id)).toBe('cancelled');
    });

    it('取消 running 会话', () => {
      const id = manager.createReviewSession({});
      manager.startSession(id);
      const cancelled = manager.cancelSession(id);
      expect(cancelled).not.toBeNull();
      expect(manager.getSessionStatus(id)).toBe('cancelled');
    });

    it('不能取消已完成的会话', () => {
      const id = manager.createReviewSession({});
      manager.startSession(id);
      manager.completeSession(id);
      expect(manager.cancelSession(id)).toBeNull();
      expect(manager.getSessionStatus(id)).toBe('completed');
    });

    it('不能取消已失败的会话', () => {
      const id = manager.createReviewSession({});
      manager.startSession(id);
      manager.failSession(id, 'err');
      expect(manager.cancelSession(id)).toBeNull();
      expect(manager.getSessionStatus(id)).toBe('failed');
    });

    it('不能取消已取消的会话', () => {
      const id = manager.createReviewSession({});
      manager.cancelSession(id);
      expect(manager.cancelSession(id)).toBeNull();
      expect(manager.getSessionStatus(id)).toBe('cancelled');
    });

    it('取消不存在的会话返回 null', () => {
      expect(manager.cancelSession('ghost')).toBeNull();
    });
  });

  describe('getSessionStatus', () => {
    it('返回 pending 状态', () => {
      const id = manager.createReviewSession({});
      expect(manager.getSessionStatus(id)).toBe('pending');
    });

    it('返回 running 状态', () => {
      const id = manager.createReviewSession({});
      manager.startSession(id);
      expect(manager.getSessionStatus(id)).toBe('running');
    });

    it('返回 completed 状态', () => {
      const id = manager.createReviewSession({});
      manager.startSession(id);
      manager.completeSession(id);
      expect(manager.getSessionStatus(id)).toBe('completed');
    });

    it('返回 failed 状态', () => {
      const id = manager.createReviewSession({});
      manager.startSession(id);
      manager.failSession(id, 'err');
      expect(manager.getSessionStatus(id)).toBe('failed');
    });

    it('不存在的会话返回 null', () => {
      expect(manager.getSessionStatus('ghost')).toBeNull();
    });
  });

  describe('使用外部 StateStore', () => {
    it('支持传入自定义 StateStore', () => {
      const store = new StateStore();
      const m = new ReviewSessionManager(store);
      const id = m.createReviewSession({});
      expect(store.getSession(id)).not.toBeNull();
    });

    it('不同 manager 实例数据隔离', () => {
      const m1 = new ReviewSessionManager();
      const m2 = new ReviewSessionManager();
      const id1 = m1.createReviewSession({ sessionId: 'isolated-1' });
      expect(m2.getSession(id1)).toBeNull();
    });
  });
});

// ============================================================
// Agent DAG 编排器
// ============================================================
describe('Agent DAG 编排器 executeDag', () => {
  describe('并行执行', () => {
    it('并行执行无依赖的节点', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;
      const track = () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
      };
      const untrack = () => concurrent--;

      const dag: DagNode<Finding[]>[] = [
        {
          id: 'A', agentType: 'rule-engine', dependencies: [],
          handler: async () => { track(); await delay(30); untrack(); return [makeFinding({ file: 'a.ts' })]; },
        },
        {
          id: 'B', agentType: 'ai-reviewer', dependencies: [],
          handler: async () => { track(); await delay(30); untrack(); return [makeFinding({ file: 'b.ts' })]; },
        },
        {
          id: 'C', agentType: 'security-reviewer', dependencies: [],
          handler: async () => { track(); await delay(30); untrack(); return [makeFinding({ file: 'c.ts' })]; },
        },
      ];
      const context: DagContext = { diffs: [], previousResults: new Map() };
      const result = await executeDag(dag, context);
      expect(maxConcurrent).toBe(3);
      expect(result.results.size).toBe(3);
      expect(result.errors.size).toBe(0);
    });

    it('同一波次的无依赖节点并行执行（验证非串行）', async () => {
      const timestamps: Record<string, number> = {};
      const dag: DagNode<Finding[]>[] = [
        {
          id: 'A', agentType: 'custom', dependencies: [],
          handler: async () => { timestamps.A = Date.now(); await delay(50); return []; },
        },
        {
          id: 'B', agentType: 'custom', dependencies: [],
          handler: async () => { timestamps.B = Date.now(); await delay(50); return []; },
        },
      ];
      const context: DagContext = { diffs: [], previousResults: new Map() };
      await executeDag(dag, context);
      // 两个节点应几乎同时启动（差值远小于 50ms）
      expect(Math.abs(timestamps.A - timestamps.B)).toBeLessThan(40);
    });
  });

  describe('串行执行', () => {
    it('有依赖的节点按拓扑顺序串行执行', async () => {
      const order: string[] = [];
      const makeHandler = (id: string) => async () => {
        order.push(id);
        await delay(10);
        return [makeFinding({ file: `${id}.ts` })];
      };
      // 注意：B 声明在 A 之前，但 B 依赖 A，所以 A 应先执行
      const dag: DagNode<Finding[]>[] = [
        { id: 'B', agentType: 'ai-reviewer', dependencies: ['A'], handler: makeHandler('B') },
        { id: 'A', agentType: 'rule-engine', dependencies: [], handler: makeHandler('A') },
        { id: 'C', agentType: 'security-reviewer', dependencies: ['B'], handler: makeHandler('C') },
      ];
      const context: DagContext = { diffs: [], previousResults: new Map() };
      const result = await executeDag(dag, context);
      expect(order).toEqual(['A', 'B', 'C']);
      expect(result.results.size).toBe(3);
    });

    it('依赖的节点能获取前序节点结果', async () => {
      const dag: DagNode<Finding[]>[] = [
        {
          id: 'A', agentType: 'rule-engine', dependencies: [],
          handler: async () => [makeFinding({ file: 'a.ts', severity: 'high' })],
        },
        {
          id: 'B', agentType: 'ai-reviewer', dependencies: ['A'],
          handler: async (ctx) => {
            const prevA = ctx.previousResults.get('A') as Finding[] | undefined;
            if (prevA && prevA.length > 0) {
              return [makeFinding({ file: 'a.ts', severity: 'critical', message: 'escalated' })];
            }
            return [];
          },
        },
      ];
      const context: DagContext = { diffs: [], previousResults: new Map() };
      const result = await executeDag(dag, context);
      const bResult = result.results.get('B') as Finding[];
      expect(bResult).toHaveLength(1);
      expect(bResult[0].severity).toBe('critical');
    });

    it('混合并行与串行：同一层并行、跨层串行', async () => {
      const order: string[] = [];
      let concurrent = 0;
      let maxConcurrent = 0;
      const makeHandler = (id: string) => async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        order.push(id);
        await delay(20);
        concurrent--;
        return [];
      };
      // Layer 0: A, B (parallel)
      // Layer 1: C (depends on A and B)
      const dag: DagNode<Finding[]>[] = [
        { id: 'A', agentType: 'custom', dependencies: [], handler: makeHandler('A') },
        { id: 'B', agentType: 'custom', dependencies: [], handler: makeHandler('B') },
        { id: 'C', agentType: 'custom', dependencies: ['A', 'B'], handler: makeHandler('C') },
      ];
      const context: DagContext = { diffs: [], previousResults: new Map() };
      await executeDag(dag, context);
      // A 和 B 在 C 之前
      expect(order.indexOf('A')).toBeLessThan(order.indexOf('C'));
      expect(order.indexOf('B')).toBeLessThan(order.indexOf('C'));
      // 第一层并行度 = 2
      expect(maxConcurrent).toBe(2);
    });
  });

  describe('异常处理与部分失败', () => {
    it('部分节点失败时返回部分结果和错误报告', async () => {
      const dag: DagNode<Finding[]>[] = [
        {
          id: 'A', agentType: 'rule-engine', dependencies: [],
          handler: async () => [makeFinding({ file: 'a.ts' })],
        },
        {
          id: 'B', agentType: 'ai-reviewer', dependencies: [],
          handler: async () => { throw new Error('B failed'); },
        },
        {
          id: 'C', agentType: 'security-reviewer', dependencies: [],
          handler: async () => [makeFinding({ file: 'c.ts' })],
        },
      ];
      const context: DagContext = { diffs: [], previousResults: new Map() };
      const result = await executeDag(dag, context);
      expect(result.results.size).toBe(2);
      expect(result.results.has('A')).toBe(true);
      expect(result.results.has('C')).toBe(true);
      expect(result.errors.size).toBe(1);
      expect(result.errors.get('B')?.message).toBe('B failed');
    });

    it('依赖失败节点的后续节点不执行并记录错误', async () => {
      const executed: string[] = [];
      const dag: DagNode<Finding[]>[] = [
        {
          id: 'A', agentType: 'rule-engine', dependencies: [],
          handler: async () => { throw new Error('A failed'); },
        },
        {
          id: 'B', agentType: 'ai-reviewer', dependencies: ['A'],
          handler: async () => { executed.push('B'); return []; },
        },
      ];
      const context: DagContext = { diffs: [], previousResults: new Map() };
      const result = await executeDag(dag, context);
      expect(executed).toEqual([]);
      expect(result.errors.has('A')).toBe(true);
      expect(result.errors.has('B')).toBe(true);
    });

    it('全部节点失败时返回空结果和全部错误', async () => {
      const dag: DagNode<Finding[]>[] = [
        {
          id: 'A', agentType: 'custom', dependencies: [],
          handler: async () => { throw new Error('A down'); },
        },
        {
          id: 'B', agentType: 'custom', dependencies: [],
          handler: async () => { throw new Error('B down'); },
        },
      ];
      const context: DagContext = { diffs: [], previousResults: new Map() };
      const result = await executeDag(dag, context);
      expect(result.results.size).toBe(0);
      expect(result.errors.size).toBe(2);
    });

    it('handler 抛出非 Error 对象时也能捕获', async () => {
      const dag: DagNode<Finding[]>[] = [
        {
          id: 'A', agentType: 'custom', dependencies: [],
          handler: async () => { throw 'string error'; },
        },
      ];
      const context: DagContext = { diffs: [], previousResults: new Map() };
      const result = await executeDag(dag, context);
      expect(result.errors.size).toBe(1);
      expect(result.errors.get('A')).toBeInstanceOf(Error);
    });

    it('检测循环依赖并抛出错误', async () => {
      const dag: DagNode<Finding[]>[] = [
        { id: 'A', agentType: 'custom', dependencies: ['B'], handler: async () => [] },
        { id: 'B', agentType: 'custom', dependencies: ['A'], handler: async () => [] },
      ];
      const context: DagContext = { diffs: [], previousResults: new Map() };
      await expect(executeDag(dag, context)).rejects.toThrow(/cycle|循环/);
    });

    it('检测自依赖循环并抛出错误', async () => {
      const dag: DagNode<Finding[]>[] = [
        { id: 'A', agentType: 'custom', dependencies: ['A'], handler: async () => [] },
      ];
      const context: DagContext = { diffs: [], previousResults: new Map() };
      await expect(executeDag(dag, context)).rejects.toThrow(/cycle|循环/);
    });

    it('依赖不存在的节点时抛出错误', async () => {
      const dag: DagNode<Finding[]>[] = [
        { id: 'A', agentType: 'custom', dependencies: ['ghost'], handler: async () => [] },
      ];
      const context: DagContext = { diffs: [], previousResults: new Map() };
      await expect(executeDag(dag, context)).rejects.toThrow(/unknown|不存在|ghost/);
    });

    it('重复节点 ID 抛出错误', async () => {
      const dag: DagNode<Finding[]>[] = [
        { id: 'A', agentType: 'custom', dependencies: [], handler: async () => [] },
        { id: 'A', agentType: 'custom', dependencies: [], handler: async () => [] },
      ];
      const context: DagContext = { diffs: [], previousResults: new Map() };
      await expect(executeDag(dag, context)).rejects.toThrow(/duplicate|重复/i);
    });

    it('空 DAG 返回空结果', async () => {
      const context: DagContext = { diffs: [], previousResults: new Map() };
      const result = await executeDag([], context);
      expect(result.results.size).toBe(0);
      expect(result.errors.size).toBe(0);
    });

    it('返回执行耗时 durationMs', async () => {
      const dag: DagNode<Finding[]>[] = [
        {
          id: 'A', agentType: 'custom', dependencies: [],
          handler: async () => { await delay(20); return []; },
        },
      ];
      const context: DagContext = { diffs: [], previousResults: new Map() };
      const result = await executeDag(dag, context);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});

// ============================================================
// mergeResults 结果合并与冲突解决
// ============================================================
describe('mergeResults 结果合并', () => {
  it('合并多个 Agent 的 findings', () => {
    const r1 = [makeFinding({ file: 'a.ts', line: 1 })];
    const r2 = [makeFinding({ file: 'b.ts', line: 2 })];
    const merged = mergeResults([r1, r2]);
    expect(merged).toHaveLength(2);
  });

  it('空结果列表返回空数组', () => {
    expect(mergeResults([])).toEqual([]);
  });

  it('包含空数组的列表也能正常合并', () => {
    const merged = mergeResults([[], [makeFinding()], []]);
    expect(merged).toHaveLength(1);
  });

  it('全部为空数组返回空数组', () => {
    expect(mergeResults([[], []])).toEqual([]);
  });

  describe('冲突解决', () => {
    it('相同 file+line 的 findings 取最高 severity', () => {
      const r1 = [makeFinding({ file: 'a.ts', line: 1, severity: 'low' })];
      const r2 = [makeFinding({ file: 'a.ts', line: 1, severity: 'critical' })];
      const merged = mergeResults([r1, r2]);
      expect(merged).toHaveLength(1);
      expect(merged[0].severity).toBe('critical');
    });

    it('多个级别冲突时只保留最高 severity', () => {
      const r1 = [makeFinding({ file: 'a.ts', line: 1, severity: 'low' })];
      const r2 = [makeFinding({ file: 'a.ts', line: 1, severity: 'medium' })];
      const r3 = [makeFinding({ file: 'a.ts', line: 1, severity: 'high' })];
      const r4 = [makeFinding({ file: 'a.ts', line: 1, severity: 'critical' })];
      const merged = mergeResults([r1, r2, r3, r4]);
      expect(merged).toHaveLength(1);
      expect(merged[0].severity).toBe('critical');
    });

    it('相同 file+line 相同最高 severity 的 findings 都保留', () => {
      const r1 = [makeFinding({ file: 'a.ts', line: 1, severity: 'high', category: 'security' })];
      const r2 = [makeFinding({ file: 'a.ts', line: 1, severity: 'high', category: 'performance' })];
      const merged = mergeResults([r1, r2]);
      expect(merged).toHaveLength(2);
      expect(merged.every((f) => f.severity === 'high')).toBe(true);
    });

    it('相同 file+line 但低 severity 的被过滤', () => {
      const r1 = [makeFinding({ file: 'a.ts', line: 1, severity: 'critical', category: 'A' })];
      const r2 = [makeFinding({ file: 'a.ts', line: 1, severity: 'low', category: 'B' })];
      const r3 = [makeFinding({ file: 'a.ts', line: 1, severity: 'medium', category: 'C' })];
      const merged = mergeResults([r1, r2, r3]);
      expect(merged).toHaveLength(1);
      expect(merged[0].severity).toBe('critical');
      expect(merged[0].category).toBe('A');
    });

    it('不同行的 findings 都保留', () => {
      const r1 = [makeFinding({ file: 'a.ts', line: 1 })];
      const r2 = [makeFinding({ file: 'a.ts', line: 2 })];
      const merged = mergeResults([r1, r2]);
      expect(merged).toHaveLength(2);
    });

    it('不同文件的 findings 都保留', () => {
      const r1 = [makeFinding({ file: 'a.ts', line: 1 })];
      const r2 = [makeFinding({ file: 'b.ts', line: 1 })];
      const merged = mergeResults([r1, r2]);
      expect(merged).toHaveLength(2);
    });

    it('info severity 与其它冲突时被淘汰', () => {
      const r1 = [makeFinding({ file: 'a.ts', line: 1, severity: 'info' })];
      const r2 = [makeFinding({ file: 'a.ts', line: 1, severity: 'low' })];
      const merged = mergeResults([r1, r2]);
      expect(merged).toHaveLength(1);
      expect(merged[0].severity).toBe('low');
    });
  });
});

// ============================================================
// shouldSkipImpactAnalysis 动态裁剪
// ============================================================
describe('shouldSkipImpactAnalysis 动态裁剪', () => {
  it('小变更（<5 文件）跳过影响分析', () => {
    expect(shouldSkipImpactAnalysis(0)).toBe(true);
    expect(shouldSkipImpactAnalysis(1)).toBe(true);
    expect(shouldSkipImpactAnalysis(4)).toBe(true);
  });

  it('大变更（>=5 文件）执行影响分析', () => {
    expect(shouldSkipImpactAnalysis(5)).toBe(false);
    expect(shouldSkipImpactAnalysis(10)).toBe(false);
    expect(shouldSkipImpactAnalysis(100)).toBe(false);
  });

  it('支持自定义阈值', () => {
    expect(shouldSkipImpactAnalysis(3, 5)).toBe(true);
    expect(shouldSkipImpactAnalysis(5, 5)).toBe(false);
    expect(shouldSkipImpactAnalysis(2, 3)).toBe(true);
    expect(shouldSkipImpactAnalysis(3, 3)).toBe(false);
  });

  it('阈值为 0 时任何非零变更都不跳过', () => {
    expect(shouldSkipImpactAnalysis(1, 0)).toBe(false);
    expect(shouldSkipImpactAnalysis(0, 0)).toBe(true);
  });
});

// ============================================================
// buildReviewDag DAG 构建
// ============================================================
describe('buildReviewDag DAG 构建', () => {
  it('大变更包含影响分析节点', () => {
    const diffs = Array.from({ length: 6 }, (_, i) => makeFileDiff(`file${i}.ts`));
    const dag = buildReviewDag(diffs);
    const ids = dag.map((n) => n.id);
    expect(ids).toContain('rule-engine');
    expect(ids).toContain('ai-reviewer');
    expect(ids).toContain('impact-analyzer');
  });

  it('小变更（<5 文件）跳过影响分析节点', () => {
    const diffs = [makeFileDiff('a.ts'), makeFileDiff('b.ts')];
    const dag = buildReviewDag(diffs);
    const ids = dag.map((n) => n.id);
    expect(ids).toContain('rule-engine');
    expect(ids).toContain('ai-reviewer');
    expect(ids).not.toContain('impact-analyzer');
  });

  it('恰好 5 个文件包含影响分析节点', () => {
    const diffs = Array.from({ length: 5 }, (_, i) => makeFileDiff(`file${i}.ts`));
    const dag = buildReviewDag(diffs);
    expect(dag.map((n) => n.id)).toContain('impact-analyzer');
  });

  it('支持自定义影响分析阈值', () => {
    const diffs = Array.from({ length: 3 }, (_, i) => makeFileDiff(`file${i}.ts`));
    const dag = buildReviewDag(diffs, { impactThreshold: 3 });
    expect(dag.map((n) => n.id)).toContain('impact-analyzer');
  });

  it('ai-reviewer 依赖 rule-engine', () => {
    const dag = buildReviewDag([makeFileDiff('a.ts')]);
    const aiNode = dag.find((n) => n.id === 'ai-reviewer');
    expect(aiNode?.dependencies).toContain('rule-engine');
  });

  it('小变更 DAG 可执行且 handler 返回空数组', async () => {
    const dag = buildReviewDag([makeFileDiff('a.ts'), makeFileDiff('b.ts')]);
    const context: DagContext = { diffs: [], previousResults: new Map() };
    const result = await executeDag(dag, context);
    expect(result.errors.size).toBe(0);
    expect(result.results.size).toBe(dag.length);
    for (const findings of result.results.values()) {
      expect(findings).toEqual([]);
    }
  });

  it('大变更 DAG 可执行（含 impact-analyzer）', async () => {
    const diffs = Array.from({ length: 6 }, (_, i) => makeFileDiff(`file${i}.ts`));
    const dag = buildReviewDag(diffs);
    const context: DagContext = { diffs: [], previousResults: new Map() };
    const result = await executeDag(dag, context);
    expect(result.errors.size).toBe(0);
    expect(result.results.size).toBe(3);
  });

  it('模型未配置时跳过 ai-reviewer — includeAIReviewer=false', () => {
    const diffs = Array.from({ length: 6 }, (_, i) => makeFileDiff(`file${i}.ts`));
    const dag = buildReviewDag(diffs, { includeAIReviewer: false });
    const ids = dag.map((n) => n.id);
    expect(ids).toContain('rule-engine');
    expect(ids).not.toContain('ai-reviewer');
    expect(ids).toContain('impact-analyzer');
  });

  it('模型未配置时仅 rule-engine — includeAIReviewer=false + includeImpactAnalyzer=false', () => {
    const diffs = Array.from({ length: 6 }, (_, i) => makeFileDiff(`file${i}.ts`));
    const dag = buildReviewDag(diffs, { includeAIReviewer: false, includeImpactAnalyzer: false });
    const ids = dag.map((n) => n.id);
    expect(ids).toEqual(['rule-engine']);
  });

  it('includeImpactAnalyzer=true 时小变更也包含影响分析', () => {
    const diffs = [makeFileDiff('a.ts')];
    const dag = buildReviewDag(diffs, { includeImpactAnalyzer: true });
    const ids = dag.map((n) => n.id);
    expect(ids).toContain('impact-analyzer');
  });

  it('仅 rule-engine 的 DAG 可执行', async () => {
    const diffs = [makeFileDiff('a.ts')];
    const dag = buildReviewDag(diffs, { includeAIReviewer: false, includeImpactAnalyzer: false });
    const context: DagContext = { diffs: [], previousResults: new Map() };
    const result = await executeDag(dag, context);
    expect(result.errors.size).toBe(0);
    expect(result.results.size).toBe(1);
  });
});

// ============================================================
// 异常处理与降级 — withFallback
// ============================================================
describe('withFallback 异常降级', () => {
  it('操作成功时返回结果', async () => {
    const result = await withFallback(
      async () => 42,
      () => 0,
    );
    expect(result).toBe(42);
  });

  it('操作失败时调用降级函数', async () => {
    const result = await withFallback(
      async () => { throw new Error('failed'); },
      () => 'fallback',
    );
    expect(result).toBe('fallback');
  });

  it('降级函数接收原始错误', async () => {
    const originalError = new Error('original');
    let receivedError: Error | null = null;
    await withFallback(
      async () => { throw originalError; },
      (err) => { receivedError = err; return 'fallback'; },
    );
    expect(receivedError).toBe(originalError);
  });

  it('降级函数也失败时抛出降级错误', async () => {
    await expect(
      withFallback(
        async () => { throw new Error('original'); },
        () => { throw new Error('fallback failed'); },
      ),
    ).rejects.toThrow('fallback failed');
  });

  it('降级函数可以返回 Promise（异步降级）', async () => {
    const result = await withFallback(
      async () => { throw new Error('fail'); },
      async () => 'async fallback',
    );
    expect(result).toBe('async fallback');
  });

  it('操作抛出非 Error 对象时降级函数收到 Error 包装', async () => {
    let received: Error | null = null;
    await withFallback(
      async () => { throw 'string error'; },
      (err) => { received = err; return null; },
    );
    expect(received).toBeInstanceOf(Error);
    expect(received?.message).toBe('string error');
  });
});

// ============================================================
// 异常处理与降级 — withRetry 指数退避
// ============================================================
describe('withRetry 指数退避重试', () => {
  it('首次成功不重试', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe('ok');
  });

  it('失败后重试直到成功', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('retry');
        return 'ok';
      },
      { maxRetries: 3, baseDelayMs: 1 },
    );
    expect(calls).toBe(3);
    expect(result).toBe('ok');
  });

  it('超过最大重试次数后抛出最后一次错误', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('always fail');
        },
        { maxRetries: 3, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('always fail');
    // 1 initial + 3 retries = 4 total calls
    expect(calls).toBe(4);
  });

  it('shouldRetry 返回 false 时不重试', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('non-retryable');
        },
        { maxRetries: 3, baseDelayMs: 1, shouldRetry: () => false },
      ),
    ).rejects.toThrow('non-retryable');
    expect(calls).toBe(1);
  });

  it('shouldRetry 基于错误类型判断是否重试', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('rate_limit');
        },
        {
          maxRetries: 3,
          baseDelayMs: 1,
          shouldRetry: (err) => err.message.includes('rate_limit'),
        },
      ),
    ).rejects.toThrow('rate_limit');
    // rate_limit errors should be retried: 1 + 3 = 4
    expect(calls).toBe(4);
  });

  it('默认 maxRetries=3', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('fail');
        },
        { baseDelayMs: 1 },
      ),
    ).rejects.toThrow('fail');
    expect(calls).toBe(4); // 1 initial + 3 retries
  });

  it('maxRetries=0 不重试', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('fail');
        },
        { maxRetries: 0, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('fail');
    expect(calls).toBe(1);
  });

  it('指数退避延迟递增', async () => {
    const delays: number[] = [];
    let calls = 0;
    const start = Date.now();
    await withRetry(
      async () => {
        calls++;
        if (calls <= 2) {
          delays.push(Date.now() - start);
          throw new Error('retry');
        }
        delays.push(Date.now() - start);
        return 'ok';
      },
      { maxRetries: 3, baseDelayMs: 20 },
    ).catch(() => {});
    // 第一次调用在 t≈0，第二次在 t≈20，第三次在 t≈60（20+40）
    expect(delays.length).toBeGreaterThanOrEqual(2);
    if (delays.length >= 2) {
      expect(delays[1]).toBeGreaterThan(delays[0]);
    }
  });
});

// ============================================================
// 异常处理与降级 — MCP 降级
// ============================================================
describe('getReviewContextWithFallback MCP 降级', () => {
  it('MCP 可用时返回 MCP 上下文', async () => {
    const mcpResult: MCPContextResult = {
      filePaths: ['a.ts'],
      codeSnippets: { 'a.ts': 'code' },
      blastRadius: [],
      riskScore: 0.5,
    };
    const result = await getReviewContextWithFallback({
      mcpOperation: async () => mcpResult,
      diffs: [makeFileDiff('a.ts')],
    });
    expect(result.context).toEqual(mcpResult);
    expect(result.fallbackUsed).toBe(false);
    expect(result.fullTextFiles).toEqual(['a.ts']);
  });

  it('MCP 不可用时降级为全文上下文', async () => {
    const result = await getReviewContextWithFallback({
      mcpOperation: async () => { throw new Error('MCP unavailable'); },
      diffs: [makeFileDiff('a.ts'), makeFileDiff('b.ts')],
    });
    expect(result.fallbackUsed).toBe(true);
    expect(result.context).toBeNull();
    expect(result.fullTextFiles).toEqual(['a.ts', 'b.ts']);
  });

  it('MCP 抛出非 Error 对象时也降级', async () => {
    const result = await getReviewContextWithFallback({
      mcpOperation: async () => { throw 'crash'; },
      diffs: [makeFileDiff('a.ts')],
    });
    expect(result.fallbackUsed).toBe(true);
    expect(result.context).toBeNull();
  });

  it('无 diffs 时 fullTextFiles 为空数组', async () => {
    const result = await getReviewContextWithFallback({
      mcpOperation: async () => { throw new Error('down'); },
      diffs: [],
    });
    expect(result.fallbackUsed).toBe(true);
    expect(result.fullTextFiles).toEqual([]);
  });
});

// ============================================================
// 异常处理与降级 — 模型超时降级
// ============================================================
describe('callModelWithTimeout 模型超时降级', () => {
  it('正常返回结果', async () => {
    const result = await callModelWithTimeout({
      operation: async () => [makeFinding({ file: 'a.ts' })],
    });
    expect(result.result).toHaveLength(1);
    expect(result.fallbackUsed).toBe(false);
    expect(result.skipped).toBe(false);
  });

  it('超时时使用降级函数', async () => {
    const result = await callModelWithTimeout({
      operation: async () => { await delay(100); return []; },
      timeoutMs: 10,
      fallback: async () => [makeFinding({ file: 'fallback.ts' })],
    });
    expect(result.fallbackUsed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.result).toHaveLength(1);
    expect(result.result![0].file).toBe('fallback.ts');
  });

  it('超时时无降级函数但 skipOnTimeout=true 则跳过', async () => {
    const result = await callModelWithTimeout<string | null>({
      operation: async () => { await delay(100); return 'never'; },
      timeoutMs: 10,
      skipOnTimeout: true,
    });
    expect(result.skipped).toBe(true);
    expect(result.result).toBeNull();
  });

  it('超时时无降级函数且 skipOnTimeout=false 则抛出错误', async () => {
    await expect(
      callModelWithTimeout({
        operation: async () => { await delay(100); return []; },
        timeoutMs: 10,
      }),
    ).rejects.toThrow(/timeout|超时/);
  });

  it('操作失败（非超时）时使用降级函数', async () => {
    const result = await callModelWithTimeout({
      operation: async () => { throw new Error('model error'); },
      fallback: () => [],
    });
    expect(result.fallbackUsed).toBe(true);
    expect(result.reason).toBe('model error');
  });

  it('不设置 timeoutMs 时不应用超时', async () => {
    const result = await callModelWithTimeout({
      operation: async () => { await delay(30); return 'ok'; },
    });
    expect(result.result).toBe('ok');
    expect(result.fallbackUsed).toBe(false);
  });

  it('操作抛出非 Error 对象且无降级时抛出包装错误', async () => {
    await expect(
      callModelWithTimeout({
        operation: async () => { throw 'string error'; },
      }),
    ).rejects.toThrow('string error');
  });
});
