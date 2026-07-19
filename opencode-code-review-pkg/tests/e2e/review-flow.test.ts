import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDiff } from '../../src/diff-parser.js';
import { filterFiles, bundleFiles } from '../../src/file-filter.js';
import { matchRules } from '../../src/rule-engine.js';
import { runPipeline, applyFindings } from '../../src/pipeline.js';
import {
  correctLineLocations,
  filterFalsePositives,
  deduplicateFindings,
  filterBySeverity,
  sortBySeverity,
  groupByFile,
} from '../../src/post-processor.js';
import { StateStore } from '../../src/state.js';
import { ReviewSessionManager } from '../../src/orchestrator.js';
import { formatFindingsMarkdown, formatFindingsJSON } from '../../src/format.js';
import type { Rule, Finding, PipelineConfig } from '../../src/types.js';

// ── 测试 fixtures ──

const MULTI_FILE_DIFF = `diff --git a/src/auth/login.ts b/src/auth/login.ts
index abc1234..def5678 100644
--- a/src/auth/login.ts
+++ b/src/auth/login.ts
@@ -1,6 +1,8 @@
 import { Router } from 'express';
+import { createUser } from './user';

 export async function loginHandler(req: any, res: any) {
-  const sql = "SELECT * FROM users WHERE name = '" + req.body.username + "'";
+  const { username, password } = req.body;
+  const user = await createUser(username, password);
   console.log("Login attempt");
   return user;
 }
@@ -15,4 +16,5 @@
 export function getToken(req: any): string {
-  return req.headers.authorization;
+  const auth = req.headers.authorization;
+  if (!auth) throw new Error('Missing auth');
+  return auth;
 }

diff --git a/src/utils/helpers.ts b/src/utils/helpers.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/utils/helpers.ts
@@ -0,0 +1,5 @@
+export function formatDate(d: Date): string {
+  return d.toISOString().split('T')[0];
+}
+
+console.log('debug');

diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,4 @@
 # My App
+
 A great application.
-Old line
+Updated line
`;

const SECURITY_RULES: Rule[] = [
  {
    id: 'sql-injection',
    name: 'SQL 注入检测',
    severity: 'high',
    category: 'security',
    patterns: [
      { type: 'regex', pattern: 'SELECT.*\\+.*req\\.', message: '字符串拼接 SQL 存在注入风险' },
    ],
  },
  {
    id: 'console-log',
    name: 'console.log 检测',
    severity: 'low',
    category: 'quality',
    patterns: [
      { type: 'regex', pattern: 'console\\.log', message: '禁止使用 console.log' },
    ],
  },
  {
    id: 'any-type',
    name: 'any 类型检测',
    severity: 'medium',
    category: 'quality',
    language: ['typescript'],
    patterns: [
      { type: 'regex', pattern: ':\\s*any\\b', message: '禁止使用 any 类型' },
    ],
  },
];

// ── E2E 完整审查流程 ──

describe('E2E：完整审查流程', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'e2e-review-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('完整链路：diff 解析 → 文件过滤 → 规则匹配 → 管道编排 → 后处理 → 输出', async () => {
    // ============ 1. diff 解析 ============
    const allDiffs = parseDiff(MULTI_FILE_DIFF);
    expect(allDiffs.length).toBe(3);
    expect(allDiffs.map((d) => d.path).sort()).toEqual([
      'README.md',
      'src/auth/login.ts',
      'src/utils/helpers.ts',
    ]);

    // ============ 2. 文件过滤（过滤掉 README.md）============
    const filterConfig = { ignorePatterns: ['*.md'] };
    const filteredDiffs = filterFiles(allDiffs, filterConfig);
    expect(filteredDiffs.length).toBe(2);
    expect(filteredDiffs.every((d) => !d.path.endsWith('.md'))).toBe(true);

    // 新增文件应保留
    const helpers = filteredDiffs.find((d) => d.path.includes('helpers.ts'));
    expect(helpers).toBeDefined();
    expect(helpers?.status).toBe('added');

    // ============ 3. 文件打包 ============
    const bundles = bundleFiles(filteredDiffs, { bundles: [] });
    expect(bundles.length).toBeGreaterThan(0);

    // ============ 4. 规则匹配 ============
    const annotatedBundles = bundles.map((bundle) => {
      const annotations = matchRules(bundle, SECURITY_RULES);
      return { ...bundle, annotations: [...bundle.annotations, ...annotations] };
    });

    const allAnnotations = annotatedBundles.flatMap((b) => b.annotations);
    expect(allAnnotations.length).toBeGreaterThan(0);

    // SQL 注入规则应匹配
    const sqlAnnotations = allAnnotations.filter((a) => a.ruleId === 'sql-injection');
    expect(sqlAnnotations.length).toBeGreaterThan(0);

    // console.log 规则应匹配
    const consoleAnnotations = allAnnotations.filter((a) => a.ruleId === 'console-log');
    expect(consoleAnnotations.length).toBeGreaterThan(0);

    // ============ 5. 管道编排（用 runPipeline 完成上述链路）============
    const pipelineConfig: PipelineConfig = {
      filter: filterConfig,
      rules: SECURITY_RULES,
    };
    const pipelineResult = await runPipeline(MULTI_FILE_DIFF, pipelineConfig);

    // 验证管道结果一致性
    expect(pipelineResult.filteredDiffs.length).toBe(2);
    expect(pipelineResult.annotatedBundles.flatMap((b) => b.annotations).length).toBeGreaterThan(0);
    expect(pipelineResult.prompt).toContain('login.ts');
    expect(pipelineResult.prompt).toContain('helpers.ts');
    expect(pipelineResult.prompt).not.toContain('README.md');

    // ============ 6. 后处理 ============
    // 6.1 模拟 AI 返回的 findings（含行号偏移）
    const aiFindings: Finding[] = [
      {
        file: 'src/auth/login.ts',
        line: 100, // 故意设置超出 hunk 范围
        severity: 'high',
        category: 'security',
        message: '缺少输入验证',
        confidence: 0.9,
        source: 'ai',
      },
      {
        file: 'src/utils/helpers.ts',
        line: 5,
        severity: 'low',
        category: 'quality',
        message: 'console.log 应移除',
        confidence: 0.6,
        source: 'ai',
      },
      {
        file: 'src/auth/login.ts',
        line: 3,
        severity: 'low',
        category: 'quality',
        message: 'TODO: 需要补充日志级别',
        confidence: 0.4,
        source: 'ai',
      },
    ];

    // 6.2 定位修正（行号 clamp 到 hunk 范围内）
    const corrected = correctLineLocations(aiFindings, pipelineResult.filteredDiffs);
    expect(corrected.length).toBe(aiFindings.length);

    // 修正后的行号应在 hunk 范围内
    for (const f of corrected) {
      const fileDiff = pipelineResult.filteredDiffs.find((d) => d.path === f.file);
      if (fileDiff && fileDiff.hunks.length > 0) {
        const inHunk = fileDiff.hunks.some(
          (h) => f.line >= h.newStart && f.line < h.newStart + h.newCount,
        );
        expect(inHunk).toBe(true);
      }
    }

    // 6.3 误报过滤（TODO/log-level 类的 low confidence 会被过滤）
    const filtered = filterFalsePositives(corrected);
    // TODO 类的 low confidence 应被过滤
    expect(filtered.some((f) => f.message.includes('TODO'))).toBe(false);
    // 高置信度 finding 应保留
    expect(filtered.some((f) => f.confidence >= 0.85)).toBe(true);

    // 6.4 按严重度排序
    const sorted = sortBySeverity(filtered);
    for (let i = 1; i < sorted.length; i++) {
      const sevOrder = (s: string): number =>
        ({ critical: 4, high: 3, medium: 2, low: 1, info: 0 }[s] ?? -1);
      expect(sevOrder(sorted[i - 1].severity)).toBeGreaterThanOrEqual(sevOrder(sorted[i].severity));
    }

    // 6.5 按文件分组
    const byFile = groupByFile(sorted);
    expect(byFile.size).toBeGreaterThan(0);
    expect(byFile.has('src/auth/login.ts')).toBe(true);

    // 6.6 严重度过滤
    const highOnly = filterBySeverity(sorted, 'high');
    expect(highOnly.every((f) => ['critical', 'high'].includes(f.severity))).toBe(true);

    // 6.7 去重
    const deduped = deduplicateFindings(sorted, [
      { file: 'src/auth/login.ts', line: sorted[0]?.line ?? 0, body: sorted[0]?.message ?? '' },
    ]);
    expect(deduped.length).toBeLessThanOrEqual(sorted.length);

    // ============ 7. applyFindings 完整流程 ============
    const finalResult = applyFindings(pipelineResult, aiFindings);
    expect(finalResult.processedFindings).toBeDefined();
    expect(finalResult.processedFindings!.length).toBeGreaterThan(0);
    expect(finalResult.findings).toEqual(aiFindings);

    // ============ 8. 输出格式化 ============
    // 8.1 Markdown 输出
    const markdown = formatFindingsMarkdown(finalResult.processedFindings!);
    expect(markdown).toContain('Code Review Report');
    expect(markdown).toContain('Summary');

    // 8.2 JSON 输出
    const json = formatFindingsJSON(finalResult.processedFindings!);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(finalResult.processedFindings!.length);

    // 8.3 结果可序列化
    expect(() => JSON.stringify(finalResult)).not.toThrow();
  });

  it('state 持久化会话和 findings', () => {
    const stateFile = join(tmpDir, 'state.json');
    const store = new StateStore({ persistFile: stateFile });

    // 创建会话
    const session = store.createSession({
      id: 'e2e-session-1',
      filesTotal: 2,
      repo: 'owner/repo',
      prNumber: 42,
    });
    expect(session.status).toBe('pending');

    // 启动会话
    store.updateSessionStatus('e2e-session-1', 'running');
    expect(store.getSession('e2e-session-1')?.status).toBe('running');

    // 保存 findings
    const findings: Finding[] = [
      {
        file: 'src/app.ts',
        line: 10,
        severity: 'high',
        category: 'security',
        message: 'sql injection',
        confidence: 0.9,
        source: 'rule',
      },
      {
        file: 'src/app.ts',
        line: 20,
        severity: 'low',
        category: 'quality',
        message: 'console.log',
        confidence: 0.7,
        source: 'rule',
      },
    ];
    const saved = store.saveFindings('e2e-session-1', findings);
    expect(saved).toBe(2);

    // 查询 findings
    const retrieved = store.getFindingsBySession('e2e-session-1');
    expect(retrieved.length).toBe(2);

    // 按文件查询（需指定 sessionId 或使用 allSessions 选项）
    const byFile = store.getFindingsByFile('e2e-session-1', 'src/app.ts');
    expect(byFile.length).toBe(2);

    // 跨会话按文件查询
    const byFileAll = store.getFindingsByFile('src/app.ts', undefined, { allSessions: true });
    expect(byFileAll.length).toBe(2);

    // 完成会话
    store.updateSessionStatus('e2e-session-1', 'completed');
    expect(store.getSession('e2e-session-1')?.status).toBe('completed');

    // 关闭后从磁盘重新加载
    store.close();
    const restored = new StateStore({ persistFile: stateFile });
    const restoredSession = restored.getSession('e2e-session-1');
    expect(restoredSession?.status).toBe('completed');
    expect(restoredSession?.filesTotal).toBe(2);
    expect(restored.getFindingsBySession('e2e-session-1').length).toBe(2);
  });

  it('orchestrator 管理会话状态转换', () => {
    const manager = new ReviewSessionManager();

    // 创建会话
    const id = manager.createReviewSession({
      repo: 'owner/repo',
      prNumber: 1,
      files: [
        { path: 'a.ts', status: 'modified', hunks: [] },
        { path: 'b.ts', status: 'modified', hunks: [] },
      ],
    });
    expect(manager.getSessionStatus(id)).toBe('pending');

    // 启动 → 运行中
    manager.startSession(id);
    expect(manager.getSessionStatus(id)).toBe('running');

    // 完成
    manager.completeSession(id);
    expect(manager.getSessionStatus(id)).toBe('completed');

    // 终态不可取消
    expect(manager.cancelSession(id)).toBeNull();
  });

  it('orchestrator 完整生命周期含失败场景', () => {
    const manager = new ReviewSessionManager();
    const id = manager.createReviewSession({ repo: 'o/r', prNumber: 1 });

    // 启动后失败
    manager.startSession(id);
    manager.failSession(id, 'pipeline error');
    expect(manager.getSessionStatus(id)).toBe('failed');
    expect(manager.getSession(id)?.error).toBe('pipeline error');

    // 失败的会话不可恢复
    expect(manager.resumeSession(id)).toBeNull();
  });

  it('orchestrator 取消会话', () => {
    const manager = new ReviewSessionManager();
    const id = manager.createReviewSession({});

    // pending → cancelled
    manager.cancelSession(id);
    expect(manager.getSessionStatus(id)).toBe('cancelled');

    // 已取消的会话不可恢复
    expect(manager.resumeSession(id)).toBeNull();

    // 已取消的会话不可重复取消
    expect(manager.cancelSession(id)).toBeNull();
  });

  it('orchestrator 断点续审', () => {
    const manager = new ReviewSessionManager();
    const id1 = manager.createReviewSession({});
    const id2 = manager.createReviewSession({});

    // id1 仍为 pending，恢复时应转为 running
    const resumed1 = manager.resumeSession(id1);
    expect(resumed1?.status).toBe('pending'); // 返回转换前的快照
    expect(manager.getSessionStatus(id1)).toBe('running');

    // id2 先启动再恢复
    manager.startSession(id2);
    const resumed2 = manager.resumeSession(id2);
    expect(resumed2?.status).toBe('running');
    expect(manager.getSessionStatus(id2)).toBe('running');
  });

  it('空 diff 完整流程不报错', async () => {
    const result = await runPipeline('', { filter: {}, rules: SECURITY_RULES });
    expect(result.filteredDiffs).toHaveLength(0);
    expect(result.bundles).toHaveLength(0);
    expect(result.annotatedBundles).toHaveLength(0);
    expect(result.prompt).toBeTypeOf('string');

    const final = applyFindings(result, []);
    expect(final.processedFindings).toEqual([]);
  });

  it('dryRun 模式只执行到 prompt 构建阶段', async () => {
    const result = await runPipeline(MULTI_FILE_DIFF, {
      filter: { ignorePatterns: ['*.md'] },
      rules: SECURITY_RULES,
      dryRun: true,
    });
    expect(result.findings).toEqual([]);
    expect(result.prompt).toContain('login.ts');
  });
});
