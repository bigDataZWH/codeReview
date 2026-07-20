import { parseDiff } from './diff-parser.js';
import { runPipeline, runSecurityPipeline, runPipelineBatched, runSecurityPipelineBatched } from './pipeline.js';
import { buildImpactPrompt, buildScanPrompt } from './prompt-builder.js';
import { publishReview } from './comment-publisher.js';
import { generateConfig } from './init-wizard.js';
import { callLLM, buildBatchReflectionPrompt } from './ai-reflection.js';
import { excludeGeneratedFiles, detectLanguage } from './file-filter.js';
import { collectMetrics, generateDashboardData, type MetricsInput } from './metrics.js';
import { FeedbackStore, markFalsePositive } from './feedback.js';
import { LARGE_PR_THRESHOLD } from './constants.js';
import { performPreCheck } from './precheck.js';
import { createStreamingEmitter } from './streaming-output.js';
import {
  loadCustomRules,
  getActiveRules,
  loadRulesConfig,
  saveRulesConfig,
  applyRulesConfig,
  DEFAULT_RULES_DIR,
  RULES_CONFIG_FILE,
  type RuleOverride,
} from './rule-customizer.js';
import type { LLMProviderConfig, FilterConfig, Finding, Severity } from './types.js';
import type { SessionSnapshot } from './metrics.js';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stdin } from 'node:process';
import {
  loadLastReviewState,
  computeIncrementalDiff,
  serializeDiffsToDiffText,
  saveIncrementalState,
  mergeIncrementalFindings,
  DEFAULT_INCREMENTAL_STATE_FILE,
} from './incremental-review.js';
import {
  RbacManager,
  getRequiredPermission,
  isValidRole,
  DEFAULT_RBAC_CONFIG_FILE,
  type RoleName,
} from './rbac.js';
import {
  getAuditLog,
  DEFAULT_AUDIT_LOG_FILE,
  type AuditResult,
} from './audit-logger.js';
import { checkCompliance } from './compliance-checker.js';
import { launchTUI } from './tui.js';
import {
  formatColoredOutput,
  shouldUseColor as shouldUseColorFn,
} from './color-output.js';
import {
  exportResults,
  type ExportFormat,
} from './result-exporter.js';
import {
  startApiServer,
  stopApiServer,
  DEFAULT_API_PORT,
  DEFAULT_API_HOST,
} from './api-server.js';
import {
  startProfiling,
  stopProfiling,
  formatProfileReport,
  type ProfilingOptions,
} from './profiler.js';
import {
  AlertNotifier,
  type AlertSeverity,
  type AlertPayload,
  type SlackConfig,
  type EmailConfig,
  type PagerDutyConfig,
  type AlertNotifierOptions,
} from './alert-notifier.js';

const args = process.argv.slice(2);
const command = args[0];

/**
 * Task 10：RBAC 权限校验
 *
 * 通过环境变量指定身份：
 * - CODE_REVIEW_USER：用户名（从 RBAC 配置文件中查询角色）
 * - CODE_REVIEW_ROLE：直接指定角色（覆盖 RBAC 文件中的查询结果）
 * - CODE_REVIEW_RBAC_CONFIG：RBAC 配置文件路径（默认 .code-review-rbac.json）
 *
 * 启用条件（满足任一即启用 RBAC 校验）：
 * 1. CODE_REVIEW_USER 环境变量已设置
 * 2. CODE_REVIEW_ROLE 环境变量已设置
 * 3. CODE_REVIEW_RBAC_CONFIG 指向的文件存在
 *
 * 未启用时（向后兼容）：所有命令直接放行，不进行权限校验。
 * 启用后默认身份为 viewer（最小权限原则）。
 *
 * 校验失败时输出错误信息并退出 1。
 */
function enforceRbacPermission(cmd: string, subcmd?: string): void {
  const requiredPermission = getRequiredPermission(cmd, subcmd);
  if (!requiredPermission) {
    // 未注册命令不强制权限校验
    return;
  }

  const rbacConfigPath =
    process.env.CODE_REVIEW_RBAC_CONFIG ?? DEFAULT_RBAC_CONFIG_FILE;
  const user = process.env.CODE_REVIEW_USER;
  const roleEnv = process.env.CODE_REVIEW_ROLE;

  // RBAC 启用判定：用户/角色 env 已设置，或 RBAC 配置文件存在
  const rbacEnabled = Boolean(user) || Boolean(roleEnv) || existsSync(rbacConfigPath);
  if (!rbacEnabled) {
    // 向后兼容：未启用 RBAC 时所有命令放行
    return;
  }

  let manager: RbacManager;
  if (roleEnv) {
    // 直接通过环境变量指定角色，跳过文件加载
    manager = new RbacManager();
    if (isValidRole(roleEnv)) {
      manager.assignRole(user ?? '__env_role_user__', roleEnv as RoleName);
    } else {
      console.error(`[rbac] invalid CODE_REVIEW_ROLE: ${roleEnv}`);
      process.exit(1);
    }
  } else {
    manager = RbacManager.loadFromFile(rbacConfigPath);
  }

  // 未指定用户时使用默认 viewer 标识
  const effectiveUser = user ?? '__default_viewer__';

  if (!manager.checkPermission(effectiveUser, requiredPermission)) {
    const role = manager.getUserRoleOrDefault(effectiveUser);
    console.error(
      `[rbac] permission denied: user "${user ?? '(default)'}" (role: ${role}) ` +
        `does not have permission "${requiredPermission}" for command "${cmd}${subcmd ? ' ' + subcmd : ''}"`,
    );
    process.exit(1);
  }
}

// 提取 rules 子命令（若 command === 'rules'）
function extractRulesSubcommand(): string | undefined {
  if (command !== 'rules') return undefined;
  const rest = args.slice(1);
  // 第一个非 flag 参数视为子命令
  for (const tok of rest) {
    if (tok.startsWith('--')) continue;
    return tok;
  }
  return undefined;
}

// 在执行命令分发前校验权限
if (command) {
  enforceRbacPermission(command, extractRulesSubcommand());
}

/**
 * 解析 --execute / --llm-config 标志。
 * 当 --execute 提供时调用 callLLM 并输出 findings JSON，否则仅输出 prompt。
 *
 * 错误处理：
 * - 缺少 --llm-config：输出错误信息并退出 1
 * - --llm-config 不是合法 JSON：输出错误信息并退出 1
 * - LLM 调用失败：输出错误信息并退出 1
 */
async function outputReviewResult(prompt: string): Promise<void> {
  const subArgs = process.argv.slice(3);
  const executeFlag = subArgs.includes('--execute');
  const llmConfigIndex = subArgs.indexOf('--llm-config');
  const llmConfigStr =
    llmConfigIndex >= 0 && llmConfigIndex + 1 < subArgs.length
      ? subArgs[llmConfigIndex + 1]
      : null;

  if (!executeFlag) {
    // 向后兼容：仅输出 prompt
    console.log(prompt);
    return;
  }

  if (!llmConfigStr) {
    console.error('Error: LLM config required when --execute is used (provide --llm-config)');
    process.exit(1);
  }

  let llmConfig: LLMProviderConfig;
  try {
    llmConfig = JSON.parse(llmConfigStr) as LLMProviderConfig;
  } catch (err) {
    console.error('Error: --llm-config must be valid JSON');
    process.exit(1);
  }

  try {
    const llmResponse = await callLLM(prompt, llmConfig);
    // 解析 LLM 响应为 findings 数组
    let findings: unknown;
    try {
      findings = JSON.parse(llmResponse);
    } catch (err) {
      // LLM 返回非 JSON 文本：直接输出原始响应
      console.log(llmResponse);
      return;
    }
    // Task 14：当 stdout 为 TTY 且未指定 --no-color 时，输出彩色报告；
    // 否则输出 JSON（机器可读，向后兼容）
    if (Array.isArray(findings)) {
      const useColor = shouldUseColorFn({ noColorFlag: subArgs.includes('--no-color') });
      if (useColor) {
        console.log(formatColoredOutput(findings as Finding[], { useColor: true }));
      } else {
        console.log(JSON.stringify(findings, null, 2));
      }
    } else {
      console.log(JSON.stringify(findings, null, 2));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('LLM call failed:', message);
    process.exit(1);
  }
}

if (command === 'parse') {
  const diffText = readFileSync(0, 'utf-8'); // stdin
  const files = parseDiff(diffText);
  console.log(JSON.stringify(files, null, 2));
} else if (command === 'review') {
  const reviewArgs = args.slice(1);

  // 解析 --format / --output 标志（Task 15：结果导出）
  const formatIdx = reviewArgs.indexOf('--format');
  const formatValue =
    formatIdx >= 0 && formatIdx + 1 < reviewArgs.length
      ? reviewArgs[formatIdx + 1]
      : null;
  const outputIdx = reviewArgs.indexOf('--output');
  const outputFile =
    outputIdx >= 0 && outputIdx + 1 < reviewArgs.length
      ? reviewArgs[outputIdx + 1]
      : undefined;

  // Task 13：--tui 标志 — 从 stdin 读取 findings JSON，启动交互式 TUI
  // 在非 TTY 环境（如 CI / 测试）下，TUI 仅渲染一次后正常退出
  const tuiFlag = reviewArgs.includes('--tui');
  if (tuiFlag) {
    const inputText = readFileSync(0, 'utf-8');
    let tuiFindings: Finding[];
    try {
      const parsed = JSON.parse(inputText);
      if (!Array.isArray(parsed)) {
        console.error('Error: --tui input must be a JSON array of findings');
        process.exit(1);
      }
      tuiFindings = parsed as Finding[];
    } catch (err) {
      console.error('Error: invalid JSON input for --tui mode');
      process.exit(1);
    }

    await launchTUI(tuiFindings, {
      interactive: Boolean(process.stdin.isTTY),
      useColor: !reviewArgs.includes('--no-color'),
    });
  } else if (formatValue) {
    // Task 15：--format 模式 — 从 stdin 读取 findings JSON，按指定格式导出
    const VALID_FORMATS: ReadonlySet<string> = new Set(['json', 'markdown', 'sarif', 'html']);
    if (!VALID_FORMATS.has(formatValue)) {
      console.error(
        `Error: invalid --format '${formatValue}'. Valid values: ${[...VALID_FORMATS].join(', ')}`,
      );
      process.exit(1);
    }

    const inputText = readFileSync(0, 'utf-8');
    let formatFindings: Finding[];
    try {
      const parsed = JSON.parse(inputText);
      if (!Array.isArray(parsed)) {
        console.error('Error: --format input must be a JSON array of findings');
        process.exit(1);
      }
      formatFindings = parsed as Finding[];
    } catch (err) {
      console.error('Error: invalid JSON input for --format mode');
      process.exit(1);
    }

    const content = exportResults(formatFindings, {
      format: formatValue as ExportFormat,
      outputFile,
    });
    if (content) {
      console.log(content);
    }
  } else {
  const diffText = readFileSync(0, 'utf-8');
  const parsedDiffs = parseDiff(diffText);
  const isLargePR = parsedDiffs.length >= LARGE_PR_THRESHOLD;

  const incrementalFlag = reviewArgs.includes('--incremental');
  const streamFlag = reviewArgs.includes('--stream');
  // Task 19：--profile 标志 — 开启时输出性能报告到 stderr
  const profileFlag = reviewArgs.includes('--profile');
  const profileIntervalIdx = reviewArgs.indexOf('--profile-interval');
  const profileIntervalMs =
    profileIntervalIdx >= 0 && profileIntervalIdx + 1 < reviewArgs.length
      ? parseInt(reviewArgs[profileIntervalIdx + 1], 10)
      : undefined;
  const profileOutputIdx = reviewArgs.indexOf('--profile-output');
  const profileOutputFile =
    profileOutputIdx >= 0 && profileOutputIdx + 1 < reviewArgs.length
      ? reviewArgs[profileOutputIdx + 1]
      : undefined;
  const stateFileIdx = reviewArgs.indexOf('--state-file');
  const stateFile =
    stateFileIdx >= 0 && stateFileIdx + 1 < reviewArgs.length
      ? reviewArgs[stateFileIdx + 1]
      : undefined;

  // Task 19：开启性能剖析（若 --profile 启用）
  if (profileFlag) {
    const profileOpts: ProfilingOptions = {};
    if (profileIntervalMs && !Number.isNaN(profileIntervalMs) && profileIntervalMs > 0) {
      profileOpts.memorySampleIntervalMs = profileIntervalMs;
    }
    startProfiling(profileOpts);
  }

  try {
  // Task 4：智能预检 — trivial changes 时直接跳过 LLM 调用
  const precheck = performPreCheck(parsedDiffs);
  if (precheck.shouldSkip && !incrementalFlag) {
    console.error(
      `[precheck] Skipping review: ${precheck.reason} ` +
        `(files=${precheck.stats.filesChanged}, +${precheck.stats.insertions}/-${precheck.stats.deletions})`,
    );
    if (streamFlag) {
      // 流式模式下输出完整事件序列后退出
      const emitter = createStreamingEmitter((chunk) => process.stdout.write(chunk));
      emitter.sendStart({ totalFiles: parsedDiffs.length });
      emitter.sendComplete({
        totalFiles: parsedDiffs.length,
        findingsCount: 0,
        durationMs: 0,
        failedFiles: 0,
      });
    } else {
      console.log('[]');
    }
  } else if (incrementalFlag) {
    const stateFilePath = stateFile ?? DEFAULT_INCREMENTAL_STATE_FILE;
    const previousState = loadLastReviewState({ stateFile: stateFilePath });
    const incremental = computeIncrementalDiff(parsedDiffs, previousState);

    const replacedFiles = [
      ...incremental.changedDiffs.map((d) => d.path),
      ...incremental.removedFiles,
    ];

    if (incremental.changedDiffs.length === 0) {
      console.error(
        `[incremental] No changed files to review (${incremental.unchangedFiles.length} unchanged, ${incremental.removedFiles.length} removed).`,
      );
      console.log(JSON.stringify(previousState.findings, null, 2));
      saveIncrementalState(stateFilePath, {
        version: 1,
        lastReviewedAt: Date.now(),
        fileHashes: incremental.currentHashes,
        findings: previousState.findings,
      });
    } else {
      console.error(
        `[incremental] Reviewing ${incremental.changedDiffs.length} changed file(s) (skipping ${incremental.unchangedFiles.length} unchanged, ${incremental.removedFiles.length} removed).`,
      );
      const changedDiffText = serializeDiffsToDiffText(incremental.changedDiffs);
      const result = await runPipeline(changedDiffText, { filter: {} });

      const subArgs = process.argv.slice(3);
      const executeFlag = subArgs.includes('--execute');
      const llmConfigIndex = subArgs.indexOf('--llm-config');
      const llmConfigStr =
        llmConfigIndex >= 0 && llmConfigIndex + 1 < subArgs.length
          ? subArgs[llmConfigIndex + 1]
          : null;

      let newFindings: Finding[] | null = null;
      if (executeFlag) {
        if (!llmConfigStr) {
          console.error('Error: LLM config required when --execute is used (provide --llm-config)');
          process.exit(1);
        }
        let llmConfig: LLMProviderConfig;
        try {
          llmConfig = JSON.parse(llmConfigStr) as LLMProviderConfig;
        } catch {
          console.error('Error: --llm-config must be valid JSON');
          process.exit(1);
        }
        try {
          const llmResponse = await callLLM(result.prompt, llmConfig);
          try {
            newFindings = JSON.parse(llmResponse) as Finding[];
          } catch {
            // LLM 返回非 JSON：直接输出原始响应，不更新状态
            console.log(llmResponse);
            process.exit(0);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('LLM call failed:', message);
          process.exit(1);
        }
      }

      if (newFindings !== null) {
        const mergedFindings = mergeIncrementalFindings(
          previousState.findings,
          replacedFiles,
          newFindings,
        );
        console.log(JSON.stringify(mergedFindings, null, 2));
        saveIncrementalState(stateFilePath, {
          version: 1,
          lastReviewedAt: Date.now(),
          fileHashes: incremental.currentHashes,
          findings: mergedFindings,
        });
      } else {
        await outputReviewResult(result.prompt);
        saveIncrementalState(stateFilePath, {
          version: 1,
          lastReviewedAt: Date.now(),
          fileHashes: incremental.currentHashes,
          findings: previousState.findings,
        });
      }
    }
  } else if (streamFlag) {
    // Task 6：流式输出 — 以 SSE 格式输出审查事件
    const emitter = createStreamingEmitter((chunk) => process.stdout.write(chunk));
    const diffsToStream = parsedDiffs;
    const startTime = performance.now();
    emitter.sendStart({ totalFiles: diffsToStream.length, startTime });

    const allFindings: Finding[] = [];
    let failedFiles = 0;

    // 简化实现：每个文件触发一次 pipeline（生产实现可批处理）
    // 此处复用整体 pipeline 结果以文件粒度回放
    const pipelineResult = isLargePR
      ? await runPipelineBatched(diffText, {
          filter: {},
          batching: {
            threshold: LARGE_PR_THRESHOLD,
            prioritize: true,
            parallel: false,
          },
        })
      : await runPipeline(diffText, { filter: {} });

    for (let i = 0; i < diffsToStream.length; i++) {
      const diff = diffsToStream[i];
      const fileStart = performance.now();
      emitter.sendFileStart({
        file: diff.path,
        index: i,
        total: diffsToStream.length,
      });
      try {
        // 当前简化：不实际逐文件调用 LLM；findings 留空
        const findings: Finding[] = [];
        allFindings.push(...findings);
        emitter.sendFileComplete({
          file: diff.path,
          index: i,
          total: diffsToStream.length,
          findings,
          durationMs: performance.now() - fileStart,
        });
      } catch (err) {
        failedFiles++;
        const message = err instanceof Error ? err.message : String(err);
        emitter.sendError({ message, stage: 'review-file', file: diff.path });
        emitter.sendFileComplete({
          file: diff.path,
          index: i,
          total: diffsToStream.length,
          findings: [],
          durationMs: performance.now() - fileStart,
        });
      }
    }

    const durationMs = performance.now() - startTime;
    emitter.sendComplete({
      totalFiles: diffsToStream.length,
      findingsCount: allFindings.length,
      durationMs,
      failedFiles,
    });
    // 流式模式下不输出 prompt（已通过 SSE 流输出）
    void pipelineResult;
  } else if (isLargePR) {
    const result = await runPipelineBatched(diffText, {
      filter: {},
      batching: {
        threshold: LARGE_PR_THRESHOLD,
        prioritize: true,
        parallel: false
      }
    });
    await outputReviewResult(result.prompt);
  } else {
    const result = await runPipeline(diffText, { filter: {} });
    await outputReviewResult(result.prompt);
  }
  } finally {
    // Task 19：关闭性能剖析并输出报告
    if (profileFlag) {
      try {
        const report = stopProfiling();
        const reportStr = formatProfileReport(report);
        if (profileOutputFile) {
          writeFileSync(profileOutputFile, reportStr + '\n', 'utf-8');
          console.error(`[profile] report written to ${profileOutputFile}`);
        } else {
          console.error(reportStr);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[profile] failed to generate report: ${message}`);
      }
    }
  }
  }
} else if (command === 'security-review') {
  const diffText = readFileSync(0, 'utf-8');
  const parsedDiffs = parseDiff(diffText);
  const isLargePR = parsedDiffs.length >= LARGE_PR_THRESHOLD;
  
  if (isLargePR) {
    const result = await runSecurityPipelineBatched(diffText, { 
      filter: {},
      batching: { 
        threshold: LARGE_PR_THRESHOLD,
        prioritize: true,
        parallel: false
      }
    });
    await outputReviewResult(result.prompt);
  } else {
    const result = await runSecurityPipeline(diffText, { filter: {} });
    await outputReviewResult(result.prompt);
  }
} else if (command === 'scan') {
  const diffText = readFileSync(0, 'utf-8');
  
  const scanArgs = args.slice(1);
  const getArg = (flag: string): string | undefined => {
    const idx = scanArgs.indexOf(flag);
    return idx !== -1 && idx + 1 < scanArgs.length ? scanArgs[idx + 1] : undefined;
  };
  
  const getMultiArg = (flag: string): string[] => {
    const result: string[] = [];
    let idx = scanArgs.indexOf(flag);
    while (idx !== -1) {
      if (idx + 1 < scanArgs.length) {
        result.push(scanArgs[idx + 1]);
      }
      idx = scanArgs.indexOf(flag, idx + 2);
    }
    return result;
  };
  
  const languages = getMultiArg('--language');
  const limitStr = getArg('--limit');
  const limit = limitStr ? parseInt(limitStr, 10) : 0;
  const excludePatterns = getMultiArg('--exclude');
  
  const filterConfig: FilterConfig = {};
  
  if (languages.length > 0) {
    filterConfig.language = languages;
  }
  
  if (limit > 0) {
    filterConfig.maxFiles = limit;
  }
  
  if (excludePatterns.length > 0) {
    filterConfig.ignorePatterns = excludePatterns;
  }
  
  const result = await runPipeline(diffText, { filter: filterConfig });
  
  const filteredWithoutGenerated = excludeGeneratedFiles(result.filteredDiffs);
  
  for (const diff of filteredWithoutGenerated) {
    diff.language = detectLanguage(diff.path);
  }
  
  const scanPrompt = buildScanPrompt({
    filteredDiffs: filteredWithoutGenerated,
    bundles: result.bundles,
    annotatedBundles: result.annotatedBundles,
    context: result.context,
  });
  await outputReviewResult(scanPrompt);
} else if (command === 'impact') {
  const diffText = readFileSync(0, 'utf-8');
  const result = await runPipeline(diffText, { filter: {} });
  const impactPrompt = buildImpactPrompt({
    filteredDiffs: result.filteredDiffs,
    bundles: result.bundles,
    annotatedBundles: result.annotatedBundles,
    context: result.context,
  });
  await outputReviewResult(impactPrompt);
} else if (command === 'reflect') {
  const diffText = readFileSync(0, 'utf-8');
  const findings = JSON.parse(diffText);
  const prompt = buildBatchReflectionPrompt(findings);
  await outputReviewResult(prompt);
} else if (command === 'publish') {
  const publishArgs = args.slice(1);
  const getArg = (flag: string): string | undefined => {
    const idx = publishArgs.indexOf(flag);
    return idx !== -1 && idx + 1 < publishArgs.length ? publishArgs[idx + 1] : undefined;
  };

  const owner = getArg('--owner');
  const repo = getArg('--repo');
  const pr = getArg('--pr');
  const token = getArg('--token') || process.env.GITHUB_TOKEN;
  const filePath = getArg('--file');
  const mode = getArg('--mode') as 'replace' | 'incremental' | undefined;

  if (!owner || !repo || !pr || !filePath) {
    console.error('Usage: code-review publish --owner <owner> --repo <repo> --pr <pr-number> --file <results.json> [--token <token>] [--mode replace|incremental]');
    process.exit(1);
  }

  if (!token) {
    console.error('Error: --token or GITHUB_TOKEN environment variable is required');
    process.exit(1);
  }

  const findings = JSON.parse(readFileSync(filePath, 'utf-8'));
  const result = await publishReview({
    findings,
    owner,
    repo,
    prNumber: parseInt(pr, 10),
    token,
    mode,
  });

  console.log(`Published ${result.inlineCount} inline comments, summary ${result.summaryUpdated ? 'updated' : 'created'}, ${result.skipped} skipped (duplicates).`);
} else if (command === 'init') {
  // 交互式初始化向导
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: stdin, output: process.stdout });

  try {
    console.log('\n🚀 OpenCode Code Review 初始化向导\n');

    // 选择语言
    const languages = ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'cpp', 'c'] as const;
    console.log('选择项目语言:');
    languages.forEach((lang, i) => console.log(`  ${i + 1}. ${lang}`));
    const langInput = await rl.question('\n输入序号或语言名称 (默认: typescript): ');
    let language: typeof languages[number] = 'typescript';
    const langNum = parseInt(langInput, 10);
    if (langNum >= 1 && langNum <= languages.length) {
      language = languages[langNum - 1];
    } else if (languages.includes(langInput.toLowerCase() as typeof languages[number])) {
      language = langInput.toLowerCase() as typeof languages[number];
    }

    // 审查强度
    console.log('\n审查强度:');
    console.log('  1. lenient (宽松) - 仅报告 critical/high 级别');
    console.log('  2. standard (标准) - 报告 medium 及以上 (推荐)');
    console.log('  3. strict (严格) - 报告所有级别');
    const strengthInput = await rl.question('\n输入序号 (默认: 2): ');
    let reviewStrength: 'lenient' | 'standard' | 'strict' = 'standard';
    if (strengthInput === '1') reviewStrength = 'lenient';
    else if (strengthInput === '3') reviewStrength = 'strict';

    // 安全审查
    const securityInput = await rl.question('\n启用安全专项审查? (Y/n): ');
    const securityReview = securityInput.toLowerCase() !== 'n';

    // 部署方式
    console.log('\n部署方式:');
    console.log('  1. cli - 命令行使用');
    console.log('  2. github-actions - GitHub Actions 自动化');
    const deployInput = await rl.question('\n输入序号 (默认: 1): ');
    const deployment: 'cli' | 'github-actions' = deployInput === '2' ? 'github-actions' : 'cli';

    rl.close();

    // 生成配置
    const config = generateConfig({
      language,
      reviewStrength,
      securityReview,
      deployment,
    });

    // 写入文件
    const cwd = process.cwd();
    console.log('\n📁 生成配置文件...\n');

    for (const [relPath, content] of Object.entries(config.files)) {
      const filePath = join(cwd, relPath);
      const dir = join(filePath, '..');

      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // 检查文件是否存在
      if (existsSync(filePath)) {
        console.log(`  ⚠️  跳过 (已存在): ${relPath}`);
      } else {
        writeFileSync(filePath, content, 'utf-8');
        console.log(`  ✅ 创建: ${relPath}`);
      }
    }

    console.log('\n✨ 初始化完成!\n');
    console.log('下一步:');
    console.log('  1. 在 OpenCode 中使用 /review 命令审查代码');
    if (securityReview) {
      console.log('  2. 使用 /security-review 进行安全专项审查');
    }
    console.log('  3. 编辑 review-rules/ 目录下的规则文件自定义检测规则\n');
  } catch (err) {
    rl.close();
    console.error('初始化失败:', err);
    process.exit(1);
  }
} else if (command === 'feedback') {
  const feedbackArgs = args.slice(1);
  const findingId = feedbackArgs[0];
  const action = feedbackArgs[1];

  const getArg = (flag: string): string | undefined => {
    const idx = feedbackArgs.indexOf(flag);
    return idx !== -1 && idx + 1 < feedbackArgs.length ? feedbackArgs[idx + 1] : undefined;
  };

  const reason = getArg('--reason');

  if (!findingId || !action) {
    console.error('Usage: code-review feedback <finding-id> <false-positive|accept> [--reason <reason>]');
    process.exit(1);
  }

  const VALID_ACTIONS = ['false-positive', 'accept'];
  if (!VALID_ACTIONS.includes(action)) {
    console.error(`Error: invalid action '${action}'. Valid actions: ${VALID_ACTIONS.join(', ')}`);
    process.exit(1);
  }

  const store = new FeedbackStore();

  if (action === 'false-positive') {
    const result = markFalsePositive(store, findingId, undefined, reason);
    console.log(`✅ Marked finding "${findingId}" as false positive`);
    if (result.reason) {
      console.log(`   Reason: ${result.reason}`);
    }
    console.log(`   Feedback ID: ${result.id}`);
    if (result.ignoreRule) {
      console.log(`   Generated ignore rule: ${JSON.stringify(result.ignoreRule)}`);
    }
  } else if (action === 'accept') {
    const result = store.recordFeedback(findingId, 'accept', reason);
    console.log(`✅ Accepted finding "${findingId}"`);
    if (result.reason) {
      console.log(`   Reason: ${result.reason}`);
    }
    console.log(`   Feedback ID: ${result.id}`);
  }
} else if (command === 'metrics') {
  const metricsArgs = args.slice(1);
  const getArg = (flag: string): string | undefined => {
    const idx = metricsArgs.indexOf(flag);
    return idx !== -1 && idx + 1 < metricsArgs.length ? metricsArgs[idx + 1] : undefined;
  };

  const sessionsStr = getArg('--sessions');
  const findingsStr = getArg('--findings');
  const feedbackStr = getArg('--feedback');
  const tokenConsumedStr = getArg('--token-consumed');

  if (!sessionsStr || !findingsStr || !feedbackStr) {
    console.error('Usage: code-review metrics --sessions <json> --findings <json> --feedback <json> [--token-consumed <number>]');
    process.exit(1);
  }

  let sessions: SessionSnapshot[];
  let findings: Finding[];
  try {
    sessions = JSON.parse(sessionsStr) as SessionSnapshot[];
    findings = JSON.parse(findingsStr) as Finding[];
  } catch (err) {
    console.error('Error: --sessions and --findings must be valid JSON');
    process.exit(1);
  }

  const feedbackStore = new FeedbackStore();
  try {
    const feedbackData = JSON.parse(feedbackStr) as Array<{ findingId: string; action: 'accept' | 'reject' | 'modify'; reason?: string }>;
    for (const fb of feedbackData) {
      feedbackStore.recordFeedback(fb.findingId, fb.action, fb.reason);
    }
  } catch (err) {
    console.error('Error: --feedback must be valid JSON');
    process.exit(1);
  }

  const tokenConsumed = tokenConsumedStr ? parseInt(tokenConsumedStr, 10) : 0;

  const metrics = collectMetrics({
    sessions,
    findings,
    feedback: feedbackStore,
    tokenConsumed,
  });

  console.log(JSON.stringify(metrics, null, 2));
} else if (command === 'dashboard') {
  const inputText = readFileSync(0, 'utf-8');
  let inputData: Partial<MetricsInput>;
  try {
    inputData = inputText.trim() ? JSON.parse(inputText) : {};
  } catch (err) {
    console.error('Error: Invalid JSON input for dashboard command');
    process.exit(1);
  }

  const sessions: SessionSnapshot[] = inputData.sessions ?? [];
  const findings: Finding[] = inputData.findings ?? [];
  const tokenConsumed = inputData.tokenConsumed ?? 0;

  let findingsBySession: Map<string, Finding[]> | undefined;
  if (inputData.findingsBySession) {
    findingsBySession = new Map(Object.entries(inputData.findingsBySession));
  }

  const dashboard = generateDashboardData({
    sessions,
    findings,
    feedback: new FeedbackStore(),
    tokenConsumed,
    findingsBySession,
  });

  console.log(JSON.stringify(dashboard, null, 2));
} else if (command === 'audit') {
  // Task 11：审计日志查询命令
  const auditArgs = args.slice(1);
  const getArg = (flag: string): string | undefined => {
    const idx = auditArgs.indexOf(flag);
    return idx !== -1 && idx + 1 < auditArgs.length ? auditArgs[idx + 1] : undefined;
  };

  const filePath = getArg('--file') ?? DEFAULT_AUDIT_LOG_FILE;
  const userFilter = getArg('--user');
  const actionFilter = getArg('--action');
  const actionPrefix = getArg('--action-prefix');
  const resultFilter = getArg('--result') as AuditResult | undefined;
  const limitStr = getArg('--limit');
  const fromTsStr = getArg('--from-timestamp');
  const toTsStr = getArg('--to-timestamp');

  if (auditArgs.length === 0) {
    console.error('Usage: code-review audit --file <path> [--user <name>] [--action <action>] [--result <success|failure|denied>] [--limit <number>]');
    process.exit(1);
  }

  const VALID_RESULTS: ReadonlySet<AuditResult> = new Set(['success', 'failure', 'denied']);
  if (resultFilter && !VALID_RESULTS.has(resultFilter)) {
    console.error(`Error: invalid result '${resultFilter}'. Valid values: ${[...VALID_RESULTS].join(', ')}`);
    process.exit(1);
  }

  const entries = getAuditLog({
    filePath,
    user: userFilter,
    action: actionFilter,
    actionPrefix,
    result: resultFilter,
    fromTimestamp: fromTsStr ? parseInt(fromTsStr, 10) : undefined,
    toTimestamp: toTsStr ? parseInt(toTsStr, 10) : undefined,
    limit: limitStr ? parseInt(limitStr, 10) : undefined,
    fromDisk: true,
  });

  console.log(JSON.stringify(entries, null, 2));
} else if (command === 'compliance') {
  // Task 12：合规检查命令 — 从 stdin 读取 findings JSON，输出合规报告
  const inputText = readFileSync(0, 'utf-8');
  let findings: Finding[];
  try {
    const parsed = JSON.parse(inputText);
    if (!Array.isArray(parsed)) {
      console.error('Error: input must be a JSON array of findings');
      process.exit(1);
    }
    findings = parsed as Finding[];
  } catch (err) {
    console.error('Error: invalid JSON input for compliance command');
    process.exit(1);
  }

  const report = checkCompliance(findings);
  console.log(JSON.stringify(report, null, 2));
} else if (command === 'rules') {
  const rulesArgs = args.slice(1);
  const subCommand = rulesArgs[0];

  // 解析 flag 与位置参数：跳过 subCommand，过滤掉 flag 及其值
  const positional: string[] = [];
  const flagValues: Record<string, string> = {};
  for (let i = 1; i < rulesArgs.length; i++) {
    const tok = rulesArgs[i];
    if (tok.startsWith('--')) {
      const next = rulesArgs[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flagValues[tok] = next;
        i++;
      }
    } else {
      positional.push(tok);
    }
  }
  const getArg = (flag: string): string | undefined => flagValues[flag];

  const rulesDir = getArg('--rules-dir') ?? DEFAULT_RULES_DIR;
  const configPath = getArg('--config') ?? RULES_CONFIG_FILE;
  const rulesDirAbs = resolve(process.cwd(), rulesDir);
  const configPathAbs = resolve(process.cwd(), configPath);

  const VALID_SEVERITIES: ReadonlySet<Severity> = new Set(['critical', 'high', 'medium', 'low']);

  if (subCommand === 'list') {
    const rawRules = await loadCustomRules(rulesDirAbs);
    const config = loadRulesConfig(configPathAbs);
    const rules = applyRulesConfig(rawRules, config);
    const active = getActiveRules(rules);
    const disabled = rules.filter((r) => r.disabled === true);

    console.log(`Rules directory: ${rulesDirAbs}`);
    console.log(`Config file: ${configPathAbs}`);
    console.log(`Total: ${rules.length}  Active: ${active.length}  Disabled: ${disabled.length}\n`);

    if (active.length > 0) {
      console.log('Active rules:');
      for (const r of active) {
        const lang = r.language && r.language.length > 0 ? `  [${r.language.join(',')}]` : '';
        console.log(`  - ${r.id}  (${r.severity}/${r.category})  ${r.name}${lang}`);
      }
    }

    if (disabled.length > 0) {
      console.log('\nDisabled rules:');
      for (const r of disabled) {
        console.log(`  - ${r.id}  (${r.severity}/${r.category})  ${r.name}`);
      }
    }
  } else if (subCommand === 'disable') {
    const ruleId = positional[0];
    if (!ruleId) {
      console.error('Usage: code-review rules disable <rule-id> [--rules-dir <path>] [--config <path>]');
      process.exit(1);
    }
    const config = loadRulesConfig(configPathAbs);
    if (!config.disabled.includes(ruleId)) {
      config.disabled.push(ruleId);
    }
    saveRulesConfig(config, configPathAbs);
    console.log(`Disabled rule: ${ruleId}`);
    console.log(`Config saved to: ${configPathAbs}`);
  } else if (subCommand === 'enable') {
    const ruleId = positional[0];
    if (!ruleId) {
      console.error('Usage: code-review rules enable <rule-id> [--rules-dir <path>] [--config <path>]');
      process.exit(1);
    }
    const config = loadRulesConfig(configPathAbs);
    config.disabled = config.disabled.filter((id) => id !== ruleId);
    saveRulesConfig(config, configPathAbs);
    console.log(`Enabled rule: ${ruleId}`);
    console.log(`Config saved to: ${configPathAbs}`);
  } else if (subCommand === 'override') {
    const ruleId = positional[0];
    if (!ruleId) {
      console.error('Usage: code-review rules override <rule-id> [--severity <sev>] [--name <name>] [--category <cat>] [--description <desc>] [--rules-dir <path>] [--config <path>]');
      process.exit(1);
    }
    const severity = getArg('--severity') as Severity | undefined;
    const name = getArg('--name');
    const category = getArg('--category');
    const description = getArg('--description');

    if (severity && !VALID_SEVERITIES.has(severity)) {
      console.error(`Error: invalid severity '${severity}'. Valid values: ${[...VALID_SEVERITIES].join(', ')}`);
      process.exit(1);
    }

    const override: RuleOverride = {};
    if (severity) override.severity = severity;
    if (name) override.name = name;
    if (category) override.category = category;
    if (description) override.description = description;

    if (Object.keys(override).length === 0) {
      console.error('Error: at least one override option is required (--severity / --name / --category / --description)');
      process.exit(1);
    }

    const config = loadRulesConfig(configPathAbs);
    const existing = config.overrides[ruleId] ?? {};
    config.overrides[ruleId] = { ...existing, ...override };
    saveRulesConfig(config, configPathAbs);
    console.log(`Overrode rule: ${ruleId}`);
    console.log(`  Changes: ${JSON.stringify(override)}`);
    console.log(`Config saved to: ${configPathAbs}`);
  } else if (subCommand === 'show') {
    const ruleId = positional[0];
    if (!ruleId) {
      console.error('Usage: code-review rules show <rule-id> [--rules-dir <path>] [--config <path>]');
      process.exit(1);
    }
    const rawRules = await loadCustomRules(rulesDirAbs);
    const config = loadRulesConfig(configPathAbs);
    const rules = applyRulesConfig(rawRules, config);
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) {
      console.error(`Error: rule '${ruleId}' not found`);
      process.exit(1);
    }
    console.log(JSON.stringify(rule, null, 2));
  } else {
    console.error(`Usage: code-review rules <list|show|enable|disable|override> [options]

Options:
  --rules-dir <path>    Custom rules directory (default: review-rules)
  --config <path>       Rules config file (default: .code-review-rules.json)

Subcommands:
  list                                  List all rules (active and disabled)
  show <rule-id>                        Show details of a specific rule
  enable <rule-id>                      Enable a previously disabled rule
  disable <rule-id>                     Disable a rule by ID
  override <rule-id> [options]          Override rule parameters
    --severity <critical|high|medium|low>
    --name <name>
    --category <category>
    --description <description>`);
    process.exit(1);
  }
} else if (command === 'serve') {
  // Task 17：启动 HTTP API 服务器（基于 Node.js 内置 http 模块，不依赖 express）
  const serveArgs = args.slice(1);
  const getArg = (flag: string): string | undefined => {
    const idx = serveArgs.indexOf(flag);
    return idx !== -1 && idx + 1 < serveArgs.length ? serveArgs[idx + 1] : undefined;
  };

  const portStr = getArg('--port');
  const hostFlag = getArg('--host');
  const port = portStr ? parseInt(portStr, 10) : DEFAULT_API_PORT;
  const host = hostFlag ?? DEFAULT_API_HOST;

  if (portStr && (Number.isNaN(port) || port <= 0 || port > 65535)) {
    console.error(`Error: invalid --port value '${portStr}'. Must be a number between 1 and 65535.`);
    process.exit(1);
  }

  console.log(`[serve] starting API server on http://${host}:${port}`);
  console.log(`[serve] endpoints:`);
  console.log(`  POST /api/v1/review    触发代码审查（接受 diff 文本）`);
  console.log(`  GET  /api/v1/findings  获取最近一次审查的 findings`);
  console.log(`  GET  /api/v1/health    健康检查`);
  console.log(`  GET  /api/v1/metrics   获取度量指标`);

  // 测试/CI 场景：CODE_REVIEW_SERVE_NO_START=1 时跳过实际启动（仅打印配置）
  if (process.env.CODE_REVIEW_SERVE_NO_START === '1') {
    console.log(`[serve] CODE_REVIEW_SERVE_NO_START=1, skipping actual server start`);
  } else {
    const server = await startApiServer({ port, host });

    // 优雅关闭：收到 SIGINT/SIGTERM 时停止服务器
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[serve] received ${signal}, shutting down...`);
      try {
        await stopApiServer(server);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[serve] error during shutdown: ${message}`);
      }
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));

    // 服务器已启动（startApiServer 内部已 listen），事件循环保持活跃
  }
} else if (command === 'alert') {
  // Task 20：告警通知命令 — 通过 CLI 触发多渠道告警（Slack / Email / PagerDuty）
  const alertArgs = args.slice(1);
  const getArg = (flag: string): string | undefined => {
    const idx = alertArgs.indexOf(flag);
    return idx !== -1 && idx + 1 < alertArgs.length ? alertArgs[idx + 1] : undefined;
  };

  const severityStr = getArg('--severity') as AlertSeverity | undefined;
  const message = getArg('--message');
  const title = getArg('--title') ?? 'Code Review Alert';
  const source = getArg('--source');
  const fileFlag = getArg('--file');
  const lineStr = getArg('--line');
  const prStr = getArg('--pr-number');
  const repository = getArg('--repository');

  const slackUrl = getArg('--slack-url');
  const slackMinSev = getArg('--slack-min-severity') as AlertSeverity | undefined;
  const emailTo = getArg('--email-to');
  const emailFrom = getArg('--email-from') ?? 'code-review@example.com';
  const emailApiUrl = getArg('--email-api-url');
  const emailApiKey = getArg('--email-api-key');
  const emailMinSev = getArg('--email-min-severity') as AlertSeverity | undefined;
  const pagerDutyKey = getArg('--pagerduty-key');
  const pagerDutyMinSev = getArg('--pagerduty-min-severity') as AlertSeverity | undefined;

  // 校验必需参数
  if (alertArgs.length === 0 || !severityStr || !message) {
    console.error(
      'Usage: code-review alert --severity <critical|high|medium|low|info> --message <text> [--title <title>] [--source <name>] [--file <path>] [--line <num>] [--slack-url <url>] [--email-to <addr>] [--email-api-url <url>] [--email-api-key <key>] [--pagerduty-key <key>]',
    );
    process.exit(1);
  }

  const VALID_SEVERITIES: ReadonlySet<AlertSeverity> = new Set([
    'critical',
    'high',
    'medium',
    'low',
    'info',
  ]);
  if (!VALID_SEVERITIES.has(severityStr)) {
    console.error(
      `Error: invalid severity '${severityStr}'. Valid values: ${[...VALID_SEVERITIES].join(', ')}`,
    );
    process.exit(1);
  }

  // 校验：至少配置一个渠道
  if (!slackUrl && !emailTo && !pagerDutyKey) {
    console.error(
      'Error: at least one channel must be configured (--slack-url / --email-to / --pagerduty-key)',
    );
    process.exit(1);
  }

  // 校验 email 配置完整性
  if (emailTo && (!emailApiUrl || !emailApiKey)) {
    console.error(
      'Error: --email-api-url and --email-api-key are required when --email-to is used',
    );
    process.exit(1);
  }

  // 校验 min-severity 取值
  const validateMinSeverity = (val: AlertSeverity | undefined, name: string): void => {
    if (val && !VALID_SEVERITIES.has(val)) {
      console.error(`Error: invalid ${name} '${val}'. Valid values: ${[...VALID_SEVERITIES].join(', ')}`);
      process.exit(1);
    }
  };
  validateMinSeverity(slackMinSev, '--slack-min-severity');
  validateMinSeverity(emailMinSev, '--email-min-severity');
  validateMinSeverity(pagerDutyMinSev, '--pagerduty-min-severity');

  // 构造 AlertPayload
  const payload: AlertPayload = {
    title,
    message,
    severity: severityStr,
  };
  if (source) payload.source = source;
  if (fileFlag) payload.file = fileFlag;
  if (lineStr) {
    const lineNum = parseInt(lineStr, 10);
    if (!Number.isNaN(lineNum)) payload.line = lineNum;
  }
  if (prStr) {
    const prNum = parseInt(prStr, 10);
    if (!Number.isNaN(prNum)) payload.prNumber = prNum;
  }
  if (repository) payload.repository = repository;

  // 构造 AlertNotifierOptions
  const notifierOpts: AlertNotifierOptions = {};
  if (slackUrl) {
    const slackConfig: SlackConfig = { webhookUrl: slackUrl };
    notifierOpts.slack = slackConfig;
  }
  if (emailTo && emailApiUrl && emailApiKey) {
    const emailConfig: EmailConfig = {
      apiUrl: emailApiUrl,
      apiKey: emailApiKey,
      from: emailFrom,
      to: emailTo,
    };
    notifierOpts.email = emailConfig;
  }
  if (pagerDutyKey) {
    const pagerDutyConfig: PagerDutyConfig = { integrationKey: pagerDutyKey };
    notifierOpts.pagerDuty = pagerDutyConfig;
  }
  if (slackMinSev) notifierOpts.slackMinSeverity = slackMinSev;
  if (emailMinSev) notifierOpts.emailMinSeverity = emailMinSev;
  if (pagerDutyMinSev) notifierOpts.pagerDutyMinSeverity = pagerDutyMinSev;

  // 测试/CI 场景：CODE_REVIEW_ALERT_NO_NETWORK=1 时不实际发起网络请求，
  // 仅打印 payload 与 notifier 配置（用于 dry-run）
  if (process.env.CODE_REVIEW_ALERT_NO_NETWORK === '1') {
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          payload,
          channels: {
            slack: Boolean(notifierOpts.slack),
            email: Boolean(notifierOpts.email),
            pagerDuty: Boolean(notifierOpts.pagerDuty),
          },
        },
        null,
        2,
      ),
    );
  } else {
    const notifier = new AlertNotifier(notifierOpts);
    const results = await notifier.notify(payload);
    console.log(JSON.stringify(results, null, 2));
    // 任一渠道失败时退出码为 1，便于 CI 集成
    const anyFailed = results.some((r) => !r.ok);
    if (anyFailed) {
      process.exit(1);
    }
  }
} else {
    console.log(`code-review v0.1.0

Usage:
  code-review init                           Interactive setup wizard
  code-review parse            < diff.txt    Parse diff from stdin
  code-review review           < diff.txt    Run review pipeline
  code-review security-review  < diff.txt    Run security review pipeline
  code-review scan             < diff.txt    Run full scan pipeline
  code-review impact           < diff.txt    Run impact analysis pipeline
  code-review reflect          < findings.json  Run confidence reflection on findings
  code-review publish --owner <owner> --repo <repo> --pr <pr-number> --file <results.json> [--token <token>] [--mode replace|incremental]
  code-review feedback         <finding-id> <false-positive|accept> [--reason <reason>]  Submit feedback on a finding
  code-review metrics --sessions <json> --findings <json> --feedback <json> [--token-consumed <number>]  Generate review metrics
  code-review dashboard        < input.json  Generate dashboard data with trends and charts
  code-review rules <list|show|enable|disable|override> [options]  Customize review rules
  code-review serve [--port <port>] [--host <host>]  Start HTTP API server (default: 127.0.0.1:3000)
  code-review alert --severity <critical|high|medium|low|info> --message <text> [--title <title>] [--source <name>] [--slack-url <url>] [--email-to <addr>] [--pagerduty-key <key>]  Send alert notification

  The review/security-review/scan/impact/reflect commands accept:
    --execute                 Call LLM to complete end-to-end review
    --llm-config '<json>'     JSON string with LLM provider config (required with --execute)
                              Example: '{"provider":"openai","apiKey":"KEY","model":"gpt-4"}'

  The review command also accepts:
    --incremental             Only review files whose content changed since the last review
    --state-file <path>       Incremental state file path (default: .code-review-incremental.json)
    --stream                  Output review events as Server-Sent Events (SSE) stream
                              Trivial changes are auto-skipped via precheck
    --profile                 Enable performance profiling; report is written to stderr
    --profile-interval <ms>   Memory sample interval in milliseconds (default: 50, only with --profile)
    --profile-output <path>   Write profile report to file instead of stderr

  The scan command also accepts:
    --language <lang>         Filter by language (supports multiple, e.g. --language typescript --language python)
    --limit <number>          Limit number of files to scan (0 = unlimited)
    --exclude <pattern>       Exclude files matching glob pattern (supports multiple)

  The feedback command:
    false-positive            Mark a finding as false positive (reject)
    accept                    Accept a finding as valid
    --reason <reason>         Optional reason for the feedback

  The rules command:
    list                      List all rules (active and disabled)
    show <rule-id>            Show details of a specific rule
    enable <rule-id>          Enable a previously disabled rule
    disable <rule-id>         Disable a rule by ID
    override <rule-id>        Override rule parameters (--severity / --name / --category / --description)
    --rules-dir <path>        Custom rules directory (default: review-rules)
    --config <path>           Rules config file (default: .code-review-rules.json)

  The alert command:
    --severity <sev>          Alert severity (critical|high|medium|low|info)
    --message <text>          Alert message body (required)
    --title <title>           Alert title (default: 'Code Review Alert')
    --source <name>           Source identifier (e.g. security-review)
    --file <path>             Associated file path
    --line <num>              Associated line number
    --pr-number <num>         Associated PR number
    --repository <name>       Associated repository
    --slack-url <url>         Slack Incoming Webhook URL
    --email-to <addr>         Email recipients (comma-separated)
    --email-from <addr>       Email sender (default: code-review@example.com)
    --email-api-url <url>     Email API endpoint (SendGrid v3 compatible)
    --email-api-key <key>     Email API key (Bearer token)
    --pagerduty-key <key>     PagerDuty Events API v2 integration key
    --slack-min-severity <sev>    Min severity to trigger Slack (default: medium)
    --email-min-severity <sev>    Min severity to trigger Email (default: medium)
    --pagerduty-min-severity <sev> Min severity to trigger PagerDuty (default: high)
    CODE_REVIEW_ALERT_NO_NETWORK=1  Dry-run: print payload without sending requests`);
}