/**
 * OpenCode 后处理插件。
 * 在 AI 审查完成后自动执行定位修正、误报过滤和 AI 反思过滤。
 *
 * 钩子签名：afterReview(findings, context)
 * - findings: Finding[] | string — AI 审查产出的 findings（可能是 JSON 字符串）
 * - context: { correctLineLocations?, filterFalsePositives?, deduplicateFindings?, reflectFindings?, diffs?, llmConfig?, minConfidence?, existingComments? }
 *   - 注入式依赖：测试时可传入 mock；生产环境从 code-review 包导入
 */

/**
 * 解析 AI 返回的 findings 内容。
 * 支持多种格式：
 * 1. 纯 JSON 数组字符串
 * 2. 包含在 markdown 代码块中的 JSON（```json ... ```）
 * 3. 已经是解析好的数组
 * 
 * @param {Finding[] | string} input - AI 返回的 findings
 * @returns {Finding[]} 解析后的 findings 数组
 */
function parseFindings(input) {
  if (Array.isArray(input)) {
    return input;
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();

    const jsonMatch = trimmed.match(/```json\s*(\[[\s\S]*?\])\s*```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }

    const arrayMatch = trimmed.match(/\[(\[[\s\S]*\])\]/);
    if (arrayMatch) {
      return JSON.parse(arrayMatch[1]);
    }

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      return JSON.parse(trimmed);
    }
  }

  console.warn('[post-process] Cannot parse findings, returning empty array');
  return [];
}

export default {
  name: 'code-review-post-process',

  hooks: {
    beforeReview: async (context = {}) => {
      return {
        rules: context.rules,
        filter: context.filter,
        mcpEnabled: context.mcpEnabled,
      };
    },

    afterReview: async (findingsInput, context = {}) => {
      const findings = parseFindings(findingsInput);

      if (findings.length === 0) {
        return findings;
      }

      let correctLineLocations = context.correctLineLocations;
      let filterFalsePositives = context.filterFalsePositives;
      let deduplicateFindings = context.deduplicateFindings;
      let reflectFindings = context.reflectFindings;

      if (!correctLineLocations || !filterFalsePositives || !deduplicateFindings || !reflectFindings) {
        try {
          const codeReview = await import('code-review');
          correctLineLocations = correctLineLocations || codeReview.correctLineLocations;
          filterFalsePositives = filterFalsePositives || codeReview.filterFalsePositives;
          deduplicateFindings = deduplicateFindings || codeReview.deduplicateFindings;
          reflectFindings = reflectFindings || codeReview.reflectFindings;
        } catch (err) {
          console.warn(
            '[post-process] code-review package not available, returning findings unchanged:',
            err && err.message ? err.message : String(err),
          );
          return findings;
        }
      }

      let processed = findings;
      if (correctLineLocations && context.diffs) {
        processed = correctLineLocations(processed, context.diffs);
      }

      if (filterFalsePositives) {
        processed = filterFalsePositives(processed);
      }

      if (deduplicateFindings) {
        processed = deduplicateFindings(processed, context.existingComments || []);
      }

      if (reflectFindings && context.llmConfig) {
        processed = await reflectFindings(processed, context.llmConfig, context.minConfidence);
      }

      return processed;
    },

    afterPublish: async (publishResult, findings, context = {}) => {
      let feedbackStore = context.feedbackStore;

      if (!feedbackStore) {
        try {
          const codeReview = await import('code-review');
          feedbackStore = new codeReview.FeedbackStore();
        } catch (err) {
          console.warn(
            '[post-process] code-review package not available for afterPublish:',
            err && err.message ? err.message : String(err),
          );
        }
      }

      if (feedbackStore && findings.length > 0) {
        for (const finding of findings) {
          const findingId = finding.id || `${finding.file}:${finding.line}`;
          feedbackStore.recordFeedback(findingId, 'accept', 'Published as comment', finding);
        }
      }

      if (context.afterPublish) {
        await context.afterPublish(publishResult, findings, context);
      }

      return publishResult;
    },

    afterBuild: async (result, context = {}) => {
      const cache = context.cache;

      if (!cache) {
        return result;
      }

      try {
        const stats = cache.getCategoryHitStats ? cache.getCategoryHitStats() : null;
        if (!stats) {
          return result;
        }

        const diffRate = Math.round(stats.diff.hitRate * 100);
        const rulesRate = Math.round(stats.rules.hitRate * 100);
        const mcpRate = Math.round(stats.mcp.hitRate * 100);

        console.log(`[cache] hit: diff=${diffRate}% rules=${rulesRate}% mcp=${mcpRate}%`);
      } catch (err) {
        console.warn('[post-process] afterBuild cache stats error:', err && err.message ? err.message : String(err));
      }

      return result;
    }
  },

  tools: [
    {
      name: 'code-review',
      description: 'Run deterministic code review pipeline on current git diff',
      handler: async (args) => {
        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execAsync = promisify(execFile);

        let diffText = args?.diff;
        if (!diffText) {
          const { stdout } = await execAsync('git diff HEAD', { maxBuffer: 10 * 1024 * 1024 });
          diffText = stdout;
        }

        let runPipeline;
        try {
          const codeReview = await import('code-review');
          runPipeline = codeReview.runPipeline;
        } catch (err) {
          console.warn(
            '[post-process] code-review package not available:',
            err && err.message ? err.message : String(err),
          );
          return { error: 'code-review package not available' };
        }

        const config = {
          filter: {},
          mcpEnabled: false,
        };

        const options = {};

        return runPipeline(diffText, config, options);
      }
    }
  ]
};