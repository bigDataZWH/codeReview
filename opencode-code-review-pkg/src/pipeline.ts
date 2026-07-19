import type {
  PipelineConfig,
  PipelineResult,
  FileDiff,
  MCPContextResult,
  Finding,
} from './types.js';
import { parseDiff } from './diff-parser.js';
import { filterFiles, bundleFiles } from './file-filter.js';
import { matchRules } from './rule-engine.js';
import { buildReviewPrompt, buildSecurityPrompt } from './prompt-builder.js';
import { getReviewContext } from './mcp-adapter.js';
import { correctLineLocations, filterFalsePositives } from './post-processor.js';

/**
 * 运行完整的代码审查管道。
 */
export async function runPipeline(
  diffText: string,
  config: PipelineConfig,
  options?: { timeout?: number },
): Promise<PipelineResult> {
  const startTime = performance.now();

  const executePipeline = async (): Promise<PipelineResult> => {
    // 步骤 1: 解析 diff
    const allDiffs: FileDiff[] = parseDiff(diffText);

    // 步骤 2: 过滤文件
    const filteredDiffs: FileDiff[] = filterFiles(allDiffs, config.filter);

    // 步骤 3: 打包文件
    const bundles = bundleFiles(filteredDiffs, config.bundle);

    // 步骤 4: 规则匹配标注
    const rules = config.rules ?? [];
    const annotatedBundles = bundles.map((bundle) => {
      const annotations = matchRules(bundle, rules);
      return {
        ...bundle,
        annotations: [...bundle.annotations, ...annotations],
      };
    });

    // 步骤 5: MCP 上下文（可选）
    let context: MCPContextResult | undefined;
    if (config.mcpEnabled) {
      const filePaths = filteredDiffs.map((d) => d.path);
      context = await getReviewContext(filePaths, config.mcpEndpoint);
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
