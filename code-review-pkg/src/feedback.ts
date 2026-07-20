// src/feedback.ts — 反馈闭环模块
//
// 包含三部分能力：
// 1. 反馈采集器 FeedbackStore：记录 accept/reject/modify 反馈，支持去重、查询、统计
// 2. 误报模式分析：聚类频繁被 reject 的 finding 模式，生成规则优化建议
// 3. 忽略配置：加载 .opencode-review-ignore.yaml，判断 finding 是否应被忽略
//
// 设计取舍：
// - 使用纯 TypeScript 内存 Map 存储，接口设计支持后续替换为数据库
// - YAML 解析使用最小手写解析器（与 rule-engine.ts 风格一致），避免引入 js-yaml 依赖
// - 反馈去重策略：同一 findingId 多次反馈只保留最新一条

import { existsSync, readFileSync } from 'node:fs';
import type { Finding, Severity } from './types.js';
import { parseMinimalYaml } from './yaml-lite.js';
import { globToRegex } from './glob.js';
import type { ContextLearner } from './context-learner.js';

// ==================== 反馈类型 ====================

/** 反馈动作类型 */
export type FeedbackAction = 'accept' | 'reject' | 'modify';

/** 合法动作集合 */
const VALID_ACTIONS: ReadonlySet<FeedbackAction> = new Set(['accept', 'reject', 'modify']);

/** 误报分析自动启用的最小反馈条数阈值 */
export const FALSE_POSITIVE_ANALYSIS_THRESHOLD = 100;

/** 反馈记录 */
export interface FeedbackRecord {
  /** 反馈唯一 ID（自动生成） */
  id: string;
  /** 关联的 finding ID */
  findingId: string;
  /** 反馈动作 */
  action: FeedbackAction;
  /** 反馈原因（可选） */
  reason?: string;
  /** 反馈时间戳（ms） */
  timestamp: number;
  /** finding 快照（可选，用于误报分析） */
  findingSnapshot?: Finding;
  /** finding 类别（冗余字段，便于分析；缺失时为 'unknown'） */
  category: string;
  /** finding 规则 ID（可选） */
  ruleId?: string;
  /** finding 文件路径（冗余字段；缺失时为空字符串） */
  file: string;
  /** finding 严重级别（冗余字段；缺失时为 'info'） */
  severity: Severity | 'info';
}

/** 反馈统计 */
export interface FeedbackStats {
  /** 反馈总数（去重后） */
  total: number;
  /** accept 反馈数 */
  acceptCount: number;
  /** reject 反馈数 */
  rejectCount: number;
  /** modify 反馈数 */
  modifyCount: number;
  /** accept 比例（0-1） */
  acceptRate: number;
  /** reject 比例（0-1） */
  rejectRate: number;
  /** modify 比例（0-1） */
  modifyRate: number;
}

/** 误报模式 */
export interface FalsePositivePattern {
  /** 模式描述，例如 "category:security, ruleId:sql-injection" */
  pattern: string;
  /** 该模式被 reject 的次数 */
  count: number;
  /** 优化建议文本 */
  suggestion: string;
}

/** 规则优化建议 */
export interface RuleSuggestion {
  /** 关联的误报模式 */
  pattern: string;
  /** 建议文本 */
  suggestion: string;
  /** 优先级：count >= 10 为 high，[5, 10) 为 medium，< 5 为 low */
  priority: 'high' | 'medium' | 'low';
}

// ==================== 反馈采集器 ====================

/**
 * 反馈采集器：记录、查询、统计 finding 反馈。
 *
 * 使用内存 Map 存储，key 为 findingId，value 为最新反馈记录（自动去重）。
 * 接口设计支持后续替换为数据库实现。
 */
export class FeedbackStore {
  /** findingId -> 最新反馈记录 */
  private feedbacks: Map<string, FeedbackRecord> = new Map();
  /** 自增 ID 计数器，保证唯一 */
  private seqCounter = 0;

  /**
   * 记录一条反馈。同一 findingId 多次反馈时覆盖旧记录（只保留最新）。
   *
   * @param findingId 关联的 finding ID
   * @param action 反馈动作（accept / reject / modify）
   * @param reason 反馈原因（可选）
   * @param finding finding 快照（可选，用于误报模式分析）
   * @returns 新建的反馈记录
   * @throws 当 action 非法时抛出错误
   */
  recordFeedback(
    findingId: string,
    action: FeedbackAction,
    reason?: string,
    finding?: Finding,
  ): FeedbackRecord {
    if (!VALID_ACTIONS.has(action)) {
      throw new Error(`invalid feedback action: ${action}`);
    }
    if (!findingId || typeof findingId !== 'string') {
      throw new Error('findingId must be a non-empty string');
    }
    const id = this.generateId();
    const record: FeedbackRecord = {
      id,
      findingId,
      action,
      reason,
      timestamp: Date.now(),
      findingSnapshot: finding ? { ...finding } : undefined,
      category: finding?.category ?? 'unknown',
      ruleId: finding?.ruleId,
      file: finding?.file ?? '',
      severity: (finding?.severity as Severity | 'info') ?? 'info',
    };
    this.feedbacks.set(findingId, record);
    return { ...record };
  }

  /**
   * 查询某 finding 的反馈历史（去重后只保留最新，故至多 1 条）。
   * @returns 反馈记录数组（按时间倒序，最新在前）
   */
  getFeedbackByFinding(findingId: string): FeedbackRecord[] {
    const rec = this.feedbacks.get(findingId);
    if (!rec) return [];
    return [{ ...rec }];
  }

  /**
   * 按动作类型查询反馈。
   * @returns 匹配的反馈记录数组（去重后的最新记录）
   */
  getFeedbackByAction(action: FeedbackAction): FeedbackRecord[] {
    if (!VALID_ACTIONS.has(action)) return [];
    const list: FeedbackRecord[] = [];
    for (const rec of this.feedbacks.values()) {
      if (rec.action === action) {
        list.push({ ...rec });
      }
    }
    // 按 timestamp 倒序
    list.sort((a, b) => b.timestamp - a.timestamp);
    return list;
  }

  /** 返回所有当前反馈（去重后） */
  getAllFeedback(): FeedbackRecord[] {
    const list = Array.from(this.feedbacks.values()).map((r) => ({ ...r }));
    list.sort((a, b) => b.timestamp - a.timestamp);
    return list;
  }

  /**
   * 统计反馈总数与各动作比例（基于去重后的最新记录）。
   */
  getFeedbackStats(): FeedbackStats {
    let acceptCount = 0;
    let rejectCount = 0;
    let modifyCount = 0;
    for (const rec of this.feedbacks.values()) {
      if (rec.action === 'accept') acceptCount++;
      else if (rec.action === 'reject') rejectCount++;
      else if (rec.action === 'modify') modifyCount++;
    }
    const total = this.feedbacks.size;
    return {
      total,
      acceptCount,
      rejectCount,
      modifyCount,
      acceptRate: total > 0 ? acceptCount / total : 0,
      rejectRate: total > 0 ? rejectCount / total : 0,
      modifyRate: total > 0 ? modifyCount / total : 0,
    };
  }

  /** 当前反馈条数（去重后） */
  size(): number {
    return this.feedbacks.size;
  }

  /** 清空所有反馈 */
  clear(): void {
    this.feedbacks.clear();
  }

  /**
   * 聚类频繁被 reject 的 finding 模式。
   *
   * 启用条件：当前反馈总数 >= 100 条。
   * 聚类维度：优先按 (category + ruleId) 聚类；ruleId 缺失时按 category 聚类。
   * 仅统计 action === 'reject' 的反馈。
   *
   * @returns 误报模式列表，按 count 降序排序
   */
  analyzeFalsePositivePatterns(): FalsePositivePattern[] {
    if (this.feedbacks.size < FALSE_POSITIVE_ANALYSIS_THRESHOLD) {
      return [];
    }
    const buckets = new Map<string, { pattern: string; count: number }>();
    for (const rec of this.feedbacks.values()) {
      if (rec.action !== 'reject') continue;
      const pattern = rec.ruleId
        ? `category:${rec.category}, ruleId:${rec.ruleId}`
        : `category:${rec.category}`;
      const entry = buckets.get(pattern);
      if (entry) {
        entry.count++;
      } else {
        buckets.set(pattern, { pattern, count: 1 });
      }
    }
    const patterns: FalsePositivePattern[] = [];
    for (const { pattern, count } of buckets.values()) {
      patterns.push({
        pattern,
        count,
        suggestion: `频繁误报：[${pattern}] 被拒绝 ${count} 次，建议调整规则或加入忽略列表`,
      });
    }
    patterns.sort((a, b) => b.count - a.count);
    return patterns;
  }

  /**
   * 基于误报模式生成规则优化建议。
   *
   * 优先级规则：
   * - count >= 10：high
   * - count ∈ [5, 10)：medium
   * - count < 5：low
   *
   * @returns 规则建议列表（按 count 降序）
   */
  generateRuleSuggestions(): RuleSuggestion[] {
    const patterns = this.analyzeFalsePositivePatterns();
    return patterns.map((p) => {
      let priority: 'high' | 'medium' | 'low';
      if (p.count >= 10) priority = 'high';
      else if (p.count >= 5) priority = 'medium';
      else priority = 'low';
      return {
        pattern: p.pattern,
        suggestion: p.suggestion,
        priority,
      };
    });
  }

  /** 生成唯一反馈 ID */
  private generateId(): string {
    this.seqCounter += 1;
    return `fb-${Date.now().toString(36)}-${this.seqCounter.toString(36)}`;
  }
}

// ==================== 忽略配置 ====================

/** 忽略规则：所有指定字段全部匹配时该规则才生效（AND 逻辑） */
export interface IgnoreRule {
  /** 匹配 finding.category */
  category?: string;
  /** 匹配 finding.ruleId */
  ruleId?: string;
  /** glob 模式匹配 finding.file，支持 * 与 ** */
  filePattern?: string;
  /** 匹配 finding.severity */
  severity?: Severity | 'info';
  /** 子串匹配 finding.message（大小写敏感） */
  messageContains?: string;
}

/** 忽略配置：多条规则之间为 OR 逻辑 */
export interface IgnoreConfig {
  rules: IgnoreRule[];
}

/**
 * 判断 finding 是否应被忽略。
 *
 * 规则匹配逻辑：
 * - 任一规则匹配即返回 true（OR）
 * - 单条规则内所有指定字段必须全部匹配（AND）
 *
 * @param finding 待判断的 finding
 * @param ignoreConfig 忽略配置
 * @returns true 表示应忽略
 */
export function shouldIgnore(finding: Finding, ignoreConfig: IgnoreConfig): boolean {
  if (!ignoreConfig?.rules || ignoreConfig.rules.length === 0) return false;
  for (const rule of ignoreConfig.rules) {
    if (matchesRule(finding, rule)) return true;
  }
  return false;
}

/** 判断单条忽略规则是否匹配 finding */
function matchesRule(finding: Finding, rule: IgnoreRule): boolean {
  if (rule.category !== undefined && finding.category !== rule.category) return false;
  if (rule.ruleId !== undefined && finding.ruleId !== rule.ruleId) return false;
  if (rule.severity !== undefined && finding.severity !== rule.severity) return false;
  if (rule.messageContains !== undefined) {
    if (typeof finding.message !== 'string' || !finding.message.includes(rule.messageContains)) {
      return false;
    }
  }
  if (rule.filePattern !== undefined) {
    if (typeof finding.file !== 'string' || !globToRegex(rule.filePattern).test(finding.file)) {
      return false;
    }
  }
  return true;
}

/**
 * 加载 .opencode-review-ignore.yaml 格式的忽略配置。
 *
 * 支持的最小 YAML 结构（字段顺序无关，所有字段均可选）：
 * ```yaml
 * rules:
 *   - category: security
 *     ruleId: sql-injection
 *     filePattern: "src/fixtures/.+"
 *     severity: high
 *     messageContains: "SQL"
 * ```
 *
 * @param configPath 配置文件路径
 * @returns 解析后的忽略配置
 * @throws 当文件不存在或解析失败时抛出错误
 */
export function loadIgnoreConfig(configPath: string): IgnoreConfig {
  if (!configPath || !existsSync(configPath)) {
    throw new Error(`ignore config file not found: ${configPath}`);
  }
  const text = readFileSync(configPath, 'utf8');
  return parseIgnoreYaml(text);
}

/**
 * 最小 YAML 解析器：仅支持本项目忽略配置的结构。
 *
 * 实际 YAML 解析委托给 `src/yaml-lite.ts` 的 `parseMinimalYaml`（与 rule-engine.ts 共用）。
 * 此处仅负责把通用解析结果中的 `rules` 列表映射为 `IgnoreRule[]`，
 * 通过 `assignRuleField` 过滤未知字段、剥离引号、跳过空值。
 */
function parseIgnoreYaml(text: string): IgnoreConfig {
  const root = parseMinimalYaml(text);
  const rawRules = (root.rules as Array<Record<string, unknown>> | undefined) ?? [];
  const rules: IgnoreRule[] = [];
  for (const raw of rawRules) {
    const rule: IgnoreRule = {};
    for (const [key, val] of Object.entries(raw)) {
      if (val === undefined || val === null) continue;
      // 通用解析器可能把值转为 number / boolean，统一转回字符串交给 assignRuleField 处理
      const rawVal = typeof val === 'string' ? val : String(val);
      assignRuleField(rule, key, rawVal);
    }
    rules.push(rule);
  }
  return { rules };
}

/** 将 YAML 字段赋值到 IgnoreRule，自动去除引号 */
function assignRuleField(rule: IgnoreRule, key: string, rawVal: string): void {
  const val = stripQuotes(rawVal.trim());
  if (val === '') return;
  switch (key) {
    case 'category':
      rule.category = val;
      break;
    case 'ruleId':
      rule.ruleId = val;
      break;
    case 'filePattern':
      rule.filePattern = val;
      break;
    case 'severity':
      rule.severity = val as Severity | 'info';
      break;
    case 'messageContains':
      rule.messageContains = val;
      break;
    default:
      // 未知字段忽略
      break;
  }
}

/** 去除字符串两端的单/双引号 */
function stripQuotes(s: string): string {
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// ==================== 一键标记误报（迭代 9） ====================

/** markFalsePositive 默认原因 */
export const DEFAULT_FALSE_POSITIVE_REASON = 'Marked as false positive';

/** markFalsePositive 返回值：在 FeedbackRecord 基础上附带忽略规则与原始记录引用 */
export interface MarkFalsePositiveResult extends FeedbackRecord {
  /** 根据 finding 自动生成的忽略规则（finding 缺失时为 undefined） */
  ignoreRule?: IgnoreRule;
  /** 原始反馈记录引用 */
  record: FeedbackRecord;
}

/**
 * 一键将 finding 标记为误报。
 *
 * 行为：
 * 1. 在 FeedbackStore 中以 reject 动作记录该 finding 反馈
 * 2. 根据 finding 字段自动生成 IgnoreRule（便于加入忽略配置，下次自动过滤）
 * 3. 返回包含原始记录、忽略规则的结果对象
 * 4. 若传入 learner，则触发 learnFromFeedback 更新学习到的权重（Task 7）
 *
 * @param store 反馈存储
 * @param findingId 关联的 finding ID
 * @param finding finding 快照（可选；提供时生成忽略规则）
 * @param reason 标记原因（可选；默认使用 DEFAULT_FALSE_POSITIVE_REASON）
 * @param learner 上下文学习器（可选；提供时触发权重更新）
 * @returns 包含 FeedbackRecord 字段、ignoreRule、record 的结果对象
 */
export function markFalsePositive(
  store: FeedbackStore,
  findingId: string,
  finding?: Finding,
  reason?: string,
  learner?: ContextLearner,
): MarkFalsePositiveResult {
  const finalReason = reason ?? DEFAULT_FALSE_POSITIVE_REASON;
  const record = store.recordFeedback(findingId, 'reject', finalReason, finding);

  let ignoreRule: IgnoreRule | undefined;
  if (finding) {
    ignoreRule = {};
    if (finding.category !== undefined) ignoreRule.category = finding.category;
    if (finding.ruleId !== undefined) ignoreRule.ruleId = finding.ruleId;
    if (finding.file !== undefined && finding.file !== '') {
      ignoreRule.filePattern = finding.file;
    }
    if (finding.severity !== undefined) {
      ignoreRule.severity = finding.severity as Severity | 'info';
    }
  }

  // Task 7：在标记误报后触发上下文学习
  if (learner) {
    try {
      learner.learnFromFeedback(store);
    } catch (err) {
      // 学习失败不影响标记误报的主流程
      console.warn(
        '[feedback] markFalsePositive: learner.learnFromFeedback failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return { ...record, ignoreRule, record };
}

// ==================== 规则有效性与自动调优（迭代 10） ====================

/** 规则有效性等级 */
export type RuleGrade = 'good' | 'medium' | 'poor';

/** 单条规则的有效性评估 */
export interface RuleEffectiveness {
  /** 规则 ID */
  ruleId: string;
  /** 总反馈数 */
  totalFeedback: number;
  /** 接受数 */
  acceptCount: number;
  /** 拒绝数 */
  rejectCount: number;
  /** 修改数 */
  modifyCount: number;
  /** 接受率（0-1） */
  acceptRate: number;
  /** 拒绝率（0-1） */
  rejectRate: number;
  /** 等级：good(>=0.7) / medium(>=0.3) / poor(<0.3) */
  grade: RuleGrade;
}

/** 规则调优动作 */
export type RuleTuningAction = 'disable' | 'downgrade' | 'adjust-threshold' | 'review';

/** 规则调优建议 */
export interface RuleTuningSuggestion {
  /** 规则 ID */
  ruleId: string;
  /** 调优动作 */
  action: RuleTuningAction;
  /** 当前 severity（若规则已知） */
  currentSeverity?: Severity;
  /** 建议 severity（若建议降级） */
  suggestedSeverity?: Severity;
  /** 建议原因 */
  reason: string;
  /** 当前 acceptRate */
  acceptRate: number;
  /** 当前 rejectRate */
  rejectRate: number;
  /** 总反馈数 */
  totalFeedback: number;
}

/** severity 降级顺序 */
const SEVERITY_DOWNGRADE_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

/**
 * 评估每条规则的有效性。
 *
 * - 按 ruleId 聚合反馈数据
 * - 计算 acceptRate / rejectRate
 * - 按 acceptRate 分级：good >= 0.7 / medium >= 0.3 / poor < 0.3
 * - 返回结果按 acceptRate 降序排序
 *
 * @param store 反馈存储
 * @returns 规则有效性列表
 */
export function getRuleEffectiveness(store: FeedbackStore): RuleEffectiveness[] {
  const all = store.getAllFeedback();
  const byRule = new Map<string, { accept: number; reject: number; modify: number }>();
  for (const r of all) {
    if (!r.ruleId) continue;
    const entry = byRule.get(r.ruleId) ?? { accept: 0, reject: 0, modify: 0 };
    if (r.action === 'accept') entry.accept++;
    else if (r.action === 'reject') entry.reject++;
    else if (r.action === 'modify') entry.modify++;
    byRule.set(r.ruleId, entry);
  }

  const result: RuleEffectiveness[] = [];
  for (const [ruleId, counts] of byRule.entries()) {
    const total = counts.accept + counts.reject + counts.modify;
    if (total === 0) continue;
    const acceptRate = counts.accept / total;
    const rejectRate = counts.reject / total;
    let grade: RuleGrade;
    if (acceptRate >= 0.7) grade = 'good';
    else if (acceptRate >= 0.3) grade = 'medium';
    else grade = 'poor';
    result.push({
      ruleId,
      totalFeedback: total,
      acceptCount: counts.accept,
      rejectCount: counts.reject,
      modifyCount: counts.modify,
      acceptRate,
      rejectRate,
      grade,
    });
  }

  result.sort((a, b) => b.acceptRate - a.acceptRate);
  return result;
}

/**
 * 基于反馈数据自动生成规则调优建议。
 *
 * - poor 等级规则（acceptRate < 0.3）：建议 disable 或 downgrade
 * - medium 等级规则（0.3 <= acceptRate < 0.7）：建议 adjust-threshold
 * - good 等级规则（acceptRate >= 0.7）：不生成建议
 *
 * @param store 反馈存储
 * @param rules 当前规则集（用于查询 severity；缺省时 currentSeverity 为 undefined）
 * @returns 调优建议列表
 */
export function autoTuneRules(
  store: FeedbackStore,
  rules: import('./types.js').Rule[],
): RuleTuningSuggestion[] {
  const effectiveness = getRuleEffectiveness(store);
  const ruleMap = new Map<string, import('./types.js').Rule>();
  for (const r of rules) {
    ruleMap.set(r.id, r);
  }

  const suggestions: RuleTuningSuggestion[] = [];
  for (const eff of effectiveness) {
    if (eff.grade === 'good') continue;

    const rule = ruleMap.get(eff.ruleId);
    const currentSeverity = rule?.severity;

    if (eff.grade === 'poor') {
      // poor: 建议降级或禁用
      let suggestedSeverity: Severity | undefined;
      if (currentSeverity) {
        const idx = SEVERITY_DOWNGRADE_ORDER.indexOf(currentSeverity);
        if (idx >= 0 && idx < SEVERITY_DOWNGRADE_ORDER.length - 1) {
          suggestedSeverity = SEVERITY_DOWNGRADE_ORDER[idx + 1];
        }
      }
      suggestions.push({
        ruleId: eff.ruleId,
        action: suggestedSeverity ? 'downgrade' : 'disable',
        currentSeverity,
        suggestedSeverity,
        reason: `规则 acceptRate 仅 ${(eff.acceptRate * 100).toFixed(1)}%（${eff.acceptCount}/${eff.totalFeedback}），误报率过高，建议${suggestedSeverity ? '降级 severity' : '禁用规则'}`,
        acceptRate: eff.acceptRate,
        rejectRate: eff.rejectRate,
        totalFeedback: eff.totalFeedback,
      });
    } else {
      // medium: 建议调整阈值
      suggestions.push({
        ruleId: eff.ruleId,
        action: 'adjust-threshold',
        currentSeverity,
        suggestedSeverity: currentSeverity,
        reason: `规则 acceptRate 为 ${(eff.acceptRate * 100).toFixed(1)}%（${eff.acceptCount}/${eff.totalFeedback}），存在一定误报，建议调整匹配阈值或置信度`,
        acceptRate: eff.acceptRate,
        rejectRate: eff.rejectRate,
        totalFeedback: eff.totalFeedback,
      });
    }
  }

  return suggestions;
}
