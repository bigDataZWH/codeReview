import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileDiff, FileBundle, FilterConfig, BundleConfig, BundleRule } from './types.js';
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

const SPECIAL_FILE_LANGUAGE_MAP: Array<{ test: (name: string) => boolean; lang: string }> = [
  { test: (n) => n === 'dockerfile' || n.startsWith('dockerfile.'), lang: 'dockerfile' },
  { test: (n) => n === 'makefile' || n === 'gnumakefile', lang: 'makefile' },
  { test: (n) => n === 'jenkinsfile', lang: 'groovy' },
  { test: (n) => n === 'cmakelists.txt', lang: 'cmake' },
];

/**
 * 根据文件路径检测编程语言。
 * @param path - 文件路径
 * @returns 语言名称字符串，无法识别时返回 undefined
 */
export function detectLanguage(path: string): string | undefined {
  if (!path) return undefined;

  const fileName = path.split('/').pop() ?? '';
  const lowerFileName = fileName.toLowerCase();

  for (const { test, lang } of SPECIAL_FILE_LANGUAGE_MAP) {
    if (test(lowerFileName)) return lang;
  }

  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) return undefined;
  const ext = fileName.substring(lastDot).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext];
}

// ── 内部辅助函数 ──

/** 判断文件路径是否匹配 glob 模式 */
function matchesGlob(path: string, pattern: string): boolean {
  return globToRegex(pattern).test(path);
}

/** 计算 FileDiff 的 patch 总长度（所有 hunk lines 拼接） */
function getPatchLength(diff: FileDiff): number {
  return diff.hunks.reduce(
    (sum, h) => sum + h.lines.reduce((s, l) => s + l.content.length, 0),
    0,
  );
}

/** 从文件系统读取忽略模式文件并解析 */
async function loadIgnoreFile(rootDir: string, fileName: string, label: string): Promise<string[]> {
  try {
    const content = await readFile(join(rootDir, fileName), 'utf-8');
    return content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
  } catch (err) {
    console.warn(`[file-filter] ${label} failed to read ${fileName}:`, err);
    return [];
  }
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

  const allIgnorePatterns = [
    ...DEFAULT_IGNORE_PATTERNS,
    ...(config.ignorePatterns ?? []),
  ];

  const filtered = diffs.filter((diff) => {
    if (diff.binary && !config.includeBinary) {
      return false;
    }

    if (config.includeDeleted === false && diff.status === 'deleted') {
      return false;
    }

    if (config.language && config.language.length > 0) {
      const fileLang = detectLanguage(diff.path);
      if (!fileLang || !config.language.includes(fileLang)) {
        return false;
      }
    }

    if (config.maxPatchLength !== undefined) {
      if (getPatchLength(diff) > config.maxPatchLength) {
        return false;
      }
    }

    if (config.includePatterns && config.includePatterns.length > 0) {
      let included = false;
      for (const pat of config.includePatterns) {
        if (pat.startsWith('!')) {
          const negPat = pat.substring(1);
          if (matchesGlob(diff.path, negPat)) {
            included = false;
          }
        } else {
          if (matchesGlob(diff.path, pat)) {
            included = true;
          }
        }
      }
      if (!included) return false;
    }

    if (allIgnorePatterns.length > 0) {
      const ignored = allIgnorePatterns.some((pat) => matchesGlob(diff.path, pat));
      if (ignored) return false;
    }

    return true;
  });

  if (config.maxFiles !== undefined && filtered.length > config.maxFiles) {
    return filtered.slice(0, config.maxFiles);
  }

  return filtered;
}

// ── bundleFiles ──

interface CompiledBundleRule extends BundleRule {
  primaryRegex: RegExp;
}

function compileBundleRules(rules: BundleRule[]): CompiledBundleRule[] {
  return rules.map((rule) => ({
    ...rule,
    primaryRegex: new RegExp('^' + rule.pattern + '$'),
  }));
}

function resolveRelatedPattern(pattern: string, match: RegExpExecArray): string {
  let resolved = pattern;
  for (let g = 1; g < match.length; g++) {
    resolved = resolved.replace(new RegExp('\\$' + g, 'g'), match[g] ?? '');
  }
  return resolved;
}

export function bundleFiles(diffs: FileDiff[], config?: BundleConfig): FileBundle[] {
  if (diffs.length === 0) return [];

  const bundles: FileBundle[] = [];
  const bundled = new Set<number>();
  const compiledRules = compileBundleRules(config?.bundles ?? []);

  for (let i = 0; i < diffs.length; i++) {
    if (bundled.has(i)) continue;

    let matched = false;

    for (const rule of compiledRules) {
      const match = rule.primaryRegex.exec(diffs[i].path);

      if (match) {
        const relatedFiles: FileDiff[] = [];

        for (const relatedPattern of rule.related) {
          const resolvedPattern = resolveRelatedPattern(relatedPattern, match);
          const relatedRegex = new RegExp('^' + resolvedPattern + '$');

          for (let j = 0; j < diffs.length; j++) {
            if (j === i || bundled.has(j)) continue;
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
        break;
      }
    }

    if (!matched) {
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
  return [...diffs].sort((a, b) => getPatchLength(b) - getPatchLength(a));
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
export function loadGitignorePatterns(rootDir: string): Promise<string[]> {
  return loadIgnoreFile(rootDir, '.gitignore', 'loadGitignorePatterns');
}

/**
 * 从文件系统读取 .opencode-review-ignore 并返回忽略模式列表。
 * 如果文件不存在或不可读，返回空数组。
 */
export function loadReviewIgnorePatterns(rootDir: string): Promise<string[]> {
  return loadIgnoreFile(rootDir, '.opencode-review-ignore', 'loadReviewIgnorePatterns');
}
