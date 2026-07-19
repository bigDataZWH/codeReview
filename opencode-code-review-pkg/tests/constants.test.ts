import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FILTER_CONFIG,
  DEFAULT_BUNDLE_CONFIG,
  SEVERITY_ORDER,
  MAX_DIFF_SIZE,
  HIGH_CONFIDENCE_THRESHOLD,
  DEFAULT_IOU_THRESHOLD,
} from '../src/constants.js';

describe('constants', () => {
  it('DEFAULT_FILTER_CONFIG has ignorePatterns array', () => {
    expect(Array.isArray(DEFAULT_FILTER_CONFIG.ignorePatterns)).toBe(true);
    expect(DEFAULT_FILTER_CONFIG.ignorePatterns!.length).toBeGreaterThan(0);
  });

  it('DEFAULT_FILTER_CONFIG has maxPatchLength', () => {
    expect(DEFAULT_FILTER_CONFIG.maxPatchLength).toBe(100_000);
  });

  it('DEFAULT_BUNDLE_CONFIG has empty bundles', () => {
    expect(DEFAULT_BUNDLE_CONFIG.bundles).toEqual([]);
  });

  it('SEVERITY_ORDER has correct ordering', () => {
    expect(SEVERITY_ORDER.critical).toBe(4);
    expect(SEVERITY_ORDER.high).toBe(3);
    expect(SEVERITY_ORDER.medium).toBe(2);
    expect(SEVERITY_ORDER.low).toBe(1);
    expect(SEVERITY_ORDER.info).toBe(0);
  });

  it('MAX_DIFF_SIZE is a positive number', () => {
    expect(MAX_DIFF_SIZE).toBeGreaterThan(0);
  });

  it('HIGH_CONFIDENCE_THRESHOLD is between 0 and 1', () => {
    expect(HIGH_CONFIDENCE_THRESHOLD).toBeGreaterThan(0);
    expect(HIGH_CONFIDENCE_THRESHOLD).toBeLessThanOrEqual(1);
  });

  it('DEFAULT_IOU_THRESHOLD is between 0 and 1', () => {
    expect(DEFAULT_IOU_THRESHOLD).toBeGreaterThan(0);
    expect(DEFAULT_IOU_THRESHOLD).toBeLessThanOrEqual(1);
  });
});
