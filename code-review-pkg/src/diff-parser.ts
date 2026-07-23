import type { FileDiff, DiffLine, Hunk } from './types.js';

const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

const RE_DIFF_GIT = /^diff --git a\/(.+?) b\/(.+)$/;
const RE_DIFF_CC = /^diff --cc |^diff --combined /;
const RE_NEW_FILE = /^new file/;
const RE_DELETED_FILE = /^deleted file/;
const RE_RENAME = /^rename (?:to|from) (.+)$/;
const RE_BINARY = /^Binary files/;
const RE_OLD_MODE = /^old mode (\d+)$/;
const RE_NEW_MODE = /^new mode (\d+)$/;
const RE_SIMILARITY = /^similarity index (\d+)%$/;
const RE_DISSIMILARITY = /^dissimilarity index (\d+)%$/;
const RE_COPY_FROM = /^copy from (.+)$/;
const RE_COPY_TO = /^copy to (.+)$/;
const RE_FILE_HEADER = /^(---|\+\+\+) (.+)$/;
const RE_HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@\s*(.*)/;

function filterLinesByType(hunk: Hunk, type: DiffLine['type']): DiffLine[] {
  return hunk.lines.filter((l) => l.type === type);
}

function countLinesByType(diff: FileDiff, type: 'add' | 'delete'): number {
  let count = 0;
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.type === type) count++;
    }
  }
  return count;
}

function computeLineNumbers(hunks: Hunk[]): void {
  for (const hunk of hunks) {
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

function createFileDiff(path: string): FileDiff {
  return {
    path,
    status: 'modified',
    hunks: [],
  };
}

function createHunk(match: RegExpMatchArray): Hunk {
  return {
    oldStart: parseInt(match[1], 10),
    oldCount: match[2] ? parseInt(match[2], 10) : 1,
    newStart: parseInt(match[3], 10),
    newCount: match[4] ? parseInt(match[4], 10) : 1,
    header: match[5] ?? '',
    lines: [],
  };
}

function skipCombinedDiff(lines: string[], i: number): number {
  i++;
  while (i < lines.length && !lines[i].startsWith('diff --git ')) {
    i++;
  }
  return i;
}

function finalizeDiff(diff: FileDiff): void {
  if (diff.oldPath && diff.path !== diff.oldPath) {
    diff.status = 'renamed';
  }
}

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

    if (RE_DIFF_CC.test(line)) {
      i = skipCombinedDiff(lines, i);
      continue;
    }

    const gitMatch = line.match(RE_DIFF_GIT);
    if (gitMatch) {
      if (currentDiff) {
        diffs.push(currentDiff);
      }
      currentDiff = createFileDiff(gitMatch[2]);
      i++;
      continue;
    }

    if (!currentDiff) {
      i++;
      continue;
    }

    if (RE_NEW_FILE.test(line)) {
      currentDiff.status = 'added';
      i++;
      continue;
    }

    if (RE_DELETED_FILE.test(line)) {
      currentDiff.status = 'deleted';
      i++;
      continue;
    }

    const renameMatch = line.match(RE_RENAME);
    if (renameMatch) {
      if (line.startsWith('rename from')) {
        currentDiff.oldPath = renameMatch[1];
      }
      i++;
      continue;
    }

    if (RE_BINARY.test(line)) {
      currentDiff.binary = true;
      i++;
      continue;
    }

    const oldModeMatch = line.match(RE_OLD_MODE);
    if (oldModeMatch) {
      currentDiff.oldMode = oldModeMatch[1];
      i++;
      continue;
    }

    const newModeMatch = line.match(RE_NEW_MODE);
    if (newModeMatch) {
      currentDiff.newMode = newModeMatch[1];
      i++;
      continue;
    }

    const similarityMatch = line.match(RE_SIMILARITY);
    if (similarityMatch) {
      currentDiff.similarity = parseInt(similarityMatch[1], 10);
      i++;
      continue;
    }

    const dissimilarityMatch = line.match(RE_DISSIMILARITY);
    if (dissimilarityMatch) {
      currentDiff.similarity = 100 - parseInt(dissimilarityMatch[1], 10);
      i++;
      continue;
    }

    const copyFromMatch = line.match(RE_COPY_FROM);
    if (copyFromMatch) {
      currentDiff.oldPath = copyFromMatch[1];
      currentDiff.copied = true;
      i++;
      continue;
    }

    if (RE_COPY_TO.test(line)) {
      i++;
      continue;
    }

    if (RE_FILE_HEADER.test(line) && currentDiff.hunks.length === 0) {
      i++;
      continue;
    }

    const hunkMatch = line.match(RE_HUNK_HEADER);
    if (hunkMatch) {
      currentDiff.hunks.push(createHunk(hunkMatch));
      i++;
      continue;
    }

    if (currentDiff.hunks.length > 0) {
      const hunk = currentDiff.hunks[currentDiff.hunks.length - 1];
      if (line.startsWith('+')) {
        hunk.lines.push({ type: 'add', content: line.substring(1) });
      } else if (line.startsWith('-')) {
        hunk.lines.push({ type: 'delete', content: line.substring(1) });
      } else if (line.startsWith(' ') || line === '') {
        hunk.lines.push({ type: 'context', content: line.substring(1) });
      }
    }

    i++;
  }

  if (currentDiff) {
    finalizeDiff(currentDiff);
    diffs.push(currentDiff);
  }

  for (const fileDiff of diffs) {
    computeLineNumbers(fileDiff.hunks);
  }

  return diffs;
}

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

export function getHunkContext(hunk: Hunk, contextLines?: number): DiffLine[] {
  const contextLinesList = filterLinesByType(hunk, 'context');
  if (contextLines === undefined) {
    return contextLinesList;
  }
  return contextLinesList.slice(0, contextLines);
}

export function computeDiffStats(diffs: FileDiff[]): {
  filesChanged: number;
  insertions: number;
  deletions: number;
  modifiedLines: number;
} {
  let insertions = 0;
  let deletions = 0;

  for (const diff of diffs) {
    insertions += countLinesByType(diff, 'add');
    deletions += countLinesByType(diff, 'delete');
  }

  return {
    filesChanged: diffs.length,
    insertions,
    deletions,
    modifiedLines: insertions + deletions,
  };
}

export function getChangedFiles(diffs: FileDiff[]): { path: string; status: string }[] {
  return diffs.map((d) => ({ path: d.path, status: d.status }));
}

export function getAdditions(diff: FileDiff): DiffLine[] {
  const result: DiffLine[] = [];
  for (const hunk of diff.hunks) {
    result.push(...filterLinesByType(hunk, 'add'));
  }
  return result;
}

export function getDeletions(diff: FileDiff): DiffLine[] {
  const result: DiffLine[] = [];
  for (const hunk of diff.hunks) {
    result.push(...filterLinesByType(hunk, 'delete'));
  }
  return result;
}

export function parseDiffStat(statText: string): { path: string; insertions: number; deletions: number }[] {
  if (!statText || statText.trim() === '') return [];
  const results: { path: string; insertions: number; deletions: number }[] = [];
  const lines = statText.trim().split('\n');

  for (const line of lines) {
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

export function filterDiffsByPath(diffs: FileDiff[], pathPattern: string): FileDiff[] {
  const regex = new RegExp(pathPattern);
  return diffs.filter((d) => regex.test(d.path));
}

export function stripAnsiEscapes(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '');
}

export function isOnlyWhitespaceChange(diff: FileDiff): boolean {
  if (diff.hunks.length === 0) return false;
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add' || line.type === 'delete') {
        if (line.content.trim().length > 0) return false;
      }
    }
  }
  return true;
}

export function hasSignificantChanges(diff: FileDiff, threshold: number = 10): boolean {
  let changes = 0;
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add' || line.type === 'delete') {
        changes++;
        if (changes > threshold) return true;
      }
    }
  }
  return changes > threshold;
}

export function getPatchSize(diff: FileDiff): number {
  let total = 0;
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      total += line.content.length;
    }
  }
  return total;
}

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
