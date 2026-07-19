import type { FileDiff, DiffLine } from './types.js';

/**
 * 将 unified diff 文本解析为 FileDiff[]。
 */
export function parseDiff(diffText: string): FileDiff[] {
  if (!diffText || diffText.trim() === '') {
    return [];
  }

  const diffs: FileDiff[] = [];
  const lines = diffText.split('\n');
  let currentDiff: FileDiff | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 防御性跳过 combined diff (git diff --cc) 和 merge conflict format
    if (line.match(/^diff --cc /) || line.match(/^diff --combined /)) {
      // Skip until next diff --git or end
      i++;
      while (i < lines.length && !lines[i].match(/^diff --git /)) {
        i++;
      }
      continue;
    }

    // diff --git a/path b/path
    const gitMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (gitMatch) {
      if (currentDiff) {
        diffs.push(currentDiff);
      }
      const newPath = gitMatch[2];
      currentDiff = {
        path: newPath,
        status: 'modified',
        hunks: [],
      };
      i++;
      continue;
    }

    // new file
    if (line.match(/^new file/)) {
      if (currentDiff) currentDiff.status = 'added';
      i++;
      continue;
    }

    // deleted file
    if (line.match(/^deleted file/)) {
      if (currentDiff) currentDiff.status = 'deleted';
      i++;
      continue;
    }

    // rename / copy — 防御多行路径（极端情况）
    const renameMatch = line.match(/^rename (?:to|from) (.+)$/);
    if (renameMatch && currentDiff) {
      if (line.startsWith('rename from')) {
        currentDiff.oldPath = renameMatch[1];
      }
      i++;
      continue;
    }

    // binary file
    if (line.match(/^Binary files/)) {
      if (currentDiff) currentDiff.binary = true;
      i++;
      continue;
    }

    // old mode / new mode
    const oldModeMatch = line.match(/^old mode (\d+)$/);
    if (oldModeMatch && currentDiff) {
      currentDiff.oldMode = oldModeMatch[1];
      i++;
      continue;
    }
    const newModeMatch = line.match(/^new mode (\d+)$/);
    if (newModeMatch && currentDiff) {
      currentDiff.newMode = newModeMatch[1];
      i++;
      continue;
    }

    // similarity index
    const similarityMatch = line.match(/^similarity index (\d+)%$/);
    if (similarityMatch && currentDiff) {
      currentDiff.similarity = parseInt(similarityMatch[1], 10);
      i++;
      continue;
    }

    // dissimilarity index (rename with changes)
    const dissimilarityMatch = line.match(/^dissimilarity index (\d+)%$/);
    if (dissimilarityMatch && currentDiff) {
      currentDiff.similarity = 100 - parseInt(dissimilarityMatch[1], 10);
      i++;
      continue;
    }

    // copy from/to (Git copy detection)
    const copyFromMatch = line.match(/^copy from (.+)$/);
    if (copyFromMatch && currentDiff) {
      currentDiff.oldPath = copyFromMatch[1];
      currentDiff.copied = true;
      i++;
      continue;
    }
    const copyToMatch = line.match(/^copy to (.+)$/);
    if (copyToMatch && currentDiff) {
      i++;
      continue;
    }

    // --- a/path and +++ b/path — skip file header lines (including /dev/null)
    // Match lines starting with exactly "--- " or "+++ " where the content looks like a file path
    const filePathHeader = line.match(/^(---|\+\+\+) (.+)$/);
    if (filePathHeader && currentDiff) {
      // If not inside a hunk, these are file headers, skip them
      if (currentDiff.hunks.length === 0) {
        i++;
        continue;
      }
    }

    // hunk header @@ -oldStart,oldCount +newStart,newCount @@ context
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@\s*(.*)/);
    if (hunkMatch && currentDiff) {
      const hunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newCount: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
        header: hunkMatch[5] ?? '',
        lines: [] as import('./types.js').DiffLine[],
      };
      currentDiff.hunks.push(hunk);
      i++;
      continue;
    }

    // diff content lines
    if (currentDiff && currentDiff.hunks.length > 0) {
      const hunk = currentDiff.hunks[currentDiff.hunks.length - 1];
      if (line.startsWith('+')) {
        hunk.lines.push({ type: 'add', content: line.substring(1) });
      } else if (line.startsWith('-')) {
        hunk.lines.push({ type: 'delete', content: line.substring(1) });
      } else if (line.startsWith(' ') || line === '') {
        hunk.lines.push({ type: 'context', content: line.substring(1) });
      } else if (line.startsWith('\\')) {
        // "No newline at end of file" - skip
      }
    }

    i++;
  }

  if (currentDiff) {
    if (currentDiff.oldPath && currentDiff.path !== currentDiff.oldPath) {
      currentDiff.status = 'renamed';
    }
    diffs.push(currentDiff);
  }

  // Post-process: compute line numbers for each hunk
  for (const fileDiff of diffs) {
    for (const hunk of fileDiff.hunks) {
      let oldLine = hunk.oldStart;
      let newLine = hunk.newStart;
      for (const dl of hunk.lines) {
        if (dl.type === 'context') {
          dl.oldLineNumber = oldLine;
          dl.newLineNumber = newLine;
          oldLine++;
          newLine++;
        } else if (dl.type === 'delete') {
          dl.oldLineNumber = oldLine;
          oldLine++;
        } else if (dl.type === 'add') {
          dl.newLineNumber = newLine;
          newLine++;
        }
      }
    }
  }

  return diffs;
}

/**
 * 通过调用 git diff 命令获取 diff 并解析。
 */
export async function parseDiffFromGit(options: {
  from?: string;
  to?: string;
  cached?: boolean;
  path?: string[];
} = {}): Promise<FileDiff[]> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  const args: string[] = ['diff'];
  if (options.cached) args.push('--cached');
  if (options.from) {
    args.push(options.from);
    if (options.to) args.push(options.to);
  }
  if (options.path) args.push('--', ...options.path);

  const { stdout } = await execFileAsync('git', args, {
    maxBuffer: 50 * 1024 * 1024,
  });

  return parseDiff(stdout);
}

/**
 * 获取 hunk 中的上下文行（type 为 'context' 的行）。
 * @param hunk - 目标 hunk
 * @param contextLines - 最多返回多少行上下文，默认返回全部
 */
export function getHunkContext(hunk: import('./types.js').Hunk, contextLines?: number): import('./types.js').DiffLine[] {
  const contextLinesList = hunk.lines.filter((l) => l.type === 'context');
  if (contextLines === undefined) {
    return contextLinesList;
  }
  return contextLinesList.slice(0, contextLines);
}

/**
 * 计算 diff 统计信息。
 */
export function computeDiffStats(diffs: FileDiff[]): {
  filesChanged: number;
  insertions: number;
  deletions: number;
  modifiedLines: number;
} {
  let insertions = 0;
  let deletions = 0;

  for (const diff of diffs) {
    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'add') insertions++;
        else if (line.type === 'delete') deletions++;
      }
    }
  }

  return {
    filesChanged: diffs.length,
    insertions,
    deletions,
    modifiedLines: insertions + deletions,
  };
}

/**
 * 获取变更文件列表，返回简单的 {path, status}[]。
 */
export function getChangedFiles(diffs: FileDiff[]): { path: string; status: string }[] {
  return diffs.map((d) => ({ path: d.path, status: d.status }));
}

/**
 * 获取 diff 中所有新增行。
 */
export function getAdditions(diff: FileDiff): DiffLine[] {
  const result: DiffLine[] = [];
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') result.push(line);
    }
  }
  return result;
}

/**
 * 解析 `git diff --stat` 输出。
 * 返回 { path, insertions, deletions } 数组。
 */
export function parseDiffStat(statText: string): { path: string; insertions: number; deletions: number }[] {
  if (!statText || statText.trim() === '') return [];
  const results: { path: string; insertions: number; deletions: number }[] = [];
  const lines = statText.trim().split('\n');

  for (const line of lines) {
    // Match patterns like: src/file.ts | 10 +++++-----  or  src/other.js |  3 ++-
    const match = line.match(/^\s*(.+?)\s*\|\s*(\d+)\s*([+-]+)?\s*$/);
    if (match) {
      const path = match[1].trim();
      const totalChanges = parseInt(match[2], 10);
      const changeStr = match[3] ?? '';
      const plusCount = (changeStr.match(/\+/g) || []).length;
      const minusCount = (changeStr.match(/-/g) || []).length;
      results.push({
        path,
        insertions: plusCount > 0 ? plusCount : Math.max(0, totalChanges - minusCount),
        deletions: minusCount,
      });
    }
  }

  return results;
}

/**
 * 按路径模式过滤 FileDiff 数组。
 */
export function filterDiffsByPath(diffs: FileDiff[], pathPattern: string): FileDiff[] {
  const regex = new RegExp(pathPattern);
  return diffs.filter((d) => regex.test(d.path));
}

/** ANSI 转义码正则 */
const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

/**
 * 清理文本中可能存在的 ANSI 转义码。
 */
export function stripAnsiEscapes(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '');
}

/**
 * 判断 diff 是否仅包含空白字符变更。
 */
export function isOnlyWhitespaceChange(diff: FileDiff): boolean {
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add' || line.type === 'delete') {
        if (line.content.trim().length > 0) return false;
      }
    }
  }
  return diff.hunks.length > 0;
}

/**
 * 判断 diff 是否有显著变更（变更行数超过阈值）。
 * @param diff - 文件 diff
 * @param threshold - 阈值，默认 10
 */
export function hasSignificantChanges(diff: FileDiff, threshold: number = 10): boolean {
  let changes = 0;
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add' || line.type === 'delete') changes++;
    }
  }
  return changes > threshold;
}

/**
 * 获取 diff 中所有删除行。
 */
export function getDeletions(diff: FileDiff): DiffLine[] {
  const result: DiffLine[] = [];
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'delete') result.push(line);
    }
  }
  return result;
}

/**
 * 计算单个文件 diff 的字符数（所有 hunk 行内容长度之和）。
 */
export function getPatchSize(diff: FileDiff): number {
  let total = 0;
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      total += line.content.length;
    }
  }
  return total;
}

/**
 * 合并两个 FileDiff 数组，相同路径的文件合并 hunks。
 */
export function mergeDiffs(diffs1: FileDiff[], diffs2: FileDiff[]): FileDiff[] {
  const result: FileDiff[] = [];
  const pathMap = new Map<string, FileDiff>();

  for (const d of diffs1) {
    const clone: FileDiff = { ...d, hunks: [...d.hunks] };
    pathMap.set(d.path, clone);
    result.push(clone);
  }

  for (const d of diffs2) {
    const existing = pathMap.get(d.path);
    if (existing) {
      existing.hunks.push(...d.hunks);
    } else {
      const clone: FileDiff = { ...d, hunks: [...d.hunks] };
      pathMap.set(d.path, clone);
      result.push(clone);
    }
  }

  return result;
}