// src/review-self-inspector.ts — 审查自检器
//
// 职责：
// 1. InspectionResult 接口：描述审查会话的自检结果
// 2. ReviewSelfInspector 类：基于规则引擎对审查会话进行质量自检
//
// 规则：
// - criticalCount >= 1 OR highCount >= 1 → ok=true, recalled=true
// - 否则 ok=false, issues 包含 '召回不足'
// - session.status === 'failed' → ok=false
// - baselineFindings 用于检查关键基线严重级别是否被召回

import type { ReviewFinding, ReviewSession } from './review-session.js';
import type { ReviewWorkerPool } from './review-worker-pool.js';

export interface InspectionResult {
  ok: boolean;
  sessionId: string;
  issues: string[];
  retry: number;
  findingsCritical: number;
  findingsHigh: number;
  findingsMedium: number;
  recalled: boolean;
}

export class ReviewSelfInspector {
  private workerPool: ReviewWorkerPool | null;

  constructor(workerPool?: ReviewWorkerPool) {
    this.workerPool = workerPool ?? null;
  }

  inspect(session: ReviewSession, baselineFindings: ReviewFinding[] = []): InspectionResult {
    const issues: string[] = [];
    const criticalCount = session.findings.filter((f) => f.severity === 'critical').length;
    const highCount = session.findings.filter((f) => f.severity === 'high').length;
    const mediumCount = session.findings.filter((f) => f.severity === 'medium').length;

    let ok = true;
    let recalled = false;

    if (session.status === 'failed') {
      ok = false;
      issues.push('会话状态为 failed');
    }

    if (criticalCount >= 1 || highCount >= 1) {
      recalled = true;
    } else {
      ok = false;
      issues.push('召回不足');
    }

    if (baselineFindings.length > 0) {
      const baselineCritical = baselineFindings.filter((f) => f.severity === 'critical').length;
      const baselineHigh = baselineFindings.filter((f) => f.severity === 'high').length;
      if (baselineCritical > criticalCount) {
        issues.push(`关键级别召回不足: 期望 ${baselineCritical}, 实际 ${criticalCount}`);
        ok = false;
      }
      if (baselineHigh > highCount) {
        issues.push(`高级别召回不足: 期望 ${baselineHigh}, 实际 ${highCount}`);
        ok = false;
      }
    }

    return {
      ok,
      sessionId: session.id,
      issues,
      retry: 0,
      findingsCritical: criticalCount,
      findingsHigh: highCount,
      findingsMedium: mediumCount,
      recalled,
    };
  }

  async repair(
    session: ReviewSession,
    reason: string,
  ): Promise<{ newSessionId: string; attempts: number }> {
    if (!this.workerPool) {
      throw new Error('workerPool 未设置，无法 repair');
    }

    const maxAttempts = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const task = {
          sessionId: '',
          mrIid: session.mrIid,
          repoId: session.repoId,
          priority: 'high' as const,
        };
        const newSessionId = await this.workerPool.submit(task);
        return { newSessionId, attempts: attempt };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw new Error(`repair 失败 (共尝试 ${maxAttempts} 次): ${lastError?.message ?? reason}`);
  }
}