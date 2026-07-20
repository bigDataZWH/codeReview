// src/tui.ts — Task 13：交互式 TUI
//
// 职责：
// 1. ReviewTUI 类：维护 findings 浏览状态（光标、滚动、过滤、排序）
// 2. launchTUI：以非阻塞方式启动交互式 TUI，读取按键并渲染
// 3. renderFindings：将 findings 列表渲染为带 ANSI 转义序列的字符串
// 4. 仅使用 ANSI 转义序列实现，不依赖外部 TUI 库
//
// 设计取舍：
// - 渲染与 IO 分离：render() 返回字符串，start() 负责循环读键与写入
// - reader/writer 可注入，便于单元测试
// - 颜色码集中在 ANSI_* 常量，可通过 useColor 关闭
// - 键映射集中在 TUI_KEYS，方便测试模拟
//
// 与 cli.ts 集成：
// - review --tui：进入交互式 TUI 模式（仅当 stdin 为 TTY 时启用 raw mode）

import type { Finding, Severity } from './types.js';
import { SEVERITY_ORDER } from './constants.js';

// ==================== ANSI 转义序列常量 ====================

/** 清屏并复位光标 */
export const ANSI_CLEAR_SCREEN = '\x1b[2J\x1b[H';
/** 清除当前行 */
export const ANSI_CLEAR_LINE = '\x1b[2K';
/** 隐藏光标 */
export const ANSI_HIDE_CURSOR = '\x1b[?25l';
/** 显示光标 */
export const ANSI_SHOW_CURSOR = '\x1b[?25h';
/** 重置所有属性 */
export const ANSI_RESET = '\x1b[0m';
/** 加粗 */
export const ANSI_BOLD = '\x1b[1m';
/** 反色（高亮） */
export const ANSI_REVERSE = '\x1b[7m';
/** 取消反色 */
export const ANSI_REVERSE_OFF = '\x1b[27m';

/** 前景色 */
export const ANSI_FG = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  white: '\x1b[97m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
} as const;

/** 后景色 */
export const ANSI_BG = {
  red: '\x1b[41m',
  green: '\x1b[42m',
  yellow: '\x1b[43m',
  blue: '\x1b[44m',
  gray: '\x1b[100m',
} as const;

// ==================== 按键常量 ====================

/** TUI 按键常量（用于测试模拟与文档化） */
export const TUI_KEYS = {
  UP: '\x1b[A',
  DOWN: '\x1b[B',
  RIGHT: '\x1b[C',
  LEFT: '\x1b[D',
  ENTER: '\r',
  ESC: '\x1b',
  CTRL_C: '\x03',
  Q: 'q',
  J: 'j',
  K: 'k',
  G: 'g',
  F: 'f',
  S: 's',
  SLASH: '/',
  TAB: '\t',
  PAGE_UP: '\x1b[5~',
  PAGE_DOWN: '\x1b[6~',
  HOME: '\x1b[H',
  END: '\x1b[F',
  SPACE: ' ',
} as const;

// ==================== 类型定义 ====================

/** 排序模式 */
export type TUISortMode = 'severity' | 'file' | 'line' | 'category';

/** 过滤条件 */
export interface TUIFilter {
  /** 仅显示指定严重度 */
  severity?: Severity | 'info';
  /** 仅显示指定类别 */
  category?: string;
  /** 文件路径子串匹配 */
  file?: string;
  /** 消息子串匹配 */
  message?: string;
}

/** TUI 配置选项 */
export interface TUIOptions {
  /** 输出函数，默认 process.stdout.write */
  writer?: (text: string) => void;
  /** 读取下一个按键的函数；返回 null 表示 EOF */
  reader?: () => string | null | Promise<string | null>;
  /** 初始过滤条件 */
  initialFilter?: TUIFilter;
  /** 初始排序模式 */
  initialSort?: TUISortMode;
  /** 每页显示行数（默认 20） */
  pageSize?: number;
  /** 是否启用颜色（默认 true） */
  useColor?: boolean;
  /** 是否在 stdin 上启用 raw mode（仅 TTY 时有效，默认 true） */
  interactive?: boolean;
}

/** 渲染选项（renderFindings 用） */
export interface RenderFindingsOptions {
  /** 当前光标行（高亮显示） */
  cursor?: number;
  /** 滚动偏移（跳过前 N 条） */
  offset?: number;
  /** 每页行数（默认 20） */
  pageSize?: number;
  /** 是否启用颜色（默认 true） */
  useColor?: boolean;
  /** 标题（默认 'Code Review Findings'） */
  title?: string;
}

// ==================== 排序与过滤辅助 ====================

/** 按严重度降序排序（critical → info） */
export function sortFindingsBySeverity(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const aLvl = SEVERITY_ORDER[a.severity] ?? 0;
    const bLvl = SEVERITY_ORDER[b.severity] ?? 0;
    if (bLvl !== aLvl) return bLvl - aLvl;
    // 同严重度按 file 然后 line 排序，保证稳定
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.line - b.line;
  });
}

/** 按文件路径排序 */
export function sortFindingsByFile(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.line - b.line;
  });
}

/** 按行号排序 */
export function sortFindingsByLine(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => a.line - b.line);
}

/** 按类别排序 */
export function sortFindingsByCategory(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    return a.line - b.line;
  });
}

/** 按指定模式排序 */
export function sortFindings(findings: Finding[], mode: TUISortMode): Finding[] {
  switch (mode) {
    case 'severity':
      return sortFindingsBySeverity(findings);
    case 'file':
      return sortFindingsByFile(findings);
    case 'line':
      return sortFindingsByLine(findings);
    case 'category':
      return sortFindingsByCategory(findings);
    default:
      return [...findings];
  }
}

/** 应用过滤条件 */
export function filterFindings(findings: Finding[], filter: TUIFilter): Finding[] {
  return findings.filter((f) => {
    if (filter.severity !== undefined && f.severity !== filter.severity) return false;
    if (filter.category !== undefined && f.category !== filter.category) return false;
    if (filter.file !== undefined && !f.file.toLowerCase().includes(filter.file.toLowerCase())) {
      return false;
    }
    if (filter.message !== undefined && !f.message.toLowerCase().includes(filter.message.toLowerCase())) {
      return false;
    }
    return true;
  });
}

// ==================== 颜色辅助 ====================

/** 根据严重度返回对应 ANSI 前景色码 */
export function severityAnsiColor(severity: Severity | 'info'): string {
  switch (severity) {
    case 'critical':
      return ANSI_FG.red;
    case 'high':
      return ANSI_FG.yellow;
    case 'medium':
      return ANSI_FG.blue;
    case 'low':
      return ANSI_FG.green;
    case 'info':
      return ANSI_FG.gray;
    default:
      return ANSI_RESET;
  }
}

/** 颜色化严重度标签（如 "[CRITICAL]" → 红色） */
export function colorizeSeverityTag(severity: Severity | 'info', useColor = true): string {
  const label = severity.toUpperCase().padEnd(8);
  if (!useColor) return `[${label.trim()}]`;
  return `${severityAnsiColor(severity)}[${label}]${ANSI_RESET}`;
}

/** 截断字符串到指定显示宽度 */
function truncateForDisplay(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(0, maxLen - 1)) + '…';
}

// ==================== renderFindings ====================

/**
 * 将 findings 列表渲染为带 ANSI 颜色码的字符串。
 *
 * @param findings 待渲染的 findings（应已排序/过滤）
 * @param options  渲染选项
 * @returns 渲染后的多行字符串（不含末尾清屏等控制序列）
 */
export function renderFindings(
  findings: Finding[],
  options: RenderFindingsOptions = {},
): string {
  const {
    cursor = -1,
    offset = 0,
    pageSize = 20,
    useColor = true,
    title = 'Code Review Findings',
  } = options;

  const lines: string[] = [];
  const total = findings.length;

  // 标题 + 摘要
  lines.push(`${useColor ? ANSI_BOLD : ''}${title}${useColor ? ANSI_RESET : ''}`);
  lines.push(`Total: ${total}  (showing ${Math.min(pageSize, Math.max(0, total - offset))} from offset ${offset})`);

  // 摘要：按严重度计数
  const counts: Record<string, number> = {};
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }
  const sevOrder: Array<Severity | 'info'> = ['critical', 'high', 'medium', 'low', 'info'];
  const summaryParts: string[] = [];
  for (const sev of sevOrder) {
    if (counts[sev]) {
      summaryParts.push(`${colorizeSeverityTag(sev, useColor)} ${counts[sev]}`);
    }
  }
  if (summaryParts.length > 0) {
    lines.push(summaryParts.join('  '));
  }
  lines.push('');

  if (total === 0) {
    lines.push(`${useColor ? ANSI_FG.gray : ''}No findings to display.${useColor ? ANSI_RESET : ''}`);
    return lines.join('\n');
  }

  // 表头
  const header = `${'#'.padEnd(4)}  ${'SEVERITY'.padEnd(10)}  ${'FILE'.padEnd(30)}  ${'LINE'.padStart(6)}  ${'CATEGORY'.padEnd(15)}  MESSAGE`;
  lines.push(`${useColor ? ANSI_BOLD : ''}${header}${useColor ? ANSI_RESET : ''}`);
  lines.push('─'.repeat(Math.min(120, header.length + 20)));

  // 行
  const end = Math.min(total, offset + pageSize);
  for (let i = offset; i < end; i++) {
    const f = findings[i];
    const isCursor = i === cursor;
    const sevTag = colorizeSeverityTag(f.severity, useColor);
    const fileCol = truncateForDisplay(f.file, 30).padEnd(30);
    const lineCol = String(f.line).padStart(6);
    const catCol = truncateForDisplay(f.category, 15).padEnd(15);
    const msgCol = truncateForDisplay(f.message, 60);
    const num = String(i + 1).padStart(3);
    let row = `${num}  ${sevTag}  ${fileCol}  ${lineCol}  ${catCol}  ${msgCol}`;
    if (isCursor && useColor) {
      row = `${ANSI_REVERSE}${row}${ANSI_REVERSE_OFF}`;
    } else if (isCursor) {
      row = `▶ ${row}`;
    }
    lines.push(row);
  }

  // 帮助行
  lines.push('');
  const help = [
    '↑/↓ or j/k: navigate',
    'g: top  G: bottom',
    'PageUp/PageDown: page',
    'f: filter  s: sort',
    'q: quit',
  ].join('  |  ');
  lines.push(`${useColor ? ANSI_FG.gray : ''}${help}${useColor ? ANSI_RESET : ''}`);

  return lines.join('\n');
}

// ==================== ReviewTUI 类 ====================

/**
 * 交互式 TUI 控制器。
 *
 * 维护 findings 浏览状态：光标位置、滚动偏移、过滤条件、排序模式。
 * 渲染时调用 render() 获取最新画面字符串；start() 进入交互循环。
 */
export class ReviewTUI {
  private findings: Finding[];
  private cursor = 0;
  private offset = 0;
  private filter: TUIFilter;
  private sortMode: TUISortMode;
  private readonly pageSize: number;
  private readonly useColor: boolean;
  private readonly writer: (text: string) => void;
  private readonly reader?: () => string | null | Promise<string | null>;
  private readonly interactive: boolean;
  private running = false;

  constructor(findings: Finding[], options: TUIOptions = {}) {
    this.findings = [...findings];
    this.filter = { ...options.initialFilter };
    this.sortMode = options.initialSort ?? 'severity';
    this.pageSize = options.pageSize ?? 20;
    this.useColor = options.useColor ?? true;
    this.writer = options.writer ?? ((s) => process.stdout.write(s));
    this.reader = options.reader;
    this.interactive = options.interactive ?? true;
  }

  // ---------- 状态查询 ----------

  /** 当前光标位置（在已过滤排序后的列表中的索引） */
  getCursor(): number {
    return this.cursor;
  }

  /** 当前滚动偏移 */
  getOffset(): number {
    return this.offset;
  }

  /** 当前排序模式 */
  getSortMode(): TUISortMode {
    return this.sortMode;
  }

  /** 当前过滤条件（副本） */
  getFilter(): TUIFilter {
    return { ...this.filter };
  }

  /** 已过滤并排序的 findings（副本） */
  getVisibleFindings(): Finding[] {
    const filtered = filterFindings(this.findings, this.filter);
    return sortFindings(filtered, this.sortMode);
  }

  /** 原始 findings 总数 */
  getTotalCount(): number {
    return this.findings.length;
  }

  /** 当前光标所指的 finding（若无则 null） */
  getCurrentFinding(): Finding | null {
    const visible = this.getVisibleFindings();
    if (visible.length === 0) return null;
    return visible[Math.min(this.cursor, visible.length - 1)] ?? null;
  }

  // ---------- 导航 ----------

  /** 向上移动光标 */
  moveUp(): void {
    if (this.cursor > 0) {
      this.cursor--;
      this.adjustOffset();
    }
  }

  /** 向下移动光标 */
  moveDown(): void {
    const visible = this.getVisibleFindings();
    if (this.cursor < visible.length - 1) {
      this.cursor++;
      this.adjustOffset();
    }
  }

  /** 上翻一页 */
  pageUp(): void {
    this.cursor = Math.max(0, this.cursor - this.pageSize);
    this.adjustOffset();
  }

  /** 下翻一页 */
  pageDown(): void {
    const visible = this.getVisibleFindings();
    this.cursor = Math.min(visible.length - 1, this.cursor + this.pageSize);
    this.adjustOffset();
  }

  /** 跳到顶部 */
  goToTop(): void {
    this.cursor = 0;
    this.offset = 0;
  }

  /** 跳到底部 */
  goToBottom(): void {
    const visible = this.getVisibleFindings();
    this.cursor = Math.max(0, visible.length - 1);
    this.adjustOffset();
  }

  /** 调整滚动偏移使光标可见 */
  private adjustOffset(): void {
    if (this.cursor < this.offset) {
      this.offset = this.cursor;
    } else if (this.cursor >= this.offset + this.pageSize) {
      this.offset = this.cursor - this.pageSize + 1;
    }
    if (this.offset < 0) this.offset = 0;
  }

  // ---------- 过滤 ----------

  /** 设置过滤条件（合并到现有过滤） */
  setFilter(filter: TUIFilter): void {
    this.filter = { ...this.filter, ...filter };
    this.cursor = 0;
    this.offset = 0;
  }

  /** 清空过滤条件 */
  clearFilter(): void {
    this.filter = {};
    this.cursor = 0;
    this.offset = 0;
  }

  // ---------- 排序 ----------

  /** 设置排序模式 */
  setSortMode(mode: TUISortMode): void {
    this.sortMode = mode;
  }

  /** 循环切换排序模式：severity → file → line → category → severity */
  cycleSortMode(): void {
    const modes: TUISortMode[] = ['severity', 'file', 'line', 'category'];
    const idx = modes.indexOf(this.sortMode);
    this.sortMode = modes[(idx + 1) % modes.length];
  }

  // ---------- 渲染 ----------

  /**
   * 渲染当前画面为字符串。
   *
   * 注意：仅返回渲染内容，不写入。写入由调用方或 start() 负责。
   */
  render(): string {
    const visible = this.getVisibleFindings();
    return renderFindings(visible, {
      cursor: this.cursor,
      offset: this.offset,
      pageSize: this.pageSize,
      useColor: this.useColor,
      title: this.buildTitle(),
    });
  }

  private buildTitle(): string {
    const visible = this.getVisibleFindings();
    const parts: string[] = ['Code Review Findings'];
    parts.push(`(sort: ${this.sortMode})`);
    const filterKeys = Object.keys(this.filter).filter((k) => {
      const v = (this.filter as Record<string, unknown>)[k];
      return v !== undefined && v !== '';
    });
    if (filterKeys.length > 0) {
      const f = filterKeys
        .map((k) => `${k}=${String((this.filter as Record<string, unknown>)[k])}`)
        .join(',');
      parts.push(`(filter: ${f})`);
    }
    parts.push(`[${visible.length}/${this.findings.length}]`);
    return parts.join(' ');
  }

  /** 写入清屏序列 */
  clearScreen(): void {
    this.writer(ANSI_CLEAR_SCREEN);
  }

  /** 渲染并写入到 writer */
  paint(): void {
    this.clearScreen();
    this.writer(this.render() + '\n');
  }

  // ---------- 交互循环 ----------

  /**
   * 启动交互式 TUI 循环。
   *
   * 读取按键（通过 reader 或 stdin raw mode），更新状态并重绘。
   * 遇到 q / ESC / Ctrl+C 或 reader 返回 null 时退出。
   *
   * 注意：若未提供 reader 且 stdin 不是 TTY，将仅渲染一次后立即返回。
   */
  async start(): Promise<void> {
    this.running = true;
    this.paint();

    // 没有可读取按键的方式：仅渲染一次
    if (!this.reader && (!process.stdin.isTTY || !this.interactive)) {
      this.writer(ANSI_SHOW_CURSOR);
      return;
    }

    // 进入 raw mode（仅 TTY）
    let wasRaw = false;
    if (this.interactive && process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      wasRaw = process.stdin.isRaw;
      process.stdin.setRawMode(true);
      process.stdin.resume();
    }

    try {
      while (this.running) {
        const key = this.reader ? await this.reader() : await this.readKeyFromStdin();
        if (key === null) break;
        if (!this.handleKey(key)) break;
        this.paint();
      }
    } finally {
      if (wasRaw !== true && this.interactive && process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
        process.stdin.setRawMode(false);
      }
      this.writer(ANSI_SHOW_CURSOR);
      this.running = false;
    }
  }

  /** 停止 TUI 循环 */
  stop(): void {
    this.running = false;
  }

  /**
   * 处理按键。
   * @returns true 继续，false 退出
   */
  handleKey(key: string): boolean {
    switch (key) {
      case TUI_KEYS.UP:
      case TUI_KEYS.K:
        this.moveUp();
        return true;
      case TUI_KEYS.DOWN:
      case TUI_KEYS.J:
        this.moveDown();
        return true;
      case TUI_KEYS.PAGE_UP:
        this.pageUp();
        return true;
      case TUI_KEYS.PAGE_DOWN:
        this.pageDown();
        return true;
      case TUI_KEYS.HOME:
      case TUI_KEYS.G:
        this.goToTop();
        return true;
      case TUI_KEYS.END:
        this.goToBottom();
        return true;
      case TUI_KEYS.S:
        this.cycleSortMode();
        return true;
      case TUI_KEYS.F:
        // 过滤交互需调用方提供 reader；此处仅占位
        return true;
      case TUI_KEYS.Q:
      case TUI_KEYS.ESC:
      case TUI_KEYS.CTRL_C:
        return false;
      default:
        return true;
    }
  }

  /** 从 stdin 异步读取一个按键 */
  private readKeyFromStdin(): Promise<string | null> {
    return new Promise((resolve) => {
      const stdin = process.stdin;
      const onData = (data: Buffer | string) => {
        stdin.removeListener('data', onData);
        stdin.removeListener('end', onEnd);
        resolve(typeof data === 'string' ? data : data.toString('utf-8'));
      };
      const onEnd = () => {
        stdin.removeListener('data', onData);
        resolve(null);
      };
      stdin.once('data', onData);
      stdin.once('end', onEnd);
    });
  }
}

// ==================== launchTUI ====================

/**
 * 启动 TUI 的便捷函数。
 *
 * @param findings 待浏览的 findings
 * @param options  TUI 配置
 */
export async function launchTUI(findings: Finding[], options: TUIOptions = {}): Promise<void> {
  const tui = new ReviewTUI(findings, options);
  await tui.start();
}
