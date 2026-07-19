// src/orchestrator.ts — 编排控制层
//
// 职责：
// 1. 审查会话管理：创建/恢复/取消/查询会话，封装状态机
// 2. Agent DAG 编排：拓扑排序 + 分波并行执行，支持依赖、结果传递、部分失败
// 3. 异常处理与降级：withFallback / withRetry / MCP 降级 / 模型超时降级
// 4. 迭代 5：大 PR 分批处理 batchProcess + 优先级排序 prioritizeDiffs
//
// 设计取舍：
// - 会话状态底层复用 StateStore（不重复造轮子），在编排层增加 cancelled 语义
// - DAG 执行采用 wave-based 调度：同一波次无依赖节点并行，跨波次串行
// - 部分失败不中断整体：失败的节点及其后续节点记录错误，其余节点继续执行
// - 分批处理支持顺序/并行两种模式，并行模式可大幅缩短大 PR 处理耗时

import { StateStore, type Session, type SessionStatus } from './state.js';
import type {
  Finding,
  FileDiff,
  MCPContextResult,
  FileBundle,
  Rule,
  RuleAnnotation,
  LLMProviderConfig,
  BlastRadiusItem,
} from './types.js';
import { DEFAULT_BATCH_SIZE } from './constants.js';
import { matchRules } from './rule-engine.js';
import { bundleFiles } from './file-filter.js';
import { callLLM, buildBatchReflectionPrompt } from './ai-reflection.js';
import { getImpactRadius } from './mcp-adapter.js';
import { ParallelTuner, getDefaultParallelism } from './parallel-tuner.js';

// ============================================================
// 审查会话管理器
// ============================================================

/** 审查会话状态（在底层状态机基础上增加 cancelled） */
export type ReviewSessionStatus = SessionStatus | 'cancelled';

/** 创建审查会话的配置 */
export interface ReviewSessionConfig {
  /** 仓库信息（如 owner/repo） */
  repo?: string;
  /** PR 编号 */
  prNumber?: number;
  /** 提交 SHA */
  commitSha?: string;
  /** 待审查文件列表（用于记录 filesTotal） */
  files?: FileDiff[];
  /** 自定义会话 ID（可选，默认自动生成） */
  sessionId?: string;
}

/**
 * 审查会话管理器。
 *
 * 封装 StateStore 的状态机，提供面向审查流程的高级 API：
 * - createReviewSession：创建会话，返回 session_id
 * - startSession / completeSession / failSession：状态转换
 * - resumeSession：断点续审（仅 pending / running 可恢复）
 * - cancelSession：取消会话（pending / running 可取消，终态不可取消）
 * - getSessionStatus：查询状态（返回 ReviewSessionStatus，含 cancelled）
 */
export class ReviewSessionManager {
  private readonly store: StateStore;
  /** 已取消会话 ID 集合（底层状态机无 cancelled，需在编排层维护） */
  private readonly cancelledSessions: Set<string> = new Set();
  /** 自动 ID 生成计数器 */
  private idCounter = 0;

  constructor(store?: StateStore) {
    this.store = store ?? new StateStore();
  }

  /**
   * 创建审查会话。
   * @returns 会话 ID（自定义或自动生成）
   * @throws 当自定义 sessionId 已存在时抛出错误
   */
  createReviewSession(config: ReviewSessionConfig): string {
    const id = config.sessionId ?? this.generateId();
    this.store.createSession({
      id,
      filesTotal: config.files?.length ?? 0,
      repo: config.repo,
      prNumber: config.prNumber,
      commitSha: config.commitSha,
    });
    return id;
  }

  /** 生成唯一会话 ID */
  private generateId(): string {
    return `review-${Date.now()}-${++this.idCounter}`;
  }

  /** 获取会话对象（不存在返回 null） */
  getSession(sessionId: string): Session | null {
    return this.store.getSession(sessionId);
  }

  /**
   * 启动会话：pending → running。
   * @returns 更新后的会话；不存在返回 null
   * @throws 状态转换非法时抛出错误
   */
  startSession(sessionId: string): Session | null {
    return this.store.updateSessionStatus(sessionId, 'running');
  }

  /**
   * 完成会话：running → completed。
   * @returns 更新后的会话；不存在返回 null
   * @throws 状态转换非法时抛出错误
   */
  completeSession(sessionId: string): Session | null {
    return this.store.updateSessionStatus(sessionId, 'completed');
  }

  /**
   * 标记会话失败：pending/running → failed。
   * @returns 更新后的会话；不存在返回 null
   * @throws 状态转换非法时抛出错误
   */
  failSession(sessionId: string, error?: string): Session | null {
    return this.store.updateSessionStatus(sessionId, 'failed', error);
  }

  /**
   * 断点续审：恢复 pending / running 状态的会话，并自动转为 running。
   * 终态（completed / failed / cancelled）不可恢复。
   * @returns 恢复时（转换前）的会话快照；不可恢复或不存在时返回 null。
   *          调用后若原状态为 pending，会话已转为 running。
   */
  resumeSession(sessionId: string): Session | null {
    const session = this.store.getSession(sessionId);
    if (!session) return null;
    // cancelled 会话不可恢复
    if (this.cancelledSessions.has(sessionId)) return null;
    // 仅 pending / running 可恢复
    if (session.status !== 'pending' && session.status !== 'running') {
      return null;
    }
    // pending → running 作为副作用；返回转换前的会话快照
    if (session.status === 'pending') {
      this.store.updateSessionStatus(sessionId, 'running');
    }
    return session;
  }

  /**
   * 取消会话：pending / running → cancelled（底层转为 failed）。
   * 终态（completed / failed / cancelled）不可取消。
   * @returns 取消后的会话；不可取消或不存在时返回 null
   */
  cancelSession(sessionId: string): Session | null {
    const session = this.store.getSession(sessionId);
    if (!session) return null;
    // 已取消的会话不可重复取消
    if (this.cancelledSessions.has(sessionId)) return null;
    // 仅 pending / running 可取消
    if (session.status !== 'pending' && session.status !== 'running') {
      return null;
    }
    const updated = this.store.updateSessionStatus(sessionId, 'failed', 'Session cancelled');
    if (updated) {
      this.cancelledSessions.add(sessionId);
    }
    return updated;
  }

  /**
   * 查询会话状态。
   * @returns ReviewSessionStatus；不存在返回 null
   */
  getSessionStatus(sessionId: string): ReviewSessionStatus | null {
    const session = this.store.getSession(sessionId);
    if (!session) return null;
    if (this.cancelledSessions.has(sessionId)) return 'cancelled';
    return session.status;
  }
}

// ============================================================
// Agent DAG 编排器
// ============================================================

/** Agent 类型 */
export type AgentType =
  | 'rule-engine'
  | 'ai-reviewer'
  | 'impact-analyzer'
  | 'security-reviewer'
  | 'custom';

/** DAG 节点定义 */
export interface DagNode<T = unknown> {
  /** 节点唯一 ID */
  id: string;
  /** Agent 类型 */
  agentType: AgentType;
  /** 依赖的节点 ID 列表（执行完所有依赖后才能执行本节点） */
  dependencies: string[];
  /** 节点处理器：接收上下文，返回结果 */
  handler: (context: DagContext) => Promise<T>;
}

/** DAG 执行上下文 */
export interface DagContext {
  /** 待审查的文件 diff 列表 */
  diffs: FileDiff[];
  /** MCP 上下文（可选） */
  mcpContext?: MCPContextResult;
  /** 前序节点的执行结果（节点 ID → 结果） */
  previousResults: Map<string, unknown>;
  /** 关联的会话 ID（可选） */
  sessionId?: string;
}

/** DAG 执行结果 */
export interface DagResult<T = unknown> {
  /** 成功节点的结果（节点 ID → 结果） */
  results: Map<string, T>;
  /** 失败节点的错误（节点 ID → Error） */
  errors: Map<string, Error>;
  /** 执行耗时（毫秒） */
  durationMs: number;
}

/**
 * 执行 DAG：按拓扑顺序分波执行节点。
 *
 * - 同一波次内无依赖关系的节点并行执行
 * - 有依赖关系的节点在依赖完成后才执行（串行跨波次）
 * - 单个节点失败不中断整体：失败节点的后续节点标记为跳过错误
 * - 循环依赖、未知依赖、重复 ID 在执行前校验并抛出错误
 *
 * @returns DagResult，包含成功结果和失败错误
 */
export async function executeDag<T = unknown>(
  dag: DagNode<T>[],
  context: DagContext,
): Promise<DagResult<T>> {
  const startTime = performance.now();
  const results = new Map<string, T>();
  const errors = new Map<string, Error>();

  if (dag.length === 0) {
    return { results, errors, durationMs: performance.now() - startTime };
  }

  // 1. 校验：构建节点映射，检测重复 ID
  const nodeMap = new Map<string, DagNode<T>>();
  for (const node of dag) {
    if (nodeMap.has(node.id)) {
      throw new Error(`Duplicate DAG node id: ${node.id}`);
    }
    nodeMap.set(node.id, node);
  }

  // 2. 校验：所有依赖必须存在
  for (const node of dag) {
    for (const dep of node.dependencies) {
      if (!nodeMap.has(dep)) {
        throw new Error(`Node "${node.id}" depends on unknown node "${dep}"`);
      }
    }
  }

  // 3. 校验：循环依赖检测（Kahn 拓扑排序）
  detectCycle(dag);

  // 4. 分波执行
  const completed = new Set<string>();
  const failed = new Set<string>();

  while (completed.size + failed.size < dag.length) {
    // 收集本波可执行的节点
    const ready: DagNode<T>[] = [];
    for (const node of dag) {
      if (completed.has(node.id) || failed.has(node.id)) continue;
      // 所有依赖都已完成？
      const allDepsCompleted = node.dependencies.every((dep) => completed.has(dep));
      // 有依赖已失败？
      const anyDepFailed = node.dependencies.some(
        (dep) => failed.has(dep) || errors.has(dep),
      );
      if (allDepsCompleted) {
        ready.push(node);
      } else if (anyDepFailed) {
        // 依赖失败，跳过本节点
        failed.add(node.id);
        errors.set(node.id, new Error(`Skipped: dependency of "${node.id}" failed`));
      }
    }

    if (ready.length === 0) {
      // 无可执行节点且无进展（理论上不会发生，因为已做循环检测）
      break;
    }

    // 并行执行本波节点
    const wave = ready.map(async (node) => {
      // 快照前序结果（在 handler 调用前同步取，保证同一波次内快照一致）
      const ctx: DagContext = {
        ...context,
        previousResults: new Map(results),
      };
      try {
        const result = await node.handler(ctx);
        results.set(node.id, result);
        completed.add(node.id);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.set(node.id, error);
        failed.add(node.id);
      }
    });

    await Promise.all(wave);
  }

  return { results, errors, durationMs: performance.now() - startTime };
}

/**
 * 循环依赖检测（Kahn 算法）。
 * 若存在环则抛出错误。
 */
function detectCycle<T>(dag: DagNode<T>[]): void {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const node of dag) {
    inDegree.set(node.id, node.dependencies.length);
    for (const dep of node.dependencies) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(node.id);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  let processed = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    processed++;
    for (const dependent of dependents.get(id) ?? []) {
      const newDeg = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  if (processed < dag.length) {
    throw new Error('DAG contains a cycle');
  }
}

// ============================================================
// 结果合并与冲突解决
// ============================================================

/** severity 排序权重：critical > high > medium > low > info */
const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/**
 * 合并多个 Agent 的 findings，并解决冲突。
 *
 * 冲突解决规则：相同 file+line 的 findings，只保留最高 severity 的；
 * 若最高 severity 相同（可能不同 category），则全部保留。
 *
 * @param results 多个 Agent 的 findings 列表
 * @returns 合并去重后的 findings
 */
export function mergeResults(results: Finding[][]): Finding[] {
  const all = results.flat();
  if (all.length === 0) return [];

  // 按 file:line 分组
  const groups = new Map<string, Finding[]>();
  for (const f of all) {
    const key = `${f.file}:${f.line}`;
    const group = groups.get(key);
    if (group) {
      group.push(f);
    } else {
      groups.set(key, [f]);
    }
  }

  const merged: Finding[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    // 找到最高 severity 权重
    let maxRank = -1;
    for (const f of group) {
      const rank = SEVERITY_RANK[f.severity] ?? 0;
      if (rank > maxRank) maxRank = rank;
    }
    // 保留所有达到最高权重的 findings
    for (const f of group) {
      const rank = SEVERITY_RANK[f.severity] ?? 0;
      if (rank === maxRank) merged.push(f);
    }
  }

  return merged;
}

// ============================================================
// 动态裁剪
// ============================================================

/** 默认影响分析阈值：文件数 < 此值时跳过影响分析 */
const DEFAULT_IMPACT_THRESHOLD = 5;

/**
 * 判断是否应跳过影响分析。
 *
 * 小变更（文件数 < threshold）跳过影响分析以节省开销。
 *
 * @param fileCount 待审查文件数
 * @param threshold 阈值（默认 5）
 * @returns true 表示应跳过
 */
export function shouldSkipImpactAnalysis(fileCount: number, threshold: number = DEFAULT_IMPACT_THRESHOLD): boolean {
  // 0 文件时无条件跳过（无内容可分析）
  if (fileCount === 0) return true;
  return fileCount < threshold;
}

/** buildReviewDag 选项 */
export interface BuildReviewDagOptions {
  /** 影响分析阈值（默认 5） */
  impactThreshold?: number;
  /** 是否包含 AI 审查节点（默认 true）。未配置模型时设为 false 可跳过 AI 节点 */
  includeAIReviewer?: boolean;
  /** 是否包含安全审查节点（默认 true） */
  includeSecurityReviewer?: boolean;
  /** 是否包含影响分析节点（默认根据文件数动态判断） */
  includeImpactAnalyzer?: boolean;
  /** 是否包含反思评估节点（默认 true） */
  includeReflector?: boolean;
  /** 规则列表（rule-engine 节点使用） */
  rules?: Rule[];
  /** LLM 配置（ai-reviewer/security-reviewer/reflector 节点使用） */
  llmConfig?: LLMProviderConfig;
  /** 已构建的 review prompt（ai-reviewer 节点使用，为空时跳过 LLM 调用） */
  reviewPrompt?: string;
  /** 已构建的 security prompt（security-reviewer 节点使用，为空时跳过 LLM 调用） */
  securityPrompt?: string;
  /** 依赖注入：规则匹配函数（默认 matchRules） */
  matchRulesFn?: typeof matchRules;
  /** 依赖注入：LLM 调用函数（默认 callLLM） */
  callLLMFn?: typeof callLLM;
  /** 依赖注入：影响半径查询函数（默认 getImpactRadius） */
  getImpactRadiusFn?: typeof getImpactRadius;
}

/**
 * 将 RuleAnnotation 转换为 Finding。
 */
function annotationToFinding(bundle: FileBundle, ann: RuleAnnotation): Finding {
  return {
    file: bundle.primary.path,
    line: ann.line ?? 0,
    severity: ann.severity,
    category: ann.category,
    message: ann.message,
    source: 'rule',
    ruleId: ann.ruleId,
    confidence: 1.0,
  };
}

/**
 * 将 BlastRadiusItem 转换为 Finding。
 */
function blastRadiusItemToFinding(item: BlastRadiusItem): Finding {
  return {
    file: item.path,
    line: 0,
    severity: 'info',
    category: 'impact',
    message: `Impact: ${item.type} - ${item.relation}`,
    source: 'rule',
    confidence: 1.0,
  };
}

/**
 * 解析 LLM 响应为 Finding[]。
 *
 * 支持以下响应格式：
 * - JSON 数组：`[{"file": "...", "line": 10, ...}, ...]`
 * - markdown 代码块包裹的 JSON 数组：```` ```json [...] ``` ````
 *
 * 解析失败或非数组时返回空数组。所有生成的 Finding source='ai'。
 */
function parseFindingsFromLLMResponse(response: string): Finding[] {
  if (!response || response.trim() === '') return [];

  let text = response.trim();
  // 提取 markdown 代码块中的 JSON
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.warn('[orchestrator] parseFindingsFromLLMResponse failed to parse JSON:', err);
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const findings: Finding[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.file !== 'string') continue;
    findings.push({
      file: obj.file,
      line: typeof obj.line === 'number' ? obj.line : 0,
      severity: (obj.severity as Finding['severity']) ?? 'medium',
      category: typeof obj.category === 'string' ? obj.category : 'general',
      message: typeof obj.message === 'string' ? obj.message : '',
      source: 'ai',
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.5,
      ...(typeof obj.suggestion === 'string' ? { suggestion: obj.suggestion } : {}),
      ...(typeof obj.ruleId === 'string' ? { ruleId: obj.ruleId } : {}),
    });
  }
  return findings;
}

/**
 * 根据变更规模构建审查 DAG。
 *
 * DAG 结构（四阶段编排）：
 * - 第一层（并行）：rule-engine、ai-reviewer、security-reviewer 无依赖并行执行
 * - 第二层（串行）：impact-analyzer 依赖前三个节点完成后执行
 * - 第三层（串行）：reflector 依赖 impact-analyzer 完成后执行
 *
 * 默认包含：
 * - rule-engine：规则匹配（无依赖），调用 matchRules 将 RuleAnnotation 转为 source='rule' 的 findings
 * - ai-reviewer：AI 审查（无依赖），调用 callLLM 解析响应为 source='ai' 的 findings；
 *   未配置 llmConfig / reviewPrompt 时返回空数组；LLM 失败时降级返回空数组
 * - security-reviewer：安全审查（无依赖），调用 callLLM 解析响应为 source='ai' 的 findings；
 *   未配置 llmConfig / securityPrompt 时返回空数组；LLM 失败时降级返回空数组
 * - impact-analyzer：影响分析（依赖 rule-engine, ai-reviewer, security-reviewer），
 *   调用 getImpactRadius 将 BlastRadiusItem 转为 findings；
 *   仅大变更时包含，可通过 includeImpactAnalyzer 控制；失败时降级返回空数组
 * - reflector：反思评估（依赖 impact-analyzer），对前序所有 findings 做置信度评估；
 *   未配置 llmConfig 时返回空数组；LLM 失败时降级返回空数组
 *
 * 通过 options 注入 deps 函数（matchRulesFn / callLLMFn / getImpactRadiusFn）可在测试中替换为 mock。
 */
export function buildReviewDag(
  diffs: FileDiff[],
  options?: BuildReviewDagOptions,
): DagNode<Finding[]>[] {
  const threshold = options?.impactThreshold ?? DEFAULT_IMPACT_THRESHOLD;
  const includeAIReviewer = options?.includeAIReviewer ?? true;
  const includeSecurityReviewer = options?.includeSecurityReviewer ?? true;
  const includeImpactAnalyzer = options?.includeImpactAnalyzer ?? !shouldSkipImpactAnalysis(diffs.length, threshold);
  const includeReflector = options?.includeReflector ?? true;

  // 依赖注入：默认调用真实函数
  const matchRulesFn = options?.matchRulesFn ?? matchRules;
  const callLLMFn = options?.callLLMFn ?? callLLM;
  const getImpactRadiusFn = options?.getImpactRadiusFn ?? getImpactRadius;
  const rules = options?.rules ?? [];
  const llmConfig = options?.llmConfig;
  const reviewPrompt = options?.reviewPrompt ?? '';
  const securityPrompt = options?.securityPrompt ?? '';

  const nodes: DagNode<Finding[]>[] = [
    {
      id: 'rule-engine',
      agentType: 'rule-engine',
      dependencies: [],
      handler: async (ctx) => {
        const diffsForMatch = ctx.diffs.length > 0 ? ctx.diffs : diffs;
        const bundles = bundleFiles(diffsForMatch);
        const findings: Finding[] = [];
        for (const bundle of bundles) {
          const annotations = matchRulesFn(bundle, rules);
          for (const ann of annotations) {
            findings.push(annotationToFinding(bundle, ann));
          }
        }
        return findings;
      },
    },
  ];

  if (includeAIReviewer) {
    nodes.push({
      id: 'ai-reviewer',
      agentType: 'ai-reviewer',
      dependencies: [],
      handler: async () => {
        if (!llmConfig || !reviewPrompt) return [];
        try {
          const response = await callLLMFn(reviewPrompt, llmConfig);
          return parseFindingsFromLLMResponse(response);
        } catch (err) {
          console.warn('ai-reviewer LLM call failed, returning empty:', err);
          return [];
        }
      },
    });
  }

  if (includeSecurityReviewer) {
    nodes.push({
      id: 'security-reviewer',
      agentType: 'security-reviewer',
      dependencies: [],
      handler: async () => {
        if (!llmConfig || !securityPrompt) return [];
        try {
          const response = await callLLMFn(securityPrompt, llmConfig);
          return parseFindingsFromLLMResponse(response);
        } catch (err) {
          console.warn('security-reviewer LLM call failed, returning empty:', err);
          return [];
        }
      },
    });
  }

  const firstLayerIds = ['rule-engine'];
  if (includeAIReviewer) firstLayerIds.push('ai-reviewer');
  if (includeSecurityReviewer) firstLayerIds.push('security-reviewer');

  if (includeImpactAnalyzer) {
    nodes.push({
      id: 'impact-analyzer',
      agentType: 'impact-analyzer',
      dependencies: firstLayerIds,
      handler: async () => {
        try {
          const filePaths = diffs.map((d) => d.path).filter(Boolean);
          const items = await getImpactRadiusFn(filePaths);
          return items.map(blastRadiusItemToFinding);
        } catch (err) {
          console.warn('impact-analyzer failed, returning empty:', err);
          return [];
        }
      },
    });
  }

  if (includeReflector && includeImpactAnalyzer) {
    nodes.push({
      id: 'reflector',
      agentType: 'custom',
      dependencies: ['impact-analyzer'],
      handler: async (ctx) => {
        if (!llmConfig) return [];
        try {
          const allFindings: Finding[] = [];
          for (const [, result] of ctx.previousResults) {
            if (Array.isArray(result)) {
              allFindings.push(...(result as Finding[]));
            }
          }
          if (allFindings.length === 0) return [];
          const reflectionPrompt = buildBatchReflectionPrompt(allFindings);
          const response = await callLLMFn(reflectionPrompt, llmConfig);
          const confidenceResults = JSON.parse(response) as Array<{ id: number; confidence: number }>;
          for (let i = 0; i < allFindings.length && i < confidenceResults.length; i++) {
            allFindings[i].confidence = confidenceResults[i].confidence;
          }
          return allFindings;
        } catch (err) {
          console.warn('reflector LLM call failed, returning original findings:', err);
          const allFindings: Finding[] = [];
          for (const [, result] of ctx.previousResults) {
            if (Array.isArray(result)) {
              allFindings.push(...(result as Finding[]));
            }
          }
          return allFindings;
        }
      },
    });
  }

  return nodes;
}

// ============================================================
// 异常处理与降级
// ============================================================

/**
 * 包装操作，失败时调用降级函数。
 *
 * @param operation 主操作
 * @param fallbackFn 降级函数，接收原始错误，返回降级结果
 * @returns 操作成功返回结果；失败返回降级函数的结果
 * @throws 降级函数也失败时抛出降级错误
 */
export async function withFallback<T>(
  operation: () => Promise<T>,
  fallbackFn: (error: Error) => Promise<T> | T,
): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return await fallbackFn(error);
  }
}

/** 指数退避重试选项 */
export interface RetryOptions {
  /** 最大重试次数（默认 3，即首次失败后最多再重试 3 次） */
  maxRetries?: number;
  /** 基础延迟毫秒数（默认 100） */
  baseDelayMs?: number;
  /** 最大延迟毫秒数（默认 10000） */
  maxDelayMs?: number;
  /** 自定义是否重试判断（默认总是重试） */
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

/**
 * 指数退避重试。
 *
 * 失败后按 baseDelay * 2^attempt 延迟后重试，超过 maxRetries 后抛出最后一次错误。
 * 适用于 API 限流等临时性故障。
 *
 * @param operation 需重试的操作
 * @param options 重试选项
 * @returns 操作成功时的结果
 * @throws 超过最大重试次数后抛出最后一次错误
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 100;
  const maxDelayMs = options?.maxDelayMs ?? 10_000;
  const shouldRetry = options?.shouldRetry ?? (() => true);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // 最后一次尝试或不应重试：直接抛出
      if (attempt === maxRetries || !shouldRetry(lastError, attempt)) {
        throw lastError;
      }
      // 指数退避：base * 2^attempt，上限 maxDelay
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
  // 理论上不会到达
  throw lastError!;
}

// ============================================================
// MCP 降级
// ============================================================

/** MCP 降级选项 */
export interface McpFallbackOptions {
  /** MCP 上下文获取操作 */
  mcpOperation: () => Promise<MCPContextResult>;
  /** 待审查的文件 diff 列表（用于降级时提供全文上下文） */
  diffs: FileDiff[];
}

/** MCP 降级结果 */
export interface McpFallbackResult {
  /** MCP 上下文（降级时为 null） */
  context: MCPContextResult | null;
  /** 是否使用了降级 */
  fallbackUsed: boolean;
  /** 全文上下文文件列表（降级时提供） */
  fullTextFiles: string[];
}

/**
 * 获取审查上下文，MCP 不可用时降级为全文上下文。
 *
 * @returns MCP 上下文成功时返回 context；失败时返回 null + 全文文件列表
 */
export async function getReviewContextWithFallback(
  options: McpFallbackOptions,
): Promise<McpFallbackResult> {
  const fullTextFiles = options.diffs.map((d) => d.path);
  try {
    const context = await options.mcpOperation();
    return { context, fallbackUsed: false, fullTextFiles };
  } catch (err) {
    console.warn('[orchestrator] getReviewContextWithFallback MCP operation failed, falling back:', err);
    return { context: null, fallbackUsed: true, fullTextFiles };
  }
}

// ============================================================
// 模型超时降级
// ============================================================

/** 模型调用选项 */
export interface ModelCallOptions<T> {
  /** 模型操作 */
  operation: () => Promise<T>;
  /** 超时毫秒数（不设置则不应用超时） */
  timeoutMs?: number;
  /** 降级操作（超时或失败时调用，返回降级结果） */
  fallback?: () => Promise<T> | T;
  /** 超时时是否跳过（无 fallback 时生效，返回 null 结果） */
  skipOnTimeout?: boolean;
}

/** 模型调用结果 */
export interface ModelCallResult<T> {
  /** 结果（跳过时为 null） */
  result: T | null;
  /** 是否使用了降级 */
  fallbackUsed: boolean;
  /** 是否跳过 */
  skipped: boolean;
  /** 降级/跳过原因 */
  reason?: string;
}

/**
 * 模型调用，支持超时降级与跳过。
 *
 * - 设置 timeoutMs 时，超时触发降级或跳过
 * - 操作失败（非超时）时，若有 fallback 则降级，否则抛出
 * - 无 fallback 且 skipOnTimeout=true 时，超时返回 null 结果
 * - 无 fallback 且 skipOnTimeout=false 时，超时抛出错误
 */
export async function callModelWithTimeout<T>(
  options: ModelCallOptions<T>,
): Promise<ModelCallResult<T>> {
  const { operation, timeoutMs, fallback, skipOnTimeout = false } = options;

  try {
    let result: T;
    if (timeoutMs !== undefined && timeoutMs > 0) {
      // 超时竞速：操作 vs 定时器
      result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Model timeout after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
    } else {
      result = await operation();
    }
    return { result, fallbackUsed: false, skipped: false };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (fallback) {
      const fallbackResult = await fallback();
      return { result: fallbackResult, fallbackUsed: true, skipped: false, reason };
    }
    if (skipOnTimeout) {
      return { result: null, fallbackUsed: false, skipped: true, reason };
    }
    throw err instanceof Error ? err : new Error(reason);
  }
}

// ============================================================
// 迭代 5：大 PR 分批处理
// ============================================================

/** 单批次处理结果 */
export interface BatchResult {
  /** 批次索引（0-based） */
  batchIndex: number;
  /** 该批次包含的文件 */
  items: FileDiff[];
  /** 该批次产生的 findings */
  findings: Finding[];
  /** 该批次是否成功 */
  success: boolean;
}

/** 单批次错误信息 */
export interface BatchError {
  /** 批次索引（0-based） */
  batchIndex: number;
  /** 错误对象 */
  error: Error;
}

/** 暂停信号（迭代 5：支持中途暂停与恢复） */
export interface PauseSignal {
  /** 是否应该暂停 */
  shouldPause: () => boolean;
  /** 等待暂停解除（async） */
  waitWhilePaused: () => Promise<void>;
}

/** batchProcess 选项 */
export interface BatchProcessOptions {
  /** 每批文件数，默认 10 */
  batchSize?: number;
  /** 是否并行执行批次，默认 false */
  parallel?: boolean;
  /** 并行模式下最大并发数（可选）。
   * 未指定且 parallel=true 时，由 ParallelTuner 基于 diffs 自动调优 */
  parallelism?: number;
  /** 是否启用 ParallelTuner 自动调优（默认 true，仅在 parallel=true 时生效） */
  useTuner?: boolean;
  /** 暂停信号（可选） */
  pauseSignal?: PauseSignal;
  /** 批次处理函数：接收 (batch, batchIndex) 返回 findings */
  processFn: (batch: FileDiff[], batchIndex: number) => Promise<Finding[]>;
}

/** batchProcess 总结果 */
export interface BatchProcessResult {
  /** 所有批次的处理结果 */
  batches: BatchResult[];
  /** 合并后的所有 findings */
  allFindings: Finding[];
  /** 失败批次列表 */
  errors: BatchError[];
  /** 已处理文件总数 */
  totalProcessed: number;
  /** 实际使用的并行度（仅 parallel=true 时有意义；顺序模式下为 1） */
  effectiveParallelism?: number;
}

/**
 * 以受限并发执行任务数组。
 *
 * 同一时刻最多有 `concurrency` 个任务在执行，完成一个立即开始下一个。
 *
 * @param items 待处理元素
 * @param concurrency 最大并发数（>=1）
 * @param worker 处理函数：接收元素及其原始索引，返回结果
 * @returns 与 items 同序的结果数组
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (concurrency < 1) concurrency = 1;
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const total = items.length;

  async function runSlot(): Promise<void> {
    while (true) {
      const idx = nextIndex++;
      if (idx >= total) return;
      results[idx] = await worker(items[idx], idx);
    }
  }

  const slotCount = Math.min(concurrency, total);
  await Promise.all(Array.from({ length: slotCount }, () => runSlot()));
  return results;
}

/**
 * 将文件列表分批处理。
 *
 * - 支持顺序（默认）和并行两种模式
 * - 并行模式下可指定 parallelism 限制最大并发；未指定时由 ParallelTuner 自动调优
 * - 支持暂停信号，可在批次间暂停和恢复
 * - 单批次失败不影响其他批次，错误记录在 errors 中
 *
 * @param diffs 待处理的文件列表
 * @param options 分批选项
 */
export async function batchProcess(
  diffs: FileDiff[],
  options: BatchProcessOptions,
): Promise<BatchProcessResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const parallel = options.parallel ?? false;
  const pauseSignal = options.pauseSignal;

  // 切分批次
  const batches: FileDiff[][] = [];
  for (let i = 0; i < diffs.length; i += batchSize) {
    batches.push(diffs.slice(i, i + batchSize));
  }

  const results: BatchResult[] = [];
  const errors: BatchError[] = [];
  const allFindings: Finding[] = [];

  if (parallel) {
    // Task 5：并行调优 — 基于 diffs 自动计算并行度
    let parallelism = options.parallelism;
    const useTuner = options.useTuner ?? true;
    if (parallelism === undefined && useTuner) {
      const tuner = new ParallelTuner();
      const tuned = tuner.tune(diffs, { ioIntensive: true });
      parallelism = tuned.parallelism;
    }
    if (parallelism === undefined || parallelism < 1) {
      parallelism = getDefaultParallelism();
    }
    // 不超过批次数
    parallelism = Math.min(parallelism, Math.max(1, batches.length));

    // 受限并发执行批次
    const taskResults = await runWithConcurrency(
      batches,
      parallelism,
      async (batch, idx): Promise<BatchResult> => {
        // 暂停检查
        if (pauseSignal) {
          await pauseSignal.waitWhilePaused();
        }
        try {
          const findings = await options.processFn(batch, idx);
          return {
            batchIndex: idx,
            items: batch,
            findings,
            success: true,
          };
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          errors.push({ batchIndex: idx, error });
          return {
            batchIndex: idx,
            items: batch,
            findings: [],
            success: false,
          };
        }
      },
    );
    for (const r of taskResults) {
      results.push(r);
      allFindings.push(...r.findings);
    }
    // 按 batchIndex 排序保证顺序
    results.sort((a, b) => a.batchIndex - b.batchIndex);

    const totalProcessed = batches.reduce((s, b) => s + b.length, 0);
    return {
      batches: results,
      allFindings,
      errors,
      totalProcessed,
      effectiveParallelism: parallelism,
    };
  }

  // 顺序执行
  for (let idx = 0; idx < batches.length; idx++) {
    const batch = batches[idx];
    // 暂停检查
    if (pauseSignal) {
      await pauseSignal.waitWhilePaused();
    }
    try {
      const findings = await options.processFn(batch, idx);
      results.push({
        batchIndex: idx,
        items: batch,
        findings,
        success: true,
      });
      allFindings.push(...findings);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      errors.push({ batchIndex: idx, error });
      results.push({
        batchIndex: idx,
        items: batch,
        findings: [],
        success: false,
      });
    }
  }

  // totalProcessed 计算所有批次的文件数（包括失败的批次，因为文件已被"分配"到批次）
  const totalProcessed = batches.reduce((s, b) => s + b.length, 0);

  return {
    batches: results,
    allFindings,
    errors,
    totalProcessed,
    effectiveParallelism: 1,
  };
}

/**
 * 基于规则匹配的 severity 和 blast-radius 对文件进行优先级排序。
 *
 * 高风险文件（含 critical/high 标注）排在前面，无标注文件保持原顺序在后。
 *
 * @param diffs 待排序的文件列表
 * @param annotatedBundles 已标注的 bundle 列表（含 annotations）
 * @returns 排序后的文件列表
 */
export function prioritizeDiffs(
  diffs: FileDiff[],
  annotatedBundles: FileBundle[],
): FileDiff[] {
  // severity 权重
  const severityWeight: Record<string, number> = {
    critical: 5,
    high: 4,
    medium: 3,
    low: 2,
    info: 1,
  };

  // 文件路径 → 最高 severity 权重
  const filePriority = new Map<string, number>();
  for (const bundle of annotatedBundles) {
    const path = bundle.primary.path;
    let maxWeight = 0;
    for (const ann of bundle.annotations) {
      const w = severityWeight[ann.severity] ?? 0;
      if (w > maxWeight) maxWeight = w;
    }
    // 同一文件可能存在多个 bundle，取最大权重
    const existing = filePriority.get(path) ?? 0;
    if (maxWeight > existing) {
      filePriority.set(path, maxWeight);
    }
  }

  // 稳定排序：相同优先级保持原顺序
  return [...diffs].sort((a, b) => {
    const wA = filePriority.get(a.path) ?? 0;
    const wB = filePriority.get(b.path) ?? 0;
    return wB - wA; // 降序：高优先级在前
  });
}
