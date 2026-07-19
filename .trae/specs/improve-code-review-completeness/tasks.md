# Tasks

> 顺序：P0 → P1 → P2 → P3 → P4 → P5，每个任务遵循 TDD（红-绿-重构）。

## P0: npm 发布阻塞修复

- [x] Task 1: 修正 `tsup.config.ts` banner 仅注入 cli 入口
  - [x] SubTask 1.1: 新增测试 `tests/build/tsup-banner.test.ts`，验证 `dist/cli.js` 第一行含 shebang、`dist/index.js` 第一行不含 shebang
  - [x] SubTask 1.2: 修改 `tsup.config.ts`，使用双 entry 配置或 esbuild options 区分 banner
  - [x] SubTask 1.3: 运行 `npm run build` 验证测试通过
- [x] Task 2: 在 `package.json` 添加 `files` / `prepublishOnly` / `publishConfig`
  - [x] SubTask 2.1: 新增测试 `tests/build/npm-pack.test.ts`，使用 `npm pack --dry-run --json` 验证包内容包含 `dist/`、`review-rules/`、`opencode-config/`、`README.md`，不包含 `src/`、`tests/`
  - [x] SubTask 2.2: 修改 `package.json`，添加 `"files": ["dist", "review-rules", "opencode-config", "scripts", "README.md", "LICENSE"]`、`"prepublishOnly": "npm run lint && npm run test && npm run build"`、`"publishConfig": {"access": "public"}`
  - [x] SubTask 2.3: 运行 `npm pack --dry-run` 验证包内容

## P1: CI/CD pipeline 补全

- [x] Task 3: 新建 `.github/workflows/ci.yml`
  - [x] SubTask 3.1: workflow 触发条件 `push` + `pull_request`
  - [x] SubTask 3.2: matrix 矩阵 `node: [18, 20, 22]`，`os: [ubuntu-latest]`
  - [x] SubTask 3.3: 步骤 `actions/checkout@v4` → `actions/setup-node@v4` → `npm ci` → `npm run lint` → `npm run test -- --coverage` → `npm run build`
  - [x] SubTask 3.4: 上传 coverage 到 Codecov（使用 `codecov/codecov-action@v4`）
- [x] Task 4: 新建 `.github/workflows/release.yml`
  - [x] SubTask 4.1: 触发条件 `push tags: ['v*.*.*']`
  - [x] SubTask 4.2: 步骤 `actions/checkout@v4` → `actions/setup-node@v4` (node 20) → `npm ci` → `npm run build` → `npm publish`（使用 `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`）

## P2: Stub 实现补全（TDD）

- [x] Task 5: 实现 `validation.ts` 的 mcpEndpoint warning
  - [x] SubTask 5.1: 在 `tests/validation.test.ts` 新增测试，断言 `validatePipelineConfig({mcpEnabled:true, filter:{}})` 返回的 warnings 数组包含 mcpEndpoint 提示
  - [x] SubTask 5.2: 修改 `validatePipelineConfig` 返回 `{errors, warnings}` 或新增 `validatePipelineConfigWithWarnings` 函数（保持向后兼容）
  - [x] SubTask 5.3: 运行测试验证通过
- [x] Task 6: 实现 `runPipelineWithMiddleware` 的 `afterParse` / `afterFilter` 钩子
  - [x] SubTask 6.1: 在 `tests/pipeline.test.ts` 新增测试，断言传入 `afterParse` 钩子时被调用且接收 `FileDiff[]`、返回值用于 filter 步骤
  - [x] SubTask 6.2: 新增测试，断言传入 `afterFilter` 钩子时被调用且接收过滤后的 `FileDiff[]`、返回值用于 bundle 步骤
  - [x] SubTask 6.3: 重写 `runPipelineWithMiddleware` 内联 `runPipeline` 流程，在 parse 和 filter 步骤后插入钩子调用
  - [x] SubTask 6.4: 运行测试验证通过，并确认 `runPipeline` 原有行为不变
- [x] Task 7: 实现 `runPipelineBatched` 的 processFn
  - [x] SubTask 7.1: 在 `tests/pipeline.test.ts` 或新建 `tests/pipeline-batched.test.ts` 新增测试，断言 `runPipelineBatched` 处理含规则匹配的 diff 时返回非空 findings
  - [x] SubTask 7.2: 修改 `runPipelineBatched`，processFn 内调用 `matchRules` + `correctLineLocations` + `filterFalsePositives`
  - [x] SubTask 7.3: 运行测试验证通过
- [x] Task 8: 实现 `buildReviewDag` 的 3 个节点 handler
  - [x] SubTask 8.1: 在 `tests/orchestrator.test.ts` 新增测试，断言 `rule-engine` 节点 handler 调用 `matchRules` 返回 source='rule' 的 findings
  - [x] SubTask 8.2: 新增测试，断言 `ai-reviewer` 节点 handler 在配置 LLM 时调用 `callLLM` 返回 source='ai' 的 findings，LLM 失败时降级返回空数组
  - [x] SubTask 8.3: 新增测试，断言 `impact-analyzer` 节点 handler 调用 `getImpactRadius` 返回 `BlastRadiusItem[]`
  - [x] SubTask 8.4: 修改 `buildReviewDag`，注入真实 handler（通过 options 参数接收 deps：`{ matchRulesFn, callLLMFn, getImpactRadiusFn }`）
  - [x] SubTask 8.5: 运行测试验证通过
- [x] Task 9: 实现 `post-process.js` 的 afterReview 钩子
  - [x] SubTask 9.1: 新增测试 `tests/opencode-plugin.test.ts`，断言 afterReview 钩子调用 `correctLineLocations` → `filterFalsePositives` → `deduplicateFindings`
  - [x] SubTask 9.2: 修改 `opencode-config/.opencode/plugins/post-process.js`，使用 dynamic import 调用 `code-review` 包的后处理函数
  - [x] SubTask 9.3: 运行测试验证通过

## P3: 测试覆盖补全

- [x] Task 10: 补充 `init` 命令测试
  - [x] SubTask 10.1: 在 `tests/cli.test.ts` 新增 `describe('init command')`，mock `readline/promises` 模拟用户输入
  - [x] SubTask 10.2: 测试场景：选择 TypeScript + standard + enable security + github workflow → 调用 `generateConfig` 并写文件
  - [x] SubTask 10.3: 测试场景：用户取消（Ctrl+C）→ 退出码 1
  - [x] SubTask 10.4: 运行测试验证通过
- [x] Task 11: 新建 `tests/integration/mcp-integration.test.ts`
  - [x] SubTask 11.1: 检测 `code-review-graph` 二进制是否可用，不可用时 `it.skip`
  - [x] SubTask 11.2: 启动 `code-review-graph serve` 子进程，建立 JSON-RPC 连接
  - [x] SubTask 11.3: 调用 `getReviewContext` 验证返回 `MCPContextResult` 结构
  - [x] SubTask 11.4: 测试结束后清理子进程
- [x] Task 12: 新建 `tests/e2e/github-publish.test.ts`
  - [x] SubTask 12.1: 检测 `GITHUB_TEST_TOKEN` 和 `TEST_PR_NUMBER` 环境变量，未设置时 `it.skip`
  - [x] SubTask 12.2: 调用 `publishReview` 发布测试 findings 到测试 PR
  - [x] SubTask 12.3: 通过 GitHub API 验证评论已发布
  - [x] SubTask 12.4: 清理测试评论（避免污染 PR）

## P4: 代码质量优化

- [x] Task 13: 提取共用 `src/yaml-lite.ts`
  - [x] SubTask 13.1: 新建 `src/yaml-lite.ts`，导出 `parseMinimalYaml` 函数
  - [x] SubTask 13.2: 新增测试 `tests/yaml-lite.test.ts` 覆盖各种 YAML 场景
  - [x] SubTask 13.3: 修改 `rule-engine.ts` 删除本地 `parseMinimalYaml`，从 `./yaml-lite.js` 导入
  - [x] SubTask 13.4: 修改 `feedback.ts` 删除本地 YAML 解析器，从 `./yaml-lite.js` 导入
  - [x] SubTask 13.5: 运行全量测试验证行为不变
- [x] Task 14: 提取共用 `src/glob.ts`
  - [x] SubTask 14.1: 新建 `src/glob.ts`，导出 `globToRegex` 函数
  - [x] SubTask 14.2: 新增测试 `tests/glob.test.ts` 覆盖 `*` / `**` / `?` / `{a,b}` 模式
  - [x] SubTask 14.3: 修改 `file-filter.ts` 删除本地 `globToRegex`，从 `./glob.js` 导入
  - [x] SubTask 14.4: 修改 `feedback.ts` 删除本地 `globToRegex`，从 `./glob.js` 导入
  - [x] SubTask 14.5: 运行全量测试验证行为不变
- [x] Task 15: 统一规则有效性计算
  - [x] SubTask 15.1: 在 `tests/metrics.test.ts` 添加测试，断言 `metrics.computeRuleEffectiveness` 与 `feedback.getRuleEffectiveness` 行为一致
  - [x] SubTask 15.2: 修改 `metrics.ts` 删除 `computeRuleEffectiveness`，从 `./feedback.js` 导入 `getRuleEffectiveness`
  - [x] SubTask 15.3: 运行测试验证通过
- [x] Task 16: 静默 catch 添加日志
  - [x] SubTask 16.1: 在 `tests/cache.test.ts` 新增测试，spy `console.warn`，断言 L2 写入失败时调用 `console.warn`
  - [x] SubTask 16.2: 修改 `cache.ts` L170/181/225/242/253/264 添加 `console.warn` 日志
  - [x] SubTask 16.3: 修改 `orchestrator.ts` L598、`ai-reflection.ts` L110/307、`state.ts` L157、`comment-publisher.ts` L59-60、`mcp-adapter.ts` L132/171/189/200 添加 `console.warn`
  - [x] SubTask 16.4: 运行全量测试验证通过
- [x] Task 17: 补齐 5 条内置 FP 规则
  - [x] SubTask 17.1: 在 `tests/post-processor.test.ts` 新增 5 个测试，断言新增规则能正确过滤对应场景（错误处理建议 / 空 catch 块 / 可空引用 / 未使用变量 / 过长函数）
  - [x] SubTask 17.2: 修改 `post-processor.ts` `BUILTIN_FP_RULES` 添加 5 条规则，使总数达 17
  - [x] SubTask 17.3: 更新 `tests/benchmark/accuracy.test.ts` 的 filterRate 断言阈值（如需要）
  - [x] SubTask 17.4: 运行测试验证通过

## P5: 精度与简化实现优化

- [x] Task 18: 精确 Token 估算
  - [x] SubTask 18.1: 调研纯 JS 的 BPE 简化实现或 tiktoken-js，避免 native 依赖
  - [x] SubTask 18.2: 新建 `src/token-counter.ts`，实现 `countTokens(text, model?)` 函数
  - [x] SubTask 18.3: 新增测试 `tests/token-counter.test.ts`，断言估算误差小于 10%
  - [x] SubTask 18.4: 修改 `prompt-builder.ts` L425 和 `token-optimizer.ts` L259-262 使用新的 `countTokens`
  - [x] SubTask 18.5: 运行测试验证通过
- [x] Task 19: LCS 文本重叠计算
  - [x] SubTask 19.1: 在 `tests/post-processor.test.ts` 新增测试，断言 `computeTextOverlap("hello world", "world hello")` 返回约 0.5（部分重叠）
  - [x] SubTask 19.2: 修改 `post-processor.ts` L381 `computeTextOverlap`，实现基于 LCS 的相似度算法（按词或字符切分）
  - [x] SubTask 19.3: 运行测试验证通过
- [x] Task 20: CLI 端到端审查模式（`--execute` 标志）
  - [x] SubTask 20.1: 在 `tests/cli.test.ts` 新增测试，断言 `--execute` 标志触发 `callLLM` 调用并输出 findings JSON
  - [x] SubTask 20.2: 修改 `cli.ts` 添加 `--execute` 和 `--llm-config` 参数解析
  - [x] SubTask 20.3: 未提供 `--execute` 时保持原有 prompt-only 行为
  - [x] SubTask 20.4: 运行测试验证通过

## Task Dependencies

- Task 2 依赖 Task 1（先修 tsup banner，再改 package.json files）
- Task 5 独立（最简单的 stub 补全，先做）
- Task 6、7 独立（pipeline 两个 stub）
- Task 8 独立（orchestrator DAG handler）
- Task 9 依赖 Task 8（post-process.js 调用后处理函数，与 DAG handler 协同）
- Task 10、11、12 独立（测试补全，可并行）
- Task 13、14、15 独立（代码去重，可并行）
- Task 16 独立（日志补全）
- Task 17 独立（FP 规则补齐）
- Task 18、19、20 独立（精度优化，可并行）

## Parallelizable Work

可并行的任务组：
- 组 A：Task 1 + Task 2（P0 配置修复）
- 组 B：Task 5 + Task 6 + Task 7 + Task 8（P2 stub 补全，4 个独立 stub）
- 组 C：Task 10 + Task 11 + Task 12（P3 测试补全）
- 组 D：Task 13 + Task 14 + Task 15 + Task 16 + Task 17（P4 代码质量）
- 组 E：Task 18 + Task 19 + Task 20（P5 精度优化）

依赖序列：
- Task 1 → Task 2 → Task 4（release workflow 依赖 npm 发布配置就绪）
- Task 8 → Task 9（post-process 依赖 DAG handler 设计）
