// src/self-healer.ts — Task 9：自愈能力
//
// 职责：
// 1. SelfHealer 类：对已知模式的 finding 自动应用修复建议
// 2. healFinding：对单条 finding 应用匹配的修复规则
// 3. autoHealFindings：批量自动修复 findings
//
// 设计取舍：
// - 自愈规则基于 (category + ruleId + message 模式) 三元组匹配
// - 仅对低风险、确定性的修复模式应用自愈（避免破坏性变更）
// - 自愈操作仅修改 finding.suggestion 字段（增强建议），不修改 finding.severity
// - 自愈失败不影响原 finding（返回原对象）
// - 自愈规则可通过 buildInHealingRules 获取内置规则，或通过 SelfHealer 构造器传入自定义规则
//
// 与 post-process.js 集成：
// - 在 afterReview 中调用 autoHealFindings，对已知模式自动应用建议
// - 仅对未自愈过的 finding 应用，已自愈的保留原状

import type { Finding } from './types.js';

/** 自愈动作类型 */
export type HealAction = 'augment-suggestion' | 'downgrade-severity' | 'add-fix-hint';

/** 单条自愈规则 */
export interface HealingRule {
  /** 规则 ID */
  id: string;
  /** 规则名称 */
  name: string;
  /** 匹配函数：返回 true 表示该规则适用 */
  match: (finding: Finding) => boolean;
  /** 自愈动作 */
  action: HealAction;
  /** 应用的修复内容（如增强后的建议文本） */
  apply: (finding: Finding) => Finding;
}

/** 自愈结果 */
export interface HealResult {
  /** 自愈后的 finding（可能是原对象，也可能是新对象） */
  finding: Finding;
  /** 是否被自愈 */
  healed: boolean;
  /** 触发的规则 ID（未触发时为 undefined） */
  ruleId?: string;
  /** 自愈动作 */
  action?: HealAction;
  /** 自愈原因 */
  reason?: string;
}

/** 批量自愈结果 */
export interface AutoHealResult {
  /** 自愈后的 findings 数组 */
  findings: Finding[];
  /** 被自愈的 finding 数量 */
  healedCount: number;
  /** 各规则触发的次数 */
  ruleCounts: Record<string, number>;
  /** 每条 finding 的自愈详情（顺序与输入一致） */
  details: HealResult[];
}

/** 常见 finding message 中的低风险模式关键词 */
const LOW_RISK_KEYWORDS = [
  'unused import',
  'unused variable',
  'missing semicolon',
  'trailing whitespace',
  'missing newline',
];

/**
 * 判断 finding 是否属于低风险模式（可安全自愈）。
 *
 * 仅匹配 LOW_RISK_KEYWORDS 中的关键词，且 severity=low。
 */
function isLowRiskFinding(finding: Finding): boolean {
  if (finding.severity !== 'low') return false;
  const msg = (finding.message ?? '').toLowerCase();
  return LOW_RISK_KEYWORDS.some((kw) => msg.includes(kw));
}

/**
 * 内置自愈规则集。
 *
 * - rule-unused-import：未使用 import → 建议移除
 * - rule-unused-variable：未使用变量 → 建议删除或前缀下划线
 * - rule-missing-semicolon：缺少分号 → 建议添加
 * - rule-trailing-whitespace：行尾空格 → 建议删除
 * - rule-missing-newline：缺少文件末尾换行 → 建议添加
 */
export function buildInHealingRules(): HealingRule[] {
  return [
    {
      id: 'rule-unused-import',
      name: '未使用 import 自愈',
      match: (f) => isLowRiskFinding(f) && f.message.toLowerCase().includes('unused import'),
      action: 'augment-suggestion',
      apply: (f) => ({
        ...f,
        suggestion: `Remove the unused import statement at line ${f.line}. [auto-healed]`,
      }),
    },
    {
      id: 'rule-unused-variable',
      name: '未使用变量自愈',
      match: (f) => isLowRiskFinding(f) && f.message.toLowerCase().includes('unused variable'),
      action: 'augment-suggestion',
      apply: (f) => ({
        ...f,
        suggestion: `Delete the unused variable or prefix it with underscore if intentionally unused. [auto-healed]`,
      }),
    },
    {
      id: 'rule-missing-semicolon',
      name: '缺少分号自愈',
      match: (f) => isLowRiskFinding(f) && f.message.toLowerCase().includes('missing semicolon'),
      action: 'augment-suggestion',
      apply: (f) => ({
        ...f,
        suggestion: `Add a semicolon at the end of the statement on line ${f.line}. [auto-healed]`,
      }),
    },
    {
      id: 'rule-trailing-whitespace',
      name: '行尾空格自愈',
      match: (f) => isLowRiskFinding(f) && f.message.toLowerCase().includes('trailing whitespace'),
      action: 'augment-suggestion',
      apply: (f) => ({
        ...f,
        suggestion: `Remove trailing whitespace on line ${f.line}. [auto-healed]`,
      }),
    },
    {
      id: 'rule-missing-newline',
      name: '文件末尾换行自愈',
      match: (f) => isLowRiskFinding(f) && f.message.toLowerCase().includes('missing newline'),
      action: 'augment-suggestion',
      apply: (f) => ({
        ...f,
        suggestion: `Add a newline at the end of file ${f.file}. [auto-healed]`,
      }),
    },
  ];
}

/**
 * 自愈器：对 finding 应用匹配的修复规则。
 *
 * 使用方式：
 * 1. new SelfHealer() — 使用内置规则
 * 2. new SelfHealer({ customRules: [...] }) — 仅使用自定义规则
 * 3. new SelfHealer({ extraRules: [...] }) — 在内置规则基础上追加
 * 4. healer.healFinding(finding) — 对单条 finding 应用规则
 * 5. healer.autoHealFindings(findings) — 批量应用
 */
export class SelfHealer {
  /** 自愈规则列表（按顺序匹配，首个匹配的规则生效） */
  private readonly rules: HealingRule[];
  /** 历史自愈记录（最近 N 条） */
  private history: HealResult[] = [];
  /** 历史记录上限 */
  private readonly historyLimit: number;

  constructor(options?: {
    /** 自定义规则（覆盖内置规则） */
    customRules?: HealingRule[];
    /** 追加规则（与内置规则合并，优先级高于内置） */
    extraRules?: HealingRule[];
    /** 历史记录上限（默认 100） */
    historyLimit?: number;
  }) {
    const builtin = buildInHealingRules();
    const extra = options?.extraRules ?? [];
    const custom = options?.customRules;
    // customRules 完全覆盖；否则 extra 优先 + builtin
    this.rules = custom ?? [...extra, ...builtin];
    this.historyLimit = options?.historyLimit ?? 100;
  }

  /**
   * 对单条 finding 应用自愈规则。
   *
   * - 按规则顺序匹配，首个匹配的规则生效
   * - 自愈失败（apply 抛错）时返回原 finding（healed=false）
   * - 未匹配任何规则时返回原 finding（healed=false）
   *
   * @param finding 待自愈的 finding
   * @returns 自愈结果
   */
  healFinding(finding: Finding): HealResult {
    for (const rule of this.rules) {
      try {
        if (!rule.match(finding)) continue;
      } catch {
        // match 抛错时跳过该规则
        continue;
      }
      try {
        const healed = rule.apply(finding);
        const result: HealResult = {
          finding: healed,
          healed: true,
          ruleId: rule.id,
          action: rule.action,
          reason: `matched rule "${rule.id}"`,
        };
        this.pushHistory(result);
        return result;
      } catch (err) {
        // apply 抛错时跳过该规则，继续尝试下一个
        continue;
      }
    }
    const result: HealResult = { finding, healed: false };
    this.pushHistory(result);
    return result;
  }

  /**
   * 批量自愈 findings。
   *
   * - 对每条 finding 调用 healFinding
   * - 保持输入顺序
   * - 统计各规则触发次数
   * - 若没有任何 finding 被自愈，返回原数组引用（避免不必要的拷贝）
   *
   * @param findings 待自愈的 findings
   * @returns 批量自愈结果
   */
  autoHealFindings(findings: Finding[]): AutoHealResult {
    if (!findings || findings.length === 0) {
      return { findings: [], healedCount: 0, ruleCounts: {}, details: [] };
    }

    const details: HealResult[] = [];
    const healedFindings: Finding[] = [];
    const ruleCounts: Record<string, number> = {};
    let healedCount = 0;

    for (const f of findings) {
      const result = this.healFinding(f);
      details.push(result);
      healedFindings.push(result.finding);
      if (result.healed) {
        healedCount++;
        if (result.ruleId) {
          ruleCounts[result.ruleId] = (ruleCounts[result.ruleId] ?? 0) + 1;
        }
      }
    }

    // 若无任何 finding 被自愈，返回原数组引用以保持引用透明性
    const finalFindings = healedCount > 0 ? healedFindings : findings;

    return {
      findings: finalFindings,
      healedCount,
      ruleCounts,
      details,
    };
  }

  /** 返回当前生效的规则列表（副本） */
  getRules(): HealingRule[] {
    return [...this.rules];
  }

  /** 返回历史自愈记录（副本） */
  getHistory(): HealResult[] {
    return [...this.history];
  }

  /** 清空历史记录 */
  clearHistory(): void {
    this.history = [];
  }

  /** 追加历史记录，超过上限时移除最旧的 */
  private pushHistory(result: HealResult): void {
    this.history.push(result);
    while (this.history.length > this.historyLimit) {
      this.history.shift();
    }
  }
}

/**
 * 便捷函数：使用默认 SelfHealer 对单条 finding 应用自愈。
 *
 * @param finding 待自愈的 finding
 * @param healer 自愈器实例（可选，默认新建一个）
 * @returns 自愈结果
 */
export function healFinding(finding: Finding, healer?: SelfHealer): HealResult {
  const h = healer ?? new SelfHealer();
  return h.healFinding(finding);
}

/**
 * 便捷函数：使用默认 SelfHealer 批量自愈 findings。
 *
 * @param findings 待自愈的 findings
 * @param healer 自愈器实例（可选，默认新建一个）
 * @returns 批量自愈结果
 */
export function autoHealFindings(findings: Finding[], healer?: SelfHealer): AutoHealResult {
  const h = healer ?? new SelfHealer();
  return h.autoHealFindings(findings);
}
