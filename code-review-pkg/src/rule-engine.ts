import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Rule, RuleAnnotation, RulePattern, FileBundle, FileDiff, DiffLine, Severity } from './types.js';
import { parseMinimalYaml } from './yaml-lite.js';

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function isChangedLine(line: DiffLine): boolean {
  return line.type === 'add' || line.type === 'delete';
}

function getLineNumber(line: DiffLine): number | undefined {
  return line.newLineNumber ?? line.oldLineNumber;
}

interface YamlRule {
  id?: string;
  name?: string;
  severity?: string;
  category?: string;
  language?: string[] | string;
  patterns?: YamlRulePattern[];
  group?: string;
  description?: string;
  disabled?: boolean;
  excludePatterns?: string[];
}

interface YamlRulePattern {
  type?: string;
  pattern?: string;
  items?: string[] | string;
  threshold?: number;
  message?: string;
  flags?: string;
  line?: number;
}

function normalizeLanguage(language: string[] | string | undefined): string[] | undefined {
  if (language === undefined) return undefined;
  return Array.isArray(language) ? language : [language];
}

function normalizeItems(items: string[] | string | undefined): string[] | undefined {
  if (items === undefined) return undefined;
  return Array.isArray(items) ? items : [items];
}

function validateRegexPatterns(patterns: RulePattern[], ruleId: string): void {
  for (const p of patterns) {
    if (p.type === 'regex') {
      try {
        new RegExp(p.pattern);
      } catch {
        throw new Error(`Rule "${ruleId}": invalid regex pattern "${p.pattern}"`);
      }
    }
  }
}

function buildValidPatterns(rawPatterns: unknown[] | undefined): RulePattern[] | null {
  if (!Array.isArray(rawPatterns) || rawPatterns.length === 0) return null;

  const validPatterns: RulePattern[] = [];
  for (const raw of rawPatterns) {
    const p = raw as Record<string, unknown>;
    if (!p.type || !p.message) continue;
    validPatterns.push({
      type: p.type as RulePattern['type'],
      pattern: (p.pattern as string) ?? '',
      items: normalizeItems(p.items as string[] | string | undefined),
      threshold: p.threshold as number | undefined,
      message: p.message as string,
      flags: p.flags as string | undefined,
      line: p.line as number | undefined,
    });
  }

  return validPatterns.length > 0 ? validPatterns : null;
}

function buildRule(raw: unknown): Rule | null {
  const r = raw as Record<string, unknown>;
  if (!r.id || !r.name || !r.severity || !r.category) return null;

  const validPatterns = buildValidPatterns(r.patterns as unknown[] | undefined);
  if (!validPatterns) return null;

  validateRegexPatterns(validPatterns, r.id as string);

  return {
    id: r.id as string,
    name: r.name as string,
    severity: r.severity as Rule['severity'],
    category: r.category as string,
    language: normalizeLanguage(r.language as string[] | string | undefined),
    patterns: validPatterns,
    group: r.group as string | undefined,
    description: r.description as string | undefined,
    disabled: r.disabled as boolean | undefined,
    excludePatterns: r.excludePatterns as string[] | undefined,
  };
}

function yamlToRules(yamlRules: YamlRule[]): Rule[] {
  return yamlRules
    .map((r) => buildRule(r))
    .filter((r): r is Rule => r !== null);
}

export async function loadRules(ruleDir: string): Promise<Rule[]> {
  const allRuleFiles = await scanRuleFiles(ruleDir);
  const allRules: Rule[] = [];

  for (const filePath of allRuleFiles) {
    const content = await readFile(filePath, 'utf-8');
    const isYaml = filePath.endsWith('.yaml') || filePath.endsWith('.yml');

    if (isYaml) {
      const yamlRules = (parseMinimalYaml(content).rules ?? []) as YamlRule[];
      const rules = yamlToRules(yamlRules);
      allRules.push(...rules);
    } else {
      const data = JSON.parse(content);
      const rawRules: unknown[] = Array.isArray(data) ? data : [data];
      for (const raw of rawRules) {
        const rule = buildRule(raw);
        if (rule) allRules.push(rule);
      }
    }
  }

  return allRules;
}

async function scanRuleFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const subFiles = await scanRuleFiles(fullPath);
      results.push(...subFiles);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.json') || entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))
    ) {
      results.push(fullPath);
    }
  }

  return results;
}

export function matchRules(bundle: FileBundle, rules: Rule[], options?: { group?: string }): RuleAnnotation[] {
  const annotations: RuleAnnotation[] = [];
  const { primary } = bundle;

  for (const rule of rules) {
    if (rule.disabled) continue;

    if (options?.group !== undefined && rule.group !== options.group) continue;

    if (rule.language && rule.language.length > 0) {
      if (!primary.language || !rule.language.includes(primary.language)) continue;
    }

    if (rule.excludePatterns && rule.excludePatterns.length > 0) {
      const excluded = rule.excludePatterns.some((pat) => new RegExp(pat).test(primary.path));
      if (excluded) continue;
    }

    for (const pattern of rule.patterns) {
      const matched = matchPattern(pattern, primary);
      if (matched) {
        annotations.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          message: pattern.message,
          line: matched.line,
          category: rule.category,
          description: rule.description,
        });
      }
    }
  }

  annotations.sort((a, b) => (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0));

  return annotations;
}

function collectChangedLines(diff: FileDiff): { content: string; lineNumber: number | undefined }[] {
  const result: { content: string; lineNumber: number | undefined }[] = [];
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (isChangedLine(line)) {
        result.push({ content: line.content, lineNumber: getLineNumber(line) });
      }
    }
  }
  return result;
}

function matchPattern(
  pattern: RulePattern,
  diff: FileDiff,
): { line?: number } | null {
  switch (pattern.type) {
    case 'regex': {
      const isMultiline = pattern.pattern.includes('\\n');
      const regex = new RegExp(pattern.pattern, (pattern.flags ?? '') + (isMultiline ? 's' : ''));

      if (isMultiline) {
        for (const hunk of diff.hunks) {
          const fullContent = hunk.lines
            .filter(isChangedLine)
            .map((l) => l.content)
            .join('\n');
          if (regex.test(fullContent)) {
            const firstLine = hunk.lines.find(isChangedLine);
            return { line: getLineNumber(firstLine!) };
          }
        }
      } else {
        for (const { content, lineNumber } of collectChangedLines(diff)) {
          if (pattern.line !== undefined && lineNumber !== pattern.line) continue;
          if (regex.test(content)) return { line: lineNumber };
        }
      }
      return null;
    }

    case 'contains_any': {
      if (!pattern.items || pattern.items.length === 0) return null;
      for (const { content, lineNumber } of collectChangedLines(diff)) {
        if (pattern.line !== undefined && lineNumber !== pattern.line) continue;
        for (const item of pattern.items) {
          if (content.includes(item)) return { line: lineNumber };
        }
      }
      return null;
    }

    case 'contains_all': {
      if (!pattern.items || pattern.items.length === 0) return null;
      const changedLines = collectChangedLines(diff);
      if (changedLines.length === 0) return null;
      const fullText = changedLines.map((l) => l.content).join('\n');
      const allMatch = pattern.items.every((item) => fullText.includes(item));
      return allMatch ? { line: changedLines[0].lineNumber } : null;
    }

    case 'line_count_gt': {
      if (pattern.threshold === undefined) return null;
      const count = collectChangedLines(diff).length;
      return count > pattern.threshold ? {} : null;
    }

    case 'file_size_gt': {
      if (pattern.threshold === undefined) return null;
      let totalSize = 0;
      for (const hunk of diff.hunks) {
        for (const line of hunk.lines) {
          totalSize += line.content.length;
        }
      }
      return totalSize > pattern.threshold ? {} : null;
    }

    default:
      return null;
  }
}

export function getRulesByCategory(rules: Rule[], category: string): Rule[] {
  return rules.filter((r) => r.category === category);
}

export function getRulesBySeverity(rules: Rule[], severity: Rule['severity']): Rule[] {
  return rules.filter((r) => r.severity === severity);
}
