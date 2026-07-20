# Checklist

> 验证所有优化点是否按 spec 实现。每完成一项检查后勾选 `[x]`。

## P0: 功能缺口补齐

- [x] `/impact` 命令存在（`.opencode/commands/impact.md`）
- [x] `/impact` 命令使用 agent: impact-analyzer
- [x] `/reflect` 命令存在（`.opencode/commands/reflect.md`）
- [x] `/reflect` 命令使用 agent: reflector，接收 findings JSON 参数
- [x] `/review-pr` 命令包含发布步骤（调用 `code-review publish`）
- [x] `tests/opencode/commands/impact.test.ts` 测试通过
- [x] `tests/opencode/commands/reflect.test.ts` 测试通过
- [x] `tests/opencode/commands/review-pr.test.ts` 测试通过

## P1: 一致性修复

- [x] 所有命令输出格式统一为 Finding JSON Schema（含 file, line, severity, category, message, suggestion, confidence, source）
- [x] `/scan` 命令使用 `excludeGeneratedFiles` 排除生成文件
- [x] `/scan` 命令使用 `detectLanguage` 自动识别语言
- [x] `/scan` 命令支持 `--limit` 和 `--exclude` 参数
- [x] `tests/opencode/commands/format.test.ts` 测试通过
- [x] `tests/opencode/commands/scan.test.ts` 测试通过

## P2: Agent 协同与 DAG 编排

- [x] `/review` 命令支持多 Agent DAG 编排
- [x] DAG 顺序：rule-engine + code-reviewer + security-reviewer（并行）→ impact-analyzer → reflector
- [x] `post-process.js` 的 `afterReview` 调用 `reflectFindings`
- [x] MCP `code-review-graph` 在大 PR 时自动启用
- [x] `tests/opencode/commands/dag.test.ts` 测试通过
- [x] `tests/opencode/plugins/post-process.test.ts` 测试通过
- [x] `tests/opencode/mcp.test.ts` 测试通过

## P3: 插件能力扩展

- [x] `post-process.js` 的 tools.code-review handler 完整调用 `runPipeline`
- [x] `post-process.js` 提供 `beforeReview` 钩子
- [x] `post-process.js` 提供 `afterPublish` 钩子
- [x] `comment-publisher.ts` 调用 `afterPublish` 钩子
- [x] `tests/opencode/plugins/tool.test.ts` 测试通过
- [x] `tests/opencode/plugins/hooks.test.ts` 测试通过

## P4: 可观测性与配置

- [x] `/metrics` 命令存在（`.opencode/commands/metrics.md`）
- [x] `/dashboard` 命令存在（`.opencode/commands/dashboard.md`）
- [x] `/feedback` 命令存在（`.opencode/commands/feedback.md`）
- [x] `/metrics` 命令输出审查 KPIs
- [x] `/dashboard` 命令输出趋势数据
- [x] `/feedback` 命令支持误报标记
- [x] `tests/opencode/commands/metrics.test.ts` 测试通过
- [x] `tests/opencode/commands/dashboard.test.ts` 测试通过
- [x] `tests/opencode/commands/feedback.test.ts` 测试通过

## P5: 文档与示例

- [x] 所有命令包含 `## Examples` 段落（2-3 个示例）
- [x] `opencode-config/README.md` 存在，说明三种安装方式
- [x] `scripts/sync-rules-md.js` 存在，从 `post-processor.ts` 生成规则文档
- [x] `package.json` 的 `prebuild` 脚本调用 `sync-rules-md.js`

## P6: 性能与稳定性

- [x] `/review` 和 `/security-review` 在大 PR 时触发分批处理
- [x] `post-process.js` 在 `afterBuild` 钩子输出缓存命中统计
- [x] `tests/opencode/commands/batch.test.ts` 测试通过
- [x] `tests/opencode/plugins/cache.test.ts` 测试通过

## 整体验证

- [x] `npm run lint` 通过
- [x] `npm run test` 全部通过
- [x] `npm run build` 构建成功
- [x] 所有新增命令在 `node dist/cli.js --help` 中可见

## GitHub 推送

- [x] 创建 feature 分支
- [x] 提交所有变更
- [x] 推送到 GitHub
- [x] 打开 Draft PR