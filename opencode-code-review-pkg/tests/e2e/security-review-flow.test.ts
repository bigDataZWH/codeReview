import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runSecurityPipeline } from '../../src/pipeline.js';
import { applyFindings } from '../../src/pipeline.js';
import {
  correctLineLocations,
  filterFalsePositives,
  BUILTIN_FP_RULES,
  filterByCategory,
  filterBySeverity,
  sortBySeverity,
  deduplicateFindings,
} from '../../src/post-processor.js';
import {
  buildReflectionPrompt,
  buildBatchReflectionPrompt,
  parseReflectionResponse,
  reflectFindings,
} from '../../src/ai-reflection.js';
import { buildSecurityPrompt } from '../../src/prompt-builder.js';
import { parseDiff } from '../../src/diff-parser.js';
import { matchRules } from '../../src/rule-engine.js';
import { bundleFiles } from '../../src/file-filter.js';
import type { Rule, Finding, PipelineConfig, LLMProviderConfig } from '../../src/types.js';

// ── 安全审查 fixtures ──

const SECURITY_DIFF = `diff --git a/src/api/login.py b/src/api/login.py
index abc1234..def5678 100644
--- a/src/api/login.py
+++ b/src/api/login.py
@@ -1,5 +1,10 @@
 import os
+from db import query

 def login(username, password):
-    sql = "SELECT * FROM users WHERE name = '" + username + "'"
-    return query(sql)
+    # Use parameterized query
+    sql = "SELECT * FROM users WHERE name = %s"
+    return query(sql, (username,))
+
+password = "hardcoded-secret-value"

diff --git a/src/handlers/xss.ts b/src/handlers/xss.ts
index 111..222 100644
--- a/src/handlers/xss.ts
+++ b/src/handlers/xss.ts
@@ -1,3 +1,6 @@
 export function render(input: string): string {
-  return '<div>' + input + '</div>';
+  // 直接拼接用户输入到 HTML，存在 XSS 风险
+  return '<div>' + input + '</div>';
+}
+eval(input);

diff --git a/src/utils/path.ts b/src/utils/path.ts
index 333..444 100644
--- a/src/utils/path.ts
+++ b/src/utils/path.ts
@@ -1,3 +1,5 @@
 import * as fs from 'fs';
 export function readFile(userPath: string): string {
-  return fs.readFileSync(userPath, 'utf-8');
+  // 用户可控路径，存在路径遍历风险
+  return fs.readFileSync(userPath, 'utf-8');
+}
`;

const SECURITY_RULES: Rule[] = [
  {
    id: 'sql-injection',
    name: 'SQL 注入检测',
    severity: 'high',
    category: 'security',
    patterns: [
      { type: 'regex', pattern: 'SELECT.*\\+.*username', message: '字符串拼接 SQL 存在注入风险' },
    ],
  },
  {
    id: 'hardcoded-secret',
    name: '硬编码密钥检测',
    severity: 'high',
    category: 'security',
    patterns: [
      { type: 'regex', pattern: 'password\\s*=\\s*["\']', message: '检测到硬编码密码' },
    ],
  },
  {
    id: 'xss',
    name: 'XSS 风险',
    severity: 'high',
    category: 'security',
    patterns: [
      { type: 'regex', pattern: "'<div>'\\s*\\+\\s*input", message: '直接拼接 HTML 存在 XSS 风险' },
    ],
  },
  {
    id: 'eval',
    name: 'eval 注入',
    severity: 'critical',
    category: 'security',
    patterns: [
      { type: 'regex', pattern: '\\beval\\s*\\(', message: 'eval 存在代码注入风险' },
    ],
  },
  {
    id: 'path-traversal',
    name: '路径遍历风险',
    severity: 'medium',
    category: 'security',
    patterns: [
      { type: 'regex', pattern: 'readFileSync\\s*\\(\\s*userPath', message: '用户可控路径存在遍历风险' },
    ],
  },
];

// ── E2E：安全审查流程 ──

describe('E2E：安全审查流程', () => {
  let fetchOrig: typeof globalThis.fetch;

  beforeEach(() => {
    fetchOrig = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = fetchOrig;
    vi.restoreAllMocks();
  });

  // ==================== 阶段 1：硬规则过滤 ====================
  describe('阶段 1：硬规则匹配 + 硬规则过滤', () => {
    it('安全规则正确匹配 SQL 注入、硬编码密钥、XSS、eval、路径遍历', async () => {
      const diffs = parseDiff(SECURITY_DIFF);
      const bundles = bundleFiles(diffs, { bundles: [] });
      const annotations = bundles.flatMap((b) => matchRules(b, SECURITY_RULES));

      // 至少匹配 4+ 类问题
      expect(annotations.length).toBeGreaterThanOrEqual(4);

      const ruleIds = new Set(annotations.map((a) => a.ruleId));
      // eval 必须匹配（critical）
      expect(ruleIds.has('eval')).toBe(true);
      // 硬编码密钥必须匹配
      expect(ruleIds.has('hardcoded-secret')).toBe(true);
    });

    it('安全 prompt 包含安全方法论和误报过滤规则', async () => {
      const result = await runSecurityPipeline(SECURITY_DIFF, {
        filter: {},
        rules: SECURITY_RULES,
      });
      // SECURITY_TEMPLATE 应包含安全维度信息
      expect(result.prompt).toContain('Security');
      expect(result.prompt.toLowerCase()).toContain('sql');
      expect(result.prompt.toLowerCase()).toContain('xss');
      // 包含误报过滤规则提示
      expect(result.prompt).toContain('误报');
    });

    it('filterByCategory 只保留 security 类别 finding', () => {
      const mixed: Finding[] = [
        { file: 'a.ts', line: 1, severity: 'high', category: 'security', message: 'sql', confidence: 0.9, source: 'rule' },
        { file: 'a.ts', line: 2, severity: 'low', category: 'quality', message: 'log', confidence: 0.6, source: 'rule' },
        { file: 'a.ts', line: 3, severity: 'medium', category: 'style', message: 'todo', confidence: 0.4, source: 'rule' },
      ];
      const onlySecurity = filterByCategory(mixed, ['security']);
      expect(onlySecurity.length).toBe(1);
      expect(onlySecurity[0].category).toBe('security');
    });

    it('filterBySeverity 过滤掉低于 high 的 finding', () => {
      const mixed: Finding[] = [
        { file: 'a.ts', line: 1, severity: 'critical', category: 'security', message: 'c', confidence: 0.9, source: 'rule' },
        { file: 'a.ts', line: 2, severity: 'high', category: 'security', message: 'h', confidence: 0.9, source: 'rule' },
        { file: 'a.ts', line: 3, severity: 'medium', category: 'security', message: 'm', confidence: 0.5, source: 'rule' },
        { file: 'a.ts', line: 4, severity: 'low', category: 'security', message: 'l', confidence: 0.3, source: 'rule' },
      ];
      const highPlus = filterBySeverity(mixed, 'high');
      expect(highPlus.length).toBe(2);
      expect(highPlus.every((f) => ['critical', 'high'].includes(f.severity))).toBe(true);
    });
  });

  // ==================== 阶段 2：AI 反思 ====================
  describe('阶段 2：AI 反思评估', () => {
    it('buildReflectionPrompt 包含 finding 信息', () => {
      const finding: Finding = {
        file: 'src/app.ts',
        line: 10,
        severity: 'high',
        category: 'security',
        message: 'sql injection',
        confidence: 0.8,
        source: 'ai',
      };
      const prompt = buildReflectionPrompt(finding);
      expect(prompt).toContain('src/app.ts');
      expect(prompt).toContain('10');
      expect(prompt).toContain('sql injection');
      expect(prompt).toContain('confidence');
    });

    it('buildBatchReflectionPrompt 包含所有 findings', () => {
      const findings: Finding[] = [
        { file: 'a.ts', line: 1, severity: 'high', category: 'security', message: 'm1', confidence: 0.8, source: 'ai' },
        { file: 'b.ts', line: 2, severity: 'low', category: 'quality', message: 'm2', confidence: 0.5, source: 'ai' },
      ];
      const prompt = buildBatchReflectionPrompt(findings);
      expect(prompt).toContain('a.ts');
      expect(prompt).toContain('b.ts');
      expect(prompt).toContain('Finding #0');
      expect(prompt).toContain('Finding #1');
    });

    it('buildBatchReflectionPrompt 空 findings 返回空字符串', () => {
      expect(buildBatchReflectionPrompt([])).toBe('');
    });

    it('parseReflectionResponse 解析单条 JSON', () => {
      expect(parseReflectionResponse('{"confidence": 0.9}')).toBe(0.9);
      expect(parseReflectionResponse('{"confidence": 0.5}')).toBe(0.5);
      expect(parseReflectionResponse('{"confidence": 0}')).toBe(0);
    });

    it('parseReflectionResponse 解析批量 JSON 数组', () => {
      const response = JSON.stringify([
        { id: 0, confidence: 0.9 },
        { id: 1, confidence: 0.2 },
        { id: 2, confidence: 0.5 },
      ]);
      expect(parseReflectionResponse(response, 0)).toBe(0.9);
      expect(parseReflectionResponse(response, 1)).toBe(0.2);
      expect(parseReflectionResponse(response, 2)).toBe(0.5);
    });

    it('parseReflectionResponse 空响应返回 0.5', () => {
      expect(parseReflectionResponse('')).toBe(0.5);
      expect(parseReflectionResponse('   ')).toBe(0.5);
    });

    it('parseReflectionResponse 非法 JSON 返回 0.5', () => {
      expect(parseReflectionResponse('not json')).toBe(0.5);
    });

    it('parseReflectionResponse clamp 到 [0,1]', () => {
      expect(parseReflectionResponse('{"confidence": 1.5}')).toBe(1);
      expect(parseReflectionResponse('{"confidence": -0.5}')).toBe(0);
    });

    it('reflectFindings 过滤低置信度 finding', async () => {
      // mock LLM 返回每条 finding 的 confidence
      const llmResponse = JSON.stringify([
        { id: 0, confidence: 0.9 }, // 保留
        { id: 1, confidence: 0.1 }, // 过滤
        { id: 2, confidence: 0.5 }, // 边界，保留
      ]);
      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({
          choices: [{ message: { content: llmResponse } }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ) as unknown as typeof globalThis.fetch;

      const findings: Finding[] = [
        { file: 'a.ts', line: 1, severity: 'high', category: 'security', message: 'm1', confidence: 0.8, source: 'ai' },
        { file: 'a.ts', line: 2, severity: 'low', category: 'security', message: 'm2', confidence: 0.5, source: 'ai' },
        { file: 'a.ts', line: 3, severity: 'medium', category: 'security', message: 'm3', confidence: 0.7, source: 'ai' },
      ];
      const config: LLMProviderConfig = {
        provider: 'openai',
        apiKey: 'test-key',
        model: 'gpt-4',
      };

      const reflected = await reflectFindings(findings, config, 0.5);
      // 0.9 (m1) 和 0.5 (m3) 保留（>= 0.5），0.1 (m2) 过滤
      expect(reflected.length).toBe(2);
      expect(reflected.some((f) => f.message === 'm1')).toBe(true);
      expect(reflected.some((f) => f.message === 'm2')).toBe(false);
      expect(reflected.some((f) => f.message === 'm3')).toBe(true);
    });

    it('reflectFindings LLM 失败时降级保留所有 findings', async () => {
      globalThis.fetch = vi.fn(async () =>
        new Response('{"error": "internal"}', { status: 500 }),
      ) as unknown as typeof globalThis.fetch;

      const findings: Finding[] = [
        { file: 'a.ts', line: 1, severity: 'high', category: 'security', message: 'm1', confidence: 0.8, source: 'ai' },
      ];
      const config: LLMProviderConfig = {
        provider: 'openai',
        apiKey: 'test-key',
        model: 'gpt-4',
      };

      const reflected = await reflectFindings(findings, config, 0.5);
      expect(reflected.length).toBe(1); // 降级保留
    });

    it('reflectFindings 空 findings 返回空数组', async () => {
      const config: LLMProviderConfig = {
        provider: 'openai',
        apiKey: 'test-key',
        model: 'gpt-4',
      };
      const reflected = await reflectFindings([], config);
      expect(reflected).toEqual([]);
    });
  });

  // ==================== 阶段 3：定位修正 ====================
  describe('阶段 3：定位修正 + 误报过滤', () => {
    it('correctLineLocations 修正超出 hunk 范围的行号', async () => {
      const diffs = parseDiff(SECURITY_DIFF);
      const findings: Finding[] = [
        {
          file: 'src/api/login.py',
          line: 9999, // 超出范围
          severity: 'high',
          category: 'security',
          message: 'sql injection',
          confidence: 0.9,
          source: 'ai',
        },
      ];
      const corrected = correctLineLocations(findings, diffs);
      expect(corrected[0].line).toBeLessThan(9999);
      // 应在某个 hunk 范围内
      const fileDiff = diffs.find((d) => d.path === 'src/api/login.py');
      if (fileDiff) {
        const inHunk = fileDiff.hunks.some(
          (h) => corrected[0].line >= h.newStart && corrected[0].line < h.newStart + h.newCount,
        );
        expect(inHunk).toBe(true);
      }
    });

    it('filterFalsePositives 应用内置规则过滤低置信度误报', () => {
      const findings: Finding[] = [
        // 高置信度 critical 保留
        { file: 'a.ts', line: 1, severity: 'critical', category: 'security', message: 'eval injection', confidence: 0.95, source: 'rule' },
        // 高置信度 high 保留
        { file: 'a.ts', line: 2, severity: 'high', category: 'security', message: 'sql injection', confidence: 0.9, source: 'rule' },
        // 低置信度 TODO 类应过滤
        { file: 'a.ts', line: 3, severity: 'low', category: 'quality', message: 'TODO: refactor this', confidence: 0.4, source: 'ai' },
        // 低置信度 rate-limit 类应过滤
        { file: 'a.ts', line: 4, severity: 'low', category: 'security', message: 'rate limit missing', confidence: 0.3, source: 'ai' },
        // 低置信度 open-redirect 类应过滤
        { file: 'a.ts', line: 5, severity: 'medium', category: 'security', message: 'open redirect risk', confidence: 0.4, source: 'ai' },
        // 低置信度 console.log 类应过滤
        { file: 'a.ts', line: 6, severity: 'low', category: 'quality', message: 'console.log usage', confidence: 0.4, source: 'ai' },
      ];
      const filtered = filterFalsePositives(findings);
      // 高置信度安全 finding 应保留
      expect(filtered.some((f) => f.message.includes('eval'))).toBe(true);
      expect(filtered.some((f) => f.message.includes('sql'))).toBe(true);
      // 低置信度 TODO 类应被过滤
      expect(filtered.some((f) => f.message.includes('TODO'))).toBe(false);
      // 低置信度 rate-limit 应被过滤
      expect(filtered.some((f) => f.message.includes('rate limit'))).toBe(false);
      // 低置信度 open-redirect 应被过滤
      expect(filtered.some((f) => f.message.includes('open redirect'))).toBe(false);
      // 低置信度 console.log 应被过滤
      expect(filtered.some((f) => f.message.includes('console.log'))).toBe(false);
    });

    it('BUILTIN_FP_RULES 包含常见误报模式', () => {
      const ids = BUILTIN_FP_RULES.map((r) => r.id);
      expect(ids).toContain('builtin-memory-safety-non-c');
      expect(ids).toContain('builtin-rate-limit');
      expect(ids).toContain('builtin-open-redirect');
      expect(ids).toContain('builtin-generated-file');
      expect(ids).toContain('builtin-test-low-security');
      expect(ids).toContain('builtin-todo-fixme');
      expect(ids).toContain('builtin-log-level');
      expect(ids).toContain('builtin-console-log-low');
    });

    it('sortBySeverity 按 critical > high > medium > low > info 排序', () => {
      const findings: Finding[] = [
        { file: 'a', line: 1, severity: 'low', category: 'x', message: 'l', confidence: 0.5, source: 'rule' },
        { file: 'a', line: 2, severity: 'critical', category: 'x', message: 'c', confidence: 0.9, source: 'rule' },
        { file: 'a', line: 3, severity: 'medium', category: 'x', message: 'm', confidence: 0.7, source: 'rule' },
        { file: 'a', line: 4, severity: 'high', category: 'x', message: 'h', confidence: 0.8, source: 'rule' },
        { file: 'a', line: 5, severity: 'info', category: 'x', message: 'i', confidence: 0.3, source: 'rule' },
      ];
      const sorted = sortBySeverity(findings);
      expect(sorted[0].severity).toBe('critical');
      expect(sorted[1].severity).toBe('high');
      expect(sorted[2].severity).toBe('medium');
      expect(sorted[3].severity).toBe('low');
      expect(sorted[4].severity).toBe('info');
    });

    it('deduplicateFindings 过滤与已有评论重复的 finding', () => {
      const findings: Finding[] = [
        { file: 'a.ts', line: 5, severity: 'high', category: 'security', message: 'sql injection risk in query', confidence: 0.9, source: 'rule' },
        { file: 'a.ts', line: 5, severity: 'high', category: 'security', message: 'another distinct issue', confidence: 0.8, source: 'rule' },
      ];
      const existing = [
        { file: 'a.ts', line: 5, body: 'sql injection risk in query (existing comment)' },
      ];
      const deduped = deduplicateFindings(findings, existing);
      // 第一条与已有评论 IoU 高，应被过滤
      expect(deduped.length).toBeLessThan(findings.length);
    });
  });

  // ==================== 三阶段联动：完整安全审查流程 ====================
  describe('三阶段联动：硬规则 + AI 反思 + 定位修正', () => {
    it('完整安全审查：runSecurityPipeline + applyFindings + reflectFindings', async () => {
      // 阶段 1：硬规则匹配（通过 runSecurityPipeline）
      const result = await runSecurityPipeline(SECURITY_DIFF, {
        filter: {},
        rules: SECURITY_RULES,
      });

      // 应识别出多个安全问题
      const annotations = result.annotatedBundles.flatMap((b) => b.annotations);
      expect(annotations.length).toBeGreaterThan(0);
      // 应包含 critical（eval）
      const criticalAnnotations = annotations.filter((a) => a.severity === 'critical');
      expect(criticalAnnotations.length).toBeGreaterThan(0);

      // 模拟 AI 生成的 findings（基于规则标注 + 一些误报）
      const aiFindings: Finding[] = [
        // 真 finding：eval 严重问题
        {
          file: 'src/handlers/xss.ts',
          line: 5,
          severity: 'critical',
          category: 'security',
          message: 'eval() 允许执行任意代码，存在严重代码注入风险',
          confidence: 0.95,
          source: 'ai',
        },
        // 真 finding：硬编码密钥
        {
          file: 'src/api/login.py',
          line: 10,
          severity: 'high',
          category: 'security',
          message: '检测到硬编码密码',
          confidence: 0.9,
          source: 'ai',
        },
        // 误报：低置信度的 TODO
        {
          file: 'src/api/login.py',
          line: 1,
          severity: 'low',
          category: 'quality',
          message: 'TODO: refactor this',
          confidence: 0.3,
          source: 'ai',
        },
      ];

      // 阶段 3：定位修正 + 误报过滤（通过 applyFindings）
      const final = applyFindings(result, aiFindings);
      expect(final.processedFindings).toBeDefined();
      // 应过滤掉低置信度 TODO
      const todo = final.processedFindings!.find((f) => f.message.includes('TODO'));
      expect(todo).toBeUndefined();
      // 应保留 critical eval finding
      const evalFinding = final.processedFindings!.find((f) => f.message.includes('eval'));
      expect(evalFinding).toBeDefined();

      // 阶段 2：AI 反思（mock LLM 进一步过滤）
      const llmResponse = JSON.stringify([
        { id: 0, confidence: 0.95 }, // eval
        { id: 1, confidence: 0.9 }, // hardcoded secret
      ]);
      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({
          choices: [{ message: { content: llmResponse } }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ) as unknown as typeof globalThis.fetch;

      const reflected = await reflectFindings(final.processedFindings!, {
        provider: 'openai',
        apiKey: 'k',
        model: 'gpt-4',
      }, 0.5);

      // 反思后应保留高置信度 finding
      expect(reflected.length).toBeGreaterThan(0);
      expect(reflected.some((f) => f.message.includes('eval'))).toBe(true);
    });

    it('安全 prompt 模板构建正确', () => {
      const prompt = buildSecurityPrompt({
        filteredDiffs: parseDiff(SECURITY_DIFF),
        bundles: [],
        annotatedBundles: [],
      });
      expect(prompt).toContain('Security');
      expect(prompt).toContain('SQL');
      expect(prompt).toContain('XSS');
      expect(prompt).toContain('CSRF');
      expect(prompt).toContain('误报');
    });
  });
});
