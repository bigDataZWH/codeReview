# Checklist

> 第二轮深度迭代验证清单。

## 第一阶段：增量审查与状态管理

- [ ] `src/incremental-review.ts` 存在并导出 `loadLastReviewState` 和 `computeIncrementalDiff`
- [ ] `--incremental` 标志在 review 命令中生效
- [ ] `src/ignore-manager.ts` 存在并支持 `.reviewignore` 文件
- [ ] `.opencode/commands/ignore.md` 命令存在
- [ ] `src/rule-customizer.ts` 存在并支持自定义规则加载
- [ ] `.opencode/commands/rules.md` 命令存在
- [ ] `tests/opencode/commands/incremental.test.ts` 通过
- [ ] `tests/opencode/commands/ignore.test.ts` 通过
- [ ] `tests/opencode/commands/rules.test.ts` 通过

## 第二阶段：性能优化

- [ ] `src/precheck.ts` 存在并能检测 trivial changes
- [ ] `src/parallel-tuner.ts` 存在并动态调整并行度
- [ ] `src/streaming-output.ts` 存在并支持 SSE 流式输出
- [ ] `--stream` 标志在 CLI 中生效
- [ ] `tests/opencode/commands/precheck.test.ts` 通过
- [ ] `tests/opencode/commands/parallel.test.ts` 通过
- [ ] `tests/opencode/commands/streaming.test.ts` 通过

## 第三阶段：AI 协同增强

- [ ] `src/context-learner.ts` 存在并从反馈中学习
- [ ] `src/model-router.ts` 存在并基于复杂度路由
- [ ] `src/self-healer.ts` 存在并自动修复常见问题
- [ ] `tests/opencode/commands/learning.test.ts` 通过
- [ ] `tests/opencode/commands/router.test.ts` 通过
- [ ] `tests/opencode/commands/self-heal.test.ts` 通过

## 第四阶段：企业级特性

- [ ] `src/rbac.ts` 存在并实现角色权限检查
- [ ] `src/audit-logger.ts` 存在并记录所有审查操作
- [ ] `src/compliance-checker.ts` 存在并支持 OWASP/CWE
- [ ] `.opencode/commands/audit.md` 命令存在
- [ ] `.opencode/commands/compliance.md` 命令存在
- [ ] `tests/opencode/commands/rbac.test.ts` 通过
- [ ] `tests/opencode/commands/audit.test.ts` 通过
- [ ] `tests/opencode/commands/compliance.test.ts` 通过

## 第五阶段：用户体验

- [ ] `src/tui.ts` 存在并实现交互式终端 UI
- [ ] `src/color-output.ts` 存在并支持严重度着色
- [ ] `src/result-exporter.ts` 存在并支持 JSON/Markdown/SARIF/HTML
- [ ] `--tui`、`--format`、`--output` 标志在 CLI 中生效
- [ ] `tests/opencode/commands/tui.test.ts` 通过
- [ ] `tests/opencode/commands/color.test.ts` 通过
- [ ] `tests/opencode/commands/export.test.ts` 通过

## 第六阶段：集成生态

- [ ] `src/webhook-notifier.ts` 存在并支持多种事件触发
- [ ] `src/api-server.ts` 存在并提供 HTTP API
- [ ] `serve` 命令在 CLI 中可用
- [ ] `tests/opencode/commands/webhook.test.ts` 通过
- [ ] `tests/opencode/commands/api.test.ts` 通过

## 第七阶段：可观测性

- [ ] `src/tracing.ts` 存在并集成 OpenTelemetry
- [ ] `src/profiler.ts` 存在并实现性能剖析
- [ ] `src/alert-notifier.ts` 存在并支持 Slack/Email/PagerDuty
- [ ] `.opencode/commands/alert.md` 命令存在
- [ ] `tests/opencode/commands/tracing.test.ts` 通过
- [ ] `tests/opencode/commands/profile.test.ts` 通过
- [ ] `tests/opencode/commands/alert.test.ts` 通过

## 整体验证

- [ ] `npm run lint` 通过
- [ ] `npm run test` 全部通过
- [ ] `npm run build` 构建成功
- [ ] 所有新增命令在 `node dist/cli.js --help` 中可见

## GitHub 推送

- [ ] 创建新分支
- [ ] 提交所有变更
- [ ] 推送到 GitHub
- [ ] 打开 Draft PR