import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  exportResults,
  exportJSON,
  exportMarkdown,
  exportSARIF,
  exportHTML,
  SARIF_LEVEL,
  escapeHtml,
  SEVERITY_HTML_STYLE,
  buildSummary,
  type ExportFormat,
  type ExportOptions,
  type ToolInfo,
} from '../../../src/result-exporter.js';
import type { Finding } from '../../../src/types.js';

// ── 测试 fixtures ──

function makeFinding(partial: Partial<Finding> = {}): Finding {
  return {
    file: 'src/app.ts',
    line: 10,
    severity: 'high',
    category: 'security',
    message: 'SQL injection detected',
    confidence: 0.85,
    source: 'rule',
    ruleId: 'sql-injection',
    suggestion: 'Use parameterized queries',
    ...partial,
  };
}

const SAMPLE_FINDINGS: Finding[] = [
  makeFinding({ file: 'src/a.ts', line: 10, severity: 'critical', message: 'critical issue', ruleId: 'CR001', category: 'security' }),
  makeFinding({ file: 'src/b.ts', line: 20, severity: 'high', message: 'high issue', ruleId: 'HI001', category: 'quality' }),
  makeFinding({ file: 'src/c.ts', line: 30, severity: 'medium', message: 'medium issue', ruleId: 'ME001', category: 'performance' }),
  makeFinding({ file: 'src/d.ts', line: 40, severity: 'low', message: 'low issue', ruleId: 'LO001', category: 'style' }),
  makeFinding({ file: 'src/e.ts', line: 50, severity: 'info', message: 'info issue', ruleId: 'IN001', category: 'style' }),
];

// ==================== 类型与常量 ====================

describe('ExportFormat 类型', () => {
  it('支持 json / markdown / sarif / html', () => {
    const formats: ExportFormat[] = ['json', 'markdown', 'sarif', 'html'];
    expect(formats).toHaveLength(4);
  });
});

describe('SARIF_LEVEL 映射', () => {
  it('critical 映射到 error', () => {
    expect(SARIF_LEVEL.critical).toBe('error');
  });
  it('high 映射到 error', () => {
    expect(SARIF_LEVEL.high).toBe('error');
  });
  it('medium 映射到 warning', () => {
    expect(SARIF_LEVEL.medium).toBe('warning');
  });
  it('low 映射到 note', () => {
    expect(SARIF_LEVEL.low).toBe('note');
  });
  it('info 映射到 none', () => {
    expect(SARIF_LEVEL.info).toBe('none');
  });
});

describe('SEVERITY_HTML_STYLE 映射', () => {
  it('每个 severity 都有颜色和图标', () => {
    const severities = ['critical', 'high', 'medium', 'low', 'info'] as const;
    for (const sev of severities) {
      expect(SEVERITY_HTML_STYLE[sev].color).toBeTruthy();
      expect(SEVERITY_HTML_STYLE[sev].icon).toBeTruthy();
    }
  });
});

// ==================== escapeHtml ====================

describe('escapeHtml', () => {
  it('转义 < > & " \'', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });

  it('转义 & 字符', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('转义单引号', () => {
    expect(escapeHtml("it's")).toBe('it&#039;s');
  });

  it('无特殊字符时原样返回', () => {
    expect(escapeHtml('plain text')).toBe('plain text');
  });

  it('空字符串', () => {
    expect(escapeHtml('')).toBe('');
  });
});

// ==================== buildSummary ====================

describe('buildSummary', () => {
  it('空 findings 返回全 0', () => {
    const summary = buildSummary([]);
    expect(summary).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
      total: 0,
    });
  });

  it('统计各 severity 数量', () => {
    const summary = buildSummary(SAMPLE_FINDINGS);
    expect(summary.critical).toBe(1);
    expect(summary.high).toBe(1);
    expect(summary.medium).toBe(1);
    expect(summary.low).toBe(1);
    expect(summary.info).toBe(1);
    expect(summary.total).toBe(5);
  });

  it('total 等于各 severity 计数之和', () => {
    const summary = buildSummary(SAMPLE_FINDINGS);
    expect(summary.total).toBe(summary.critical + summary.high + summary.medium + summary.low + summary.info);
  });

  it('重复 severity 正确累加', () => {
    const findings: Finding[] = [
      makeFinding({ severity: 'high' }),
      makeFinding({ severity: 'high' }),
      makeFinding({ severity: 'high' }),
    ];
    const summary = buildSummary(findings);
    expect(summary.high).toBe(3);
    expect(summary.total).toBe(3);
  });
});

// ==================== exportJSON ====================

describe('exportJSON', () => {
  it('默认包含摘要元信息', () => {
    const json = exportJSON(SAMPLE_FINDINGS);
    const parsed = JSON.parse(json);
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.total).toBe(5);
    expect(parsed.findings).toHaveLength(5);
    expect(parsed.title).toBe('Code Review Report');
    expect(parsed.generatedAt).toBeTruthy();
  });

  it('includeSummary=false 时仅输出 findings 数组', () => {
    const json = exportJSON(SAMPLE_FINDINGS, { format: 'json', includeSummary: false });
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(5);
  });

  it('空 findings 输出空数组或带空摘要', () => {
    const json = exportJSON([]);
    const parsed = JSON.parse(json);
    expect(parsed.summary.total).toBe(0);
    expect(parsed.findings).toHaveLength(0);
  });

  it('自定义标题', () => {
    const json = exportJSON([], { format: 'json', title: 'My Title' });
    const parsed = JSON.parse(json);
    expect(parsed.title).toBe('My Title');
  });

  it('输出是合法 JSON', () => {
    const json = exportJSON(SAMPLE_FINDINGS);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('finding 字段完整保留', () => {
    const json = exportJSON(SAMPLE_FINDINGS);
    const parsed = JSON.parse(json);
    expect(parsed.findings[0].file).toBe('src/a.ts');
    expect(parsed.findings[0].severity).toBe('critical');
    expect(parsed.findings[0].ruleId).toBe('CR001');
  });
});

// ==================== exportMarkdown ====================

describe('exportMarkdown', () => {
  it('包含标题', () => {
    const md = exportMarkdown(SAMPLE_FINDINGS);
    expect(md).toContain('# Code Review Report');
  });

  it('自定义标题', () => {
    const md = exportMarkdown(SAMPLE_FINDINGS, { format: 'markdown', title: 'My Report' });
    expect(md).toContain('# My Report');
  });

  it('包含生成时间戳', () => {
    const md = exportMarkdown(SAMPLE_FINDINGS);
    expect(md).toMatch(/_Generated:/);
  });

  it('包含摘要表格', () => {
    const md = exportMarkdown(SAMPLE_FINDINGS);
    expect(md).toContain('## Summary');
    expect(md).toContain('| Severity | Count |');
    expect(md).toContain('Critical');
    expect(md).toContain('High');
  });

  it('includeSummary=false 时不包含摘要表格', () => {
    const md = exportMarkdown(SAMPLE_FINDINGS, { format: 'markdown', includeSummary: false });
    expect(md).not.toContain('## Summary');
  });

  it('按 severity 分组展示 findings', () => {
    const md = exportMarkdown(SAMPLE_FINDINGS);
    expect(md).toContain('## CRITICAL');
    expect(md).toContain('## HIGH');
    expect(md).toContain('## MEDIUM');
    expect(md).toContain('## LOW');
    expect(md).toContain('## INFO');
  });

  it('每条 finding 包含文件位置', () => {
    const md = exportMarkdown(SAMPLE_FINDINGS);
    expect(md).toContain('src/a.ts:10');
    expect(md).toContain('src/b.ts:20');
  });

  it('包含 endLine 时显示行号范围', () => {
    const f = makeFinding({ line: 10, endLine: 15 });
    const md = exportMarkdown([f]);
    expect(md).toContain('src/app.ts:10-15');
  });

  it('包含 Category / Confidence / Source', () => {
    const md = exportMarkdown(SAMPLE_FINDINGS);
    expect(md).toContain('**Category:**');
    expect(md).toContain('**Confidence:**');
    expect(md).toContain('**Source:**');
  });

  it('包含 suggestion', () => {
    const md = exportMarkdown(SAMPLE_FINDINGS);
    expect(md).toContain('💡 **Suggestion:**');
    expect(md).toContain('Use parameterized queries');
  });

  it('无 suggestion 时不显示 Suggestion 行', () => {
    const f = makeFinding({ suggestion: undefined });
    const md = exportMarkdown([f]);
    expect(md).not.toContain('Suggestion');
  });

  it('空 findings 显示 No findings', () => {
    const md = exportMarkdown([]);
    expect(md).toContain('No findings');
  });
});

// ==================== exportSARIF ====================

describe('exportSARIF', () => {
  it('输出合法 JSON', () => {
    const sarif = exportSARIF(SAMPLE_FINDINGS);
    expect(() => JSON.parse(sarif)).not.toThrow();
  });

  it('版本为 2.1.0', () => {
    const sarif = exportSARIF(SAMPLE_FINDINGS);
    const parsed = JSON.parse(sarif);
    expect(parsed.version).toBe('2.1.0');
  });

  it('包含 $schema', () => {
    const sarif = exportSARIF(SAMPLE_FINDINGS);
    const parsed = JSON.parse(sarif);
    expect(parsed.$schema).toBeDefined();
    expect(parsed.$schema).toContain('sarif');
  });

  it('包含 runs 数组', () => {
    const sarif = exportSARIF(SAMPLE_FINDINGS);
    const parsed = JSON.parse(sarif);
    expect(Array.isArray(parsed.runs)).toBe(true);
    expect(parsed.runs.length).toBeGreaterThan(0);
  });

  it('runs[0].tool.driver 包含工具信息', () => {
    const sarif = exportSARIF(SAMPLE_FINDINGS, {
      format: 'sarif',
      toolInfo: { name: 'my-tool', version: '1.2.3', informationUri: 'https://example.com' },
    });
    const parsed = JSON.parse(sarif);
    const driver = parsed.runs[0].tool.driver;
    expect(driver.name).toBe('my-tool');
    expect(driver.version).toBe('1.2.3');
    expect(driver.informationUri).toBe('https://example.com');
  });

  it('默认工具信息', () => {
    const sarif = exportSARIF(SAMPLE_FINDINGS);
    const parsed = JSON.parse(sarif);
    expect(parsed.runs[0].tool.driver.name).toBeTruthy();
    expect(parsed.runs[0].tool.driver.version).toBeTruthy();
  });

  it('runs[0].results 包含每条 finding', () => {
    const sarif = exportSARIF(SAMPLE_FINDINGS);
    const parsed = JSON.parse(sarif);
    expect(parsed.runs[0].results).toHaveLength(SAMPLE_FINDINGS.length);
  });

  it('每条 result 包含 ruleId / level / message / locations', () => {
    const sarif = exportSARIF(SAMPLE_FINDINGS);
    const parsed = JSON.parse(sarif);
    const result = parsed.runs[0].results[0];
    expect(result.ruleId).toBeTruthy();
    expect(result.level).toBeDefined();
    expect(result.message).toBeDefined();
    expect(result.message.text).toBeDefined();
    expect(Array.isArray(result.locations)).toBe(true);
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe('src/a.ts');
    expect(result.locations[0].physicalLocation.region.startLine).toBe(10);
  });

  it('severity 正确映射到 SARIF level', () => {
    const sarif = exportSARIF(SAMPLE_FINDINGS);
    const parsed = JSON.parse(sarif);
    const results = parsed.runs[0].results;
    // SAMPLE_FINDINGS 按 ruleId 顺序输出（critical/high/medium/low/info）
    const levels = results.map((r: { level: string }) => r.level);
    expect(levels).toContain('error'); // critical + high
    expect(levels).toContain('warning'); // medium
    expect(levels).toContain('note'); // low
    expect(levels).toContain('none'); // info
  });

  it('result 包含 partialFingerprints', () => {
    const sarif = exportSARIF(SAMPLE_FINDINGS);
    const parsed = JSON.parse(sarif);
    expect(parsed.runs[0].results[0].partialFingerprints).toBeDefined();
    expect(parsed.runs[0].results[0].partialFingerprints.primaryLocationLineHash).toBeTruthy();
  });

  it('result 包含 properties (severity/category/confidence/source)', () => {
    const sarif = exportSARIF(SAMPLE_FINDINGS);
    const parsed = JSON.parse(sarif);
    const props = parsed.runs[0].results[0].properties;
    expect(props.severity).toBeDefined();
    expect(props.category).toBeDefined();
    expect(props.confidence).toBeDefined();
    expect(props.source).toBeDefined();
  });

  it('包含 endLine 时 region 包含 endLine', () => {
    const f = makeFinding({ line: 10, endLine: 15 });
    const sarif = exportSARIF([f]);
    const parsed = JSON.parse(sarif);
    expect(parsed.runs[0].results[0].locations[0].physicalLocation.region.endLine).toBe(15);
  });

  it('tool.driver.rules 聚合 ruleId', () => {
    const sarif = exportSARIF(SAMPLE_FINDINGS);
    const parsed = JSON.parse(sarif);
    const rules = parsed.runs[0].tool.driver.rules;
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBe(SAMPLE_FINDINGS.length);
  });

  it('result.message 包含 suggestion（若有）', () => {
    const f = makeFinding({ suggestion: 'fix it' });
    const sarif = exportSARIF([f]);
    const parsed = JSON.parse(sarif);
    expect(parsed.runs[0].results[0].message.text).toContain('fix it');
  });

  it('空 findings 输出空 results 数组', () => {
    const sarif = exportSARIF([]);
    const parsed = JSON.parse(sarif);
    expect(parsed.runs[0].results).toEqual([]);
  });
});

// ==================== exportHTML ====================

describe('exportHTML', () => {
  it('输出包含 <!DOCTYPE html>', () => {
    const html = exportHTML(SAMPLE_FINDINGS);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('包含 <html> 与 </html>', () => {
    const html = exportHTML(SAMPLE_FINDINGS);
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('包含 <style> 内联样式', () => {
    const html = exportHTML(SAMPLE_FINDINGS);
    expect(html).toContain('<style>');
    expect(html).toContain('</style>');
  });

  it('包含标题', () => {
    const html = exportHTML(SAMPLE_FINDINGS, { format: 'html', title: 'My Title' });
    expect(html).toContain('<title>My Title</title>');
    expect(html).toContain('<h1>My Title</h1>');
  });

  it('包含 Summary 部分', () => {
    const html = exportHTML(SAMPLE_FINDINGS);
    expect(html).toContain('Summary');
    expect(html).toContain('summary-card');
    expect(html).toContain('critical');
    expect(html).toContain('high');
  });

  it('包含工具信息', () => {
    const html = exportHTML(SAMPLE_FINDINGS, {
      format: 'html',
      toolInfo: { name: 'my-tool', version: '1.2.3' },
    });
    expect(html).toContain('my-tool');
    expect(html).toContain('1.2.3');
  });

  it('使用 <details> 实现可折叠 finding', () => {
    const html = exportHTML(SAMPLE_FINDINGS);
    expect(html).toContain('<details');
    expect(html).toContain('<summary>');
  });

  it('转义 HTML 特殊字符', () => {
    const f = makeFinding({ message: '<script>alert("xss")</script>' });
    const html = exportHTML([f]);
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('每条 finding 包含 severity 着色 class', () => {
    const html = exportHTML(SAMPLE_FINDINGS);
    expect(html).toContain('class="finding critical"');
    expect(html).toContain('class="finding high"');
    expect(html).toContain('class="finding medium"');
    expect(html).toContain('class="finding low"');
    expect(html).toContain('class="finding info"');
  });

  it('包含文件位置', () => {
    const html = exportHTML(SAMPLE_FINDINGS);
    expect(html).toContain('src/a.ts:10');
  });

  it('包含 endLine 时显示行号范围', () => {
    const f = makeFinding({ line: 10, endLine: 15 });
    const html = exportHTML([f]);
    expect(html).toContain('src/app.ts:10-15');
  });

  it('包含 suggestion（转义）', () => {
    const f = makeFinding({ suggestion: 'Use <parameterized> queries' });
    const html = exportHTML([f]);
    expect(html).toContain('Suggestion');
    expect(html).toContain('&lt;parameterized&gt;');
  });

  it('包含 Confidence 与 Source 元信息', () => {
    const html = exportHTML(SAMPLE_FINDINGS);
    expect(html).toContain('Confidence:');
    expect(html).toContain('Source:');
  });

  it('空 findings 显示 "No findings"', () => {
    const html = exportHTML([]);
    expect(html).toContain('No findings');
  });

  it('findings 按 severity 降序排列', () => {
    const shuffled: Finding[] = [
      makeFinding({ file: 'src/low.ts', severity: 'low' }),
      makeFinding({ file: 'src/critical.ts', severity: 'critical' }),
      makeFinding({ file: 'src/high.ts', severity: 'high' }),
    ];
    const html = exportHTML(shuffled);
    // critical 应在 high 之前，high 应在 low 之前
    const criticalIdx = html.indexOf('src/critical.ts');
    const highIdx = html.indexOf('src/high.ts');
    const lowIdx = html.indexOf('src/low.ts');
    expect(criticalIdx).toBeLessThan(highIdx);
    expect(highIdx).toBeLessThan(lowIdx);
  });
});

// ==================== exportResults（分发函数） ====================

describe('exportResults', () => {
  it('format=json 调用 exportJSON', () => {
    const result = exportResults(SAMPLE_FINDINGS, { format: 'json' });
    const parsed = JSON.parse(result);
    expect(parsed.findings).toBeDefined();
  });

  it('format=markdown 调用 exportMarkdown', () => {
    const result = exportResults(SAMPLE_FINDINGS, { format: 'markdown' });
    expect(result).toContain('# Code Review Report');
  });

  it('format=sarif 调用 exportSARIF', () => {
    const result = exportResults(SAMPLE_FINDINGS, { format: 'sarif' });
    const parsed = JSON.parse(result);
    expect(parsed.version).toBe('2.1.0');
  });

  it('format=html 调用 exportHTML', () => {
    const result = exportResults(SAMPLE_FINDINGS, { format: 'html' });
    expect(result).toContain('<!DOCTYPE html>');
  });

  it('不支持的格式抛出错误', () => {
    expect(() =>
      exportResults(SAMPLE_FINDINGS, { format: 'xml' as ExportFormat }),
    ).toThrow(/Unsupported export format/);
  });

  it('未指定 outputFile 时返回字符串', () => {
    const result = exportResults(SAMPLE_FINDINGS, { format: 'json' });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('指定 outputFile 时写入文件并返回空字符串', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'export-test-'));
    try {
      const filePath = join(tmpDir, 'report.json');
      const result = exportResults(SAMPLE_FINDINGS, {
        format: 'json',
        outputFile: filePath,
      });
      expect(result).toBe('');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.findings).toHaveLength(SAMPLE_FINDINGS.length);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('outputFile 支持 markdown 格式', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'export-test-'));
    try {
      const filePath = join(tmpDir, 'report.md');
      exportResults(SAMPLE_FINDINGS, { format: 'markdown', outputFile: filePath });
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('# Code Review Report');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('outputFile 支持 sarif 格式', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'export-test-'));
    try {
      const filePath = join(tmpDir, 'report.sarif');
      exportResults(SAMPLE_FINDINGS, { format: 'sarif', outputFile: filePath });
      const content = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.version).toBe('2.1.0');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('outputFile 支持 html 格式', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'export-test-'));
    try {
      const filePath = join(tmpDir, 'report.html');
      exportResults(SAMPLE_FINDINGS, { format: 'html', outputFile: filePath });
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('<!DOCTYPE html>');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ==================== 类型导出 ====================

describe('类型导出', () => {
  it('ExportOptions 接口存在', () => {
    const opts: ExportOptions = { format: 'json' };
    expect(opts.format).toBe('json');
  });

  it('ToolInfo 接口存在', () => {
    const info: ToolInfo = { name: 'tool', version: '1.0.0' };
    expect(info.name).toBe('tool');
  });
});

// ==================== CLI 集成：--format / --output ====================

interface TestState {
  stdin: string;
  exitError: Error | null;
  stdout: string[];
  stderr: string[];
}

const testState: TestState = {
  stdin: '',
  exitError: null,
  stdout: [],
  stderr: [],
};

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn((...args: unknown[]) => {
      const fd = args[0];
      if (fd === 0 || fd === '0') {
        return testState.stdin;
      }
      return (actual.readFileSync as (...a: unknown[]) => unknown)(...args);
    }),
  };
});

async function loadCli(opts: {
  argv: string[];
  stdin?: string;
}): Promise<{
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}> {
  const { argv, stdin = '' } = opts;

  testState.stdin = stdin;
  testState.exitError = null;
  testState.stdout = [];
  testState.stderr = [];

  const origArgv = process.argv;
  process.argv = ['node', '/tmp/cli.js', ...argv];

  vi.resetModules();

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    testState.stdout.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    testState.stderr.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });
  const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    if (typeof chunk === 'string') {
      testState.stdout.push(chunk);
    }
    return true;
  });

  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    const err = new Error(`__PROCESS_EXIT_${code ?? 0}__`);
    testState.exitError = err;
    throw err;
  }) as never);

  try {
    await import('../../../src/cli.js');
    return {
      stdout: [...testState.stdout],
      stderr: [...testState.stderr],
      exitCode: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const match = msg.match(/^__PROCESS_EXIT_(\d+)__$/);
    if (match) {
      return {
        stdout: [...testState.stdout],
        stderr: [...testState.stderr],
        exitCode: parseInt(match[1], 10),
      };
    }
    throw err;
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    writeSpy.mockRestore();
    exitSpy.mockRestore();
    process.argv = origArgv;
    vi.resetModules();
  }
}

describe('CLI: review --format / --output', () => {
  beforeEach(() => {
    testState.stdin = '';
    testState.stdout = [];
    testState.stderr = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('--format json 输出 JSON 到 stdout', async () => {
    const findings = [makeFinding({ severity: 'critical' })];
    const { stdout, exitCode } = await loadCli({
      argv: ['review', '--format', 'json'],
      stdin: JSON.stringify(findings),
    });

    expect(exitCode).toBeNull();
    const output = stdout.join('\n');
    // 应可解析为 JSON
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output);
    expect(parsed.findings).toBeDefined();
  });

  it('--format markdown 输出 Markdown 到 stdout', async () => {
    const findings = [makeFinding({ severity: 'high' })];
    const { stdout, exitCode } = await loadCli({
      argv: ['review', '--format', 'markdown'],
      stdin: JSON.stringify(findings),
    });

    expect(exitCode).toBeNull();
    const output = stdout.join('\n');
    expect(output).toContain('# Code Review Report');
  });

  it('--format sarif 输出 SARIF 到 stdout', async () => {
    const findings = [makeFinding({ severity: 'medium' })];
    const { stdout, exitCode } = await loadCli({
      argv: ['review', '--format', 'sarif'],
      stdin: JSON.stringify(findings),
    });

    expect(exitCode).toBeNull();
    const output = stdout.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.version).toBe('2.1.0');
  });

  it('--format html 输出 HTML 到 stdout', async () => {
    const findings = [makeFinding({ severity: 'low' })];
    const { stdout, exitCode } = await loadCli({
      argv: ['review', '--format', 'html'],
      stdin: JSON.stringify(findings),
    });

    expect(exitCode).toBeNull();
    const output = stdout.join('\n');
    expect(output).toContain('<!DOCTYPE html>');
  });

  it('--output 写入到指定文件', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cli-export-'));
    try {
      const filePath = join(tmpDir, 'out.json');
      const findings = [makeFinding({ severity: 'critical' })];
      const { exitCode } = await loadCli({
        argv: ['review', '--format', 'json', '--output', filePath],
        stdin: JSON.stringify(findings),
      });

      expect(exitCode).toBeNull();
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.findings).toHaveLength(1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('无效 --format 报错退出 1', async () => {
    const { exitCode, stderr } = await loadCli({
      argv: ['review', '--format', 'xml'],
      stdin: JSON.stringify([]),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toMatch(/format|invalid|unsupported/i);
  });
});
