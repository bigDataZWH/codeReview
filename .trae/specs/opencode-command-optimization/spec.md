# OpenCode Command 深度优化 Spec

## Why
当前 OpenCode 命令入口存在多处功能缺口、输出格式不一致、Agent 协同缺失、插件能力不足等问题。需要系统性补齐命令覆盖范围，统一输出格式，建立完整的 DAG 编排链路，扩展插件钩子能力，并完善可观测性与文档。

## What Changes
- 新增 `/impact` 命令（P0）
- 新增 `/reflect` 命令（P0）
- 完善 `/review-pr` 的发布步骤（P0）
- 统一所有命令输出格式为 Finding JSON Schema（P1）
- 改进 `/scan` 命令的文件发现与语言识别（P1）
- 实现命令级 DAG 编排串联四个 Agent（P2）
- 扩展 post-process.js 钩子能力（P2/P3）
- 新增 `/metrics`、`/dashboard`、`/feedback` 命令（P4）
- 完善文档与规则同步（P5）
- 优化大 PR 分批处理与缓存可见性（P6）

## Impact
- Affected specs: code-review package 的 OpenCode 集成层、CLI 命令、pipeline 编排
- Affected code: `opencode-config/.opencode/commands/`、`opencode-config/.opencode/plugins/post-process.js`、`src/cli.ts`、`src/orchestrator.ts`、`src/pipeline.ts`

## ADDED Requirements

### Requirement: `/impact` 命令
The system SHALL provide an `/impact` command that analyzes the blast radius of code changes.

#### Scenario: 变更影响范围分析
- **WHEN** user triggers `/impact`
- **THEN** system runs `git diff main...HEAD`, calls impact-analyzer Agent, outputs JSON array of affected files with risk scores

### Requirement: `/reflect` 命令
The system SHALL provide a `/reflect` command that performs unified confidence assessment on findings.

#### Scenario: 置信度评估
- **WHEN** user triggers `/reflect <findings-json>`
- **THEN** system calls reflector Agent, returns confidence scores for each finding

### Requirement: `/review-pr` 发布流程
The system SHALL complete the `/review-pr` command with automatic comment publishing.

#### Scenario: PR 审查与发布
- **WHEN** user triggers `/review-pr <pr-number>`
- **THEN** system runs review pipeline AND publishes findings to PR as inline comments

### Requirement: 统一输出格式
All OpenCode commands SHALL output findings in a consistent JSON Schema aligned with the `Finding` type.

#### Scenario: 跨命令格式一致性
- **WHEN** user runs `/review`, `/security-review`, `/scan`, `/review-pr`
- **THEN** all commands return JSON array with `{file, line, severity, category, message, suggestion, confidence, source}`

### Requirement: DAG 编排命令
The system SHALL support multi-Agent orchestration through a DAG pipeline.

#### Scenario: 多 Agent 串联审查
- **WHEN** user triggers `/review`
- **THEN** system executes: rule-engine + code-reviewer + security-reviewer (并行) → impact-analyzer (串联) → reflector (聚合)

### Requirement: 扩展插件钩子
The post-process plugin SHALL provide `beforeReview`, `afterReview`, `afterPublish` hooks.

#### Scenario: 完整生命周期钩子
- **WHEN** a review session starts
- **THEN** `beforeReview` is called to inject rules/filters
- **WHEN** findings are produced
- **THEN** `afterReview` processes findings
- **WHEN** comments are published
- **THEN** `afterPublish` records feedback

### Requirement: 可观测性命令
The system SHALL provide `/metrics` and `/dashboard` commands for session-level analytics.

#### Scenario: 审查度量查看
- **WHEN** user triggers `/metrics`
- **THEN** system displays review KPIs (findings count, severity distribution, false positive rate)

### Requirement: 反馈命令
The system SHALL provide `/feedback` command for interactive false-positive marking.

#### Scenario: 误报标记
- **WHEN** user triggers `/feedback <id> false-positive`
- **THEN** system records feedback and updates rule effectiveness

## MODIFIED Requirements

### Requirement: `/scan` 命令增强
The `/scan` command SHALL support:
- Automatic language detection via `detectLanguage`
- Generated file exclusion via `excludeGeneratedFiles`
- Configurable file limit via `--limit` parameter

### Requirement: `/review` 命令增强
The `/review` command SHALL:
- Trigger DAG orchestration with all four Agents
- Support `--dry-run` and `--verbose` flags

### Requirement: post-process.js 工具扩展
The `code-review` tool in post-process.js SHALL:
- Call `runPipeline` instead of just returning truncated diff
- Support `--execute` and `--llm-config` parameters

## REMOVED Requirements
None