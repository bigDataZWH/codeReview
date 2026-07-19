// src/validation.ts — 验证函数

import type { Finding, Severity, PipelineConfig } from './types.js';

const VALID_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];
const VALID_SOURCES = ['rule', 'ai'];

/**
 * 验证 Finding 对象的完整性。
 * 返回错误消息数组，空数组表示验证通过。
 */
export function validateFinding(f: Partial<Finding>): string[] {
  const errors: string[] = [];

  if (!f.file || typeof f.file !== 'string') {
    errors.push('file is required and must be a string');
  }

  if (f.line == null || typeof f.line !== 'number' || f.line < 1) {
    errors.push('line is required and must be a positive number');
  }

  if (!VALID_SEVERITIES.includes(f.severity as Severity) && f.severity !== 'info') {
    errors.push(`severity must be one of: critical, high, medium, low, info (got "${String(f.severity)}")`);
  }

  if (!f.category || typeof f.category !== 'string') {
    errors.push('category is required and must be a string');
  }

  if (!f.message || typeof f.message !== 'string') {
    errors.push('message is required and must be a string');
  }

  if (f.confidence == null || typeof f.confidence !== 'number' || f.confidence < 0 || f.confidence > 1) {
    errors.push('confidence is required and must be a number between 0 and 1');
  }

  if (!VALID_SOURCES.includes(f.source as Finding['source'])) {
    errors.push(`source must be one of: rule, ai (got "${String(f.source)}")`);
  }

  return errors;
}

/**
 * 验证 PipelineConfig 的完整性。
 * 返回 { errors, warnings }：
 *   - errors：阻塞性问题，空数组表示校验通过
 *   - warnings：非阻塞警告（如 mcpEnabled=true 但未配置 mcpEndpoint）
 */
export function validatePipelineConfigWithWarnings(config: Partial<PipelineConfig>): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.filter) {
    errors.push('filter is required');
  } else {
    if (config.filter.ignorePatterns && !Array.isArray(config.filter.ignorePatterns)) {
      errors.push('filter.ignorePatterns must be an array');
    }
    if (config.filter.includePatterns && !Array.isArray(config.filter.includePatterns)) {
      errors.push('filter.includePatterns must be an array');
    }
    if (config.filter.maxPatchLength != null && (typeof config.filter.maxPatchLength !== 'number' || config.filter.maxPatchLength < 0)) {
      errors.push('filter.maxPatchLength must be a non-negative number');
    }
  }

  if (config.rules && !Array.isArray(config.rules)) {
    errors.push('rules must be an array');
  }

  if (config.mcpEnabled && !config.mcpEndpoint) {
    warnings.push('mcpEnabled is true but mcpEndpoint is not configured');
  }

  return { errors, warnings };
}

/**
 * 验证 PipelineConfig 的完整性。
 * 返回错误消息数组，空数组表示验证通过。
 * 保持向后兼容：仅返回 errors，如需 warnings 请使用 validatePipelineConfigWithWarnings。
 */
export function validatePipelineConfig(config: Partial<PipelineConfig>): string[] {
  return validatePipelineConfigWithWarnings(config).errors;
}
