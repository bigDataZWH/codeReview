#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const rootDir = path.resolve(__dirname, '..');
const sourceFile = path.join(rootDir, 'src', 'post-processor.ts');
const outputFile = path.join(rootDir, 'opencode-config', '.opencode', 'rules', 'false-positive-filters.md');

function extractBuiltinRules(fileContent) {
  const match = fileContent.match(/export const BUILTIN_FP_RULES: FalsePositiveRule\[\] = (\[[\s\S]*?\]);/);
  if (!match) {
    throw new Error('BUILTIN_FP_RULES not found in post-processor.ts');
  }
  return match[1];
}

function parseRules(rulesCode) {
  const rules = [];
  const ruleRegex = /\{\s*id:\s*['"]([^'"]+)['"],\s*name:\s*['"]([^'"]+)['"],\s*match:\s*\((f)\)\s*=>\s*([\s\S]*?)\s*\}/g;
  
  let match;
  while ((match = ruleRegex.exec(rulesCode)) !== null) {
    rules.push({
      id: match[1],
      name: match[2],
      paramName: match[3],
      matchCode: match[4].trim()
    });
  }
  
  return rules;
}

function analyzeMatchCode(code, paramName) {
  const conditions = [];
  
  const confidenceReturnFalse = code.includes(`if (${paramName}.confidence >= HIGH_CONFIDENCE_THRESHOLD) return false`);
  
  if (code.includes(`${paramName}.category`)) {
    const catMatch = code.match(new RegExp(`${paramName}\\.category\\s*===\\s*['"]([^'"]+)['"]`));
    if (catMatch) {
      conditions.push(`category == "${catMatch[1]}"`);
    }
  }
  
  if (code.includes(`${paramName}.severity`)) {
    const sevEqualsMatch = code.match(new RegExp(`${paramName}\\.severity\\s*===\\s*['"]([^'"]+)['"]`));
    if (sevEqualsMatch) {
      conditions.push(`severity == "${sevEqualsMatch[1]}"`);
    }
    
    const sevNotMatch = code.match(new RegExp(`${paramName}\\.severity\\s*!==\\s*['"]([^'"]+)['"]\\s*&&\\s*${paramName}\\.severity\\s*!==\\s*['"]([^'"]+)['"]`));
    if (sevNotMatch) {
      conditions.push(`severity in ["${sevNotMatch[1]}", "${sevNotMatch[2]}"]`);
    }
  }
  
  if (code.includes(`${paramName}.confidence`)) {
    if (code.includes(`${paramName}.confidence < HIGH_CONFIDENCE_THRESHOLD`)) {
      conditions.push(`confidence < 0.85`);
    }
    if (code.includes(`${paramName}.confidence >= HIGH_CONFIDENCE_THRESHOLD`)) {
      if (confidenceReturnFalse) {
        conditions.push(`confidence < 0.85`);
      } else {
        conditions.push(`confidence >= 0.85`);
      }
    }
  }
  
  if (code.includes(`${paramName}.file`)) {
    if (code.includes(`!isCFile(${paramName}.file)`)) {
      conditions.push(`file 不是 C/C++ 文件`);
    } else if (code.includes(`isCFile(${paramName}.file)`)) {
      conditions.push(`file 是 C/C++ 文件`);
    }
    if (code.includes(`isGeneratedFile(${paramName}.file)`)) {
      conditions.push(`file 是生成文件`);
    }
    if (code.includes(`isTestFile(${paramName}.file)`)) {
      conditions.push(`file 是测试文件`);
    }
  }
  
  if (code.includes(`${paramName}.message`)) {
    const msgLower = code.match(new RegExp(`${paramName}\\.message\\.toLowerCase\\(\\)`));
    if (msgLower) {
      const includesPatterns = [];
      const msgRegex = /msg\.includes\(['"]([^'"]+)['"]\)/g;
      let msgMatch;
      while ((msgMatch = msgRegex.exec(code)) !== null) {
        includesPatterns.push(msgMatch[1]);
      }
      if (includesPatterns.length > 0) {
        conditions.push(`message 包含: ${includesPatterns.join('、')}`);
      }
    }
  }
  
  return conditions;
}

function generateMarkdown(rules) {
  let md = `# 误报硬排除规则

本文件由 \`scripts/sync-rules-md.js\` 自动生成，与 \`src/post-processor.ts\` 中的 \`BUILTIN_FP_RULES\` 保持同步。

共定义 ${rules.length} 条硬排除规则。当 finding 满足规则条件且 \`confidence < 0.85\` 时，应直接标记为误报并跳过。

## 高置信度保护
所有规则仅在 \`confidence < 0.85\` 时生效；高于该阈值的 finding 一律保留，避免误杀真实缺陷。

---

## 规则列表

`;

  rules.forEach((rule, index) => {
    const conditions = analyzeMatchCode(rule.matchCode, rule.paramName);
    
    md += `### ${index + 1}. ${rule.name}
- **ID**: ${rule.id}
`;
    
    if (conditions.length > 0) {
      md += `- **匹配条件**: ${conditions.join('，')}
`;
    }
    
    md += '\n';
  });
  
  md += `---

## 实现参考

上述规则在 \`src/post-processor.ts\` 的 \`filterFalsePositives\` 中以 \`FalsePositiveRule\` 形式实现；
高置信度保护通过 \`HIGH_CONFIDENCE_THRESHOLD = 0.85\` 实现。
`;
  
  return md;
}

function main() {
  try {
    const fileContent = fs.readFileSync(sourceFile, 'utf-8');
    const rulesCode = extractBuiltinRules(fileContent);
    const rules = parseRules(rulesCode);
    
    if (rules.length === 0) {
      console.error('No rules found in BUILTIN_FP_RULES');
      process.exit(1);
    }
    
    const markdown = generateMarkdown(rules);
    
    fs.writeFileSync(outputFile, markdown, 'utf-8');
    
    console.log(`Generated ${outputFile} with ${rules.length} rules`);
  } catch (error) {
    console.error('Error generating rules markdown:', error.message);
    process.exit(1);
  }
}

main();
