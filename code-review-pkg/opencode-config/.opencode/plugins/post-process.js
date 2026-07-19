/**
 * OpenCode 后处理插件。
 * 在 AI 审查完成后自动执行定位修正和误报过滤。
 *
 * 钩子签名：afterReview(findings, context)
 * - findings: Finding[] — AI 审查产出的 findings
 * - context: { correctLineLocations?, filterFalsePositives?, deduplicateFindings?, diffs?, llmConfig? }
 *   - 注入式依赖：测试时可传入 mock；生产环境从 code-review 包导入
 */
export default {
  name: 'code-review-post-process',

  hooks: {
    afterReview: async (findings, context = {}) => {
      // 优先使用 context 注入的函数（用于测试）
      // 生产环境通过 dynamic import 获取
      let correctLineLocations = context.correctLineLocations;
      let filterFalsePositives = context.filterFalsePositives;
      let deduplicateFindings = context.deduplicateFindings;

      // 如果未注入，尝试从 code-review 包导入（生产环境）
      if (!correctLineLocations || !filterFalsePositives || !deduplicateFindings) {
        try {
          const codeReview = await import('code-review');
          correctLineLocations = correctLineLocations || codeReview.correctLineLocations;
          filterFalsePositives = filterFalsePositives || codeReview.filterFalsePositives;
          deduplicateFindings = deduplicateFindings || codeReview.deduplicateFindings;
        } catch (err) {
          // 包未安装时，原样返回 findings
          console.warn(
            '[post-process] code-review package not available, returning findings unchanged:',
            err && err.message ? err.message : String(err),
          );
          return findings;
        }
      }

      // 1. 定位修正（需要 diffs 参数，如果 context 提供则使用，否则跳过）
      let processed = findings;
      if (correctLineLocations && context.diffs) {
        processed = correctLineLocations(processed, context.diffs);
      }

      // 2. 误报过滤
      if (filterFalsePositives) {
        processed = filterFalsePositives(processed);
      }

      // 3. 去重（需要 existingComments 参数，未提供时传空数组）
      if (deduplicateFindings) {
        processed = deduplicateFindings(processed, context.existingComments || []);
      }

      return processed;
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

        const { stdout } = await execAsync('git diff HEAD', { maxBuffer: 10 * 1024 * 1024 });
        // 在真实环境中，这里会调用 code-review 的管道
        return { diff: stdout.substring(0, 1000) + '...' };
      }
    }
  ]
};
