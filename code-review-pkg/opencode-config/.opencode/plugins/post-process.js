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

/**
 * 解析 .reviewignore 忽略配置（Task 2 集成）。
 *
 * 解析顺序：
 * 1. context.ignoreConfig — 直接使用调用方传入的配置对象
 * 2. context.ignoreConfigPath — 从指定路径加载 .reviewignore
 * 3. process.cwd()/.reviewignore — 自动加载工作目录下的 .reviewignore
 *    （可通过 context.skipReviewIgnore === true 跳过）
 *
 * 任何加载/解析失败都视为无配置，返回 null（不影响后续处理流程）。
 *
 * @param {object} context 钩子上下文
 * @returns {Promise<object|null>} IgnoreConfig 或 null
 */
async function resolveIgnoreConfig(context) {
  if (!context || context.skipReviewIgnore === true) {
    return null;
  }

  // 1. 调用方直接传入配置对象
  if (context.ignoreConfig) {
    return context.ignoreConfig;
  }

  // 2. 指定配置文件路径
  let ignorePath = context.ignoreConfigPath || null;

  // 3. 默认从 cwd/.reviewignore 自动加载
  if (!ignorePath) {
    try {
      const path = await import('node:path');
      const fs = await import('node:fs');
      const defaultPath = path.join(process.cwd(), '.reviewignore');
      if (!fs.existsSync(defaultPath)) {
        return null;
      }
      ignorePath = defaultPath;
    } catch (err) {
      return null;
    }
  }

  if (!ignorePath) return null;

  // 优先使用调用方注入的加载函数（便于测试与自定义实现）
  let loadFn = context.loadIgnoreConfigFn;
  if (typeof loadFn !== 'function') {
    try {
      const codeReview = await import('code-review');
      loadFn = codeReview.loadReviewIgnoreConfig || codeReview.loadIgnoreConfig;
    } catch (err) {
      console.warn(
        '[post-process] failed to load .reviewignore:',
        err && err.message ? err.message : String(err),
      );
      return null;
    }
  }

  if (typeof loadFn !== 'function') return null;
  try {
    return loadFn(ignorePath);
  } catch (err) {
    console.warn(
      '[post-process] failed to parse .reviewignore:',
      err && err.message ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Task 16：发送 Webhook 通知（review.completed / finding.critical）。
 *
 * 触发条件（满足任一即发送）：
 * 1. context.webhookNotifier 已注入（测试或自定义实现）
 * 2. context.webhookEndpoints 提供端点配置
 * 3. context.webhookUrl 提供单个 URL
 * 4. process.env.CODE_REVIEW_WEBHOOK_URL 环境变量已设置
 *
 * 通知器解析顺序：
 * - context.webhookNotifier（直接调用其 notifyReviewResult 方法）
 * - context.webhookNotifierCtor（用于自定义构造器，结合 webhookEndpoints）
 * - 否则尝试从 code-review 包导入 WebhookNotifier，结合上述端点配置
 *
 * 通知上下文：
 * - context.webhookContext：包含 filesTotal / durationMs / sessionId
 * - 缺省时从 context.diffs 推断 filesTotal
 *
 * 通知失败不抛出（由调用方 catch 处理）。
 *
 * @param {Array} findings 已处理的 findings
 * @param {object} context 钩子上下文
 * @returns {Promise<void>}
 */
async function sendReviewWebhook(findings, context) {
  if (!context) return;

  // 跳过开关：context.skipWebhook === true 时不发送
  if (context.skipWebhook === true) return;

  const webhookContext = context.webhookContext || {};
  const notifyContext = {
    filesTotal: webhookContext.filesTotal ?? (context.diffs ? context.diffs.length : (findings ? findings.length : 0)),
    durationMs: webhookContext.durationMs,
    sessionId: webhookContext.sessionId,
  };

  // 1. 调用方注入完整 notifier（测试场景常用）
  if (context.webhookNotifier && typeof context.webhookNotifier.notifyReviewResult === 'function') {
    await context.webhookNotifier.notifyReviewResult(findings, notifyContext);
    return;
  }

  // 2. 解析端点配置：context.webhookEndpoints / context.webhookUrl / 环境变量
  let endpoints = context.webhookEndpoints;
  if (!endpoints) {
    const url = context.webhookUrl || process.env.CODE_REVIEW_WEBHOOK_URL;
    if (url) {
      endpoints = [{ url }];
    }
  }

  if (!endpoints || endpoints.length === 0) {
    return;
  }

  // 3. 构造 WebhookNotifier
  let notifier;
  if (typeof context.webhookNotifierCtor === 'function') {
    // 调用方注入构造器（用于测试 mock）
    notifier = context.webhookNotifierCtor({ endpoints });
  } else {
    // 从 code-review 包导入
    let WebhookNotifierCtor;
    try {
      const codeReview = await import('code-review');
      WebhookNotifierCtor = codeReview.WebhookNotifier;
    } catch (err) {
      console.warn(
        '[post-process] WebhookNotifier not available, skip webhook notification:',
        err && err.message ? err.message : String(err),
      );
      return;
    }
    if (typeof WebhookNotifierCtor !== 'function') return;
    notifier = new WebhookNotifierCtor({ endpoints });
  }

  if (!notifier || typeof notifier.notifyReviewResult !== 'function') return;

  await notifier.notifyReviewResult(findings, notifyContext);
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
        // 仍然发送 review.completed Webhook 通知（空 findings 也是合法完成状态）
        await sendReviewWebhook(findings, context).catch((err) => {
          console.warn(
            '[post-process] webhook notification failed:',
            err && err.message ? err.message : String(err),
          );
        });
        return findings;
      }

      let correctLineLocations = context.correctLineLocations;
      let filterFalsePositives = context.filterFalsePositives;
      let deduplicateFindings = context.deduplicateFindings;
      let reflectFindings = context.reflectFindings;
      let autoHealFindings = context.autoHealFindings;

      if (!correctLineLocations || !filterFalsePositives || !deduplicateFindings || !reflectFindings) {
        try {
          const codeReview = await import('code-review');
          correctLineLocations = correctLineLocations || codeReview.correctLineLocations;
          filterFalsePositives = filterFalsePositives || codeReview.filterFalsePositives;
          deduplicateFindings = deduplicateFindings || codeReview.deduplicateFindings;
          reflectFindings = reflectFindings || codeReview.reflectFindings;
          autoHealFindings = autoHealFindings || codeReview.autoHealFindings;
        } catch (err) {
          console.warn(
            '[post-process] code-review package not available, returning findings unchanged:',
            err && err.message ? err.message : String(err),
          );
          return findings;
        }
      }

      // 自愈器单独尝试加载：即使 code-review 包不可用或未导出 autoHealFindings，
      // 也不影响其他后处理步骤（自愈是增强步骤，可安全跳过）
      if (!autoHealFindings) {
        try {
          const codeReview = await import('code-review');
          autoHealFindings = codeReview.autoHealFindings;
        } catch (err) {
          // 静默跳过：自愈器不可用时不影响主流程
        }
      }

      let processed = findings;

      // 应用 .reviewignore 忽略规则（Task 2）
      // 优先使用 context.ignoreConfig；其次从 context.ignoreConfigPath 加载；
      // 最后从 process.cwd()/.reviewignore 自动加载（除非 context.skipReviewIgnore === true）
      const ignoreConfig = await resolveIgnoreConfig(context);
      if (ignoreConfig) {
        let applyIgnoreRulesFn = context.applyIgnoreRules;
        if (!applyIgnoreRulesFn) {
          try {
            const codeReview = await import('code-review');
            applyIgnoreRulesFn = codeReview.applyIgnoreRules;
          } catch (err) {
            console.warn(
              '[post-process] applyIgnoreRules not available, skip ignore filtering:',
              err && err.message ? err.message : String(err),
            );
          }
        }
        if (applyIgnoreRulesFn) {
          const before = processed.length;
          processed = applyIgnoreRulesFn(processed, ignoreConfig);
          if (before !== processed.length) {
            console.log(`[post-process] ignored ${before - processed.length} finding(s) per .reviewignore`);
          }
          if (processed.length === 0) {
            return processed;
          }
        }
      }

      if (correctLineLocations && context.diffs) {
        processed = correctLineLocations(processed, context.diffs);
      }

      if (filterFalsePositives) {
        processed = filterFalsePositives(processed);
      }

      if (deduplicateFindings) {
        processed = deduplicateFindings(processed, context.existingComments || []);
      }

      // 自愈能力（Task 9）：对低风险 finding 自动应用修复建议
      // - 仅修改 suggestion 字段，不改变 severity / confidence
      // - 可通过 context.skipAutoHeal = true 跳过此步骤
      // - 可通过 context.autoHealFindings 注入自定义实现（便于测试）
      if (autoHealFindings && context.skipAutoHeal !== true && processed.length > 0) {
        try {
          const healResult = autoHealFindings(processed);
          if (healResult && Array.isArray(healResult.findings)) {
            if (healResult.healedCount && healResult.healedCount > 0) {
              console.log(`[post-process] auto-healed ${healResult.healedCount} finding(s)`);
            }
            processed = healResult.findings;
          }
        } catch (err) {
          console.warn(
            '[post-process] autoHealFindings failed, skipping self-healing:',
            err && err.message ? err.message : String(err),
          );
        }
      }

      if (reflectFindings && context.llmConfig) {
        processed = await reflectFindings(processed, context.llmConfig, context.minConfidence);
      }

      // Task 16：Webhook 通知 — 在 afterReview 完成后发送 review.completed / finding.critical 事件
      // 通知失败不影响主流程，仅记录日志
      await sendReviewWebhook(processed, context).catch((err) => {
        console.warn(
          '[post-process] webhook notification failed:',
          err && err.message ? err.message : String(err),
        );
      });

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