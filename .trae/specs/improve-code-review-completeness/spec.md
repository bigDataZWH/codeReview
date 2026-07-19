# improve-code-review-completeness Spec

> 基于 `/workspace/.trae/documents/analyze_code_review_completion_plan.md` 的改进点清单，按 TDD 流程补全 code-review 项目的 Stub 实现、修复 npm 发布阻塞、补全 CI/CD pipeline、提升代码质量与测试覆盖。

## Why

`code-review` 项目核心功能已按设计文档完成，但仍存在以下问题：
- **npm 发布阻塞**：`package.json` 缺 `files` 字段、`prepublishOnly` 脚本；`tsup` banner 注入到库入口
- **Stub 实现未补全**：`pipeline.middleware` 钩子、`pipeline.batched` processFn、`orchestrator.buildReviewDag` 节点 handler、`validation.mcpEndpoint` warning、`post-process.js` afterReview 钩子均为占位
- **CI/CD pipeline 缺失**：无项目自身 lint/test/build/release workflow
- **测试覆盖不全**：`init` 命令、真实 MCP、真实 GitHub API 未覆盖
- **代码质量问题**：YAML/glob/规则有效性逻辑重复、静默 catch、内置 FP 规则少 5 条、token 估算精度低

本 spec 通过 TDD 流程系统性补全这些差距，使项目达到可独立 npm 发布、可端到端运行的状态。

## What Changes

### P0：npm 发布阻塞修复
- 在 `package.json` 添加 `files` 字段（白名单 `dist` / `review-rules` / `opencode-config` / `scripts` / `README.md` / `LICENSE`）
- 在 `package.json` 添加 `prepublishOnly` 脚本（`npm run lint && npm run test && npm run build`）
- 在 `package.json` 添加 `publishConfig.access` 字段
- 修正 `tsup.config.ts` banner，仅注入到 cli 入口，不注入到 index 入口

### P1：CI/CD pipeline 补全
- 新建 `.github/workflows/ci.yml`：lint + test + build + coverage 上报，多 Node 版本矩阵（18/20/22）
- 新建 `.github/workflows/release.yml`：tag 推送时自动 npm publish

### P2：Stub 实现补全
- 实现 `runPipelineWithMiddleware` 的 `afterParse` / `afterFilter` 钩子（重写管道流程，在 parse 和 filter 步骤后实际触发钩子）
- 实现 `runPipelineBatched` 的 processFn（注入 rule-engine + 后处理逻辑，产出非空 findings）
- 实现 `buildReviewDag` 的 3 个节点 handler（rule-engine 调 `matchRules`；ai-reviewer 调 LLM；impact-analyzer 调 `getImpactRadius`）
- 实现 `post-process.js` 的 afterReview 钩子（调用 `correctLineLocations` / `filterFalsePositives` / `deduplicateFindings`）
- 实现 `validation.ts` 的 mcpEndpoint warning（返回 warnings 数组）

### P3：测试覆盖补全
- 补充 `tests/cli.test.ts` 的 `init` 命令测试（mock `readline/promises`）
- 新建 `tests/integration/mcp-integration.test.ts`（启动真实 `code-review-graph serve` 子进程）
- 新建 `tests/e2e/github-publish.test.ts`（手动触发，验证真实 GitHub API 发布）

### P4：代码质量优化
- 提取共用 `src/yaml-lite.ts`（合并 `feedback.ts` 与 `rule-engine.ts` 的 YAML 解析器）
- 提取共用 `src/glob.ts`（合并 `feedback.ts` 与 `file-filter.ts` 的 globToRegex）
- 统一规则有效性计算（`metrics.ts` 复用 `feedback.ts` 的 `getRuleEffectiveness`）
- 静默 catch 添加日志（cache / orchestrator / ai-reflection / state / comment-publisher / mcp-adapter）
- 补齐 5 条内置 FP 规则（`BUILTIN_FP_RULES` 从 12 条扩展到 17 条）

### P5：精度与简化实现优化
- 替换字符数/4 token 估算为基于词表的精确估算（引入 `tiktoken` 或自实现 BPE 简化版）
- 实现 LCS 文本重叠计算（替换 `computeTextOverlap` 的子串包含算法）
- 添加 `cli.ts` 的 `--execute` 标志（可选，调用 LLM 完成端到端审查）

## Impact

- **Affected specs**: `implement-ocr-system`（原构建 spec，本次为增量改进）
- **Affected code**:
  - `code-review-pkg/package.json`
  - `code-review-pkg/tsup.config.ts`
  - `code-review-pkg/.github/workflows/`（新增 ci.yml、release.yml）
  - `code-review-pkg/src/pipeline.ts`
  - `code-review-pkg/src/orchestrator.ts`
  - `code-review-pkg/src/validation.ts`
  - `code-review-pkg/src/post-processor.ts`
  - `code-review-pkg/src/prompt-builder.ts`
  - `code-review-pkg/src/token-optimizer.ts`
  - `code-review-pkg/src/cache.ts` / `state.ts` / `ai-reflection.ts` / `comment-publisher.ts` / `mcp-adapter.ts` / `file-filter.ts` / `feedback.ts` / `metrics.ts` / `rule-engine.ts`
  - `code-review-pkg/opencode-config/.opencode/plugins/post-process.js`
  - 新建 `code-review-pkg/src/yaml-lite.ts` / `src/glob.ts`
  - 新建 `code-review-pkg/tests/cli-init.test.ts` / `tests/integration/mcp-integration.test.ts` / `tests/e2e/github-publish.test.ts`
- **Breaking changes**: 无（所有改动向后兼容）

## ADDED Requirements

### Requirement: npm 发布元数据完整
The system SHALL 在 `package.json` 中提供完整的 npm 发布元数据，包括 `files` 白名单、`prepublishOnly` 脚本、`publishConfig.access`。

#### Scenario: npm pack 包含必要文件
- **WHEN** 执行 `npm pack --dry-run`
- **THEN** 输出列表包含 `dist/cli.js`、`dist/index.js`、`dist/index.d.ts`、`review-rules/`、`opencode-config/`、`README.md`、`LICENSE`
- **AND** 不包含 `src/`、`tests/`、`node_modules/`、`.github/`

#### Scenario: prepublishOnly 自动验证
- **WHEN** 执行 `npm publish`
- **THEN** 自动触发 `npm run lint && npm run test && npm run build`
- **AND** 任一步骤失败时阻止发布

### Requirement: tsup banner 仅注入 cli 入口
The system SHALL 在 `tsup.config.ts` 中配置 banner 仅作用于 cli 入口，库入口 `index.js` 不应包含 shebang 行。

#### Scenario: index.js 不含 shebang
- **WHEN** 执行 `npm run build` 后读取 `dist/index.js` 第一行
- **THEN** 第一行不是 `#!/usr/bin/env node`
- **AND** `dist/cli.js` 第一行是 `#!/usr/bin/env node`

### Requirement: 项目 CI workflow
The system SHALL 在 `.github/workflows/ci.yml` 中提供项目自身的 lint/test/build/coverage workflow，支持多 Node 版本矩阵。

#### Scenario: PR 推送触发 CI
- **WHEN** 向任意分支推送或创建 PR
- **THEN** ci.yml 在 ubuntu-latest 上以 Node 18/20/22 三个版本并行执行 `npm ci`、`npm run lint`、`npm run test -- --coverage`、`npm run build`
- **AND** 任一步骤失败时 workflow 失败

### Requirement: Release workflow
The system SHALL 在 `.github/workflows/release.yml` 中提供 tag 推送时自动 npm publish 的 workflow。

#### Scenario: tag 推送触发发布
- **WHEN** 推送 `v*.*.*` 格式的 tag
- **THEN** release.yml 执行 `npm ci`、`npm run build`、`npm publish`
- **AND** 使用 `NPM_TOKEN` secret 鉴权

### Requirement: Pipeline Middleware 钩子完整实现
The system SHALL 在 `runPipelineWithMiddleware` 中实际触发 `afterParse` 和 `afterFilter` 钩子，而不仅支持 `afterBuild`。

#### Scenario: afterParse 钩子被调用
- **WHEN** 调用 `runPipelineWithMiddleware` 并传入包含 `afterParse` 的中间件
- **THEN** `afterParse` 接收到 `parseDiff` 的输出 `FileDiff[]`
- **AND** 返回值被用于后续 `filterFiles` 步骤

#### Scenario: afterFilter 钩子被调用
- **WHEN** 调用 `runPipelineWithMiddleware` 并传入包含 `afterFilter` 的中间件
- **THEN** `afterFilter` 接收到 `filterFiles` 的输出 `FileDiff[]`
- **AND** 返回值被用于后续 `bundleFiles` 步骤

### Requirement: runPipelineBatched 产出非空 findings
The system SHALL 在 `runPipelineBatched` 中注入实际审查逻辑，processFn 调用 rule-engine + 后处理，产出非空 findings。

#### Scenario: 批次处理产出 findings
- **WHEN** 调用 `runPipelineBatched` 处理含规则匹配的 diff
- **THEN** 每批次返回的 findings 非空
- **AND** findings 经过 `correctLineLocations` 和 `filterFalsePositives` 后处理

### Requirement: buildReviewDag 节点 handler 实现
The system SHALL 在 `buildReviewDag` 中为 3 个节点（rule-engine / ai-reviewer / impact-analyzer）提供真实 handler 实现。

#### Scenario: rule-engine 节点调用 matchRules
- **WHEN** 执行 `buildReviewDag(diffs)` 并运行 `executeDag`
- **THEN** `rule-engine` 节点的 handler 调用 `matchRules` 并返回 `Finding[]`
- **AND** findings 的 `source` 字段为 `'rule'`

#### Scenario: ai-reviewer 节点调用 LLM
- **WHEN** 配置了 LLM 且 `includeAIReviewer` 为 true
- **THEN** `ai-reviewer` 节点的 handler 调用 `callLLM` 并返回 `Finding[]`
- **AND** findings 的 `source` 字段为 `'ai'`
- **AND** LLM 失败时降级返回空数组并记录 warning

#### Scenario: impact-analyzer 节点调用 getImpactRadius
- **WHEN** `includeImpactAnalyzer` 为 true
- **THEN** `impact-analyzer` 节点的 handler 调用 `getImpactRadius` 并返回 `BlastRadiusItem[]`

### Requirement: post-process.js afterReview 钩子真实调用
The system SHALL 在 `opencode-config/.opencode/plugins/post-process.js` 的 `afterReview` 钩子中真实调用 `code-review` 包的后处理函数。

#### Scenario: afterReview 调用后处理三件套
- **WHEN** AI 审查完成后触发 `afterReview` 钩子
- **THEN** 钩子依次调用 `correctLineLocations`、`filterFalsePositives`、`deduplicateFindings`
- **AND** 返回处理后的 findings

### Requirement: validation mcpEndpoint warning
The system SHALL 在 `validatePipelineConfig` 中检测到 `mcpEnabled` 但无 `mcpEndpoint` 时返回 warning。

#### Scenario: mcpEndpoint 缺失时返回 warning
- **WHEN** 调用 `validatePipelineConfig({ mcpEnabled: true, mcpEndpoint: undefined, filter: {...} })`
- **THEN** 返回值包含 warning 提示 "mcpEnabled is true but mcpEndpoint is not configured"
- **AND** warning 不影响 errors 数组（仍为合法配置）

### Requirement: init 命令测试覆盖
The system SHALL 在 `tests/cli.test.ts` 中补充 `init` 命令的测试，覆盖交互式向导流程。

#### Scenario: init 命令生成配置文件
- **WHEN** mock `readline/promises` 模拟用户输入语言选择、审查强度、安全审查开关、部署方式
- **THEN** `init` 命令调用 `generateConfig` 并写入 `opencode.jsonc` 等配置文件
- **AND** 控制台输出成功提示

### Requirement: MCP 集成测试
The system SHALL 在 `tests/integration/mcp-integration.test.ts` 中启动真实 `code-review-graph serve` 子进程，验证 JSON-RPC 通信。

#### Scenario: 真实 MCP 服务通信
- **WHEN** `code-review-graph` 二进制可用时启动子进程
- **THEN** `getReviewContext` 通过 JSON-RPC 调用成功返回 `MCPContextResult`
- **AND** 二进制不可用时测试 skip 而非失败

### Requirement: GitHub API 端到端测试
The system SHALL 在 `tests/e2e/github-publish.test.ts` 中验证 `publishReview` 真实发布到测试 PR。

#### Scenario: 真实 PR 评论发布
- **WHEN** 环境变量 `GITHUB_TEST_TOKEN` 和 `TEST_PR_NUMBER` 已设置
- **THEN** `publishReview` 成功发布 inline 评论和 summary 评论
- **AND** 环境变量未设置时测试 skip

### Requirement: 共用 YAML 解析器
The system SHALL 提取 `src/yaml-lite.ts` 作为共用最小 YAML 解析器，`feedback.ts` 和 `rule-engine.ts` 复用之。

#### Scenario: 两个模块复用同一解析器
- **WHEN** 任何模块需要解析 YAML
- **THEN** 从 `src/yaml-lite.ts` 导入 `parseMinimalYaml` 函数
- **AND** `feedback.ts` 和 `rule-engine.ts` 删除各自的本地实现

### Requirement: 共用 globToRegex
The system SHALL 提取 `src/glob.ts` 作为共用 glob 转正则工具，`feedback.ts` 和 `file-filter.ts` 复用之。

#### Scenario: 两个模块复用同一 globToRegex
- **WHEN** 任何模块需要将 glob 模式转为正则
- **THEN** 从 `src/glob.ts` 导入 `globToRegex` 函数
- **AND** `feedback.ts` 和 `file-filter.ts` 删除各自的本地实现

### Requirement: 规则有效性计算统一
The system SHALL 统一 `metrics.ts` 和 `feedback.ts` 中的规则有效性计算逻辑，避免重复。

#### Scenario: metrics 复用 feedback 的 getRuleEffectiveness
- **WHEN** `metrics.ts` 需要计算规则有效性
- **THEN** 从 `feedback.ts` 导入 `getRuleEffectiveness` 函数
- **AND** `metrics.ts` 删除 `computeRuleEffectiveness` 本地实现

### Requirement: 静默 catch 添加日志
The system SHALL 在所有静默 catch 块中添加至少 `console.warn` 日志，便于生产环境调试。

#### Scenario: 缓存写入失败时输出 warning
- **WHEN** L2DiskCache 写入文件失败
- **THEN** 控制台输出 `console.warn` 包含错误信息和缓存键
- **AND** 主流程继续执行（降级到 L1）

### Requirement: 内置 FP 规则补齐 17 条
The system SHALL 在 `BUILTIN_FP_RULES` 中补齐 5 条规则，使总数达到设计承诺的 17 条。

#### Scenario: BUILTIN_FP_RULES 长度为 17
- **WHEN** 导入 `BUILTIN_FP_RULES`
- **THEN** 数组长度为 17
- **AND** 新增 5 条规则覆盖：错误处理建议、空 catch 块、可空引用、未使用变量、过长函数

### Requirement: 精确 Token 估算
The system SHALL 使用基于词表的 token 估算替代字符数/4 启发式。

#### Scenario: token 估算误差小于 10%
- **WHEN** 估算 100 个常见代码片段的 token 数
- **THEN** 估算值与真实 token 数（通过 tiktoken 或 tokenizer 库计算）误差小于 10%
- **AND** 不引入 native 依赖（纯 JS 实现）

### Requirement: LCS 文本重叠计算
The system SHALL 在 `computeTextOverlap` 中实现真正的最长公共子串（LCS）算法。

#### Scenario: 部分重叠的 findings
- **WHEN** 两个 findings 的 message 有 50% 文本重叠
- **THEN** `computeTextOverlap` 返回 0.5（而非 0 或 1）

### Requirement: CLI 端到端审查模式
The system SHALL 在 `cli.ts` 中添加 `--execute` 标志，调用 LLM 完成端到端审查。

#### Scenario: --execute 标志触发 LLM 调用
- **WHEN** 执行 `code-review review --execute --llm-config '{"provider":"openai","apiKey":"..."}'`
- **THEN** CLI 调用 `callLLM` 处理 prompt 并输出 findings JSON
- **AND** 未提供 `--execute` 时保持原有 prompt-only 行为

## MODIFIED Requirements

### Requirement: TDD 开发流程
所有 P2-P5 的功能改进 SHALL 遵循 TDD 流程：先写测试（红）→ 实现代码（绿）→ 重构（重构）。

#### Scenario: TDD 流程验证
- **WHEN** 实现任一 P2-P5 改进点
- **THEN** 提交历史显示先有测试提交、再有实现提交
- **AND** 最终所有测试通过

## REMOVED Requirements

无。
