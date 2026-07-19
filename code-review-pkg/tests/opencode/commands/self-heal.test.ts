import { describe, it, expect, beforeEach } from 'vitest';
import {
  SelfHealer,
  healFinding,
  autoHealFindings,
  buildInHealingRules,
} from '../../../src/self-healer.js';
import type { HealingRule, HealResult, AutoHealResult, HealAction } from '../../../src/self-healer.js';
import type { Finding } from '../../../src/types.js';

function makeFinding(partial: Partial<Finding> = {}): Finding {
  return {
    file: 'src/index.ts',
    line: 10,
    severity: 'low',
    category: 'quality',
    message: 'test finding',
    confidence: 0.8,
    source: 'rule',
    ...partial,
  };
}

// ==================== buildInHealingRules ====================

describe('buildInHealingRules', () => {
  it('返回 5 条内置规则', () => {
    const rules = buildInHealingRules();
    expect(rules).toHaveLength(5);
  });

  it('每条规则包含完整字段', () => {
    const rules = buildInHealingRules();
    for (const rule of rules) {
      expect(typeof rule.id).toBe('string');
      expect(typeof rule.name).toBe('string');
      expect(typeof rule.match).toBe('function');
      expect(typeof rule.apply).toBe('function');
      expect(['augment-suggestion', 'downgrade-severity', 'add-fix-hint']).toContain(rule.action);
    }
  });

  it('包含 unused import 规则', () => {
    const rules = buildInHealingRules();
    expect(rules.some((r) => r.id === 'rule-unused-import')).toBe(true);
  });

  it('包含 unused variable 规则', () => {
    const rules = buildInHealingRules();
    expect(rules.some((r) => r.id === 'rule-unused-variable')).toBe(true);
  });

  it('包含 missing semicolon 规则', () => {
    const rules = buildInHealingRules();
    expect(rules.some((r) => r.id === 'rule-missing-semicolon')).toBe(true);
  });

  it('包含 trailing whitespace 规则', () => {
    const rules = buildInHealingRules();
    expect(rules.some((r) => r.id === 'rule-trailing-whitespace')).toBe(true);
  });

  it('包含 missing newline 规则', () => {
    const rules = buildInHealingRules();
    expect(rules.some((r) => r.id === 'rule-missing-newline')).toBe(true);
  });

  it('返回的是新数组，外部修改不影响后续调用', () => {
    const rules1 = buildInHealingRules();
    rules1.push({
      id: 'hacked',
      name: 'hacked',
      match: () => false,
      action: 'add-fix-hint',
      apply: (f) => f,
    });
    const rules2 = buildInHealingRules();
    expect(rules2).toHaveLength(5);
    expect(rules2.some((r) => r.id === 'hacked')).toBe(false);
  });
});

// ==================== SelfHealer 类 ====================

describe('SelfHealer', () => {
  let healer: SelfHealer;

  beforeEach(() => {
    healer = new SelfHealer();
  });

  describe('构造器', () => {
    it('默认使用内置规则', () => {
      const rules = healer.getRules();
      expect(rules).toHaveLength(5);
    });

    it('customRules 完全覆盖内置规则', () => {
      const custom: HealingRule[] = [
        {
          id: 'custom-1',
          name: '自定义规则',
          match: (f) => f.severity === 'low',
          action: 'add-fix-hint',
          apply: (f) => ({ ...f, suggestion: 'custom hint' }),
        },
      ];
      const h = new SelfHealer({ customRules: custom });
      expect(h.getRules()).toHaveLength(1);
      expect(h.getRules()[0].id).toBe('custom-1');
    });

    it('extraRules 追加到内置规则之前（优先级更高）', () => {
      const extra: HealingRule[] = [
        {
          id: 'extra-1',
          name: '额外规则',
          match: () => false,
          action: 'add-fix-hint',
          apply: (f) => f,
        },
      ];
      const h = new SelfHealer({ extraRules: extra });
      const rules = h.getRules();
      expect(rules).toHaveLength(6);
      expect(rules[0].id).toBe('extra-1');
    });

    it('historyLimit 默认 100', () => {
      // 通过批量调用超过 100 次验证
      const f = makeFinding({ message: 'unrelated message' });
      for (let i = 0; i < 150; i++) {
        healer.healFinding(f);
      }
      expect(healer.getHistory().length).toBeLessThanOrEqual(100);
    });

    it('historyLimit 可自定义', () => {
      const h = new SelfHealer({ historyLimit: 3 });
      const f = makeFinding({ message: 'unrelated' });
      for (let i = 0; i < 10; i++) {
        h.healFinding(f);
      }
      expect(h.getHistory()).toHaveLength(3);
    });
  });

  describe('healFinding', () => {
    it('匹配 unused import — 增强 suggestion', () => {
      const f = makeFinding({ message: 'Unused import: lodash' });
      const result = healer.healFinding(f);
      expect(result.healed).toBe(true);
      expect(result.ruleId).toBe('rule-unused-import');
      expect(result.action).toBe('augment-suggestion');
      expect(result.finding.suggestion).toContain('Remove the unused import');
      expect(result.finding.suggestion).toContain('[auto-healed]');
      expect(result.finding.suggestion).toContain(String(f.line));
    });

    it('匹配 unused variable — 增强 suggestion', () => {
      const f = makeFinding({ message: 'Unused variable: foo' });
      const result = healer.healFinding(f);
      expect(result.healed).toBe(true);
      expect(result.ruleId).toBe('rule-unused-variable');
      expect(result.finding.suggestion).toContain('Delete the unused variable');
      expect(result.finding.suggestion).toContain('[auto-healed]');
    });

    it('匹配 missing semicolon — 增强 suggestion', () => {
      const f = makeFinding({ message: 'Missing semicolon at end of statement' });
      const result = healer.healFinding(f);
      expect(result.healed).toBe(true);
      expect(result.ruleId).toBe('rule-missing-semicolon');
      expect(result.finding.suggestion).toContain('Add a semicolon');
      expect(result.finding.suggestion).toContain(String(f.line));
    });

    it('匹配 trailing whitespace — 增强 suggestion', () => {
      const f = makeFinding({ message: 'Trailing whitespace detected' });
      const result = healer.healFinding(f);
      expect(result.healed).toBe(true);
      expect(result.ruleId).toBe('rule-trailing-whitespace');
      expect(result.finding.suggestion).toContain('Remove trailing whitespace');
      expect(result.finding.suggestion).toContain(String(f.line));
    });

    it('匹配 missing newline — 增强 suggestion', () => {
      const f = makeFinding({ message: 'Missing newline at end of file' });
      const result = healer.healFinding(f);
      expect(result.healed).toBe(true);
      expect(result.ruleId).toBe('rule-missing-newline');
      expect(result.finding.suggestion).toContain('Add a newline');
      expect(result.finding.suggestion).toContain(f.file);
    });

    it('不匹配任何规则时返回原 finding，healed=false', () => {
      const f = makeFinding({ message: 'some unrelated issue' });
      const result = healer.healFinding(f);
      expect(result.healed).toBe(false);
      expect(result.ruleId).toBeUndefined();
      expect(result.action).toBeUndefined();
      // 原对象引用应保持
      expect(result.finding).toBe(f);
    });

    it('severity 非 low 时不触发自愈', () => {
      const f = makeFinding({ severity: 'high', message: 'Unused import: lodash' });
      const result = healer.healFinding(f);
      expect(result.healed).toBe(false);
    });

    it('severity=medium 时不触发自愈', () => {
      const f = makeFinding({ severity: 'medium', message: 'Unused variable: foo' });
      const result = healer.healFinding(f);
      expect(result.healed).toBe(false);
    });

    it('大小写不敏感匹配', () => {
      const f = makeFinding({ message: 'UNUSED IMPORT: lodash' });
      const result = healer.healFinding(f);
      expect(result.healed).toBe(true);
      expect(result.ruleId).toBe('rule-unused-import');
    });

    it('首个匹配的规则生效（按顺序）', () => {
      // 构造一个能匹配多条规则的 finding（通过自定义规则）
      const custom: HealingRule[] = [
        {
          id: 'first-rule',
          name: 'first',
          match: () => true,
          action: 'add-fix-hint',
          apply: (f) => ({ ...f, suggestion: 'first' }),
        },
        {
          id: 'second-rule',
          name: 'second',
          match: () => true,
          action: 'add-fix-hint',
          apply: (f) => ({ ...f, suggestion: 'second' }),
        },
      ];
      const h = new SelfHealer({ customRules: custom });
      const f = makeFinding({ message: 'unused import' });
      const result = h.healFinding(f);
      expect(result.ruleId).toBe('first-rule');
      expect(result.finding.suggestion).toBe('first');
    });

    it('match 抛错时跳过该规则，继续尝试下一个', () => {
      const custom: HealingRule[] = [
        {
          id: 'throwing-match',
          name: 'throwing',
          match: () => {
            throw new Error('match error');
          },
          action: 'add-fix-hint',
          apply: (f) => ({ ...f, suggestion: 'should not apply' }),
        },
        {
          id: 'fallback-rule',
          name: 'fallback',
          match: (f) => f.severity === 'low',
          action: 'add-fix-hint',
          apply: (f) => ({ ...f, suggestion: 'fallback applied' }),
        },
      ];
      const h = new SelfHealer({ customRules: custom });
      const f = makeFinding({ message: 'unused import' });
      const result = h.healFinding(f);
      expect(result.healed).toBe(true);
      expect(result.ruleId).toBe('fallback-rule');
    });

    it('apply 抛错时跳过该规则，继续尝试下一个', () => {
      const custom: HealingRule[] = [
        {
          id: 'throwing-apply',
          name: 'throwing',
          match: () => true,
          action: 'add-fix-hint',
          apply: () => {
            throw new Error('apply error');
          },
        },
        {
          id: 'fallback-rule',
          name: 'fallback',
          match: () => true,
          action: 'add-fix-hint',
          apply: (f) => ({ ...f, suggestion: 'fallback applied' }),
        },
      ];
      const h = new SelfHealer({ customRules: custom });
      const f = makeFinding({ message: 'unused import' });
      const result = h.healFinding(f);
      expect(result.healed).toBe(true);
      expect(result.ruleId).toBe('fallback-rule');
    });

    it('原 finding 不被修改（返回新对象）', () => {
      const f = makeFinding({ message: 'Unused import: lodash', suggestion: 'original' });
      const originalSuggestion = f.suggestion;
      healer.healFinding(f);
      expect(f.suggestion).toBe(originalSuggestion);
    });

    it('reason 包含触发的规则 id', () => {
      const f = makeFinding({ message: 'Unused import: lodash' });
      const result = healer.healFinding(f);
      expect(result.reason).toContain('rule-unused-import');
    });
  });

  describe('autoHealFindings', () => {
    it('空数组返回空结果', () => {
      const result = healer.autoHealFindings([]);
      expect(result.findings).toEqual([]);
      expect(result.healedCount).toBe(0);
      expect(result.ruleCounts).toEqual({});
      expect(result.details).toEqual([]);
    });

    it('null/undefined 输入返回空结果', () => {
      // @ts-expect-error 故意传入 null
      const result = healer.autoHealFindings(null);
      expect(result.findings).toEqual([]);
      expect(result.healedCount).toBe(0);
    });

    it('批量处理：混合可自愈与不可自愈的 findings', () => {
      const findings = [
        makeFinding({ message: 'Unused import: lodash', line: 1 }),
        makeFinding({ message: 'some unrelated issue', line: 2 }),
        makeFinding({ message: 'Unused variable: foo', line: 3 }),
        makeFinding({ message: 'Missing semicolon', line: 4 }),
      ];
      const result = healer.autoHealFindings(findings);

      expect(result.findings).toHaveLength(4);
      expect(result.healedCount).toBe(3);
      expect(result.details).toHaveLength(4);

      // 顺序保持
      expect(result.findings[0].line).toBe(1);
      expect(result.findings[1].line).toBe(2);
      expect(result.findings[2].line).toBe(3);
      expect(result.findings[3].line).toBe(4);

      // 第 1, 3, 4 被自愈
      expect(result.details[0].healed).toBe(true);
      expect(result.details[1].healed).toBe(false);
      expect(result.details[2].healed).toBe(true);
      expect(result.details[3].healed).toBe(true);
    });

    it('ruleCounts 统计各规则触发次数', () => {
      const findings = [
        makeFinding({ message: 'Unused import: a' }),
        makeFinding({ message: 'Unused import: b' }),
        makeFinding({ message: 'Unused variable: c' }),
      ];
      const result = healer.autoHealFindings(findings);
      expect(result.ruleCounts['rule-unused-import']).toBe(2);
      expect(result.ruleCounts['rule-unused-variable']).toBe(1);
    });

    it('全部不可自愈时 healedCount=0', () => {
      const findings = [
        makeFinding({ message: 'complex security issue' }),
        makeFinding({ message: 'logic bug' }),
      ];
      const result = healer.autoHealFindings(findings);
      expect(result.healedCount).toBe(0);
      expect(result.ruleCounts).toEqual({});
    });

    it('全部可自愈时 healedCount=总数', () => {
      const findings = [
        makeFinding({ message: 'Unused import: a' }),
        makeFinding({ message: 'Unused variable: b' }),
        makeFinding({ message: 'Missing semicolon' }),
        makeFinding({ message: 'Trailing whitespace' }),
        makeFinding({ message: 'Missing newline' }),
      ];
      const result = healer.autoHealFindings(findings);
      expect(result.healedCount).toBe(5);
    });

    it('details 顺序与输入一致', () => {
      const findings = [
        makeFinding({ message: 'Unused import: a', line: 100 }),
        makeFinding({ message: 'Unused variable: b', line: 200 }),
      ];
      const result = healer.autoHealFindings(findings);
      expect(result.details[0].finding.line).toBe(100);
      expect(result.details[1].finding.line).toBe(200);
    });

    it('保留 findings 的原始顺序', () => {
      const findings = [
        makeFinding({ message: 'Unused import: a', line: 1 }),
        makeFinding({ message: 'unrelated', line: 2 }),
        makeFinding({ message: 'Unused import: b', line: 3 }),
      ];
      const result = healer.autoHealFindings(findings);
      const lines = result.findings.map((f) => f.line);
      expect(lines).toEqual([1, 2, 3]);
    });
  });

  describe('历史记录', () => {
    it('healFinding 触发后记录到历史', () => {
      const f = makeFinding({ message: 'Unused import: lodash' });
      healer.healFinding(f);
      expect(healer.getHistory()).toHaveLength(1);
      expect(healer.getHistory()[0].healed).toBe(true);
    });

    it('未自愈的 finding 也记录到历史', () => {
      const f = makeFinding({ message: 'unrelated' });
      healer.healFinding(f);
      expect(healer.getHistory()).toHaveLength(1);
      expect(healer.getHistory()[0].healed).toBe(false);
    });

    it('clearHistory 清空历史', () => {
      const f = makeFinding({ message: 'Unused import: lodash' });
      healer.healFinding(f);
      expect(healer.getHistory()).toHaveLength(1);
      healer.clearHistory();
      expect(healer.getHistory()).toHaveLength(0);
    });

    it('历史记录超过上限时 FIFO 移除最旧的', () => {
      const h = new SelfHealer({ historyLimit: 2 });
      h.healFinding(makeFinding({ message: 'Unused import: a', line: 1 }));
      h.healFinding(makeFinding({ message: 'Unused import: b', line: 2 }));
      h.healFinding(makeFinding({ message: 'Unused import: c', line: 3 }));
      const history = h.getHistory();
      expect(history).toHaveLength(2);
      // 应保留最新的两条
      expect(history[0].finding.line).toBe(2);
      expect(history[1].finding.line).toBe(3);
    });

    it('getHistory 返回副本，外部修改不影响内部', () => {
      healer.healFinding(makeFinding({ message: 'Unused import: a' }));
      const h1 = healer.getHistory();
      h1.pop();
      const h2 = healer.getHistory();
      expect(h2).toHaveLength(1);
    });
  });

  describe('getRules', () => {
    it('返回副本，外部修改不影响内部', () => {
      const rules = healer.getRules();
      rules.push({
        id: 'hacked',
        name: 'hacked',
        match: () => false,
        action: 'add-fix-hint',
        apply: (f) => f,
      });
      const rules2 = healer.getRules();
      expect(rules2).toHaveLength(5);
      expect(rules2.some((r) => r.id === 'hacked')).toBe(false);
    });
  });
});

// ==================== 便捷函数 ====================

describe('healFinding 便捷函数', () => {
  it('不传 healer 时使用默认 SelfHealer', () => {
    const f = makeFinding({ message: 'Unused import: lodash' });
    const result = healFinding(f);
    expect(result.healed).toBe(true);
    expect(result.ruleId).toBe('rule-unused-import');
  });

  it('传入 healer 时复用实例', () => {
    const healer = new SelfHealer();
    const f = makeFinding({ message: 'Unused import: lodash' });
    healFinding(f, healer);
    expect(healer.getHistory()).toHaveLength(1);
  });

  it('不匹配规则时返回原 finding', () => {
    const f = makeFinding({ message: 'unrelated issue' });
    const result = healFinding(f);
    expect(result.healed).toBe(false);
    expect(result.finding).toBe(f);
  });
});

describe('autoHealFindings 便捷函数', () => {
  it('不传 healer 时使用默认 SelfHealer', () => {
    const findings = [
      makeFinding({ message: 'Unused import: lodash' }),
      makeFinding({ message: 'Unused variable: foo' }),
    ];
    const result = autoHealFindings(findings);
    expect(result.healedCount).toBe(2);
    expect(result.findings).toHaveLength(2);
  });

  it('传入 healer 时复用实例', () => {
    const healer = new SelfHealer();
    const findings = [makeFinding({ message: 'Unused import: lodash' })];
    autoHealFindings(findings, healer);
    expect(healer.getHistory()).toHaveLength(1);
  });

  it('空数组返回空结果', () => {
    const result = autoHealFindings([]);
    expect(result.findings).toEqual([]);
    expect(result.healedCount).toBe(0);
  });

  it('返回 AutoHealResult 结构', () => {
    const findings = [makeFinding({ message: 'Unused import: lodash' })];
    const result = autoHealFindings(findings);
    expect(result).toHaveProperty('findings');
    expect(result).toHaveProperty('healedCount');
    expect(result).toHaveProperty('ruleCounts');
    expect(result).toHaveProperty('details');
  });
});

// ==================== 类型导出验证 ====================

describe('类型导出', () => {
  it('HealAction 类型包含 augment-suggestion', () => {
    const action: HealAction = 'augment-suggestion';
    expect(action).toBe('augment-suggestion');
  });

  it('HealAction 类型包含 downgrade-severity', () => {
    const action: HealAction = 'downgrade-severity';
    expect(action).toBe('downgrade-severity');
  });

  it('HealAction 类型包含 add-fix-hint', () => {
    const action: HealAction = 'add-fix-hint';
    expect(action).toBe('add-fix-hint');
  });

  it('HealResult 结构正确', () => {
    const result: HealResult = {
      finding: makeFinding(),
      healed: true,
      ruleId: 'rule-x',
      action: 'augment-suggestion',
      reason: 'matched',
    };
    expect(result.healed).toBe(true);
  });

  it('AutoHealResult 结构正确', () => {
    const result: AutoHealResult = {
      findings: [makeFinding()],
      healedCount: 1,
      ruleCounts: { 'rule-x': 1 },
      details: [],
    };
    expect(result.healedCount).toBe(1);
  });

  it('HealingRule 结构正确', () => {
    const rule: HealingRule = {
      id: 'test-rule',
      name: 'Test',
      match: () => false,
      action: 'add-fix-hint',
      apply: (f) => f,
    };
    expect(rule.id).toBe('test-rule');
  });
});
