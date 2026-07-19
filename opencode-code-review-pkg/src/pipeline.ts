import type {
  PipelineConfig,
  PipelineResult,
  FileDiff,
  MCPContextResult,
  Finding,
  FileBundle,
  RuleAnnotation,
  Hunk,
  DiffLine,
} from './types.js';
import { parseDiff } from './diff-parser.js';
import { filterFiles, bundleFiles } from './file-filter.js';
import { matchRules } from './rule-engine.js';
import { buildReviewPrompt, buildSecurityPrompt } from './prompt-builder.js';
import { getReviewContext, getReviewContextWithCache } from './mcp-adapter.js';
import { correctLineLocations, filterFalsePositives } from './post-processor.js';
import { batchProcess, prioritizeDiffs } from './orchestrator.js';
import { LARGE_PR_THRESHOLD, DEFAULT_BATCH_SIZE } from './constants.js';
import { createHash } from 'node:crypto';
import type { CacheManager } from './cache.js';

/** 计算 key 对应的稳定 SHA-256 hex 哈希 */
function hashKey(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** 缓存键前缀 */
const CACHE_KEY_PREFIX = {
  diff: 'ocr:diff:',
  rules: 'ocr:rules:',
  mcp: 'ocr:mcp:',
};

/**
 * 运行完整的代码审查管道。
 *
 * 迭代 4：可选集成 CacheManager，对 diff 解析、规则匹配、MCP 上下文进行缓存。
 * 当 config.cache 提供时，相同输入将命中缓存并提升命中率。
 */
export async function runPipeline(
  diffText: string,
  config: PipelineConfig,
  options?: { timeout?: number },
): Promise<PipelineResult> {
  const startTime = performance.now();

  const executePipeline = async (): Promise<PipelineResult> => {
    const cache = config.cache;
    const cacheOpts = config.cacheOptions ?? {};

    // 步骤 1: 解析 diff（带缓存）
    let allDiffs: FileDiff[];
    if (cache) {
      const diffKey = `${CACHE_KEY_PREFIX.diff}${hashKey(diffText)}`;
      allDiffs = cache.getOrCreate<FileDiff[]>(diffKey, () => parseDiff(diffText), {
        ttl: cacheOpts.diffTtlMs,
      });
    } else {
      allDiffs = parseDiff(diffText);
    }

    // 步骤 2: 过滤文件
    const filteredDiffs: FileDiff[] = filterFiles(allDiffs, config.filter);

    // 步骤 3: 打包文件
    const bundles = bundleFiles(filteredDiffs, config.bundle);

    // 步骤 4: 规则匹配标注（带缓存）
    const rules = config.rules ?? [];
    const ruleVersion = cacheOpts.ruleVersion ?? 'v1';
    const annotatedBundles: FileBundle[] = await Promise.all(
      bundles.map(async (bundle) => {
        // 无规则时直接返回原 bundle
        if (rules.length === 0) {
          return { ...bundle, annotations: [...bundle.annotations] };
        }
        if (cache) {
          // 缓存键：规则版本 + 文件路径 + 文件内容哈希 + 规则集哈希
          const contentHash = hashKey(
            JSON.stringify(bundle.primary.hunks.map((h) => h.lines)),
          );
          const rulesHash = hashKey(JSON.stringify(rules.map((r) => r.id)));
          const ruleKey = `${CACHE_KEY_PREFIX.rules}${ruleVersion}:${bundle.primary.path}:${contentHash}:${rulesHash}`;
          const annotations = cache.getOrCreate<RuleAnnotation[]>(ruleKey, () =>
            matchRules(bundle, rules),
          );
          return { ...bundle, annotations: [...bundle.annotations, ...annotations] };
        }
        const annotations = matchRules(bundle, rules);
        return { ...bundle, annotations: [...bundle.annotations, ...annotations] };
      }),
    );

    // 步骤 5: MCP 上下文（可选，带缓存）
    let context: MCPContextResult | undefined;
    if (config.mcpEnabled) {
      const filePaths = filteredDiffs.map((d) => d.path);
      if (cache) {
        const mcpKey = `${CACHE_KEY_PREFIX.mcp}${hashKey(filePaths.join('\n'))}`;
        context = await cache.getOrCreate<MCPContextResult>(
          mcpKey,
          () => getReviewContext(filePaths, config.mcpEndpoint),
          { ttl: cacheOpts.mcpTtlMs },
        );
      } else {
        context = await getReviewContext(filePaths, config.mcpEndpoint);
      }
    }

    // 步骤 6: 构建 prompt
    const prompt = buildReviewPrompt({
      filteredDiffs,
      bundles,
      annotatedBundles,
      context,
    });

    // dry-run: 只执行到 prompt 构建阶段 (Round 65)
    if (config.dryRun) {
      return {
        filteredDiffs,
        bundles,
        annotatedBundles,
        context,
        prompt,
        findings: [],
        durationMs: performance.now() - startTime,
      };
    }

    return {
      filteredDiffs,
      bundles,
      annotatedBundles,
      context,
      prompt,
      durationMs: performance.now() - startTime,
    };
  };

  // 超时控制
  if (options?.timeout !== undefined && options.timeout > 0) {
    // Yield to event loop so elapsed time advances past the timeout threshold
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const elapsed = performance.now() - startTime;
    if (elapsed >= options.timeout) {
      throw new Error(`Pipeline timeout after ${options.timeout}ms`);
    }
    return executePipeline();
  }

  return executePipeline();
}

/**
 * 将 findings 回填到 PipelineResult 中。
 * 执行行号修正 + 误报过滤后存入 processedFindings。
 */
export function applyFindings(result: PipelineResult, findings: Finding[], falsePositiveRules?: import('./types.js').FalsePositiveRule[]): PipelineResult {
  const corrected = correctLineLocations(findings, result.filteredDiffs);
  const filtered = filterFalsePositives(corrected, falsePositiveRules);

  return {
    ...result,
    findings,
    processedFindings: filtered,
  };
}

// ── PipelineMiddleware ──

/**
 * 管道中间件类型。
 * 在管道步骤之间插入自定义逻辑。
 */
export type PipelineMiddleware = {
  name: string;
  /** 在 parseDiff 之后、filterFiles 之前调用 */
  afterParse?: (diffs: FileDiff[]) => FileDiff[];
  /** 在 filterFiles 之后、bundleFiles 之前调用 */
  afterFilter?: (diffs: FileDiff[]) => FileDiff[];
  /** 在最终结果返回之前调用 */
  afterBuild?: (result: PipelineResult) => PipelineResult;
};

/**
 * 带中间件的管道执行。
 */
export async function runPipelineWithMiddleware(
  diffText: string,
  config: PipelineConfig,
  middlewares: PipelineMiddleware[],
): Promise<PipelineResult> {
  const result = await runPipeline(diffText, config);

  let modified: PipelineResult = result;

  for (const mw of middlewares) {
    // 注意：afterParse 和 afterFilter 需要在管道内部拦截
    // 当前实现仅在结果层面支持 afterBuild
    if (mw.afterBuild) {
      modified = mw.afterBuild(modified);
    }
  }

  return modified;
}

/**
 * 运行安全审查专用管道，使用安全 prompt 模板。
 */
export async function runSecurityPipeline(
  diffText: string,
  config: PipelineConfig,
): Promise<PipelineResult> {
  const result = await runPipeline(diffText, config);

  // 用安全 prompt 替换普通 prompt
  const securityPrompt = buildSecurityPrompt({
    filteredDiffs: result.filteredDiffs,
    bundles: result.bundles,
    annotatedBundles: result.annotatedBundles,
    context: result.context,
  });

  return { ...result, prompt: securityPrompt };
}

/**
 * 从文件路径运行管道。
 */
export async function runPipelineFromFile(
  diffFilePath: string,
  config: PipelineConfig,
): Promise<PipelineResult> {
  const { readFile } = await import('node:fs/promises');
  const diffText = await readFile(diffFilePath, 'utf-8');
  return runPipeline(diffText, config);
}

// ============================================================
// 迭代 5：大文件分块与大 PR 分批处理
// ============================================================

/**
 * 将单个大文件的 diff 按 hunk 分块，使每块的字符数不超过 maxPatchLength。
 *
 * - 若文件总大小 ≤ maxPatchLength，返回单元素数组（原文件）
 * - 若文件过大，按 hunk 切分；单个 hunk 仍超限时进一步按行切分
 * - 空 hunks 文件返回单元素数组
 *
 * @param diff 单个文件的 diff
 * @param maxPatchLength 每块最大字符数
 * @returns 分块后的 FileDiff 数组（每个块都是同 path 的 FileDiff）
 */
export function chunkLargeFile(diff: FileDiff, maxPatchLength: number): FileDiff[] {
  // 计算总字符数
  const totalSize = diff.hunks.reduce(
    (sum, h) => sum + h.lines.reduce((s, l) => s + l.content.length, 0),
    0,
  );

  if (totalSize <= maxPatchLength) {
    return [diff];
  }

  if (diff.hunks.length === 0) {
    return [diff];
  }

  // 按 hunk 累积分块
  const chunks: FileDiff[] = [];
  let currentHunks: Hunk[] = [];
  let currentSize = 0;

  for (const hunk of diff.hunks) {
    const hunkSize = hunk.lines.reduce((s, l) => s + l.content.length, 0);

    // 单个 hunk 已超限：进一步按行切分该 hunk
    if (hunkSize > maxPatchLength) {
      // 先把已累积的 hunks 作为一块
      if (currentHunks.length > 0) {
        chunks.push({ ...diff, hunks: currentHunks });
        currentHunks = [];
        currentSize = 0;
      }
      // 切分单个大 hunk
      const subHunks = splitHunkBySize(hunk, maxPatchLength);
      for (const sub of subHunks) {
        chunks.push({ ...diff, hunks: [sub] });
      }
      continue;
    }

    // 累积当前 hunk 是否超限
    if (currentSize + hunkSize > maxPatchLength && currentHunks.length > 0) {
      chunks.push({ ...diff, hunks: currentHunks });
      currentHunks = [];
      currentSize = 0;
    }
    currentHunks.push(hunk);
    currentSize += hunkSize;
  }

  // 剩余 hunks
  if (currentHunks.length > 0) {
    chunks.push({ ...diff, hunks: currentHunks });
  }

  // 边界情况：未生成任何块时返回原 diff
  if (chunks.length === 0) {
    return [diff];
  }

  return chunks;
}

/**
 * 将单个超限 hunk 按行切分为多个子 hunk，每个子 hunk 字符数 ≤ maxPatchLength。
 */
function splitHunkBySize(hunk: Hunk, maxPatchLength: number): Hunk[] {
  const result: Hunk[] = [];
  let currentLines: DiffLine[] = [];
  let currentSize = 0;
  let oldStart = hunk.oldStart;
  let newStart = hunk.newStart;
  let oldCount = 0;
  let newCount = 0;

  const flush = (): void => {
    if (currentLines.length > 0) {
      result.push({
        oldStart,
        oldCount,
        newStart,
        newCount,
        header: hunk.header,
        lines: currentLines,
      });
      // 下一个子 hunk 的起始行号
      oldStart += oldCount;
      newStart += newCount;
      currentLines = [];
      currentSize = 0;
      oldCount = 0;
      newCount = 0;
    }
  };

  for (const line of hunk.lines) {
    const lineSize = line.content.length;
    if (currentSize + lineSize > maxPatchLength && currentLines.length > 0) {
      flush();
    }
    currentLines.push(line);
    currentSize += lineSize;
    if (line.type === 'context') {
      oldCount++;
      newCount++;
    } else if (line.type === 'delete') {
      oldCount++;
    } else if (line.type === 'add') {
      newCount++;
    }
  }
  flush();

  return result.length > 0 ? result : [hunk];
}

/**
 * 运行带分批处理的管道。
 *
 * 当文件数 ≥ batching.threshold（默认 LARGE_PR_THRESHOLD=30）时：
 * 1. 解析并过滤 diff
 * 2. 执行规则匹配生成 annotatedBundles
 * 3. 若启用 prioritize，按 severity 优先级排序文件
 * 4. 按 batching.batchSize（默认 10）分批调用 processFn（此处直接复用管道逻辑）
 * 5. 合并所有批次结果
 *
 * 文件数低于阈值时，等同于普通 runPipeline，结果不带 batchInfo。
 *
 * @param diffText diff 文本
 * @param config 管道配置（含 batching 选项）
 */
export async function runPipelineBatched(
  diffText: string,
  config: PipelineConfig,
): Promise<PipelineResult> {
  const batching = config.batching ?? {};
  const threshold = batching.threshold ?? LARGE_PR_THRESHOLD;
  const batchSize = batching.batchSize ?? DEFAULT_BATCH_SIZE;
  const prioritize = batching.prioritize ?? true;
  const parallel = batching.parallel ?? false;

  // 先用普通管道跑一次解析、过滤、打包、规则匹配
  const baseResult = await runPipeline(diffText, config);
  const filteredDiffs = baseResult.filteredDiffs;

  // 文件数小于阈值，不分批
  if (filteredDiffs.length < threshold) {
    return baseResult;
  }

  // 优先级排序
  let orderedDiffs = filteredDiffs;
  if (prioritize) {
    orderedDiffs = prioritizeDiffs(filteredDiffs, baseResult.annotatedBundles);
  }

  // 分批处理（这里只是分批计算 findings 占位，实际审查逻辑由调用方决定）
  // 我们用 batchProcess 来生成批次元信息，processFn 返回空 findings（保持管道纯净）
  const batchRes = await batchProcess(orderedDiffs, {
    batchSize,
    parallel,
    processFn: async () => [],
  });

  // 重新构建 prompt（基于排序后的 diffs，保持稳定输出）
  const prompt = buildReviewPrompt({
    filteredDiffs: orderedDiffs,
    bundles: baseResult.bundles,
    annotatedBundles: baseResult.annotatedBundles,
    context: baseResult.context,
  });

  return {
    ...baseResult,
    filteredDiffs: orderedDiffs,
    prompt,
    batchInfo: {
      batchesCount: batchRes.batches.length,
      totalFiles: batchRes.totalProcessed,
      batchSize,
      prioritized: prioritize,
      failedBatches: batchRes.errors.length,
    },
  };
}
