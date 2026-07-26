// src/review-runner.ts — 通过 opencode CLI 执行代码审查并解析结果为 Finding[]
import { execFile as execFileCb, type ExecFileException } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, unlinkSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import type { Finding } from './types.js';
import type { CodeHubClient } from './codehub-client.js';

const execFile = promisify(execFileCb);

/**
 * 为 finding 生成稳定 ID（基于 file:line:ruleId 哈希，取前 12 位 hex）。
 */
function generateFindingId(file: string, line: number, ruleId?: string): string {
  const hash = createHash('sha256');
  hash.update(`${file}:${line}:${ruleId ?? ''}`);
  return hash.digest('hex').slice(0, 12);
}

/**
 * 将 CodeHubMRDiff 的 changes 序列化为 unified diff 文本。
 *
 * 每个文件以 `diff --git a/<path> b/<path>` 头开始，后接该文件的 diff 内容。
 */
function serializeMrDiffToPatch(mrIid: number, changes: { diff: string; new_path: string; old_path: string }[]): string {
  const lines: string[] = [`# MR !${mrIid} diff`, ''];
  for (const c of changes) {
    const path = c.new_path || c.old_path || 'unknown';
    lines.push(`diff --git a/${path} b/${path}`);
    if (c.diff) {
      lines.push(c.diff);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * 从 stdout 尝试解析 findings JSON 数组。
 *
 * 支持两种形态：
 * - stdout 整体是一个 JSON 数组
 * - stdout 中包含被 ```json ... ``` 包裹的 JSON 数组
 */
function tryParseFindingsFromStdout(stdout: string): Finding[] | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  // 直接尝试整体解析
  const direct = tryParseJsonArray(trimmed);
  if (direct) return direct;

  // 尝试从 ```json ... ``` 代码块提取
  const fenceMatch = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    const extracted = tryParseJsonArray(fenceMatch[1].trim());
    if (extracted) return extracted;
  }

  // 尝试从首个 `[` 到最后一个 `]` 截取
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    const sliced = trimmed.slice(firstBracket, lastBracket + 1);
    const extracted = tryParseJsonArray(sliced);
    if (extracted) return extracted;
  }

  return null;
}

function tryParseJsonArray(text: string): Finding[] | null {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed as Finding[];
    }
    // 某些实现可能返回 { findings: [...] }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { findings?: unknown }).findings)) {
      return (parsed as { findings: Finding[] }).findings;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * 尝试从生成的 Markdown 报告文件解析 findings。
 *
 * 报告目录：`<cwd>/.code-review-reports/`，文件名匹配 `mr-<mrIid>-*.md`。
 */
function tryParseFindingsFromReport(mrIid: number, cwd: string): Finding[] | null {
  const reportsDir = join(cwd, '.code-review-reports');
  if (!existsSync(reportsDir)) return null;

  let files: string[];
  try {
    files = readdirSync(reportsDir);
  } catch {
    return null;
  }

  const prefix = `mr-${mrIid}-`;
  const mdFiles = files.filter((f) => f.startsWith(prefix) && f.endsWith('.md'));
  if (mdFiles.length === 0) return null;

  const findings: Finding[] = [];
  for (const f of mdFiles) {
    const content = readFileSync(join(reportsDir, f), 'utf8');
    const extracted = extractFindingsFromMarkdown(content);
    findings.push(...extracted);
  }

  return findings.length > 0 ? findings : null;
}

/**
 * 从 Markdown 报告中粗略提取 findings。
 *
 * 识别形如以下的条目（容忍字段缺失）：
 *   - **file**: path  **line**: N  **severity**: high  **category**: security
 *     message...
 *     `ruleId: xxx`
 */
function extractFindingsFromMarkdown(content: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  // 简易状态机：扫描表格行或列表项
  // 表格行：| file | line | severity | category | message |
  const tableHeaderRe = /^\s*\|?\s*file\s*\|\s*line\s*\|\s*severity\s*\|\s*category\s*\|/i;

  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (tableHeaderRe.test(line)) {
      inTable = true;
      // 跳过分隔行 |---|---|
      if (i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
        i++;
      }
      continue;
    }
    if (inTable) {
      // 表格结束：空行或非表格行
      if (!line.includes('|')) {
        inTable = false;
        continue;
      }
      const cells = line.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
      if (cells.length >= 4) {
        const file = cells[0];
        const lineNum = parseInt(cells[1], 10);
        const severity = (cells[2] || 'info').toLowerCase();
        const category = cells[3] || 'general';
        const message = cells.slice(4).join(' | ') || '';
        if (file && !Number.isNaN(lineNum)) {
          findings.push({
            file,
            line: lineNum,
            severity: normalizeSeverity(severity),
            category,
            message,
            confidence: 0.5,
            source: 'ai',
          });
        }
      }
    }
  }

  return findings;
}

function normalizeSeverity(s: string): Finding['severity'] {
  const lower = s.toLowerCase();
  if (lower === 'critical' || lower === 'high' || lower === 'medium' || lower === 'low') {
    return lower;
  }
  if (lower === 'info' || lower === 'informational') return 'info';
  if (lower === 'warn' || lower === 'warning') return 'medium';
  if (lower === 'error' || lower === 'blocker') return 'high';
  return 'info';
}

/**
 * 通过 opencode CLI 执行代码审查。
 *
 * 流程：
 *  1. 拉取 MR diff（client.getMRDiff）
 *  2. 拉取 MR 信息（用于标题，失败容忍）
 *  3. 将 diff 序列化为 patch 写入临时文件
 *  4. 执行 `opencode run review-pr <mrIid> --output json`
 *  5. 解析 stdout 为 Finding[]；失败则尝试从 `.code-review-reports/mr-<mrIid>-*.md` 解析
 *  6. 为每个 finding 生成稳定 ID（若缺失）
 *  7. 清理临时 diff 文件
 *
 * @param client CodeHub 客户端
 * @param mrIid MR 内部序号
 * @param options.opencodeCwd opencode 运行工作目录（默认 process.cwd()）
 */
export async function runReviewViaOpencode(
  client: CodeHubClient,
  mrIid: number,
  options: { opencodeCwd?: string } = {},
): Promise<Finding[]> {
  const opencodeCwd = options.opencodeCwd ?? process.cwd();

  // 1. 拉取 MR diff
  const mrDiff = await client.getMRDiff(mrIid);

  // 2. 拉取 MR 信息（用于标题，失败容忍）
  await client.getMR(mrIid).catch(() => undefined);

  // 3. 将 diff 写入临时文件
  const tmpFile = join(tmpdir(), `mr-${mrIid}-diff.patch`);
  const patchText = serializeMrDiffToPatch(mrIid, mrDiff.changes);
  writeFileSync(tmpFile, patchText, 'utf8');

  try {
    // 4. 调用 opencode CLI
    let stdout: string;
    try {
      // Windows 上 opencode 是 .ps1/.cmd 脚本，需 shell 模式执行
      const isWindows = process.platform === 'win32';
      const result = await execFile(
        'opencode',
        ['run', 'review-pr', String(mrIid), '--output', 'json'],
        { cwd: opencodeCwd, maxBuffer: 10 * 1024 * 1024, shell: isWindows },
      );
      stdout = result.stdout;
    } catch (err) {
      const e = err as ExecFileException & { stdout?: string; stderr?: string };
      if (e.code === 'ENOENT' || (typeof e.message === 'string' && e.message.includes('ENOENT'))) {
        throw new Error('opencode CLI not found in PATH');
      }
      // 如果 exit code 非零但有 stdout，仍然尝试解析（部分错误场景会输出部分结果）
      if (e.stdout) {
        stdout = e.stdout;
      } else {
        throw new Error(`opencode run review-pr failed: ${e.message}`);
      }
    }

    // 5. 解析输出
    let findings = tryParseFindingsFromStdout(stdout);
    if (!findings) {
      findings = tryParseFindingsFromReport(mrIid, opencodeCwd);
    }
    if (!findings) {
      throw new Error('Failed to parse opencode review output');
    }

    // 6. 为每个 finding 生成稳定 ID（若缺失）
    for (const f of findings) {
      if (!f.id) {
        f.id = generateFindingId(f.file, f.line, f.ruleId);
      }
    }

    return findings;
  } finally {
    // 7. 清理临时 diff 文件
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}
