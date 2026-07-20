# Checklist

> 验证所有改进点是否按 spec 实现。每完成一项检查后勾选 `[x]`。

## P0: npm 发布阻塞修复

- [x] `tsup.config.ts` banner 仅注入 cli 入口，`dist/index.js` 第一行不含 `#!/usr/bin/env node`
- [x] `dist/cli.js` 第一行含 `#!/usr/bin/env node`
- [x] `package.json` 包含 `"files": ["dist", "review-rules", "opencode-config", "scripts", "README.md", "LICENSE"]`
- [x] `package.json` 包含 `"prepublishOnly": "npm run lint && npm run test && npm run build"`
- [x] `package.json` 包含 `"publishConfig": {"access": "public"}`
- [x] `npm pack --dry-run` 输出包含 `dist/cli.js`、`dist/index.js`、`dist/index.d.ts`、`review-rules/`、`opencode-config/`、`README.md`
- [x] `npm pack --dry-run` 输出不包含 `src/`、`tests/`、`node_modules/`、`.github/`

## P1: CI/CD pipeline 补全

- [x] `.github/workflows/ci.yml` 存在且触发条件为 `push` + `pull_request`
- [x] ci.yml matrix 包含 `node: [18, 20, 22]`
- [x] ci.yml 步骤包含 `npm ci` → `npm run lint` → `npm run test -- --coverage` → `npm run build`
- [x] ci.yml 包含 Codecov 上传步骤
- [x] `.github/workflows/release.yml` 存在且触发条件为 `push tags: ['v*.*.*']`
- [x] release.yml 步骤包含 `npm ci` → `npm run build` → `npm publish`
- [x] release.yml 使用 `NPM_TOKEN` secret 鉴权

## P2: Stub 实现补全

- [x] `validatePipelineConfig` 在 `mcpEnabled=true && !mcpEndpoint` 时返回 warning
- [x] `tests/validation.test.ts` 包含 mcpEndpoint warning 测试
- [x] `runPipelineWithMiddleware` 实际触发 `afterParse` 钩子
- [x] `runPipelineWithMiddleware` 实际触发 `afterFilter` 钩子
- [x] `tests/pipeline.test.ts` 包含 `afterParse` / `afterFilter` 钩子测试
- [x] `runPipelineBatched` 的 processFn 产出非空 findings
- [x] `tests/pipeline.test.ts` 或 `tests/pipeline-batched.test.ts` 包含非空 findings 测试
- [x] `buildReviewDag` 的 `rule-engine` 节点 handler 调用 `matchRules`
- [x] `buildReviewDag` 的 `ai-reviewer` 节点 handler 调用 `callLLM`
- [x] `buildReviewDag` 的 `impact-analyzer` 节点 handler 调用 `getImpactRadius`
- [x] `tests/orchestrator.test.ts` 包含 3 个节点 handler 测试
- [x] `opencode-config/.opencode/plugins/post-process.js` 的 `afterReview` 调用后处理三件套
- [x] `tests/opencode-plugin.test.ts` 包含 afterReview 钩子测试

## P3: 测试覆盖补全

- [x] `tests/cli.test.ts` 包含 `init` 命令测试（mock readline/promises）
- [x] init 测试覆盖成功场景（生成配置）和取消场景（Ctrl+C 退出码 1）
- [x] `tests/integration/mcp-integration.test.ts` 存在
- [x] MCP 集成测试在 `code-review-graph` 不可用时 skip 而非失败
- [x] MCP 集成测试在二进制可用时启动真实子进程并验证 JSON-RPC 通信
- [x] `tests/e2e/github-publish.test.ts` 存在
- [x] GitHub API 测试在 `GITHUB_TEST_TOKEN` 未设置时 skip
- [x] GitHub API 测试在环境变量可用时验证真实 PR 评论发布

## P4: 代码质量优化

- [x] `src/yaml-lite.ts` 存在并导出 `parseMinimalYaml`
- [x] `tests/yaml-lite.test.ts` 覆盖各种 YAML 场景
- [x] `rule-engine.ts` 从 `./yaml-lite.js` 导入 `parseMinimalYaml`，本地实现已删除
- [x] `feedback.ts` 从 `./yaml-lite.js` 导入 `parseMinimalYaml`，本地实现已删除
- [x] `src/glob.ts` 存在并导出 `globToRegex`
- [x] `tests/glob.test.ts` 覆盖 `*` / `**` / `?` / `{a,b}` 模式
- [x] `file-filter.ts` 从 `./glob.js` 导入 `globToRegex`，本地实现已删除
- [x] `feedback.ts` 从 `./glob.js` 导入 `globToRegex`，本地实现已删除
- [x] `metrics.ts` 从 `./feedback.js` 导入 `getRuleEffectiveness`，`computeRuleEffectiveness` 已删除
- [x] `cache.ts` L170/181/225/242/253/264 静默 catch 已添加 `console.warn`
- [x] `orchestrator.ts` L598 静默 catch 已添加 `console.warn`
- [x] `ai-reflection.ts` L110/307 静默 catch 已添加 `console.warn`
- [x] `state.ts` L157 静默 catch 已添加 `console.warn`
- [x] `comment-publisher.ts` L59-60 静默 catch 已添加 `console.warn`
- [x] `mcp-adapter.ts` L132/171/189/200 静默 catch 已添加 `console.warn`
- [x] `BUILTIN_FP_RULES` 数组长度为 17（原 12 + 新增 5）
- [x] 新增 5 条 FP 规则覆盖：错误处理建议、空 catch 块、可空引用、未使用变量、过长函数
- [x] `tests/post-processor.test.ts` 包含 5 条新规则的测试
- [x] `tests/benchmark/accuracy.test.ts` 的 filterRate 阈值已调整（如需要）

## P5: 精度与简化实现优化

- [x] `src/token-counter.ts` 存在并导出 `countTokens(text, model?)`
- [x] `tests/token-counter.test.ts` 断言估算误差小于 10%
- [x] `prompt-builder.ts` L425 的 `estimatePromptTokens` 使用新的 `countTokens`
- [x] `token-optimizer.ts` L259-262 的 `estimateTokenCount` 使用新的 `countTokens`
- [x] 不引入 native 依赖（纯 JS 实现）
- [x] `post-processor.ts` `computeTextOverlap` 实现 LCS 算法
- [x] `tests/post-processor.test.ts` 包含部分重叠场景测试（如 "hello world" vs "world hello" 返回约 0.5）
- [x] `cli.ts` 支持 `--execute` 标志
- [x] `cli.ts` 支持 `--llm-config` 参数
- [x] `tests/cli.test.ts` 包含 `--execute` 触发 LLM 调用的测试
- [x] 未提供 `--execute` 时保持原有 prompt-only 行为

## 整体验证

- [x] `npm run lint` 通过（TypeScript 严格模式无错误）
- [x] `npm run test` 全部通过（40 文件 / 1328 passed / 7 skipped / 0 failed）
- [x] `npm run test -- --coverage` 覆盖率 ≥ 90%（vitest.config.ts 门槛 90%）
- [x] `npm run build` 构建成功（dist/index.js + dist/cli.js + dist/index.d.ts）
- [x] `npm pack --dry-run` 包内容正确（31 个文件，285.8 kB）
- [x] `node dist/cli.js --help` CLI 帮助正常输出（含 --execute / --llm-config 说明）
- [x] 无新增 ESLint/TypeScript 编译错误
- [x] 无回归测试失败
