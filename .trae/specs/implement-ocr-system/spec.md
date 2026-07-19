# OpenCode AI 代码检视系统实现 Spec

## Why
基于已完成的优化方案（[opencode-code-review-optimized.html](file:///workspace/opencode-code-review/opencode-code-review-optimized.html)），将设计落地为可运行的代码系统。采用 TDD（测试驱动开发）方式确保质量，通过 10 次迭代逐步完善功能，最终推送到 GitHub 仓库。

## What Changes
- 新增 `ocr-pipe` TypeScript CLI 工具：确定性管道层（Git Diff 解析、文件过滤、规则引擎、图谱网关）
- 新增 OpenCode 配置：3 个 Agent（通用审查 / 安全审查 / 影响分析）+ 1 个反思 Agent
- 新增 4 个自定义命令：`/review`、`/security-review`、`/scan`、`/review-pr`
- 新增规则引擎：YAML 规则定义 + 匹配器 + 8+ 条基础规则
- 新增三阶段后处理模块：硬规则过滤 + 定位修正 + AI 反思
- 新增状态管理层：SQLite 审查结果存储 + 三级缓存
- 新增反馈闭环：PR 评论交互 + 反馈数据库
- 新增 GitHub Action 工作流：CI 自动审查
- 新增完整测试套件（TDD：测试先行）
- 迭代优化 10 次：性能、精度、体验、稳定性
- **BREAKING**：无（全新项目，不影响现有代码）

## Impact
- Affected specs: 无（全新 spec）
- Affected code:
  - 新建 `packages/ocr-pipe/` — 确定性管道 CLI
  - 新建 `packages/orchestrator/` — 编排控制层 Plugin
  - 新建 `packages/post-process/` — 后处理模块
  - 新建 `packages/state/` — 状态与数据层
  - 新建 `packages/feedback/` — 反馈闭环
  - 新建 `.opencode/agents/` — Agent 定义
  - 新建 `.opencode/commands/` — 命令定义
  - 新建 `review-rules/` — 规则包
  - 新建 `.github/workflows/` — CI 工作流
  - 新建 `tests/` — 完整测试套件

## ADDED Requirements

### Requirement: TDD 开发流程
系统 SHALL 采用测试驱动开发：所有功能必须先写测试（红），再写实现（绿），最后重构（重构）。

#### Scenario: 新功能开发
- **WHEN** 开发者开始实现新功能
- **THEN** 必须先在 `tests/` 目录下编写失败的测试用例
- **AND** 运行测试确认失败（红）
- **AND** 编写最小实现使测试通过（绿）
- **AND** 重构代码保持测试通过

#### Scenario: 测试覆盖率
- **WHEN** 所有功能开发完成
- **THEN** 核心模块测试覆盖率 SHALL ≥ 80%
- **AND** 关键路径（Diff 解析、规则匹配、后处理）覆盖率 SHALL = 100%

### Requirement: ocr-pipe 确定性管道 CLI
系统 SHALL 提供 `ocr-pipe` 命令行工具，作为确定性管道层的实现载体。

#### Scenario: 分析 Git Diff
- **WHEN** 执行 `ocr-pipe analyze --from main --to HEAD --format json`
- **THEN** 输出包含 `changed_files`、`file_groups`、`review_units` 的结构化 JSON
- **AND** 支持参数：`--from`、`--to`、`--with-graph`、`--with-rules`、`--format`

#### Scenario: 文件过滤与智能打包
- **WHEN** 变更包含关联文件（如 i18n 配对文件）
- **THEN** 系统将关联文件归并为同一审查单元
- **AND** 支持 glob/正则过滤排除文件（如 `**/test_*.py`）

#### Scenario: 规则引擎匹配
- **WHEN** 执行规则匹配
- **THEN** 输出包含 `rule_id`、`severity`、`file`、`line`、`annotations` 的匹配结果
- **AND** 支持 YAML 格式规则定义
- **AND** 支持 regex 和 glob 匹配

### Requirement: 规则引擎
系统 SHALL 提供 YAML 驱动的规则引擎，用于确定性预标注。

#### Scenario: 加载规则
- **WHEN** 系统启动并加载 `review-rules/` 目录
- **THEN** 解析所有 `.yaml` 规则文件
- **AND** 校验 schema（id、name、severity、match 等字段）
- **AND** 失败的规则被跳过并记录警告

#### Scenario: 规则匹配
- **WHEN** 输入文件内容
- **THEN** 对每条规则执行匹配
- **AND** 输出匹配位置（file + line）和标注信息
- **AND** 尊重 `exclude` 字段跳过指定文件

### Requirement: 三阶段后处理
系统 SHALL 提供三阶段后处理流水线，对 Agent 输出的 findings 进行清洗。

#### Scenario: 硬规则过滤
- **WHEN** 输入 findings
- **THEN** 应用 17 条正则排除规则
- **AND** 过滤 DOS/速率限制/非 C/C++ 内存安全等低价值发现
- **AND** 输出剩余 findings

#### Scenario: 定位修正
- **WHEN** findings 包含文件路径和行号
- **THEN** 验证文件存在性
- **AND** 校准行号（基于 diff 偏移量）
- **AND** 标记无法定位的 finding 为 `unlocatable`

#### Scenario: AI 反思过滤
- **WHEN** 输入剩余 findings
- **THEN** 调用小模型（Haiku）对每个 finding 评估置信度
- **AND** 低于阈值（默认 0.6）的 finding 被过滤
- **AND** 输出最终 findings 及置信度

### Requirement: 状态与数据层
系统 SHALL 提供 SQLite 状态存储，管理审查会话和结果。

#### Scenario: 审查会话管理
- **WHEN** 触发审查
- **THEN** 创建会话记录（id、status、started_at、config）
- **AND** 状态可为：pending / running / completed / failed
- **AND** 支持断点续审

#### Scenario: 结果持久化
- **WHEN** 审查完成
- **THEN** 所有 findings 写入数据库
- **AND** 支持按 session_id、file、severity 查询
- **AND** 支持历史趋势统计

### Requirement: 反馈闭环
系统 SHALL 采集开发者对审查结果的反馈，用于持续优化。

#### Scenario: 反馈采集
- **WHEN** 开发者对 finding 提交反馈（accept/reject/modify）
- **THEN** 记录到反馈数据库
- **AND** 包含 finding_id、action、reason、timestamp

#### Scenario: 误报模式识别
- **WHEN** 累计反馈数据 ≥ 100 条
- **THEN** 自动聚类频繁误报模式
- **AND** 生成规则优化建议

### Requirement: OpenCode Agent 配置
系统 SHALL 定义 4 个 OpenCode Agent，各司其职。

#### Scenario: 通用审查 Agent
- **WHEN** 配置 `code-reviewer` Agent
- **THEN** 使用中等模型（如 claude-sonnet）
- **AND** 禁用 write/edit 工具（只读审查）
- **AND** 加载质量规则指令

#### Scenario: 安全审查 Agent
- **WHEN** 配置 `security-reviewer` Agent
- **THEN** 使用强模型（如 claude-opus）
- **AND** 加载安全审查三层方法论 Prompt
- **AND** 加载 17 条误报过滤规则

#### Scenario: 影响分析 Agent
- **WHEN** 配置 `impact-analyzer` Agent
- **THEN** 使用小模型（如 claude-haiku）
- **AND** 基于 blast-radius 数据生成风险评分

#### Scenario: 反思校验 Agent
- **WHEN** 配置 `reflector` Agent
- **THEN** 使用小模型
- **AND** 对汇总 findings 做统一置信度评估

### Requirement: 自定义命令
系统 SHALL 提供 4 个 OpenCode 自定义命令。

#### Scenario: /review 命令
- **WHEN** 执行 `/review`
- **THEN** 调用 `ocr-pipe analyze` 获取结构化上下文
- **AND** 调用 `code-reviewer` Agent 审查
- **AND** 经过三阶段后处理
- **AND** 输出到终端 TUI

#### Scenario: /security-review 命令
- **WHEN** 执行 `/security-review`
- **THEN** 调用 `security-reviewer` Agent
- **AND** 应用安全专项 Prompt 和双层过滤

#### Scenario: /scan 命令
- **WHEN** 执行 `/scan src/auth/`
- **THEN** 全量扫描指定目录（无需 Git 历史）
- **AND** 输出 JSON 报告

#### Scenario: /review-pr 命令
- **WHEN** 执行 `/review-pr 123`
- **THEN** 获取指定 PR 的 diff
- **AND** 执行完整审查流程
- **AND** 发布 PR inline 评论

### Requirement: GitHub Action 集成
系统 SHALL 提供 GitHub Action 工作流，在 PR 时自动审查。

#### Scenario: PR 触发审查
- **WHEN** PR 被 opened 或 synchronize
- **THEN** 自动运行 `/review` 命令
- **AND** 发布 inline 评论（支持 sticky summary）
- **AND** 增量去重已评论过的 finding

### Requirement: 10 次迭代优化
系统 SHALL 经过 10 次迭代优化，每次有明确的优化目标和验证标准。

#### Scenario: 迭代 1-3：核心稳定性
- **WHEN** 完成迭代 1-3
- **THEN** 修复所有 P0/P1 bug
- **AND** 测试覆盖率达标（≥80%）
- **AND** 基础审查链路稳定运行

#### Scenario: 迭代 4-6：性能与成本
- **WHEN** 完成迭代 4-6
- **THEN** 三级缓存命中率 ≥ 60%
- **AND** 大 PR（50+ 文件）审查时间 ≤ 5 分钟
- **AND** 平均 Token 消耗下降 30%

#### Scenario: 迭代 7-10：精度与体验
- **WHEN** 完成迭代 7-10
- **THEN** 误报率 ≤ 15%
- **AND** finding 接受率 ≥ 40%
- **AND** 用户反馈净推荐值 ≥ 7

### Requirement: GitHub 推送
系统 SHALL 将所有代码推送到 GitHub 仓库。

#### Scenario: 推送前检查
- **WHEN** 准备推送
- **THEN** 所有测试通过
- **AND** 代码格式化（prettier/eslint）
- **AND** 提交信息遵循 Conventional Commits

#### Scenario: 推送执行
- **WHEN** 执行推送
- **THEN** 推送到 main 分支（或 feature 分支）
- **AND** 包含完整代码、测试、文档
- **AND** 仓库包含 README、LICENSE、CONTRIBUTING
