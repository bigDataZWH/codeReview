// src/init-wizard.ts — 迭代 9：初始化向导
//
// 设计目标：
// - 根据 WizardOptions 生成完整的项目配置文件集合
// - 输出文件以"路径 → 内容"映射形式返回，调用方负责写盘
// - 支持：项目语言、审查强度、安全审查开关、图谱开关、默认模型、部署方式
//
// 设计取舍：
// - 不直接调用 fs，便于在测试和 CLI 中复用
// - 模板使用模板字符串拼接，避免引入 handlebars 等模板引擎依赖
// - 生成的 opencode.jsonc 必须是有效 JSONC（移除注释后能 JSON.parse）

/** 支持的项目语言 */
export type ProjectLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'cpp'
  | 'c';

/** 审查强度 */
export type ReviewStrength = 'lenient' | 'standard' | 'strict';

/** 部署方式 */
export type DeploymentMode = 'cli' | 'github-actions' | 'gitlab-ci';

/** 向导选项 */
export interface WizardOptions {
  /** 项目语言（必填） */
  language: ProjectLanguage;
  /** 审查强度（默认 standard） */
  reviewStrength?: ReviewStrength;
  /** 是否启用安全审查（默认 true） */
  securityReview?: boolean;
  /** 是否启用图谱（默认 false） */
  graphEnabled?: boolean;
  /** 默认模型（可选，如 "anthropic/claude-sonnet-4-5"） */
  defaultModel?: string;
  /** 部署方式（默认 cli） */
  deployment?: DeploymentMode;
}

/** 生成的配置集合 */
export interface GeneratedConfig {
  /** 项目语言 */
  language: ProjectLanguage;
  /** 审查强度 */
  reviewStrength: ReviewStrength;
  /** 安全审查开关 */
  securityReview: boolean;
  /** 图谱开关 */
  graphEnabled: boolean;
  /** 默认模型 */
  defaultModel?: string;
  /** 部署方式 */
  deployment: DeploymentMode;
  /** 文件路径 → 文件内容 */
  files: Record<string, string>;
}

/** 各语言的默认模型 */
const DEFAULT_MODELS: Record<ProjectLanguage, string> = {
  typescript: 'anthropic/claude-sonnet-4-5',
  javascript: 'anthropic/claude-sonnet-4-5',
  python: 'anthropic/claude-sonnet-4-5',
  go: 'anthropic/claude-sonnet-4-5',
  rust: 'anthropic/claude-sonnet-4-5',
  java: 'anthropic/claude-sonnet-4-5',
  cpp: 'anthropic/claude-sonnet-4-5',
  c: 'anthropic/claude-sonnet-4-5',
};

/** 各语言的审查提示 */
const LANGUAGE_TIPS: Record<ProjectLanguage, string> = {
  typescript: 'TypeScript: 关注类型安全、避免 any、检查泛型约束与异步错误处理。',
  javascript: 'JavaScript: 关注运行时安全、undefined/null 处理、隐式类型转换。',
  python: 'Python: 关注类型提示、可变默认参数、资源释放、异步并发安全。',
  go: 'Go: 关注 err != nil 处理、goroutine 泄漏、并发安全、context 取消。',
  rust: 'Rust: 关注 unsafe 使用、生命周期、不必要的 clone、Send/Sync 约束。',
  java: 'Java: 关注空指针、资源泄漏（try-with-resources）、异常处理完整。',
  cpp: 'C++: 关注内存管理（RAII、智能指针）、未定义行为、并发原语正确性。',
  c: 'C: 关注缓冲区溢出、内存泄漏、null 终止字符串、整数溢出。',
};

/** 各语言对应的文件后缀（用于规则文件引用） */
const LANGUAGE_SUFFIX: Record<ProjectLanguage, string> = {
  typescript: 'ts',
  javascript: 'js',
  python: 'py',
  go: 'go',
  rust: 'rs',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
};

/** 审查强度对应的关键词 */
const STRENGTH_KEYWORDS: Record<ReviewStrength, string> = {
  lenient: '宽松模式：仅报告 critical/high 级别问题，关注明显缺陷，避免噪声。',
  standard: '标准模式：报告 medium 及以上问题，平衡精度与召回。',
  strict: '严格模式：报告所有级别问题（含 info），关注代码风格、可维护性与潜在风险。',
};

/**
 * 生成项目初始化配置文件集合。
 *
 * @param options 向导选项
 * @returns GeneratedConfig，包含所有生成的文件路径与内容
 */
export function generateConfig(options: WizardOptions): GeneratedConfig {
  const language = options.language;
  const reviewStrength: ReviewStrength = options.reviewStrength ?? 'standard';
  const securityReview = options.securityReview ?? true;
  const graphEnabled = options.graphEnabled ?? false;
  const defaultModel = options.defaultModel ?? DEFAULT_MODELS[language];
  const deployment: DeploymentMode = options.deployment ?? 'cli';

  const files: Record<string, string> = {};

  // 1. opencode.jsonc 主配置
  files['opencode.jsonc'] = generateOpenCodeJsonc({
    language,
    reviewStrength,
    securityReview,
    graphEnabled,
    defaultModel,
  });

  // 2. Agent 定义
  files['.opencode/agents/code-reviewer.md'] = generateCodeReviewerAgent(language, reviewStrength, defaultModel);
  if (securityReview) {
    files['.opencode/agents/security-reviewer.md'] = generateSecurityReviewerAgent(defaultModel);
  }
  files['.opencode/agents/impact-analyzer.md'] = generateImpactAnalyzerAgent(defaultModel);
  files['.opencode/agents/reflector.md'] = generateReflectorAgent(defaultModel);

  // 3. 命令
  files['.opencode/commands/review.md'] = generateReviewCommand();
  if (securityReview) {
    files['.opencode/commands/security-review.md'] = generateSecurityReviewCommand();
  }
  files['.opencode/commands/scan.md'] = generateScanCommand();
  files['.opencode/commands/review-pr.md'] = generateReviewPrCommand();

  // 4. review-rules 规则文件
  files['review-rules/security.json'] = generateSecurityRules(language);
  files['review-rules/quality.json'] = generateQualityRules(language);

  // 5. GitHub workflow（仅 github-actions 部署）
  if (deployment === 'github-actions') {
    files['.github/workflows/code-review.yml'] = generateGithubWorkflow(securityReview);
  }

  return {
    language,
    reviewStrength,
    securityReview,
    graphEnabled,
    defaultModel,
    deployment,
    files,
  };
}

// ── 模板生成函数 ──

/** 生成 opencode.jsonc 主配置 */
function generateOpenCodeJsonc(opts: {
  language: ProjectLanguage;
  reviewStrength: ReviewStrength;
  securityReview: boolean;
  graphEnabled: boolean;
  defaultModel: string;
}): string {
  const langTip = LANGUAGE_TIPS[opts.language];
  const strengthKeyword = STRENGTH_KEYWORDS[opts.reviewStrength];
  const codeReviewerPrompt = `You are a senior code reviewer. Language: ${opts.language}. ${langTip} ${strengthKeyword} Be specific, actionable, and reference exact line numbers.`;
  const securityPrompt = opts.securityReview
    ? `You are a security audit expert. Follow three-phase methodology: 1) Repository context research, 2) Comparative diff analysis, 3) Vulnerability assessment. Focus on injection, auth, crypto, data exposure.`
    : '';

  const agents: string[] = [
    `    "code-reviewer": {
      "description": "通用代码审查 Agent（${opts.language}）",
      "model": "${opts.defaultModel}",
      "prompt": ${JSON.stringify(codeReviewerPrompt)},
      "tools": { "write": false, "edit": false }
    }`,
  ];

  if (opts.securityReview) {
    agents.push(`    "security-reviewer": {
      "description": "安全专项审查 Agent",
      "model": "${opts.defaultModel}",
      "prompt": ${JSON.stringify(securityPrompt)},
      "tools": { "write": false, "edit": false }
    }`);
  }
  agents.push(`    "impact-analyzer": {
      "description": "变更影响范围分析 Agent",
      "model": "${opts.defaultModel}",
      "prompt": "Analyze the blast radius of code changes. Identify callers, callees, and tests affected. Provide risk score 0-10.",
      "tools": { "write": false, "edit": false }
    }`);
  agents.push(`    "reflector": {
      "description": "反思与置信度评估 Agent",
      "model": "${opts.defaultModel}",
      "prompt": "Evaluate aggregated findings for confidence. Apply false-positive heuristics. Output JSON: [{id, confidence}].",
      "tools": { "write": false, "edit": false }
    }`);

  const mcpSection = `"mcp": {
    "code-review-graph": {
      "type": "local",
      "command": ["code-review-graph", "serve"],
      "enabled": ${opts.graphEnabled}
    }
  }`;

  return `{
  "$schema": "https://opencode.ai/config.json",
  // 项目语言: ${opts.language}
  // 审查强度: ${opts.reviewStrength}
  // 安全审查: ${opts.securityReview}
  // 图谱: ${opts.graphEnabled}
  "agent": {
${agents.join(',\n')}
  },
  ${mcpSection}
}
`;
}

/** 生成 code-reviewer agent 文件 */
function generateCodeReviewerAgent(language: ProjectLanguage, strength: ReviewStrength, model: string): string {
  const tip = LANGUAGE_TIPS[language];
  const strengthKeyword = STRENGTH_KEYWORDS[strength];
  return `---
description: 通用代码审查 Agent（${language}）
model: ${model}
tools:
  write: false
  edit: false
---

You are a senior code reviewer with 15+ years of experience.

## 语言提示
${tip}

## 审查强度
${strengthKeyword}

## 审查范围
- **Security**: injection, auth defects, sensitive data exposure
- **Logic**: edge cases, null handling, error handling, race conditions
- **Performance**: N+1 queries, unnecessary computation, memory leaks
- **Maintainability**: naming clarity, function complexity, code duplication, missing types

Be specific and actionable. Always reference exact file paths and line numbers.
Output findings in structured format with severity (critical/high/medium/low) and suggestion.
`;
}

/** 生成 security-reviewer agent 文件 */
function generateSecurityReviewerAgent(model: string): string {
  return `---
description: 安全专项审查 Agent
model: ${model}
tools:
  write: false
  edit: false
---

You are a security audit expert following a three-phase analysis methodology:

1. **Repository Context Research**: Understand project architecture, auth mechanisms, data flow
2. **Comparative Diff Analysis**: Analyze diffs file by file, focus on security-sensitive changes
3. **Vulnerability Assessment**: Evaluate severity and exploitability of each finding

Security categories: injection (SQL/NoSQL/Command/XSS/SSRF/LDAP), auth/authorization, crypto misuse, data exposure, insecure deserialization, path traversal, dependency vulnerabilities, config security.

Output JSON array with: file, line, severity, category, description, recommendation, confidence.
`;
}

/** 生成 impact-analyzer agent 文件 */
function generateImpactAnalyzerAgent(model: string): string {
  return `---
description: 变更影响范围分析 Agent
model: ${model}
tools:
  write: false
  edit: false
---

Analyze the blast radius of code changes. Identify all callers, callees, and test files affected by the changes. Provide a risk score from 0-10.
`;
}

/** 生成 reflector agent 文件 */
function generateReflectorAgent(model: string): string {
  return `---
description: 反思与置信度评估 Agent
model: ${model}
tools:
  write: false
  edit: false
---

You are a code review quality evaluator. Perform unified confidence assessment on aggregated findings. Apply false-positive heuristics (DOS/rate-limit without exploit, memory-safety in non-C/C++, open redirect, @generated files, low-severity security in tests, TODO/FIXME, log-level suggestions). Respond with a JSON array only: [{"id": 0, "confidence": <0..1>}].
`;
}

/** 生成 review 命令文件 */
function generateReviewCommand(): string {
  return `# /review

对当前分支变更执行代码审查。

## 步骤
1. 解析 git diff
2. 过滤文件并打包
3. 调用 code-reviewer agent
4. 调用 impact-analyzer agent（变更较大时）
5. 调用 reflector agent 做置信度评估
6. 输出结构化 findings
`;
}

/** 生成 security-review 命令文件 */
function generateSecurityReviewCommand(): string {
  return `# /security-review

对当前分支变更执行安全专项审查（三层方法论）。

## 步骤
1. 仓库上下文研究
2. diff 对比分析
3. 漏洞评估
4. 输出安全 findings
`;
}

/** 生成 scan 命令文件 */
function generateScanCommand(): string {
  return `# /scan

全量扫描指定路径下的代码，输出所有发现的问题。
`;
}

/** 生成 review-pr 命令文件 */
function generateReviewPrCommand(): string {
  return `# /review-pr <pr-number>

对指定 PR 执行完整审查流程。
`;
}

/** 生成安全规则 JSON */
function generateSecurityRules(language: ProjectLanguage): string {
  const rules = [
    {
      id: 'sql-injection',
      name: 'SQL 注入检测',
      severity: 'critical',
      category: 'security',
      language: [LANGUAGE_SUFFIX[language]],
      patterns: [
        {
          type: 'regex',
          pattern: 'query\\s*\\(.*\\+.*\\)',
          message: '检测到字符串拼接构造 SQL，可能存在 SQL 注入风险',
          flags: 'i',
        },
      ],
    },
    {
      id: 'xss',
      name: 'XSS 检测',
      severity: 'high',
      category: 'security',
      language: [LANGUAGE_SUFFIX[language]],
      patterns: [
        {
          type: 'regex',
          pattern: 'innerHTML\\s*=',
          message: '检测到 innerHTML 赋值，可能存在 XSS 风险',
        },
      ],
    },
    {
      id: 'hardcoded-secret',
      name: '硬编码密钥检测',
      severity: 'high',
      category: 'security',
      patterns: [
        {
          type: 'regex',
          pattern: '(api[_-]?key|secret|password|token)\\s*[:=]\\s*["\'][^"\']{8,}["\']',
          message: '检测到硬编码的密钥或凭证',
          flags: 'i',
        },
      ],
    },
  ];
  return JSON.stringify({ rules }, null, 2);
}

/** 生成质量规则 JSON */
function generateQualityRules(language: ProjectLanguage): string {
  const rules = [
    {
      id: 'no-console',
      name: '禁止 console',
      severity: 'low',
      category: 'quality',
      language: [LANGUAGE_SUFFIX[language]],
      patterns: [
        {
          type: 'regex',
          pattern: 'console\\.(log|debug|info)\\(',
          message: '不应在生产代码中使用 console.log',
        },
      ],
    },
    {
      id: 'no-todo',
      name: 'TODO/FIXME 检测',
      severity: 'info',
      category: 'quality',
      patterns: [
        {
          type: 'regex',
          pattern: '\\b(TODO|FIXME|XXX|HACK)\\b',
          message: '检测到 TODO/FIXME 注释，建议在发布前清理',
        },
      ],
    },
  ];
  return JSON.stringify({ rules }, null, 2);
}

/** 生成 GitHub workflow */
function generateGithubWorkflow(securityReview: boolean): string {
  const steps = [
    `name: Code Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - name: Run code review
        run: npx opencode-code-review analyze \`\${{ github.event.pull_request.diff_url }}\``,
  ];
  if (securityReview) {
    steps.push(`      - name: Run security review
        run: npx opencode-code-review security-review \`\${{ github.event.pull_request.diff_url }}\``);
  }
  return steps.join('\n') + '\n';
}
