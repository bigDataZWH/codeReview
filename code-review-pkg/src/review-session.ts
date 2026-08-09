// src/review-session.ts — 持久化审查会话存储
//
// 职责：
// 1. ReviewFinding / ReviewSession 接口定义
// 2. ReviewSessionStore：内存 Map + 可选 JSON 文件持久化
//
// 设计取舍：
// - 使用同步 fs API（writeFileSync），与现有 findings-history-store.ts 保持一致
// - 文件路径默认为 .code-review-sessions.json，不传则仅内存存储
// - 每次 mutation 后自动 save（若配置了文件路径）

import { writeFileSync, readFileSync, existsSync } from 'node:fs';

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

export interface CreateSessionInput {
  mrIid: number;
  repoId?: string;
  status: ReviewSessionStatus;
  progress?: number;
  findings?: ReviewFinding[];
  error?: string;
  workerId?: string;
}

export interface ListSessionsFilter {
  status?: ReviewSessionStatus;
  mrIid?: number;
  repoId?: string;
}

function generateSessionId(): string {
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class ReviewSessionStore {
  private sessions: Map<string, ReviewSession> = new Map();
  private filePath: string | null;

  constructor(filePath?: string) {
    this.filePath = filePath ?? null;
    if (this.filePath) {
      this.load();
    }
  }

  createSession(input: Omit<ReviewSession, 'id' | 'startedAt' | 'updatedAt'>): ReviewSession {
    const now = new Date().toISOString();
    const session: ReviewSession = {
      ...input,
      id: generateSessionId(),
      startedAt: now,
      updatedAt: now,
      progress: input.progress ?? 0,
      findings: input.findings ?? [],
    };
    this.sessions.set(session.id, session);
    this.save();
    return session;
  }

  getSession(id: string): ReviewSession | undefined {
    return this.sessions.get(id);
  }

  updateSession(id: string, patch: Partial<ReviewSession>): ReviewSession {
    const existing = this.sessions.get(id);
    if (!existing) {
      throw new Error(`Session not found: ${id}`);
    }
    const updated: ReviewSession = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(id, updated);
    this.save();
    return updated;
  }

  listSessions(filter?: ListSessionsFilter): ReviewSession[] {
    const all = Array.from(this.sessions.values());
    if (!filter) return all;
    return all.filter((s) => {
      if (filter.status !== undefined && s.status !== filter.status) return false;
      if (filter.mrIid !== undefined && s.mrIid !== filter.mrIid) return false;
      if (filter.repoId !== undefined && s.repoId !== filter.repoId) return false;
      return true;
    });
  }

  deleteSession(id: string): void {
    this.sessions.delete(id);
    this.save();
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as ReviewSession[];
      for (const s of data) {
        this.sessions.set(s.id, s);
      }
    } catch {
      // ignore corrupt file
    }
  }

  private save(): void {
    if (!this.filePath) return;
    const data = Array.from(this.sessions.values());
    try {
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // write failure non-fatal
    }
  }
}