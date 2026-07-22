import type { Finding, LLMProviderConfig } from './types.js';
import { isLLMConfigValid } from './types.js';
import { ModelRouter, type RoutingResult } from './model-router.js';

/**
 * 迭代 7：AI 反思默认置信度阈值。
 *
 * - 历史默认值为 0.5
 * - 迭代 7 调整为 0.6 以降低误报率
 *
 * 调用方仍可通过 reflectFindings 的 minConfidence 参数覆盖此默认值。
 */
export const DEFAULT_REFLECTION_THRESHOLD = 0.6;

function formatFindingFields(f: Finding): string {
  return `File: ${f.file}
Line: ${f.line}
Severity: ${f.severity}
Category: ${f.category}
Message: ${f.message}
Suggestion: ${f.suggestion || 'N/A'}`;
}

/**
 * 为单个 finding 构建反思评估的 prompt。
 */
export function buildReflectionPrompt(finding: Finding): string {
  return `You are a code review quality evaluator. Evaluate whether the following code review finding is a true positive or false positive.

${formatFindingFields(finding)}

Respond with JSON only:
{"confidence": <float between 0 and 1>}

Where:
- 1.0 = definitely a true positive, high-value finding
- 0.5 = uncertain, keep as default
- 0.0 = definitely a false positive`;
}

/**
 * 为多个 finding 构建批量反思评估的 prompt。
 */
export function buildBatchReflectionPrompt(findings: Finding[]): string {
  if (findings.length === 0) {
    return '';
  }

  const sections = findings
    .map((f, i) => `Finding #${i}:\n${formatFindingFields(f)}`)
    .join('\n\n');

  return `You are a code review quality evaluator. Evaluate whether each of the following code review findings is a true positive or false positive.

${sections}

Respond with a JSON array:
[{"id": 0, "confidence": <float between 0 and 1>}, ...]

Where for each finding:
- 1.0 = definitely a true positive, high-value finding
- 0.5 = uncertain, keep as default
- 0.0 = definitely a false positive`;
}

/**
 * 将值 clamp 到 [0, 1] 范围。
 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function extractConfidence(obj: unknown): number | null {
  if (obj && typeof obj === 'object' && typeof (obj as Record<string, unknown>).confidence === 'number') {
    return clamp01((obj as Record<string, unknown>).confidence as number);
  }
  return null;
}

/**
 * 解析 LLM 返回的反思评估结果。
 * 期望 LLM 返回 JSON: { "confidence": 0.8 }
 * 或批量: [{ "id": 0, "confidence": 0.8 }, ...]
 *
 * 返回 confidence 值，解析失败时返回 0.5（中性默认值，不过滤）。
 */
export function parseReflectionResponse(response: string, index?: number): number {
  if (typeof response !== 'string' || response.trim() === '') {
    return 0.5;
  }

  try {
    const parsed = JSON.parse(response);

    if (Array.isArray(parsed)) {
      if (index !== undefined && index >= 0 && index < parsed.length) {
        const confidence = extractConfidence(parsed[index]);
        if (confidence !== null) return confidence;
      }
      return 0.5;
    }

    const confidence = extractConfidence(parsed);
    return confidence !== null ? confidence : 0.5;
  } catch (err) {
    console.warn('[ai-reflection] parseReflectionResponse failed to parse JSON:', err);
    return 0.5;
  }
}

function isRecord(obj: unknown): obj is Record<string, unknown> {
  return obj !== null && typeof obj === 'object';
}

/**
 * 从 LLM 响应中提取文本内容。
 */
function extractContent(data: unknown): string {
  // OpenAI 协议
  if (isRecord(data) && Array.isArray(data.choices)) {
    const choices = data.choices as Array<Record<string, unknown>>;
    const message = choices[0]?.message as Record<string, unknown> | undefined;
    if (message && typeof message.content === 'string') {
      return message.content;
    }
  }

  // Anthropic 协议
  if (isRecord(data) && Array.isArray(data.content)) {
    const content = data.content as Array<Record<string, unknown>>;
    const textBlock = content.find((block) => block.type === 'text');
    if (textBlock && typeof textBlock.text === 'string') {
      return textBlock.text;
    }
  }

  // Google 协议
  if (isRecord(data) && Array.isArray(data.candidates)) {
    const candidates = data.candidates as Array<Record<string, unknown>>;
    const content = candidates[0]?.content as Record<string, unknown> | undefined;
    if (content && Array.isArray(content.parts)) {
      const parts = content.parts as Array<Record<string, unknown>>;
      if (parts.length > 0 && typeof parts[0].text === 'string') {
        return parts[0].text;
      }
    }
  }

  return '';
}

/**
 * 迭代 7：LLM 调用默认超时时间（毫秒）。
 *
 * 当 LLMProviderConfig.timeout 未指定时使用此默认值，
 * 确保 LLM 不可达时能快速失败，触发 reflectFindings 的降级路径。
 */
const DEFAULT_LLM_TIMEOUT_MS = 2000;

/**
 * LLM Provider 适配器 — 调用 LLM API 获取反思评估。
 * 支持 OpenAI、Anthropic、Google 三种协议。
 *
 * @throws 当配置无效（缺少 provider / apiKey / model）时抛出错误
 */
export async function callLLM(prompt: string, config: LLMProviderConfig): Promise<string> {
  if (!isLLMConfigValid(config)) {
    throw new Error('LLM config is invalid: provider, apiKey, and model are required');
  }

  const provider = config.provider as 'openai' | 'anthropic' | 'google';
  const apiKey = config.apiKey as string;
  const model = config.model as string;
  const baseURL = config.baseURL;
  const timeout = config.timeout;

  let url: string;
  let body: Record<string, unknown>;
  let headers: Record<string, string>;

  switch (provider) {
    case 'openai': {
      const base = baseURL || 'https://api.openai.com';
      url = `${base}/v1/chat/completions`;
      body = {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      };
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      };
      break;
    }

    case 'anthropic': {
      const base = baseURL || 'https://api.anthropic.com';
      url = `${base}/v1/messages`;
      body = {
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 256,
      };
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      };
      break;
    }

    case 'google': {
      const base = baseURL || 'https://generativelanguage.googleapis.com';
      url = `${base}/v1beta/models/${model}:generateContent`;
      body = {
        contents: [{ parts: [{ text: prompt }] }],
      };
      headers = {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      };
      break;
    }

    default: {
      throw new Error(`Unsupported LLM provider: ${provider}`);
    }
  }

  const fetchOptions: RequestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  };

  // 迭代 7：始终设置超时，未指定时使用 DEFAULT_LLM_TIMEOUT_MS
  // 确保 LLM 不可达时能快速失败，触发降级路径
  const effectiveTimeout = timeout ?? DEFAULT_LLM_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  (fetchOptions as Record<string, unknown>).signal = controller.signal;

  try {
    const response = await globalThis.fetch(url, fetchOptions);

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return extractContent(data);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * AI 反思过滤：对每个 finding 调用 LLM 评估置信度，过滤低置信度结果。
 *
 * 当 LLM 配置无效（缺少 provider / apiKey / model）时，直接返回所有 findings
 * （降级策略：宁可误报也不漏报），不会抛出错误。
 *
 * @param findings 待过滤的 findings
 * @param config LLM 配置（可空，空配置时降级为全保留）
 * @param minConfidence 最低置信度阈值，默认 DEFAULT_REFLECTION_THRESHOLD (0.6)
 * @returns 过滤后的 findings
 */
export async function reflectFindings(
  findings: Finding[],
  config: LLMProviderConfig,
  minConfidence?: number,
): Promise<Finding[]> {
  if (findings.length === 0) {
    return [];
  }

  if (!isLLMConfigValid(config)) {
    return [...findings];
  }

  const threshold = minConfidence ?? DEFAULT_REFLECTION_THRESHOLD;

  try {
    const prompt = buildBatchReflectionPrompt(findings);
    const responseText = await callLLM(prompt, config);

    return findings.filter((_finding, index) => {
      const confidence = parseReflectionResponse(responseText, index);
      return confidence >= threshold;
    });
  } catch (err) {
    // 降级策略：LLM 不可用时保留所有 finding（宁可误报也不漏报）
    console.warn('[ai-reflection] reflectFindings LLM call failed, returning all findings:', err);
    return [...findings];
  }
}

// ==================== Task 8：模型路由集成 ====================

/**
 * 模型分级 → LLM 配置映射。
 *
 * 用于 reflectFindingsWithRouter：根据 finding 复杂度选择对应分级的 LLM 配置。
 * 缺失某分级时降级为 fallback 配置（若有）。
 */
export type ModelConfigMap = Partial<{
  small: LLMProviderConfig;
  medium: LLMProviderConfig;
  large: LLMProviderConfig;
}>;

/** reflectFindingsWithRouter 返回的额外元信息 */
export interface ReflectWithRouterResult {
  /** 通过反思过滤的 findings */
  findings: Finding[];
  /** 每条 finding 的路由结果（顺序与输入一致） */
  routings: RoutingResult[];
  /** 各模型分级处理的 finding 数量 */
  sizeCounts: Record<string, number>;
}

/**
 * 根据路由结果选择有效的 LLM 配置。
 *
 * 选择优先级：
 * 1. 该分级的配置（若有效）
 * 2. 更高分级的配置（large → medium → small，向大降级）
 * 3. 任一有效配置
 * 4. 都无效 → 返回 undefined
 */
function pickConfigForSize(
  size: 'small' | 'medium' | 'large',
  configMap: ModelConfigMap,
): LLMProviderConfig | undefined {
  const sizes: Array<'small' | 'medium' | 'large'> = ['small', 'medium', 'large'];
  const sizeIndex = sizes.indexOf(size);
  for (let i = sizeIndex; i < sizes.length; i++) {
    const cfg = configMap[sizes[i]];
    if (cfg && isLLMConfigValid(cfg)) return cfg;
  }
  for (let i = sizeIndex - 1; i >= 0; i--) {
    const cfg = configMap[sizes[i]];
    if (cfg && isLLMConfigValid(cfg)) return cfg;
  }
  return undefined;
}

/**
 * 基于模型路由的反思过滤（Task 8）。
 *
 * 工作流程：
 * 1. 使用 ModelRouter 为每条 finding 路由出对应模型分级
 * 2. 按模型分级分组 findings
 * 3. 对每组 findings 调用对应 LLM 配置进行反思过滤
 * 4. 合并结果（保持原 findings 顺序）
 * 5. 某组 LLM 不可用时降级为该组全保留
 *
 * @param findings 待过滤的 findings
 * @param router 模型路由器实例
 * @param configMap 各分级的 LLM 配置
 * @param minConfidence 最低置信度阈值
 * @returns 反思过滤结果（含路由元信息）
 */
export async function reflectFindingsWithRouter(
  findings: Finding[],
  router: ModelRouter,
  configMap: ModelConfigMap,
  minConfidence?: number,
): Promise<ReflectWithRouterResult> {
  if (findings.length === 0) {
    return { findings: [], routings: [], sizeCounts: {} };
  }

  // 1. 路由 + 分组
  const routings: RoutingResult[] = [];
  const groups = new Map<string, { findings: Finding[]; indices: number[] }>();
  const sizeCounts: Record<string, number> = {};
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const r = router.routeByComplexity(f);
    routings.push(r);
    const key = r.size;
    sizeCounts[key] = (sizeCounts[key] ?? 0) + 1;
    if (!groups.has(key)) groups.set(key, { findings: [], indices: [] });
    const g = groups.get(key)!;
    g.findings.push(f);
    g.indices.push(i);
  }

  const threshold = minConfidence ?? DEFAULT_REFLECTION_THRESHOLD;

  // 2. 对每组调用对应 LLM 配置
  // 结果按原索引写入 kept 数组，保持顺序
  const kept: boolean[] = new Array(findings.length).fill(true);

  for (const [size, group] of groups.entries()) {
    const cfg = pickConfigForSize(size as 'small' | 'medium' | 'large', configMap);
    if (!cfg) {
      // 该组无可用 LLM 配置：全保留（降级策略）
      for (const idx of group.indices) kept[idx] = true;
      continue;
    }
    try {
      const prompt = buildBatchReflectionPrompt(group.findings);
      const responseText = await callLLM(prompt, cfg);
      group.findings.forEach((_f, localIdx) => {
        const origIdx = group.indices[localIdx];
        const confidence = parseReflectionResponse(responseText, localIdx);
        kept[origIdx] = confidence >= threshold;
      });
    } catch (err) {
      console.warn(
        `[ai-reflection] reflectFindingsWithRouter: LLM call failed for size=${size}, returning all findings in this group:`,
        err,
      );
      // 降级：该组全保留
      for (const idx of group.indices) kept[idx] = true;
    }
  }

  const resultFindings = findings.filter((_f, idx) => kept[idx]);
  return { findings: resultFindings, routings, sizeCounts };
}
