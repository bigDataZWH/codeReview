/**
 * OpenCode 后处理插件。
 * 在 AI 审查完成后自动执行定位修正和误报过滤。
 */
export default {
  name: 'code-review-post-process',

  hooks: {
    afterReview: async (findings, context) => {
      // 导入后处理函数（在真实 OpenCode 环境中会从 code-review 包导入）
      // 1. 定位修正
      // 2. 误报过滤
      // 3. AI 反思过滤（如果配置了 LLM）
      return findings;
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