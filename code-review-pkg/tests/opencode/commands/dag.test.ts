import { describe, it, expect, vi } from 'vitest';
import { buildReviewDag, executeDag, type DagContext, type DagNode } from '../../../src/orchestrator.js';
import type { Finding, FileDiff, LLMProviderConfig } from '../../../src/types.js';

function makeFileDiff(path: string): FileDiff {
  return {
    path,
    status: 'modified',
    hunks: [],
  };
}

function makeFinding(partial: Partial<Finding> = {}): Finding {
  return {
    file: 'src/index.ts',
    line: 10,
    severity: 'high',
    category: 'security',
    message: 'SQL injection',
    confidence: 0.9,
    source: 'rule',
    ...partial,
  };
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('DAG 编排测试', () => {
  describe('四个 Agent 按 DAG 顺序执行', () => {
    it('rule-engine + code-reviewer + security-reviewer 并行执行（第一层）', async () => {
      const matchRulesFn = vi.fn(() => []);
      const callLLMFn = vi.fn(async () => '[]');
      const getImpactRadiusFn = vi.fn(async () => []);

      const diffs = Array.from({ length: 6 }, (_, i) => makeFileDiff(`file${i}.ts`));
      const llmConfig: LLMProviderConfig = { provider: 'openai', apiKey: 'test', model: 'gpt-4' };

      const dag = buildReviewDag(diffs, {
        rules: [],
        llmConfig,
        reviewPrompt: 'Review',
        securityPrompt: 'Security review',
        matchRulesFn,
        callLLMFn,
        getImpactRadiusFn,
        includeAIReviewer: true,
        includeSecurityReviewer: true,
        includeImpactAnalyzer: true,
        includeReflector: true,
      });

      const context: DagContext = { diffs, previousResults: new Map() };
      const result = await executeDag(dag, context);

      expect(result.errors.size).toBe(0);
      expect(result.results.has('rule-engine')).toBe(true);
      expect(result.results.has('ai-reviewer')).toBe(true);
      expect(result.results.has('security-reviewer')).toBe(true);
      expect(result.results.has('impact-analyzer')).toBe(true);
      expect(result.results.has('reflector')).toBe(true);
    });

    it('验证 DAG 节点依赖关系', () => {
      const diffs = Array.from({ length: 6 }, (_, i) => makeFileDiff(`file${i}.ts`));
      const llmConfig: LLMProviderConfig = { provider: 'openai', apiKey: 'test', model: 'gpt-4' };

      const dag = buildReviewDag(diffs, {
        rules: [],
        llmConfig,
        reviewPrompt: 'Review',
        securityPrompt: 'Security review',
        includeAIReviewer: true,
        includeSecurityReviewer: true,
        includeImpactAnalyzer: true,
        includeReflector: true,
      });

      const nodeMap = new Map(dag.map((n) => [n.id, n]));

      expect(nodeMap.get('rule-engine')?.dependencies).toEqual([]);
      expect(nodeMap.get('ai-reviewer')?.dependencies).toEqual([]);
      expect(nodeMap.get('security-reviewer')?.dependencies).toEqual([]);

      const impactDeps = nodeMap.get('impact-analyzer')?.dependencies.sort();
      expect(impactDeps).toEqual(['ai-reviewer', 'rule-engine', 'security-reviewer']);

      expect(nodeMap.get('reflector')?.dependencies).toEqual(['impact-analyzer']);
    });

    it('第一层节点并行执行，第二三层串行执行', async () => {
      const order: string[] = [];
      let concurrent = 0;
      let maxConcurrent = 0;

      const track = (id: string) => {
        order.push(id);
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
      };
      const untrack = () => concurrent--;

      const diffs = Array.from({ length: 6 }, (_, i) => makeFileDiff(`file${i}.ts`));

      const dag = buildReviewDag(diffs, {
        rules: [],
        llmConfig: { provider: 'openai', apiKey: 'test', model: 'gpt-4' },
        reviewPrompt: 'Review',
        securityPrompt: 'Security review',
        includeAIReviewer: true,
        includeSecurityReviewer: true,
        includeImpactAnalyzer: true,
        includeReflector: true,
      });

      const modifiedDag: DagNode<Finding[]>[] = dag.map((node) => ({
        ...node,
        handler: async (ctx) => {
          track(node.id);
          await delay(10);
          untrack();
          return [];
        },
      }));

      const context: DagContext = { diffs, previousResults: new Map() };
      await executeDag(modifiedDag, context);

      expect(maxConcurrent).toBe(3);

      const firstLayer = ['rule-engine', 'ai-reviewer', 'security-reviewer'];
      const firstThree = order.slice(0, 3).sort();
      expect(firstThree).toEqual(firstLayer.sort());

      expect(order.indexOf('impact-analyzer')).toBeGreaterThan(order.indexOf('rule-engine'));
      expect(order.indexOf('impact-analyzer')).toBeGreaterThan(order.indexOf('ai-reviewer'));
      expect(order.indexOf('impact-analyzer')).toBeGreaterThan(order.indexOf('security-reviewer'));

      expect(order.indexOf('reflector')).toBeGreaterThan(order.indexOf('impact-analyzer'));
    });

    it('大变更包含所有五个节点', () => {
      const diffs = Array.from({ length: 6 }, (_, i) => makeFileDiff(`file${i}.ts`));
      const llmConfig: LLMProviderConfig = { provider: 'openai', apiKey: 'test', model: 'gpt-4' };

      const dag = buildReviewDag(diffs, {
        rules: [],
        llmConfig,
        reviewPrompt: 'Review',
        securityPrompt: 'Security review',
        includeAIReviewer: true,
        includeSecurityReviewer: true,
        includeImpactAnalyzer: true,
        includeReflector: true,
      });

      const ids = dag.map((n) => n.id);
      expect(ids).toContain('rule-engine');
      expect(ids).toContain('ai-reviewer');
      expect(ids).toContain('security-reviewer');
      expect(ids).toContain('impact-analyzer');
      expect(ids).toContain('reflector');
    });

    it('小变更跳过 impact-analyzer 和 reflector', () => {
      const diffs = [makeFileDiff('a.ts'), makeFileDiff('b.ts')];
      const llmConfig: LLMProviderConfig = { provider: 'openai', apiKey: 'test', model: 'gpt-4' };

      const dag = buildReviewDag(diffs, {
        rules: [],
        llmConfig,
        reviewPrompt: 'Review',
        securityPrompt: 'Security review',
        includeAIReviewer: true,
        includeSecurityReviewer: true,
        includeReflector: true,
      });

      const ids = dag.map((n) => n.id);
      expect(ids).toContain('rule-engine');
      expect(ids).toContain('ai-reviewer');
      expect(ids).toContain('security-reviewer');
      expect(ids).not.toContain('impact-analyzer');
      expect(ids).not.toContain('reflector');
    });

    it('安全审查节点正确解析 LLM 响应', async () => {
      const securityResponse = JSON.stringify([
        { file: 'src/sec.ts', line: 5, severity: 'critical', category: 'security', message: 'XSS vulnerability' },
      ]);
      const callLLMFn = vi.fn().mockResolvedValue(securityResponse);
      const llmConfig: LLMProviderConfig = { provider: 'openai', apiKey: 'test', model: 'gpt-4' };

      const diffs = Array.from({ length: 6 }, (_, i) => makeFileDiff(`file${i}.ts`));
      const dag = buildReviewDag(diffs, {
        rules: [],
        llmConfig,
        reviewPrompt: 'Review',
        securityPrompt: 'Security review',
        callLLMFn,
        includeAIReviewer: false,
        includeSecurityReviewer: true,
        includeImpactAnalyzer: false,
        includeReflector: false,
      });

      const securityNode = dag.find((n) => n.id === 'security-reviewer');
      expect(securityNode).toBeDefined();

      const findings = await securityNode!.handler({ diffs, previousResults: new Map() });
      expect(findings.length).toBe(1);
      expect(findings[0].file).toBe('src/sec.ts');
      expect(findings[0].severity).toBe('critical');
      expect(findings[0].category).toBe('security');
      expect(findings[0].source).toBe('ai');
    });

    it('reflector 节点汇总前序节点的 findings', async () => {
      const matchRulesFn = vi.fn(() => []);
      const callLLMFn = vi.fn(async (prompt: string) => {
        if (prompt.includes('quality evaluator')) {
          return JSON.stringify([{ id: 0, confidence: 0.8 }]);
        }
        return JSON.stringify([{ file: 'src/a.ts', line: 1, severity: 'high', category: 'test', message: 'test finding' }]);
      });
      const getImpactRadiusFn = vi.fn(async () => []);

      const diffs = Array.from({ length: 6 }, (_, i) => makeFileDiff(`file${i}.ts`));
      const llmConfig: LLMProviderConfig = { provider: 'openai', apiKey: 'test', model: 'gpt-4' };

      const dag = buildReviewDag(diffs, {
        rules: [],
        llmConfig,
        reviewPrompt: 'Review',
        securityPrompt: 'Security review',
        matchRulesFn,
        callLLMFn,
        getImpactRadiusFn,
        includeAIReviewer: true,
        includeSecurityReviewer: true,
        includeImpactAnalyzer: true,
        includeReflector: true,
      });

      const context: DagContext = { diffs, previousResults: new Map() };
      const result = await executeDag(dag, context);

      expect(result.errors.size).toBe(0);
      expect(result.results.has('reflector')).toBe(true);

      const reflectorFindings = result.results.get('reflector') as Finding[];
      expect(reflectorFindings.length).toBeGreaterThan(0);
    });

    it('安全审查节点未配置 securityPrompt 时返回空数组', async () => {
      const callLLMFn = vi.fn();
      const llmConfig: LLMProviderConfig = { provider: 'openai', apiKey: 'test', model: 'gpt-4' };

      const diffs = Array.from({ length: 6 }, (_, i) => makeFileDiff(`file${i}.ts`));
      const dag = buildReviewDag(diffs, {
        rules: [],
        llmConfig,
        reviewPrompt: 'Review',
        callLLMFn,
        includeAIReviewer: false,
        includeSecurityReviewer: true,
        includeImpactAnalyzer: false,
        includeReflector: false,
      });

      const securityNode = dag.find((n) => n.id === 'security-reviewer');
      const findings = await securityNode!.handler({ diffs, previousResults: new Map() });

      expect(findings).toEqual([]);
      expect(callLLMFn).not.toHaveBeenCalled();
    });

    it('reflector 节点未配置 llmConfig 时返回空数组', async () => {
      const getImpactRadiusFn = vi.fn(async () => []);

      const diffs = Array.from({ length: 6 }, (_, i) => makeFileDiff(`file${i}.ts`));
      const dag = buildReviewDag(diffs, {
        rules: [],
        reviewPrompt: 'Review',
        securityPrompt: 'Security review',
        getImpactRadiusFn,
        includeAIReviewer: false,
        includeSecurityReviewer: false,
        includeImpactAnalyzer: true,
        includeReflector: true,
      });

      const reflectorNode = dag.find((n) => n.id === 'reflector');
      const findings = await reflectorNode!.handler({ diffs, previousResults: new Map() });

      expect(findings).toEqual([]);
    });

    it('安全审查节点失败时降级返回空数组', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const callLLMFn = vi.fn().mockRejectedValue(new Error('LLM down'));
      const llmConfig: LLMProviderConfig = { provider: 'openai', apiKey: 'test', model: 'gpt-4' };

      const diffs = Array.from({ length: 6 }, (_, i) => makeFileDiff(`file${i}.ts`));
      const dag = buildReviewDag(diffs, {
        rules: [],
        llmConfig,
        reviewPrompt: 'Review',
        securityPrompt: 'Security review',
        callLLMFn,
        includeAIReviewer: false,
        includeSecurityReviewer: true,
        includeImpactAnalyzer: false,
        includeReflector: false,
      });

      const securityNode = dag.find((n) => n.id === 'security-reviewer');
      const findings = await securityNode!.handler({ diffs, previousResults: new Map() });

      expect(findings).toEqual([]);
      warnSpy.mockRestore();
    });

    it('reflector 节点失败时降级返回原始 findings', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const callLLMFn = vi.fn().mockRejectedValue(new Error('LLM down'));
      const getImpactRadiusFn = vi.fn(async () => []);
      const llmConfig: LLMProviderConfig = { provider: 'openai', apiKey: 'test', model: 'gpt-4' };

      const diffs = Array.from({ length: 6 }, (_, i) => makeFileDiff(`file${i}.ts`));
      const dag = buildReviewDag(diffs, {
        rules: [],
        llmConfig,
        reviewPrompt: 'Review',
        securityPrompt: 'Security review',
        callLLMFn,
        getImpactRadiusFn,
        includeAIReviewer: true,
        includeSecurityReviewer: true,
        includeImpactAnalyzer: true,
        includeReflector: true,
      });

      const context: DagContext = { diffs, previousResults: new Map() };
      context.previousResults.set('rule-engine', [makeFinding({ file: 'a.ts' })]);
      context.previousResults.set('ai-reviewer', []);
      context.previousResults.set('security-reviewer', []);
      context.previousResults.set('impact-analyzer', []);

      const reflectorNode = dag.find((n) => n.id === 'reflector');
      const findings = await reflectorNode!.handler(context);

      expect(findings.length).toBe(1);
      expect(findings[0].file).toBe('a.ts');
      warnSpy.mockRestore();
    });
  });
});
