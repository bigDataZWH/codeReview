import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Finding, FileDiff, ExistingComment, LLMProviderConfig, PipelineResult, PipelineConfig } from '../../../src/types.js';

const PLUGIN_PATH = '../../../opencode-config/.opencode/plugins/post-process.js';

async function loadPlugin() {
  const mod = await import(PLUGIN_PATH);
  return mod.default;
}

function makeFinding(overrides: Partial<Finding> & { file: string; line: number }): Finding {
  return {
    severity: 'low',
    category: 'quality',
    message: 'test finding',
    confidence: 0.8,
    source: 'rule',
    ...overrides,
  };
}

describe('post-process.js afterReview hook with reflectFindings', () => {
  it('calls correctLineLocations → filterFalsePositives → deduplicateFindings → reflectFindings', async () => {
    const plugin = await loadPlugin();

    const callOrder: string[] = [];
    const mockCorrect = vi.fn((findings: Finding[], _diffs: FileDiff[]) => {
      callOrder.push('correct');
      return findings;
    });
    const mockFilter = vi.fn((findings: Finding[]) => {
      callOrder.push('filter');
      return findings;
    });
    const mockDedup = vi.fn((findings: Finding[], _existing?: ExistingComment[]) => {
      callOrder.push('dedup');
      return findings;
    });
    const mockReflect = vi.fn((findings: Finding[], _config: LLMProviderConfig, _minConfidence?: number) => {
      callOrder.push('reflect');
      return findings;
    });

    const findings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1 }),
    ];
    const diffs: FileDiff[] = [
      {
        path: 'a.ts',
        status: 'modified',
        hunks: [
          {
            oldStart: 1, oldCount: 5, newStart: 1, newCount: 5,
            lines: [{ type: 'add', oldLine: undefined, newLine: 1, content: 'foo' }],
          },
        ],
      },
    ];
    const llmConfig: LLMProviderConfig = {
      provider: 'openai',
      apiKey: 'test',
      model: 'gpt-4',
    };

    const result = await plugin.hooks.afterReview(findings, {
      correctLineLocations: mockCorrect,
      filterFalsePositives: mockFilter,
      deduplicateFindings: mockDedup,
      reflectFindings: mockReflect,
      diffs,
      llmConfig,
    });

    expect(mockCorrect).toHaveBeenCalledWith(findings, diffs);
    expect(mockFilter).toHaveBeenCalled();
    expect(mockDedup).toHaveBeenCalled();
    expect(mockReflect).toHaveBeenCalled();
    expect(result).toEqual(findings);

    expect(callOrder).toEqual(['correct', 'filter', 'dedup', 'reflect']);
  });

  it('skips reflectFindings when llmConfig is not provided', async () => {
    const plugin = await loadPlugin();

    const callOrder: string[] = [];
    const mockCorrect = vi.fn((findings: Finding[]) => {
      callOrder.push('correct');
      return findings;
    });
    const mockFilter = vi.fn((findings: Finding[]) => {
      callOrder.push('filter');
      return findings;
    });
    const mockDedup = vi.fn((findings: Finding[]) => {
      callOrder.push('dedup');
      return findings;
    });
    const mockReflect = vi.fn((findings: Finding[]) => {
      callOrder.push('reflect');
      return findings;
    });

    const findings: Finding[] = [makeFinding({ file: 'a.ts', line: 1 })];
    const diffs: FileDiff[] = [];

    await plugin.hooks.afterReview(findings, {
      correctLineLocations: mockCorrect,
      filterFalsePositives: mockFilter,
      deduplicateFindings: mockDedup,
      reflectFindings: mockReflect,
      diffs,
    });

    expect(mockReflect).not.toHaveBeenCalled();
    expect(callOrder).toEqual(['correct', 'filter', 'dedup']);
  });

  it('passes llmConfig and minConfidence to reflectFindings', async () => {
    const plugin = await loadPlugin();

    const mockReflect = vi.fn((_findings: Finding[], config: LLMProviderConfig, minConfidence?: number) => {
      return [];
    });

    const findings: Finding[] = [makeFinding({ file: 'a.ts', line: 1 })];
    const diffs: FileDiff[] = [];
    const llmConfig: LLMProviderConfig = {
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-3',
    };

    await plugin.hooks.afterReview(findings, {
      correctLineLocations: vi.fn((f) => f),
      filterFalsePositives: vi.fn((f) => f),
      deduplicateFindings: vi.fn((f) => f),
      reflectFindings: mockReflect,
      diffs,
      llmConfig,
      minConfidence: 0.7,
    });

    expect(mockReflect).toHaveBeenCalledWith(
      expect.any(Array),
      llmConfig,
      0.7,
    );
  });

  it('uses default minConfidence when not provided', async () => {
    const plugin = await loadPlugin();

    const mockReflect = vi.fn((_findings: Finding[], _config: LLMProviderConfig, minConfidence?: number) => {
      return [];
    });

    const findings: Finding[] = [makeFinding({ file: 'a.ts', line: 1 })];
    const diffs: FileDiff[] = [];
    const llmConfig: LLMProviderConfig = {
      provider: 'openai',
      apiKey: 'test',
      model: 'gpt-4',
    };

    await plugin.hooks.afterReview(findings, {
      correctLineLocations: vi.fn((f) => f),
      filterFalsePositives: vi.fn((f) => f),
      deduplicateFindings: vi.fn((f) => f),
      reflectFindings: mockReflect,
      diffs,
      llmConfig,
    });

    expect(mockReflect).toHaveBeenCalledWith(
      expect.any(Array),
      llmConfig,
      undefined,
    );
  });

  it('reflectFindings receives findings from deduplicateFindings', async () => {
    const plugin = await loadPlugin();

    const deduplicatedFindings: Finding[] = [
      makeFinding({ file: 'a.ts', line: 1, message: 'dedup-result' }),
    ];
    const mockDedup = vi.fn((_findings: Finding[]) => deduplicatedFindings);
    const mockReflect = vi.fn((findings: Finding[]) => {
      expect(findings).toBe(deduplicatedFindings);
      return findings;
    });

    const originalFindings: Finding[] = [makeFinding({ file: 'a.ts', line: 1, message: 'original' })];
    const diffs: FileDiff[] = [];
    const llmConfig: LLMProviderConfig = {
      provider: 'openai',
      apiKey: 'test',
      model: 'gpt-4',
    };

    await plugin.hooks.afterReview(originalFindings, {
      correctLineLocations: vi.fn((f) => f),
      filterFalsePositives: vi.fn((f) => f),
      deduplicateFindings: mockDedup,
      reflectFindings: mockReflect,
      diffs,
      llmConfig,
    });

    expect(mockReflect).toHaveBeenCalled();
  });
});

describe('post-process.js beforeReview hook', () => {
  it('is called before review and returns config injection object', async () => {
    const plugin = await loadPlugin();

    const rules = [
      {
        id: 'test-rule',
        name: 'Test Rule',
        severity: 'medium',
        category: 'quality',
        patterns: [{ type: 'contains_any', items: ['console.log'], message: 'no console.log' }],
      },
    ];
    const filter = { ignorePatterns: ['*.md'] };
    const mcpEnabled = true;

    const result = await plugin.hooks.beforeReview({
      rules,
      filter,
      mcpEnabled,
    });

    expect(result).toEqual({
      rules,
      filter,
      mcpEnabled,
    });
  });

  it('returns partial config when not all fields are provided', async () => {
    const plugin = await loadPlugin();

    const result = await plugin.hooks.beforeReview({
      filter: { ignorePatterns: ['dist/**'] },
    });

    expect(result).toEqual({
      rules: undefined,
      filter: { ignorePatterns: ['dist/**'] },
      mcpEnabled: undefined,
    });
  });

  it('returns empty config when context is not provided', async () => {
    const plugin = await loadPlugin();

    const result = await plugin.hooks.beforeReview();

    expect(result).toEqual({
      rules: undefined,
      filter: undefined,
      mcpEnabled: undefined,
    });
  });

  it('can inject custom rules via beforeReview', async () => {
    const plugin = await loadPlugin();

    const injectedRules = [
      {
        id: 'injected-rule',
        name: 'Injected Rule',
        severity: 'high',
        category: 'security',
        patterns: [{ type: 'regex', pattern: 'eval\\(', message: 'Avoid eval' }],
      },
    ];

    const result = await plugin.hooks.beforeReview({
      rules: injectedRules,
    });

    expect(result.rules).toBe(injectedRules);
    expect(result.rules).toHaveLength(1);
    expect(result.rules![0].id).toBe('injected-rule');
  });

  it('can inject filter config via beforeReview', async () => {
    const plugin = await loadPlugin();

    const injectedFilter = {
      ignorePatterns: ['node_modules/**', '*.generated.ts'],
      maxFiles: 50,
    };

    const result = await plugin.hooks.beforeReview({
      filter: injectedFilter,
    });

    expect(result.filter).toBe(injectedFilter);
    expect(result.filter!.ignorePatterns).toEqual(['node_modules/**', '*.generated.ts']);
    expect(result.filter!.maxFiles).toBe(50);
  });

  it('can inject mcpEnabled flag via beforeReview', async () => {
    const plugin = await loadPlugin();

    let result = await plugin.hooks.beforeReview({ mcpEnabled: true });
    expect(result.mcpEnabled).toBe(true);

    result = await plugin.hooks.beforeReview({ mcpEnabled: false });
    expect(result.mcpEnabled).toBe(false);
  });
});

describe('tools.code-review handler', () => {
  it('使用真实 runPipeline 处理 diff 并返回完整结果', async () => {
    const plugin = await loadPlugin();

    const simpleDiff = `diff --git a/src/test.ts b/src/test.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/test.ts
@@ -0,0 +1,3 @@
+const x = 1;
+const y = 2;
+export default x + y;
`;

    const result = await plugin.tools[0].handler({ diff: simpleDiff });

    expect(result).toBeDefined();
    expect(result.filteredDiffs).toBeDefined();
    expect(result.filteredDiffs.length).toBe(1);
    expect(result.filteredDiffs[0].path).toBe('src/test.ts');
    expect(result.prompt).toBeDefined();
    expect(typeof result.prompt).toBe('string');
    expect(result.prompt.length).toBeGreaterThan(0);
    expect(result.durationMs).toBeDefined();
    expect(typeof result.durationMs).toBe('number');
    expect(result.bundles).toBeDefined();
    expect(result.annotatedBundles).toBeDefined();
  });

  it('返回的结果包含完整的 PipelineResult 结构', async () => {
    const plugin = await loadPlugin();

    const diff = `diff --git a/file.ts b/file.ts
index 1234567..890abcd 100644
--- a/file.ts
+++ b/file.ts
@@ -1,1 +1,1 @@
-const x = 1;
+const x = 2;
`;

    const result = await plugin.tools[0].handler({ diff });

    const expectedKeys = ['filteredDiffs', 'bundles', 'annotatedBundles', 'prompt'];
    for (const key of expectedKeys) {
      expect(result[key]).toBeDefined();
    }

    expect(Array.isArray(result.filteredDiffs)).toBe(true);
    expect(Array.isArray(result.bundles)).toBe(true);
    expect(Array.isArray(result.annotatedBundles)).toBe(true);
    expect(typeof result.prompt).toBe('string');
  });
});