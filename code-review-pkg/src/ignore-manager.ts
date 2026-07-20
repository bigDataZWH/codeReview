// src/ignore-manager.ts — .reviewignore 忽略管理器
//
// Task 2：实现忽略机制
//
// 文件格式参考 .gitignore，支持：
// - 文件路径模式：`dist/**`
// - 文件类型：`*.generated.ts`
// - 目录：`node_modules/`
// - 取反：`!important.ts`
// - 注释：以 `#` 开头
// - 空行跳过
// - 行首 `\#` 表示字面 `#`
//
// 匹配语义（与 .gitignore 对齐）：
// - 默认不忽略
// - 按规则出现顺序遍历，每条匹配规则更新"是否忽略"状态
// - 取反规则 (!) 将状态置为"不忽略"
// - 即"最后一条匹配的规则决定结果"
//
// 设计取舍：
// - 复用 src/glob.ts 的 globToRegex（与 file-filter.ts / feedback.ts 共用）
// - 模式不含 `/` 时自动前置 `**/`，使其匹配任意路径层级
// - 模式以 `/` 结尾时识别为目录规则，自动追加 `/**`
// - 模式以 `/` 开头时锚定到根（不再前置 `**/`）

import { existsSync, readFileSync } from 'node:fs';
import { globToRegex } from './glob.js';

/** 单条忽略规则（解析自 .reviewignore 的一行） */
export interface IgnorePattern {
  /** 原始模式字符串（已去除 ! 前缀，已去除尾部 /） */
  pattern: string;
  /** 是否为取反规则（! 前缀） */
  negate: boolean;
  /** 编译后的正则表达式（已锚定 ^...$） */
  regex: RegExp;
}

/** 忽略配置：一组有序的忽略规则 */
export interface IgnoreConfig {
  /** 按出现顺序排列的规则列表 */
  patterns: IgnorePattern[];
  /** 配置文件路径（可选；用于调试与日志） */
  source?: string;
}

/**
 * 加载 `.reviewignore` 文件并解析为 IgnoreConfig。
 *
 * @param configPath `.reviewignore` 文件路径
 * @returns 解析后的 IgnoreConfig
 * @throws 当 configPath 为空或文件不存在时抛出错误
 */
export function loadIgnoreConfig(configPath: string): IgnoreConfig {
  if (!configPath || !existsSync(configPath)) {
    throw new Error(`ignore config file not found: ${configPath}`);
  }
  const text = readFileSync(configPath, 'utf8');
  return parseIgnoreContent(text, configPath);
}

/**
 * 解析 `.reviewignore` 文本内容为 IgnoreConfig。
 *
 * 行级规则：
 * - 空行跳过
 * - `#` 开头的注释行跳过
 * - `\#` 开头的行视为字面 `#` 开头的模式
 * - `!` 前缀标记为取反规则
 * - 其他行作为普通 glob 模式
 *
 * @param text `.reviewignore` 文件内容
 * @param source 配置来源路径（可选，附加在返回结果上便于追踪）
 * @returns 解析后的 IgnoreConfig
 */
export function parseIgnoreContent(text: string, source?: string): IgnoreConfig {
  const patterns: IgnorePattern[] = [];
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    let negate = false;
    let pattern = line;
    if (pattern.startsWith('!')) {
      negate = true;
      pattern = pattern.substring(1);
    }
    // 转义 `\#` → `#`（与 .gitignore 一致）
    if (pattern.startsWith('\\#')) {
      pattern = pattern.substring(1);
    }
    // 处理 `\!` → `!`（避免被识别为取反前缀）
    if (pattern.startsWith('\\!')) {
      pattern = pattern.substring(1);
    }
    if (pattern === '') continue;

    // 规范化：去除尾部 /（目录标记），由 regex 编译时处理目录语义
    let normalizedPattern = pattern;
    if (normalizedPattern.endsWith('/') && normalizedPattern.length > 1) {
      normalizedPattern = normalizedPattern.slice(0, -1);
    }

    patterns.push({
      pattern: normalizedPattern,
      negate,
      regex: compileIgnoreRegex(pattern),
    });
  }
  return { patterns, source };
}

/**
 * 将 .reviewignore 模式编译为正则表达式。
 *
 * 规则：
 * - 模式以 / 结尾：识别为目录规则，去除尾部 / 后追加递归通配
 * - 模式以 / 开头：锚定到根，去除前导 / 后不再前置任意路径前缀
 * - 模式不含 /（去除首尾 / 后）：前置任意路径前缀使其匹配任意路径层级
 * - 其他：原样使用 glob 语法
 * - 非目录模式额外允许匹配 entry 内的文件（即 entry 后跟 /...），
 *   与 .gitignore "匹配目录时其下所有文件也被忽略" 的语义一致
 *
 * @param pattern 已去除 ! 前缀的模式字符串（保留尾部 / 用于识别目录规则）
 * @returns 锚定的正则表达式
 */
function compileIgnoreRegex(pattern: string): RegExp {
  let p = pattern;

  let isDirectory = false;
  if (p.endsWith('/')) {
    isDirectory = true;
    p = p.slice(0, -1);
  }

  let anchored = false;
  if (p.startsWith('/')) {
    anchored = true;
    p = p.slice(1);
  }

  if (p === '') return /^$/;

  let fullPattern = p;
  // 不含 / 且未锚定时，前置双星号前缀匹配任意路径层级
  if (!anchored && !p.includes('/')) {
    fullPattern = `**/${p}`;
  }
  if (isDirectory) {
    fullPattern = `${fullPattern}/**`;
    return globToRegex(fullPattern);
  }
  // 非目录模式：允许匹配 entry 本身或 entry 内的文件
  // 例如 /build 既能匹配 build，也能匹配 build/output.js
  // 通过修改正则尾部：将 ...$ 改为 ...(/.*)?$ 实现
  const base = globToRegex(fullPattern);
  const src = base.source;
  if (src.startsWith('^') && src.endsWith('$')) {
    return new RegExp(src.slice(0, -1) + '(/.*)?$');
  }
  return base;
}

/**
 * 判断单个文件路径是否应被忽略。
 *
 * 应用 .gitignore 语义：
 * - 默认不忽略
 * - 按顺序遍历规则，每条匹配规则更新"是否忽略"状态
 * - 取反规则 (!) 将状态置为"不忽略"
 * - 即"最后一条匹配的规则决定结果"
 *
 * @param filePath 文件路径（相对路径，使用 `/` 作为分隔符）
 * @param config 忽略配置
 * @returns true 表示应忽略
 */
export function shouldIgnore(filePath: string, config: IgnoreConfig): boolean {
  if (!config?.patterns || config.patterns.length === 0) return false;
  if (typeof filePath !== 'string' || filePath === '') return false;
  let ignored = false;
  for (const pattern of config.patterns) {
    if (pattern.regex.test(filePath)) {
      ignored = !pattern.negate;
    }
  }
  return ignored;
}

/**
 * 应用忽略规则到 findings 列表，过滤掉被忽略文件的 finding。
 *
 * 输入约束：findings 中的每个元素必须含 `file: string` 字段。
 * 不修改原数组，返回新数组。
 *
 * @param findings 待过滤的 findings
 * @param config 忽略配置
 * @returns 过滤后的 findings（不含被忽略文件的 finding）
 */
export function applyIgnoreRules<F extends { file: string }>(
  findings: F[],
  config: IgnoreConfig,
): F[] {
  if (!config?.patterns || config.patterns.length === 0) return findings;
  if (!Array.isArray(findings) || findings.length === 0) return findings;
  return findings.filter((f) => !shouldIgnore(f.file, config));
}
