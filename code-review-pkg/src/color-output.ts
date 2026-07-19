// src/color-output.ts — Task 14：彩色输出
//
// 职责：
// 1. colorizeSeverity：根据 severity 返回带 ANSI 颜色码的标签
// 2. colorizeFinding：将单个 finding 渲染为带颜色的单行/多行字符串
// 3. formatColoredOutput：将 findings 数组渲染为带颜色的完整审查报告
// 4. shouldUseColor：根据 --no-color 标志、NO_COLOR 环境变量、TTY 状态决定是否启用颜色
//
// 设计取舍：
// - ANSI 颜色码与 tui.ts 中的常量保持一致（critical=红, high=黄, medium=蓝, low=绿, info=灰）
// - 提供 useColor 选项，方便测试时禁用颜色
// - 自动检测：未明确指定时，结合 --no-color、NO_COLOR、process.stdout.isTTY 综合判断
//
// 与 cli.ts 集成：
// - review/security-review 等命令在输出 findings 时调用 formatColoredOutput
// - --no-color 标志禁用颜色输出

import type { Finding, Severity } from './types.js';
import { SEVERITY_ORDER } from './constants.js';

// ==================== ANSI 颜色常量 ====================

/** 重置所有属性 */
export const RESET = '\x1b[0m';
/** 加粗 */
export const BOLD = '\x1b[1m';
/** 暗淡 */
export const DIM = '\x1b[2m';
/** 斜体 */
export const ITALIC = '\x1b[3m';
/** 下划线 */
export const UNDERLINE = '\x1b[4m';
/** 反色 */
export const REVERSE = '\x1b[7m';

/** 前景色码 */
export const FG = {
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
} as const;

/** 后景色码 */
export const BG = {
  black: '\x1b[40m',
  red: '\x1b[41m',
  green: '\x1b[42m',
  yellow: '\x1b[43m',
  blue: '\x1b[44m',
  magenta: '\x1b[45m',
  cyan: '\x1b[46m',
  white: '\x1b[47m',
  gray: '\x1b[100m',
} as const;

/** severity 到前景色的映射 */
export const SEVERITY_COLOR: Record<Severity | 'info', string> = {
  critical: FG.red,
  high: FG.yellow,
  medium: FG.blue,
  low: FG.green,
  info: FG.gray,
};

/** severity 到中文标签的映射 */
export const SEVERITY_LABEL: Record<Severity | 'info', string> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
  info: 'INFO',
};

/** severity 图标（用于无颜色环境下的视觉区分） */
export const SEVERITY_ICON: Record<Severity | 'info', string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🔵',
  low: '🟢',
  info: '⚪',
};

// ==================== 颜色启用判定 ====================

/**
 * 决定是否启用彩色输出。
 *
 * 优先级（从高到低）：
 * 1. 显式传入的 useColor 参数
 * 2. NO_COLOR 环境变量（任何非空值都禁用颜色，参考 https://no-color.org/）
 * 3. FORCE_COLOR 环境变量（任何非空值都启用颜色）
 * 4. process.stdout.isTTY（TTY 时启用，否则禁用）
 */
export function shouldUseColor(opts: {
  useColor?: boolean;
  noColorFlag?: boolean;
  stream?: { isTTY?: boolean };
  env?: NodeJS.ProcessEnv;
} = {}): boolean {
  // 显式参数优先
  if (opts.useColor !== undefined) {
    return opts.useColor;
  }

  const env = opts.env ?? process.env;

  // NO_COLOR 标准禁用
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') {
    return false;
  }

  // --no-color 标志禁用
  if (opts.noColorFlag) {
    return false;
  }

  // FORCE_COLOR 强制启用
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0' && env.FORCE_COLOR !== '') {
    return true;
  }

  // 默认：根据 stream 的 TTY 状态判定
  const stream = opts.stream ?? process.stdout;
  return Boolean(stream?.isTTY);
}

// ==================== colorizeSeverity ====================

/**
 * 根据严重度返回带 ANSI 颜色码的标签。
 *
 * @param severity 严重度
 * @param useColor 是否启用颜色（默认 true）
 * @returns 例如 "\x1b[31mCRITICAL\x1b[0m" 或 "CRITICAL"
 */
export function colorizeSeverity(severity: Severity | 'info', useColor = true): string {
  const label = SEVERITY_LABEL[severity] ?? severity.toUpperCase();
  if (!useColor) return label;
  const color = SEVERITY_COLOR[severity] ?? '';
  return `${color}${label}${RESET}`;
}

/**
 * 返回 severity 对应的 ANSI 颜色码（不含标签）。
 */
export function severityColor(severity: Severity | 'info'): string {
  return SEVERITY_COLOR[severity] ?? '';
}

// ==================== colorizeFinding ====================

/** colorizeFinding 选项 */
export interface ColorizeFindingOptions {
  /** 是否启用颜色（默认 true） */
  useColor?: boolean;
  /** 是否单行模式（默认 false，多行） */
  singleLine?: boolean;
  /** 是否显示图标（默认 true） */
  showIcon?: boolean;
  /** 是否显示 confidence（默认 true） */
  showConfidence?: boolean;
  /** 是否显示 suggestion（默认 true） */
  showSuggestion?: boolean;
}

/**
 * 将单个 finding 渲染为带颜色的字符串。
 *
 * 多行模式示例（启用颜色）：
 * ```
 * 🔴 CRITICAL  src/app.ts:10  (security)
 *    SQL injection detected
 *    💡 Use parameterized queries
 *    confidence: 90%  source: rule (sql-injection)
 * ```
 *
 * 单行模式示例：
 * ```
 * 🔴 CRITICAL  src/app.ts:10  SQL injection detected
 * ```
 */
export function colorizeFinding(
  finding: Finding,
  options: ColorizeFindingOptions = {},
): string {
  const {
    useColor = true,
    singleLine = false,
    showIcon = true,
    showConfidence = true,
    showSuggestion = true,
  } = options;

  const sev = colorizeSeverity(finding.severity, useColor);
  const icon = showIcon ? `${SEVERITY_ICON[finding.severity] ?? ''} ` : '';
  const loc = finding.endLine != null && finding.endLine !== finding.line
    ? `${finding.file}:${finding.line}-${finding.endLine}`
    : `${finding.file}:${finding.line}`;
  const category = useColor
    ? `${FG.cyan}${finding.category}${RESET}`
    : finding.category;

  if (singleLine) {
    return `${icon}${sev}  ${loc}  ${finding.message}`;
  }

  const lines: string[] = [];
  lines.push(`${icon}${sev}  ${loc}  (${category})`);

  const msg = useColor ? `${BOLD}${finding.message}${RESET}` : finding.message;
  lines.push(`   ${msg}`);

  if (showSuggestion && finding.suggestion) {
    const suggestion = useColor
      ? `${FG.green}💡 ${finding.suggestion}${RESET}`
      : `💡 ${finding.suggestion}`;
    lines.push(`   ${suggestion}`);
  }

  if (showConfidence) {
    const pct = Math.round(finding.confidence * 100);
    const confColor = pct >= 85 ? FG.green : pct >= 60 ? FG.yellow : FG.red;
    const conf = useColor
      ? `${confColor}confidence: ${pct}%${RESET}`
      : `confidence: ${pct}%`;
    const source = useColor
      ? `${DIM}source: ${finding.source}${finding.ruleId ? ` (${finding.ruleId})` : ''}${RESET}`
      : `source: ${finding.source}${finding.ruleId ? ` (${finding.ruleId})` : ''}`;
    lines.push(`   ${conf}  ${source}`);
  }

  return lines.join('\n');
}

// ==================== formatColoredOutput ====================

/** formatColoredOutput 选项 */
export interface FormatColoredOutputOptions {
  /** 是否启用颜色（默认 true） */
  useColor?: boolean;
  /** 报告标题（默认 'Code Review Report'） */
  title?: string;
  /** 是否显示图标（默认 true） */
  showIcon?: boolean;
  /** 是否按 severity 排序（默认 true） */
  sortBySeverity?: boolean;
}

/**
 * 将 findings 数组渲染为带颜色的完整审查报告。
 *
 * 输出包含：
 * 1. 标题
 * 2. 按 severity 分组的摘要
 * 3. 每条 finding 的详细信息
 *
 * @param findings 待渲染的 findings
 * @param options  渲染选项
 */
export function formatColoredOutput(
  findings: Finding[],
  options: FormatColoredOutputOptions = {},
): string {
  const {
    useColor = true,
    title = 'Code Review Report',
    showIcon = true,
    sortBySeverity = true,
  } = options;

  const lines: string[] = [];

  // 标题
  lines.push(useColor ? `${BOLD}${UNDERLINE}${title}${RESET}` : title);
  lines.push('');

  if (findings.length === 0) {
    const msg = useColor ? `${FG.green}✅ No findings.${RESET}` : 'No findings.';
    lines.push(msg);
    return lines.join('\n');
  }

  // 摘要：按 severity 分组计数
  const counts: Record<string, number> = {};
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }
  const sevOrder: Array<Severity | 'info'> = ['critical', 'high', 'medium', 'low', 'info'];
  const summaryParts: string[] = [];
  for (const sev of sevOrder) {
    if (counts[sev]) {
      summaryParts.push(`${colorizeSeverity(sev, useColor)}: ${counts[sev]}`);
    }
  }
  lines.push(
    `${useColor ? BOLD : ''}Summary:${useColor ? RESET : ''} ${summaryParts.join('  ')}  (Total: ${findings.length})`,
  );
  lines.push('');

  // 排序
  const sorted = sortBySeverity
    ? [...findings].sort((a, b) => {
        const aL = SEVERITY_ORDER[a.severity] ?? 0;
        const bL = SEVERITY_ORDER[b.severity] ?? 0;
        return bL - aL;
      })
    : [...findings];

  // 渲染每条 finding（单行模式，便于按行检索/筛选）
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    const idx = useColor ? `${DIM}${i + 1}.${RESET}` : `${i + 1}.`;
    lines.push(`${idx} ${colorizeFinding(f, { useColor, showIcon, singleLine: true })}`);
  }

  return lines.join('\n');
}

// ==================== 辅助函数 ====================

/** 移除字符串中的所有 ANSI 转义序列（用于测试或非 TTY 输出） */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/** 检查字符串中是否包含 ANSI 颜色码 */
export function hasAnsiColor(text: string): boolean {
  return /\x1b\[[0-9;]*m/.test(text);
}
