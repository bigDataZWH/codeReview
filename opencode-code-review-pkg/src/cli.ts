import { parseDiff } from './diff-parser.js';
import { runPipeline, runSecurityPipeline } from './pipeline.js';
import { buildImpactPrompt, buildScanPrompt } from './prompt-builder.js';
import { publishReview } from './comment-publisher.js';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const command = args[0];

if (command === 'parse') {
  const diffText = readFileSync(0, 'utf-8'); // stdin
  const files = parseDiff(diffText);
  console.log(JSON.stringify(files, null, 2));
} else if (command === 'review') {
  const diffText = readFileSync(0, 'utf-8');
  // 简化调用
  const result = await runPipeline(diffText, { filter: {} });
  console.log(result.prompt);
} else if (command === 'security-review') {
  const diffText = readFileSync(0, 'utf-8');
  const result = await runSecurityPipeline(diffText, { filter: {} });
  console.log(result.prompt);
} else if (command === 'scan') {
  const diffText = readFileSync(0, 'utf-8');
  const result = await runPipeline(diffText, { filter: {} });
  const scanPrompt = buildScanPrompt({
    filteredDiffs: result.filteredDiffs,
    bundles: result.bundles,
    annotatedBundles: result.annotatedBundles,
    context: result.context,
  });
  console.log(scanPrompt);
} else if (command === 'impact') {
  const diffText = readFileSync(0, 'utf-8');
  const result = await runPipeline(diffText, { filter: {} });
  const impactPrompt = buildImpactPrompt({
    filteredDiffs: result.filteredDiffs,
    bundles: result.bundles,
    annotatedBundles: result.annotatedBundles,
    context: result.context,
  });
  console.log(impactPrompt);
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
    console.error('Usage: opencode-code-review publish --owner <owner> --repo <repo> --pr <pr-number> --file <results.json> [--token <token>] [--mode replace|incremental]');
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
} else {
  console.log(`opencode-code-review v0.1.0

Usage:
  opencode-code-review parse            < diff.txt    Parse diff from stdin
  opencode-code-review review           < diff.txt    Run review pipeline
  opencode-code-review security-review  < diff.txt    Run security review pipeline
  opencode-code-review scan             < diff.txt    Run full scan pipeline
  opencode-code-review impact           < diff.txt    Run impact analysis pipeline
  opencode-code-review publish --owner <owner> --repo <repo> --pr <pr-number> --file <results.json> [--token <token>] [--mode replace|incremental]`);
}