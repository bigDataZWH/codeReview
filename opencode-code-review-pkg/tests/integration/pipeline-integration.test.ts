import { describe, it, expect } from 'vitest';
import { runPipeline, applyFindings } from '../../src/pipeline.js';
import { correctLineLocations } from '../../src/post-processor.js';
import { parseDiff } from '../../src/diff-parser.js';
import type { Finding, PipelineConfig, Rule } from '../../src/types.js';

const MULTI_FILE_DIFF = `diff --git a/src/auth/login.ts b/src/auth/login.ts
index abc1234..def5678 100644
--- a/src/auth/login.ts
+++ b/src/auth/login.ts
@@ -1,6 +1,7 @@
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
      { type: 'regex' as const, pattern: 'SELECT.*\\+.*req\\.', message: '字符串拼接 SQL 存在注入风险' },
    ],
  },
  {
    id: 'console-log',
    name: 'console.log 检测',
    severity: 'low',
    category: 'quality',
    patterns: [
      { type: 'regex' as const, pattern: 'console\\.log', message: '禁止使用 console.log' },
    ],
  },
  {
    id: 'any-type',
    name: 'any 类型检测',
    severity: 'medium',
    category: 'quality',
    language: ['typescript'],
    patterns: [
      { type: 'regex' as const, pattern: ':\\s*any\\b', message: '禁止使用 any 类型' },
    ],
  },
];

describe('集成测试：端到端管道', () => {
  const baseConfig: PipelineConfig = {
    filter: { ignorePatterns: ['*.md'] },
    bundle: { bundles: [] },
    rules: SECURITY_RULES,
  };

  it('完整管道：解析 → 过滤 → 规则匹配 → prompt 生成', async () => {
    const result = await runPipeline(MULTI_FILE_DIFF, baseConfig);

    // 应过滤掉 README.md
    expect(result.filteredDiffs.length).toBe(2);
    expect(result.filteredDiffs.every(d => !d.path.endsWith('.md'))).toBe(true);

    // 新增文件应保留
    expect(result.filteredDiffs.some(d => d.path.includes('helpers.ts'))).toBe(true);

    // prompt 应包含 diff 内容
    expect(result.prompt).toContain('login.ts');
    expect(result.prompt).toContain('helpers.ts');
    expect(result.prompt).not.toContain('README.md');

    // 应有规则标注
    const allAnnotations = result.annotatedBundles.flatMap(b => b.annotations);
    expect(allAnnotations.length).toBeGreaterThan(0);

    // SQL 注入规则应匹配
    const sqlAnnotations = allAnnotations.filter(a => a.ruleId === 'sql-injection');
    expect(sqlAnnotations.length).toBeGreaterThan(0);
  });

  it('管道 + 后处理：规则 findings 经过定位修正和误报过滤', async () => {
    const result = await runPipeline(MULTI_FILE_DIFF, baseConfig);
    const diffs = result.filteredDiffs;

    // 将规则标注转为 findings
    const findings: Finding[] = result.annotatedBundles
      .flatMap(b => b.annotations)
      .map(a => ({
        file: 'src/auth/login.ts',
        line: 100, // 故意设置超出 hunk 范围的行号
        severity: a.severity,
        category: a.category,
        message: a.message,
        confidence: 0.8,
        source: 'rule' as const,
        ruleId: a.ruleId,
      }));

    // 定位修正
    const corrected = correctLineLocations(findings, diffs);
    expect(corrected.length).toBe(findings.length);
    // 修正后的行号应在 hunk 范围内
    for (const f of corrected) {
      const fileDiff = diffs.find(d => d.path === f.file);
      if (fileDiff) {
        const inHunk = fileDiff.hunks.some(
          h => f.line >= h.newStart && f.line < h.newStart + h.newCount
        );
        expect(inHunk).toBe(true);
      }
    }
  });

  it('完整管道 with applyFindings：端到端审查流程', async () => {
    const result = await runPipeline(MULTI_FILE_DIFF, baseConfig);

    // 模拟 AI 返回的 findings
    const aiFindings: Finding[] = [
      {
        file: 'src/auth/login.ts',
        line: 3,
        severity: 'high',
        category: 'security',
        message: '缺少输入验证',
        confidence: 0.9,
        source: 'ai',
      },
      {
        file: 'src/auth/login.ts',
        line: 5,
        severity: 'low',
        category: 'quality',
        message: '建议添加 JSDoc',
        confidence: 0.6,
        source: 'ai',
      },
      {
        file: 'src/utils/helpers.ts',
        line: 5,
        severity: 'info',
        category: 'quality',
        message: 'console.log 应移除',
        confidence: 0.5,
        source: 'ai',
      },
    ];

    const finalResult = applyFindings(result, aiFindings);

    // processedFindings 应存在
    expect(finalResult.processedFindings).toBeDefined();
    expect(finalResult.processedFindings!.length).toBeGreaterThan(0);

    // 高置信度 finding 应保留
    const highConfidence = finalResult.processedFindings!.filter(f => f.confidence >= 0.85);
    expect(highConfidence.length).toBeGreaterThanOrEqual(1);
  });

  it('空 diff 的管道处理', async () => {
    const result = await runPipeline('', baseConfig);
    expect(result.filteredDiffs).toHaveLength(0);
    expect(result.bundles).toHaveLength(0);
    expect(result.annotatedBundles).toHaveLength(0);
  });

  it('管道结果可 JSON 序列化', async () => {
    const result = await runPipeline(MULTI_FILE_DIFF, baseConfig);
    const aiFindings: Finding[] = [
      {
        file: 'src/auth/login.ts',
        line: 3,
        severity: 'medium',
        category: 'quality',
        message: '测试 finding',
        confidence: 0.8,
        source: 'ai',
      },
    ];
    const final = applyFindings(result, aiFindings);

    // 不应抛出错误
    expect(() => JSON.stringify(final)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(final));
    expect(parsed.filteredDiffs).toBeInstanceOf(Array);
    expect(parsed.prompt).toBeTypeOf('string');
  });
});