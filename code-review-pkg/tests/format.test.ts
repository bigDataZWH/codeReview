import { describe, it, expect } from 'vitest';
import { formatFindingMarkdown, formatFindingsMarkdown, formatFindingsJSON } from '../src/format.js';
import type { Finding } from '../src/types.js';

describe('formatFindingMarkdown', () => {
  const baseFinding: Finding = {
    file: 'src/index.ts',
    line: 42,
    severity: 'high',
    category: 'security',
    message: 'Potential SQL injection',
    confidence: 0.9,
    source: 'rule',
    ruleId: 'R001',
  };

  it('formats a basic finding', () => {
    const result = formatFindingMarkdown(baseFinding);
    expect(result).toContain('### [HIGH] src/index.ts:42');
    expect(result).toContain('**Category:** security');
    expect(result).toContain('**Confidence:** 90%');
    expect(result).toContain('**Source:** rule (R001)');
    expect(result).toContain('Potential SQL injection');
  });

  it('includes suggestion when present', () => {
    const finding: Finding = { ...baseFinding, suggestion: 'Use parameterized queries' };
    const result = formatFindingMarkdown(finding);
    expect(result).toContain('**Suggestion:** Use parameterized queries');
  });

  it('omits suggestion when absent', () => {
    const result = formatFindingMarkdown(baseFinding);
    expect(result).not.toContain('Suggestion');
  });

  it('handles range with endLine', () => {
    const finding: Finding = { ...baseFinding, endLine: 50 };
    const result = formatFindingMarkdown(finding);
    expect(result).toContain('src/index.ts:42-50');
  });

  it('handles AI source without ruleId', () => {
    const finding: Finding = { ...baseFinding, source: 'ai', ruleId: undefined };
    const result = formatFindingMarkdown(finding);
    expect(result).toContain('**Source:** ai');
    expect(result).not.toContain('(');
  });

  it('formats confidence as integer percentage', () => {
    const finding: Finding = { ...baseFinding, confidence: 0.123 };
    const result = formatFindingMarkdown(finding);
    expect(result).toContain('12%');
  });
});

describe('formatFindingsMarkdown', () => {
  const finding1: Finding = {
    file: 'src/index.ts',
    line: 10,
    severity: 'critical',
    category: 'security',
    message: 'SQL injection',
    confidence: 0.95,
    source: 'rule',
  };
  const finding2: Finding = {
    file: 'src/utils.ts',
    line: 20,
    severity: 'low',
    category: 'style',
    message: 'Missing semicolon',
    confidence: 0.7,
    source: 'ai',
  };

  it('returns no findings message for empty array', () => {
    expect(formatFindingsMarkdown([])).toContain('No findings');
  });

  it('includes report title', () => {
    const result = formatFindingsMarkdown([finding1]);
    expect(result).toContain('# Code Review Report');
  });

  it('includes severity summary', () => {
    const result = formatFindingsMarkdown([finding1, finding2]);
    expect(result).toContain('CRITICAL: 1');
    expect(result).toContain('LOW: 1');
    expect(result).toContain('2 total');
  });

  it('includes each finding section', () => {
    const result = formatFindingsMarkdown([finding1]);
    expect(result).toContain('### [CRITICAL]');
    expect(result).toContain('SQL injection');
  });
});

describe('formatFindingsJSON', () => {
  it('returns empty array JSON for empty input', () => {
    const result = formatFindingsJSON([]);
    expect(result).toBe('[]');
  });

  it('returns pretty-printed JSON', () => {
    const finding: Finding = {
      file: 'src/index.ts',
      line: 1,
      severity: 'high',
      category: 'security',
      message: 'Issue',
      confidence: 0.9,
      source: 'rule',
    };
    const result = formatFindingsJSON([finding]);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].file).toBe('src/index.ts');
  });

  it('indents with 2 spaces', () => {
    const finding: Finding = {
      file: 'a.ts', line: 1, severity: 'low', category: 'style',
      message: 'm', confidence: 0.5, source: 'ai',
    };
    const result = formatFindingsJSON([finding]);
    expect(result).toContain('  "file"');
  });
});
