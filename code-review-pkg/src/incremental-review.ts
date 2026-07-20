// src/incremental-review.ts — 增量审查能力
//
// 基于 StateStore 同款思路持久化上次审查的 findings 和文件内容哈希，
// 仅对当前变更文件执行审查，合并旧 findings（未变更文件）与新 findings。
//
// 设计取舍：
// - 状态文件采用纯 JSON，避免原生依赖
// - 文件哈希基于 FileDiff 内容（path + status + 所有 hunk 行），
//   不依赖工作区实际文件内容，便于在 diff 输入层面判定变更
// - loadLastReviewState 支持两种来源：独立 stateFile 或 StateStore + sessionId

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { FileDiff, Finding } from './types.js';
import type { StateStore } from './state.js';

/** 增量审查状态文件结构 */
export interface IncrementalReviewState {
  /** 状态文件版本 */
  version: 1;
  /** 上次审查时间戳（ms） */
  lastReviewedAt: number;
  /** 文件路径 -> 内容哈希 */
  fileHashes: Record<string, string>;
  /** 上次审查保存的 findings */
  findings: Finding[];
}

/** loadLastReviewState 选项 */
export interface LoadLastReviewStateOptions {
  /** 独立状态文件路径；优先级高于 store+sessionId */
  stateFile?: string;
  /** StateStore 实例（可选） */
  store?: StateStore;
  /** 会话 ID（可选，配合 store 使用，从指定会话读取 findings） */
  sessionId?: string;
}

/** loadLastReviewState 返回结果 */
export interface LoadLastReviewStateResult {
  /** 上次审查时间戳；无历史返回 0 */
  lastReviewedAt: number;
  /** 文件路径 -> 内容哈希；无历史返回空对象 */
  fileHashes: Record<string, string>;
  /** 上次审查的 findings；无历史返回空数组 */
  findings: Finding[];
  /** 是否找到历史状态 */
  hasPreviousState: boolean;
}

/** computeIncrementalDiff 返回结果 */
export interface IncrementalDiffResult {
  /** 发生变更的文件 diff（需要重新审查） */
  changedDiffs: FileDiff[];
  /** 未变更的文件路径（可复用旧 findings） */
  unchangedFiles: string[];
  /** 新增的文件路径（旧状态中不存在，视为变更） */
  addedFiles: string[];
  /** 已删除的文件路径（新状态中不存在） */
  removedFiles: string[];
  /** 当前所有文件的最新哈希 */
  currentHashes: Record<string, string>;
}

/** 默认状态文件名（未指定 --state-file 时使用） */
export const DEFAULT_INCREMENTAL_STATE_FILE = '.code-review-incremental.json';

/**
 * 计算单个 FileDiff 的内容哈希（sha256 hex）。
 *
 * 哈希输入包含：path、status、oldPath、所有 hunk 的元信息与行内容。
 * 这样 diff 文本层面的任何改动都能被识别为变更。
 */
export function computeFileDiffHash(diff: FileDiff): string {
  const hash = createHash('sha256');
  hash.update(`path:${diff.path}\n`);
  hash.update(`status:${diff.status}\n`);
  if (diff.oldPath) hash.update(`oldPath:${diff.oldPath}\n`);
  if (diff.binary) hash.update(`binary:true\n`);
  for (const hunk of diff.hunks) {
    hash.update(`hunk:${hunk.oldStart},${hunk.oldCount},${hunk.newStart},${hunk.newCount}\n`);
    for (const line of hunk.lines) {
      hash.update(`${line.type}:${line.content}\n`);
    }
  }
  return hash.digest('hex');
}

/**
 * 加载上次审查状态。
 *
 * 优先级：
 * 1. stateFile 存在 → 从文件读取完整状态（哈希 + findings + 时间戳）
 * 2. store + sessionId 提供 → 从 StateStore 读取该会话的 findings（无哈希信息）
 * 3. 都未提供 → 返回空状态
 *
 * 文件不存在或损坏时静默回退到空状态。
 */
export function loadLastReviewState(options: LoadLastReviewStateOptions = {}): LoadLastReviewStateResult {
  const { stateFile, store, sessionId } = options;

  if (stateFile) {
    if (existsSync(stateFile)) {
      try {
        const raw = readFileSync(stateFile, 'utf8');
        const data = JSON.parse(raw) as Partial<IncrementalReviewState>;
        if (data && typeof data === 'object' && data.version === 1) {
          return {
            lastReviewedAt: typeof data.lastReviewedAt === 'number' ? data.lastReviewedAt : 0,
            fileHashes:
              data.fileHashes && typeof data.fileHashes === 'object'
                ? (data.fileHashes as Record<string, string>)
                : {},
            findings: Array.isArray(data.findings) ? (data.findings as Finding[]) : [],
            hasPreviousState: true,
          };
        }
      } catch {
        // 损坏的 JSON 静默回退
      }
    }
    return {
      lastReviewedAt: 0,
      fileHashes: {},
      findings: [],
      hasPreviousState: false,
    };
  }

  if (store && sessionId) {
    const findings = store.getFindingsBySession(sessionId);
    return {
      lastReviewedAt: 0,
      fileHashes: {},
      findings,
      hasPreviousState: findings.length > 0,
    };
  }

  return {
    lastReviewedAt: 0,
    fileHashes: {},
    findings: [],
    hasPreviousState: false,
  };
}

/**
 * 计算增量 diff：根据上次审查状态和当前文件 diff 列表，找出变更文件。
 *
 * 判定规则：
 * - 当前 diff 中存在但旧哈希表无记录 → added（视为变更，需审查）
 * - 当前 diff 中存在且哈希不同 → changed（视为变更，需审查）
 * - 当前 diff 中存在且哈希相同 → unchanged（复用旧 findings）
 * - 旧哈希表中存在但当前 diff 中不存在 → removed（旧 findings 将被丢弃）
 */
export function computeIncrementalDiff(
  diffs: FileDiff[],
  previousState: LoadLastReviewStateResult,
): IncrementalDiffResult {
  const previousHashes = previousState.fileHashes ?? {};
  const currentHashes: Record<string, string> = {};
  const changedDiffs: FileDiff[] = [];
  const unchangedFiles: string[] = [];
  const addedFiles: string[] = [];

  for (const diff of diffs) {
    const hash = computeFileDiffHash(diff);
    currentHashes[diff.path] = hash;
    const prevHash = previousHashes[diff.path];
    if (prevHash === undefined) {
      addedFiles.push(diff.path);
      changedDiffs.push(diff);
    } else if (prevHash !== hash) {
      changedDiffs.push(diff);
    } else {
      unchangedFiles.push(diff.path);
    }
  }

  const currentPaths = new Set(diffs.map((d) => d.path));
  const removedFiles = Object.keys(previousHashes).filter((p) => !currentPaths.has(p));

  return {
    changedDiffs,
    unchangedFiles,
    addedFiles,
    removedFiles,
    currentHashes,
  };
}

/**
 * 将 FileDiff 数组序列化回 unified diff 文本。
 *
 * 用于把过滤后的 diff 子集传给 runPipeline（其入参为 diff 文本字符串）。
 * 输出格式与 git diff 兼容，能被 parseDiff 再次解析。
 */
export function serializeDiffsToDiffText(diffs: FileDiff[]): string {
  if (diffs.length === 0) return '';

  const blocks: string[] = [];
  for (const diff of diffs) {
    const lines: string[] = [];
    lines.push(`diff --git a/${diff.oldPath ?? diff.path} b/${diff.path}`);
    if (diff.status === 'added') {
      lines.push('new file mode 100644');
    } else if (diff.status === 'deleted') {
      lines.push('deleted file mode 100644');
    }
    if (diff.oldPath && diff.oldPath !== diff.path) {
      lines.push(`rename from ${diff.oldPath}`);
      lines.push(`rename to ${diff.path}`);
    }
    if (diff.binary) {
      lines.push('Binary files differ');
    } else {
      lines.push(`--- ${diff.status === 'added' ? '/dev/null' : `a/${diff.oldPath ?? diff.path}`}`);
      lines.push(`+++ ${diff.status === 'deleted' ? '/dev/null' : `b/${diff.path}`}`);
      for (const hunk of diff.hunks) {
        lines.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
        for (const line of hunk.lines) {
          const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ';
          lines.push(`${prefix}${line.content}`);
        }
      }
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n');
}

/**
 * 保存增量审查状态到 JSON 文件。
 *
 * 父目录不存在时自动创建。文件写入为 UTF-8 JSON。
 */
export function saveIncrementalState(stateFile: string, state: IncrementalReviewState): void {
  const dir = dirname(stateFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * 合并未变更文件的旧 findings 与变更文件的新 findings。
 *
 * - 旧 findings 中 file 不在变更/新增/删除文件列表中的，全部保留
 * - 旧 findings 中 file 在变更/新增/删除文件列表中的，丢弃（已被新 findings 替换）
 * - 新 findings 全部追加
 *
 * @param previousFindings 上次审查保存的全部 findings
 * @param replacedFiles 本次发生变更（含新增）的文件路径列表
 * @param newFindings 本次审查产出的新 findings
 */
export function mergeIncrementalFindings(
  previousFindings: Finding[],
  replacedFiles: string[],
  newFindings: Finding[],
): Finding[] {
  const replacedSet = new Set(replacedFiles);
  const kept = previousFindings.filter((f) => !replacedSet.has(f.file));
  return [...kept, ...newFindings];
}
