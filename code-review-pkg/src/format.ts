// src/format.ts — 格式化输出函数

import type { Finding } from './types.js';

/**
 * 将单个 Finding 格式化为 Markdown 文本。
 */
export function formatFindingMarkdown(finding: Finding): string {
  const lines: string[] = [];
  const severity = finding.severity.toUpperCase();
  const loc = finding.endLine != null && finding.endLine !== finding.line
    ? `${finding.file}:${finding.line}-${finding.endLine}`
    : `${finding.file}:${finding.line}`;

  lines.push(`### [${severity}] ${loc}`);
  lines.push('');
  lines.push(`**Category:** ${finding.category}`);
  lines.push(`**Confidence:** ${(finding.confidence * 100).toFixed(0)}%`);
  lines.push(`**Source:** ${finding.source}${finding.ruleId ? ` (${finding.ruleId})` : ''}`);
  lines.push('');
  lines.push(finding.message);

  if (finding.suggestion) {
    lines.push('');
    lines.push(`**Suggestion:** ${finding.suggestion}`);
  }

  return lines.join('\n');
}

/**
 * 将 Finding 数组格式化为完整的审查报告 Markdown。
 */
export function formatFindingsMarkdown(findings: Finding[]): string {
  if (findings.length === 0) return '# Code Review Report\n\nNo findings.';

  const sections: string[] = [];
  sections.push('# Code Review Report');
  sections.push('');

  // Summary
  const bySeverity: Record<string, number> = {};
  for (const f of findings) {
    const s = f.severity;
    bySeverity[s] = (bySeverity[s] ?? 0) + 1;
  }
  const summaryParts = Object.entries(bySeverity)
    .sort((a, b) => b[1] - a[1])
    .map(([sev, count]) => `${sev.toUpperCase()}: ${count}`);
  sections.push(`**Summary:** ${summaryParts.join(', ')} (${findings.length} total)`);
  sections.push('');

  // Each finding
  for (const finding of findings) {
    sections.push(formatFindingMarkdown(finding));
    sections.push('');
  }

  return sections.join('\n');
}

/**
 * 将 Finding 数组格式化为带缩进的 JSON 字符串。
 */
export function formatFindingsJSON(findings: Finding[]): string {
  return JSON.stringify(findings, null, 2);
}
