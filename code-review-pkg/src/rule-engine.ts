import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Rule, RuleAnnotation, RulePattern, FileBundle, FileDiff } from './types.js';
import { parseMinimalYaml } from './yaml-lite.js';

// ── 最小 YAML 行内解析器 ──

interface YamlRule {
  id?: string;
  name?: string;
  severity?: string;
  category?: string;
  language?: string[] | string;
  patterns?: YamlRulePattern[];
}

interface YamlRulePattern {
  type?: string;
  pattern?: string;
  items?: string[] | string;
  threshold?: number;
  message?: string;
}

function yamlToRules(yamlRules: YamlRule[]): Rule[] {
  return yamlRules.filter((r) => r.id && r.name && r.severity && r.category && r.patterns && r.patterns.length > 0).map((r) => ({
    id: r.id!,
    name: r.name!,
    severity: r.severity as Rule['severity'],
    category: r.category!,
    language: r.language as string[] | undefined,
    patterns: r.patterns!.filter((p) => p.type && p.message).map((p) => ({
      type: p.type as RulePattern['type'],
      pattern: p.pattern ?? '',
      items: p.items as string[] | undefined,
      threshold: p.threshold,
      message: p.message!,
    })),
  }));
}

/**
 * 从指定目录加载所有 JSON 规则文件
 * 每个 JSON 文件可以包含单个 Rule 对象或 Rule 数组
 */
export async function loadRules(ruleDir: string): Promise<Rule[]> {
  // 递归扫描所有 JSON 和 YAML 文件
  const allRuleFiles = await scanRuleFiles(ruleDir);

  const allRules: Rule[] = [];

  for (const filePath of allRuleFiles) {
    const content = await readFile(filePath, 'utf-8');
    const ext = filePath.endsWith('.yaml') || filePath.endsWith('.yml') ? 'yaml' : 'json';

    if (ext === 'yaml') {
      const yamlRules = (parseMinimalYaml(content).rules ?? []) as YamlRule[];
      const rules = yamlToRules(yamlRules);
      allRules.push(...rules);
    } else {
      const data = JSON.parse(content);
      const rules: unknown[] = Array.isArray(data) ? data : [data];

      for (const raw of rules) {
        const r = raw as Record<string, unknown>;
        if (!r.id || !r.name || !r.severity || !r.category || !Array.isArray(r.patterns)) {
          continue;
        }

        const validPatterns = (r.patterns as RulePattern[]).filter(
          (p) => p.type && p.message,
        );
        if (validPatterns.length === 0) continue;

        // Validate regex patterns
        for (const p of validPatterns) {
          if (p.type === 'regex') {
            try {
              new RegExp(p.pattern);
            } catch {
              throw new Error(`Rule "${r.id}": invalid regex pattern "${p.pattern}"`);
            }
          }
        }

        allRules.push({
          id: r.id as string,
          name: r.name as string,
          severity: r.severity as Rule['severity'],
          category: r.category as string,
          language: r.language as string[] | undefined,
          patterns: validPatterns,
        });
      }
    }
  }

  return allRules;
}

/**
 * 递归扫描目录中的规则文件（JSON、YAML）。
 */
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

/**
 * 对一个 FileBundle 应用规则列表，返回匹配产生的标注
 */
export function matchRules(bundle: FileBundle, rules: Rule[], options?: { group?: string }): RuleAnnotation[] {
  const annotations: RuleAnnotation[] = [];
  const { primary } = bundle;

  for (const rule of rules) {
    // disabled 规则跳过 (Round 63)
    if (rule.disabled) continue;

    // group 过滤
    if (options?.group !== undefined) {
      if (rule.group !== options.group) continue;
    }

    // 语言过滤：规则指定了语言但文件语言不匹配则跳过
    if (rule.language && rule.language.length > 0) {
      if (!primary.language || !rule.language.includes(primary.language)) {
        continue;
      }
    }

    // excludePatterns 过滤 (Round 68)
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

  // 按 severity 排序（critical > high > medium > low）
  const severityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  annotations.sort((a, b) => (severityOrder[b.severity] ?? 0) - (severityOrder[a.severity] ?? 0));

  return annotations;
}

/**
 * 单个 pattern 的匹配逻辑
 */
function matchPattern(
  pattern: RulePattern,
  diff: FileDiff,
): { line?: number } | null {
  switch (pattern.type) {
    case 'regex': {
      const regex = new RegExp(pattern.pattern, (pattern.flags ?? '') + (pattern.pattern.includes('\\n') ? 's' : ''));
      for (const hunk of diff.hunks) {
        // Round 52: 支持多行正则——当 pattern 含 \n 时，将整个 hunk 拼接后匹配
        if (pattern.pattern.includes('\\n')) {
          const fullContent = hunk.lines
            .filter((l) => l.type === 'add' || l.type === 'delete')
            .map((l) => l.content)
            .join('\n');
          if (regex.test(fullContent)) {
            const firstLine = hunk.lines.find((l) => l.type === 'add' || l.type === 'delete');
            return { line: firstLine?.newLineNumber ?? firstLine?.oldLineNumber };
          }
        } else {
          for (const line of hunk.lines) {
            if (line.type === 'add' || line.type === 'delete') {
              // 如果 pattern 有 line 字段，只检查指定行号
              if (pattern.line !== undefined) {
                const lineNum = line.newLineNumber ?? line.oldLineNumber;
                if (lineNum !== pattern.line) continue;
              }
              if (regex.test(line.content)) {
                return { line: line.newLineNumber ?? line.oldLineNumber };
              }
            }
          }
        }
      }
      return null;
    }

    case 'contains_any': {
      if (!pattern.items || pattern.items.length === 0) return null;
      for (const hunk of diff.hunks) {
        for (const line of hunk.lines) {
          if (line.type === 'add' || line.type === 'delete') {
            if (pattern.line !== undefined) {
              const lineNum = line.newLineNumber ?? line.oldLineNumber;
              if (lineNum !== pattern.line) continue;
            }
            for (const item of pattern.items) {
              if (line.content.includes(item)) {
                return { line: line.newLineNumber ?? line.oldLineNumber };
              }
            }
          }
        }
      }
      return null;
    }

    case 'contains_all': {
      if (!pattern.items || pattern.items.length === 0) return null;
      const allContent: string[] = [];
      let firstLine: number | undefined;
      for (const hunk of diff.hunks) {
        for (const line of hunk.lines) {
          if (line.type === 'add' || line.type === 'delete') {
            allContent.push(line.content);
            if (firstLine === undefined) {
              firstLine = line.newLineNumber ?? line.oldLineNumber;
            }
          }
        }
      }
      const fullText = allContent.join('\n');
      const allMatch = pattern.items.every((item) => fullText.includes(item));
      return allMatch ? { line: firstLine } : null;
    }

    case 'line_count_gt': {
      if (pattern.threshold === undefined) return null;
      let count = 0;
      for (const hunk of diff.hunks) {
        for (const line of hunk.lines) {
          if (line.type === 'add' || line.type === 'delete') {
            count++;
          }
        }
      }
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

/**
 * 按分类查询规则。
 */
export function getRulesByCategory(rules: Rule[], category: string): Rule[] {
  return rules.filter((r) => r.category === category);
}

/**
 * 按严重度查询规则。
 */
export function getRulesBySeverity(rules: Rule[], severity: Rule['severity']): Rule[] {
  return rules.filter((r) => r.severity === severity);
}