// src/utils.ts — 通用工具函数

/**
 * 将文本转换为 slug 格式（URL 友好）。
 * - 转为小写
 * - 移除非字母数字和中文字符（用连字符替换）
 * - 连续连字符合并为一个
 * - 去除首尾连字符
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]+/g, '')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

/**
 * 截断字符串到最大长度，超出部分用 suffix 代替。
 * 如果字符串长度不超过 maxLen，直接返回原字符串。
 */
export function truncateString(str: string, maxLen: number, suffix: string = '...'): string {
  if (maxLen < 0) return '';
  if (str.length <= maxLen) return str;
  const suffixLen = suffix.length;
  if (suffixLen >= maxLen) return suffix.substring(0, maxLen);
  return str.substring(0, maxLen - suffixLen) + suffix;
}

// ==================== 文件类型辅助函数 ====================

/** 判断文件是否为 C 文件（.c, .h） */
export function isCFile(path: string): boolean {
  return /\.(c|h)$/i.test(path);
}

/** 判断文件是否为 C++ 文件（.cpp, .hpp, .cc, .cxx, .ixx, .cppm, .ccm, .cxxm） */
export function isCppFile(path: string): boolean {
  return /\.(cpp|hpp|cc|cxx|ixx|cppm|ccm|cxxm)$/i.test(path);
}

/** 判断文件是否为测试文件 */
export function isTestFile(path: string): boolean {
  const name = path.split('/').pop() ?? path;
  return /\.(test|spec)\.(ts|js|tsx|jsx|py|java|go|rs)$/i.test(name) ||
    name.includes('.test.') ||
    name.includes('.spec.');
}

/** 判断文件是否为生成文件（路径含 generated/gen 或匹配常见生成文件模式） */
export function isGeneratedFile(path: string): boolean {
  const name = path.split('/').pop() ?? path;
  const pathLower = path.toLowerCase();
  if (pathLower.includes('/generated/') || pathLower.includes('/gen/')) return true;
  // Also match files whose parent directory is named "generated"
  const parts = pathLower.split('/');
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === 'generated' || parts[i] === 'gen') return true;
  }
  return /\.(pb\.go|pb\.rs|generated\.\w+|\.g\.ts|\.generated\.\w+)$/i.test(name);
}

// ==================== 严重度辅助函数 ====================

/** 将 severity 字符串转换为排序用的数值（critical=4, high=3, medium=2, low=1, info=0） */
export function severityOrder(s: string): number {
  switch (s.toLowerCase()) {
    case 'critical': return 4;
    case 'high': return 3;
    case 'medium': return 2;
    case 'low': return 1;
    case 'info': return 0;
    default: return -1;
  }
}

/** 格式化 severity 字符串（首字母大写 + 括号图标） */
export function formatSeverity(s: string): string {
  const icons: Record<string, string> = {
    critical: '[!!!]',
    high: '[!!]',
    medium: '[!]',
    low: '[i]',
    info: '[.]',
  };
  const key = s.toLowerCase();
  const icon = icons[key] ?? '[?]';
  return `${s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()} ${icon}`;
}
