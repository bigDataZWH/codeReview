// src/precheck.ts — Task 4：智能预检
//
// 职责：
// - 在调用 LLM 前对 diff 做轻量静态分析，检测 trivial changes（仅空白/格式/注释变更）
// - 若 trivial changes 占主导（或全部为 trivial），则可跳过 LLM 调用，节省 token 与时间
// - 复用 src/diff-parser.ts 中的 isOnlyWhitespaceChange 与 computeDiffStats
//
// 设计取舍：
// - 纯函数无副作用：输入 FileDiff[] 输出 PreCheckResult，便于测试与组合
// - 三种 trivial 类型独立判定：whitespaceOnly / commentOnly / formatOnly
// - formatOnly 通过对 hunk 内 add/delete 行做配对，比较去除空白后的内容来判定
// - commentOnly 通过常见注释前缀（// # -- ; /* * <!-- """ '''）粗略匹配，覆盖主流语言

import {
  isOnlyWhitespaceChange,
  computeDiffStats,
} from './diff-parser.js';
import type { FileDiff } from './types.js';

/** 预检统计信息 */
export interface PreCheckStats {
  /** 变更文件数 */
  filesChanged: number;
  /** 新增行数 */
  insertions: number;
  /** 删除行数 */
  deletions: number;
  /** 修改行数（insertions + deletions） */
  modifiedLines: number;
  /** 仅空白变更的文件数 */
  whitespaceOnlyFiles: number;
  /** 仅注释变更的文件数 */
  commentOnlyFiles: number;
  /** 仅格式变更的文件数 */
  formatOnlyFiles: number;
  /** trivial 文件总数（whitespace + comment + format，互斥计数） */
  trivialFiles: number;
  /** 非 trivial 文件数（含实质代码变更） */
  nonTrivialFiles: number;
}

/** 预检结果 */
export interface PreCheckResult {
  /** 是否应跳过 LLM 调用 */
  shouldSkip: boolean;
  /** 跳过原因（应跳过时为简短描述，不应跳过时为空字符串） */
  reason: string;
  /** 预检统计信息 */
  stats: PreCheckStats;
}

/** 常见单行注释前缀（按语言粗略匹配） */
const COMMENT_LINE_PREFIXES = [
  '//', // C/C++/Java/JS/TS/Rust/Go/Swift/Dart/Kotlin
  '#', // Python/Shell/Ruby/Perl/PowerShell/TOML/YAML
  '--', // SQL/Lua/Haskell
  ';', // Lisp/Assembly/INI
  '%', // TeX/MATLAB/Erlang
  '"!', // VBA（行首以单引号开始：单独处理）
];

/** 多行注释相关起始/续行/结束标记 */
const COMMENT_BLOCK_MARKERS = [
  /^\s*\/\*/, // /* C-style block open
  /^\s*\*/, // * block continuation
  /^\s*\*\//, // */ block close
  /^\s*<!--/, // <!-- HTML/XML open
  /^\s*-->/, // --> HTML/XML close
  /^\s*"""/, // """ Python docstring
  /^\s*'''/, // ''' Python docstring
  /^\s*--\[\[/, // --[[ Lua long comment
  /^\s*\]\]/, // ]] Lua long comment close
];

/** VB/VBA 单引号注释前缀（需在行首） */
const VB_COMMENT_RE = /^\s*'/;

/**
 * 判断一行是否为纯注释行（去除首尾空白后以常见注释标记开头）。
 * 空行视为 trivial（返回 true）。
 */
export function isCommentLine(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed === '') return true; // 空行视为 trivial
  // VB/VBA 单引号注释
  if (VB_COMMENT_RE.test(content)) return true;
  // 单行注释前缀
  for (const prefix of COMMENT_LINE_PREFIXES) {
    if (trimmed.startsWith(prefix)) return true;
  }
  // 多行注释标记
  for (const re of COMMENT_BLOCK_MARKERS) {
    if (re.test(content)) return true;
  }
  return false;
}

/**
 * 判断 FileDiff 是否仅含注释变更（所有 add/delete 行均为纯注释行）。
 */
export function isOnlyCommentChange(diff: FileDiff): boolean {
  if (diff.hunks.length === 0) return false;
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add' || line.type === 'delete') {
        if (!isCommentLine(line.content)) return false;
      }
    }
  }
  return true;
}

/**
 * 判断 FileDiff 是否仅含格式变更（add/delete 行配对后，去除空白后内容一致）。
 *
 * 算法：对每个 hunk，将 delete 与 add 行分别收集；若两者数量相等且
 * 对应行去除所有空白字符后内容一致，则视为格式变更。
 * 若 delete/add 行数不等但全部为空白行，也视为格式变更。
 */
export function isOnlyFormatChange(diff: FileDiff): boolean {
  if (diff.hunks.length === 0) return false;
  for (const hunk of diff.hunks) {
    const deletes: string[] = [];
    const adds: string[] = [];
    for (const line of hunk.lines) {
      if (line.type === 'delete') deletes.push(line.content);
      else if (line.type === 'add') adds.push(line.content);
    }
    if (deletes.length === 0 && adds.length === 0) continue;
    if (deletes.length !== adds.length) {
      // 行数不等：仅当所有变更行均为空白时才视为格式变更
      const allWhitespace = [...deletes, ...adds].every((s) => s.trim() === '');
      if (!allWhitespace) return false;
      continue;
    }
    for (let i = 0; i < deletes.length; i++) {
      const d = deletes[i].replace(/\s+/g, '');
      const a = adds[i].replace(/\s+/g, '');
      if (d !== a) return false;
    }
  }
  return true;
}

/**
 * 判断单个 FileDiff 是否为 trivial change（空白/注释/格式之一）。
 * 互斥判定：优先 whitespace → comment → format。
 */
export function classifyDiff(diff: FileDiff): 'whitespace' | 'comment' | 'format' | 'substantive' {
  if (diff.hunks.length === 0) return 'substantive';
  if (isOnlyWhitespaceChange(diff)) return 'whitespace';
  if (isOnlyCommentChange(diff)) return 'comment';
  if (isOnlyFormatChange(diff)) return 'format';
  return 'substantive';
}

/**
 * 对解析后的 diff 执行预检。
 *
 * 判定规则：
 * - 0 文件变更：跳过（reason: "empty diff"）
 * - 所有文件均为 trivial change：跳过（reason 描述 trivial 类型分布）
 * - 存在非 trivial 文件：不跳过（reason 为空字符串）
 *
 * @param diffs 已解析的 FileDiff[]
 * @returns PreCheckResult
 */
export function performPreCheck(diffs: FileDiff[]): PreCheckResult {
  const stat = computeDiffStats(diffs);
  let whitespaceOnlyFiles = 0;
  let commentOnlyFiles = 0;
  let formatOnlyFiles = 0;
  let nonTrivialFiles = 0;

  for (const diff of diffs) {
    const cls = classifyDiff(diff);
    switch (cls) {
      case 'whitespace':
        whitespaceOnlyFiles++;
        break;
      case 'comment':
        commentOnlyFiles++;
        break;
      case 'format':
        formatOnlyFiles++;
        break;
      case 'substantive':
        nonTrivialFiles++;
        break;
    }
  }

  const trivialFiles = whitespaceOnlyFiles + commentOnlyFiles + formatOnlyFiles;

  const stats: PreCheckStats = {
    filesChanged: diffs.length,
    insertions: stat.insertions,
    deletions: stat.deletions,
    modifiedLines: stat.modifiedLines,
    whitespaceOnlyFiles,
    commentOnlyFiles,
    formatOnlyFiles,
    trivialFiles,
    nonTrivialFiles,
  };

  // 空输入
  if (diffs.length === 0) {
    return {
      shouldSkip: true,
      reason: 'empty diff',
      stats,
    };
  }

  // 所有文件均为 trivial
  if (nonTrivialFiles === 0) {
    const parts: string[] = [];
    if (whitespaceOnlyFiles > 0) parts.push(`${whitespaceOnlyFiles} whitespace-only`);
    if (commentOnlyFiles > 0) parts.push(`${commentOnlyFiles} comment-only`);
    if (formatOnlyFiles > 0) parts.push(`${formatOnlyFiles} format-only`);
    const reason = `trivial changes only (${parts.join(', ')})`;
    return {
      shouldSkip: true,
      reason,
      stats,
    };
  }

  return {
    shouldSkip: false,
    reason: '',
    stats,
  };
}
