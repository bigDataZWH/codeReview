import { describe, it, expect } from 'vitest';
import { slugify, truncateString, isCFile, isCppFile, isTestFile, isGeneratedFile, severityOrder, formatSeverity } from '../src/utils.js';

describe('slugify', () => {
  it('converts simple text to lowercase slug', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('handles multiple spaces and special chars', () => {
    expect(slugify('  Hello   World!  ')).toBe('hello-world');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });

  it('handles only special characters', () => {
    expect(slugify('!!! $$$ ***')).toBe('');
  });

  it('handles Chinese characters', () => {
    expect(slugify('代码审查 Code Review')).toBe('代码审查-code-review');
  });

  it('handles consecutive dashes', () => {
    expect(slugify('foo--bar___baz')).toBe('foo-bar-baz');
  });

  it('handles single word', () => {
    expect(slugify('TypeScript')).toBe('typescript');
  });

  it('handles numbers', () => {
    expect(slugify('Round 71: Utils')).toBe('round-71-utils');
  });
});

describe('truncateString', () => {
  it('returns original string if within maxLen', () => {
    expect(truncateString('hello', 10)).toBe('hello');
  });

  it('truncates and appends default suffix', () => {
    expect(truncateString('hello world', 8)).toBe('hello...');
  });

  it('truncates with custom suffix', () => {
    expect(truncateString('hello world', 9, ' [more]')).toBe('he [more]');
  });

  it('handles exact length', () => {
    expect(truncateString('hello', 5)).toBe('hello');
  });

  it('handles empty string', () => {
    expect(truncateString('', 10)).toBe('');
  });

  it('handles negative maxLen', () => {
    expect(truncateString('hello', -1)).toBe('');
  });

  it('handles suffix longer than maxLen', () => {
    expect(truncateString('hello', 2, '...')).toBe('..');
  });

  it('handles zero maxLen', () => {
    expect(truncateString('hello', 0)).toBe('');
  });
});

describe('isCFile', () => {
  it('detects .c files', () => {
    expect(isCFile('src/main.c')).toBe(true);
  });

  it('detects .h files', () => {
    expect(isCFile('include/header.h')).toBe(true);
  });

  it('rejects .cpp files', () => {
    expect(isCFile('src/main.cpp')).toBe(false);
  });

  it('rejects non-C files', () => {
    expect(isCFile('src/main.ts')).toBe(false);
  });
});

describe('isCppFile', () => {
  it('detects .cpp files', () => {
    expect(isCppFile('src/main.cpp')).toBe(true);
  });

  it('detects .hpp files', () => {
    expect(isCppFile('include/lib.hpp')).toBe(true);
  });

  it('detects .cc files', () => {
    expect(isCppFile('src/utils.cc')).toBe(true);
  });

  it('rejects .c files', () => {
    expect(isCppFile('src/main.c')).toBe(false);
  });
});

describe('isTestFile', () => {
  it('detects .test.ts files', () => {
    expect(isTestFile('src/utils.test.ts')).toBe(true);
  });

  it('detects .spec.ts files', () => {
    expect(isTestFile('src/utils.spec.ts')).toBe(true);
  });

  it('detects test files in subdirs', () => {
    expect(isTestFile('tests/unit/parser.test.ts')).toBe(true);
  });

  it('rejects non-test files', () => {
    expect(isTestFile('src/index.ts')).toBe(false);
  });
});

describe('isGeneratedFile', () => {
  it('detects files in /generated/ path', () => {
    expect(isGeneratedFile('src/generated/proto.ts')).toBe(true);
  });

  it('detects files in /gen/ path', () => {
    expect(isGeneratedFile('src/gen/models.py')).toBe(true);
  });

  it('detects .pb.go files', () => {
    expect(isGeneratedFile('proto/generated.pb.go')).toBe(true);
  });

  it('detects .generated.ts files', () => {
    expect(isGeneratedFile('src/api.generated.ts')).toBe(true);
  });

  it('rejects normal files', () => {
    expect(isGeneratedFile('src/index.ts')).toBe(false);
  });
});

describe('severityOrder', () => {
  it('returns 4 for critical', () => {
    expect(severityOrder('critical')).toBe(4);
  });

  it('returns 3 for high', () => {
    expect(severityOrder('high')).toBe(3);
  });

  it('returns 2 for medium', () => {
    expect(severityOrder('medium')).toBe(2);
  });

  it('returns 1 for low', () => {
    expect(severityOrder('low')).toBe(1);
  });

  it('returns 0 for info', () => {
    expect(severityOrder('info')).toBe(0);
  });

  it('returns -1 for unknown', () => {
    expect(severityOrder('unknown')).toBe(-1);
  });

  it('is case-insensitive', () => {
    expect(severityOrder('CRITICAL')).toBe(4);
    expect(severityOrder('High')).toBe(3);
  });
});

describe('formatSeverity', () => {
  it('formats critical', () => {
    expect(formatSeverity('critical')).toBe('Critical [!!!]');
  });

  it('formats high', () => {
    expect(formatSeverity('high')).toBe('High [!!]');
  });

  it('formats medium', () => {
    expect(formatSeverity('medium')).toBe('Medium [!]');
  });

  it('formats low', () => {
    expect(formatSeverity('low')).toBe('Low [i]');
  });

  it('formats info', () => {
    expect(formatSeverity('info')).toBe('Info [.]');
  });

  it('formats unknown severity', () => {
    expect(formatSeverity('unknown')).toBe('Unknown [?]');
  });

  it('capitalizes first letter of mixed case input', () => {
    expect(formatSeverity('CRITICAL')).toBe('Critical [!!!]');
  });
});
