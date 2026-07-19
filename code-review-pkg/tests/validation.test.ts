import { describe, it, expect } from 'vitest';
import { validateFinding, validatePipelineConfig } from '../src/validation.js';

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
});
