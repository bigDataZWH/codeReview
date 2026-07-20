import type { FileDiff, FileBundle, FilterConfig, BundleConfig } from './types.js';
import { globToRegex } from './glob.js';

// ── 扩展名 -> 语言映射 ──

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.r': 'r',
  '.R': 'r',
  '.scala': 'scala',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.fish': 'shell',
  '.ps1': 'powershell',
  '.sql': 'sql',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'scss',
  '.less': 'less',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.dart': 'dart',
  '.lua': 'lua',
  '.pl': 'perl',
  '.pm': 'perl',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hrl': 'erlang',
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.hs': 'haskell',
  '.lhs': 'haskell',
  '.ml': 'ocaml',
  '.mli': 'ocaml',
  '.fs': 'fsharp',
  '.fsi': 'fsharp',
  '.zig': 'zig',
  '.nim': 'nim',
  '.v': 'v',
  '.tf': 'hcl',
  '.hcl': 'hcl',
  '.dockerfile': 'dockerfile',
  '.proto': 'protobuf',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.pyi': 'python',
  '.pyd': 'python',
  '.ipynb': 'jupyter',
  '.makefile': 'makefile',
};

/**
 * 根据文件路径检测编程语言。
 * @param path - 文件路径
 * @returns 语言名称字符串，无法识别时返回 undefined
 */
export function detectLanguage(path: string): string | undefined {
  // 特殊文件名检测（如 Dockerfile, Makefile）
  const fileName = path.split('/').pop() ?? '';
  const lowerFileName = fileName.toLowerCase();
  if (lowerFileName === 'dockerfile' || lowerFileName.startsWith('dockerfile.')) {
    return 'dockerfile';
  }
  if (lowerFileName === 'makefile' || lowerFileName === 'gnumakefile') {
    return 'makefile';
  }
  if (lowerFileName === 'jenkinsfile') {
    return 'groovy';
  }
  if (lowerFileName === 'cmakelists.txt') {
    return 'cmake';
  }

  // 扩展名检测
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) return undefined;
  const ext = fileName.substring(lastDot).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext];
}

// ── 手写 glob 匹配器 ──
// 实现：见 src/glob.ts（与 feedback.ts 共用）

/** 判断文件路径是否匹配 glob 模式 */
function matchesGlob(path: string, pattern: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(path);
}

// ── 默认忽略模式 ──

const DEFAULT_IGNORE_PATTERNS = [
  '**/*.min.js',
  '**/*.min.css',
  '**/*.bundle.js',
];

// ── filterFiles ──

export function filterFiles(diffs: FileDiff[], config: FilterConfig): FileDiff[] {
  if (diffs.length === 0) return [];

  // 合并默认忽略模式和用户配置的忽略模式
  const allIgnorePatterns = [
    ...DEFAULT_IGNORE_PATTERNS,
    ...(config.ignorePatterns ?? []),
  ];

  const filtered = diffs.filter((diff) => {
    // 二进制文件默认排除
    if (diff.binary && !config.includeBinary) {
      return false;
    }

    // includeDeleted 过滤（默认 true，false 时排除 deleted 文件）
    if (config.includeDeleted === false && diff.status === 'deleted') {
      return false;
    }

    // language 过滤
    if (config.language && config.language.length > 0) {
      const fileLang = detectLanguage(diff.path);
      if (!fileLang || !config.language.includes(fileLang)) {
        return false;
      }
    }

    // maxPatchLength 检查：计算所有 hunk lines 的总字符数
    if (config.maxPatchLength !== undefined) {
      const patchLen = diff.hunks.reduce(
        (sum, h) => sum + h.lines.reduce((s, l) => s + l.content.length, 0),
        0,
      );
      if (patchLen > config.maxPatchLength) {
        return false;
      }
    }

    // include 模式过滤（支持 ! 否定模式）
    if (config.includePatterns && config.includePatterns.length > 0) {
      // 将 includePatterns 分为肯定和否定两组
      let included = false;
      for (const pat of config.includePatterns) {
        if (pat.startsWith('!')) {
          // 否定模式：如果匹配则排除
          const negPat = pat.substring(1);
          if (matchesGlob(diff.path, negPat)) {
            included = false;
          }
        } else {
          // 肯定模式：如果匹配则包含
          if (matchesGlob(diff.path, pat)) {
            included = true;
          }
        }
      }
      if (!included) return false;
    }

    // ignore 模式过滤（优先级高于 include）
    if (allIgnorePatterns.length > 0) {
      const ignored = allIgnorePatterns.some((pat) => matchesGlob(diff.path, pat));
      if (ignored) return false;
    }

    return true;
  });

  // maxFiles 截断
  if (config.maxFiles !== undefined && filtered.length > config.maxFiles) {
    return filtered.slice(0, config.maxFiles);
  }

  return filtered;
}

// ── bundleFiles ──

export function bundleFiles(diffs: FileDiff[], config?: BundleConfig): FileBundle[] {
  if (diffs.length === 0) return [];

  const bundles: FileBundle[] = [];
  const bundled = new Set<number>(); // 已被打包的文件索引

  const rules = config?.bundles ?? [];

  for (let i = 0; i < diffs.length; i++) {
    if (bundled.has(i)) continue;

    let matched = false;

    for (const rule of rules) {
      const primaryRegex = new RegExp('^' + rule.pattern + '$');
      const match = primaryRegex.exec(diffs[i].path);

      if (match) {
        // 找到 related 文件
        const relatedFiles: FileDiff[] = [];

        for (const relatedPattern of rule.related) {
          // 将 related pattern 中的 $1, $2 等替换为捕获组内容
          let resolvedPattern = relatedPattern;
          for (let g = 1; g < match.length; g++) {
            resolvedPattern = resolvedPattern.replace(new RegExp('\\$' + g, 'g'), match[g] ?? '');
          }

          // 在剩余文件中查找匹配 resolvedPattern 的文件
          for (let j = 0; j < diffs.length; j++) {
            if (j === i || bundled.has(j)) continue;
            const relatedRegex = new RegExp('^' + resolvedPattern + '$');
            if (relatedRegex.test(diffs[j].path)) {
              relatedFiles.push(diffs[j]);
              bundled.add(j);
            }
          }
        }

        bundles.push({
          id: `${rule.name}:${diffs[i].path}`,
          primary: diffs[i],
          related: relatedFiles,
          annotations: [],
        });

        bundled.add(i);
        matched = true;
        break; // 一个文件只匹配第一个规则
      }
    }

    if (!matched) {
      // 无匹配规则，独立 bundle
      bundles.push({
        id: diffs[i].path,
        primary: diffs[i],
        related: [],
        annotations: [],
      });
    }
  }

  return bundles;
}

// ── groupByDirectory ──

/**
 * 按目录分组变更文件。
 * 返回 Map<目录路径, FileDiff[]>。
 */
export function groupByDirectory(diffs: FileDiff[]): Map<string, FileDiff[]> {
  const groups = new Map<string, FileDiff[]>();
  for (const diff of diffs) {
    const parts = diff.path.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    const group = groups.get(dir);
    if (group) {
      group.push(diff);
    } else {
      groups.set(dir, [diff]);
    }
  }
  return groups;
}

/**
 * 检测并过滤含 @generated 标记的文件（检查 diff 中的行内容）。
 * 如果文件 diff 的任何上下文行或新增行包含 @generated 标记，则排除。
 */
export function excludeGeneratedFiles(diffs: FileDiff[]): FileDiff[] {
  return diffs.filter((diff) => {
    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        if ((line.type === 'context' || line.type === 'add') &&
            /@generated/i.test(line.content)) {
          return false;
        }
      }
    }
    return true;
  });
}

/**
 * 按_patch 字符数降序排列（大 patch 排前面，优先审查大变更）。
 */
export function sortByPatchSize(diffs: FileDiff[]): FileDiff[] {
  return [...diffs].sort((a, b) => {
    const sizeA = a.hunks.reduce((s, h) => s + h.lines.reduce((ls, l) => ls + l.content.length, 0), 0);
    const sizeB = b.hunks.reduce((s, h) => s + h.lines.reduce((ls, l) => ls + l.content.length, 0), 0);
    return sizeB - sizeA;
  });
}

/**
 * 统计变更文件的语言分布。
 */
export function getLanguageStats(diffs: FileDiff[]): { language: string; count: number }[] {
  const map = new Map<string, number>();
  for (const diff of diffs) {
    const lang = detectLanguage(diff.path) ?? 'unknown';
    map.set(lang, (map.get(lang) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([language, count]) => ({ language, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 从文件系统读取 .gitignore 并返回忽略模式列表。
 * 如果文件不存在或不可读，返回空数组。
 */
export async function loadGitignorePatterns(rootDir: string): Promise<string[]> {
  try {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const content = await readFile(join(rootDir, '.gitignore'), 'utf-8');
    return content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
  } catch (err) {
    console.warn('[file-filter] loadGitignorePatterns failed to read .gitignore:', err);
    return [];
  }
}

/**
 * 从文件系统读取 .opencode-review-ignore 并返回忽略模式列表。
 * 如果文件不存在或不可读，返回空数组。
 */
export async function loadReviewIgnorePatterns(rootDir: string): Promise<string[]> {
  try {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const content = await readFile(join(rootDir, '.opencode-review-ignore'), 'utf-8');
    return content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
  } catch (err) {
    console.warn('[file-filter] loadReviewIgnorePatterns failed to read .opencode-review-ignore:', err);
    return [];
  }
}
