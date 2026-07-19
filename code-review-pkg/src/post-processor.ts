import type { Finding, FileDiff, FalsePositiveRule, ExistingComment } from './types.js';

// ==================== 辅助函数 ====================

/** 判断文件是否为 C/C++ 文件 */
function isCFile(filePath: string): boolean {
  return /\.(c|h|cpp|hpp|cc|cxx|ixx|cppm|ccm|cxxm)$/i.test(filePath);
}

/** 判断文件是否为测试文件 */
function isTestFile(filePath: string): boolean {
  const name = filePath.split('/').pop() ?? filePath;
  return /\.(test|spec)\.(ts|js|tsx|jsx|py|java|go|rs)$/i.test(name) ||
    name.includes('.test.') ||
    name.includes('.spec.');
}

/** 判断文件是否为生成文件 */
function isGeneratedFile(filePath: string): boolean {
  const name = filePath.split('/').pop() ?? filePath;
  // 路径中包含 generated 或文件名匹配常见生成文件模式
  const pathLower = filePath.toLowerCase();
  if (pathLower.includes('/generated/') || pathLower.includes('/gen/')) return true;
  // 常见生成文件扩展名
  return /\.(pb\.go|pb\.rs|generated\.\w+|\.g\.ts|\.generated\.\w+)$/i.test(name);
}

/** 将文本分词为小写关键词集合 */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1),
  );
}

// ==================== correctLineLocations ====================

/**
 * 修正 finding 的行号，使其落在对应文件 diff 的 hunk 范围内。
 * 如果行号超出 hunk 最大行，clamp 到最后一行；
 * 如果行号小于 hunk 起始行，clamp 到第一行；
 * 如果没有对应的 diff，保持不变。
 */
export function correctLineLocations(findings: Finding[], diffs: FileDiff[]): Finding[] {
  if (findings.length === 0) return [];

  // 按 path 索引 diffs
  const diffMap = new Map<string, FileDiff>();
  for (const d of diffs) {
    diffMap.set(d.path, d);
  }

  return findings.map((finding) => {
    const diff = diffMap.get(finding.file);
    if (!diff || diff.hunks.length === 0) {
      return finding;
    }

    // 找到该 finding 对应的 hunk（行号落在 hunk 范围内）
    let matchedHunk = diff.hunks.find((hunk) => {
      const hunkEnd = hunk.newStart + hunk.newCount - 1;
      return finding.line >= hunk.newStart && finding.line <= hunkEnd;
    });

    // 如果没找到精确匹配的 hunk，尝试基于内容匹配
    if (!matchedHunk) {
      matchedHunk = findHunkByContent(finding, diff.hunks);
    }

    // 如果还是没找到，找最近的 hunk
    if (!matchedHunk) {
      matchedHunk = diff.hunks.reduce<{ hunk: (typeof diff.hunks)[0]; dist: number } | null>(
        (best, hunk) => {
          const hunkEnd = hunk.newStart + hunk.newCount - 1;
          const dist = finding.line < hunk.newStart
            ? hunk.newStart - finding.line
            : finding.line - hunkEnd;

          if (dist < 0) return best;
          if (!best || dist < best.dist) {
            return { hunk, dist };
          }
          return best;
        },
        null,
      )?.hunk;
    }

    if (!matchedHunk) return finding;

    const hunkEnd = matchedHunk.newStart + matchedHunk.newCount - 1;
    const clampedLine = Math.max(matchedHunk.newStart, Math.min(finding.line, hunkEnd));

    const result: Finding = { ...finding, line: clampedLine };

    // Also clamp endLine if present
    if (result.endLine !== undefined) {
      result.endLine = Math.max(matchedHunk.newStart, Math.min(result.endLine, hunkEnd));
    }

    return result;
  });
}

/**
 * 基于内容匹配查找 hunk：在 finding.message 中搜索代码片段。
 */
function findHunkByContent(finding: Finding, hunks: import('./types.js').Hunk[]): import('./types.js').Hunk | undefined {
  // Extract potential code snippets from message (quoted text)
  const codeSnippetMatch = finding.message.match(/`([^`]+)`/);
  if (!codeSnippetMatch) return undefined;

  const snippet = codeSnippetMatch[1].trim();
  if (!snippet || snippet.length < 3) return undefined;

  // Search in hunks for a line containing this snippet
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add' || line.type === 'delete') {
        if (line.content.includes(snippet)) {
          return hunk;
        }
      }
    }
  }
  return undefined;
}

// ==================== filterFalsePositives ====================

/** 高置信度阈值：超过此值的 finding 不被误报规则过滤 */
const HIGH_CONFIDENCE_THRESHOLD = 0.85;

/** 内置误报规则 */
export const BUILTIN_FP_RULES: FalsePositiveRule[] = [
  // 非 C/C++ 文件中的内存安全问题
  {
    id: 'builtin-memory-safety-non-c',
    name: '非 C/C++ 文件内存安全问题',
    match: (f) =>
      f.category === 'memory-safety' &&
      !isCFile(f.file) &&
      f.confidence < HIGH_CONFIDENCE_THRESHOLD,
  },
  // 速率限制 / DOS
  {
    id: 'builtin-rate-limit',
    name: '速率限制/DOS 类建议',
    match: (f) => {
      const msg = f.message.toLowerCase();
      return (
        (msg.includes('rate limit') || msg.includes('rate-limit') || msg.includes('dos')) &&
        f.confidence < HIGH_CONFIDENCE_THRESHOLD
      );
    },
  },
  // 开放重定向
  {
    id: 'builtin-open-redirect',
    name: '开放重定向建议',
    match: (f) => {
      const msg = f.message.toLowerCase();
      return (
        msg.includes('open redirect') &&
        f.confidence < HIGH_CONFIDENCE_THRESHOLD
      );
    },
  },
  // @generated 文件中的 finding
  {
    id: 'builtin-generated-file',
    name: '生成文件中的发现',
    match: (f) => isGeneratedFile(f.file) && f.confidence < HIGH_CONFIDENCE_THRESHOLD,
  },
  // 测试文件中的 low 级安全 finding
  {
    id: 'builtin-test-low-security',
    name: '测试文件中的低优先级安全发现',
    match: (f) =>
      isTestFile(f.file) &&
      f.severity === 'low' &&
      f.category === 'security' &&
      f.confidence < HIGH_CONFIDENCE_THRESHOLD,
  },
  // TODO/FIXME 注释
  {
    id: 'builtin-todo-fixme',
    name: 'TODO/FIXME 注释',
    match: (f) => {
      const msg = f.message.toLowerCase();
      return (
        (msg.includes('todo') || msg.includes('fixme')) &&
        f.confidence < HIGH_CONFIDENCE_THRESHOLD
      );
    },
  },
  // 日志级别建议
  {
    id: 'builtin-log-level',
    name: '日志级别建议',
    match: (f) => {
      const msg = f.message.toLowerCase();
      return (
        (msg.includes('log level') || msg.includes('log level') || msg.includes('logging')) &&
        f.severity === 'low' &&
        f.confidence < HIGH_CONFIDENCE_THRESHOLD
      );
    },
  },
  // console.log 相关的 low 级别 finding
  {
    id: 'builtin-console-log-low',
    name: 'console.log 相关低级别发现',
    match: (f) => {
      const msg = f.message.toLowerCase();
      return (
        msg.includes('console.log') &&
        f.severity === 'low' &&
        f.confidence < HIGH_CONFIDENCE_THRESHOLD
      );
    },
  },
  // 迭代 7 新增：JSDoc/注释建议类低价值发现
  {
    id: 'builtin-jsdoc-comment-suggestion',
    name: 'JSDoc/注释添加建议',
    match: (f) => {
      const msg = f.message.toLowerCase();
      return (
        f.severity === 'low' &&
        f.confidence < HIGH_CONFIDENCE_THRESHOLD &&
        (
          msg.includes('jsdoc') ||
          msg.includes('添加注释') ||
          msg.includes('添加文档') ||
          msg.includes('add comments') ||
          msg.includes('add a comment') ||
          msg.includes('consider adding comments') ||
          msg.includes('missing comments') ||
          msg.includes('document this')
        )
      );
    },
  },
  // 迭代 7 新增：命名风格建议类低价值发现
  {
    id: 'builtin-naming-style-suggestion',
    name: '命名风格建议',
    match: (f) => {
      const msg = f.message.toLowerCase();
      return (
        f.severity === 'low' &&
        f.confidence < HIGH_CONFIDENCE_THRESHOLD &&
        (
          msg.includes('naming convention') ||
          msg.includes('naming style') ||
          msg.includes('camelcase') ||
          msg.includes('pascalcase') ||
          msg.includes('snake_case') ||
          msg.includes('variable name should') ||
          msg.includes('name should be more descriptive') ||
          msg.includes('function name should') ||
          msg.includes('should follow naming')
        )
      );
    },
  },
  // 迭代 7 新增：import 排序建议类低价值发现
  {
    id: 'builtin-import-sort-suggestion',
    name: 'import 排序建议',
    match: (f) => {
      const msg = f.message.toLowerCase();
      return (
        f.severity === 'low' &&
        f.confidence < HIGH_CONFIDENCE_THRESHOLD &&
        (
          msg.includes('imports should be sorted') ||
          msg.includes('import order') ||
          msg.includes('import sort') ||
          msg.includes('sort imports') ||
          msg.includes('imports are not sorted') ||
          msg.includes('import statements should')
        )
      );
    },
  },
  // 迭代 7 新增：代码格式化建议类低价值发现（prettier/eslint 风格）
  {
    id: 'builtin-code-formatting-suggestion',
    name: '代码格式化建议（prettier/eslint 风格）',
    match: (f) => {
      const msg = f.message.toLowerCase();
      return (
        f.severity === 'low' &&
        f.confidence < HIGH_CONFIDENCE_THRESHOLD &&
        (
          msg.includes('use single quotes') ||
          msg.includes('use double quotes') ||
          msg.includes('missing semicolon') ||
          msg.includes('missing comma') ||
          msg.includes('trailing comma') ||
          msg.includes('indentation') ||
          msg.includes('prettier') ||
          msg.includes('eslint') ||
          msg.includes('expected indentation') ||
          msg.includes('line is too long')
        )
      );
    },
  },
];

/**
 * 过滤误报 finding。
 * 内置规则始终生效，可额外传入自定义规则。
 */
export function filterFalsePositives(
  findings: Finding[],
  customRules?: FalsePositiveRule[],
): Finding[] {
  const allRules = customRules
    ? [...BUILTIN_FP_RULES, ...customRules]
    : BUILTIN_FP_RULES;

  return findings.filter((finding) => {
    for (const rule of allRules) {
      if (rule.match(finding)) {
        return false;
      }
    }
    return true;
  });
}

// ==================== deduplicateFindings ====================

/**
 * 计算 IoU（交并比）。
 * 基于 finding.message 和 comment.body 的关键词集合。
 * 仅对同文件同行的 finding 和 comment 进行比较。
 */
function computeIoU(finding: Finding, comment: ExistingComment): number {
  // 不同文件不去重
  if (finding.file !== comment.file) return 0;
  // 不同行不去重
  if (finding.line !== comment.line) return 0;

  const tokensA = tokenize(finding.message);
  const tokensB = tokenize(comment.body);

  if (tokensA.size === 0 && tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersection++;
    }
  }

  const union = tokensA.size + tokensB.size - intersection;
  if (union === 0) return 0;

  return intersection / union;
}

/**
 * 计算消息文本重叠比率。
 * 检查 finding.message 和 comment.body 之间的文本重叠。
 */
function computeTextOverlap(finding: Finding, comment: ExistingComment): number {
  if (finding.file !== comment.file) return 0;
  if (finding.line !== comment.line) return 0;

  const msgA = finding.message.toLowerCase();
  const msgB = comment.body.toLowerCase();

  // 使用最长公共子串比例（简化版：检查子串包含）
  const shorter = msgA.length <= msgB.length ? msgA : msgB;
  const longer = msgA.length <= msgB.length ? msgB : msgA;

  if (shorter.length === 0) return 0;

  // 如果较短文本是较长文本的子串，重叠率为 1
  if (longer.includes(shorter)) return 1;

  // 否则使用关键词 IoU 作为代理
  return computeIoU(finding, comment);
}

/**
 * IoU 去重：对每个新 finding，与每个现有评论计算 IoU，
 * IoU > threshold 视为重复，跳过。
 */
export function deduplicateFindings(
  newFindings: Finding[],
  existingComments: ExistingComment[],
  iouThreshold: number = 0.5,
): Finding[] {
  if (existingComments.length === 0) return newFindings;

  return newFindings.filter((finding) => {
    for (const comment of existingComments) {
      const iou = computeIoU(finding, comment);
      const textOverlap = computeTextOverlap(finding, comment);
      // Either keyword IoU or text overlap exceeds threshold
      if (iou > iouThreshold || textOverlap > iouThreshold) {
        return false; // 重复，跳过
      }
    }
    return true;
  });
}

// ==================== filterByCategory ====================

/**
 * 按类别过滤 findings。
 * 只保留 categories 列表中指定的类别。
 */
export function filterByCategory(findings: Finding[], categories: string[]): Finding[] {
  const categorySet = new Set(categories);
  return findings.filter((f) => categorySet.has(f.category));
}

// ==================== filterBySeverity ====================

const SEVERITY_ORDER: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/**
 * 按最小严重级别过滤 findings。
 * 只保留 severity >= minSeverity 的 findings。
 */
export function filterBySeverity(findings: Finding[], minSeverity: string): Finding[] {
  const minLevel = SEVERITY_ORDER[minSeverity] ?? 0;
  return findings.filter((f) => (SEVERITY_ORDER[f.severity] ?? 0) >= minLevel);
}

// ==================== groupByFile ====================

/**
 * 按文件分组 findings。
 */
export function groupByFile(findings: Finding[]): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = map.get(f.file);
    if (list) {
      list.push(f);
    } else {
      map.set(f.file, [f]);
    }
  }
  return map;
}

// ==================== sortBySeverity ====================

/**
 * 按严重级别排序 findings（critical > high > medium > low > info）。
 */
export function sortBySeverity(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const aLevel = SEVERITY_ORDER[a.severity] ?? 0;
    const bLevel = SEVERITY_ORDER[b.severity] ?? 0;
    return bLevel - aLevel;
  });
}

// ==================== filterBySource ====================

/**
 * 按 rule/ai 来源过滤 findings。
 */
export function filterBySource(findings: Finding[], source: Finding['source']): Finding[] {
  return findings.filter((f) => f.source === source);
}

// ==================== filterByConfidence ====================

/**
 * 按最低置信度过滤 findings。
 */
export function filterByConfidence(findings: Finding[], minConfidence: number): Finding[] {
  return findings.filter((f) => f.confidence >= minConfidence);
}

// ==================== countBySeverity (Round 48) ====================

/**
 * 统计各严重级别的 finding 数量。
 */
export function countBySeverity(findings: Finding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }
  return counts;
}

// ==================== createCachedFilter (Round 53) ====================

/**
 * 创建基于已知误报缓存的 FalsePositiveRule 工厂函数。
 * cache 中的每项应该是 finding 的唯一标识（如 "file:line:category"）。
 */
export function createCachedFilter(cache: Set<string>): FalsePositiveRule {
  return {
    id: 'cached-fached-filter',
    name: '已知误报缓存',
    match: (f) => cache.has(`${f.file}:${f.line}:${f.category}`),
  };
}

// ==================== mergeFindings (Round 59) ====================

/**
 * 合并多次审查结果的 findings，基于 file+line+category 去重。
 * 保留 existing 中已有的，追加 incoming 中新的。
 */
export function mergeFindings(existing: Finding[], incoming: Finding[]): Finding[] {
  const seen = new Set<string>();
  for (const f of existing) {
    seen.add(`${f.file}:${f.line}:${f.category}`);
  }
  const merged = [...existing];
  for (const f of incoming) {
    const key = `${f.file}:${f.line}:${f.category}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(f);
    }
  }
  return merged;
}

// ==================== getUniqueCategories (Round 64) ====================

/**
 * 获取 findings 中所有唯一类别，按出现频率降序排列。
 */
export function getUniqueCategories(findings: Finding[]): string[] {
  const map = new Map<string, number>();
  for (const f of findings) {
    map.set(f.category, (map.get(f.category) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([cat]) => cat);
}

// ==================== truncateFindings (Round 69) ====================

/** truncateFindings 截断后添加的省略提示 */
export const TRUNCATION_MESSAGE = '... and {count} more findings truncated';

/**
 * 截断过多 findings 并添加省略提示。
 */
export function truncateFindings(findings: Finding[], maxCount: number): Finding[] {
  if (findings.length <= maxCount) return findings;
  const truncated = findings.slice(0, maxCount);
  const remaining = findings.length - maxCount;
  truncated.push({
    file: '',
    line: 0,
    message: TRUNCATION_MESSAGE.replace('{count}', String(remaining)),
    severity: 'info',
    category: '_truncation',
    confidence: 1,
    source: 'rule' as const,
  });
  return truncated;
}

// ==================== 迭代 7：severity-based filtering ====================

/** severity-based filter 默认最低保留级别（过滤 info） */
const DEFAULT_MIN_SEVERITY = 'low';

/**
 * 创建基于 severity 的过滤规则工厂函数。
 *
 * 默认 minSeverity='low'，即过滤 info 级别，保留 low 及以上。
 * 传入 'medium' 则过滤 info + low，保留 medium 及以上。
 * 传入 'high' 则过滤 info + low + medium，保留 high 及以上。
 *
 * @param minSeverity 最低保留级别（默认 'low'）
 * @returns FalsePositiveRule 实例，match 返回 true 表示该 finding 应被过滤
 */
export function createSeverityBasedFilter(minSeverity: string = DEFAULT_MIN_SEVERITY): FalsePositiveRule {
  const minLevel = SEVERITY_ORDER[minSeverity] ?? SEVERITY_ORDER[DEFAULT_MIN_SEVERITY];
  return {
    id: 'severity-based-filter',
    name: `severity-based filter (min: ${minSeverity})`,
    match: (f) => {
      const level = SEVERITY_ORDER[f.severity] ?? 0;
      // 严重级别低于 minSeverity 的 finding 被过滤
      return level < minLevel;
    },
  };
}

// ==================== 迭代 7：可配置的过滤策略 ====================

/**
 * 可配置的过滤策略。
 *
 * 通过组合多个过滤步骤实现精确控制：
 * - stripInfoSeverity：是否过滤 info 级别 findings
 * - minConfidence：最低置信度阈值，低于此值的 finding 被过滤
 * - stripLowValueFindings：是否过滤低价值发现（应用低价值模式，无视置信度）
 * - customRules：自定义过滤规则（仅应用这些规则，不与 BUILTIN_FP_RULES 叠加）
 */
export interface FilterStrategy {
  /** 是否过滤 info 级别 findings */
  stripInfoSeverity?: boolean;
  /** 最低置信度阈值，低于此值的 finding 被过滤 */
  minConfidence?: number;
  /** 是否过滤低价值 findings（应用低价值模式，无视置信度） */
  stripLowValueFindings?: boolean;
  /** 自定义过滤规则（仅应用这些规则） */
  customRules?: FalsePositiveRule[];
}

/**
 * 判断 finding 是否属于低价值发现（无视置信度）。
 *
 * 低价值发现包括：JSDoc/注释建议、命名风格建议、import 排序建议、代码格式化建议。
 * 与 BUILTIN_FP_RULES 不同，此函数不检查 confidence，用于 stripLowValueFindings 策略。
 */
function isLowValueFinding(f: Finding): boolean {
  // 仅对 low 级别 finding 生效，避免误过滤高严重度真实问题
  if (f.severity !== 'low') return false;
  const msg = f.message.toLowerCase();
  // JSDoc/注释建议
  if (
    msg.includes('jsdoc') ||
    msg.includes('添加注释') ||
    msg.includes('添加文档') ||
    msg.includes('add comments') ||
    msg.includes('add a comment') ||
    msg.includes('consider adding comments') ||
    msg.includes('missing comments') ||
    msg.includes('document this')
  ) {
    return true;
  }
  // 命名风格建议
  if (
    msg.includes('naming convention') ||
    msg.includes('naming style') ||
    msg.includes('camelcase') ||
    msg.includes('pascalcase') ||
    msg.includes('snake_case') ||
    msg.includes('variable name should') ||
    msg.includes('name should be more descriptive') ||
    msg.includes('function name should') ||
    msg.includes('should follow naming')
  ) {
    return true;
  }
  // import 排序建议
  if (
    msg.includes('imports should be sorted') ||
    msg.includes('import order') ||
    msg.includes('import sort') ||
    msg.includes('sort imports') ||
    msg.includes('imports are not sorted') ||
    msg.includes('import statements should')
  ) {
    return true;
  }
  // 代码格式化建议（prettier/eslint 风格）
  if (
    msg.includes('use single quotes') ||
    msg.includes('use double quotes') ||
    msg.includes('missing semicolon') ||
    msg.includes('missing comma') ||
    msg.includes('trailing comma') ||
    msg.includes('indentation') ||
    msg.includes('prettier') ||
    msg.includes('eslint') ||
    msg.includes('expected indentation') ||
    msg.includes('line is too long')
  ) {
    return true;
  }
  // TODO/FIXME 注释也属于低价值（与 BUILTIN_FP_RULES 重叠，但无视置信度）
  if (msg.includes('todo') || msg.includes('fixme')) {
    return true;
  }
  return false;
}

/**
 * 按可配置策略过滤 findings。
 *
 * 过滤顺序：
 * 1. stripInfoSeverity：先过滤 info 级别
 * 2. minConfidence：再过滤低置信度
 * 3. stripLowValueFindings：应用低价值模式过滤（无视置信度）
 * 4. customRules：应用自定义规则
 *
 * @param findings 待过滤的 findings
 * @param strategy 过滤策略
 * @returns 过滤后的 findings
 */
export function filterWithStrategy(findings: Finding[], strategy: FilterStrategy): Finding[] {
  let result = findings;

  // 步骤 1：过滤 info 级别
  if (strategy.stripInfoSeverity) {
    result = result.filter((f) => f.severity !== 'info');
  }

  // 步骤 2：过滤低置信度
  if (strategy.minConfidence !== undefined) {
    const min = strategy.minConfidence;
    result = result.filter((f) => f.confidence >= min);
  }

  // 步骤 3：过滤低价值发现（无视置信度，仅看 severity + 消息模式）
  if (strategy.stripLowValueFindings) {
    result = result.filter((f) => !isLowValueFinding(f));
  }

  // 步骤 4：应用自定义规则（仅 customRules，不叠加 BUILTIN_FP_RULES）
  if (strategy.customRules && strategy.customRules.length > 0) {
    const rules = strategy.customRules;
    result = result.filter((finding) => {
      for (const rule of rules) {
        if (rule.match(finding)) return false;
      }
      return true;
    });
  }

  return result;
}