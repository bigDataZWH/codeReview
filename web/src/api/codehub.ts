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

export const codehubApi = {
  getConfig: () => api.get('/codehub/config').then((r) => r.data),
  saveConfig: (config: Partial<CodeHubConfig>) =>
    api.post('/codehub/config', config).then((r) => r.data),
  testConnection: () => api.post('/codehub/config/test').then((r) => r.data),

  getMRList: (params?: {
    state?: 'open' | 'closed' | 'merged' | 'all';
    page?: number;
    per_page?: number;
    search?: string;
    order_by?: 'created_at' | 'updated_at' | 'title';
    sort?: 'asc' | 'desc';
  }) =>
    api
      .get<MRListResponse>('/codehub/mrs', { params })
      .then((r) => r.data),

  getMR: (mrIid: number) =>
    api.get(`/codehub/mrs/${mrIid}`).then((r) => r.data),

  getMRDiff: (mrIid: number) =>
    api.get<MRDiffResponse>(`/codehub/mrs/${mrIid}/diff`).then((r) => r.data),

  getMRComments: (mrIid: number) =>
    api.get(`/codehub/mrs/${mrIid}/comments`).then((r) => r.data),

  createMRComment: (
    mrIid: number,
    data: { body: string; path?: string; line?: number; line_type?: 'new' | 'old' },
  ) => api.post(`/codehub/mrs/${mrIid}/comments`, data).then((r) => r.data),

  getMRFindings: (mrIid: number) =>
    api.get(`/codehub/mrs/${mrIid}/findings`).then((r) => r.data),

  createMRIssue: (mrIid: number, options?: { labels?: string[] }) =>
    api.post(`/codehub/mrs/${mrIid}/issue`, options).then((r) => r.data),

  saveMRReport: (mrIid: number, options?: { filePath?: string }) =>
    api.post(`/codehub/mrs/${mrIid}/report`, options).then((r) => r.data),

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
  deleteRepo: (projectId: string) =>
    api.delete(`/codehub/repos/${encodeURIComponent(projectId)}`).then((r) => r.data),

  getDashboard: () => api.get('/codehub/dashboard').then((r) => r.data),

  getOpencodeConfig: () =>
    api.get('/opencode/config').then((r) => r.data),

  saveOpencodeConfig: (config: unknown) =>
    api.put('/opencode/config', config).then((r) => r.data),

  startOpencodeServe: (options?: { hostname?: string; port?: number }) =>
    api.post('/opencode/serve/start', options).then((r) => r.data),

  stopOpencodeServe: () =>
    api.post('/opencode/serve/stop').then((r) => r.data),

  getOpencodeServeStatus: () =>
    api.get('/opencode/serve/status').then((r) => r.data),

  runMRReview: (mrIid: number) =>
    api.post(`/codehub/mrs/${mrIid}/review`).then((r) => r.data),

  createFindingComment: (mrIid: number, findingId: string) =>
    api
      .post(`/codehub/mrs/${mrIid}/findings/${findingId}/comment`)
      .then((r) => r.data),
};
