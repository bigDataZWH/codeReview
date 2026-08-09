import type {
  CodeHubConfig,
  CodeHubMR,
  CodeHubMRListResponse,
  CodeHubMRDiff,
  CodeHubComment,
  CodeHubProject,
  CodeHubBranch,
  CodeHubIssue,
  CodeHubCreateIssueOptions,
} from './types.js';

const DEFAULT_TIMEOUT = 30000;
const API_VERSION = 'api/v3';

export class CodeHubClient {
  private readonly config: CodeHubConfig;
  private readonly timeout: number;

  constructor(config: CodeHubConfig, options?: { timeout?: number }) {
    this.config = config;
    this.timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    const encodedProjectId = encodeURIComponent(this.config.projectId);
    let url = `${base}/${API_VERSION}/projects/${encodedProjectId}${path}`;

    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      }
      const queryStr = params.toString();
      if (queryStr) {
        url += `?${queryStr}`;
      }
    }

    return url;
  }

  private buildHeaders(): Record<string, string> {
    return {
      'PRIVATE-TOKEN': this.config.token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'opencode-code-review',
    };
  }

  private async request<T>(
    path: string,
    options: RequestInit & { query?: Record<string, string | number | boolean | undefined> } = {},
  ): Promise<T> {
    const { query, ...fetchOptions } = options;
    const url = this.buildUrl(path, query);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers: {
          ...this.buildHeaders(),
          ...fetchOptions.headers,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorMessage = `CodeHub API error: ${response.status} ${response.statusText}`;
        try {
          const errBody = (await response.json()) as { message?: string; error?: string };
          if (errBody.message) {
            errorMessage = `${response.status} ${errBody.message}`;
          } else if (errBody.error) {
            errorMessage = `${response.status} ${errBody.error}`;
          }
        } catch {
          // ignore JSON parse error
        }
        throw new Error(errorMessage);
      }

      if (response.status === 204) {
        return undefined as unknown as T;
      }

      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`CodeHub API request timed out after ${this.timeout}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async getMRList(options?: {
    state?: 'open' | 'closed' | 'merged' | 'all';
    page?: number;
    perPage?: number;
    search?: string;
    authorId?: number;
    labels?: string;
    orderBy?: 'created_at' | 'updated_at' | 'title';
    sort?: 'asc' | 'desc';
    sourceBranch?: string;
    targetBranch?: string;
  }): Promise<CodeHubMRListResponse> {
    const page = options?.page ?? 1;
    const perPage = options?.perPage ?? 20;

    const query: Record<string, string | number | boolean | undefined> = {
      state: options?.state,
      page,
      per_page: perPage,
      search: options?.search,
      author_id: options?.authorId,
      labels: options?.labels,
      order_by: options?.orderBy,
      sort: options?.sort,
      source_branch: options?.sourceBranch,
      target_branch: options?.targetBranch,
    };

    const mrs = await this.request<CodeHubMR[]>('/merge_requests', {
      method: 'GET',
      query,
    });

    return {
      mrs,
      total: mrs.length,
      page,
      perPage,
      totalPages: Math.ceil(mrs.length / perPage) || 1,
    };
  }

  async getMR(mrIid: number): Promise<CodeHubMR> {
    return this.request<CodeHubMR>(`/merge_requests/${mrIid}`, {
      method: 'GET',
    });
  }

  async getMRDiff(mrIid: number): Promise<CodeHubMRDiff> {
    return this.request<CodeHubMRDiff>(`/merge_requests/${mrIid}/diffs`, {
      method: 'GET',
      query: {
        unidiff: true,
      },
    });
  }

  async getMRComments(mrIid: number): Promise<CodeHubComment[]> {
    return this.request<CodeHubComment[]>(`/merge_requests/${mrIid}/notes`, {
      method: 'GET',
      query: {
        sort: 'asc',
        order_by: 'created_at',
      },
    });
  }

  async getMRDiffs(mrIid: number): Promise<CodeHubComment[]> {
    return this.request<CodeHubComment[]>(`/merge_requests/${mrIid}/discussions`, {
      method: 'GET',
    });
  }

  async createMRComment(
    mrIid: number,
    body: string,
    options?: {
      path?: string;
      line?: number;
      lineType?: 'new' | 'old';
      baseSha?: string;
      headSha?: string;
      startSha?: string;
      positionType?: 'text' | 'line';
    },
  ): Promise<CodeHubComment> {
    const payload: Record<string, unknown> = { body };

    if (options?.path && options?.line !== undefined) {
      payload.position = {
        base_sha: options.baseSha,
        head_sha: options.headSha,
        start_sha: options.startSha,
        new_path: options.lineType === 'new' ? options.path : undefined,
        old_path: options.lineType === 'old' ? options.path : undefined,
        new_line: options.lineType === 'new' ? options.line : undefined,
        old_line: options.lineType === 'old' ? options.line : undefined,
        position_type: options.positionType ?? 'text',
      };
    }

    return this.request<CodeHubComment>(`/merge_requests/${mrIid}/notes`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateMRComment(
    mrIid: number,
    noteId: number,
    body: string,
  ): Promise<CodeHubComment> {
    return this.request<CodeHubComment>(`/merge_requests/${mrIid}/notes/${noteId}`, {
      method: 'PUT',
      body: JSON.stringify({ body }),
    });
  }

  async deleteMRComment(mrIid: number, noteId: number): Promise<void> {
    return this.request<void>(`/merge_requests/${mrIid}/notes/${noteId}`, {
      method: 'DELETE',
    });
  }

  /**
   * 合入 MR
   * @param mrIid MR 的 iid
   * @param mergeMethod 合入方式：merge | squash | rebase（默认 squash）
   */
  async mergeMR(
    mrIid: number | string,
    mergeMethod: 'merge' | 'squash' | 'rebase' = 'squash',
  ): Promise<any> {
    // 调用 PUT /merge_requests/:iid/merge，body 携带 merge_method
    return this.request<any>(`/merge_requests/${mrIid}/merge`, {
      method: 'PUT',
      body: JSON.stringify({ merge_method: mergeMethod }),
    });
  }

  async getProject(): Promise<CodeHubProject> {
    return this.request<CodeHubProject>('', {
      method: 'GET',
    });
  }

  async getBranches(options?: {
    search?: string;
    page?: number;
    perPage?: number;
  }): Promise<CodeHubBranch[]> {
    return this.request<CodeHubBranch[]>('/repository/branches', {
      method: 'GET',
      query: {
        search: options?.search,
        page: options?.page,
        per_page: options?.perPage,
      },
    });
  }

  async getBranch(branchName: string): Promise<CodeHubBranch> {
    const encodedBranch = encodeURIComponent(branchName);
    return this.request<CodeHubBranch>(`/repository/branches/${encodedBranch}`, {
      method: 'GET',
    });
  }

  async getRawFile(
    filePath: string,
    ref: string,
  ): Promise<string> {
    const encodedPath = encodeURIComponent(filePath);
    const url = this.buildUrl(`/repository/files/${encodedPath}/raw`, { ref });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          ...this.buildHeaders(),
          Accept: 'text/plain',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
      }

      return await response.text();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`File fetch timed out after ${this.timeout}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.getProject();
      return true;
    } catch {
      return false;
    }
  }

  async createIssue(options: CodeHubCreateIssueOptions): Promise<CodeHubIssue> {
    const payload: Record<string, unknown> = {
      title: options.title,
      description: options.description,
    };
    if (options.labels?.length) payload.labels = options.labels.join(',');
    if (options.assigneeId) payload.assignee_id = options.assigneeId;
    if (options.milestoneId) payload.milestone_id = options.milestoneId;
    return this.request<CodeHubIssue>('/issues', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getIssues(options?: {
    state?: 'opened' | 'closed' | 'all';
    labels?: string[];
    page?: number;
    perPage?: number;
  }): Promise<CodeHubIssue[]> {
    return this.request<CodeHubIssue[]>('/issues', {
      method: 'GET',
      query: {
        state: options?.state,
        labels: options?.labels?.join(','),
        page: options?.page,
        per_page: options?.perPage,
      },
    });
  }

  getConfig(): CodeHubConfig {
    return { ...this.config };
  }
}

export function createCodeHubClient(
  config: CodeHubConfig,
  options?: { timeout?: number },
): CodeHubClient {
  return new CodeHubClient(config, options);
}
