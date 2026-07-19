#!/usr/bin/env node
/**
 * 误报过滤脚本。
 * 从 stdin 读取 findings JSON，应用误报过滤规则后输出到 stdout。
 *
 * 用法: cat findings.json | node scripts/false-positive-filters.js [--custom-rules rules.json]
 */
import { filterFalsePositives, BUILTIN_FP_RULES } from '../dist/post-processor.js';

const args = process.argv.slice(2);
let customRules = [];

if (args.includes('--custom-rules')) {
  const idx = args.indexOf('--custom-rules');
  const rulesFile = args[idx + 1];
  if (rulesFile) {
    const { readFileSync } = await import('node:fs');
    const rules = JSON.parse(readFileSync(rulesFile, 'utf-8'));
    customRules = rules.map(r => ({
      id: r.id,
      name: r.name,
      match: (f) => new RegExp(r.pattern, r.flags || 'i').test(f.message),
    }));
  }
}

const input = await new Promise((resolve) => {
  let data = '';
  process.stdin.on('data', chunk => data += chunk);
  process.stdin.on('end', () => resolve(data));
});

const findings = JSON.parse(input);
const filtered = filterFalsePositives(findings, customRules.length > 0 ? customRules : undefined);

console.log(JSON.stringify(filtered, null, 2));
console.error(`Filtered: ${findings.length - filtered.length} / ${findings.length} findings removed as false positives`);