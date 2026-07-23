import { describe, it, expect } from 'vitest';
import { validateFinding, validatePipelineConfig, validatePipelineConfigWithWarnings } from '../src/validation.js';

describe('validateFinding', () => {
  it('returns no errors for a valid finding', () => {
    const errors = validateFinding({
      file: 'src/index.ts',
      line: 10,
      severity: 'high',
      category: 'security',
      message: 'SQL injection',
      confidence: 0.9,
      source: 'rule',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts info severity', () => {
    const errors = validateFinding({
      file: 'a.ts', line: 1, severity: 'info', category: 'style',
      message: 'm', confidence: 0.5, source: 'ai',
    });
    expect(errors).toHaveLength(0);
  });

  it('detects missing file', () => {
    const errors = validateFinding({
      line: 1, severity: 'low', category: 'c',
      message: 'm', confidence: 0.5, source: 'rule',
    });
    expect(errors).toContain('file is required and must be a string');
  });

  it('detects missing line', () => {
    const errors = validateFinding({
      file: 'a.ts', severity: 'low', category: 'c',
      message: 'm', confidence: 0.5, source: 'rule',
    });
    expect(errors).toContain('line is required and must be a positive number');
  });

  it('detects zero line number', () => {
    const errors = validateFinding({
      file: 'a.ts', line: 0, severity: 'low', category: 'c',
      message: 'm', confidence: 0.5, source: 'rule',
    });
    expect(errors).toContain('line is required and must be a positive number');
  });

  it('detects invalid severity', () => {
    const errors = validateFinding({
      file: 'a.ts', line: 1, severity: 'urgent' as any, category: 'c',
      message: 'm', confidence: 0.5, source: 'rule',
    });
    expect(errors.some(e => e.includes('severity'))).toBe(true);
  });

  it('detects confidence out of range', () => {
    const errors = validateFinding({
      file: 'a.ts', line: 1, severity: 'low', category: 'c',
      message: 'm', confidence: 1.5, source: 'rule',
    });
    expect(errors.some(e => e.includes('confidence'))).toBe(true);
  });

  it('detects invalid source', () => {
    const errors = validateFinding({
      file: 'a.ts', line: 1, severity: 'low', category: 'c',
      message: 'm', confidence: 0.5, source: 'manual' as any,
    });
    expect(errors.some(e => e.includes('source'))).toBe(true);
  });

  it('returns multiple errors at once', () => {
    const errors = validateFinding({});
    expect(errors.length).toBeGreaterThan(1);
  });

  it('rejects empty file string', () => {
    const errors = validateFinding({
      file: '', line: 1, severity: 'low', category: 'c',
      message: 'm', confidence: 0.5, source: 'rule',
    });
    expect(errors).toContain('file is required and must be a string');
  });

  it('rejects empty category string', () => {
    const errors = validateFinding({
      file: 'a.ts', line: 1, severity: 'low', category: '',
      message: 'm', confidence: 0.5, source: 'rule',
    });
    expect(errors).toContain('category is required and must be a string');
  });

  it('rejects empty message string', () => {
    const errors = validateFinding({
      file: 'a.ts', line: 1, severity: 'low', category: 'c',
      message: '', confidence: 0.5, source: 'rule',
    });
    expect(errors).toContain('message is required and must be a string');
  });

  it('rejects negative line number', () => {
    const errors = validateFinding({
      file: 'a.ts', line: -5, severity: 'low', category: 'c',
      message: 'm', confidence: 0.5, source: 'rule',
    });
    expect(errors).toContain('line is required and must be a positive number');
  });

  it('rejects float line number', () => {
    const errors = validateFinding({
      file: 'a.ts', line: 1.5, severity: 'low', category: 'c',
      message: 'm', confidence: 0.5, source: 'rule',
    });
    expect(errors).toContain('line is required and must be a positive number');
  });

  it('rejects NaN line', () => {
    const errors = validateFinding({
      file: 'a.ts', line: NaN, severity: 'low', category: 'c',
      message: 'm', confidence: 0.5, source: 'rule',
    });
    expect(errors).toContain('line is required and must be a positive number');
  });

  it('rejects Infinity line', () => {
    const errors = validateFinding({
      file: 'a.ts', line: Infinity, severity: 'low', category: 'c',
      message: 'm', confidence: 0.5, source: 'rule',
    });
    expect(errors).toContain('line is required and must be a positive number');
  });

  it('rejects NaN confidence', () => {
    const errors = validateFinding({
      file: 'a.ts', line: 1, severity: 'low', category: 'c',
      message: 'm', confidence: NaN, source: 'rule',
    });
    expect(errors.some(e => e.includes('confidence'))).toBe(true);
  });

  it('rejects Infinity confidence', () => {
    const errors = validateFinding({
      file: 'a.ts', line: 1, severity: 'low', category: 'c',
      message: 'm', confidence: Infinity, source: 'rule',
    });
    expect(errors.some(e => e.includes('confidence'))).toBe(true);
  });

  it('rejects negative confidence', () => {
    const errors = validateFinding({
      file: 'a.ts', line: 1, severity: 'low', category: 'c',
      message: 'm', confidence: -0.1, source: 'rule',
    });
    expect(errors.some(e => e.includes('confidence'))).toBe(true);
  });

  it('accepts confidence exactly 0', () => {
    const errors = validateFinding({
      file: 'a.ts', line: 1, severity: 'low', category: 'c',
      message: 'm', confidence: 0, source: 'rule',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts confidence exactly 1', () => {
    const errors = validateFinding({
      file: 'a.ts', line: 1, severity: 'low', category: 'c',
      message: 'm', confidence: 1, source: 'rule',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects file as number type', () => {
    const errors = validateFinding({
      file: 123 as any, line: 1, severity: 'low', category: 'c',
      message: 'm', confidence: 0.5, source: 'rule',
    });
    expect(errors).toContain('file is required and must be a string');
  });

  it('rejects category as number type', () => {
    const errors = validateFinding({
      file: 'a.ts', line: 1, severity: 'low', category: 123 as any,
      message: 'm', confidence: 0.5, source: 'rule',
    });
    expect(errors).toContain('category is required and must be a string');
  });

  it('rejects message as object type', () => {
    const errors = validateFinding({
      file: 'a.ts', line: 1, severity: 'low', category: 'c',
      message: {} as any, confidence: 0.5, source: 'rule',
    });
    expect(errors).toContain('message is required and must be a string');
  });
});

describe('validatePipelineConfig', () => {
  it('returns no errors for valid config', () => {
    const errors = validatePipelineConfig({
      filter: { ignorePatterns: ['*.test.ts'] },
    });
    expect(errors).toHaveLength(0);
  });

  it('detects missing filter', () => {
    const errors = validatePipelineConfig({});
    expect(errors).toContain('filter is required');
  });

  it('detects invalid ignorePatterns', () => {
    const errors = validatePipelineConfig({
      filter: { ignorePatterns: 'not-array' as any },
    });
    expect(errors).toContain('filter.ignorePatterns must be an array');
  });

  it('detects negative maxPatchLength', () => {
    const errors = validatePipelineConfig({
      filter: { maxPatchLength: -1 },
    });
    expect(errors).toContain('filter.maxPatchLength must be a non-negative number');
  });

  it('accepts zero maxPatchLength', () => {
    const errors = validatePipelineConfig({
      filter: { maxPatchLength: 0 },
    });
    expect(errors).toHaveLength(0);
  });

  it('detects invalid rules', () => {
    const errors = validatePipelineConfig({
      filter: {},
      rules: 'not-array' as any,
    });
    expect(errors).toContain('rules must be an array');
  });

  it('detects invalid includePatterns', () => {
    const errors = validatePipelineConfig({
      filter: { includePatterns: 'not-array' as any },
    });
    expect(errors).toContain('filter.includePatterns must be an array');
  });

  it('accepts valid includePatterns array', () => {
    const errors = validatePipelineConfig({
      filter: { includePatterns: ['src/**/*.ts'] },
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts valid ignorePatterns array', () => {
    const errors = validatePipelineConfig({
      filter: { ignorePatterns: ['*.test.ts'] },
    });
    expect(errors).toHaveLength(0);
  });

  it('detects NaN maxPatchLength', () => {
    const errors = validatePipelineConfig({
      filter: { maxPatchLength: NaN },
    });
    expect(errors).toContain('filter.maxPatchLength must be a non-negative number');
  });

  it('detects Infinity maxPatchLength', () => {
    const errors = validatePipelineConfig({
      filter: { maxPatchLength: Infinity },
    });
    expect(errors).toContain('filter.maxPatchLength must be a non-negative number');
  });

  it('accepts filter as empty object', () => {
    const errors = validatePipelineConfig({
      filter: {},
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts rules as undefined', () => {
    const errors = validatePipelineConfig({
      filter: {},
      rules: undefined,
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts rules as empty array', () => {
    const errors = validatePipelineConfig({
      filter: {},
      rules: [],
    });
    expect(errors).toHaveLength(0);
  });
});

describe('validatePipelineConfig warnings', () => {
  it('warns when mcpEnabled is true but mcpEndpoint is missing', () => {
    const { warnings } = validatePipelineConfigWithWarnings({
      mcpEnabled: true,
      filter: {},
    });
    expect(warnings).toContain('mcpEnabled is true but mcpEndpoint is not configured');
  });

  it('does not warn when mcpEnabled is true and mcpEndpoint is provided', () => {
    const { warnings } = validatePipelineConfigWithWarnings({
      mcpEnabled: true,
      mcpEndpoint: 'http://localhost:3000',
      filter: {},
    });
    expect(warnings).not.toContain('mcpEnabled is true but mcpEndpoint is not configured');
  });

  it('does not warn when mcpEnabled is false', () => {
    const { warnings } = validatePipelineConfigWithWarnings({
      mcpEnabled: false,
      filter: {},
    });
    expect(warnings).not.toContain('mcpEnabled is true but mcpEndpoint is not configured');
  });

  it('does not warn when mcpEnabled is not set', () => {
    const { warnings } = validatePipelineConfigWithWarnings({
      filter: {},
    });
    expect(warnings).not.toContain('mcpEnabled is true but mcpEndpoint is not configured');
  });

  it('still returns errors alongside warnings', () => {
    const { errors, warnings } = validatePipelineConfigWithWarnings({
      mcpEnabled: true,
    });
    expect(errors).toContain('filter is required');
    expect(warnings).toContain('mcpEnabled is true but mcpEndpoint is not configured');
  });

  it('validatePipelineConfig stays backward compatible (returns only errors)', () => {
    const result = validatePipelineConfig({
      mcpEnabled: true,
      filter: {},
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result).not.toContain('mcpEnabled is true but mcpEndpoint is not configured');
  });
});
