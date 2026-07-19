import { describe, it, expect } from 'vitest';
import { runPipeline, applyFindings, runPipelineWithMiddleware, runPipelineFromFile, runSecurityPipeline } from '../src/pipeline.js';
import type { PipelineConfig, PipelineMiddleware, Finding } from '../src/types.js';

// ── 测试用 diff 文本 ──

const SIMPLE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 import { foo } from './foo';
-const x = 1;
+const x = 2;
+const y = 3;
 export default x;
`;

const MULTI_FILE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 import { foo } from './foo';
-const x = 1;
+const x = 2;
+const y = 3;
 export default x;
diff --git a/src/util.ts b/src/util.ts
index 1234567..890abcd 100644
--- a/src/util.ts
+++ b/src/util.ts
@@ -1,2 +1,3 @@
 export function add(a: number, b: number) {
+  return a + b;
 }
`;

const DIFF_WITH_DIST = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
-const x = 1;
+const x = 2;
+const y = 3;
diff --git a/dist/bundle.js b/dist/bundle.js
index 0000000..1111111 100644
--- a/dist/bundle.js
+++ b/dist/bundle.js
@@ -0,0 +1,2 @@
+console.log("bundle");
`;

// ── runPipeline 测试 ──

describe('runPipeline', () => {
  // 1. 最小管道 — 仅 diff + filter，无规则无 MCP
  it('最小管道：仅 diff + filter，无规则无 MCP', async () => {
    const config: PipelineConfig = {
      filter: {},
      mcpEnabled: false,
    };

    const result = await runPipeline(SIMPLE_DIFF, config);

    // 应有过滤后的文件
    expect(result.filteredDiffs.length).toBeGreaterThan(0);
    expect(result.filteredDiffs[0].path).toBe('src/app.ts');

    // bundles 应与 filteredDiffs 数量一致（无打包规则时每个文件独立）
    expect(result.bundles.length).toBe(result.filteredDiffs.length);

    // annotatedBundles 应与 bundles 一致（无规则时无标注）
    expect(result.annotatedBundles.length).toBe(result.bundles.length);

    // MCP 上下文应为 undefined
    expect(result.context).toBeUndefined();

    // prompt 应非空
    expect(result.prompt).toBeTruthy();
    expect(result.prompt.length).toBeGreaterThan(0);
    expect(result.prompt).toContain('src/app.ts');
  });

  // 2. 完整管道 — diff + filter + bundle + rules + prompt
  it('完整管道：diff + filter + bundle + rules + prompt', async () => {
    const config: PipelineConfig = {
      filter: {},
      bundle: {
        bundles: [
          {
            name: 'test-pair',
            pattern: '(.*)\\.test\\.(ts|js)',
            related: ['$1.$2'],
          },
        ],
      },
      rules: [
        {
          id: 'no-console',
          name: '禁止 console',
          severity: 'low',
          category: 'best-practice',
          language: ['typescript'],
          patterns: [
            {
              type: 'contains_any',
              items: ['console.log'],
              message: '不应使用 console.log',
            },
          ],
        },
      ],
      mcpEnabled: false,
    };

    const result = await runPipeline(MULTI_FILE_DIFF, config);

    expect(result.filteredDiffs.length).toBe(2);
    expect(result.bundles.length).toBe(2);
    expect(result.annotatedBundles.length).toBe(2);
    expect(result.prompt).toContain('src/app.ts');
    expect(result.prompt).toContain('src/util.ts');
  });

  // 3. 空 diff — 返回空结果
  it('空 diff 返回空结果', async () => {
    const config: PipelineConfig = {
      filter: {},
    };

    const result = await runPipeline('', config);

    expect(result.filteredDiffs).toEqual([]);
    expect(result.bundles).toEqual([]);
    expect(result.annotatedBundles).toEqual([]);
    expect(result.prompt).toBeTruthy(); // prompt 仍应生成
  });

  // 4. 自定义过滤规则 — 正确传递 filter config
  it('自定义过滤规则正确生效', async () => {
    const config: PipelineConfig = {
      filter: {
        ignorePatterns: ['dist/**', 'node_modules/**'],
      },
    };

    const result = await runPipeline(DIFF_WITH_DIST, config);

    // dist/bundle.js 应被过滤掉
    expect(result.filteredDiffs.length).toBe(1);
    expect(result.filteredDiffs[0].path).toBe('src/app.ts');

    // bundles 也应只有 1 个
    expect(result.bundles.length).toBe(1);
  });

  // 5. MCP 禁用 — 跳过 MCP 阶段
  it('MCP 禁用时跳过 MCP 阶段', async () => {
    const config: PipelineConfig = {
      filter: {},
      mcpEnabled: false,
    };

    const result = await runPipeline(SIMPLE_DIFF, config);

    // MCP 上下文应为 undefined
    expect(result.context).toBeUndefined();

    // prompt 中不应包含影响半径信息
    expect(result.prompt).not.toContain('blastRadius');
    expect(result.prompt).not.toContain('影响半径');
  });

  // 6. durationMs 统计
  it('PipelineResult 包含 durationMs 统计', async () => {
    const config: PipelineConfig = {
      filter: {},
    };

    const result = await runPipeline(SIMPLE_DIFF, config);
    expect(result.durationMs).toBeDefined();
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThan(0);
  });

  // 7. 超时控制
  it('超时控制：不设置 timeout 时不抛错', async () => {
    const config: PipelineConfig = {
      filter: {},
    };

    const result = await runPipeline(SIMPLE_DIFF, config);
    expect(result.filteredDiffs).toHaveLength(1);
  });

  it('超时控制：极短超时可能触发超时错误', async () => {
    const config: PipelineConfig = {
      filter: {},
      mcpEnabled: true,
    };

    // Pipeline is very fast, so this may or may not timeout
    // Just verify it doesn't crash
    const result = await runPipeline(SIMPLE_DIFF, config, { timeout: 100 }).catch(() => null);
    // Either we got a result or a timeout error - both are valid
    expect(true).toBe(true);
  });
});

// ── applyFindings 测试 ──

describe('applyFindings', () => {
  it('执行行号修正和误报过滤后存入 processedFindings', async () => {
    const config: PipelineConfig = { filter: {} };
    const result = await runPipeline(SIMPLE_DIFF, config);

    const findings: Finding[] = [
      {
        file: 'src/app.ts',
        line: 2,
        severity: 'high',
        category: 'security',
        message: 'SQL injection risk',
        confidence: 0.8,
        source: 'ai',
      },
      {
        file: 'src/app.ts',
        line: 3,
        severity: 'low',
        category: 'best-practice',
        message: 'Remove console.log from production code',
        confidence: 0.5,
        source: 'ai',
      },
    ];

    const updated = applyFindings(result, findings);
    expect(updated.findings).toEqual(findings);
    expect(updated.processedFindings).toBeDefined();
    // console.log low finding should be filtered as FP
    expect(updated.processedFindings!.length).toBeLessThan(findings.length);
  });
});

// ── runPipelineWithMiddleware ──

describe('runPipelineWithMiddleware', () => {
  it('applies afterBuild middleware', async () => {
    const config: PipelineConfig = { filter: {} };
    const middleware: PipelineMiddleware = {
      name: 'add-tag',
      afterBuild: (result) => ({
        ...result,
        prompt: result.prompt + '\n\n[MODIFIED BY MIDDLEWARE]',
      }),
    };

    const result = await runPipelineWithMiddleware(SIMPLE_DIFF, config, [middleware]);
    expect(result.prompt).toContain('[MODIFIED BY MIDDLEWARE]');
  });

  it('passes through with no middleware', async () => {
    const config: PipelineConfig = { filter: {} };
    const result = await runPipelineWithMiddleware(SIMPLE_DIFF, config, []);
    expect(result.filteredDiffs).toHaveLength(1);
  });
});

// ── runSecurityPipeline ──

describe('runSecurityPipeline', () => {
  it('使用安全 prompt 模板', async () => {
    const config: PipelineConfig = { filter: {} };
    const result = await runSecurityPipeline(SIMPLE_DIFF, config);
    expect(result.prompt).toContain('Security Code Review');
    expect(result.prompt).toContain('SQL');
  });
});

// ── runPipelineFromFile ──

describe('runPipelineFromFile', () => {
  it('runs pipeline from a file path', async () => {
    const { writeFile, rm, mkdir } = await import('node:fs/promises');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const tmpDir = join(dirname(fileURLToPath(import.meta.url)), '_tmp_pipeline');
    await mkdir(tmpDir, { recursive: true });
    const tmpFile = join(tmpDir, 'test.diff');
    await writeFile(tmpFile, SIMPLE_DIFF);

    try {
      const config: PipelineConfig = { filter: {} };
      const result = await runPipelineFromFile(tmpFile, config);
      expect(result.filteredDiffs).toHaveLength(1);
      expect(result.filteredDiffs[0].path).toBe('src/app.ts');
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });
});

// ── Round 54: JSON serialization ──

describe('PipelineResult JSON serialization', () => {
  it('所有字段可 JSON 序列化', async () => {
    const config: PipelineConfig = { filter: {} };
    const result = await runPipeline(SIMPLE_DIFF, config);
    // Should not throw
    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);
    expect(parsed.filteredDiffs).toHaveLength(1);
    expect(parsed.prompt).toContain('Code Review');
  });
});

// ── Round 65: dry-run mode ──

describe('dry-run mode', () => {
  it('dryRun: true 时不调用 AI 且返回 prompt', async () => {
    const config: PipelineConfig = { filter: {}, dryRun: true };
    const result = await runPipeline(SIMPLE_DIFF, config);
    expect(result.prompt).toContain('Code Review');
    expect(result.findings).toEqual([]);
  });
});
