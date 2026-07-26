import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { RepoManagerOptions, RepoInfo, CodeHubConfig } from './types.js';

const execFileAsync = promisify(execFile);

const STATE_FILE = '.repo-state.json';

interface RepoState {
  repos: Record<string, {
    projectId: string;
    projectName?: string;
    lastFetchedAt: string;
    httpUrl?: string;
    sshUrl?: string;
    defaultBranch?: string;
  }>;
}

export class RepoManager {
  private readonly baseDir: string;
  private readonly codehubConfig?: CodeHubConfig;

  constructor(options: RepoManagerOptions) {
    this.baseDir = resolve(options.baseDir);
    this.codehubConfig = options.codehubConfig;

    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getRepoPath(projectId: string): string {
    const safeName = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.baseDir, safeName);
  }

  private getStatePath(): string {
    return join(this.baseDir, STATE_FILE);
  }

  private loadState(): RepoState {
    const statePath = this.getStatePath();
    if (!existsSync(statePath)) {
      return { repos: {} };
    }
    try {
      const content = readFileSync(statePath, 'utf-8');
      return JSON.parse(content) as RepoState;
    } catch {
      return { repos: {} };
    }
  }

  private saveState(state: RepoState): void {
    const statePath = this.getStatePath();
    writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  private async runGit(
    args: string[],
    cwd?: string,
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      const result = await execFileAsync('git', args, {
        cwd: cwd ?? this.baseDir,
        maxBuffer: 50 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: '/bin/true',
        },
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Git command failed: git ${args.join(' ')}\n${message}`);
    }
  }

  private buildCloneUrl(projectId: string): string {
    if (!this.codehubConfig) {
      throw new Error('CodeHub config is required for cloning');
    }

    const base = this.codehubConfig.baseUrl.replace(/\/+$/, '');
    const token = encodeURIComponent(this.codehubConfig.token);
    const project = encodeURIComponent(projectId);

    const urlObj = new URL(base);
    return `${urlObj.protocol}//oauth2:${token}@${urlObj.host}${urlObj.pathname ? urlObj.pathname + '/' : ''}${project}.git`;
  }

  private async getRepoSize(repoPath: string): Promise<number> {
    let totalSize = 0;
    const walk = (dir: string): void => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          try {
            const stats = statSync(fullPath);
            totalSize += stats.size;
          } catch {
            // ignore
          }
        }
      }
    };
    walk(repoPath);
    return totalSize;
  }

  async cloneRepo(projectId: string, options?: {
    branch?: string;
    depth?: number;
  }): Promise<RepoInfo> {
    const repoPath = this.getRepoPath(projectId);

    if (existsSync(repoPath)) {
      throw new Error(`Repository already exists locally: ${projectId}`);
    }

    mkdirSync(repoPath, { recursive: true });

    const cloneUrl = this.buildCloneUrl(projectId);
    const args = ['clone', '--progress'];

    if (options?.branch) {
      args.push('--branch', options.branch);
    }
    if (options?.depth) {
      args.push('--depth', String(options.depth));
    }

    args.push(cloneUrl, repoPath);

    try {
      await this.runGit(args);
    } catch (err) {
      // Clean up on failure
      try {
        const { rmSync } = await import('node:fs');
        rmSync(repoPath, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
      throw err;
    }

    const currentBranch = await this.getCurrentBranch(projectId);
    const state = this.loadState();
    state.repos[projectId] = {
      projectId,
      lastFetchedAt: new Date().toISOString(),
      defaultBranch: options?.branch,
    };
    this.saveState(state);

    return {
      projectId,
      localPath: repoPath,
      currentBranch,
      lastFetchedAt: new Date().toISOString(),
    };
  }

  async fetchRepo(projectId: string): Promise<RepoInfo> {
    const repoPath = this.getRepoPath(projectId);

    if (!existsSync(repoPath)) {
      throw new Error(`Repository not found locally: ${projectId}`);
    }

    await this.runGit(['fetch', '--all', '--prune'], repoPath);

    const currentBranch = await this.getCurrentBranch(projectId);
    const state = this.loadState();
    if (state.repos[projectId]) {
      state.repos[projectId].lastFetchedAt = new Date().toISOString();
      this.saveState(state);
    }

    return {
      projectId,
      localPath: repoPath,
      currentBranch,
      lastFetchedAt: new Date().toISOString(),
    };
  }

  async checkoutBranch(projectId: string, branch: string): Promise<RepoInfo> {
    const repoPath = this.getRepoPath(projectId);

    if (!existsSync(repoPath)) {
      throw new Error(`Repository not found locally: ${projectId}`);
    }

    await this.runGit(['checkout', branch], repoPath);
    const currentBranch = await this.getCurrentBranch(projectId);

    return {
      projectId,
      localPath: repoPath,
      currentBranch,
      lastFetchedAt: new Date().toISOString(),
    };
  }

  async pullRepo(projectId: string): Promise<RepoInfo> {
    const repoPath = this.getRepoPath(projectId);

    if (!existsSync(repoPath)) {
      throw new Error(`Repository not found locally: ${projectId}`);
    }

    await this.runGit(['pull'], repoPath);
    const currentBranch = await this.getCurrentBranch(projectId);
    const state = this.loadState();
    if (state.repos[projectId]) {
      state.repos[projectId].lastFetchedAt = new Date().toISOString();
      this.saveState(state);
    }

    return {
      projectId,
      localPath: repoPath,
      currentBranch,
      lastFetchedAt: new Date().toISOString(),
    };
  }

  async getCurrentBranch(projectId: string): Promise<string> {
    const repoPath = this.getRepoPath(projectId);
    const result = await this.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
    return result.stdout.trim();
  }

  async getRepoInfo(projectId: string): Promise<RepoInfo> {
    const repoPath = this.getRepoPath(projectId);

    if (!existsSync(repoPath)) {
      throw new Error(`Repository not found locally: ${projectId}`);
    }

    const currentBranch = await this.getCurrentBranch(projectId);
    const state = this.loadState();
    const repoState = state.repos[projectId];
    const size = await this.getRepoSize(repoPath);

    return {
      projectId,
      projectName: repoState?.projectName,
      localPath: repoPath,
      currentBranch,
      lastFetchedAt: repoState?.lastFetchedAt ?? new Date(0).toISOString(),
      sizeBytes: size,
    };
  }

  async listRepos(): Promise<RepoInfo[]> {
    const state = this.loadState();
    const repos: RepoInfo[] = [];

    for (const projectId of Object.keys(state.repos)) {
      const repoPath = this.getRepoPath(projectId);
      if (existsSync(repoPath)) {
        try {
          const info = await this.getRepoInfo(projectId);
          repos.push(info);
        } catch {
          // skip broken repos
        }
      }
    }

    return repos.sort((a, b) =>
      new Date(b.lastFetchedAt).getTime() - new Date(a.lastFetchedAt).getTime(),
    );
  }

  async getDiff(
    projectId: string,
    fromRef: string,
    toRef: string,
  ): Promise<string> {
    const repoPath = this.getRepoPath(projectId);

    if (!existsSync(repoPath)) {
      throw new Error(`Repository not found locally: ${projectId}`);
    }

    const result = await this.runGit(
      ['diff', `${fromRef}..${toRef}`],
      repoPath,
    );

    return result.stdout;
  }

  async getBranches(projectId: string): Promise<string[]> {
    const repoPath = this.getRepoPath(projectId);

    if (!existsSync(repoPath)) {
      throw new Error(`Repository not found locally: ${projectId}`);
    }

    const result = await this.runGit(['branch', '--list', '-a'], repoPath);
    const branches = result.stdout
      .split('\n')
      .map((line) => line.trim().replace(/^\*\s+/, '').replace(/^remotes\/origin\//, ''))
      .filter((b) => b && !b.includes('HEAD'));

    return [...new Set(branches)].sort();
  }

  async deleteRepo(projectId: string): Promise<void> {
    const repoPath = this.getRepoPath(projectId);

    if (!existsSync(repoPath)) {
      throw new Error(`Repository not found locally: ${projectId}`);
    }

    const { rmSync } = await import('node:fs');
    rmSync(repoPath, { recursive: true, force: true });

    const state = this.loadState();
    delete state.repos[projectId];
    this.saveState(state);
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  repoExists(projectId: string): boolean {
    const repoPath = this.getRepoPath(projectId);
    return existsSync(repoPath);
  }
}

export function createRepoManager(options: RepoManagerOptions): RepoManager {
  return new RepoManager(options);
}

export const DEFAULT_REPO_BASE_DIR = '.codehub-repos';
