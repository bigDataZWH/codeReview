# 架构详解

本文档描述 `code-review` 的六层架构、数据流与模块依赖关系。设计目标是把"AI 审 PR"固化为**确定性优先、AI 辅助**的工程化管道。

> 配套阅读：[SPEC.md](../SPEC.md)（接口规格）、[README.md](../README.md)（快速上手）

---

## 目录

- [1. 设计原则](#1-设计原则)
- [2. 六层架构总览](#2-六层架构总览)
- [3. 各层详解](#3-各层详解)
  - [3.1 L1 触发层 Trigger](#31-l1-触发层-trigger)
  - [3.2 L2 编排层 Orchestrator](#32-l2-编排层-orchestrator)
  - [3.3 L3 管道层 Pipeline](#33-l3-管道层-pipeline)
  - [3.4 L4 Agent 层](#34-l4-agent-层)
  - [3.5 L5 状态层 State](#35-l5-状态层-state)
  - [3.6 L6 输出层 Output](#36-l6-输出层-output)
- [4. 数据流图](#4-数据流图)
- [5. 模块依赖关系](#5-模块依赖关系)
- [6. 关键数据类型流转](#6-关键数据类型流转)
- [7. 弹性与降级策略](#7-弹性与降级策略)

---

## 1. 设计原则

| 原则 | 含义 |
|---|---|
| **确定性优先** | 能用纯函数解决的环节绝不让 AI 参与；AI 只在判别阶段登场 |
| **管道可缓存** | 每个阶段输出稳定 hash，命中即跳过；L1+L2 两级缓存 |
| **Agent 可编排** | 多 Agent 通过 DAG 描述依赖，支持并行与降级 |
| **反馈可闭环** | 人工标注的误报回流到规则调优与 prompt 校准 |
| **可观测** | 渐进式事件流 + 度量指标 + 趋势分析三件套 |
| **失败友好** | 任何 IO 失败不阻塞主流程，降级到全文检索或缓存结果 |

---

## 2. 六层架构总览

```
┌────────────────────────────────────────────────────────────────┐
│ L1 触发层 (Trigger)                                             │
│   GitHub Action / CLI / OpenCode Command / Webhook            │
└──────────────────────────────┬─────────────────────────────────┘
                               │ diffText + 配置
┌──────────────────────────────▼─────────────────────────────────┐
│ L2 编排层 (Orchestrator)                                        │
│   ReviewSessionManager / executeDag / withRetry / withFallback │
└──────────────────────────────┬─────────────────────────────────┘
                               │ 调度指令
┌──────────────────────────────▼─────────────────────────────────┐
│ L3 管道层 (Pipeline)                                            │
│   parse → filter → bundle → rule → mcp → prompt-build          │
└──────────┬───────────────────────┬───────────────────┬────────┘
           │                       │                   │
┌──────────▼──────────┐ ┌────────▼────────┐ ┌─────────▼──────┐
│ L4 Agent 层          │ │ L5 状态层        │ │ 后处理三阶段    │
│ code-reviewer        │ │ StateStore       │ │ Locator → FP   │
│ security-reviewer    │ │ CacheManager     │ │ → Deduplicator │
│ impact-analyzer      │ │ FeedbackStore    │ └─────────┬──────┘
│ reflector            │ └────────┬────────┘           │
└──────────┬───────────┘          │                    │
           │ findings               │ 持久化/缓存          │
┌──────────▼────────────────────────▼────────────────────▼──────┐
│ L6 输出层 (Output)                                              │
│   comment-publisher (PR inline) / progress / metrics / format │
└───────────────────────────────────────────────────────────────┘
```

| 层 | 主要文件 | 核心导出 |
|---|---|---|
| L1 | `src/cli.ts`、`.github/workflows/code-review.yml`、`opencode-config/.opencode/commands/` | `parse` / `review` / `security-review` / `scan` / `impact` / `publish` |
| L2 | `src/orchestrator.ts` | `ReviewSessionManager`、`executeDag`、`withRetry`、`withFallback`、`batchProcess` |
| L3 | `src/pipeline.ts` + 6 个子模块 | `runPipeline`、`runSecurityPipeline`、`runPipelineWithMiddleware`、`runPipelineBatched` |
| L4 | `src/ai-reflection.ts` + OpenCode Agent 配置 | `reflectFindings`、`callLLM`、`buildReflectionPrompt` |
| L5 | `src/state.ts`、`src/cache.ts`、`src/feedback.ts` | `StateStore`、`CacheManager`、`FeedbackStore` |
| L6 | `src/comment-publisher.ts`、`src/progress.ts`、`src/metrics.ts`、`src/format.ts` | `publishReview`、`ProgressEmitter`、`collectMetrics` |

---

## 3. 各层详解

### 3.1 L1 触发层 Trigger

负责接收审查请求并转换为统一的管道输入。三种触发方式：

#### GitHub Action

`.github/workflows/code-review.yml` 在 PR `opened`/`synchronize` 时触发，调用 CLI 完成 diff 解析与评论发布。

```yaml
on:
  pull_request:
    types: [opened, synchronize]
```

#### CLI

`src/cli.ts` 暴露 6 个子命令：

| 命令 | 输入 | 输出 |
|---|---|---|
| `parse` | stdin diff | `FileDiff[]` JSON |
| `review` | stdin diff | 完整审查 prompt |
| `security-review` | stdin diff | 安全审查 prompt |
| `scan` | 路径 | 全量扫描 prompt |
| `impact` | stdin diff | 影响半径分析 prompt |
| `publish` | findings.json | GitHub PR 评论 |

#### OpenCode Command

`opencode-config/.opencode/commands/` 提供 4 个可被 OpenCode IDE 触发的子任务（`review` / `review-pr` / `security-review` / `scan`），通过 `!` 指令嵌入 shell 片段。

### 3.2 L2 编排层 Orchestrator

`src/orchestrator.ts` 是整个系统的**控制平面**，向上承接会话状态，向下调度管道与 Agent。

#### 核心能力

| 能力 | 函数 | 用途 |
|---|---|---|
| 会话管理 | `ReviewSessionManager` | 创建/暂停/恢复/列出审查会话 |
| DAG 编排 | `buildReviewDag`、`executeDag` | 构建审查任务 DAG 并按拓扑序执行 |
| 结果合并 | `mergeResults` | 合并多 Agent 输出的 findings |
| 智能跳过 | `shouldSkipImpactAnalysis` | 仅新增文档时跳过影响分析 |
| 优先级排序 | `prioritizeDiffs` | 按 severity / patch size 排序 diff |
| 批处理 | `batchProcess` | 分批处理大 PR |
| 重试 | `withRetry` | 指数退避重试 LLM 调用 |
| 降级 | `withFallback` | 主路径失败时切换备用路径 |
| 超时控制 | `callModelWithTimeout` | 防止 LLM 调用挂起 |

#### DAG 示例

```
            ┌────────────────────┐
            │  parseDiff         │
            └─────────┬──────────┘
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
  ┌──────────┐  ┌──────────┐  ┌─────────────┐
  │ code-    │  │ security-│  │ impact-     │
  │ reviewer │  │ reviewer │  │ analyzer    │
  └────┬─────┘  └────┬─────┘  └──────┬──────┘
       │              │               │
       └──────┬───────┘               │
              ▼                       │
        ┌──────────┐                  │
        │ reflector│◄─────────────────┘
        └────┬─────┘
             │
             ▼
       ┌──────────┐
       │ publish  │
       └──────────┘
```

`reflector` 会等待 `code-reviewer` 与 `security-reviewer` 完成后对汇总的 findings 做置信度评估；`impact-analyzer` 可并行执行，结果由 `mergeResults` 合并。

### 3.3 L3 管道层 Pipeline

`src/pipeline.ts` 是核心**数据平面**，把 diff 文本一步步变换为可发布的 findings。流水线 6 个步骤：

```
diffText
   │
   ▼ ① parseDiff
FileDiff[]
   │
   ▼ ② filterFiles (ignore / include / maxPatch / maxFiles)
FileDiff[] (过滤后)
   │
   ▼ ③ bundleFiles (i18n 对 / test 对 / 目录分组)
FileBundle[]
   │
   ▼ ④ matchRules (regex / contains_any / contains_all / ...)
AnnotatedBundle[] (附 RuleAnnotation[])
   │
   ▼ ⑤ getReviewContext (MCP 调用，可降级)
MCPContextResult (可选)
   │
   ▼ ⑥ buildReviewPrompt / buildSecurityPrompt / ...
Prompt 文本
   │
   ▼ AI 调用 (L4)
Finding[]
   │
   ▼ 后处理三阶段 (Locator → FalsePositive → Deduplicator)
Finding[] (清洁)
```

#### 缓存策略

步骤 ①②④⑤ 的输出按内容哈希缓存到 L1/L2：

| 步骤 | 缓存键 | TTL |
|---|---|---|
| ① parseDiff | `ocr:diff:<sha256(diffText)>` | `cacheOptions.diffTtlMs` |
| ④ matchRules | `ocr:rules:<ruleVersion>:<path>:<contentHash>:<rulesHash>` | 规则版本变更即失效 |
| ⑤ mcp-context | `ocr:mcp:<sha256(filePaths)>` | `cacheOptions.mcpTtlMs` |

未配置 `CacheManager` 时管道退化为直接执行，不引入额外开销。

#### 中间件

`runPipelineWithMiddleware` 支持插入 `PipelineMiddleware`：

```typescript
export type PipelineMiddleware = (ctx: PipelineContext, next: () => Promise<void>) => Promise<void>;
```

可用于：日志、指标采集、审计、A/B 测试 prompt 变体。

### 3.4 L4 Agent 层

实际调用 LLM 完成判别工作。所有 Agent 在 `opencode-config/opencode.jsonc` 中定义，统一以 `tools: { write: false, edit: false }` 配置，**只读不改**。

#### 顶层主模型继承机制

遵循 [OpenCode 官方约定](https://opencode.ai/docs/config)，`opencode.jsonc` 顶层通过 `"model": "anthropic/claude-sonnet-4-5"` 声明 **主 agent 模型**，所有 agent 不指定 `model` 时自动继承顶层主模型。这种"单一主模型配置源"避免每个 agent 重复声明导致的配置漂移；如需差异化可在 agent 内单独声明 `model` 覆盖顶层主模型。

| Agent | 模型来源 | 输入 | 输出 |
|---|---|---|---|
| `code-reviewer` | 继承顶层 `model` | review prompt | findings[] (含 severity / category / suggestion) |
| `security-reviewer` | 继承顶层 `model` | security prompt | findings[] (含 confidence) |
| `impact-analyzer` | 继承顶层 `model` | impact prompt | `BlastRadiusItem[]` + riskScore |
| `reflector` | 继承顶层 `model` | 批量 findings | `[{ id, confidence }]` |

#### 模型分层与成本控制

`src/token-optimizer.ts` 按代码复杂度（hunk 数 / 行数 / 语言）自动推荐模型层级（仅用于成本估算，不改变 agent 实际继承的顶层主模型）：

| 复杂度 | 推荐 Tier | 参考模型 |
|---|---|---|
| 简单（< 50 行变更） | `haiku` | `claude-haiku-4-5` |
| 中等 | `sonnet` | `claude-sonnet-4-5` |
| 复杂（安全/大改） | `opus` | `claude-opus-4-1-20250805` |

`estimateTokenCost` + `fitsInBudget` 防止超预算；`compressContext` 在超长 diff 时按重要性裁剪上下文。

#### AI 反思

`src/ai-reflection.ts` 的 `reflectFindings` 把多 Agent 输出的 findings 批量送入 `reflector` Agent，得到 0~1 的置信度评分。低于阈值 (`DEFAULT_REFLECTION_THRESHOLD`) 的 findings 被标记为低置信，进入 L3 的误报过滤器。

### 3.5 L5 状态层 State

支撑管道的持久化与可观测，由三个子模块组成：

#### 3.5.1 会话状态机 (`src/state.ts`)

```typescript
type SessionStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'interrupted';
```

- `createSession` → 创建新会话，返回 `sessionId`
- `updateSessionStatus` → 推进状态
- `saveFindings` / `getFindingsBySession` → findings 持久化
- `resumeInterruptedSessions` → 启动时恢复被中断的会话（断点续审）
- `getTrendStats` → 按时间窗统计趋势
- `getMetricsSummary` → 输出度量摘要

#### 3.5.2 三级缓存 (`src/cache.ts`)

```
                ┌──────────────────────────────┐
                │   CacheManager (统一入口)     │
                └──────────────┬───────────────┘
            ┌──────────────────┴───────────────────┐
            ▼                                      ▼
  ┌────────────────────┐                  ┌──────────────────┐
  │ L1MemoryCache      │                  │ L2DiskCache       │
  │ (LRU, 进程内)      │ miss             │ (持久化到磁盘)    │
  └─────────┬──────────┘                  └─────────┬────────┘
            │ hit                                    │ hit
            ▼                                        ▼
        调用方                                 调用方
```

- **L1**：进程内 LRU，毫秒级命中，用于热数据
- **L2**：磁盘 JSON 文件，跨进程共享，用于冷启动加速
- **失效策略**：内容哈希 + TTL + 显式 `ruleVersion` 触发

#### 3.5.3 反馈闭环 (`src/feedback.ts`)

```
   ┌─────────────────┐    markFalsePositive    ┌──────────────────┐
   │ 人工标注误报     │ ─────────────────────► │ FeedbackStore    │
   └─────────────────┘                          └────────┬─────────┘
                                                        │ 聚合
                                                        ▼
                              ┌──────────────────────────────────┐
                              │ FalsePositivePattern 分析         │
                              └────────────┬─────────────────────┘
                                           │
                  ┌────────────────────────┼────────────────────────┐
                  ▼                        ▼                        ▼
        ┌─────────────────┐   ┌──────────────────────┐   ┌──────────────────┐
        │ loadIgnoreConfig│   │ getRuleEffectiveness │   │ autoTuneRules    │
        │ shouldIgnore    │   │ (规则命中率/误报率)   │   │ (规则调优建议)    │
        └─────────────────┘   └──────────────────────┘   └──────────────────┘
```

- `loadIgnoreConfig` 读取 `.opencode-review-ignore`
- `shouldIgnore` 决定单个 finding 是否跳过
- `getRuleEffectiveness` 给每条规则打分（A/B/C/D 等级）
- `autoTuneRules` 输出 `RuleTuningSuggestion[]`（禁用 / 调整 severity / 调整模式）

### 3.6 L6 输出层 Output

#### 评论发布 (`src/comment-publisher.ts`)

三种发布模式：

| 模式 | 行为 | 适用场景 |
|---|---|---|
| `replace` | 删除旧 sticky summary 并新建 | 一次性审查 |
| `incremental` | 仅追加新 findings，跳过已存在评论 | CI 增量审查 |
| sticky | 更新同一 summary 评论而非新建 | 跟踪同一 PR 的多次推送 |

支持 GitHub Actions 内置 token 与外部 Octokit 两种调用方式。

#### 渐进式事件 (`src/progress.ts`)

`ProgressEmitter` 发布 6 类事件：

```typescript
type ProgressEvent =
  | { type: 'start'; payload: StartPayload }
  | { type: 'fileStart'; payload: FileStartPayload }
  | { type: 'fileComplete'; payload: FileCompletePayload }
  | { type: 'fileError'; payload: FileErrorPayload }
  | { type: 'complete'; payload: CompletePayload }
  | { type: 'error'; payload: ErrorPayload };
```

UI / 日志订阅后可实时展示进度，避免大 PR 长时间无反馈。

#### 度量与仪表盘 (`src/metrics.ts`)

四类度量：

| 类别 | 指标 |
|---|---|
| 覆盖 (Coverage) | 文件覆盖率、规则覆盖率 |
| 质量 (Quality) | findings 密度、严重级别分布、误报率 |
| 成本 (Cost) | Token 用量、模型调用次数、估算费用 |
| 效率 (Efficiency) | 端到端耗时、平均单文件耗时 |

`generateDashboardData` 输出可直接渲染的 KPI 与图表数据。

#### 格式化 (`src/format.ts`)

`formatFindingMarkdown` / `formatFindingsMarkdown` / `formatFindingsJSON` 输出 PR 评论与文件归档两种格式。

---

## 4. 数据流图

### 4.1 端到端主流程

```
┌─────────┐     diffText     ┌──────────────┐
│  PR /   │ ───────────────► │ diff-parser  │
│  CLI    │                  └──────┬───────┘
└─────────┘                         │ FileDiff[]
                                    ▼
                          ┌──────────────────┐
                          │  file-filter     │
                          └────────┬─────────┘
                                   │ FileDiff[] (filtered)
                                   ▼
                          ┌──────────────────┐
                          │   rule-engine    │ ◄── review-rules/*.yaml
                          └────────┬─────────┘
                                   │ AnnotatedBundle[]
                                   ▼
                ┌──────────────────┴──────────────────┐
                ▼                                     ▼
       ┌──────────────────┐                  ┌──────────────────┐
       │   mcp-adapter    │ ─── (可选) ───► │ code-review-graph│
       │   (or fallback)  │ ◄── context ──  │   (MCP Server)    │
       └────────┬─────────┘                  └──────────────────┘
                │ MCPContextResult
                ▼
       ┌──────────────────┐
       │  prompt-builder  │ ◄── template + custom rules
       └────────┬─────────┘
                │ Prompt
                ▼
   ┌─────────────────────────────┐
   │      Agent 层 (LLM)         │
   │  code-reviewer / security / │
   │  impact / reflector         │
   └──────────────┬──────────────┘
                  │ Finding[] (raw)
                  ▼
   ┌─────────────────────────────┐
   │      post-processor          │
   │  Locator → FalsePositive →  │
   │  Deduplicator (IoU)          │
   └──────────────┬──────────────┘
                  │ Finding[] (clean)
                  ▼
   ┌─────────────────────────────┐
   │   feedback (reflex)         │ ──► FeedbackStore
   │   state (persist)            │ ──► StateStore
   │   cache (memoize)            │ ──► CacheManager
   └──────────────┬──────────────┘
                  │
                  ▼
   ┌─────────────────────────────┐
   │   comment-publisher         │ ──► GitHub PR
   │   progress / metrics        │ ──► 事件流 / 仪表盘
   └─────────────────────────────┘
```

### 4.2 CI 增量场景

```
PR synchronize (新 commit 推送)
        │
        ▼
git diff base...head
        │
        ▼
runPipeline (复用 L1/L2 缓存)
        │
        ▼
fetchExistingPRComments ◄── GitHub API
        │
        ▼
deduplicateFindings(new, existing, iouThreshold=0.5)
        │
        ▼
publishReview(mode='incremental')
        │
        ▼
仅追加新 findings 的 inline 评论
```

### 4.3 反馈闭环

```
人工标记误报
     │
     ▼
FeedbackStore.markFalsePositive()
     │
     ▼
FalsePositivePattern 模式挖掘
     │
     ├──► 新增 .opencode-review-ignore 规则
     ├──► RuleEffectiveness 等级下降
     └──► autoTuneRules 输出建议
              │
              ▼
        规则 / prompt 调优
              │
              ▼
        下次管道执行时命中率提升
```

---

## 5. 模块依赖关系

### 5.1 依赖矩阵

下表中行依赖列；`●` 表示直接依赖，`○` 表示间接依赖（经中间模块）。

|  模块 \\ 依赖 → | types | utils | constants | diff-parser | file-filter | rule-engine | mcp-adapter | post-processor | prompt-builder | token-optimizer | ai-reflection | cache | state | feedback | orchestrator |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| diff-parser       | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| file-filter       | ● | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |
| rule-engine       | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| mcp-adapter       | ● | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |
| post-processor    | ● | ● | ● | ○ |   |   |   |   |   |   |   |   |   |   |   |
| prompt-builder    | ● | ● |   | ○ | ○ | ○ | ○ |   |   |   |   |   |   |   |   |
| token-optimizer   | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| ai-reflection     | ● |   |   |   |   |   |   |   | ● |   |   |   |   |   |   |
| cache             | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| state            | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| feedback         | ● | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| orchestrator     | ● | ● |   |   |   |   | ○ |   |   |   |   |   |   |   |   |
| pipeline         | ● | ● | ● | ● | ● | ● | ● | ● | ● |   |   | ● |   |   | ● |
| comment-publisher | ● |   |   |   |   |   |   | ● |   |   |   |   |   |   |   |
| progress         | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| metrics          | ● |   |   |   |   |   |   |   |   |   |   |   |   | ○ |   |   |
| init-wizard      | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| format           | ● | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| validation       | ● |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |

### 5.2 依赖关系图（简化）

```
                          ┌────────────┐
                          │  types.ts  │  (统一类型源)
                          └─────┬──────┘
              ┌─────────────────┼──────────────────┐
              │                 │                  │
       ┌──────▼─────┐    ┌──────▼──────┐    ┌──────▼──────┐
       │diff-parser │    │ rule-engine│    │  utils.ts   │
       └──────┬─────┘    └──────┬──────┘    └──────┬──────┘
              │                 │                  │
       ┌──────▼─────┐    ┌──────▼──────┐    ┌──────▼──────┐
       │file-filter │    │post-processor│   │  cache.ts   │
       └──────┬─────┘    └──────┬──────┘    └──────┬──────┘
              │                 │                  │
              │            ┌────▼─────┐             │
              │            │ai-       │             │
              │            │reflection│             │
              │            └────┬─────┘             │
              │                 │                   │
              └──────┬──────────┴───────────────────┘
                     ▼
              ┌──────────────┐
              │mcp-adapter   │
              └──────┬───────┘
                     │
              ┌──────▼───────┐
              │prompt-builder│
              └──────┬───────┘
                     │
              ┌──────▼───────┐
              │orchestrator  │
              └──────┬───────┘
                     │
              ┌──────▼───────┐
              │  pipeline    │  (顶层组装)
              └──────┬───────┘
                     │
              ┌──────▼────────────┐
              │comment-publisher  │
              │+ progress/metrics │
              └───────────────────┘
```

### 5.3 依赖原则

1. **单向依赖**：上层依赖下层，禁止反向依赖（如 `diff-parser` 不得依赖 `pipeline`）
2. **types.ts 是唯一类型源**：所有模块从 `./types.js` 导入类型，禁止跨模块定义重复类型
3. **utils.ts 只放纯函数**：无 IO、无状态、可被任意模块依赖
4. **pipeline 是唯一组装点**：除 `pipeline.ts` 外，业务模块不得互相直接依赖
5. **缓存可选**：所有 IO 模块支持 `cache?: CacheManager`，未传入时退化为直接执行

---

## 6. 关键数据类型流转

```typescript
// ① diff-parser 输出
interface FileDiff {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: Hunk[];
  language?: string;
  binary?: boolean;
}

// ② file-filter 输出
interface FileBundle {
  id: string;
  primary: FileDiff;
  related: FileDiff[];           // i18n 对 / test 对
  annotations: RuleAnnotation[];
}

// ③ rule-engine 输出
interface RuleAnnotation {
  ruleId: string;
  ruleName: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  line?: number;
  category: string;
}

// ④ mcp-adapter 输出
interface MCPContextResult {
  filePaths: string[];
  codeSnippets: Record<string, string>;
  blastRadius: BlastRadiusItem[];
  riskScore: number;
}

// ⑤ 统一 Finding 类型（贯穿 AI 输出与后处理）
interface Finding {
  file: string;
  line: number;
  endLine?: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  message: string;
  suggestion?: string;
  confidence: number;            // 0-1
  source: 'rule' | 'ai';
  ruleId?: string;
}

// ⑥ pipeline 输出
interface PipelineResult {
  filteredDiffs: FileDiff[];
  bundles: FileBundle[];
  annotatedBundles: FileBundle[];
  context?: MCPContextResult;
  prompt: string;
  findings?: Finding[];          // AI 回填
  processedFindings?: Finding[]; // 后处理后
}
```

完整类型见 [`src/types.ts`](../src/types.ts)。

---

## 7. 弹性与降级策略

| 故障点 | 检测方式 | 降级策略 |
|---|---|---|
| MCP Server 不可用 | `isMCPAvailable()` 探测 | `getReviewContextWithFallback` 回退到 grep 全文检索 |
| LLM 调用超时 | `callModelWithTimeout` | 跳过该 Agent，使用规则标注兜底 |
| LLM 返回非法 JSON | `parseReflectionResponse` 解析失败 | 保留原始 findings，confidence 设为 0.5 |
| LLM 行号偏移 | `correctLineLocations` | clamp 到最近 hunk 行 |
| LLM 调用连续失败 | `withRetry` 指数退避 | 重试 3 次后跳过；记录到 `metrics` |
| 缓存磁盘满 | L2 写入失败 | 退化为仅 L1；记录 warning |
| 大 PR（> `LARGE_PR_THRESHOLD`） | `prioritizeDiffs` | 仅审查 Top N 高优先级文件 |
| 单文件超 `maxPatchLength` | `file-filter` | 跳过并在结果中标记 `truncated: true` |
| State 写入失败 | `StateStore` 容错 | 内存态继续运行；启动时跳过断点续审 |

所有降级事件通过 `progress` 事件流与 `metrics` 度量上报，可在仪表盘中查看降级频率与原因。

---

## 附录：相关文件索引

| 文件 | 用途 |
|---|---|
| [`src/index.ts`](../src/index.ts) | 公共 API 导出总表 |
| [`src/types.ts`](../src/types.ts) | 统一类型定义 |
| [`src/pipeline.ts`](../src/pipeline.ts) | 管道主流程 |
| [`src/orchestrator.ts`](../src/orchestrator.ts) | DAG 编排与会话管理 |
| [`src/state.ts`](../src/state.ts) | 会话状态机 |
| [`src/cache.ts`](../src/cache.ts) | 三级缓存 |
| [`src/feedback.ts`](../src/feedback.ts) | 反馈闭环 |
| [`SPEC.md`](../SPEC.md) | 接口规格说明书 |
| [`README.md`](../README.md) | 项目说明与快速开始 |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | 贡献指南 |
