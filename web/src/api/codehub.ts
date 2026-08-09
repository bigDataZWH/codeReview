import api from './client';

export interface CodeHubConfig {
  baseUrl: string;
  token: string;
  projectId: string;
  repoBaseDir: string;
  reviewConfig?: {
    defaultStrength?: 'lenient' | 'standard' | 'strict';
    securityReview?: boolean;
    defaultLanguage?: string;
  };
}

export interface OpencodeManagerConfig {
  startCommand: string;
  workDir: string;
}

export interface CodeHubMR {
  id: number;
  iid: number;
  title: string;
  description: string;
  state: 'open' | 'merged' | 'closed' | 'locked';
  source_branch: string;
  target_branch: string;
  author: { id: number; name: string; username: string; avatar_url?: string };
  created_at: string;
  updated_at: string;
  merged_at?: string;
  closed_at?: string;
  merge_status?: string;
  web_url?: string;
  changes_count?: string;
  user_notes_count?: number;
  work_in_progress?: boolean;
}

export interface MRListResponse {
  mrs: CodeHubMR[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface DiffFile {
  old_path: string;
  new_path: string;
  diff: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
  binary: boolean;
  generated_file?: boolean;
}

export interface MRDiffResponse {
  changes: DiffFile[];
  title?: string;
  description?: string;
}

export interface CodeHubComment {
  id: number;
  body: string;
  author: { id: number; name: string; username: string; avatar_url?: string };
  created_at: string;
  updated_at: string;
  position?: {
    base_sha?: string;
    head_sha?: string;
    start_sha?: string;
    new_path?: string;
    old_path?: string;
    new_line?: number;
    old_line?: number;
    position_type?: string;
  };
}

export interface RepoInfo {
  projectId: string;
  projectName?: string;
  localPath: string;
  currentBranch: string;
  lastFetchedAt: string;
  sizeBytes?: number;
}

export interface DashboardStats {
  totalMRs: number;
  openMRs: number;
  mergedMRs: number;
  closedMRs: number;
  totalFindings: number;
  findingsBySeverity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  pendingReviews: number;
  reviewedToday: number;
  reviewedThisWeek: number;
  trend: Array<{ date: string; reviews: number; findings: number }>;
}

// ===== 多仓配置相关类型 =====
export interface RepoConfig {
  repoId: string;
  name: string;
  baseUrl: string;
  token: string;
  projectId: number | string;
  repoDir?: string;
}
export interface MultiRepoConfig {
  repos: RepoConfig[];
  activeRepoId: string | null;
  syncIntervalMs: number;
}

// ===== 同步状态与结果 =====
export interface SyncStatus {
  running: boolean;
  lastSyncAt: string | null;
  lastSyncCount: number;
  nextSyncAt: string | null;
  syncIntervalMs: number;
  paused: boolean;
  errors: string[];
}
export interface SyncResult {
  ok: boolean;
  syncedAt: string;
  repoCount: number;
  mrCount: number;
  errors: string[];
}

// ===== 批量提交评论与合入 =====
export interface BatchCommentResult {
  ok: boolean;
  total: number;
  success: number;
  failed: number;
  results: Array<{ findingId: string; ok: boolean; commentId?: number; error?: string }>;
}
export interface MergeCheckResult {
  ok: boolean;
  canMerge: boolean;
  blockingFindings: any[];
  warnings: string[];
}
export interface MergeResult {
  ok: boolean;
  merged: boolean;
  mrState: string;
}

// ===== 报表相关类型 =====
export interface ReportsOverview {
  acceptanceRate: number;
  acceptanceNumerator: number;
  acceptanceDenominator: number;
  interceptionCount: number;
  reviewCount: number;
  totalFindings: number;
  avgFindingsPerMR: number;
}
export interface TrendPoint {
  date: string;
  reviews: number;
  findings: number;
  acceptedFindings: number;
  interceptions: number;
}
export interface ByRuleItem {
  ruleId: string;
  ruleName: string;
  hitCount: number;
  acceptanceCount: number;
  acceptanceRate: number;
}
export interface ByAuthorItem {
  author: string;
  mrCount: number;
  totalFindings: number;
  avgFindingsPerMR: number;
  acceptanceRate: number;
}
export interface ByRepoItem {
  repoId: string;
  repoName: string;
  mrCount: number;
  findings: number;
  acceptanceRate: number;
  interceptions: number;
}

// ===== 环境检测与一键配置 =====
export interface EnvironmentHealth {
  ok: boolean;
  opencode: {
    installed: boolean;
    version?: string;
    error?: string;
  };
  nodejs: {
    version: string;
    supported: boolean;
  };
  ports: {
    opencode: { port: number; available: boolean };
    api: { port: number; available: boolean };
    web: { port: number; available: boolean };
  };
  config: {
    codehubConfigured: boolean;
    opencodeConfigured: boolean;
    reviewConfigured: boolean;
  };
  initialized?: boolean;
  agents?: Array<{ name: string; status: 'ready' | 'pending' | 'failed' }>;
  lastWarmupMs?: number;
  derivedStartCommand?: string;
}

export interface QuickConfigureInput {
  codehub: {
    name: string;
    baseUrl: string;
    token: string;
    projectId: string;
  };
  reviewConfig?: {
    defaultStrength?: 'lenient' | 'standard' | 'strict';
    securityReview?: boolean;
    defaultLanguage?: string;
  };
  opencodeManager?: {
    startCommand?: string;
    workDir?: string;
  };
}

export interface StartAllResult {
  ok: boolean;
  services: {
    opencode: { started: boolean; pid?: number; error?: string };
    api: { started: boolean; pid?: number; error?: string };
    web: { started: boolean; pid?: number; error?: string };
  };
}

// ===== 审查会话 =====
export interface ReviewFinding {
  id: string;
  file: string;
  line: number;
  endLine?: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  message: string;
  suggestion?: string;
  confidence: number;
  source: 'rule' | 'ai';
  ruleId?: string;
}

export type ReviewSessionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ReviewSession {
  id: string;
  mrIid: number;
  repoId?: string;
  status: ReviewSessionStatus;
  progress: number;
  findings: ReviewFinding[];
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  error?: string;
  workerId?: string;
}

export interface ListReviewSessionsResponse {
  ok: boolean;
  sessions: ReviewSession[];
  count: number;
}

export const codehubApi = {
  getConfig: () => api.get('/codehub/config').then((r) => r.data),
  saveConfig: (config: Partial<CodeHubConfig>) =>
    api.post('/codehub/config', config).then((r) => r.data),
  testConnection: (repoId?: string) =>
    api.post('/codehub/config/test', undefined, { params: { repoId } }).then((r) => r.data),

  // 现有 MR 相关方法新增可选 repoId 查询参数（多仓场景下指定目标仓库）
  getMRList: (
    params?: {
      state?: 'open' | 'closed' | 'merged' | 'all';
      page?: number;
      per_page?: number;
      search?: string;
      order_by?: 'created_at' | 'updated_at' | 'title';
      sort?: 'asc' | 'desc';
    },
    repoId?: string,
  ) =>
    api
      .get<MRListResponse>('/codehub/mrs', { params: { ...params, repoId } })
      .then((r) => r.data),

  getMR: (mrIid: number, repoId?: string) =>
    api
      .get(`/codehub/mrs/${mrIid}`, { params: { repoId } })
      .then((r) => r.data),

  getMRDiff: (mrIid: number, repoId?: string) =>
    api
      .get<MRDiffResponse>(`/codehub/mrs/${mrIid}/diff`, { params: { repoId } })
      .then((r) => r.data),

  getMRComments: (mrIid: number, repoId?: string) =>
    api
      .get(`/codehub/mrs/${mrIid}/comments`, { params: { repoId } })
      .then((r) => r.data),

  createMRComment: (
    mrIid: number,
    data: { body: string; path?: string; line?: number; line_type?: 'new' | 'old' },
    repoId?: string,
  ) =>
    api
      .post(`/codehub/mrs/${mrIid}/comments`, data, { params: { repoId } })
      .then((r) => r.data),

  getMRFindings: (mrIid: number, repoId?: string) =>
    api
      .get(`/codehub/mrs/${mrIid}/findings`, { params: { repoId } })
      .then((r) => r.data),

  createMRIssue: (mrIid: number, options?: { labels?: string[] }, repoId?: string) =>
    api
      .post(`/codehub/mrs/${mrIid}/issue`, options, { params: { repoId } })
      .then((r) => r.data),

  saveMRReport: (mrIid: number, options?: { filePath?: string }, repoId?: string) =>
    api
      .post(`/codehub/mrs/${mrIid}/report`, options, { params: { repoId } })
      .then((r) => r.data),

  getRepos: () => api.get('/codehub/repos').then((r) => r.data),
  getRepo: (projectId: string) =>
    api.get(`/codehub/repos/${encodeURIComponent(projectId)}`).then((r) => r.data),
  cloneRepo: (projectId: string, data?: { branch?: string; depth?: number }) =>
    api
      .post(`/codehub/repos/${encodeURIComponent(projectId)}/clone`, data)
      .then((r) => r.data),
  fetchRepo: (projectId: string) =>
    api
      .post(`/codehub/repos/${encodeURIComponent(projectId)}/fetch`)
      .then((r) => r.data),
  pullRepo: (projectId: string) =>
    api.post(`/codehub/repos/${encodeURIComponent(projectId)}/pull`).then((r) => r.data),
  checkoutBranch: (projectId: string, branch: string) =>
    api
      .post(`/codehub/repos/${encodeURIComponent(projectId)}/checkout`, { branch })
      .then((r) => r.data),
  getRepoBranches: (projectId: string) =>
    api.get(`/codehub/repos/${encodeURIComponent(projectId)}/branches`).then((r) => r.data),
  // 注意：此 deleteRepo 操作的是 /codehub/repos/:projectId（本地克隆仓库管理），
  // 与下方多仓配置的 deleteRepoConfig（/codehub/repos-config/:repoId）不同。
  deleteRepo: (projectId: string) =>
    api.delete(`/codehub/repos/${encodeURIComponent(projectId)}`).then((r) => r.data),

  getDashboard: () => api.get('/codehub/dashboard').then((r) => r.data),

  getOpencodeConfig: () =>
    api.get('/opencode/config').then((r) => r.data),

  saveOpencodeConfig: (config: unknown) =>
    api.put('/opencode/config', config).then((r) => r.data),

  getOpencodeManagerConfig: () =>
    api.get('/opencode/manager-config').then((r) => r.data),

  saveOpencodeManagerConfig: (config: Partial<OpencodeManagerConfig>) =>
    api.put('/opencode/manager-config', config).then((r) => r.data),

  startService: (service: 'backend' | 'frontend') =>
    api.post('/services/start', { service }).then((r) => r.data),

  startOpencodeServe: (options?: { hostname?: string; port?: number; commandTemplate?: string; workDir?: string }) =>
    api.post('/opencode/serve/start', options).then((r) => r.data),

  stopOpencodeServe: () =>
    api.post('/opencode/serve/stop').then((r) => r.data),

  getOpencodeServeStatus: () =>
    api.get('/opencode/serve/status').then((r) => r.data),

  runMRReview: (mrIid: number, repoId?: string) =>
    api
      .post(`/codehub/mrs/${mrIid}/review`, undefined, { params: { repoId } })
      .then((r) => r.data),

  createFindingComment: (mrIid: number, findingId: string, repoId?: string) =>
    api
      .post(`/codehub/mrs/${mrIid}/findings/${findingId}/comment`, undefined, {
        params: { repoId },
      })
      .then((r) => r.data),

  // ===== 多仓配置 =====
  // 获取多仓配置列表及当前激活的仓库
  listReposConfig: () => api.get('/codehub/repos-config').then((r) => r.data),

  // 新增一个仓库配置
  addRepo: (input: {
    name: string;
    baseUrl: string;
    token: string;
    projectId: number | string;
    repoDir?: string;
  }) => api.post('/codehub/repos-config', input).then((r) => r.data),

  // 更新指定仓库配置（部分字段）
  updateRepo: (repoId: string, patch: Partial<RepoConfig>) =>
    api
      .put(`/codehub/repos-config/${encodeURIComponent(repoId)}`, patch)
      .then((r) => r.data),

  // 删除指定仓库配置（操作 /codehub/repos-config/:repoId）
  // 注意：命名为 deleteRepoConfig 以避免与已有 deleteRepo（本地克隆管理）冲突
  deleteRepoConfig: (repoId: string) =>
    api
      .delete(`/codehub/repos-config/${encodeURIComponent(repoId)}`)
      .then((r) => r.data),

  // 激活指定仓库配置
  activateRepo: (repoId: string) =>
    api
      .post(`/codehub/repos-config/${encodeURIComponent(repoId)}/activate`)
      .then((r) => r.data),

  // ===== 同步 =====
  // 立即触发一次 MR 同步
  triggerSync: () => api.post('/codehub/mrs/sync').then((r) => r.data),

  // 查询同步任务状态
  getSyncStatus: () => api.get('/codehub/mrs/sync/status').then((r) => r.data),

  // 暂停定时同步
  pauseSync: () => api.post('/codehub/mrs/sync/pause').then((r) => r.data),

  // 恢复定时同步
  resumeSync: () => api.post('/codehub/mrs/sync/resume').then((r) => r.data),

  // ===== 批量提交评论 + 合入 =====
  // 批量提交当前 MR 所有待评论 findings
  batchSubmitComments: (mrIid: number, repoId?: string) =>
    api
      .post(`/codehub/mrs/${mrIid}/comments/batch`, undefined, { params: { repoId } })
      .then((r) => r.data),

  // 合入前检查：是否存在阻断性 findings
  mergeCheck: (mrIid: number, repoId?: string) =>
    api
      .get(`/codehub/mrs/${mrIid}/merge/check`, { params: { repoId } })
      .then((r) => r.data),

  // 执行合入（存在阻断时后端返回 409）
  mergeMR: (
    mrIid: number,
    options?: { mergeMethod?: 'merge' | 'squash' | 'rebase'; force?: boolean },
    repoId?: string,
  ) =>
    api
      .post(`/codehub/mrs/${mrIid}/merge`, options, { params: { repoId } })
      .then((r) => r.data),

  // ===== 报表（路径前缀 /reports）=====
  // 总览数据
  getReportsOverview: () => api.get('/reports/overview').then((r) => r.data),

  // 趋势数据，range 省略时由后端默认
  getReportsTrend: (range?: '7d' | '30d' | '90d') =>
    api.get('/reports/trend', { params: { range } }).then((r) => r.data),

  // 按规则聚合
  getReportsByRule: () => api.get('/reports/by-rule').then((r) => r.data),

  // 按作者聚合
  getReportsByAuthor: () => api.get('/reports/by-author').then((r) => r.data),

  // 按仓库聚合
  getReportsByRepo: () => api.get('/reports/by-repo').then((r) => r.data),

  // ===== 环境检测与一键配置 =====
  getOpencodeHealth: () =>
    api.get('/opencode/health').then((r) => r.data),

  quickConfigure: (config: QuickConfigureInput) =>
    api.post('/opencode/quick-configure', config).then((r) => r.data),

  startAllServices: () =>
    api.post('/services/start-all').then((r) => r.data),

  getServiceStatus: () =>
    api.get('/services/status').then((r) => r.data),

  // ===== 审查会话 =====
  startReview: async (mrIid: number, repoId?: string, priority: 'low' | 'normal' | 'high' = 'normal'): Promise<{ ok: boolean; sessionId?: string; error?: string }> => {
    try {
      const r = await api.post('/review/start', { mrIid, repoId, priority });
      return r.data as { ok: boolean; sessionId?: string; error?: string };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '未知错误';
      return { ok: false, error: msg };
    }
  },

  getReviewSession: (id: string) =>
    api
      .get(`/review/${id}`)
      .then((r) => r.data as { ok: boolean; session: ReviewSession }),

  listReviewSessions: (status?: ReviewSessionStatus) =>
    api
      .get<ListReviewSessionsResponse>('/review', { params: { status } })
      .then((r) => r.data),

  deleteReviewSession: (id: string) =>
    api.delete(`/review/${id}`).then((r) => r.data),

  getReviewStreamUrl: (id: string) => `/review/${id}/stream`,
};
