// src/token-optimizer.ts — Token 成本优化模块
//
// 职责：
// 1. compressContext：压缩代码上下文（保留关键行、移除空行/注释）
// 2. selectModelByComplexity：根据变更复杂度选择模型分级
// 3. estimateTokenCost：预估 Token 消耗与成本
// 4. optimizePrompt：综合优化 prompt 文本
//
// 设计取舍：
// - 压缩策略可配置：通过 CompressionOptions 控制移除空行、注释、上下文行数
// - 模型分级默认 3 档（small/medium/large），支持自定义 tier 配置
// - 安全风险强制升级到 large 模型，避免漏报
// - token 估算委托给 token-counter.countTokens（CJK 感知的 GPT 启发式），与 prompt-builder.estimatePromptTokens 保持一致

import type { FileDiff } from './types.js';
import { countTokens } from './token-counter.js';

/** 模型分级 */
export type ModelTierName = 'small' | 'medium' | 'large' | string;

/** 模型分级配置 */
export interface ModelTier {
  /** 分级名称 */
  tier: ModelTierName;
  /** 模型名称（如 gpt-4o-mini） */
  model: string;
  /** 该分级适用的最大复杂度评分 */
  maxComplexity: number;
  /** 该分级最大 token 数 */
  maxTokens: number;
  /** 每 1k token 成本（美元） */
  costPer1kTokens: number;
}

/** 默认模型分级配置 */
export const DEFAULT_MODEL_TIERS: Record<'small' | 'medium' | 'large', ModelTier> = {
  small: {
    tier: 'small',
    model: 'gpt-4o-mini',
    maxComplexity: 20,
    maxTokens: 8_000,
    costPer1kTokens: 0.00015,
  },
  medium: {
    tier: 'medium',
    model: 'gpt-4o',
    maxComplexity: 100,
    maxTokens: 32_000,
    costPer1kTokens: 0.005,
  },
  large: {
    tier: 'large',
    model: 'gpt-4o-turbo',
    maxComplexity: Number.MAX_SAFE_INTEGER,
    maxTokens: 128_000,
    costPer1kTokens: 0.015,
  },
};

/** 复杂度指标 */
export interface ComplexityMetrics {
  /** 变更文件数 */
  filesChanged: number;
  /** 变更行数（add + delete） */
  linesChanged: number;
  /** hunk 总数 */
  hunksCount: number;
  /** 是否包含安全风险（rule 命中 security category） */
  hasSecurityRisk: boolean;
  /** 综合复杂度评分（自定义计算） */
  complexityScore: number;
}

/** 压缩选项 */
export interface CompressionOptions {
  /** 是否启用压缩（默认 true） */
  enabled?: boolean;
  /** 保留关键行（add/delete）周围的上下文行数（默认保留全部上下文） */
  contextLines?: number;
  /** 是否移除注释（默认 false） */
  stripComments?: boolean;
  /** 是否移除空行（默认 false） */
  stripBlankLines?: boolean;
}

/** Token 成本预估 */
export interface TokenCostEstimate {
  /** prompt token 数 */
  promptTokens: number;
  /** completion token 数 */
  completionTokens: number;
  /** 总 token 数 */
  totalTokens: number;
  /** prompt 成本（美元） */
  promptCost: number;
  /** completion 成本（美元） */
  completionCost: number;
  /** 总成本（美元） */
  totalCost: number;
}

/** 优化后的 prompt 结果 */
export interface OptimizedPrompt {
  /** 优化后的 prompt 文本 */
  optimized: string;
  /** 原始长度（字符数） */
  originalLength: number;
  /** 优化后长度（字符数） */
  optimizedLength: number;
  /** 压缩比（0-1，1 = 无压缩） */
  compressionRatio: number;
}

const SINGLE_LINE_COMMENT_RE = /^\/\//;
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//;
const BLOCK_COMMENT_MARKER_RE = /^\/\*|\*\/$/;

function isCommentLine(content: string): boolean {
  const trimmed = content.trim();
  if (SINGLE_LINE_COMMENT_RE.test(trimmed)) return true;
  if (BLOCK_COMMENT_MARKER_RE.test(trimmed)) return true;
  if (BLOCK_COMMENT_RE.test(trimmed)) return true;
  return false;
}

function isBlankLine(content: string): boolean {
  return content.trim() === '';
}

function shouldKeepLine(
  content: string,
  stripBlankLines: boolean,
  stripComments: boolean,
): boolean {
  if (stripBlankLines && isBlankLine(content)) return false;
  if (stripComments && isCommentLine(content)) return false;
  return true;
}

/**
 * 压缩代码上下文。
 *
 * - stripBlankLines：移除空行
 * - stripComments：移除注释行
 * - contextLines：保留关键行（add/delete）周围的 N 行 context，超过部分裁剪
 *
 * 默认不启用任何压缩，需要显式传入选项。当 enabled=false 时直接返回深拷贝。
 *
 * @param diffs 待压缩的 FileDiff 列表
 * @param options 压缩选项
 * @returns 压缩后的 FileDiff 列表（深拷贝，不修改原对象）
 */
export function compressContext(
  diffs: FileDiff[],
  options: CompressionOptions = {},
): FileDiff[] {
  if (diffs.length === 0) return [];
  if (options.enabled === false) {
    return diffs.map((d) => ({ ...d, hunks: d.hunks.map((h) => ({ ...h, lines: [...h.lines] })) }));
  }

  const stripComments = options.stripComments ?? false;
  const stripBlankLines = options.stripBlankLines ?? false;
  const contextLines = options.contextLines;

  return diffs.map((diff) => ({
    ...diff,
    hunks: diff.hunks.map((hunk) => {
      let filteredLines = hunk.lines.filter((line) =>
        shouldKeepLine(line.content, stripBlankLines, stripComments),
      );

      if (contextLines !== undefined && contextLines >= 0) {
        const keyLineIndices = new Set<number>();
        let hasKeyLine = false;
        for (let i = 0; i < filteredLines.length; i++) {
          const line = filteredLines[i];
          if (line.type === 'add' || line.type === 'delete') {
            hasKeyLine = true;
            const start = Math.max(0, i - contextLines);
            const end = Math.min(filteredLines.length - 1, i + contextLines);
            for (let j = start; j <= end; j++) {
              keyLineIndices.add(j);
            }
          }
        }
        if (hasKeyLine) {
          filteredLines = filteredLines.filter((_l, idx) => keyLineIndices.has(idx));
        }
      }

      let oldCount = 0;
      let newCount = 0;
      for (const l of filteredLines) {
        if (l.type !== 'add') oldCount++;
        if (l.type !== 'delete') newCount++;
      }

      return { ...hunk, lines: filteredLines, oldCount, newCount };
    }),
  }));
}

/**
 * 根据变更复杂度选择模型分级。
 *
 * 选择规则：
 * 1. 若 hasSecurityRisk 为 true，强制使用 large 模型
 * 2. 否则按 complexityScore 与各 tier 的 maxComplexity 比较，选择第一个能容纳的 tier
 * 3. 所有 tier 都无法容纳时，使用最后一个 tier（通常是 large）
 *
 * @param metrics 复杂度指标
 * @param customTiers 自定义 tier 配置（可选，默认使用 DEFAULT_MODEL_TIERS）
 */
export function selectModelByComplexity(
  metrics: ComplexityMetrics,
  customTiers?: Record<string, ModelTier>,
): ModelTier {
  const tiers = customTiers ?? DEFAULT_MODEL_TIERS;
  const tierList = Object.values(tiers).sort((a, b) => a.maxComplexity - b.maxComplexity);
  const lastTier = tierList[tierList.length - 1];

  if (metrics.hasSecurityRisk) {
    return tierList.find((t) => t.tier === 'large') ?? lastTier;
  }

  for (const tier of tierList) {
    if (metrics.complexityScore <= tier.maxComplexity) {
      return tier;
    }
  }
  return lastTier;
}

/**
 * 估算文本的 token 数（基于 GPT tokenizer 启发式，CJK 感知）。
 *
 * 委托给 `countTokens`，对中文/日文/韩文等宽字符显著比字符数/4 更准确，
 * 对纯 ASCII 文本结果与 `Math.ceil(len / 4)` 一致（向后兼容）。
 */
export function estimateTokenCount(text: string): number {
  return countTokens(text);
}

/**
 * 检查文本 token 数是否在预算内。
 */
export function fitsInBudget(text: string, budgetTokens: number): boolean {
  return estimateTokenCount(text) <= budgetTokens;
}

/** estimateTokenCost 输入参数 */
export interface EstimateTokenCostInput {
  /** prompt token 数 */
  promptTokens: number;
  /** completion token 数 */
  completionTokens: number;
  /** 每 1k prompt token 成本（默认使用 large 模型费率） */
  costPer1kPromptTokens?: number;
  /** 每 1k completion token 成本（默认使用 large 模型费率） */
  costPer1kCompletionTokens?: number;
}

/**
 * 预估 Token 成本。
 *
 * @param input 输入参数
 * @returns TokenCostEstimate 包含 prompt/completion/total 成本
 */
export function estimateTokenCost(input: EstimateTokenCostInput): TokenCostEstimate {
  const {
    promptTokens,
    completionTokens,
    costPer1kPromptTokens = DEFAULT_MODEL_TIERS.large.costPer1kTokens,
    costPer1kCompletionTokens = DEFAULT_MODEL_TIERS.large.costPer1kTokens,
  } = input;

  const promptCost = (promptTokens / 1000) * costPer1kPromptTokens;
  const completionCost = (completionTokens / 1000) * costPer1kCompletionTokens;
  const totalTokens = promptTokens + completionTokens;
  const totalCost = promptCost + completionCost;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    promptCost,
    completionCost,
    totalCost,
  };
}

/** 优化 prompt 选项 */
export interface OptimizePromptOptions {
  /** 是否移除注释 */
  stripComments?: boolean;
  /** 是否移除空行 */
  stripBlankLines?: boolean;
}

/**
 * 优化 prompt 文本。
 *
 * 应用压缩策略后返回优化结果与压缩比。
 *
 * @param prompt 原始 prompt 文本
 * @param options 优化选项
 */
export function optimizePrompt(
  prompt: string,
  options: OptimizePromptOptions = {},
): OptimizedPrompt {
  const originalLength = prompt.length;
  if (originalLength === 0) {
    return {
      optimized: '',
      originalLength: 0,
      optimizedLength: 0,
      compressionRatio: 0,
    };
  }

  const stripComments = options.stripComments ?? false;
  const stripBlankLines = options.stripBlankLines ?? false;

  if (!stripComments && !stripBlankLines) {
    return {
      optimized: prompt,
      originalLength,
      optimizedLength: originalLength,
      compressionRatio: 1,
    };
  }

  const lines = prompt.split('\n');
  const filtered = lines.filter((line) => shouldKeepLine(line, stripBlankLines, stripComments));
  const optimized = filtered.join('\n');
  const optimizedLength = optimized.length;

  return {
    optimized,
    originalLength,
    optimizedLength,
    compressionRatio: optimizedLength / originalLength,
  };
}
