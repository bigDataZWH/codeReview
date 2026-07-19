import { parseDiff } from './diff-parser.js';
import { runPipeline, runSecurityPipeline } from './pipeline.js';
import { buildImpactPrompt, buildScanPrompt } from './prompt-builder.js';
import { publishReview } from './comment-publisher.js';
import { generateConfig } from './init-wizard.js';
import { callLLM } from './ai-reflection.js';
import type { LLMProviderConfig } from './types.js';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stdin } from 'node:process';

const args = process.argv.slice(2);
const command = args[0];

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
    console.log(JSON.stringify(findings, null, 2));
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
  const diffText = readFileSync(0, 'utf-8');
  // 简化调用
  const result = await runPipeline(diffText, { filter: {} });
  await outputReviewResult(result.prompt);
} else if (command === 'security-review') {
  const diffText = readFileSync(0, 'utf-8');
  const result = await runSecurityPipeline(diffText, { filter: {} });
  await outputReviewResult(result.prompt);
} else if (command === 'scan') {
  const diffText = readFileSync(0, 'utf-8');
  const result = await runPipeline(diffText, { filter: {} });
  const scanPrompt = buildScanPrompt({
    filteredDiffs: result.filteredDiffs,
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
} else {
  console.log(`code-review v0.1.0

Usage:
  code-review init                           Interactive setup wizard
  code-review parse            < diff.txt    Parse diff from stdin
  code-review review           < diff.txt    Run review pipeline
  code-review security-review  < diff.txt    Run security review pipeline
  code-review scan             < diff.txt    Run full scan pipeline
  code-review impact           < diff.txt    Run impact analysis pipeline
  code-review publish --owner <owner> --repo <repo> --pr <pr-number> --file <results.json> [--token <token>] [--mode replace|incremental]

  The review/security-review/scan/impact commands accept:
    --execute                 Call LLM to complete end-to-end review
    --llm-config '<json>'     JSON string with LLM provider config (required with --execute)
                              Example: '{"provider":"openai","apiKey":"KEY","model":"gpt-4"}'`);
}