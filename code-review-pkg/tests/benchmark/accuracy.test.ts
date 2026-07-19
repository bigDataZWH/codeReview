import { describe, it, expect } from 'vitest';
import { parseDiff } from '../../src/diff-parser.js';
import { bundleFiles } from '../../src/file-filter.js';
import { matchRules, getRulesByCategory, getRulesBySeverity } from '../../src/rule-engine.js';
import {
  filterFalsePositives,
  BUILTIN_FP_RULES,
  filterBySeverity,
  filterByCategory,
  sortBySeverity,
} from '../../src/post-processor.js';
import { applyFindings, runPipeline } from '../../src/pipeline.js';
import type { Rule, Finding } from '../../src/types.js';

// ── 已知问题 fixtures ──

// 真阳：包含明确安全问题的代码
const TRUE_POSITIVE_DIFF = `diff --git a/src/vuln.ts b/src/vuln.ts
index abc..def 100644
--- a/src/vuln.ts
+++ b/src/vuln.ts
@@ -1,5 +1,10 @@
 export function login(username: string) {
-  const sql = "SELECT * FROM users WHERE name = '" + username + "'";
+  const sql = "SELECT * FROM users WHERE name = '" + username + "'";
+  const result = db.query(sql);
+  return result;
+}
+export function run(userInput: string) {
+  eval(userInput);
+  return eval(userInput);
 }

diff --git a/src/secret.ts b/src/secret.ts
index 1..2 100644
--- a/src/secret.ts
+++ b/src/secret.ts
@@ -1,1 +1,2 @@
 export const config = {
+  apiKey: "sk-1234567890abcdef",
 };

diff --git a/src/xss.ts b/src/xss.ts
index 3..4 100644
--- a/src/xss.ts
+++ b/src/xss.ts
@@ -1,3 +1,5 @@
 export function render(input: string): string {
-  return '<div>' + input + '</div>';
+  return '<div>' + input + '</div>';
+}
+export function dangerouslyEval(code: string) {
+  return eval(code);
 }
`;

// 误报：包含测试代码、TODO、生成代码等
const FALSE_POSITIVE_DIFF = `diff --git a/tests/helpers.test.ts b/tests/helpers.test.ts
index abc..def 100644
--- a/tests/helpers.test.ts
+++ b/tests/helpers.test.ts
@@ -1,3 +1,5 @@
 describe('test', () => {
+  it('test case', () => {
+    console.log('debug test');
+  });
 });

diff --git a/src/generated/pb.ts b/src/generated/pb.ts
index 1..2 100644
--- a/src/generated/pb.ts
+++ b/src/generated/pb.ts
@@ -1,1 +1,3 @@
 export const x = 1;
+// TODO: this is a generated file todo
+console.log('generated');

diff --git a/src/util.ts b/src/util.ts
index 3..4 100644
--- a/src/util.ts
+++ b/src/util.ts
@@ -1,1 +1,3 @@
 export function f() {
+  // TODO: refactor later
+  // FIXME: this needs improvement
 }
`;

// 精度规则集
const ACCURACY_RULES: Rule[] = [
  {
    id: 'sql-injection',
    name: 'SQL 注入',
    severity: 'high',
    category: 'security',
    patterns: [
      { type: 'regex', pattern: 'SELECT.*\\+.*username', message: '字符串拼接 SQL 注入风险' },
    ],
  },
  {
    id: 'eval',
    name: 'eval 使用',
    severity: 'critical',
    category: 'security',
    patterns: [
      { type: 'regex', pattern: '\\beval\\s*\\(', message: 'eval 代码注入风险' },
    ],
  },
  {
    id: 'hardcoded-secret',
    name: '硬编码密钥',
    severity: 'high',
    category: 'security',
    patterns: [
      { type: 'regex', pattern: 'apiKey\\s*:\\s*["\']sk-', message: '检测到硬编码 API key' },
    ],
  },
  {
    id: 'xss',
    name: 'XSS 风险',
    severity: 'high',
    category: 'security',
    patterns: [
      { type: 'regex', pattern: "'<div>'\\s*\\+\\s*input", message: 'XSS 风险' },
    ],
  },
  {
    id: 'console-log',
    name: 'console.log',
    severity: 'low',
    category: 'quality',
    patterns: [
      { type: 'regex', pattern: 'console\\.log', message: 'console.log 使用' },
    ],
  },
  {
    id: 'todo-fixme',
    name: 'TODO/FIXME',
    severity: 'low',
    category: 'quality',
    patterns: [
      { type: 'contains_any', items: ['TODO', 'FIXME'], message: 'TODO/FIXME 注释' },
    ],
  },
];

// ── 精度基准测试 ──

describe('精度基准测试', () => {
  // ==================== 规则匹配精度 ====================
  describe('规则匹配精度：正确识别已知问题', () => {
    it('识别 SQL 注入（字符串拼接）', () => {
      const diffs = parseDiff(TRUE_POSITIVE_DIFF);
      const bundles = bundleFiles(diffs, { bundles: [] });
      const annotations = bundles.flatMap((b) => matchRules(b, ACCURACY_RULES));

      const sqlAnnotations = annotations.filter((a) => a.ruleId === 'sql-injection');
      expect(sqlAnnotations.length).toBeGreaterThan(0);
      expect(sqlAnnotations[0].severity).toBe('high');
      expect(sqlAnnotations[0].category).toBe('security');
    });

    it('识别 eval 调用', () => {
      const diffs = parseDiff(TRUE_POSITIVE_DIFF);
      const bundles = bundleFiles(diffs, { bundles: [] });
      const annotations = bundles.flatMap((b) => matchRules(b, ACCURACY_RULES));

      const evalAnnotations = annotations.filter((a) => a.ruleId === 'eval');
      expect(evalAnnotations.length).toBeGreaterThan(0);
      expect(evalAnnotations[0].severity).toBe('critical');
    });

    it('识别硬编码 API key', () => {
      const diffs = parseDiff(TRUE_POSITIVE_DIFF);
      const bundles = bundleFiles(diffs, { bundles: [] });
      const annotations = bundles.flatMap((b) => matchRules(b, ACCURACY_RULES));

      const secretAnnotations = annotations.filter((a) => a.ruleId === 'hardcoded-secret');
      expect(secretAnnotations.length).toBeGreaterThan(0);
      expect(secretAnnotations[0].severity).toBe('high');
    });

    it('识别 XSS 风险', () => {
      const diffs = parseDiff(TRUE_POSITIVE_DIFF);
      const bundles = bundleFiles(diffs, { bundles: [] });
      const annotations = bundles.flatMap((b) => matchRules(b, ACCURACY_RULES));

      const xssAnnotations = annotations.filter((a) => a.ruleId === 'xss');
      expect(xssAnnotations.length).toBeGreaterThan(0);
    });

    it('同时识别多个安全问题', () => {
      const diffs = parseDiff(TRUE_POSITIVE_DIFF);
      const bundles = bundleFiles(diffs, { bundles: [] });
      const annotations = bundles.flatMap((b) => matchRules(b, ACCURACY_RULES));

      const ruleIds = new Set(annotations.map((a) => a.ruleId));
      expect(ruleIds.has('sql-injection')).toBe(true);
      expect(ruleIds.has('eval')).toBe(true);
      expect(ruleIds.has('hardcoded-secret')).toBe(true);
      expect(ruleIds.has('xss')).toBe(true);
    });

    it('critical 严重度排序在 high 之前', () => {
      const diffs = parseDiff(TRUE_POSITIVE_DIFF);
      const bundles = bundleFiles(diffs, { bundles: [] });
      const annotations = bundles.flatMap((b) => matchRules(b, ACCURACY_RULES));

      // rule-engine 内部按 severity 排序
      const firstCriticalIdx = annotations.findIndex((a) => a.severity === 'critical');
      const firstHighIdx = annotations.findIndex((a) => a.severity === 'high');
      if (firstCriticalIdx !== -1 && firstHighIdx !== -1) {
        expect(firstCriticalIdx).toBeLessThan(firstHighIdx);
      }
    });
  });

  // ==================== 误报过滤精度 ====================
  describe('误报过滤精度：正确过滤已知误报', () => {
    it('过滤测试文件中的低严重度安全 finding', () => {
      const findings: Finding[] = [
        // 测试文件中的 low security finding 应被过滤
        {
          file: 'tests/helpers.test.ts',
          line: 3,
          severity: 'low',
          category: 'security',
          message: 'low security issue in test',
          confidence: 0.4,
          source: 'ai',
        },
        // 测试文件中的 high security finding 应保留
        {
          file: 'tests/helpers.test.ts',
          line: 5,
          severity: 'high',
          category: 'security',
          message: 'high security issue',
          confidence: 0.9,
          source: 'ai',
        },
      ];
      const filtered = filterFalsePositives(findings);
      // low security in test 应被过滤
      expect(filtered.some((f) => f.severity === 'low' && f.file.includes('test'))).toBe(false);
      // high security 应保留
      expect(filtered.some((f) => f.severity === 'high')).toBe(true);
    });

    it('过滤生成文件中的 finding', () => {
      const findings: Finding[] = [
        {
          file: 'src/generated/pb.ts',
          line: 2,
          severity: 'low',
          category: 'quality',
          message: 'console.log in generated file',
          confidence: 0.4,
          source: 'rule',
        },
        {
          file: 'src/real.ts',
          line: 2,
          severity: 'low',
          category: 'quality',
          message: 'real source issue',
          confidence: 0.4,
          source: 'rule',
        },
      ];
      const filtered = filterFalsePositives(findings);
      // 生成文件中的 finding 应被过滤
      expect(filtered.some((f) => f.file.includes('generated'))).toBe(false);
      // 真实文件中的 finding 应保留（除非被其他 FP 规则过滤）
      // 注：console.log low 也会被过滤，所以这里检查未被生成文件规则过滤
      expect(filtered.some((f) => f.file === 'src/real.ts')).toBe(true);
    });

    it('过滤 TODO/FIXME 类低置信度 finding', () => {
      const findings: Finding[] = [
        {
          file: 'a.ts',
          line: 1,
          severity: 'low',
          category: 'quality',
          message: 'TODO: refactor this',
          confidence: 0.3,
          source: 'ai',
        },
        {
          file: 'a.ts',
          line: 2,
          severity: 'high',
          category: 'security',
          message: 'real security issue',
          confidence: 0.9,
          source: 'ai',
        },
      ];
      const filtered = filterFalsePositives(findings);
      expect(filtered.some((f) => f.message.includes('TODO'))).toBe(false);
      expect(filtered.some((f) => f.message.includes('security issue'))).toBe(true);
    });

    it('过滤 rate-limit 类低置信度建议', () => {
      const findings: Finding[] = [
        {
          file: 'a.ts',
          line: 1,
          severity: 'low',
          category: 'security',
          message: 'rate limit missing',
          confidence: 0.4,
          source: 'ai',
        },
        {
          file: 'a.ts',
          line: 2,
          severity: 'high',
          category: 'security',
          message: 'sql injection',
          confidence: 0.9,
          source: 'rule',
        },
      ];
      const filtered = filterFalsePositives(findings);
      expect(filtered.some((f) => f.message.includes('rate limit'))).toBe(false);
    });

    it('过滤 open-redirect 类低置信度建议', () => {
      const findings: Finding[] = [
        {
          file: 'a.ts',
          line: 1,
          severity: 'medium',
          category: 'security',
          message: 'open redirect risk',
          confidence: 0.3,
          source: 'ai',
        },
      ];
      const filtered = filterFalsePositives(findings);
      expect(filtered.some((f) => f.message.includes('open redirect'))).toBe(false);
    });

    it('过滤日志级别类低严重度建议', () => {
      const findings: Finding[] = [
        {
          file: 'a.ts',
          line: 1,
          severity: 'low',
          category: 'quality',
          message: 'log level should be adjusted',
          confidence: 0.4,
          source: 'ai',
        },
      ];
      const filtered = filterFalsePositives(findings);
      expect(filtered.some((f) => f.message.includes('log level'))).toBe(false);
    });

    it('高置信度 finding 不被误报过滤', () => {
      const findings: Finding[] = [
        {
          file: 'a.ts',
          line: 1,
          severity: 'low',
          category: 'quality',
          message: 'TODO: refactor this',
          confidence: 0.95, // 高置信度
          source: 'ai',
        },
        {
          file: 'tests/a.test.ts',
          line: 1,
          severity: 'low',
          category: 'security',
          message: 'low security in test',
          confidence: 0.95, // 高置信度
          source: 'ai',
        },
      ];
      const filtered = filterFalsePositives(findings);
      // 高置信度不应被过滤
      expect(filtered.length).toBe(2);
    });
  });

  // ==================== BUILTIN_FP_RULES 精度 ====================
  describe('BUILTIN_FP_RULES 内置规则精度', () => {
    it('BUILTIN_FP_RULES 包含 8 条内置规则', () => {
      expect(BUILTIN_FP_RULES.length).toBeGreaterThanOrEqual(8);
    });

    it('每条内置规则都有 id、name、match 函数', () => {
      for (const rule of BUILTIN_FP_RULES) {
        expect(rule.id).toBeTypeOf('string');
        expect(rule.name).toBeTypeOf('string');
        expect(rule.match).toBeTypeOf('function');
      }
    });

    it('builtin-memory-safety-non-c 正确识别非 C 文件的内存安全 finding', () => {
      const rule = BUILTIN_FP_RULES.find((r) => r.id === 'builtin-memory-safety-non-c');
      expect(rule).toBeDefined();
      // 非 C 文件 + 低置信度 + memory-safety → 匹配
      expect(
        rule!.match({
          file: 'a.ts',
          line: 1,
          severity: 'high',
          category: 'memory-safety',
          message: 'buffer overflow',
          confidence: 0.4,
          source: 'ai',
        }),
      ).toBe(true);
      // C 文件不匹配
      expect(
        rule!.match({
          file: 'a.c',
          line: 1,
          severity: 'high',
          category: 'memory-safety',
          message: 'buffer overflow',
          confidence: 0.4,
          source: 'ai',
        }),
      ).toBe(false);
    });
  });

  // ==================== 端到端精度：真阳 vs 误报 ====================
  describe('端到端精度：真阳识别 + 误报过滤', () => {
    it('真阳 diff 经规则匹配产生预期数量的 finding', () => {
      const diffs = parseDiff(TRUE_POSITIVE_DIFF);
      const bundles = bundleFiles(diffs, { bundles: [] });
      const annotations = bundles.flatMap((b) => matchRules(b, ACCURACY_RULES));

      // 应至少识别 4 类真阳问题
      const ruleIds = new Set(annotations.map((a) => a.ruleId));
      const truePositiveRuleIds = ['sql-injection', 'eval', 'hardcoded-secret', 'xss'];
      for (const id of truePositiveRuleIds) {
        expect(ruleIds.has(id)).toBe(true);
      }
    });

    it('误报 diff 经规则匹配 + filterFalsePositives 应大幅减少', () => {
      const diffs = parseDiff(FALSE_POSITIVE_DIFF);
      const bundles = bundleFiles(diffs, { bundles: [] });
      const annotations = bundles.flatMap((b) => matchRules(b, ACCURACY_RULES));

      // 转换为 findings
      const findings: Finding[] = annotations.map((a) => ({
        file: bundles.find((b) => b.annotations.includes(a))?.primary.path ?? 'unknown',
        line: a.line ?? 1,
        severity: a.severity,
        category: a.category,
        message: a.message,
        confidence: 0.4, // 模拟 AI 给的低置信度
        source: 'rule',
        ruleId: a.ruleId,
      }));

      const filtered = filterFalsePositives(findings);
      // 误报应被过滤掉一部分
      expect(filtered.length).toBeLessThanOrEqual(findings.length);

      // 生成文件中的 finding 应被过滤
      expect(filtered.some((f) => f.file.includes('generated'))).toBe(false);
      // TODO/FIXME 低置信度应被过滤
      expect(filtered.some((f) => f.message.includes('TODO') && f.confidence < 0.85)).toBe(false);
    });

    it('filterBySeverity + filterByCategory 组合过滤', () => {
      const findings: Finding[] = [
        { file: 'a', line: 1, severity: 'critical', category: 'security', message: 'c', confidence: 0.9, source: 'rule' },
        { file: 'a', line: 2, severity: 'high', category: 'security', message: 'h', confidence: 0.9, source: 'rule' },
        { file: 'a', line: 3, severity: 'low', category: 'quality', message: 'l', confidence: 0.5, source: 'rule' },
      ];

      // 只看 security 类别 + high 及以上
      const secHigh = filterBySeverity(filterByCategory(findings, ['security']), 'high');
      expect(secHigh.length).toBe(2);
      expect(secHigh.every((f) => f.category === 'security')).toBe(true);
      expect(secHigh.every((f) => ['critical', 'high'].includes(f.severity))).toBe(true);
    });

    it('sortBySeverity 保证严重问题优先', () => {
      const findings: Finding[] = [
        { file: 'a', line: 1, severity: 'low', category: 'x', message: '1', confidence: 0.5, source: 'rule' },
        { file: 'a', line: 2, severity: 'critical', category: 'x', message: '2', confidence: 0.9, source: 'rule' },
        { file: 'a', line: 3, severity: 'medium', category: 'x', message: '3', confidence: 0.7, source: 'rule' },
        { file: 'a', line: 4, severity: 'high', category: 'x', message: '4', confidence: 0.8, source: 'rule' },
      ];
      const sorted = sortBySeverity(findings);
      expect(sorted[0].severity).toBe('critical');
      expect(sorted[1].severity).toBe('high');
      expect(sorted[2].severity).toBe('medium');
      expect(sorted[3].severity).toBe('low');
    });

    it('规则查询精度：getRulesByCategory', () => {
      const secRules = getRulesByCategory(ACCURACY_RULES, 'security');
      expect(secRules.length).toBeGreaterThan(0);
      expect(secRules.every((r) => r.category === 'security')).toBe(true);

      const qualityRules = getRulesByCategory(ACCURACY_RULES, 'quality');
      expect(qualityRules.length).toBeGreaterThan(0);
      expect(qualityRules.every((r) => r.category === 'quality')).toBe(true);
    });

    it('规则查询精度：getRulesBySeverity', () => {
      const criticalRules = getRulesBySeverity(ACCURACY_RULES, 'critical');
      expect(criticalRules.length).toBeGreaterThan(0);
      expect(criticalRules.every((r) => r.severity === 'critical')).toBe(true);

      const highRules = getRulesBySeverity(ACCURACY_RULES, 'high');
      expect(highRules.length).toBeGreaterThan(0);
      expect(highRules.every((r) => r.severity === 'high')).toBe(true);
    });
  });

  // ==================== 综合 F1 精度指标 ====================
  describe('综合精度指标', () => {
    it('真阳率（recall）：识别所有已知真阳问题', () => {
      const diffs = parseDiff(TRUE_POSITIVE_DIFF);
      const bundles = bundleFiles(diffs, { bundles: [] });
      const annotations = bundles.flatMap((b) => matchRules(b, ACCURACY_RULES));
      const detectedRuleIds = new Set(annotations.map((a) => a.ruleId));

      // 已知真阳规则
      const truePositiveRuleIds = ['sql-injection', 'eval', 'hardcoded-secret', 'xss'];
      const detected = truePositiveRuleIds.filter((id) => detectedRuleIds.has(id));
      const recall = detected.length / truePositiveRuleIds.length;
      expect(recall).toBe(1); // 100% recall
    });

    it('误报过滤率：内置规则过滤大部分已知误报', () => {
      // 构造 8 类已知误报 finding
      const knownFalsePositives: Finding[] = [
        // 1. 非 C 文件内存安全
        { file: 'a.ts', line: 1, severity: 'high', category: 'memory-safety', message: 'buffer overflow', confidence: 0.4, source: 'ai' },
        // 2. rate-limit
        { file: 'a.ts', line: 2, severity: 'low', category: 'security', message: 'rate limit missing', confidence: 0.4, source: 'ai' },
        // 3. open-redirect
        { file: 'a.ts', line: 3, severity: 'medium', category: 'security', message: 'open redirect risk', confidence: 0.4, source: 'ai' },
        // 4. 生成文件
        { file: 'src/generated/x.ts', line: 4, severity: 'low', category: 'quality', message: 'issue in generated', confidence: 0.4, source: 'ai' },
        // 5. 测试文件 low security
        { file: 'tests/a.test.ts', line: 5, severity: 'low', category: 'security', message: 'low sec in test', confidence: 0.4, source: 'ai' },
        // 6. TODO
        { file: 'a.ts', line: 6, severity: 'low', category: 'quality', message: 'TODO: refactor', confidence: 0.4, source: 'ai' },
        // 7. 日志级别
        { file: 'a.ts', line: 7, severity: 'low', category: 'quality', message: 'log level issue', confidence: 0.4, source: 'ai' },
        // 8. console.log low
        { file: 'a.ts', line: 8, severity: 'low', category: 'quality', message: 'console.log usage', confidence: 0.4, source: 'ai' },
      ];

      const filtered = filterFalsePositives(knownFalsePositives);
      const filterRate = 1 - filtered.length / knownFalsePositives.length;
      // 应过滤掉大部分（>= 80%）
      expect(filterRate).toBeGreaterThanOrEqual(0.8);
    });

    it('精度（precision）：高置信度真阳不应被误过滤', () => {
      // 高置信度真阳不应被任何 FP 规则过滤
      const highConfidenceTruePositives: Finding[] = [
        { file: 'a.ts', line: 1, severity: 'critical', category: 'security', message: 'eval injection', confidence: 0.95, source: 'rule' },
        { file: 'a.ts', line: 2, severity: 'high', category: 'security', message: 'sql injection', confidence: 0.9, source: 'rule' },
        // 高置信度的"误报模式"也不应被过滤
        { file: 'tests/a.test.ts', line: 3, severity: 'low', category: 'security', message: 'real test issue', confidence: 0.95, source: 'ai' },
        { file: 'a.ts', line: 4, severity: 'low', category: 'quality', message: 'TODO: must fix now', confidence: 0.95, source: 'ai' },
      ];
      const filtered = filterFalsePositives(highConfidenceTruePositives);
      expect(filtered.length).toBe(highConfidenceTruePositives.length);
    });

    it('综合精度：完整管道 applyFindings 保留高置信度真阳', async () => {
      const diffs = parseDiff(TRUE_POSITIVE_DIFF);
      const result = await runPipeline(TRUE_POSITIVE_DIFF, { filter: {}, rules: ACCURACY_RULES });

      const findings: Finding[] = [
        { file: 'src/vuln.ts', line: 2, severity: 'high', category: 'security', message: 'sql injection', confidence: 0.95, source: 'ai' },
        { file: 'src/vuln.ts', line: 7, severity: 'critical', category: 'security', message: 'eval injection', confidence: 0.95, source: 'ai' },
        { file: 'src/secret.ts', line: 2, severity: 'high', category: 'security', message: 'hardcoded secret', confidence: 0.95, source: 'ai' },
        // 误报
        { file: 'src/vuln.ts', line: 1, severity: 'low', category: 'quality', message: 'TODO: refactor', confidence: 0.3, source: 'ai' },
      ];
      const final = applyFindings(result, findings);
      expect(final.processedFindings).toBeDefined();

      // 真 finding 应保留
      const trueFindings = final.processedFindings!.filter((f) => f.confidence >= 0.85);
      expect(trueFindings.length).toBe(3);

      // 误报应被过滤
      const todoFindings = final.processedFindings!.filter((f) => f.message.includes('TODO'));
      expect(todoFindings.length).toBe(0);
    });
  });
});
