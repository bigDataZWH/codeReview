import type { Finding, LLMProviderConfig } from './types.js';

/**
 * 为单个 finding 构建反思评估的 prompt。
 */
export function buildReflectionPrompt(finding: Finding): string {
  return `You are a code review quality evaluator. Evaluate whether the following code review finding is a true positive or false positive.

File: ${finding.file}
Line: ${finding.line}
Severity: ${finding.severity}
Category: ${finding.category}
Message: ${finding.message}
Suggestion: ${finding.suggestion || 'N/A'}

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
    .map((f, i) => {
      return `Finding #${i}:
File: ${f.file}
Line: ${f.line}
Severity: ${f.severity}
Category: ${f.category}
Message: ${f.message}
Suggestion: ${f.suggestion || 'N/A'}`;
    })
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

/**
 * 解析 LLM 返回的反思评估结果。
 * 期望 LLM 返回 JSON: { "confidence": 0.8 }
 * 或批量: [{ "id": 0, "confidence": 0.8 }, ...]
 *
 * 返回 confidence 值，解析失败时返回 0.5（中性默认值，不过滤）。
 */
export function parseReflectionResponse(response: string, index?: number): number {
  if (!response || response.trim() === '') {
    return 0.5;
  }

  try {
    const parsed = JSON.parse(response);

    if (Array.isArray(parsed)) {
      // 批量响应
      if (index !== undefined && index >= 0 && index < parsed.length) {
        const item = parsed[index];
        if (item && typeof item.confidence === 'number') {
          return clamp01(item.confidence);
        }
      }
      return 0.5;
    }

    if (typeof parsed === 'object' && parsed !== null) {
      if (typeof parsed.confidence === 'number') {
        return clamp01(parsed.confidence);
      }
      return 0.5;
    }

    return 0.5;
  } catch {
    return 0.5;
  }
}

/**
 * 从 LLM 响应中提取文本内容。
 */
function extractContent(data: unknown): string {
  // OpenAI 协议
  if (
    data &&
    typeof data === 'object' &&
    'choices' in data &&
    Array.isArray((data as Record<string, unknown>).choices)
  ) {
    const choices = (data as Record<string, unknown>).choices as Array<Record<string, unknown>>;
    if (choices.length > 0 && choices[0].message) {
      const message = choices[0].message as Record<string, unknown>;
      if (typeof message.content === 'string') {
        return message.content;
      }
    }
  }

  // Anthropic 协议
  if (
    data &&
    typeof data === 'object' &&
    'content' in data &&
    Array.isArray((data as Record<string, unknown>).content)
  ) {
    const content = (data as Record<string, unknown>).content as Array<Record<string, unknown>>;
    const textBlock = content.find((block) => block.type === 'text');
    if (textBlock && typeof textBlock.text === 'string') {
      return textBlock.text;
    }
  }

  // Google 协议
  if (
    data &&
    typeof data === 'object' &&
    'candidates' in data &&
    Array.isArray((data as Record<string, unknown>).candidates)
  ) {
    const candidates = (data as Record<string, unknown>).candidates as Array<Record<string, unknown>>;
    if (candidates.length > 0 && candidates[0].content) {
      const content = candidates[0].content as Record<string, unknown>;
      if (content.parts && Array.isArray(content.parts)) {
        const parts = content.parts as Array<Record<string, unknown>>;
        if (parts.length > 0 && typeof parts[0].text === 'string') {
          return parts[0].text;
        }
      }
    }
  }

  return '';
}

/**
 * LLM Provider 适配器 — 调用 LLM API 获取反思评估。
 * 支持 OpenAI、Anthropic、Google 三种协议。
 */
export async function callLLM(prompt: string, config: LLMProviderConfig): Promise<string> {
  const { provider, apiKey, model, baseURL, timeout } = config;

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
  }

  const fetchOptions: RequestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  };

  if (timeout !== undefined) {
    // Node.js 18 内置 AbortSignal.timeout (Node 18.3+)
    const controller = new AbortController();
    setTimeout(() => controller.abort(), timeout);
    (fetchOptions as Record<string, unknown>).signal = controller.signal;
  }

  const response = await globalThis.fetch(url, fetchOptions);

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return extractContent(data);
}

/**
 * AI 反思过滤：对每个 finding 调用 LLM 评估置信度，过滤低置信度结果。
 *
 * @param findings 待过滤的 findings
 * @param config LLM 配置
 * @param minConfidence 最低置信度阈值，默认 0.5
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

  const threshold = minConfidence ?? 0.5;

  try {
    const prompt = buildBatchReflectionPrompt(findings);
    const responseText = await callLLM(prompt, config);

    return findings.filter((_finding, index) => {
      const confidence = parseReflectionResponse(responseText, index);
      return confidence >= threshold;
    });
  } catch {
    // 降级策略：LLM 不可用时保留所有 finding（宁可误报也不漏报）
    return [...findings];
  }
}
