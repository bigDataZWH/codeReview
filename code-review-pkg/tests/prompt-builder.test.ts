import { describe, it, expect } from 'vitest';
import { buildReviewPrompt, buildSecurityPrompt, buildImpactPrompt, buildScanPrompt, formatFindingsSummary, buildCustomPrompt, getLanguageReviewTip, wrapDiffInCodeBlock, getOWASPTop10List, estimatePromptTokens, buildReviewPromptWithTokenLimit } from '../src/prompt-builder.js';
import type { FileDiff, FileBundle, PipelineContext, MCPContextResult, RuleAnnotation } from '../src/types.js';

// ── 辅助函数 ──

function makeDiff(path: string): FileDiff {
  return {
    path,
    status: 'modified',
    hunks: [
      {
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 3,
        header: '@@ -1 +1,3 @@',
        lines: [
          { type: 'delete', content: '-old', oldLineNumber: 1 },
          { type: 'add', content: '+new1', newLineNumber: 1 },
          { type: 'add', content: '+new2', newLineNumber: 2 },
        ],
      },
    ],
  };
}

function makeBundle(path: string, annotations: RuleAnnotation[] = []): FileBundle {
  return {
    id: path,
    primary: makeDiff(path),
    related: [],
    annotations,
  };
}

function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  const diffs: FileDiff[] = [makeDiff('src/app.ts'), makeDiff('src/util.ts')];
  const bundles: FileBundle[] = [makeBundle('src/app.ts'), makeBundle('src/util.ts')];

  return {
    filteredDiffs: diffs,
    bundles,
    annotatedBundles: bundles,
    ...overrides,
  };
}

// ── buildReviewPrompt 测试 ──

describe('buildReviewPrompt', () => {
  // 1. 基础 review prompt — 包含 diff、文件列表、统计信息
  it('基础 review prompt 包含 diff、文件列表和统计信息', () => {
    const context = makeContext();
    const prompt = buildReviewPrompt(context);

    // 应包含文件路径
    expect(prompt).toContain('src/app.ts');
    expect(prompt).toContain('src/util.ts');

    // 应包含 diff 内容
    expect(prompt).toContain('-old');
    expect(prompt).toContain('+new1');

    // 应包含统计信息（文件数量）
    expect(prompt).toMatch(/\d+\s*(files|个文件|文件)/i);
  });

  // 2. 安全 review prompt — 包含安全方法论、误报过滤规则
  it('安全 review prompt 包含安全方法论和误报过滤规则', () => {
    const context = makeContext();
    const prompt = buildSecurityPrompt(context);

    // 安全 prompt 应包含安全相关关键词
    expect(prompt).toMatch(/安全|security|SQL.?injection|XSS|injection/i);

    // 应包含 diff 内容
    expect(prompt).toContain('src/app.ts');
  });

  // 3. 带规则标注 — annotations 正确嵌入 prompt
  it('带规则标注时 annotations 正确嵌入 prompt', () => {
    const annotations: RuleAnnotation[] = [
      {
        ruleId: 'sql-injection',
        ruleName: 'SQL 拼接检测',
        severity: 'high',
        message: '检测到字符串拼接构造 SQL',
        line: 42,
        category: 'security',
      },
      {
        ruleId: 'no-console',
        ruleName: '禁止 console',
        severity: 'medium',
        message: '不应使用 console.log',
        category: 'best-practice',
      },
    ];

    const bundle = makeBundle('src/app.ts', annotations);
    const context = makeContext({
      annotatedBundles: [bundle],
    });

    const prompt = buildReviewPrompt(context);

    // 应包含标注信息
    expect(prompt).toContain('sql-injection');
    expect(prompt).toContain('SQL 拼接检测');
    expect(prompt).toContain('no-console');
    expect(prompt).toContain('禁止 console');
  });

  // 4. 带 MCP 上下文 — 图谱增强上下文正确嵌入
  it('带 MCP 上下文时图谱增强上下文正确嵌入 prompt', () => {
    const mcpContext: MCPContextResult = {
      filePaths: ['src/app.ts', 'src/util.ts'],
      codeSnippets: {
        'src/app.ts': 'function main() { return 42; }',
      },
      blastRadius: [
        { path: 'src/handler.ts', type: 'caller', relation: 'calls' },
        { path: 'src/db.ts', type: 'callee', relation: 'called by' },
      ],
      riskScore: 0.75,
    };

    const context = makeContext({ context: mcpContext });
    const prompt = buildReviewPrompt(context);

    // 应包含图谱上下文
    expect(prompt).toContain('src/handler.ts');
    expect(prompt).toContain('caller');
    expect(prompt).toContain('0.75');
  });

  // 5. 空输入 — 生成最小有效 prompt
  it('空输入时生成最小有效 prompt', () => {
    const context: PipelineContext = {
      filteredDiffs: [],
      bundles: [],
      annotatedBundles: [],
    };

    const prompt = buildReviewPrompt(context);

    // 应返回非空字符串
    expect(prompt).toBeTruthy();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  // 6. 自定义模板 — 使用自定义模板替换变量
  it('自定义模板正确替换变量', () => {
    const context = makeContext();
    const template = '## 文件列表\n$FILE_LIST\n## 自定义规则\n$CUSTOM_RULES';
    const prompt = buildReviewPrompt(context, template);

    // 应包含模板结构
    expect(prompt).toContain('## 文件列表');
    expect(prompt).toContain('## 自定义规则');

    // FILE_LIST 变量应被替换
    expect(prompt).toContain('src/app.ts');

    // CUSTOM_RULES 变量应为空（未设置）
    expect(prompt).not.toContain('$FILE_LIST');
    expect(prompt).not.toContain('$CUSTOM_RULES');
  });

  // 7. customRules 非空时嵌入 prompt
  it('customRules 非空时正确嵌入 prompt', () => {
    const context = makeContext({
      customRules: '1. 所有函数必须有 JSDoc 注释\n2. 禁止使用 any 类型',
    });
    const prompt = buildReviewPrompt(context);

    expect(prompt).toContain('所有函数必须有 JSDoc 注释');
    expect(prompt).toContain('禁止使用 any 类型');
    expect(prompt).not.toContain('(无自定义规则)');
  });

  it('customRules 为空时显示占位文本', () => {
    const context = makeContext();
    const prompt = buildReviewPrompt(context);
    expect(prompt).toContain('(无自定义规则)');
  });
});

// ── buildImpactPrompt 测试 ──

describe('buildImpactPrompt', () => {
  it('生成影响分析 prompt，包含文件列表和 diff', () => {
    const context = makeContext();
    const prompt = buildImpactPrompt(context);

    expect(prompt).toContain('src/app.ts');
    expect(prompt).toContain('-old');
    expect(prompt).toContain('Impact Analysis');
    expect(prompt).toContain('影响分析');
  });

  it('空输入时生成有效 prompt', () => {
    const context: PipelineContext = {
      filteredDiffs: [],
      bundles: [],
      annotatedBundles: [],
    };

    const prompt = buildImpactPrompt(context);
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(0);
  });
});

// ── buildScanPrompt 测试 (Round 23) ──

describe('buildScanPrompt', () => {
  it('生成全量扫描 prompt，包含扫描任务描述', () => {
    const context = makeContext();
    const prompt = buildScanPrompt(context);

    expect(prompt).toContain('src/app.ts');
    expect(prompt).toContain('-old');
    expect(prompt).toContain('Full Code Scan');
    expect(prompt).toContain('全量扫描审查');
  });

  it('空输入时生成有效 prompt', () => {
    const context: PipelineContext = {
      filteredDiffs: [],
      bundles: [],
      annotatedBundles: [],
    };

    const prompt = buildScanPrompt(context);
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(0);
  });
});

// ── formatFindingsSummary 测试 (Round 29) ──

describe('formatFindingsSummary', () => {
  it('空 findings 返回 "No findings."', () => {
    expect(formatFindingsSummary([])).toBe('No findings.');
  });

  it('按 severity 分组显示 findings', () => {
    const findings = [
      { file: 'a.ts', line: 1, severity: 'critical' as const, category: 'security', message: 'SQL injection', confidence: 0.9, source: 'ai' as const },
      { file: 'b.ts', line: 2, severity: 'low' as const, category: 'style', message: 'indentation', confidence: 0.7, source: 'ai' as const },
    ];

    const summary = formatFindingsSummary(findings);
    expect(summary).toContain('Total: 2');
    expect(summary).toContain('CRITICAL');
    expect(summary).toContain('LOW');
    expect(summary).toContain('SQL injection');
    expect(summary).toContain('a.ts:1');
    expect(summary).toContain('indentation');
  });
});

// ── buildCustomPrompt 测试 ──

describe('buildCustomPrompt', () => {
  it('replaces template variables', () => {
    const context = makeContext();
    const template = 'Review: $FILE_LIST\nStats: $STATS';
    const prompt = buildCustomPrompt(context, template);
    expect(prompt).toContain('src/app.ts');
    expect(prompt).toContain('Review:');
    expect(prompt).not.toContain('$FILE_LIST');
  });

  it('handles empty context', () => {
    const context: PipelineContext = {
      filteredDiffs: [],
      bundles: [],
      annotatedBundles: [],
    };
    const prompt = buildCustomPrompt(context, 'Files: $FILE_LIST');
    expect(prompt).toContain('Files:');
  });
});

// ── getLanguageReviewTip ──

describe('getLanguageReviewTip', () => {
  it('returns TypeScript tip for TypeScript diffs', () => {
    const diffs: FileDiff[] = [
      { path: 'a.ts', status: 'modified', language: 'typescript', hunks: [] },
    ];
    const tip = getLanguageReviewTip(diffs);
    expect(tip).toContain('typescript');
    expect(tip).toContain('类型安全');
  });

  it('returns empty string for diffs without language', () => {
    const diffs: FileDiff[] = [
      { path: 'a.txt', status: 'modified', hunks: [] },
    ];
    expect(getLanguageReviewTip(diffs)).toBe('');
  });

  it('returns empty string for empty diffs', () => {
    expect(getLanguageReviewTip([])).toBe('');
  });

  it('picks most common language', () => {
    const diffs: FileDiff[] = [
      { path: 'a.ts', status: 'modified', language: 'typescript', hunks: [] },
      { path: 'b.ts', status: 'modified', language: 'typescript', hunks: [] },
      { path: 'c.py', status: 'modified', language: 'python', hunks: [] },
    ];
    const tip = getLanguageReviewTip(diffs);
    expect(tip).toContain('typescript');
  });
});

// ── Round 49: wrapDiffInCodeBlock ──

describe('wrapDiffInCodeBlock', () => {
  it('用 ```diff 包裹文本', () => {
    const result = wrapDiffInCodeBlock('-old\n+new');
    expect(result).toBe('```diff\n-old\n+new\n```');
  });

  it('空字符串原样返回', () => {
    expect(wrapDiffInCodeBlock('')).toBe('');
  });

  it('(无变更文件) 原样返回', () => {
    expect(wrapDiffInCodeBlock('(无变更文件)')).toBe('(无变更文件)');
  });
});

// ── Round 56: OWASP Top 10 ──

describe('getOWASPTop10List', () => {
  it('返回 10 项 OWASP 类别', () => {
    const list = getOWASPTop10List();
    const items = list.split('\n');
    expect(items).toHaveLength(10);
    expect(list).toContain('A01:2021');
    expect(list).toContain('A10:2021');
    expect(list).toContain('Injection');
    expect(list).toContain('SSRF');
  });
});

// ── Round 60: estimatePromptTokens ──

describe('estimatePromptTokens', () => {
  it('字符数/4 向上取整', () => {
    expect(estimatePromptTokens('hello')).toBe(2); // 5/4 = 1.25 -> 2
    expect(estimatePromptTokens('abcdefgh')).toBe(2); // 8/4 = 2
    expect(estimatePromptTokens('')).toBe(0);
    expect(estimatePromptTokens('abc')).toBe(1); // 3/4 = 0.75 -> 1
  });
});

// ── Round 70: buildReviewPromptWithTokenLimit ──

describe('buildReviewPromptWithTokenLimit', () => {
  it('未超限时返回完整 prompt', () => {
    const context = makeContext();
    const prompt = buildReviewPromptWithTokenLimit(context, 100000);
    expect(prompt).not.toContain('截断');
    expect(prompt).toContain('src/app.ts');
  });

  it('超限时截断并添加警告', () => {
    const context = makeContext();
    // Very small token limit to force truncation
    const prompt = buildReviewPromptWithTokenLimit(context, 5);
    expect(prompt).toContain('截断');
  });
});
