# Tasks

> 第二轮深度迭代：200 轮优化任务，分 20 个 Task（每个 Task 包含 10 轮迭代）。每个任务遵循 TDD。

## 第一阶段：增量审查与状态管理（Task 1-3）

- [ ] Task 1: 实现增量审查能力
  - [ ] SubTask 1.1: 新建 `tests/opencode/commands/incremental.test.ts`，验证增量审查只分析变更文件
  - [ ] SubTask 1.2: 创建 `src/incremental-review.ts`，实现 `loadLastReviewState` 和 `computeIncrementalDiff`
  - [ ] SubTask 1.3: 修改 `src/cli.ts` 添加 `--incremental` 标志
  - [ ] SubTask 1.4: 修改 `review.md` 支持 `--incremental` 参数
  - [ ] SubTask 1.5: 运行测试验证通过

- [ ] Task 2: 实现忽略机制
  - [ ] SubTask 2.1: 新建 `tests/opencode/commands/ignore.test.ts`，验证忽略规则
  - [ ] SubTask 2.2: 创建 `src/ignore-manager.ts`，支持 `.reviewignore` 文件
  - [ ] SubTask 2.3: 修改 `post-process.js` 集成忽略管理器
  - [ ] SubTask 2.4: 创建 `.opencode/commands/ignore.md` 命令
  - [ ] SubTask 2.5: 运行测试验证通过

- [ ] Task 3: 实现规则定制
  - [ ] SubTask 3.1: 新建 `tests/opencode/commands/rules.test.ts`，验证规则定制
  - [ ] SubTask 3.2: 创建 `src/rule-customizer.ts`，支持自定义规则加载
  - [ ] SubTask 3.3: 创建 `.opencode/commands/rules.md` 命令
  - [ ] SubTask 3.4: 运行测试验证通过

## 第二阶段：性能优化（Task 4-6）

- [ ] Task 4: 实现智能预检
  - [ ] SubTask 4.1: 新建 `tests/opencode/commands/precheck.test.ts`，验证预检逻辑
  - [ ] SubTask 4.2: 创建 `src/precheck.ts`，实现 `performPreCheck` 检测 trivial changes
  - [ ] SubTask 4.3: 修改 `src/cli.ts` 集成预检
  - [ ] SubTask 4.4: 运行测试验证通过

- [ ] Task 5: 实现并行调优
  - [ ] SubTask 5.1: 新建 `tests/opencode/commands/parallel.test.ts`，验证并行执行
  - [ ] SubTask 5.2: 创建 `src/parallel-tuner.ts`，动态调整并行度
  - [ ] SubTask 5.3: 修改 `src/orchestrator.ts` 集成并行调优器
  - [ ] SubTask 5.4: 运行测试验证通过

- [ ] Task 6: 实现流式输出
  - [ ] SubTask 6.1: 新建 `tests/opencode/commands/streaming.test.ts`，验证流式输出
  - [ ] SubTask 6.2: 创建 `src/streaming-output.ts`，支持 SSE 流式输出
  - [ ] SubTask 6.3: 修改 `src/cli.ts` 添加 `--stream` 标志
  - [ ] SubTask 6.4: 运行测试验证通过

## 第三阶段：AI 协同增强（Task 7-9）

- [ ] Task 7: 实现上下文学习
  - [ ] SubTask 7.1: 新建 `tests/opencode/commands/learning.test.ts`，验证反馈学习
  - [ ] SubTask 7.2: 创建 `src/context-learner.ts`，从反馈中学习
  - [ ] SubTask 7.3: 修改 `src/feedback.ts` 集成学习器
  - [ ] SubTask 7.4: 运行测试验证通过

- [ ] Task 8: 实现模型路由
  - [ ] SubTask 8.1: 新建 `tests/opencode/commands/router.test.ts`，验证模型路由
  - [ ] SubTask 8.2: 创建 `src/model-router.ts`，基于复杂度路由
  - [ ] SubTask 8.3: 修改 `src/ai-reflection.ts` 集成路由器
  - [ ] SubTask 8.4: 运行测试验证通过

- [ ] Task 9: 实现自愈能力
  - [ ] SubTask 9.1: 新建 `tests/opencode/commands/self-heal.test.ts`，验证自愈逻辑
  - [ ] SubTask 9.2: 创建 `src/self-healer.ts`，自动修复常见问题
  - [ ] SubTask 9.3: 修改 `post-process.js` 集成自愈器
  - [ ] SubTask 9.4: 运行测试验证通过

## 第四阶段：企业级特性（Task 10-12）

- [ ] Task 10: 实现 RBAC 权限
  - [ ] SubTask 10.1: 新建 `tests/opencode/commands/rbac.test.ts`，验证权限控制
  - [ ] SubTask 10.2: 创建 `src/rbac.ts`，实现角色权限检查
  - [ ] SubTask 10.3: 修改 `src/cli.ts` 集成权限检查
  - [ ] SubTask 10.4: 运行测试验证通过

- [ ] Task 11: 实现审计日志
  - [ ] SubTask 11.1: 新建 `tests/opencode/commands/audit.test.ts`，验证审计日志
  - [ ] SubTask 11.2: 创建 `src/audit-logger.ts`，记录所有审查操作
  - [ ] SubTask 11.3: 创建 `.opencode/commands/audit.md` 命令
  - [ ] SubTask 11.4: 运行测试验证通过

- [ ] Task 12: 实现合规检查
  - [ ] SubTask 12.1: 新建 `tests/opencode/commands/compliance.test.ts`，验证合规检查
  - [ ] SubTask 12.2: 创建 `src/compliance-checker.ts`，支持 OWASP/CWE 标准
  - [ ] SubTask 12.3: 创建 `.opencode/commands/compliance.md` 命令
  - [ ] SubTask 12.4: 运行测试验证通过

## 第五阶段：用户体验（Task 13-15）

- [ ] Task 13: 实现交互式 TUI
  - [ ] SubTask 13.1: 新建 `tests/opencode/commands/tui.test.ts`，验证 TUI 交互
  - [ ] SubTask 13.2: 创建 `src/tui.ts`，实现交互式终端 UI
  - [ ] SubTask 13.3: 修改 `src/cli.ts` 添加 `--tui` 标志
  - [ ] SubTask 13.4: 运行测试验证通过

- [ ] Task 14: 实现彩色输出
  - [ ] SubTask 14.1: 新建 `tests/opencode/commands/color.test.ts`，验证彩色输出
  - [ ] SubTask 14.2: 创建 `src/color-output.ts`，支持严重度着色
  - [ ] SubTask 14.3: 修改 `src/cli.ts` 集成彩色输出
  - [ ] SubTask 14.4: 运行测试验证通过

- [ ] Task 15: 实现结果导出
  - [ ] SubTask 15.1: 新建 `tests/opencode/commands/export.test.ts`，验证导出格式
  - [ ] SubTask 15.2: 创建 `src/result-exporter.ts`，支持 JSON/Markdown/SARIF/HTML
  - [ ] SubTask 15.3: 修改 `src/cli.ts` 添加 `--format` 和 `--output` 参数
  - [ ] SubTask 15.4: 运行测试验证通过

## 第六阶段：集成生态（Task 16-17）

- [ ] Task 16: 实现 Webhook 通知
  - [ ] SubTask 16.1: 新建 `tests/opencode/commands/webhook.test.ts`，验证 Webhook 推送
  - [ ] SubTask 16.2: 创建 `src/webhook-notifier.ts`，支持多种事件触发
  - [ ] SubTask 16.3: 修改 `post-process.js` 集成 Webhook
  - [ ] SubTask 16.4: 运行测试验证通过

- [ ] Task 17: 实现 API 暴露
  - [ ] SubTask 17.1: 新建 `tests/opencode/commands/api.test.ts`，验证 REST API
  - [ ] SubTask 17.2: 创建 `src/api-server.ts`，提供 HTTP API
  - [ ] SubTask 17.3: 修改 `src/cli.ts` 添加 `serve` 命令
  - [ ] SubTask 17.4: 运行测试验证通过

## 第七阶段：可观测性（Task 18-20）

- [ ] Task 18: 实现链路追踪
  - [ ] SubTask 18.1: 新建 `tests/opencode/commands/tracing.test.ts`，验证追踪导出
  - [ ] SubTask 18.2: 创建 `src/tracing.ts`，集成 OpenTelemetry
  - [ ] SubTask 18.3: 修改 `src/pipeline.ts` 集成追踪
  - [ ] SubTask 18.4: 运行测试验证通过

- [ ] Task 19: 实现性能剖析
  - [ ] SubTask 19.1: 新建 `tests/opencode/commands/profile.test.ts`，验证性能剖析
  - [ ] SubTask 19.2: 创建 `src/profiler.ts`，实现性能剖析
  - [ ] SubTask 19.3: 修改 `src/cli.ts` 添加 `--profile` 标志
  - [ ] SubTask 19.4: 运行测试验证通过

- [ ] Task 20: 实现告警通知
  - [ ] SubTask 20.1: 新建 `tests/opencode/commands/alert.test.ts`，验证告警
  - [ ] SubTask 20.2: 创建 `src/alert-notifier.ts`，支持 Slack/Email/PagerDuty
  - [ ] SubTask 20.3: 创建 `.opencode/commands/alert.md` 命令
  - [ ] SubTask 20.4: 运行测试验证通过

## Task Dependencies

- Task 1, 2, 3 独立（增量审查基础能力，可并行）
- Task 4, 5, 6 独立（性能优化，可并行）
- Task 7 依赖 Task 2（学习需要忽略机制）
- Task 8, 9 独立（AI 协同，可并行）
- Task 10, 11, 12 独立（企业级，可并行）
- Task 13, 14, 15 独立（用户体验，可并行）
- Task 16, 17 独立（集成生态，可并行）
- Task 18, 19, 20 独立（可观测性，可并行）

## Parallelizable Work

可并行的任务组：
- 组 A：Task 1 + Task 2 + Task 3（增量审查基础）
- 组 B：Task 4 + Task 5 + Task 6（性能优化）
- 组 C：Task 8 + Task 9（AI 协同）
- 组 D：Task 10 + Task 11 + Task 12（企业级）
- 组 E：Task 13 + Task 14 + Task 15（用户体验）
- 组 F：Task 16 + Task 17（集成生态）
- 组 G：Task 18 + Task 19 + Task 20（可观测性）