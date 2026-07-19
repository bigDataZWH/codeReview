// src/rule-customizer.ts — 规则定制模块
//
// 提供自定义规则加载、规则覆盖、规则禁用、激活规则查询四项能力：
// 1. loadCustomRules：从 review-rules/ 目录加载自定义规则（封装 loadRules，目录不存在时返回空数组）
// 2. overrideRule：通过配置覆盖默认规则的 severity / name / description / category / language / excludePatterns
// 3. disableRule / enableRule：按 ID 禁用或启用规则（通过 disabled 字段控制）
// 4. getActiveRules：返回当前所有激活（未禁用）的规则
//
// 持久化：通过 RulesConfig 写入 .code-review-rules.json，
// 由 CLI 命令调用 saveRulesConfig / loadRulesConfig 完成跨进程持久化。
//
// 设计取舍：
// - 所有 API 返回新数组，不修改原数组（不可变风格，便于链式组合）
// - 配置文件路径与规则目录可参数化，默认指向当前工作目录
// - 复用 rule-engine.ts 的 loadRules，避免重复实现 JSON/YAML 解析

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadRules } from './rule-engine.js';
import type { Rule, Severity } from './types.js';

/** 默认自定义规则目录名 */
export const DEFAULT_RULES_DIR = 'review-rules';

/** 规则定制配置文件名 */
export const RULES_CONFIG_FILE = '.code-review-rules.json';

/** 单条规则的覆盖配置 */
export interface RuleOverride {
  /** 严重度覆盖 */
  severity?: Severity;
  /** 规则名称覆盖 */
  name?: string;
  /** 规则描述覆盖 */
  description?: string;
  /** 类别覆盖 */
  category?: string;
  /** 语言覆盖 */
  language?: string[];
  /** 排除模式覆盖 */
  excludePatterns?: string[];
}

/** 规则定制配置（持久化结构） */
export interface RulesConfig {
  /** 被禁用的规则 ID 列表 */
  disabled: string[];
  /** 规则 ID -> 覆盖配置 */
  overrides: Record<string, RuleOverride>;
}

/**
 * 从指定目录加载自定义规则。
 *
 * 目录不存在时返回空数组（而非抛出错误），便于在未初始化 review-rules/ 的项目中调用。
 *
 * @param ruleDir 规则目录路径，默认 'review-rules'
 */
export async function loadCustomRules(ruleDir: string = DEFAULT_RULES_DIR): Promise<Rule[]> {
  if (!existsSync(ruleDir)) {
    return [];
  }
  return loadRules(ruleDir);
}

/**
 * 通过 ID 覆盖默认规则参数。
 *
 * 仅覆盖 overrides 中显式提供的字段，未提供字段保持原值。
 * 规则 ID 不存在时返回原数组的副本（无副作用）。
 *
 * @param rules 现有规则列表
 * @param ruleId 要覆盖的规则 ID
 * @param overrides 覆盖配置
 * @returns 新的规则列表（不修改原数组）
 */
export function overrideRule(
  rules: Rule[],
  ruleId: string,
  overrides: RuleOverride,
): Rule[] {
  return rules.map((r) => {
    if (r.id !== ruleId) return r;
    return {
      ...r,
      ...(overrides.severity !== undefined ? { severity: overrides.severity } : null),
      ...(overrides.name !== undefined ? { name: overrides.name } : null),
      ...(overrides.description !== undefined ? { description: overrides.description } : null),
      ...(overrides.category !== undefined ? { category: overrides.category } : null),
      ...(overrides.language !== undefined ? { language: overrides.language } : null),
      ...(overrides.excludePatterns !== undefined ? { excludePatterns: overrides.excludePatterns } : null),
    };
  });
}

/**
 * 通过 ID 禁用规则。
 *
 * 禁用后规则仍保留在列表中，但 matchRules 会跳过它（disabled: true）。
 * 规则 ID 不存在时返回原数组的副本。
 *
 * @param rules 现有规则列表
 * @param ruleId 要禁用的规则 ID
 */
export function disableRule(rules: Rule[], ruleId: string): Rule[] {
  return rules.map((r) => (r.id === ruleId ? { ...r, disabled: true } : r));
}

/**
 * 通过 ID 启用规则（取消禁用）。
 *
 * 规则 ID 不存在时返回原数组的副本。
 *
 * @param rules 现有规则列表
 * @param ruleId 要启用的规则 ID
 */
export function enableRule(rules: Rule[], ruleId: string): Rule[] {
  return rules.map((r) => (r.id === ruleId ? { ...r, disabled: false } : r));
}

/**
 * 返回当前所有激活的规则（未禁用）。
 *
 * @param rules 现有规则列表
 */
export function getActiveRules(rules: Rule[]): Rule[] {
  return rules.filter((r) => !r.disabled);
}

/**
 * 返回当前所有被禁用的规则。
 *
 * @param rules 现有规则列表
 */
export function getDisabledRules(rules: Rule[]): Rule[] {
  return rules.filter((r) => r.disabled === true);
}

/**
 * 从磁盘加载规则定制配置。
 *
 * 配置文件不存在或解析失败时返回空配置（不抛出错误），
 * 便于在未初始化的项目中安全调用。
 *
 * @param configPath 配置文件路径，默认为当前工作目录下的 .code-review-rules.json
 */
export function loadRulesConfig(configPath: string = RULES_CONFIG_FILE): RulesConfig {
  if (!existsSync(configPath)) {
    return { disabled: [], overrides: {} };
  }
  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<RulesConfig>;
    return {
      disabled: Array.isArray(parsed.disabled) ? parsed.disabled.filter((id): id is string => typeof id === 'string') : [],
      overrides: parsed.overrides && typeof parsed.overrides === 'object' ? parsed.overrides : {},
    };
  } catch {
    return { disabled: [], overrides: {} };
  }
}

/**
 * 将规则定制配置写入磁盘。
 *
 * @param config 配置对象
 * @param configPath 配置文件路径，默认为当前工作目录下的 .code-review-rules.json
 */
export function saveRulesConfig(config: RulesConfig, configPath: string = RULES_CONFIG_FILE): void {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * 将规则定制配置应用到规则列表。
 *
 * 应用顺序：
 * 1. 应用 overrides（覆盖默认参数）
 * 2. 应用 disabled（按 ID 禁用）
 *
 * @param rules 原始规则列表
 * @param config 规则定制配置
 */
export function applyRulesConfig(rules: Rule[], config: RulesConfig): Rule[] {
  let result = rules;
  for (const [ruleId, override] of Object.entries(config.overrides)) {
    result = overrideRule(result, ruleId, override);
  }
  for (const ruleId of config.disabled) {
    result = disableRule(result, ruleId);
  }
  return result;
}

/**
 * 加载自定义规则并应用定制配置（便捷组合函数）。
 *
 * 等价于 `applyRulesConfig(await loadCustomRules(ruleDir), loadRulesConfig(configPath))`。
 *
 * @param ruleDir 规则目录路径，默认 'review-rules'
 * @param configPath 配置文件路径，默认 '.code-review-rules.json'
 */
export async function loadActiveCustomRules(
  ruleDir: string = DEFAULT_RULES_DIR,
  configPath: string = RULES_CONFIG_FILE,
): Promise<Rule[]> {
  const rules = await loadCustomRules(ruleDir);
  const config = loadRulesConfig(configPath);
  return applyRulesConfig(rules, config);
}
