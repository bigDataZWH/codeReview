// src/review-worker-pool.ts — 并发审查 Worker 池
//
// 职责：
// 1. WorkerConfig / ReviewTask 接口定义
// 2. ReviewWorkerPool：基于并发限制的任务调度器
//
// 设计取舍：
// - 简单的事件发射器（on/off/emit），不依赖 events 模块
// - Worker 循环：轮询 queued 任务，最多 concurrency 个并行执行
// - 默认 mock runner 返回含各 severity 的 findings

import {
  ReviewSessionStore,
  type ReviewFinding,
  type ReviewSessionStatus,
} from './review-session.js';

export interface WorkerConfig {
  concurrency: number;
  pollIntervalMs: number;
  modelRouter?: (mrSize: number) => 'small' | 'large';
}

export interface ReviewTask {
  sessionId: string;
  mrIid: number;
  repoId?: string;
  diff?: string;
  priority?: 'low' | 'normal' | 'high';
}

type ReviewRunner = (task: ReviewTask, onProgress?: (pct: number) => void) => Promise<ReviewFinding[]>;

type PoolEvent = 'progress' | 'complete' | 'error';
type PoolListener = (...args: unknown[]) => void;

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_POLL_INTERVAL_MS = 500;

function defaultRunner(task: ReviewTask, onProgress?: (pct: number) => void): Promise<ReviewFinding[]> {
  return new Promise((resolve) => {
    const severities: ReviewFinding['severity'][] = ['critical', 'high', 'medium', 'low', 'info'];
    const findings: ReviewFinding[] = severities.map((sev, idx) => ({
      id: `mock-${task.sessionId}-${idx}`,
      file: `src/mock/file${idx}.ts`,
      line: idx * 10 + 1,
      severity: sev,
      category: ['security', 'quality', 'performance', 'style', 'info'][idx] ?? 'general',
      message: `Mock ${sev} finding for MR !${task.mrIid}`,
      suggestion: `Consider fixing this ${sev} issue.`,
      confidence: 0.8 - idx * 0.1,
      source: 'ai',
      ruleId: `mock-rule-${idx}`,
    }));

    const milestones = [10, 50, 90, 100];
    let step = 0;

    const tick = () => {
      if (step < milestones.length) {
        onProgress?.(milestones[step]);
        step++;
        setTimeout(tick, 50);
      } else {
        resolve(findings);
      }
    };
    tick();
  });
}

export class ReviewWorkerPool {
  private store: ReviewSessionStore;
  private config: WorkerConfig;
  private runner: ReviewRunner;
  private running = false;
  private activeCount = 0;
  private listeners: Map<PoolEvent, Set<PoolListener>> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    store: ReviewSessionStore,
    config?: Partial<WorkerConfig>,
    runner?: ReviewRunner,
  ) {
    this.store = store;
    this.config = {
      concurrency: config?.concurrency ?? DEFAULT_CONCURRENCY,
      pollIntervalMs: config?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      modelRouter: config?.modelRouter,
    };
    this.runner = runner ?? defaultRunner;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.poll(), this.config.pollIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  setRunner(fn: ReviewRunner): void {
    this.runner = fn;
  }

  async submit(task: ReviewTask): Promise<string> {
    const session = this.store.createSession({
      mrIid: task.mrIid,
      repoId: task.repoId,
      status: 'queued',
      progress: 0,
      findings: [],
    });
    return session.id;
  }

  getPoolStatus(): { active: number; queued: number } {
    const queued = this.store.listSessions({ status: 'queued' }).length;
    return { active: this.activeCount, queued };
  }

  on(event: PoolEvent, cb: PoolListener): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb);
  }

  private emit(event: PoolEvent, ...args: unknown[]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(...args);
      } catch {
        // swallow listener errors
      }
    }
  }

  private poll(): void {
    if (!this.running) return;
    const available = this.config.concurrency - this.activeCount;
    if (available <= 0) return;

    const queued = this.store.listSessions({ status: 'queued' });
    const toPick = queued
      .sort((a, b) => {
        const pa = this.getPriorityWeight(a);
        const pb = this.getPriorityWeight(b);
        return pb - pa;
      })
      .slice(0, available);

    for (const session of toPick) {
      this.executeSession(session.id).catch(() => undefined);
    }
  }

  private getPriorityWeight(_session: { id: string }): number {
    return 1;
  }

  private async executeSession(sessionId: string): Promise<void> {
    this.activeCount++;
    try {
      const session = this.store.getSession(sessionId);
      if (!session || session.status !== 'queued') return;

      this.store.updateSession(sessionId, { status: 'running' });

      const task: ReviewTask = {
        sessionId,
        mrIid: session.mrIid,
        repoId: session.repoId,
      };

      const findings = await this.runner(task, (pct) => {
        this.store.updateSession(sessionId, { progress: pct });
        this.emit('progress', sessionId, pct);
      });

      this.store.updateSession(sessionId, {
        status: 'completed' as ReviewSessionStatus,
        progress: 100,
        findings,
        finishedAt: new Date().toISOString(),
      });
      this.emit('complete', sessionId, findings);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.store.updateSession(sessionId, {
        status: 'failed',
        error: message,
        finishedAt: new Date().toISOString(),
      });
      this.emit('error', sessionId, message);
    } finally {
      this.activeCount--;
    }
  }
}