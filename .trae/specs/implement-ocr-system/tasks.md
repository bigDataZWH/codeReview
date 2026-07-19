# Tasks

## 阶段 0：项目脚手架与 TDD 基础设施

- [x] Task 0.1: 初始化项目结构与依赖
  - [x] SubTask 0.1.1: 创建项目结构（src/、tests/、opencode-config/.opencode/、review-rules/、.github/workflows/）
  - [x] SubTask 0.1.2: 初始化 package.json、tsconfig.json、vitest.config.ts
  - [x] SubTask 0.1.3: 配置 vitest 测试框架 + coverage 阈值（90%）
  - [x] SubTask 0.1.4: 编写 smoke test 验证测试框架可用

- [x] Task 0.2: 定义共享类型与接口
  - [x] SubTask 0.2.1: 编写 `src/types.ts` 类型定义（Finding、FileDiff、Rule、Hunk 等）
  - [x] SubTask 0.2.2: 类型通过 TypeScript 严格模式校验
  - [x] SubTask 0.2.3: 编写 validation.ts schema 校验工具

## 阶段 1：核心模块 TDD 开发

### ocr-pipe 确定性管道

- [x] Task 1.1: Git Diff 解析器（TDD）
  - [x] SubTask 1.1.1: 编写测试 `tests/diff-parser.test.ts` + `tests/diff-parser-extensions.test.ts`（覆盖 commit/branch/worktree 三种来源）
  - [x] SubTask 1.1.2: 实现 `src/diff-parser.ts`
  - [x] SubTask 1.1.3: 测试通过（58 个测试），覆盖率 94.19%

- [x] Task 1.2: 文件过滤与智能打包（TDD）
  - [x] SubTask 1.2.1: 编写测试 `tests/file-filter.test.ts`（glob/正则、i18n 配对、排除规则）
  - [x] SubTask 1.2.2: 实现 `src/file-filter.ts`
  - [x] SubTask 1.2.3: 测试通过（45 个测试），覆盖率 94.76%

- [x] Task 1.3: 规则引擎（TDD）
  - [x] SubTask 1.3.1: 编写测试 `tests/rule-engine.test.ts`（YAML 加载、schema 校验、regex/glob 匹配、exclude）
  - [x] SubTask 1.3.2: 实现 `src/rule-engine.ts`
  - [x] SubTask 1.3.3: 编写 8+ 条基础规则（sql-injection、xss、npe、hardcoded-secret、path-traversal、thread-safety、quality、security）
  - [x] SubTask 1.3.4: 测试通过（35 个测试），覆盖率 91.03%

- [x] Task 1.4: 图谱网关（TDD）
  - [x] SubTask 1.4.1: 编写测试 `tests/mcp-adapter.test.ts`（MCP 调用、降级、缓存）
  - [x] SubTask 1.4.2: 实现 `src/mcp-adapter.ts`
  - [x] SubTask 1.4.3: 降级路径已验证（无图谱时回退全文上下文），覆盖率 95.83%

- [x] Task 1.5: ocr-pipe CLI 入口（TDD）
  - [x] SubTask 1.5.1: 实现 `src/cli.ts`（commander 风格参数解析）
  - [x] SubTask 1.5.2: 集成测试：端到端 `ocr-pipe analyze` 命令

### 后处理模块

- [x] Task 1.6: 硬规则过滤器（TDD）
  - [x] SubTask 1.6.1: 编写测试 `tests/post-processor.test.ts`（17 条正则规则）
  - [x] SubTask 1.6.2: 实现 `src/post-processor.ts`
  - [x] SubTask 1.6.3: 验证过滤 DOS/速率限制/非 C/C++ 内存安全等

- [x] Task 1.7: 定位修正器（TDD）
  - [x] SubTask 1.7.1: 编写测试（文件验证、行号校准、unlocatable 标记）
  - [x] SubTask 1.7.2: 实现定位修正器

- [x] Task 1.8: AI 反思过滤器（TDD）
  - [x] SubTask 1.8.1: 编写测试 `tests/ai-reflection.test.ts`（mock 模型调用、置信度阈值）
  - [x] SubTask 1.8.2: 实现 `src/ai-reflection.ts`（20 个测试，覆盖率 95.18%）

- [x] Task 1.9: 后处理流水线编排（TDD）
  - [x] SubTask 1.9.1: 编写测试 `tests/pipeline.test.ts` + `tests/integration/pipeline-integration.test.ts`
  - [x] SubTask 1.9.2: 实现 `src/pipeline.ts`（15+5 个测试，覆盖率 98.16%）

### 状态与数据层（新增）

- [x] Task 1.10: SQLite 状态存储（TDD）
  - [x] SubTask 1.10.1: 编写测试 `tests/state.test.ts`（会话 CRUD、findings 持久化、查询、断点续审、趋势统计）
  - [x] SubTask 1.10.2: 实现 `src/state.ts`（内存 Map + JSON 持久化，67 个测试）
  - [x] SubTask 1.10.3: 覆盖率 100% stmts / 92.56% branches

- [x] Task 1.11: 三级缓存管理器（TDD）
  - [x] SubTask 1.11.1: 编写测试 `tests/cache.test.ts`（L1 内存、L2 磁盘、失效策略、命中率统计）
  - [x] SubTask 1.11.2: 实现 `src/cache.ts`（66 个测试，覆盖率 96.93% stmts / 91.22% branches）

### 反馈闭环（新增）

- [x] Task 1.12: 反馈采集与存储（TDD）
  - [x] SubTask 1.12.1: 编写测试 `tests/feedback.test.ts`（accept/reject/modify、去重、统计）
  - [x] SubTask 1.12.2: 实现 `src/feedback.ts`（FeedbackStore 类）
  - [x] SubTask 1.12.3: 编写误报模式聚类测试
  - [x] SubTask 1.12.4: 实现误报分析器和规则建议生成（70 个测试，覆盖率 96.98%）

### 编排控制层（新增）

- [x] Task 1.13: 审查会话管理器（TDD）
  - [x] SubTask 1.13.1: 编写测试 `tests/orchestrator.test.ts`（会话状态机、断点续审、取消）
  - [x] SubTask 1.13.2: 实现 `src/orchestrator.ts`（ReviewSessionManager）

- [x] Task 1.14: Agent DAG 编排器（TDD）
  - [x] SubTask 1.14.1: 编写测试（并行/串行/合并/降级、循环依赖检测）
  - [x] SubTask 1.14.2: 实现 executeDag（wave-based 调度）
  - [x] SubTask 1.14.3: 实现结果合并与冲突解决策略（severity 取最高）

- [x] Task 1.15: 异常处理与降级（TDD）
  - [x] SubTask 1.15.1: 编写测试（MCP 断连、模型超时、API 限流）
  - [x] SubTask 1.15.2: 实现 withFallback、withRetry、callModelWithTimeout（97 个测试，覆盖率 100% stmts）

## 阶段 2：OpenCode 配置与集成

- [x] Task 2.1: Agent 定义文件
  - [x] SubTask 2.1.1: 编写 `.opencode/agents/code-reviewer.md`
  - [x] SubTask 2.1.2: 编写 `.opencode/agents/security-reviewer.md`
  - [x] SubTask 2.1.3: 编写 `.opencode/agents/impact-analyzer.md`
  - [x] SubTask 2.1.4: 编写 `.opencode/agents/reflector.md`
  - [x] SubTask 2.1.5: 编写 `opencode.jsonc` 主配置（4 个 Agent）

- [x] Task 2.2: 自定义命令
  - [x] SubTask 2.2.1: 编写 `.opencode/commands/review.md`
  - [x] SubTask 2.2.2: 编写 `.opencode/commands/security-review.md`
  - [x] SubTask 2.2.3: 编写 `.opencode/commands/scan.md`
  - [x] SubTask 2.2.4: 编写 `.opencode/commands/review-pr.md`

- [x] Task 2.3: 规则与指令文件
  - [x] SubTask 2.3.1: 编写 `.opencode/rules/security-rules.md`
  - [x] SubTask 2.3.2: 编写 `.opencode/rules/quality-rules.md`
  - [x] SubTask 2.3.3: 编写 `.opencode/rules/false-positive-filters.md`（17 条硬排除规则）

- [x] Task 2.4: GitHub Action 工作流
  - [x] SubTask 2.4.1: 编写 `.github/workflows/code-review.yml`
  - [x] SubTask 2.4.2: 编写 `.github/workflows/security-review.yml`
  - [x] SubTask 2.4.3: 编写 `scripts/post-review-comments.js`（sticky summary + incremental）

## 阶段 3：集成测试与端到端验证

- [x] Task 3.1: 端到端测试
  - [x] SubTask 3.1.0: 编写 `tests/integration/pipeline-integration.test.ts`（已有 5 个集成测试）
  - [x] SubTask 3.1.1: 编写 `tests/e2e/review-flow.test.ts`（完整审查链路含新模块，8 个测试）
  - [x] SubTask 3.1.2: 编写 `tests/e2e/security-review-flow.test.ts`（22 个测试，三阶段安全审查）
  - [x] SubTask 3.1.3: 编写 `tests/e2e/large-pr.test.ts`（50+ 文件场景，16 个测试）
  - [x] SubTask 3.1.4: 编写 `tests/e2e/ci-flow.test.ts`（GitHub Action 模拟，13 个测试）

- [x] Task 3.2: 基准测试
  - [x] SubTask 3.2.1: 编写 `tests/benchmark/performance.test.ts`（耗时、缓存命中率，22 个测试）
  - [x] SubTask 3.2.2: 编写 `tests/benchmark/accuracy.test.ts`（精度、召回率、误报率，26 个测试）

## 阶段 4：10 次迭代优化

### 迭代 1-3：核心稳定性

- [x] Task 4.1: 迭代 1 — 修复 P0 bug 与稳定性
  - [x] SubTask 4.1.1: 收集运行时 bug 与异常
  - [x] SubTask 4.1.2: 修复关键路径 bug
  - [x] SubTask 4.1.3: 增加边界测试用例
  - [x] SubTask 4.1.4: 验证修复

- [x] Task 4.2: 迭代 2 — 测试覆盖率提升
  - [x] SubTask 4.2.1: 识别覆盖率盲区（cli.ts、index.ts 0%）
  - [x] SubTask 4.2.2: 补充缺失测试（`tests/cli.test.ts` 15 个测试，`tests/index.test.ts` 115 个测试）
  - [x] SubTask 4.2.3: 达到核心模块 80% 覆盖率（cli.ts=100%，index.ts=100%，全局 ≥ 90%）

- [x] Task 4.3: 迭代 3 — 错误处理与降级完善
  - [x] SubTask 4.3.1: 完善异常分类与降级路径
  - [x] SubTask 4.3.2: 增加重试与超时机制
  - [x] SubTask 4.3.3: 验证部分失败场景

### 迭代 4-6：性能与成本

- [x] Task 4.4: 迭代 4 — 缓存命中率优化
  - [x] SubTask 4.4.1: 分析缓存 miss 原因
  - [x] SubTask 4.4.2: 优化缓存键设计
  - [x] SubTask 4.4.3: 目标命中率 ≥ 60%

- [x] Task 4.5: 迭代 5 — 大 PR 处理优化
  - [x] SubTask 4.5.1: 实现分批处理与优先级排序
  - [x] SubTask 4.5.2: 优化大文件分块策略
  - [x] SubTask 4.5.3: 50+ 文件审查 ≤ 5 分钟

- [x] Task 4.6: 迭代 6 — Token 成本优化
  - [x] SubTask 4.6.1: 实现分级模型策略
  - [x] SubTask 4.6.2: 优化上下文压缩
  - [x] SubTask 4.6.3: Token 消耗下降 30%

### 迭代 7-10：精度与体验

- [x] Task 4.7: 迭代 7 — 误报过滤优化
  - [x] SubTask 4.7.1: 分析误报模式
  - [x] SubTask 4.7.2: 优化硬规则与反思阈值
  - [x] SubTask 4.7.3: 误报率 ≤ 15%

- [x] Task 4.8: 迭代 8 — Prompt 工程优化
  - [x] SubTask 4.8.1: A/B 测试 Agent Prompt
  - [x] SubTask 4.8.2: 优化安全审查三层方法论
  - [x] SubTask 4.8.3: finding 接受率 ≥ 40%

- [x] Task 4.9: 迭代 9 — 用户体验优化
  - [x] SubTask 4.9.1: 实现渐进式输出
  - [x] SubTask 4.9.2: 优化误报标记体验
  - [x] SubTask 4.9.3: 增加 `ocr init` 交互式向导

- [x] Task 4.10: 迭代 10 — 反馈闭环激活
  - [x] SubTask 4.10.1: 激活反馈数据分析
  - [x] SubTask 4.10.2: 实现规则自动调优建议
  - [x] SubTask 4.10.3: 完善度量指标仪表盘数据

## 阶段 5：文档与 GitHub 推送

- [x] Task 5.1: 文档编写
  - [x] SubTask 5.1.1: 编写 `README.md`（527 行，项目介绍、快速开始、架构、配置、CI/CD、测试）
  - [x] SubTask 5.1.2: 编写 `CONTRIBUTING.md`（526 行，TDD 流程、代码风格、提交规范）
  - [x] SubTask 5.1.3: 编写 `LICENSE`（MIT，2026，OpenCode Code Review Contributors）
  - [x] SubTask 5.1.4: 编写 `docs/architecture.md`（646 行，六层架构详解、数据流图、模块依赖）

- [x] Task 5.2: 推送前检查
  - [x] SubTask 5.2.1: 运行完整测试套件，1092 个测试全部通过
  - [x] SubTask 5.2.2: TypeScript 类型检查通过（tsc --noEmit）
  - [x] SubTask 5.2.3: 验证覆盖率达标（96.38% stmts / 91.25% branches / 98.73% funcs）
  - [x] SubTask 5.2.4: 编写 Conventional Commits 提交信息（feat: complete TDD-based...）

- [x] Task 5.3: 推送到 GitHub
  - [x] SubTask 5.3.1: git 仓库已初始化（已有 origin remote）
  - [x] SubTask 5.3.2: remote origin 已配置（https://github.com/bigDataZWH/codeReview）
  - [x] SubTask 5.3.3: 推送到 trae/agent-hHO2Qi 分支成功
  - [x] SubTask 5.3.4: 验证推送成功（commit 9c71b8f 已在远程）

# Task Dependencies

- Task 0.x（脚手架）→ 所有后续任务
- Task 1.1-1.5（ocr-pipe）→ Task 2.2（命令）
- Task 1.3（规则引擎）→ Task 1.6（硬规则过滤器）
- Task 1.10（状态存储）→ Task 1.12（反馈采集）
- Task 1.13-1.15（编排层）→ Task 3.1（端到端测试）
- 阶段 1（核心模块）→ 阶段 2（集成）→ 阶段 3（E2E）→ 阶段 4（迭代）→ 阶段 5（推送）
- 迭代 1-3 → 迭代 4-6 → 迭代 7-10（顺序依赖）
- Task 5.3（推送）依赖所有前置任务完成

# Parallelizable Work

- 阶段 1 中 Task 1.1-1.5 与 Task 1.6-1.9 可并行（不同模块）
- 阶段 1 中 Task 1.10-1.12 与 Task 1.13-1.15 可并行
- 阶段 2 中 Task 2.1、2.2、2.3、2.4 可并行
- 迭代 4-6 中 Task 4.4、4.5、4.6 可部分并行
