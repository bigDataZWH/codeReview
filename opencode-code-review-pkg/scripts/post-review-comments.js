#!/usr/bin/env node
/**
 * PR 评论发布脚本。
 * 从 JSON 文件读取审查结果，发布为 GitHub PR 评论。
 *
 * 用法: node scripts/post-review-comments.js <owner> <repo> <pr-number> <results.json> [--mode incremental]
 */
import { readFileSync } from 'node:fs';
import { publishReview } from '../dist/comment-publisher.js';

const args = process.argv.slice(2);
const [owner, repo, prNumber, resultsFile] = args;

if (!owner || !repo || !prNumber || !resultsFile) {
  console.error('Usage: node scripts/post-review-comments.js <owner> <repo> <pr-number> <results.json> [--mode incremental]');
  process.exit(1);
}

const mode = args.includes('--mode') && args[args.indexOf('--mode') + 1] || 'replace';
const findings = JSON.parse(readFileSync(resultsFile, 'utf-8'));

const result = await publishReview({
  findings,
  owner,
  repo,
  prNumber: parseInt(prNumber, 10),
  token: process.env.GITHUB_TOKEN || process.env.GITHUB_TOKEN,
  mode,
});

console.log(`Published ${result.inlineCount} inline comments, summary ${result.summaryUpdated ? 'updated' : 'created'}, ${result.skipped} skipped (duplicates).`);