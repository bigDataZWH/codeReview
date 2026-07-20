import type { PipelineContext, FileDiff } from './types.js';
import { compressContext, type CompressionOptions } from './token-optimizer.js';
import { countTokens } from './token-counter.js';

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

## 安全方法论（三层分析）

请严格按照以下三层方法论进行安全审查，每一层都需有明确产出：

### 第一层：仓库上下文研究（Repository Context Research）
在分析 diff 之前，先建立对仓库整体安全态势的理解：
- **项目架构**：识别核心模块、入口点、信任边界与隔离层
- **认证机制**：定位身份验证、会话管理、令牌签发与校验的位置
- **数据流**：追踪用户输入从入口到持久化的路径，识别反序列化点与外部调用点
- **现有防护**：盘点已有的输入校验、输出编码、权限校验、加密策略

### 第二层：diff 对比分析（Comparative Diff Analysis）
逐文件分析变更，重点关注**安全敏感变更**：
- **认证/授权变更**：会话校验、权限检查、令牌生成的逻辑改动
- **输入处理变更**：新增用户输入字段、解析逻辑、SQL/命令构造方式
- **加密相关变更**：算法替换、密钥处理、随机数源
- **数据流变更**：新增外部调用、文件/网络 I/O、反序列化点
- **配置变更**：CORS、CSP、cookie 策略、调试开关、依赖版本

请对照以下安全维度，逐一识别 diff 中的潜在风险：
- **SQL 注入**: 检查字符串拼接构造 SQL、用户输入未参数化
- **XSS (跨站脚本)**: 检查未转义的用户输入、危险的 innerHTML 使用
- **CSRF**: 检查缺少 token 校验的状态变更接口
- **路径遍历**: 检查用户可控的文件路径
- **敏感信息泄露**: 检查日志、错误响应中的敏感数据
- **认证/授权**: 检查缺失的身份验证和权限校验
- **依赖安全**: 检查已知漏洞的依赖

### 第三层：漏洞评估（Vulnerability Assessment）
对每个识别出的潜在漏洞，给出结构化评估：
- **严重度（severity）**：critical / high / medium / low，结合 CVSS 思路
- **可利用性（exploitability）**：评估攻击路径复杂度、是否需要特权、是否有现成 PoC
- **影响范围（impact）**：数据泄露、权限提升、服务中断、横向移动
- **修复建议（recommendation）**：具体可落地的修复代码或配置调整

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
 * Token 数量预估（基于 GPT tokenizer 启发式，CJK 感知）。
 *
 * 委托给 `countTokens`，对中文/日文/韩文等宽字符显著比字符数/4 更准确，
 * 对纯 ASCII 文本结果与 `Math.ceil(len / 4)` 一致（向后兼容）。
 */
export function estimatePromptTokens(prompt: string): number {
  return countTokens(prompt);
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

// ── 迭代 6：上下文压缩集成 ──

/**
 * 构建带上下文压缩的 review prompt。
 *
 * 在格式化 diff 之前，先调用 compressContext 压缩 filteredDiffs，
 * 然后再格式化为 prompt 文本。压缩策略通过 options 控制。
 *
 * @param context 管道上下文
 * @param compressionOptions 压缩选项
 * @param template 自定义模板（可选）
 */
export function buildReviewPromptWithCompression(
  context: PipelineContext,
  compressionOptions: CompressionOptions,
  template?: string,
): string {
  const compressedDiffs = compressContext(context.filteredDiffs, compressionOptions);
  const compressedContext: PipelineContext = {
    ...context,
    filteredDiffs: compressedDiffs,
  };
  return buildReviewPrompt(compressedContext, template);
}

// ============================================================
// 迭代 8：Prompt 工程优化 — 变体管理 + A/B 测试 + 指标统计
// ============================================================

/** Prompt 变体元数据（可选） */
export interface PromptVariantMetadata {
  /** 作者 */
  author?: string;
  /** 描述 */
  description?: string;
  /** 任意自定义键值 */
  [k: string]: unknown;
}

/** Prompt 变体定义 */
export interface PromptVariant {
  /** 变体唯一 ID（自动生成） */
  id: string;
  /** 变体名称（如 "baseline"、"enhanced"） */
  name: string;
  /** Prompt 模板，支持 $FILE_LIST 等变量 */
  template: string;
  /** 语义化版本号（默认 "1.0.0"） */
  version: string;
  /** 权重（默认 1），用于加权随机分配 */
  weight: number;
  /** 元数据（可选） */
  metadata?: PromptVariantMetadata;
}

/** 单次 Prompt 使用指标 */
export interface PromptMetrics {
  /** 关联的变体 ID */
  variantId: string;
  /** 时间戳（ms） */
  timestamp: number;
  /** 本次 prompt 产出的 finding 数 */
  findingCount: number;
  /** 接受数 */
  acceptCount: number;
  /** 拒绝数（误报） */
  rejectCount: number;
  /** 修改数 */
  modifyCount: number;
  /** Token 消耗 */
  tokenCount: number;
  /** 处理耗时（ms） */
  durationMs: number;
}

/** 单变体聚合统计 */
export interface PromptVariantStats {
  /** 变体 ID */
  variantId: string;
  /** 样本数 */
  sampleCount: number;
  /** 累计 finding 数 */
  totalFindings: number;
  /** 累计接受数 */
  totalAccept: number;
  /** 累计拒绝数 */
  totalReject: number;
  /** 累计修改数 */
  totalModify: number;
  /** 接受率 = totalAccept / (totalAccept + totalReject + totalModify) */
  acceptRate: number;
  /** 平均 Token 消耗 */
  avgTokens: number;
  /** 平均耗时（ms） */
  avgDurationMs: number;
}

/** 变体 ID 自增计数器（保证全局唯一性） */
let variantIdCounter = 0;

/**
 * 创建 Prompt 变体。
 *
 * @param options 变体配置
 * @returns 带有自动生成 ID 的变体对象
 * @throws 当 name 为空、template 为空、weight 为负数时抛出错误
 */
export function createPromptVariant(options: {
  name: string;
  template: string;
  version?: string;
  weight?: number;
  metadata?: PromptVariantMetadata;
}): PromptVariant {
  if (!options.name || typeof options.name !== 'string') {
    throw new Error('PromptVariant name must be a non-empty string');
  }
  if (!options.template || typeof options.template !== 'string') {
    throw new Error('PromptVariant template must be a non-empty string');
  }
  const weight = options.weight ?? 1;
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
    throw new Error('PromptVariant weight must be a non-negative finite number');
  }
  variantIdCounter += 1;
  return {
    id: `pv-${Date.now().toString(36)}-${variantIdCounter.toString(36)}`,
    name: options.name,
    template: options.template,
    version: options.version ?? '1.0.0',
    weight,
    metadata: options.metadata,
  };
}

/**
 * 简单的字符串哈希（FNV-1a 变种），用于 deterministic 分配。
 * 返回 32 位无符号整数。
 */
function hashString32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** selectPromptVariant 选项 */
export interface SelectPromptVariantOptions {
  /** 确定性分配 key（如 sessionId、prNumber）；提供时相同 key 永远分配到相同变体 */
  key?: string;
}

/**
 * 按权重随机选择 Prompt 变体（A/B 测试分配）。
 *
 * - 权重为加权概率：weight=3 的变体被选中概率是 weight=1 的 3 倍
 * - 所有权重为 0 时退化为均匀随机
 * - 提供 `key` 时启用确定性分配：相同 key 永远映射到相同变体
 *
 * @param variants 变体列表
 * @param options 选项
 * @returns 选中的变体
 * @throws 当 variants 为空数组时抛出错误
 */
export function selectPromptVariant(
  variants: PromptVariant[],
  options?: SelectPromptVariantOptions,
): PromptVariant {
  if (!variants || variants.length === 0) {
    throw new Error('selectPromptVariant: variants array is empty');
  }
  if (variants.length === 1) {
    return variants[0];
  }

  const totalWeight = variants.reduce((s, v) => s + v.weight, 0);

  // 确定性分配：基于 key 哈希得到 [0, 1) 区间值
  let r: number;
  if (options?.key !== undefined && options.key !== '') {
    const h = hashString32(options.key);
    r = h / 0x100000000;
  } else {
    r = Math.random();
  }

  // 所有权重为 0 → 均匀随机
  if (totalWeight <= 0) {
    const idx = Math.min(Math.floor(r * variants.length), variants.length - 1);
    return variants[idx];
  }

  // 加权随机：累计权重命中
  let acc = 0;
  for (const v of variants) {
    acc += v.weight;
    if (r < acc / totalWeight) {
      return v;
    }
  }
  // 浮点误差兜底
  return variants[variants.length - 1];
}

/**
 * 创建 Prompt 指标存储（A/B 测试效果统计）。
 *
 * 收集每次 Prompt 使用的 finding/接受/拒绝/Token/耗时指标，
 * 聚合后可比较变体效果、选出胜出版本。
 *
 * @returns 指标存储对象
 */
export function trackPromptMetrics(): PromptMetricsStore {
  const records: PromptMetrics[] = [];

  /** 聚合单个变体统计；不存在返回 null */
  const getVariantStats = (variantId: string): PromptVariantStats | null => {
    const subset = records.filter((r) => r.variantId === variantId);
    if (subset.length === 0) return null;
    let totalFindings = 0;
    let totalAccept = 0;
    let totalReject = 0;
    let totalModify = 0;
    let totalTokens = 0;
    let totalDuration = 0;
    for (const r of subset) {
      totalFindings += r.findingCount;
      totalAccept += r.acceptCount;
      totalReject += r.rejectCount;
      totalModify += r.modifyCount;
      totalTokens += r.tokenCount;
      totalDuration += r.durationMs;
    }
    const n = subset.length;
    const totalFeedback = totalAccept + totalReject + totalModify;
    return {
      variantId,
      sampleCount: n,
      totalFindings,
      totalAccept,
      totalReject,
      totalModify,
      acceptRate: totalFeedback > 0 ? totalAccept / totalFeedback : 0,
      avgTokens: totalTokens / n,
      avgDurationMs: totalDuration / n,
    };
  };

  /** 比较所有变体（按 acceptRate 降序） */
  const compareVariants = (): PromptVariantStats[] => {
    const ids = Array.from(new Set(records.map((r) => r.variantId)));
    const stats: PromptVariantStats[] = [];
    for (const id of ids) {
      const s = getVariantStats(id);
      if (s) stats.push(s);
    }
    stats.sort((a, b) => b.acceptRate - a.acceptRate);
    return stats;
  };

  return {
    /** 记录一次指标 */
    record(m: PromptMetrics): void {
      records.push({ ...m });
    },
    /** 返回所有记录副本 */
    getAll(): PromptMetrics[] {
      return records.map((r) => ({ ...r }));
    },
    getVariantStats,
    compareVariants,
    /** 选出胜出变体；样本不足时返回 null */
    pickWinner(opts?: { minSamples?: number }): PromptVariantStats | null {
      const minSamples = opts?.minSamples ?? 1;
      const all = compareVariants();
      const qualified = all.filter((s) => s.sampleCount >= minSamples);
      if (qualified.length === 0) return null;
      return qualified[0];
    },
    /** 清空所有指标 */
    clear(): void {
      records.length = 0;
    },
  };
}

/** Prompt 指标存储接口 */
export interface PromptMetricsStore {
  /** 记录一次指标 */
  record(m: PromptMetrics): void;
  /** 返回所有记录 */
  getAll(): PromptMetrics[];
  /** 聚合单个变体统计 */
  getVariantStats(variantId: string): PromptVariantStats | null;
  /** 比较所有变体 */
  compareVariants(): PromptVariantStats[];
  /** 选出胜出变体 */
  pickWinner(opts?: { minSamples?: number }): PromptVariantStats | null;
  /** 清空所有指标 */
  clear(): void;
}
