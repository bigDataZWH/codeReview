// src/types/index.ts
// 核心类型定义 - 所有模块共享的契约

/** 文件变更类型 */
export type ChangeType = 'added' | 'modified' | 'deleted' | 'renamed';

/** Hunk 变更类型 */
export type HunkChangeType = 'add' | 'del' | 'context';

/** 变更的 Hunk */
export interface DiffHunk {
  readonly oldStart: number;
  readonly oldEnd: number;
  readonly newStart: number;
  readonly newEnd: number;
  readonly header: string;
  readonly lines: HunkLine[];
}

/** Hunk 中的单行 */
export interface HunkLine {
  readonly type: HunkChangeType;
  readonly content: string;
  readonly oldLineNumber: number | null;
  readonly newLineNumber: number | null;
}

/** 变更的文件 */
export interface ChangedFile {
  readonly path: string;
  readonly oldPath: string | null;
  readonly changeType: ChangeType;
  readonly additions: number;
  readonly deletions: number;
  readonly hunks: DiffHunk[];
  readonly contentHash: string;
}

/** 严重程度 */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** 规则类别 */
export type RuleCategory = 'security' | 'quality' | 'performance' | 'maintainability' | 'convention';

/** 规则匹配结果 */
export interface RuleMatch {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly severity: Severity;
  readonly category: RuleCategory;
  readonly file: string;
  readonly line: number;
  readonly message: string;
  readonly suggestion: string;
  readonly focus: boolean;
}

/** 审查会话状态 */
export type SessionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** 审查会话 */
export interface ReviewSession {
  readonly id: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly status: SessionStatus;
  readonly fromRef: string;
  readonly toRef: string;
  readonly fileCount: number;
  readonly config: ReviewConfig;
  readonly stats?: SessionStats;
  readonly error?: string;
}

/** 审查配置 */
export interface ReviewConfig {
  readonly fromRef: string;
  readonly toRef: string;
  readonly withGraph: boolean;
  readonly withRules: boolean;
  readonly rulesPath: string;
  readonly maxFiles: number;
  readonly tokenBudget: number;
  readonly modelTier: ModelTier;
}

/** 模型分级 */
export type ModelTier = 'fast' | 'standard' | 'deep';

/** 会话统计 */
export interface SessionStats {
  readonly totalFiles: number;
  readonly reviewedFiles: number;
  readonly totalFindings: number;
  readonly totalTokens: number;
  readonly durationMs: number;
}

/** Finding（审查发现） */
export interface Finding {
  readonly id: string;
  readonly sessionId: string;
  readonly file: string;
  readonly line: number;
  readonly endLine?: number;
  readonly severity: Severity;
  readonly category: RuleCategory;
  readonly message: string;
  readonly suggestion: string;
  readonly confidence: number;
  readonly agent: string;
  readonly status: FindingStatus;
  readonly createdAt: number;
}

/** Finding 状态 */
export type FindingStatus = 'open' | 'resolved' | 'ignored' | 'false_positive';

/** 人工反馈 */
export interface Feedback {
  readonly id: string;
  readonly findingId: string;
  readonly action: FeedbackAction;
  readonly comment?: string;
  readonly createdAt: number;
  readonly userId: string;
}

/** 反馈动作 */
export type FeedbackAction = 'accept' | 'reject' | 'modify' | 'ignore';

/** 缓存层级 */
export type CacheTier = 'memory' | 'disk' | 'remote';

/** 缓存条目 */
export interface CacheEntry<T> {
  readonly key: string;
  readonly value: T;
  readonly tier: CacheTier;
  readonly createdAt: number;
  readonly ttl: number;
  readonly version?: string;
}

/** 图谱上下文 */
export interface GraphContext {
  readonly files: Record<string, FileGraphInfo>;
  readonly overallRiskScore: number;
  readonly highImpactFiles: string[];
  readonly graphVersion: string;
}

/** 文件图谱信息 */
export interface FileGraphInfo {
  readonly callers: string[];
  readonly callees: string[];
  readonly tests: string[];
  readonly relatedFiles: string[];
  readonly blastRadiusScore: number;
}

/** PR 规模等级 */
export type PRScale = 'small' | 'medium' | 'large' | 'extra_large';

/** 审查策略 */
export interface ReviewStrategy {
  readonly scale: PRScale;
  readonly mode: ReviewMode;
  readonly batchSize: number;
  readonly skipAgents: string[];
  readonly prioritySorting: boolean;
  readonly summaryOnly: boolean;
}

/** 审查模式 */
export type ReviewMode = 'quick' | 'standard' | 'deep';

/** 后处理阶段 */
export type PostProcessStage = 'hard_filter' | 'locate_fix' | 'ai_reflect';

/** 后处理结果 */
export interface PostProcessResult {
  readonly input: Finding[];
  readonly output: Finding[];
  readonly stageResults: StageResult[];
}

/** 单阶段结果 */
export interface StageResult {
  readonly stage: PostProcessStage;
  readonly inputCount: number;
  readonly outputCount: number;
  readonly removedCount: number;
  readonly durationMs: number;
}

/** 文件分组（智能打包） */
export interface FileGroup {
  readonly id: string;
  readonly files: string[];
  readonly reason: string;
  readonly priority: number;
}

/** 审查单元（一个 Agent 处理的最小单元） */
export interface ReviewUnit {
  readonly id: string;
  readonly groupId: string;
  readonly files: string[];
  readonly diff: string;
  readonly context: string;
  readonly ruleAnnotations: RuleMatch[];
  readonly estimatedTokens: number;
}

/** 管道分析结果（最终输出） */
export interface PipeAnalysisResult {
  readonly sessionId: string;
  readonly changedFiles: ChangedFile[];
  readonly fileGroups: FileGroup[];
  readonly ruleMatches: RuleMatch[];
  readonly graphContext: GraphContext | null;
  readonly reviewUnits: ReviewUnit[];
  readonly strategy: ReviewStrategy;
  readonly stats: SessionStats;
}
