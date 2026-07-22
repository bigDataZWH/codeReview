import type { Finding, Severity, PipelineConfig } from './types.js';

const VALID_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];
const VALID_SOURCES = ['rule', 'ai'];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value > 0;
}

function isInRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

export function validateFinding(f: Partial<Finding>): string[] {
  const errors: string[] = [];

  if (!isNonEmptyString(f.file)) {
    errors.push('file is required and must be a string');
  }

  if (!isPositiveInteger(f.line)) {
    errors.push('line is required and must be a positive number');
  }

  if (!VALID_SEVERITIES.includes(f.severity as Severity) && f.severity !== 'info') {
    errors.push(`severity must be one of: critical, high, medium, low, info (got "${String(f.severity)}")`);
  }

  if (!isNonEmptyString(f.category)) {
    errors.push('category is required and must be a string');
  }

  if (!isNonEmptyString(f.message)) {
    errors.push('message is required and must be a string');
  }

  if (!isFiniteNumber(f.confidence) || !isInRange(f.confidence, 0, 1)) {
    errors.push('confidence is required and must be a number between 0 and 1');
  }

  if (!VALID_SOURCES.includes(f.source as Finding['source'])) {
    errors.push(`source must be one of: rule, ai (got "${String(f.source)}")`);
  }

  return errors;
}

export function validatePipelineConfigWithWarnings(config: Partial<PipelineConfig>): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.filter) {
    errors.push('filter is required');
  } else {
    if (config.filter.ignorePatterns != null && !Array.isArray(config.filter.ignorePatterns)) {
      errors.push('filter.ignorePatterns must be an array');
    }
    if (config.filter.includePatterns != null && !Array.isArray(config.filter.includePatterns)) {
      errors.push('filter.includePatterns must be an array');
    }
    if (config.filter.maxPatchLength != null && (!isFiniteNumber(config.filter.maxPatchLength) || config.filter.maxPatchLength < 0)) {
      errors.push('filter.maxPatchLength must be a non-negative number');
    }
  }

  if (config.rules != null && !Array.isArray(config.rules)) {
    errors.push('rules must be an array');
  }

  if (config.mcpEnabled && !config.mcpEndpoint) {
    warnings.push('mcpEnabled is true but mcpEndpoint is not configured');
  }

  return { errors, warnings };
}

export function validatePipelineConfig(config: Partial<PipelineConfig>): string[] {
  return validatePipelineConfigWithWarnings(config).errors;
}
