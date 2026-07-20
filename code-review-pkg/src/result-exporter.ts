// src/result-exporter.ts — Task 15：结果导出
//
// 职责：
// 1. exportResults：根据格式分发到具体导出函数
// 2. exportJSON：导出为 JSON
// 3. exportMarkdown：导出为 Markdown
// 4. exportSARIF：导出为 SARIF v2.1.0 格式（参考 https://sarifweb.azurewebsites.net/）
// 5. exportHTML：导出为 HTML（含可折叠的 finding 列表）
//
// 设计取舍：
// - SARIF 格式遵循 SARIF v2.1.0 规范（OASIS 标准）
// - HTML 输出为自包含的单文件（CSS 内联，无外部依赖）
// - 所有导出函数返回字符串，写入文件由调用方负责（或通过 exportResults 选项）
//
// 与 cli.ts 集成：
// - review/security-review 等命令支持 --format <json|markdown|sarif|html> 与 --output <file>
// - 默认输出到 stdout，--output 指定时写入文件

import type { Finding, Severity } from './types.js';
import { SEVERITY_ORDER } from './constants.js';
import { writeFileSync } from 'node:fs';

// ==================== 类型定义 ====================

/** 支持的导出格式 */
export type ExportFormat = 'json' | 'markdown' | 'sarif' | 'html';

/** 导出选项 */
export interface ExportOptions {
  /** 输出格式 */
  format: ExportFormat;
  /** 输出文件路径（不指定时返回字符串） */
  outputFile?: string;
  /** 报告标题（默认 'Code Review Report'） */
  title?: string;
  /** 是否包含摘要（默认 true） */
  includeSummary?: boolean;
  /** 工具信息（用于 SARIF 与 HTML 元信息） */
  toolInfo?: ToolInfo;
}

/** 工具元信息 */
export interface ToolInfo {
  name?: string;
  version?: string;
  informationUri?: string;
}

// ==================== exportResults（分发函数） ====================

/**
 * 按指定格式导出 findings。
 *
 * @param findings 待导出的 findings
 * @param options  导出选项
 * @returns 若未指定 outputFile 则返回格式化字符串；否则写入文件并返回空字符串
 */
export function exportResults(findings: Finding[], options: ExportOptions): string {
  const { format, outputFile } = options;
  let content: string;

  switch (format) {
    case 'json':
      content = exportJSON(findings, options);
      break;
    case 'markdown':
      content = exportMarkdown(findings, options);
      break;
    case 'sarif':
      content = exportSARIF(findings, options);
      break;
    case 'html':
      content = exportHTML(findings, options);
      break;
    default:
      throw new Error(`Unsupported export format: ${String(format)}`);
  }

  if (outputFile) {
    writeFileSync(outputFile, content, 'utf-8');
    return '';
  }

  return content;
}

// ==================== exportJSON ====================

/**
 * 导出为 JSON 格式。
 *
 * 输出包含：findings 数组 + 摘要元信息
 */
export function exportJSON(findings: Finding[], options: ExportOptions = { format: 'json' }): string {
  const { includeSummary = true, title = 'Code Review Report' } = options;

  if (!includeSummary) {
    return JSON.stringify(findings, null, 2);
  }

  const summary = buildSummary(findings);
  const payload = {
    title,
    generatedAt: new Date().toISOString(),
    summary,
    findings,
  };
  return JSON.stringify(payload, null, 2);
}

// ==================== exportMarkdown ====================

/**
 * 导出为 Markdown 格式。
 *
 * 输出包含：标题、摘要表、按 severity 分组的 finding 详情
 */
export function exportMarkdown(findings: Finding[], options: ExportOptions = { format: 'markdown' }): string {
  const { title = 'Code Review Report', includeSummary = true } = options;
  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`_Generated: ${new Date().toISOString()}_`);
  lines.push('');

  if (findings.length === 0) {
    lines.push('No findings.');
    return lines.join('\n');
  }

  // 摘要
  if (includeSummary) {
    const summary = buildSummary(findings);
    lines.push('## Summary');
    lines.push('');
    lines.push('| Severity | Count |');
    lines.push('|----------|-------|');
    lines.push(`| 🔴 Critical | ${summary.critical} |`);
    lines.push(`| 🟠 High | ${summary.high} |`);
    lines.push(`| 🔵 Medium | ${summary.medium} |`);
    lines.push(`| 🟢 Low | ${summary.low} |`);
    lines.push(`| ⚪ Info | ${summary.info} |`);
    lines.push(`| **Total** | **${summary.total}** |`);
    lines.push('');
  }

  // 按 severity 分组
  const groups: Record<string, Finding[]> = {};
  for (const f of findings) {
    if (!groups[f.severity]) groups[f.severity] = [];
    groups[f.severity].push(f);
  }

  const sevOrder: Array<Severity | 'info'> = ['critical', 'high', 'medium', 'low', 'info'];
  for (const sev of sevOrder) {
    const group = groups[sev];
    if (!group || group.length === 0) continue;
    const sevLabel = sev.toUpperCase();
    lines.push(`## ${sevLabel} (${group.length})`);
    lines.push('');

    for (let i = 0; i < group.length; i++) {
      const f = group[i];
      const loc = f.endLine != null && f.endLine !== f.line
        ? `${f.file}:${f.line}-${f.endLine}`
        : `${f.file}:${f.line}`;
      lines.push(`### ${i + 1}. ${loc}`);
      lines.push('');
      lines.push(`- **Category:** ${f.category}`);
      lines.push(`- **Confidence:** ${(f.confidence * 100).toFixed(0)}%`);
      lines.push(`- **Source:** ${f.source}${f.ruleId ? ` (${f.ruleId})` : ''}`);
      lines.push('');
      lines.push(f.message);
      lines.push('');
      if (f.suggestion) {
        lines.push(`> 💡 **Suggestion:** ${f.suggestion}`);
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

// ==================== exportSARIF ====================

/** SARIF 严重度级别（按 SARIF v2.1.0 规范） */
export const SARIF_LEVEL: Record<Severity | 'info', 'error' | 'warning' | 'note' | 'none'> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'note',
  info: 'none',
};

/**
 * 导出为 SARIF v2.1.0 格式。
 *
 * 参考：
 * - https://sarifweb.azurewebsites.net/
 * - https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 *
 * 输出包含：
 * - runs[].tool：工具信息
 * - runs[].results[]：每条 finding 对应一个 result
 * - rules 描述（从 findings 中聚合 ruleId）
 */
export function exportSARIF(findings: Finding[], options: ExportOptions = { format: 'sarif' }): string {
  const { toolInfo } = options;
  const toolName = toolInfo?.name ?? 'code-review';
  const toolVersion = toolInfo?.version ?? '0.1.0';
  const informationUri = toolInfo?.informationUri ?? 'https://github.com/opencode/code-review';

  // 聚合规则
  const rulesMap = new Map<string, {
    id: string;
    name: string;
    shortDescription: string;
    fullDescription?: string;
    defaultLevel: 'error' | 'warning' | 'note' | 'none';
  }>();

  for (const f of findings) {
    const ruleId = f.ruleId ?? `unknown-${f.category}`;
    if (!rulesMap.has(ruleId)) {
      rulesMap.set(ruleId, {
        id: ruleId,
        name: ruleId,
        shortDescription: f.category,
        fullDescription: f.message,
        defaultLevel: SARIF_LEVEL[f.severity] ?? 'warning',
      });
    }
  }

  const rules = [...rulesMap.values()];

  // 构造 results
  const results = findings.map((f, idx) => {
    const ruleId = f.ruleId ?? `unknown-${f.category}`;
    return {
      ruleId,
      ruleIndex: Math.max(0, rules.findIndex((r) => r.id === ruleId)),
      level: SARIF_LEVEL[f.severity] ?? 'warning',
      message: {
        text: f.message + (f.suggestion ? `\n\nSuggestion: ${f.suggestion}` : ''),
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: f.file,
            },
            region: {
              startLine: f.line,
              ...(f.endLine != null && f.endLine !== f.line
                ? { endLine: f.endLine }
                : {}),
            },
          },
        },
      ],
      partialFingerprints: {
        primaryLocationLineHash: `${f.file}:${f.line}:${idx}`,
      },
      properties: {
        severity: f.severity,
        category: f.category,
        confidence: f.confidence,
        source: f.source,
      },
    };
  });

  const sarifLog = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: toolName,
            version: toolVersion,
            informationUri,
            rules,
          },
        },
        results,
      },
    ],
  };

  return JSON.stringify(sarifLog, null, 2);
}

// ==================== exportHTML ====================

/** HTML 转义 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** severity 到颜色与图标的映射（用于 HTML 内联样式） */
export const SEVERITY_HTML_STYLE: Record<Severity | 'info', { color: string; icon: string }> = {
  critical: { color: '#dc2626', icon: '🔴' },
  high: { color: '#ea580c', icon: '🟠' },
  medium: { color: '#2563eb', icon: '🔵' },
  low: { color: '#16a34a', icon: '🟢' },
  info: { color: '#6b7280', icon: '⚪' },
};

/**
 * 导出为自包含的 HTML 文件。
 *
 * 输出包含：
 * - 嵌入式 CSS
 * - 报告标题与摘要
 * - 可折叠的 finding 列表
 * - 按 severity 着色
 */
export function exportHTML(findings: Finding[], options: ExportOptions = { format: 'html' }): string {
  const { title = 'Code Review Report', toolInfo } = options;
  const summary = buildSummary(findings);
  const toolName = escapeHtml(toolInfo?.name ?? 'code-review');
  const toolVersion = escapeHtml(toolInfo?.version ?? '0.1.0');

  const parts: string[] = [];
  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="en">');
  parts.push('<head>');
  parts.push('<meta charset="UTF-8">');
  parts.push(`<title>${escapeHtml(title)}</title>`);
  parts.push('<style>');
  parts.push(`
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1100px; margin: 0 auto; padding: 24px; color: #1f2937; background: #f9fafb; }
    h1 { color: #111827; border-bottom: 2px solid #d1d5db; padding-bottom: 8px; }
    .meta { color: #6b7280; font-size: 0.875rem; margin-bottom: 16px; }
    .summary { background: #fff; padding: 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 24px; }
    .summary h2 { margin-top: 0; font-size: 1.125rem; }
    .summary-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
    .summary-card { padding: 12px; border-radius: 6px; text-align: center; color: #fff; font-weight: 600; }
    .summary-card.critical { background: #dc2626; }
    .summary-card.high { background: #ea580c; }
    .summary-card.medium { background: #2563eb; }
    .summary-card.low { background: #16a34a; }
    .summary-card.info { background: #6b7280; }
    .summary-card .count { font-size: 1.5rem; }
    .summary-card .label { font-size: 0.75rem; text-transform: uppercase; }
    .finding { background: #fff; padding: 12px 16px; border-radius: 6px; margin-bottom: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); border-left: 4px solid #d1d5db; }
    .finding.critical { border-left-color: #dc2626; }
    .finding.high { border-left-color: #ea580c; }
    .finding.medium { border-left-color: #2563eb; }
    .finding.low { border-left-color: #16a34a; }
    .finding.info { border-left-color: #6b7280; }
    .finding-header { display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer; }
    .finding-header .sev { padding: 2px 8px; border-radius: 4px; color: #fff; font-size: 0.75rem; }
    .finding-header .sev.critical { background: #dc2626; }
    .finding-header .sev.high { background: #ea580c; }
    .finding-header .sev.medium { background: #2563eb; }
    .finding-header .sev.low { background: #16a34a; }
    .finding-header .sev.info { background: #6b7280; }
    .finding-header .loc { color: #4b5563; font-family: ui-monospace, 'SF Mono', Consolas, monospace; font-size: 0.875rem; }
    .finding-body { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #e5e7eb; }
    .finding-body .msg { color: #111827; margin-bottom: 8px; }
    .finding-body .suggestion { background: #ecfdf5; padding: 8px; border-radius: 4px; margin: 8px 0; color: #065f46; }
    .finding-body .meta { color: #6b7280; font-size: 0.75rem; display: flex; gap: 16px; flex-wrap: wrap; }
    details summary { list-style: none; cursor: pointer; }
    details summary::-webkit-details-marker { display: none; }
  `);
  parts.push('</style>');
  parts.push('</head>');
  parts.push('<body>');
  parts.push(`<h1>${escapeHtml(title)}</h1>`);
  parts.push(`<div class="meta">Generated by ${toolName} v${toolVersion} · ${new Date().toISOString()}</div>`);

  // 摘要
  parts.push('<div class="summary">');
  parts.push('  <h2>Summary</h2>');
  parts.push('  <div class="summary-grid">');
  parts.push(`    <div class="summary-card critical"><div class="count">${summary.critical}</div><div class="label">Critical</div></div>`);
  parts.push(`    <div class="summary-card high"><div class="count">${summary.high}</div><div class="label">High</div></div>`);
  parts.push(`    <div class="summary-card medium"><div class="count">${summary.medium}</div><div class="label">Medium</div></div>`);
  parts.push(`    <div class="summary-card low"><div class="count">${summary.low}</div><div class="label">Low</div></div>`);
  parts.push(`    <div class="summary-card info"><div class="count">${summary.info}</div><div class="label">Info</div></div>`);
  parts.push('  </div>');
  parts.push(`  <div style="margin-top:12px;color:#6b7280;font-size:0.875rem;">Total: ${summary.total} findings</div>`);
  parts.push('</div>');

  // Findings 列表
  parts.push('<h2>Findings</h2>');
  if (findings.length === 0) {
    parts.push('<p>✅ No findings.</p>');
  } else {
    // 按 severity 降序
    const sorted = [...findings].sort((a, b) => {
      const aL = SEVERITY_ORDER[a.severity] ?? 0;
      const bL = SEVERITY_ORDER[b.severity] ?? 0;
      return bL - aL;
    });

    for (const f of sorted) {
      const sev = f.severity;
      const style = SEVERITY_HTML_STYLE[sev];
      const loc = f.endLine != null && f.endLine !== f.line
        ? `${escapeHtml(f.file)}:${f.line}-${f.endLine}`
        : `${escapeHtml(f.file)}:${f.line}`;

      parts.push('<details class="finding ' + sev + '">');
      parts.push('<summary>');
      parts.push('<div class="finding-header">');
      parts.push(`<span class="sev ${sev}">${style.icon} ${sev.toUpperCase()}</span>`);
      parts.push(`<span class="loc">${loc}</span>`);
      parts.push(`<span style="color:#6b7280;font-weight:normal;font-size:0.875rem;">${escapeHtml(f.category)}</span>`);
      parts.push('</div>');
      parts.push('</summary>');
      parts.push('<div class="finding-body">');
      parts.push(`  <div class="msg">${escapeHtml(f.message)}</div>`);
      if (f.suggestion) {
        parts.push(`  <div class="suggestion">💡 <strong>Suggestion:</strong> ${escapeHtml(f.suggestion)}</div>`);
      }
      parts.push('  <div class="meta">');
      parts.push(`    <span>Confidence: ${(f.confidence * 100).toFixed(0)}%</span>`);
      parts.push(`    <span>Source: ${escapeHtml(f.source)}${f.ruleId ? ` (${escapeHtml(f.ruleId)})` : ''}</span>`);
      parts.push('  </div>');
      parts.push('</div>');
      parts.push('</details>');
    }
  }

  parts.push('</body>');
  parts.push('</html>');

  return parts.join('\n');
}

// ==================== 辅助函数 ====================

/** 构建 severity 摘要统计 */
export function buildSummary(findings: Finding[]): {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  total: number;
} {
  const summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 };
  for (const f of findings) {
    summary.total++;
    if (f.severity === 'critical') summary.critical++;
    else if (f.severity === 'high') summary.high++;
    else if (f.severity === 'medium') summary.medium++;
    else if (f.severity === 'low') summary.low++;
    else if (f.severity === 'info') summary.info++;
  }
  return summary;
}
