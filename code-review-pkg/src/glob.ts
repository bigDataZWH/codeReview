// src/glob.ts — 共用 glob 转正则工具
//
// 合并自 file-filter.ts 与 feedback.ts 的本地 globToRegex 实现。
// 支持：* / ** / ? / 大括号 alternation 等标准 glob 语法。
//
// 设计取舍：
// - 不支持字符类 [abc]（与原有两个实现保持一致，[ ] 按字面值处理）
// - 双星号在结尾匹配任意剩余字符（含空串）；双星号加斜杠在中间匹配零或多个路径段
// - 正则被锚定到 ^ 与 $，确保完整匹配

/**
 * 将 glob 模式转换为正则表达式。
 *
 * 支持的 glob 语法：
 * - 单星号：匹配除 `/` 外的任意字符（单段通配）
 * - 双星号：跨目录通配；后跟斜杠时表示匹配零或多个路径段
 * - 问号：匹配单个非 `/` 字符
 * - 大括号 alternation（如 "ts,js" 包裹在花括号中）匹配其中任一选项，自动转义内部特殊字符
 * - 其他字符按字面值处理，正则特殊字符自动转义
 *
 * @param pattern glob 模式字符串
 * @returns 锚定的正则表达式（^...$）
 */
export function globToRegex(pattern: string): RegExp {
  let regex = '';
  let i = 0;
  const len = pattern.length;

  while (i < len) {
    const ch = pattern[i];

    if (ch === '*') {
      if (i + 1 < len && pattern[i + 1] === '*') {
        i += 2;
        // 跳过后续的 /
        if (i < len && pattern[i] === '/') {
          i++;
        }
        if (i >= len) {
          // 双星号在结尾：匹配所有剩余内容（含空串）
          regex += '.*';
        } else {
          // 双星号加斜杠后跟内容：匹配零或多个路径段，再跟一个 /
          regex += '(?:(?:[^/]*(?:/(?:[^/]*))*)/)?';
        }
      } else {
        // 单星号匹配除 / 外的任意字符
        regex += '[^/]*';
        i++;
      }
    } else if (ch === '?') {
      // 问号匹配单个非 / 字符
      regex += '[^/]';
      i++;
    } else if (ch === '{') {
      // 大括号 alternation：{a,b} 匹配 a 或 b
      const end = pattern.indexOf('}', i);
      if (end === -1) {
        regex += '\\{';
        i++;
      } else {
        const inner = pattern.substring(i + 1, end);
        const options = inner.split(',');
        regex += '(?:' + options.map(escapeRegex).join('|') + ')';
        i = end + 1;
      }
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      regex += '\\' + ch;
      i++;
    } else {
      regex += ch;
      i++;
    }
  }

  return new RegExp('^' + regex + '$');
}

function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}
