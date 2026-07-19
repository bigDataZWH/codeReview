# code-review 功能完成情况与改进点分析

> 基于设计文档（`SPEC.md` / `docs/architecture.md` / `.trae/specs/implement-ocr-system/spec.md`）与当前实现（`/workspace/code-review-pkg/`）的对照分析，输出完成度评估与改进建议清单。

---

## 一、总体结论

| 维度 | 完成度 | 评估 |
|---|---|---|
| 设计文档完整度 | 95% | 文档体系齐全：SPEC + architecture + quickstart + implement-ocr-system spec/checklist/tasks |
| 核心模块实现 | 90% | 24 个源文件全部有实现，核心数据流（parse→filter→rule→prompt→publish）端到端可用 |
| 测试覆盖 | 90% | 33 个测试文件、~974 测试用例、覆盖率门槛 90%，e2e/benchmark/integration 分层 |
| 占位/Stub 实现 | 4 处 | `pipeline.middleware` 钩子、`pipeline.batched` processFn、`orchestrator.buildReviewDag` 节点 handler、`validation.mcpEndpoint` warning |
| CI/CD pipeline | 15% | 仅有 2 个消费方审查 workflow，项目自身 lint/test/build/release workflow 全部缺失 |
| npm publish 就绪度 | 30% | **致命**：`.gitignore` 排除 `dist/`，`package.json` 无 `files` 字段、无 `prepublishOnly`，发布后包不可用 |

**关键判断**：项目核心功能已按设计完成，可作为 OpenCode 插件被消费；但**作为独立 npm 包发布存在阻塞问题**，且编排层（`orchestrator` / `pipeline.batched` / `middleware`）的 stub 实现使得端到端"AI 自动审查"流程在 CLI 层无法独立完成。

---

## 二、设计文档回顾

### 2.1 项目定位
- 基于 OpenCode 平台的 **AI 代码审查确定性管道**
- 设计原则：确定性优先 / 管道可缓存 / Agent 可编排 / 反馈可闭环 / 可观测 / 失败友好

### 2.2 六层架构（`docs/architecture.md`）
```
L1 触发层 (Trigger)        GitHub Action / CLI / OpenCode Command / Webhook
L2 编排层 (Orchestrator)   ReviewSessionManager / executeDag / withRetry / withFallback
L3 管道层 (Pipeline)       parse → filter → bundle → rule → mcp → prompt-build
L4 Agent 层                code-reviewer / security-reviewer / impact-analyzer / reflector
L5 状态层 (State)          StateStore / CacheManager / FeedbackStore
L6 输出层 (Output)         comment-publisher / progress / metrics / format
```

### 2.3 设计目标（来自 `implement-ocr-system/spec.md`）
- 核心模块测试覆盖率 ≥ 80%（实际门槛拉高到 90%）
- 10 次迭代优化目标：稳定性 → 性能成本 → 精度体验
- 误报率 ≤ 15%，finding 接受率 ≥ 40%，缓存命中率 ≥ 60%

---

## 三、按模块完成情况

### 3.1 完全实现的模块（21/24）

| 模块 | 源文件 | 行数 | 测试状态 |
|---|---|---|---|
| diff-parser | `src/diff-parser.ts` | 413 | ✅ 单元 + e2e + benchmark |
| file-filter | `src/file-filter.ts` | 431 | ✅ 单元 + e2e + benchmark |
| rule-engine | `src/rule-engine.ts` | 380 | ✅ 单元 + e2e + benchmark |
| post-processor | `src/post-processor.ts` | 749 | ✅ 单元 + e2e + benchmark（含 12 条内置 FP 规则） |
| ai-reflection | `src/ai-reflection.ts` | 311 | ✅ 单元 + e2e（含 OpenAI/Anthropic/Google 三协议适配） |
| comment-publisher | `src/comment-publisher.ts` | 354 | ✅ 单元 + e2e（含 replace/incremental/sticky summary） |
| prompt-builder | `src/prompt-builder.ts` | 764 | ✅ 单元 + e2e（含 4 模板 + A/B 变体） |
| init-wizard | `src/init-wizard.ts` | 469 | ✅ 单元（ux-improvements） |
| cache | `src/cache.ts` | 477 | ✅ 单元 + integration（L1+L2 三级） |
| feedback | `src/feedback.ts` | 725 | ✅ 单元（含误报聚类 + autoTuneRules） |
| state | `src/state.ts` | 535 | ✅ 单元 + e2e（断点续审） |
| token-optimizer | `src/token-optimizer.ts` | 370 | ✅ 单元 |
| metrics | `src/metrics.ts` | 417 | ✅ 单元 |
| progress | `src/progress.ts` | 282 | ✅ 单元 |
| types / utils / constants / format / validation | 5 个辅助文件 | 568 | ✅ 全部覆盖 |
| index | `src/index.ts` | 208 | ✅ API 导出测试 |

### 3.2 部分实现 / 含 Stub 的模块（3 个）

#### ⚠️ `src/pipeline.ts`（439 行）
- **完成部分**：`runPipeline` 主流程、`runSecurityPipeline`、`runPipelineFromFile`、`chunkLargeFile`、`applyFindings`
- **Stub 1**：`runPipelineWithMiddleware`（[L189-L207](file:///workspace/code-review-pkg/src/pipeline.ts#L189-L207)）
  - `PipelineMiddleware` 类型定义了 `afterParse` / `afterFilter` / `afterBuild` 三个钩子
  - 实际实现仅触发 `afterBuild`，`afterParse` / `afterFilter` 定义后从未被调用
  - 注释明确："当前实现仅在结果层面支持 afterBuild"
- **Stub 2**：`runPipelineBatched`（[L411-L417](file:///workspace/code-review-pkg/src/pipeline.ts#L411-L417)）
  - `processFn: async () => []` 占位
  - 注释明确："分批处理（这里只是分批计算 findings 占位，实际审查逻辑由调用方决定）"

#### ⚠️ `src/orchestrator.ts`（873 行）
- **完成部分**：`ReviewSessionManager`、`executeDag`、`detectCycle`、`mergeResults`、`withFallback`、`withRetry`、`callModelWithTimeout`、`batchProcess`、`prioritizeDiffs`
- **Stub**：`buildReviewDag`（[L451-L487](file:///workspace/code-review-pkg/src/orchestrator.ts#L451-L487)）
  - 3 个 DAG 节点（rule-engine / ai-reviewer / impact-analyzer）的 `handler` 全部为 `async () => []`
  - 注释明确："由调用方按需替换为真实处理器"
  - 影响：`executeDag` 基础设施完整可用，但默认 DAG 不会产出任何 findings

#### ⚠️ `src/validation.ts`（76 行）
- **Stub**：[L71-L73](file:///workspace/code-review-pkg/src/validation.ts#L71-L73)
  ```typescript
  if (config.mcpEnabled && !config.mcpEndpoint) {
    // warning level: not an error, but worth noting
  }
  ```
  - `if` 块为空，未实际生成或返回 warning

### 3.3 设计意图明确的"非完成"
- **CLI 仅产出 prompt 不调用 LLM**：`src/cli.ts` 中 `review` / `security-review` / `scan` / `impact` 命令仅打印 `result.prompt`，不驱动 LLM 调用
  - 这是设计取舍（dry-run 友好），LLM 调用由 OpenCode Agent 接管
  - 但意味着 CLI 单独使用时无法独立完成端到端 AI 审查

---

## 四、与设计文档的关键差距

### 4.1 Roadmap 目标完成情况

| 迭代目标（来自 spec.md） | 完成状态 | 证据 |
|---|---|---|
| 核心稳定性（迭代 1-3） | ✅ | 1113 测试全过，覆盖率 ≥ 91% |
| 性能与成本（迭代 4-6） | ✅ | 三级缓存实现，分批处理可用 |
| 精度与体验（迭代 7-10） | ⚠️ 部分 | 误报过滤 12 条内置规则（设计要求 17 条），A/B 变体可用 |

### 4.2 设计承诺 vs 实际交付

| 设计承诺 | 实际 | 差距 |
|---|---|---|
| "17 条预编译正则规则" (README L38) | 12 条 (`BUILTIN_FP_RULES`) | **少 5 条** |
| `afterParse` / `afterFilter` 中间件钩子 | 类型已定义，未实现 | **未实现** |
| DAG 节点 handler | 占位实现 | **未实现** |
| `runPipelineBatched` processFn | 占位 | **未实现** |
| `opencode-config/.opencode/plugins/post-process.js` | stub（L9-L16） | **未实现真实调用** |

### 4.3 代码质量问题

| 问题类型 | 位置 | 影响 |
|---|---|---|
| 静默 catch（吞噬异常） | cache.ts L170/181/225/242/253/264；orchestrator.ts L598；ai-reflection.ts L110/307；file-filter.ts L410/428；state.ts L157；comment-publisher.ts L59-60；mcp-adapter.ts L132/171/189/200 | 生产环境调试困难 |
| 代码重复 | feedback.ts L309-336 + file-filter.ts L112-166 (globToRegex)；feedback.ts L407-474 + rule-engine.ts L24-108 (YAML 解析)；metrics.ts L371-416 + feedback.ts L624-660 (规则有效性) | 维护成本高 |
| 简化实现 | prompt-builder.ts L425 estimatePromptTokens (字符数/4)；token-optimizer.ts L259-262；post-processor.ts L381 computeTextOverlap (子串包含而非 LCS) | 精度有限 |
| tsup banner 注入 | tsup.config.ts L13 `banner.js` 同时注入 index.js 与 cli.js | 库入口带 shebang 行不规范 |

---

## 五、CI/CD 与发布就绪度差距

### 5.1 CI/CD pipeline 完成度：15%

| 缺失项 | 阻塞级别 | 修复方案 |
|---|---|---|
| 项目自身 CI workflow（lint/test/build/coverage） | 高 | 新建 `.github/workflows/ci.yml` 运行 `npm ci && npm run lint && npm run test -- --coverage && npm run build` |
| 覆盖率上报 | 中 | 在 ci.yml 中加 `@vitest/coverage-v8` 上传到 Codecov |
| 多 OS / 多 Node 版本矩阵 | 低 | matrix: ubuntu/macos + node 18/20/22 |
| Release 自动化 workflow | 高 | semantic-release 或 changesets |
| 现有 2 个消费方 workflow（code-review.yml/security-review.yml） | — | 已存在但依赖 npm 已发布版本，实际无法运行 |

### 5.2 npm publish 就绪度：30%

#### 致命阻塞问题
1. **`dist/` 被 `.gitignore` 排除** + `package.json` 无 `files` 字段
   - npm 5+ 在无 `.npmignore` 时复用 `.gitignore`
   - 结果：`npm publish` 后包内无 `dist/cli.js` / `dist/index.js` / `dist/index.d.ts`
   - 但 `bin` / `main` / `types` 都指向 `dist/*` → **包完全不可用**
   - **修复**：在 `package.json` 添加：
     ```json
     "files": ["dist", "review-rules", "opencode-config", "scripts", "README.md", "LICENSE"]
     ```

2. **无 `prepublishOnly` 脚本**
   - 发布前不会自动 build，容易发布空包或旧产物
   - **修复**：在 `package.json` 添加：
     ```json
     "prepublishOnly": "npm run lint && npm run test && npm run build"
     ```

#### 次要问题
3. `tsup.config.ts` 的 `banner.js` 同时注入到 `index.js`，应改为仅作用于 cli 入口
4. 版本固定 `0.1.0`，无版本管理策略
5. 无 `publishConfig.access` 显式声明
6. 无 release workflow（发布全靠本地手动 `npm publish`）

---

## 六、改进点清单（按优先级）

### P0：阻塞 npm 发布（必须修复）

| # | 改进项 | 文件 | 操作 |
|---|---|---|---|
| 1 | 添加 `files` 字段 | `package.json` | 添加 `"files": ["dist", "review-rules", "opencode-config", "scripts", "README.md", "LICENSE"]` |
| 2 | 添加 `prepublishOnly` 脚本 | `package.json` | 添加 `"prepublishOnly": "npm run lint && npm run test && npm run build"` |
| 3 | 修正 tsup banner 注入 | `tsup.config.ts` | 仅对 cli 入口加 banner，或单独 entry 配置 |

### P1：CI/CD pipeline 补全（高优先）

| # | 改进项 | 文件 | 操作 |
|---|---|---|---|
| 4 | 新建项目 CI workflow | `.github/workflows/ci.yml` | 运行 lint + test + build + coverage 上报 |
| 5 | 新建 Release workflow | `.github/workflows/release.yml` | semantic-release 或 changesets 自动发布 |
| 6 | 添加多 Node 版本矩阵 | ci.yml | matrix: node 18/20/22 |

### P2：Stub 实现补全（中优先，影响功能完整性）

| # | 改进项 | 文件 | 操作 |
|---|---|---|---|
| 7 | 实现 `afterParse` / `afterFilter` 中间件钩子 | `src/pipeline.ts` L189-207 | 在 `runPipeline` 内部插入钩子调用点，或在 `runPipelineWithMiddleware` 中重写管道流程 |
| 8 | 实现 `runPipelineBatched` 的 processFn | `src/pipeline.ts` L411-417 | 注入实际审查逻辑（rule-engine + AI 反思 + 后处理） |
| 9 | 实现 `buildReviewDag` 的 3 个节点 handler | `src/orchestrator.ts` L451-487 | rule-engine 节点调用 `matchRules`；ai-reviewer 节点调用 LLM；impact-analyzer 节点调用 `getImpactRadius` |
| 10 | 实现 `opencode-config/.opencode/plugins/post-process.js` 的 afterReview 钩子 | `opencode-config/.opencode/plugins/post-process.js` L9-16 | 调用 `code-review` 的 `correctLineLocations` / `filterFalsePositives` / `deduplicateFindings` |
| 11 | 实现 `validation.ts` 的 mcpEndpoint warning | `src/validation.ts` L71-73 | 返回 warnings 数组或调用 console.warn |

### P3：测试覆盖补全（中优先）

| # | 改进项 | 文件 | 操作 |
|---|---|---|---|
| 12 | 补充 `init` 命令测试 | `tests/cli.test.ts` | mock `readline/promises`，覆盖交互式向导流程 |
| 13 | 补充真实 MCP 服务集成测试 | `tests/mcp-adapter.test.ts` 或新建 `tests/integration/mcp-integration.test.ts` | 启动真实 `code-review-graph serve` 子进程，验证 JSON-RPC 通信（当前全 mock） |
| 14 | 补充真实 GitHub API 端到端测试 | 新建 `tests/e2e/github-publish.test.ts`（手动触发） | 验证 `publishReview` 真实发布到测试 PR |

### P4：代码质量优化（低优先）

| # | 改进项 | 文件 | 操作 |
|---|---|---|---|
| 15 | 提取共用 YAML 解析器 | 新建 `src/yaml-lite.ts` | `feedback.ts` L407-474 与 `rule-engine.ts` L24-108 合并 |
| 16 | 提取共用 globToRegex | 新建 `src/glob.ts` 或扩展 `utils.ts` | `feedback.ts` L309-336 与 `file-filter.ts` L112-166 合并 |
| 17 | 提取共用规则有效性计算 | `metrics.ts` L371-416 复用 `feedback.ts` L624-660 | 或反之，统一到 `feedback.ts` |
| 18 | 静默 catch 添加日志 | cache.ts / orchestrator.ts / ai-reflection.ts / state.ts / comment-publisher.ts / mcp-adapter.ts | 至少 `console.warn` 或集成 `progress` 事件流 |
| 19 | 补齐 5 条内置 FP 规则 | `src/post-processor.ts` BUILTIN_FP_RULES | 设计要求 17 条，实际 12 条 |

### P5：精度与简化实现优化（最低优先）

| # | 改进项 | 文件 | 操作 |
|---|---|---|---|
| 20 | 替换字符数/4 token 估算 | `prompt-builder.ts` L425 / `token-optimizer.ts` L259-262 | 引入 tiktoken 或 @anthropic-ai/tokenizer |
| 21 | 实现真正的 LCS 文本重叠计算 | `post-processor.ts` L381 computeTextOverlap | 替换子串包含算法 |
| 22 | 实现端到端 CLI 审查模式 | `src/cli.ts` | 添加 `--execute` 标志，调用 LLM 完成审查（可选，设计取舍） |

---

## 七、Assumptions & Decisions

### 7.1 关键假设
- 用户希望 `code-review` 包能作为独立 npm 包发布并被消费
- 占位/stub 实现属于"框架先行、业务后填"的设计意图，应补全而非删除
- 设计文档中"17 条 FP 规则"为承诺目标，应补齐而非视为文档错误

### 7.2 决策记录
- **不改名再发生**：项目已从 `opencode-code-review` 改名为 `code-review`，本次分析以新名为准
- **保留 Stub 实现**：不删除 `PipelineMiddleware` 类型定义、`buildReviewDag` 节点结构等"定义但未实现"的代码，而是补全实现
- **优先级排序**：P0（阻塞发布）> P1（CI/CD）> P2（功能完整性）> P3（测试）> P4（质量）> P5（精度）
- **范围限定**：本次分析不包含对 HTML 报告查看器（`/workspace/code-review/`）的评估，仅聚焦 npm 包本身

### 7.3 风险与权衡
- 补全 DAG handler 与 middleware 钩子会引入对 LLM 调用的依赖，需要决定是否在编排层引入"模型超时与降级"逻辑（已实现 `callModelWithTimeout`，可复用）
- 真实 MCP 集成测试需要 `code-review-graph` 二进制存在，CI 环境可能无法获取
- 补齐 FP 规则可能影响现有 `tests/benchmark/accuracy.test.ts` 的 filterRate 阈值断言

---

## 八、验证步骤

完成上述改进后，按以下顺序验证：

### 8.1 本地验证
```bash
cd /workspace/code-review-pkg
npm run lint                    # TypeScript 严格模式无错误
npm run test                    # 全部测试通过
npm run test -- --coverage     # 覆盖率 ≥ 90%
npm run build                   # 构建成功，dist/ 生成
npm pack --dry-run              # 验证 files 字段包含正确文件
node dist/cli.js --help         # CLI 帮助正常输出
```

### 8.2 npm publish 验证
```bash
npm pack                        # 生成 .tgz
tar -tzf code-review-0.1.0.tgz | head -50   # 检查包内容
# 验证包含 dist/cli.js / dist/index.js / dist/index.d.ts / review-rules/ / opencode-config/
```

### 8.3 CI 验证
- 推送分支后，新的 `ci.yml` workflow 应全部通过
- 覆盖率上报到 Codecov（如配置）
- Release workflow 在 tag 推送时触发 npm publish

### 8.4 功能验证（补全 Stub 后）
- `runPipelineWithMiddleware` 的 `afterParse` / `afterFilter` 钩子被实际触发
- `runPipelineBatched` 的 processFn 产出非空 findings
- `buildReviewDag` 的 3 个节点 handler 产出真实 findings
- `post-process.js` 的 afterReview 钩子调用 `code-review` 后处理函数

---

## 九、参考资料

- 设计文档：`/workspace/code-review-pkg/SPEC.md`、`/workspace/code-review-pkg/docs/architecture.md`
- 实施 spec：`/workspace/.trae/specs/implement-ocr-system/spec.md`
- 实施清单：`/workspace/.trae/specs/implement-ocr-system/checklist.md`
- 当前源码：`/workspace/code-review-pkg/src/`（24 个 .ts 文件）
- 当前测试：`/workspace/code-review-pkg/tests/`（33 个测试文件）
- 改名历史：`/workspace/.trae/documents/rename_opencode_code_review_plan.md`
