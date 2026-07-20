import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ComplianceChecker,
  checkCompliance,
  OWASP_TOP_10,
  CWE_TOP_25,
} from '../../../src/compliance-checker.js';
import type {
  ComplianceReport,
  ComplianceMapping,
  OwaspCategory,
  CweEntry,
  CustomMapping,
  OwaspCategoryId,
  OwaspCategoryStat,
} from '../../../src/compliance-checker.js';
import type { Finding } from '../../../src/types.js';

function makeFinding(partial: Partial<Finding> = {}): Finding {
  return {
    file: 'src/app.ts',
    line: 10,
    severity: 'high',
    category: 'security',
    message: 'test finding',
    confidence: 0.8,
    source: 'rule',
    ...partial,
  };
}

// ---- CLI 测试辅助 ----

interface TestState {
  stdin: string;
  exitError: Error | null;
  stdout: string[];
  stderr: string[];
}

const testState: TestState = {
  stdin: '',
  exitError: null,
  stdout: [],
  stderr: [],
};

// Mock readFileSync 以从 testState.stdin 读取 fd=0 输入
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn((...args: unknown[]) => {
      const fd = args[0];
      if (fd === 0 || fd === '0') {
        return testState.stdin;
      }
      return (actual.readFileSync as (...a: unknown[]) => unknown)(...args);
    }),
  };
});

async function loadCli(opts: {
  argv: string[];
  stdin?: string;
}): Promise<{
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}> {
  const { argv, stdin = '' } = opts;

  testState.stdin = stdin;
  testState.exitError = null;
  testState.stdout = [];
  testState.stderr = [];

  const origArgv = process.argv;
  process.argv = ['node', '/tmp/cli.js', ...argv];

  vi.resetModules();

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    testState.stdout.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    testState.stderr.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });

  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    const err = new Error(`__PROCESS_EXIT_${code ?? 0}__`);
    testState.exitError = err;
    throw err;
  }) as never);

  try {
    await import('../../../src/cli.js');
    return {
      stdout: [...testState.stdout],
      stderr: [...testState.stderr],
      exitCode: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const match = msg.match(/^__PROCESS_EXIT_(\d+)__$/);
    if (match) {
      return {
        stdout: [...testState.stdout],
        stderr: [...testState.stderr],
        exitCode: parseInt(match[1], 10),
      };
    }
    throw err;
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    process.argv = origArgv;
    vi.resetModules();
  }
}

// ==================== OWASP_TOP_10 常量 ====================

describe('OWASP_TOP_10 常量', () => {
  it('包含 10 个类别', () => {
    expect(OWASP_TOP_10).toHaveLength(10);
  });

  it('包含 A01 - Broken Access Control', () => {
    const a01 = OWASP_TOP_10.find((c) => c.id === 'A01');
    expect(a01).toBeDefined();
    expect(a01?.name).toBe('Broken Access Control');
    expect(a01?.fullId).toBe('A01:2021');
  });

  it('包含 A03 - Injection', () => {
    const a03 = OWASP_TOP_10.find((c) => c.id === 'A03');
    expect(a03).toBeDefined();
    expect(a03?.name).toBe('Injection');
  });

  it('包含 A10 - SSRF', () => {
    const a10 = OWASP_TOP_10.find((c) => c.id === 'A10');
    expect(a10).toBeDefined();
    expect(a10?.name).toBe('Server-Side Request Forgery (SSRF)');
  });

  it('每个类别包含 id / fullId / name / chineseName / keywords / cweIds', () => {
    for (const cat of OWASP_TOP_10) {
      expect(cat.id).toBeTruthy();
      expect(cat.fullId).toBeTruthy();
      expect(cat.name).toBeTruthy();
      expect(cat.chineseName).toBeTruthy();
      expect(Array.isArray(cat.keywords)).toBe(true);
      expect(cat.keywords.length).toBeGreaterThan(0);
      expect(Array.isArray(cat.cweIds)).toBe(true);
    }
  });

  it('类别 ID 从 A01 到 A10', () => {
    const ids = OWASP_TOP_10.map((c) => c.id);
    expect(ids).toEqual(['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10']);
  });

  it('每个类别有关联的 CWE ID', () => {
    for (const cat of OWASP_TOP_10) {
      expect(cat.cweIds.length).toBeGreaterThan(0);
    }
  });
});

// ==================== CWE_TOP_25 常量 ====================

describe('CWE_TOP_25 常量', () => {
  it('包含 25 个条目', () => {
    expect(CWE_TOP_25).toHaveLength(25);
  });

  it('包含 CWE-79 (XSS)', () => {
    const cwe79 = CWE_TOP_25.find((c) => c.id === 'CWE-79');
    expect(cwe79).toBeDefined();
    expect(cwe79?.name).toContain('XSS');
  });

  it('包含 CWE-89 (SQL Injection)', () => {
    const cwe89 = CWE_TOP_25.find((c) => c.id === 'CWE-89');
    expect(cwe89).toBeDefined();
    expect(cwe89?.name).toContain('SQL');
  });

  it('包含 CWE-22 (Path Traversal)', () => {
    const cwe22 = CWE_TOP_25.find((c) => c.id === 'CWE-22');
    expect(cwe22).toBeDefined();
    expect(cwe22?.name).toContain('Path Traversal');
  });

  it('包含 CWE-502 (Deserialization)', () => {
    const cwe502 = CWE_TOP_25.find((c) => c.id === 'CWE-502');
    expect(cwe502).toBeDefined();
    expect(cwe502?.name).toContain('Deserialization');
  });

  it('每个条目包含 id / name / keywords', () => {
    for (const cwe of CWE_TOP_25) {
      expect(cwe.id).toMatch(/^CWE-\d+$/);
      expect(cwe.name).toBeTruthy();
      expect(Array.isArray(cwe.keywords)).toBe(true);
      expect(cwe.keywords.length).toBeGreaterThan(0);
    }
  });

  it('CWE ID 唯一', () => {
    const ids = CWE_TOP_25.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('大部分 CWE 条目关联到 OWASP 类别', () => {
    const withOwasp = CWE_TOP_25.filter((c) => c.owaspId !== undefined);
    expect(withOwasp.length).toBeGreaterThan(15);
  });
});

// ==================== ComplianceChecker 类 ====================

describe('ComplianceChecker', () => {
  let checker: ComplianceChecker;

  beforeEach(() => {
    checker = new ComplianceChecker();
  });

  describe('构造器', () => {
    it('默认使用内置 OWASP/CWE 列表', () => {
      expect(checker.getOwaspCategories()).toHaveLength(10);
      expect(checker.getCweEntries()).toHaveLength(25);
    });

    it('默认无自定义映射', () => {
      expect(checker.getCustomMappings()).toEqual([]);
    });

    it('支持自定义映射', () => {
      const mappings: CustomMapping[] = [
        { category: 'custom-cat', owaspId: 'A04', cweIds: ['CWE-20'] },
      ];
      const c = new ComplianceChecker({ customMappings: mappings });
      expect(c.getCustomMappings()).toHaveLength(1);
    });

    it('支持自定义 OWASP/CWE 列表', () => {
      const customOwasp: OwaspCategory[] = [
        {
          id: 'A01',
          fullId: 'A01:2021',
          name: 'Custom',
          chineseName: '自定义',
          keywords: ['custom-kw'],
          cweIds: ['CWE-1'],
        },
      ];
      const c = new ComplianceChecker({ owaspCategories: customOwasp });
      expect(c.getOwaspCategories()).toHaveLength(1);
    });
  });

  describe('mapFinding - OWASP 类别匹配', () => {
    it('SQL Injection finding 映射到 A03', () => {
      const f = makeFinding({ category: 'security', message: 'SQL injection detected', ruleId: 'sql-injection' });
      const result = checker.mapFinding(f);
      expect(result.owaspId).toBe('A03');
      expect(result.cweIds).toContain('CWE-89');
    });

    it('XSS finding 映射到 A03', () => {
      const f = makeFinding({ message: 'Cross-site scripting (XSS) vulnerability', ruleId: 'xss' });
      const result = checker.mapFinding(f);
      expect(result.owaspId).toBe('A03');
      expect(result.cweIds).toContain('CWE-79');
    });

    it('Hardcoded secret finding 映射到 A02', () => {
      const f = makeFinding({ message: 'Hardcoded secret detected', ruleId: 'hardcoded-secret' });
      const result = checker.mapFinding(f);
      expect(result.owaspId).toBe('A02');
      expect(result.cweIds).toContain('CWE-798');
    });

    it('Missing authorization finding 映射到 A01', () => {
      const f = makeFinding({ message: 'Missing authorization on admin endpoint', ruleId: 'missing-authz' });
      const result = checker.mapFinding(f);
      expect(result.owaspId).toBe('A01');
      expect(result.cweIds).toContain('CWE-862');
    });

    it('SSRF finding 映射到 A10', () => {
      const f = makeFinding({ message: 'Server-Side Request Forgery (SSRF) detected', ruleId: 'ssrf' });
      const result = checker.mapFinding(f);
      expect(result.owaspId).toBe('A10');
      expect(result.cweIds).toContain('CWE-918');
    });

    it('Deserialization finding 映射到 A08', () => {
      const f = makeFinding({ message: 'Unsafe deserialization of untrusted data', ruleId: 'deserialization' });
      const result = checker.mapFinding(f);
      expect(result.owaspId).toBe('A08');
      expect(result.cweIds).toContain('CWE-502');
    });

    it('Path traversal finding 映射到 A01', () => {
      const f = makeFinding({ message: 'Path traversal vulnerability', ruleId: 'path-traversal' });
      const result = checker.mapFinding(f);
      expect(result.owaspId).toBe('A01');
      expect(result.cweIds).toContain('CWE-22');
    });

    it('XXE finding 映射到 A05', () => {
      const f = makeFinding({ message: 'XML External Entity (XXE) injection', ruleId: 'xxe' });
      const result = checker.mapFinding(f);
      expect(result.owaspId).toBe('A05');
      expect(result.cweIds).toContain('CWE-611');
    });

    it('未匹配的 finding owaspId 为 undefined', () => {
      const f = makeFinding({ message: 'unrelated quality issue', ruleId: 'style-naming' });
      const result = checker.mapFinding(f);
      expect(result.owaspId).toBeUndefined();
    });
  });

  describe('mapFinding - 关键词大小写不敏感', () => {
    it('SQL Injection 大小写不敏感匹配', () => {
      const f = makeFinding({ message: 'SQL INJECTION DETECTED', ruleId: 'SQL-INJECTION' });
      const result = checker.mapFinding(f);
      expect(result.owaspId).toBe('A03');
    });

    it('XSS 大小写不敏感匹配', () => {
      const f = makeFinding({ message: 'detected XSS vulnerability' });
      const result = checker.mapFinding(f);
      expect(result.owaspId).toBe('A03');
    });
  });

  describe('mapFinding - 自定义映射', () => {
    it('自定义映射按 category 精确匹配', () => {
      const custom: CustomMapping[] = [
        { category: 'business-logic', owaspId: 'A04', cweIds: ['CWE-837'] },
      ];
      const c = new ComplianceChecker({ customMappings: custom });
      const f = makeFinding({ category: 'business-logic', message: 'some issue' });
      const result = c.mapFinding(f);
      expect(result.owaspId).toBe('A04');
      expect(result.cweIds).toContain('CWE-837');
      expect(result.matchedKeywords).toContain('custom-mapping');
    });

    it('自定义映射按 ruleId 精确匹配', () => {
      const custom: CustomMapping[] = [
        { ruleId: 'CUSTOM-001', owaspId: 'A06' },
      ];
      const c = new ComplianceChecker({ customMappings: custom });
      const f = makeFinding({ ruleId: 'CUSTOM-001', message: 'some issue' });
      const result = c.mapFinding(f);
      expect(result.owaspId).toBe('A06');
    });

    it('自定义映射按 messageContains 子串匹配', () => {
      const custom: CustomMapping[] = [
        { messageContains: 'deprecated', owaspId: 'A06' },
      ];
      const c = new ComplianceChecker({ customMappings: custom });
      const f = makeFinding({ message: 'Using deprecated package "old-lib"' });
      const result = c.mapFinding(f);
      expect(result.owaspId).toBe('A06');
    });

    it('自定义映射优先级高于关键词匹配', () => {
      // 自定义映射将 SQL injection 归到 A04
      const custom: CustomMapping[] = [
        { messageContains: 'SQL', owaspId: 'A04' },
      ];
      const c = new ComplianceChecker({ customMappings: custom });
      const f = makeFinding({ message: 'SQL injection detected' });
      const result = c.mapFinding(f);
      expect(result.owaspId).toBe('A04');
    });

    it('自定义映射组合 category + ruleId', () => {
      const custom: CustomMapping[] = [
        { category: 'security', ruleId: 'CUSTOM-001', owaspId: 'A05' },
      ];
      const c = new ComplianceChecker({ customMappings: custom });
      const f1 = makeFinding({ category: 'security', ruleId: 'CUSTOM-001' });
      const f2 = makeFinding({ category: 'security', ruleId: 'OTHER' });
      expect(c.mapFinding(f1).owaspId).toBe('A05');
      // f2 不匹配 ruleId，自定义映射不生效，但 security 关键词未在 A05 列表中
      // 注意：f2 没有任何关键词匹配，但 'security' 不在任何 OWASP 关键词列表中
      expect(c.mapFinding(f2).owaspId).toBeUndefined();
    });
  });

  describe('mapFinding - 返回结果', () => {
    it('返回的 finding 是副本', () => {
      const f = makeFinding({ message: 'SQL injection' });
      const result = checker.mapFinding(f);
      result.finding.message = 'modified';
      expect(f.message).toBe('SQL injection');
    });

    it('matchedKeywords 包含触发的关键词', () => {
      const f = makeFinding({ message: 'SQL injection', ruleId: 'sql-injection' });
      const result = checker.mapFinding(f);
      expect(result.matchedKeywords.length).toBeGreaterThan(0);
    });

    it('未匹配任何规则时 cweIds 为空数组', () => {
      const f = makeFinding({ message: 'unrelated issue' });
      const result = checker.mapFinding(f);
      expect(result.cweIds).toEqual([]);
      expect(result.matchedKeywords).toEqual([]);
    });
  });

  describe('checkCompliance', () => {
    it('空 findings 返回零值报告', () => {
      const report = checker.checkCompliance([]);
      expect(report.totalFindings).toBe(0);
      expect(report.mappedFindings).toBe(0);
      expect(report.unmappedFindings).toBe(0);
      expect(report.owaspCoverage).toBe(0);
      expect(report.categories).toEqual([]);
    });

    it('报告 totalFindings 与输入一致', () => {
      const findings = [
        makeFinding({ message: 'SQL injection' }),
        makeFinding({ message: 'XSS vulnerability' }),
        makeFinding({ message: 'unrelated issue' }),
      ];
      const report = checker.checkCompliance(findings);
      expect(report.totalFindings).toBe(3);
    });

    it('mappedFindings 统计已映射的 findings 数', () => {
      const findings = [
        makeFinding({ message: 'SQL injection' }),
        makeFinding({ message: 'XSS vulnerability' }),
        makeFinding({ message: 'unrelated issue' }),
      ];
      const report = checker.checkCompliance(findings);
      expect(report.mappedFindings).toBe(2);
      expect(report.unmappedFindings).toBe(1);
    });

    it('owaspCoverage = mappedFindings / totalFindings', () => {
      const findings = [
        makeFinding({ message: 'SQL injection' }),
        makeFinding({ message: 'XSS vulnerability' }),
        makeFinding({ message: 'unrelated issue' }),
        makeFinding({ message: 'another unrelated' }),
      ];
      const report = checker.checkCompliance(findings);
      expect(report.owaspCoverage).toBeCloseTo(0.5, 5);
    });

    it('全部命中时 owaspCoverage=1', () => {
      const findings = [
        makeFinding({ message: 'SQL injection' }),
        makeFinding({ message: 'XSS vulnerability' }),
      ];
      const report = checker.checkCompliance(findings);
      expect(report.owaspCoverage).toBe(1);
      expect(report.unmappedFindings).toBe(0);
    });

    it('categories 按 findingsCount 降序', () => {
      const findings = [
        makeFinding({ message: 'SQL injection', ruleId: 'sql-injection' }),
        makeFinding({ message: 'XSS vulnerability' }),
        makeFinding({ message: 'Cross-site scripting (XSS)' }),
        makeFinding({ message: 'Hardcoded secret' }),
      ];
      const report = checker.checkCompliance(findings);
      // A03 (injection + xss + xss) = 3, A02 (hardcoded) = 1
      expect(report.categories.length).toBeGreaterThanOrEqual(2);
      expect(report.categories[0].findingsCount).toBeGreaterThanOrEqual(report.categories[1].findingsCount);
      expect(report.categories[0].id).toBe('A03');
    });

    it('category 的 severityDistribution 正确统计', () => {
      const findings = [
        makeFinding({ message: 'SQL injection', severity: 'critical' }),
        makeFinding({ message: 'SQL injection', severity: 'high' }),
        makeFinding({ message: 'SQL injection', severity: 'medium' }),
      ];
      const report = checker.checkCompliance(findings);
      const a03 = report.categories.find((c) => c.id === 'A03');
      expect(a03).toBeDefined();
      expect(a03?.severityDistribution.critical).toBe(1);
      expect(a03?.severityDistribution.high).toBe(1);
      expect(a03?.severityDistribution.medium).toBe(1);
    });

    it('category 的 findings 数组包含所有命中 findings', () => {
      const findings = [
        makeFinding({ message: 'SQL injection', line: 1 }),
        makeFinding({ message: 'XSS vulnerability', line: 2 }),
      ];
      const report = checker.checkCompliance(findings);
      const a03 = report.categories.find((c) => c.id === 'A03');
      expect(a03?.findings).toHaveLength(2);
    });

    it('uncoveredCategories 包含未命中的类别', () => {
      const findings = [makeFinding({ message: 'SQL injection' })];
      const report = checker.checkCompliance(findings);
      expect(report.uncoveredCategories.length).toBeGreaterThan(0);
      // 未命中的类别中不应包含 A03
      expect(report.uncoveredCategories.every((c) => c.id !== 'A03')).toBe(true);
    });

    it('mappings 与输入顺序一致', () => {
      const findings = [
        makeFinding({ message: 'SQL injection', line: 10 }),
        makeFinding({ message: 'XSS vulnerability', line: 20 }),
        makeFinding({ message: 'unrelated', line: 30 }),
      ];
      const report = checker.checkCompliance(findings);
      expect(report.mappings).toHaveLength(3);
      expect(report.mappings[0].finding.line).toBe(10);
      expect(report.mappings[1].finding.line).toBe(20);
      expect(report.mappings[2].finding.line).toBe(30);
    });

    it('matchedCweIds 包含所有匹配到的 CWE（去重）', () => {
      const findings = [
        makeFinding({ message: 'SQL injection' }), // CWE-89
        makeFinding({ message: 'XSS vulnerability' }), // CWE-79
      ];
      const report = checker.checkCompliance(findings);
      expect(report.matchedCweIds).toContain('CWE-89');
      expect(report.matchedCweIds).toContain('CWE-79');
      // 去重
      const unique = new Set(report.matchedCweIds);
      expect(unique.size).toBe(report.matchedCweIds.length);
    });

    it('matchedCweIds 按字典序排序', () => {
      const findings = [
        makeFinding({ message: 'SQL injection' }),
        makeFinding({ message: 'XSS vulnerability' }),
      ];
      const report = checker.checkCompliance(findings);
      for (let i = 1; i < report.matchedCweIds.length; i++) {
        expect(report.matchedCweIds[i - 1] <= report.matchedCweIds[i]).toBe(true);
      }
    });

    it('timestamp 是有效时间戳', () => {
      const before = Date.now();
      const report = checker.checkCompliance([]);
      const after = Date.now();
      expect(report.timestamp).toBeGreaterThanOrEqual(before);
      expect(report.timestamp).toBeLessThanOrEqual(after);
    });

    it('组合多种 findings 类型生成完整报告', () => {
      const findings = [
        makeFinding({ message: 'SQL injection', severity: 'critical', line: 1 }),
        makeFinding({ message: 'XSS vulnerability', severity: 'high', line: 2 }),
        makeFinding({ message: 'Hardcoded secret', severity: 'high', line: 3 }),
        makeFinding({ message: 'Missing authorization', severity: 'medium', line: 4 }),
        makeFinding({ message: 'unrelated quality issue', severity: 'low', line: 5 }),
      ];
      const report = checker.checkCompliance(findings);
      expect(report.totalFindings).toBe(5);
      expect(report.mappedFindings).toBe(4);
      expect(report.unmappedFindings).toBe(1);
      expect(report.owaspCoverage).toBeCloseTo(0.8, 5);
      // 至少覆盖 3 个 OWASP 类别
      expect(report.categories.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('getOwaspCategories / getCweEntries / getCustomMappings', () => {
    it('getOwaspCategories 返回副本', () => {
      const cats = checker.getOwaspCategories();
      cats.push({
        id: 'A99',
        fullId: 'A99',
        name: 'fake',
        chineseName: 'fake',
        keywords: [],
        cweIds: [],
      });
      expect(checker.getOwaspCategories()).toHaveLength(10);
    });

    it('getCweEntries 返回副本', () => {
      const cwes = checker.getCweEntries();
      cwes.push({ id: 'CWE-999', name: 'fake', keywords: [] });
      expect(checker.getCweEntries()).toHaveLength(25);
    });

    it('getCustomMappings 返回副本', () => {
      const c = new ComplianceChecker({
        customMappings: [{ category: 'x', owaspId: 'A01' }],
      });
      const mappings = c.getCustomMappings();
      mappings.push({ category: 'y', owaspId: 'A02' });
      expect(c.getCustomMappings()).toHaveLength(1);
    });
  });
});

// ==================== 便捷函数 ====================

describe('checkCompliance 便捷函数', () => {
  it('不传 checker 时使用默认 ComplianceChecker', () => {
    const findings = [makeFinding({ message: 'SQL injection' })];
    const report = checkCompliance(findings);
    expect(report.totalFindings).toBe(1);
    expect(report.mappedFindings).toBe(1);
  });

  it('传入 checker 时复用实例', () => {
    const checker = new ComplianceChecker();
    const findings = [makeFinding({ message: 'SQL injection' })];
    const report = checkCompliance(findings, checker);
    expect(report.totalFindings).toBe(1);
  });

  it('空数组返回空报告', () => {
    const report = checkCompliance([]);
    expect(report.totalFindings).toBe(0);
  });
});

// ==================== 类型导出 ====================

describe('类型导出', () => {
  it('OwaspCategoryId 包含 A01-A10', () => {
    const id: OwaspCategoryId = 'A05';
    expect(id).toBe('A05');
  });

  it('OwaspCategory 结构正确', () => {
    const cat: OwaspCategory = {
      id: 'A01',
      fullId: 'A01:2021',
      name: 'Test',
      chineseName: '测试',
      keywords: ['kw'],
      cweIds: ['CWE-1'],
    };
    expect(cat.id).toBe('A01');
  });

  it('CweEntry 结构正确', () => {
    const cwe: CweEntry = {
      id: 'CWE-79',
      name: 'XSS',
      keywords: ['xss'],
      owaspId: 'A03',
    };
    expect(cwe.id).toBe('CWE-79');
  });

  it('ComplianceMapping 结构正确', () => {
    const mapping: ComplianceMapping = {
      finding: makeFinding(),
      owaspId: 'A03',
      cweIds: ['CWE-89'],
      matchedKeywords: ['sql-injection'],
    };
    expect(mapping.owaspId).toBe('A03');
  });

  it('OwaspCategoryStat 结构正确', () => {
    const stat: OwaspCategoryStat = {
      id: 'A03',
      fullId: 'A03:2021',
      name: 'Injection',
      chineseName: '注入',
      findingsCount: 5,
      severityDistribution: { critical: 1, high: 2, medium: 1, low: 1, info: 0 },
      findings: [],
      cweIds: ['CWE-89'],
    };
    expect(stat.findingsCount).toBe(5);
  });

  it('ComplianceReport 结构正确', () => {
    const report: ComplianceReport = {
      totalFindings: 10,
      mappedFindings: 8,
      unmappedFindings: 2,
      owaspCoverage: 0.8,
      categories: [],
      uncoveredCategories: [],
      mappings: [],
      matchedCweIds: ['CWE-89'],
      timestamp: Date.now(),
    };
    expect(report.totalFindings).toBe(10);
  });

  it('CustomMapping 结构正确', () => {
    const mapping: CustomMapping = {
      category: 'security',
      ruleId: 'SEC001',
      messageContains: 'injection',
      owaspId: 'A03',
      cweIds: ['CWE-89'],
    };
    expect(mapping.owaspId).toBe('A03');
  });
});

// ==================== CLI 集成：compliance 命令 ====================

describe('CLI: compliance 命令', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('从 stdin 读取 findings 并生成合规报告', async () => {
    const findings = [
      makeFinding({ message: 'SQL injection', severity: 'critical' }),
      makeFinding({ message: 'XSS vulnerability', severity: 'high' }),
    ];
    const { stdout, exitCode } = await loadCli({
      argv: ['compliance'],
      stdin: JSON.stringify(findings),
    });

    expect(exitCode).toBeNull();
    const output = stdout.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.totalFindings).toBe(2);
    expect(parsed.mappedFindings).toBe(2);
    expect(parsed.owaspCoverage).toBe(1);
  });

  it('报告包含 categories 字段', async () => {
    const findings = [makeFinding({ message: 'SQL injection' })];
    const { stdout, exitCode } = await loadCli({
      argv: ['compliance'],
      stdin: JSON.stringify(findings),
    });

    expect(exitCode).toBeNull();
    const parsed = JSON.parse(stdout.join('\n'));
    expect(parsed).toHaveProperty('categories');
    expect(Array.isArray(parsed.categories)).toBe(true);
    expect(parsed.categories.length).toBeGreaterThan(0);
  });

  it('报告包含 uncoveredCategories 字段', async () => {
    const findings = [makeFinding({ message: 'SQL injection' })];
    const { stdout, exitCode } = await loadCli({
      argv: ['compliance'],
      stdin: JSON.stringify(findings),
    });

    expect(exitCode).toBeNull();
    const parsed = JSON.parse(stdout.join('\n'));
    expect(parsed).toHaveProperty('uncoveredCategories');
    expect(Array.isArray(parsed.uncoveredCategories)).toBe(true);
    expect(parsed.uncoveredCategories.length).toBeGreaterThan(0);
  });

  it('报告包含 matchedCweIds 字段', async () => {
    const findings = [makeFinding({ message: 'SQL injection' })];
    const { stdout, exitCode } = await loadCli({
      argv: ['compliance'],
      stdin: JSON.stringify(findings),
    });

    expect(exitCode).toBeNull();
    const parsed = JSON.parse(stdout.join('\n'));
    expect(parsed).toHaveProperty('matchedCweIds');
    expect(Array.isArray(parsed.matchedCweIds)).toBe(true);
    expect(parsed.matchedCweIds).toContain('CWE-89');
  });

  it('空 findings 输入返回零值报告', async () => {
    const { stdout, exitCode } = await loadCli({
      argv: ['compliance'],
      stdin: '[]',
    });

    expect(exitCode).toBeNull();
    const parsed = JSON.parse(stdout.join('\n'));
    expect(parsed.totalFindings).toBe(0);
    expect(parsed.mappedFindings).toBe(0);
    expect(parsed.owaspCoverage).toBe(0);
    expect(parsed.categories).toEqual([]);
  });

  it('无效 JSON 输入报错', async () => {
    const { stderr, exitCode } = await loadCli({
      argv: ['compliance'],
      stdin: 'not valid json',
    });

    expect(exitCode).toBe(1);
    expect(stderr.some((s) => s.toLowerCase().includes('invalid') || s.toLowerCase().includes('json'))).toBe(true);
  });
});

// ==================== compliance.md 命令文件 ====================

describe('compliance.md 命令文件', () => {
  const COMMAND_PATH = join(__dirname, '../../../opencode-config/.opencode/commands/compliance.md');

  it('文件存在', () => {
    expect(existsSync(COMMAND_PATH)).toBe(true);
  });

  it('包含 frontmatter 描述', () => {
    const content = readFileSync(COMMAND_PATH, 'utf-8');
    expect(content).toContain('---');
    expect(content).toContain('description:');
    expect(content).toContain('agent: code-reviewer');
  });

  it('声明 compliance 子命令', () => {
    const content = readFileSync(COMMAND_PATH, 'utf-8');
    expect(content).toContain('compliance');
  });

  it('包含 compliance 命令示例', () => {
    const content = readFileSync(COMMAND_PATH, 'utf-8');
    expect(content).toContain('code-review compliance');
  });

  it('包含 OWASP 与 CWE 标准声明', () => {
    const content = readFileSync(COMMAND_PATH, 'utf-8');
    expect(content.toLowerCase()).toContain('owasp');
    expect(content.toLowerCase()).toContain('cwe');
  });
});
