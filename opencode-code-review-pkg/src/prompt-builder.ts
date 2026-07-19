import type { PipelineContext, FileDiff } from './types.js';

// ── 默认模板 ──

const DEFAULT_REVIEW_TEMPLATE = `# Code Review Request

## 变更文件列表
$FILE_LIST

## 变更统计
$STATS

## Diff 内容
$DIFF

## 规则标注
$RULE_ANNOTATIONS

## 图谱上下文
$CONTEXT

## 自定义规则
$CUSTOM_RULES
`;

const SECURITY_TEMPLATE = `# Security Code Review

## 变更文件列表
$FILE_LIST

## 变更统计
$STATS

## Diff 内容
$DIFF

## 安全方法论
请从以下安全维度审查代码变更：
- **SQL 注入**: 检查字符串拼接构造 SQL、用户输入未参数化
- **XSS (跨站脚本)**: 检查未转义的用户输入、危险的 innerHTML 使用
- **CSRF**: 检查缺少 token 校验的状态变更接口
- **路径遍历**: 检查用户可控的文件路径
- **敏感信息泄露**: 检查日志、错误响应中的敏感数据
- **认证/授权**: 检查缺失的身份验证和权限校验
- **依赖安全**: 检查已知漏洞的依赖

## 误报过滤规则
以下类型的问题通常为误报，请谨慎标记：
- 非生成的 TODO/FIXME 注释
- 测试文件中的低严重度安全建议
- 日志级别的建议
- 速率限制/DoS 防护建议（除非明显缺失）
- 开放重定向（除非有明确攻击路径）

## 规则标注
$RULE_ANNOTATIONS

## 图谱上下文
$CONTEXT

## 自定义规则
$CUSTOM_RULES
`;

// ── 辅助函数 ──

function formatDiff(diffs: FileDiff[]): string {
  if (diffs.length === 0) return '(无变更文件)';

  return diffs
    .map((diff) => {
      const lines: string[] = [];
      lines.push(`--- ${diff.oldPath ?? diff.path}`);
      lines.push(`+++ ${diff.path}`);

      for (const hunk of diff.hunks) {
        lines.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
        for (const line of hunk.lines) {
          const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ';
          lines.push(`${prefix}${line.content}`);
        }
      }

      return lines.join('\n');
    })
    .join('\n\n');
}

function formatFileList(diffs: FileDiff[]): string {
  if (diffs.length === 0) return '(无文件)';
  return diffs.map((d) => `- \`${d.path}\` (${d.status})`).join('\n');
}

function formatStats(diffs: FileDiff[]): string {
  if (diffs.length === 0) return '无变更';

  const stats = {
    added: diffs.filter((d) => d.status === 'added').length,
    modified: diffs.filter((d) => d.status === 'modified').length,
    deleted: diffs.filter((d) => d.status === 'deleted').length,
    renamed: diffs.filter((d) => d.status === 'renamed').length,
    total: diffs.length,
  };

  return [
    `- 总计: ${stats.total} 个文件`,
    `- 新增: ${stats.added}`,
    `- 修改: ${stats.modified}`,
    `- 删除: ${stats.deleted}`,
    `- 重命名: ${stats.renamed}`,
  ].join('\n');
}

function formatAnnotations(bundles: { annotations: { ruleId: string; ruleName: string; severity: string; message: string; line?: number }[] }[]): string {
  const allAnnotations = bundles.flatMap((b) => b.annotations);

  if (allAnnotations.length === 0) return '(无规则标注)';

  return allAnnotations
    .map((a) => {
      const loc = a.line != null ? `:${a.line}` : '';
      return `- [${a.severity.toUpperCase()}] ${a.ruleId}${loc} — ${a.ruleName}: ${a.message}`;
    })
    .join('\n');
}

function formatMCPContext(context: import('./types.js').MCPContextResult | undefined): string {
  if (!context) return '(无图谱上下文)';

  const parts: string[] = [];

  if (context.blastRadius.length > 0) {
    parts.push('### 影响半径');
    for (const item of context.blastRadius) {
      parts.push(`- ${item.path} (${item.type}: ${item.relation})`);
    }
  }

  if (context.riskScore > 0) {
    parts.push(`### 风险评分: ${context.riskScore}`);
  }

  if (Object.keys(context.codeSnippets).length > 0) {
    parts.push('### 相关代码片段');
    for (const [path, snippet] of Object.entries(context.codeSnippets)) {
      parts.push(`#### ${path}`);
      parts.push('```');
      parts.push(snippet);
      parts.push('```');
    }
  }

  if (parts.length === 0) return '(无图谱上下文)';
  return parts.join('\n');
}

function replaceTemplateVars(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp('\\$' + key, 'g'), value);
  }
  return result;
}

// ── 导出函数 ──

export function buildReviewPrompt(context: PipelineContext, template?: string): string {
  const tpl = template ?? DEFAULT_REVIEW_TEMPLATE;

  const vars: Record<string, string> = {
    DIFF: formatDiff(context.filteredDiffs),
    CONTEXT: formatMCPContext(context.context),
    RULE_ANNOTATIONS: formatAnnotations(context.annotatedBundles),
    FILE_LIST: formatFileList(context.filteredDiffs),
    STATS: formatStats(context.filteredDiffs),
    CUSTOM_RULES: context.customRules ?? '(无自定义规则)',
  };

  return replaceTemplateVars(tpl, vars);
}

export function buildSecurityPrompt(context: PipelineContext): string {
  const vars: Record<string, string> = {
    DIFF: formatDiff(context.filteredDiffs),
    CONTEXT: formatMCPContext(context.context),
    RULE_ANNOTATIONS: formatAnnotations(context.annotatedBundles),
    FILE_LIST: formatFileList(context.filteredDiffs),
    STATS: formatStats(context.filteredDiffs),
    CUSTOM_RULES: context.customRules ?? '(无自定义规则)',
  };

  return replaceTemplateVars(SECURITY_TEMPLATE, vars);
}

const IMPACT_TEMPLATE = `# Impact Analysis

## 变更文件列表
$FILE_LIST

## 变更统计
$STATS

## Diff 内容
$DIFF

## 图谱上下文
$CONTEXT

## 影响分析任务
请分析以上代码变更的影响范围：
1. 识别受影响的模块、组件和接口
2. 评估变更对下游调用者的影响
3. 检查是否存在潜在的回归风险
4. 评估测试覆盖率是否充足
5. 列出需要额外关注的文件和测试
`;

export function buildImpactPrompt(context: PipelineContext): string {
  const vars: Record<string, string> = {
    DIFF: formatDiff(context.filteredDiffs),
    CONTEXT: formatMCPContext(context.context),
    RULE_ANNOTATIONS: formatAnnotations(context.annotatedBundles),
    FILE_LIST: formatFileList(context.filteredDiffs),
    STATS: formatStats(context.filteredDiffs),
    CUSTOM_RULES: context.customRules ?? '(无自定义规则)',
  };

  return replaceTemplateVars(IMPACT_TEMPLATE, vars);
}

// ── Round 17: 安全 prompt 中嵌入 FP 规则文本 ──
// 已在 SECURITY_TEMPLATE 中包含误报过滤规则

// ── Round 23: buildScanPrompt ──

const SCAN_TEMPLATE = `# Full Code Scan

## 变更文件列表
$FILE_LIST

## 变更统计
$STATS

## Diff 内容
$DIFF

## 规则标注
$RULE_ANNOTATIONS

## 图谱上下文
$CONTEXT

## 扫描任务
请对以上代码变更进行全量扫描审查，包括但不限于：
- 安全漏洞（SQL注入、XSS、CSRF等）
- 代码质量（复杂度、可维护性、命名规范）
- 性能问题（内存泄漏、N+1 查询等）
- 最佳实践（错误处理、日志记录等）

对每个发现的问题，请标明文件、行号、严重级别和修复建议。
`;

export function buildScanPrompt(context: PipelineContext): string {
  const vars: Record<string, string> = {
    DIFF: formatDiff(context.filteredDiffs),
    CONTEXT: formatMCPContext(context.context),
    RULE_ANNOTATIONS: formatAnnotations(context.annotatedBundles),
    FILE_LIST: formatFileList(context.filteredDiffs),
    STATS: formatStats(context.filteredDiffs),
    CUSTOM_RULES: context.customRules ?? '(无自定义规则)',
  };

  return replaceTemplateVars(SCAN_TEMPLATE, vars);
}

// ── Round 29: formatFindingsSummary ──

export function formatFindingsSummary(findings: import('./types.js').Finding[]): string {
  if (findings.length === 0) return 'No findings.';

  const bySeverity: Record<string, import('./types.js').Finding[]> = {
    critical: [],
    high: [],
    medium: [],
    low: [],
    info: [],
  };

  for (const f of findings) {
    const s = f.severity in bySeverity ? f.severity : 'info';
    bySeverity[s].push(f);
  }

  const lines: string[] = [];
  lines.push(`Total: ${findings.length} finding(s)`);

  for (const [sev, items] of Object.entries(bySeverity)) {
    if (items.length > 0) {
      lines.push(`[${sev.toUpperCase()}] ${items.length}`);
      for (const item of items) {
        const loc = item.line ? `:${item.line}` : '';
        lines.push(`  - ${item.file}${loc}: ${item.message}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * 使用完全自定义模板构建 prompt。
 * 支持 $FILE_LIST, $STATS, $DIFF, $RULE_ANNOTATIONS, $CONTEXT, $CUSTOM_RULES 变量。
 */
export function buildCustomPrompt(context: PipelineContext, template: string): string {
  const vars: Record<string, string> = {
    DIFF: formatDiff(context.filteredDiffs),
    CONTEXT: formatMCPContext(context.context),
    RULE_ANNOTATIONS: formatAnnotations(context.annotatedBundles),
    FILE_LIST: formatFileList(context.filteredDiffs),
    STATS: formatStats(context.filteredDiffs),
    CUSTOM_RULES: context.customRules ?? '(无自定义规则)',
  };

  return replaceTemplateVars(template, vars);
}

// ── 语言特定审查提示 ──

const LANGUAGE_TIPS: Record<string, string> = {
  typescript: '关注类型安全：避免 `any`，检查类型断言，确保泛型约束正确。',
  javascript: '关注运行时安全：检查 undefined/null 处理，避免隐式类型转换，验证异步错误处理。',
  python: '关注 Python 特有问题：检查类型提示，避免可变默认参数，确保资源正确释放。',
  go: '关注 Go 特有问题：检查错误处理（err != nil），避免 goroutine 泄漏，确保并发安全。',
  rust: '关注 Rust 特有问题：检查 unsafe 使用，避免不必要的 clone，确保生命周期正确。',
  java: '关注 Java 特有问题：检查空指针处理，避免资源泄漏，确保异常处理完整。',
  cpp: '关注 C++ 特有问题：检查内存管理（智能指针），避免未定义行为，确保 RAII 模式。',
  c: '关注 C 特有问题：检查缓冲区溢出，避免内存泄漏，确保 null 终止字符串。',
};

/**
 * 检测 diff 中的主要语言并返回对应的审查提示。
 */
export function getLanguageReviewTip(diffs: import('./types.js').FileDiff[]): string {
  const langCount: Record<string, number> = {};
  for (const diff of diffs) {
    const lang = diff.language;
    if (lang) {
      langCount[lang] = (langCount[lang] ?? 0) + 1;
    }
  }

  if (Object.keys(langCount).length === 0) return '';

  const topLang = Object.entries(langCount).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!topLang) return '';

  const tip = LANGUAGE_TIPS[topLang];
  return tip ? `\n\n## 语言特定提示 (${topLang})\n${tip}` : '';
}

// ── Round 49: 代码块格式化 ──

/**
 * 将 diff 内容用 ```diff 代码块包裹。
 */
export function wrapDiffInCodeBlock(diffText: string): string {
  if (!diffText || diffText === '(无变更文件)') return diffText;
  return '```diff\n' + diffText + '\n```';
}

// ── Round 56: OWASP Top 10 ──

const OWASP_TOP_10_CATEGORIES = [
  'A01:2021 - Broken Access Control (失效的访问控制)',
  'A02:2021 - Cryptographic Failures (加密失败)',
  'A03:2021 - Injection (注入)',
  'A04:2021 - Insecure Design (不安全设计)',
  'A05:2021 - Security Misconfiguration (安全配置错误)',
  'A06:2021 - Vulnerable and Outdated Components (易受攻击和过时的组件)',
  'A07:2021 - Identification and Authentication Failures (身份识别和认证失败)',
  'A08:2021 - Software and Data Integrity Failures (软件和数据完整性失败)',
  'A09:2021 - Security Logging and Monitoring Failures (安全日志和监控失败)',
  'A10:2021 - Server-Side Request Forgery (SSRF) (服务端请求伪造)',
];

/**
 * 获取 OWASP Top 10 类别列表文本，用于安全 prompt。
 */
export function getOWASPTop10List(): string {
  return OWASP_TOP_10_CATEGORIES.map((c) => `- ${c}`).join('\n');
}

// ── Round 60: token 预估 ──

/**
 * 简单的 token 数量预估（字符数 / 4）。
 */
export function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}

// ── Round 70: max token 限制 ──

/**
 * 构建带 token 限制的 review prompt。
 * 当估算 token 超过 maxTokens 时，截断 diff 内容。
 */
export function buildReviewPromptWithTokenLimit(context: PipelineContext, maxTokens: number): string {
  const prompt = buildReviewPrompt(context);
  const estimated = estimatePromptTokens(prompt);

  if (estimated <= maxTokens) return prompt;

  // 需要截断 diff：二分查找合适的截断位置
  const diffs = context.filteredDiffs;
  let lo = 0;
  let hi = diffs.length;
  let bestContext = context;

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const truncatedContext = { ...context, filteredDiffs: diffs.slice(0, mid) };
    const testPrompt = buildReviewPrompt(truncatedContext);
    if (estimatePromptTokens(testPrompt) <= maxTokens) {
      bestContext = truncatedContext;
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return buildReviewPrompt(bestContext) +
    `\n\n[警告: prompt 已截断至 ${maxTokens} token 限制，部分文件可能未包含]`;
}
