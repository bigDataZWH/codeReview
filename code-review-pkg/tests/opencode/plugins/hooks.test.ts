import { describe, it, expect, vi } from 'vitest';
import type { Finding, PublishResult } from '../../../src/types.js';
import { FeedbackStore } from '../../../src/feedback.js';

const PLUGIN_PATH = '../../../opencode-config/.opencode/plugins/post-process.js';

async function loadPlugin() {
  const mod = await import(PLUGIN_PATH);
  return mod.default;
}

function makeFinding(overrides: Partial<Finding> & { file: string; line: number }): Finding {
  return {
    severity: 'low',
    category: 'quality',
    message: 'test finding',
    confidence: 0.8,
    source: 'rule',
    ...overrides,
  };
}

describe('post-process.js hooks', () => {
  describe('afterPublish hook', () => {
    it('afterPublish 在发布后被调用', async () => {
      const plugin = await loadPlugin();

      const afterPublishSpy = vi.fn((result: PublishResult, findings: Finding[]) => {
        return result;
      });

      const publishResult: PublishResult = {
        inlineCount: 5,
        summaryUpdated: true,
        skipped: 2,
      };

      const findings: Finding[] = [
        makeFinding({ file: 'a.ts', line: 1, id: 'f1' }),
        makeFinding({ file: 'b.ts', line: 2, id: 'f2' }),
      ];

      await plugin.hooks.afterPublish(publishResult, findings, {
        afterPublish: afterPublishSpy,
      });

      expect(afterPublishSpy).toHaveBeenCalledWith(publishResult, findings, expect.any(Object));
    });

    it('afterPublish 能记录发布结果到反馈存储', async () => {
      const plugin = await loadPlugin();

      const store = new FeedbackStore();

      const publishResult: PublishResult = {
        inlineCount: 3,
        summaryUpdated: true,
        skipped: 1,
      };

      const findings: Finding[] = [
        makeFinding({ file: 'a.ts', line: 1, id: 'f1', severity: 'high', category: 'security' }),
        makeFinding({ file: 'b.ts', line: 2, id: 'f2', severity: 'medium', category: 'bug' }),
      ];

      await plugin.hooks.afterPublish(publishResult, findings, {
        feedbackStore: store,
      });

      expect(store.size()).toBe(findings.length);
      const allFeedback = store.getAllFeedback();
      const findingIds = allFeedback.map((r) => r.findingId);
      expect(findingIds).toContain('f1');
      expect(findingIds).toContain('f2');
    });

    it('afterPublish 发布失败时仍记录反馈', async () => {
      const plugin = await loadPlugin();

      const store = new FeedbackStore();

      const publishResult: PublishResult = {
        inlineCount: 0,
        summaryUpdated: false,
        skipped: 5,
      };

      const findings: Finding[] = [
        makeFinding({ file: 'a.ts', line: 1, id: 'f1' }),
      ];

      await plugin.hooks.afterPublish(publishResult, findings, {
        feedbackStore: store,
      });

      expect(store.size()).toBe(findings.length);
    });

    it('afterPublish 支持自定义回调处理发布结果', async () => {
      const plugin = await loadPlugin();

      const customHandler = vi.fn();

      const publishResult: PublishResult = {
        inlineCount: 2,
        summaryUpdated: true,
        skipped: 0,
      };

      const findings: Finding[] = [
        makeFinding({ file: 'a.ts', line: 1, id: 'f1' }),
      ];

      await plugin.hooks.afterPublish(publishResult, findings, {
        afterPublish: customHandler,
      });

      expect(customHandler).toHaveBeenCalled();
      expect(customHandler).toHaveBeenCalledWith(publishResult, findings, expect.any(Object));
    });

    it('afterPublish 空 findings 时也被调用', async () => {
      const plugin = await loadPlugin();

      const afterPublishSpy = vi.fn((result: PublishResult, findings: Finding[]) => {
        return result;
      });

      const publishResult: PublishResult = {
        inlineCount: 0,
        summaryUpdated: false,
        skipped: 0,
      };

      const findings: Finding[] = [];

      await plugin.hooks.afterPublish(publishResult, findings, {
        afterPublish: afterPublishSpy,
      });

      expect(afterPublishSpy).toHaveBeenCalledWith(publishResult, findings, expect.any(Object));
    });

    it('afterPublish 返回原始发布结果', async () => {
      const plugin = await loadPlugin();

      const publishResult: PublishResult = {
        inlineCount: 4,
        summaryUpdated: true,
        skipped: 1,
      };

      const findings: Finding[] = [
        makeFinding({ file: 'a.ts', line: 1, id: 'f1' }),
      ];

      const result = await plugin.hooks.afterPublish(publishResult, findings, {});

      expect(result).toBe(publishResult);
    });
  });
});
