# Tasks

> 顺序：P0 → P1 → P2 → P3 → P4 → P5 → P6，每个任务遵循 TDD（红-绿-重构）。

## P0: 功能缺口补齐

- [ ] Task 1: 新增 `/impact` 命令
  - [ ] SubTask 1.1: 新建 `tests/opencode/commands/impact.test.ts`，验证命令调用 `git diff` 和 impact-analyzer agent
  - [ ] SubTask 1.2: 创建 `.opencode/commands/impact.md`，使用 agent: impact-analyzer，调用 `git diff main...HEAD`
  - [ ] SubTask 1.3: 运行测试验证通过

- [ ] Task 2: 新增 `/reflect` 命令
  - [ ] SubTask 2.1: 新建 `tests/opencode/commands/reflect.test.ts`，验证命令接收 findings JSON 并返回置信度数组
  - [ ] SubTask 2.2: 创建 `.opencode/commands/reflect.md`，使用 agent: reflector，接收 `$ARGUMENTS` 作为 findings JSON
  - [ ] SubTask 2.3: 运行测试验证通过

- [ ] Task 3: 完善 `/review-pr` 的发布步骤
  - [ ] SubTask 3.1: 在 `tests/opencode/commands/review-pr.test.ts` 新增测试，断言发布步骤调用 `publishReview`
  - [ ] SubTask 3.2: 修改 `review-pr.md`，在审查完成后追加调用 `code-review publish` 发布到 PR
  - [ ] SubTask 3.3: 运行测试验证通过

## P1: 一致性修复

- [ ] Task 4: 统一命令输出格式为 Finding JSON Schema
  - [ ] SubTask 4.1: 在 `tests/opencode/commands/format.test.ts` 新增测试，断言所有命令输出字段一致
  - [ ] SubTask 4.2: 修改 `review.md`、`security-review.md`、`scan.md`、`review-pr.md` 的输出格式
  - [ ] SubTask 4.3: 更新 `post-process.js` 适配新格式
  - [ ] SubTask 4.4: 运行测试验证通过

- [ ] Task 5: 改进 `/scan` 命令的文件发现
  - [ ] SubTask 5.1: 在 `tests/opencode/commands/scan.test.ts` 新增测试，验证生成文件排除和语言识别
  - [ ] SubTask 5.2: 修改 `scan.md`，使用 `excludeGeneratedFiles` 和 `detectLanguage`
  - [ ] SubTask 5.3: 运行测试验证通过

- [ ] Task 6: 为 `/scan` 添加参数支持
  - [ ] SubTask 6.1: 新增测试验证 `--limit` 和 `--exclude` 参数解析
  - [ ] SubTask 6.2: 修改 `scan.md` 支持参数化
  - [ ] SubTask 6.3: 运行测试验证通过

## P2: Agent 协同与 DAG 编排

- [ ] Task 7: 实现命令级 DAG 编排
  - [ ] SubTask 7.1: 在 `tests/opencode/commands/dag.test.ts` 新增测试，断言四个 Agent 按 DAG 顺序执行
  - [ ] SubTask 7.2: 修改 `review.md` 支持多 Agent 串联（rule-engine + code-reviewer + security-reviewer 并行 → impact-analyzer → reflector）
  - [ ] SubTask 7.3: 运行测试验证通过

- [ ] Task 8: 扩展 post-process.js 的 afterReview 串联 reflector
  - [ ] SubTask 8.1: 在 `tests/opencode/plugins/post-process.test.ts` 新增测试，断言 `reflectFindings` 被调用
  - [ ] SubTask 8.2: 修改 `post-process.js`，在 deduplicateFindings 之后追加 `reflectFindings` 调用
  - [ ] SubTask 8.3: 运行测试验证通过

- [ ] Task 9: 动态启用 MCP code-review-graph
  - [ ] SubTask 9.1: 在 `tests/opencode/mcp.test.ts` 新增测试，断言大 PR 时自动启用 MCP
  - [ ] SubTask 9.2: 修改 `opencode.jsonc` 和 `init-wizard.ts`，添加 MCP 启用逻辑
  - [ ] SubTask 9.3: 运行测试验证通过

## P3: 插件能力扩展

- [ ] Task 10: 完善 post-process.js 的 tools.code-review handler
  - [ ] SubTask 10.1: 在 `tests/opencode/plugins/tool.test.ts` 新增测试，断言 handler 完整调用 `runPipeline`
  - [ ] SubTask 10.2: 修改 `post-process.js` 的 tools.code-review handler，完整调用 pipeline
  - [ ] SubTask 10.3: 运行测试验证通过

- [ ] Task 11: 新增 `beforeReview` 钩子
  - [ ] SubTask 11.1: 在 `tests/opencode/plugins/hooks.test.ts` 新增测试，断言 `beforeReview` 在审查前调用
  - [ ] SubTask 11.2: 修改 `post-process.js`，新增 `beforeReview` 钩子
  - [ ] SubTask 11.3: 运行测试验证通过

- [ ] Task 12: 新增 `afterPublish` 钩子
  - [ ] SubTask 12.1: 在 `tests/opencode/plugins/hooks.test.ts` 新增测试，断言 `afterPublish` 在发布后调用
  - [ ] SubTask 12.2: 修改 `post-process.js` 和 `comment-publisher.ts`，新增 `afterPublish` 钩子
  - [ ] SubTask 12.3: 运行测试验证通过

## P4: 可观测性与配置

- [ ] Task 13: 新增 `/metrics` 命令
  - [ ] SubTask 13.1: 新建 `tests/opencode/commands/metrics.test.ts`，验证命令输出 KPIs
  - [ ] SubTask 13.2: 创建 `.opencode/commands/metrics.md`，调用 `collectMetrics`
  - [ ] SubTask 13.3: 运行测试验证通过

- [ ] Task 14: 新增 `/dashboard` 命令
  - [ ] SubTask 14.1: 新建 `tests/opencode/commands/dashboard.test.ts`，验证命令输出趋势数据
  - [ ] SubTask 14.2: 创建 `.opencode/commands/dashboard.md`，调用 `generateDashboardData`
  - [ ] SubTask 14.3: 运行测试验证通过

- [ ] Task 15: 新增 `/feedback` 命令
  - [ ] SubTask 15.1: 新建 `tests/opencode/commands/feedback.test.ts`，验证误报标记功能
  - [ ] SubTask 15.2: 创建 `.opencode/commands/feedback.md`，调用 `markFalsePositive`
  - [ ] SubTask 15.3: 运行测试验证通过

## P5: 文档与示例

- [ ] Task 16: 为所有命令添加使用示例
  - [ ] SubTask 16.1: 修改 `review.md`、`security-review.md`、`scan.md`、`review-pr.md`、`impact.md`、`reflect.md` 添加 `## Examples` 段落
  - [ ] SubTask 16.2: 验证文档格式正确性

- [ ] Task 17: 创建 OpenCode 集成 README
  - [ ] SubTask 17.1: 创建 `opencode-config/README.md`，说明三种安装方式
  - [ ] SubTask 17.2: 验证文档可读性

- [ ] Task 18: 实现规则同步脚本
  - [ ] SubTask 18.1: 创建 `scripts/sync-rules-md.js`，从 `post-processor.ts` 生成 `false-positive-filters.md`
  - [ ] SubTask 18.2: 修改 `package.json` 添加 `prebuild` 脚本
  - [ ] SubTask 18.3: 运行脚本验证生成结果

## P6: 性能与稳定性

- [ ] Task 19: 大 PR 分批处理
  - [ ] SubTask 19.1: 在 `tests/opencode/commands/batch.test.ts` 新增测试，断言大 PR 触发分批
  - [ ] SubTask 19.2: 修改 `review.md` 和 `security-review.md`，检测 diff 大小并提示分批
  - [ ] SubTask 19.3: 运行测试验证通过

- [ ] Task 20: 缓存命中提示
  - [ ] SubTask 20.1: 在 `tests/opencode/plugins/cache.test.ts` 新增测试，断言缓存命中时输出提示
  - [ ] SubTask 20.2: 修改 `post-process.js`，在 `afterBuild` 钩子输出缓存命中统计
  - [ ] SubTask 20.3: 运行测试验证通过

## Task Dependencies

- Task 1, 2, 3 独立（P0 功能缺口，可并行）
- Task 4 依赖 Task 1, 2, 3（统一格式需要所有命令存在）
- Task 5, 6 独立（P1 scan 优化）
- Task 7 依赖 Task 1, 2（DAG 需要 impact 和 reflect 命令）
- Task 8 依赖 Task 2（reflector 入口）
- Task 9 独立（MCP 配置）
- Task 10, 11, 12 独立（插件扩展，可并行）
- Task 13, 14, 15 独立（可观测性命令，可并行）
- Task 16, 17, 18 独立（文档，可并行）
- Task 19, 20 独立（性能优化，可并行）

## Parallelizable Work

可并行的任务组：
- 组 A：Task 1 + Task 2 + Task 3（P0 功能缺口）
- 组 B：Task 5 + Task 6（P1 scan 优化）
- 组 C：Task 10 + Task 11 + Task 12（P3 插件扩展）
- 组 D：Task 13 + Task 14 + Task 15（P4 可观测性）
- 组 E：Task 16 + Task 17 + Task 18（P5 文档）
- 组 F：Task 19 + Task 20（P6 性能）