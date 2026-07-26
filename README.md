# codeReview

基于 OpenCode 平台的 **AI 代码审查确定性管道**。将代码审查中所有可验证、确定性的环节（Diff 解析、文件过滤、规则匹配、行号修正、误报过滤、评论发布）沉淀为独立模块，与 AI 能力（LLM 评审 / 反思 / MCP 图谱）通过 prompt 接口解耦衔接。

新增 **华为 CodeHub MR 代码检视** 功能，支持拉取代码仓到本地、Web UI 代码检视，并通过 `opencode serve` 方式对接 OpenCode。

[![CI](https://github.com/bigDataZWH/codeReview/actions/workflows/code-review.yml/badge.svg)](https://github.com/bigDataZWH/codeReview/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 目录

- [核心特性](#核心特性)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [架构总览](#架构总览)
- [快速开始](#快速开始)
- [CLI 命令](#cli-命令)
- [编程式 API](#编程式-api)
- [审查规则](#审查规则)
- [CodeHub 集成](#codehub-集成)
- [Web UI](#web-ui)
- [OpenCode 集成](#opencode-集成)
- [GitHub Actions 集成](#github-actions-集成)
- [测试](#测试)
- [开发](#开发)
- [许可证](#许可证)

---

## 核心特性

- **确定性管道**：6 步流水线（解析 → 过滤 → 打包 → 规则标注 → MCP 上下文 → Prompt 构建），所有可验证逻辑与 AI 解耦，可单测、可回放
- **多场景审查**：通用 review / security / scan / impact 四种内置 prompt 模板，共用同一管道
- **规则引擎**：内置 5 类规则（NPE / Quality / Security / Thread-Safety / XSS），支持 `regex` / `contains_any` / `contains_all` / `line_count_gt` / `file_size_gt` 五种匹配方式
- **后处理**：行号修正（clamp 到 hunk 范围）+ 误报硬规则过滤 + IoU 去重，避免重复评论
- **AI 反思**：通过 LLM 对 Finding 进行批量置信度评估，过滤低置信度误报
- **MCP 图谱**：可选接入 `code-review-graph` MCP Server，提供爆炸半径（caller / callee / test）和风险评分
- **PR 评论发布**：支持 GitHub inline 评论 + Sticky summary，`replace` / `incremental` 两种模式
- **中间件机制**：`PipelineMiddleware` 支持 `afterParse` / `afterFilter` / `afterBuild` 钩子扩展
- **华为 CodeHub 集成**：完整的 MR 代码检视能力，支持拉取、审查、评论发布
- **本地仓库管理**：克隆、拉取、切换分支等完整的 Git 仓库操作
- **Web UI 代码检视**：现代化 React 前端，支持 diff 查看、审查问题展示、评论管理
- **API 服务**：RESTful API 接口，支持静态文件服务和 SPA 路由回退

## 技术栈

| 项 | 选型 |
| --- | --- |
| 后端语言 | TypeScript 5.x + ES2022 (ESM) |
| 运行时 | Node.js >= 18 |
| 构建 | tsup |
| 测试 | Vitest |
| 包管理 | npm |
| 前端框架 | React 19 + TypeScript |
| 前端构建 | Vite 6 |
| UI 组件 | Ant Design 5 |
| 状态管理 | Zustand |
| 数据请求 | TanStack Query |
| 图表 | ECharts |
| 样式 | TailwindCSS 4 |

## 项目结构

```
.
├── code-review-pkg/        # 主包（后端 + CLI）
│   ├── src/
│   │   ├── diff-parser.ts           # Git diff 解析为 FileDiff[]
│   │   ├── file-filter.ts           # 过滤 / 分组 / 打包
│   │   ├── rule-engine.ts           # 确定性规则匹配
│   │   ├── prompt-builder.ts        # 构建 review/security/scan/impact prompt
│   │   ├── mcp-adapter.ts           # code-review-graph MCP 客户端
│   │   ├── post-processor.ts        # 行号修正 + 误报过滤 + IoU 去重
│   │   ├── ai-reflection.ts         # LLM 反思评估
│   │   ├── comment-publisher.ts     # GitHub PR 评论发布
│   │   ├── pipeline.ts              # 管道编排（含中间件）
│   │   ├── format.ts                # Markdown / JSON 输出
│   │   ├── validation.ts            # Finding / Config 校验
│   │   ├── constants.ts             # 默认配置常量
│   │   ├── types.ts                 # 统一类型定义（含 CodeHub 类型）
│   │   ├── utils.ts                 # 通用工具函数
│   │   ├── cli.ts                   # CLI 入口
│   │   ├── api-server.ts            # HTTP API 服务器（含静态文件服务）
│   │   ├── codehub-client.ts        # CodeHub API 客户端
│   │   ├── codehub-config.ts        # CodeHub 配置管理
│   │   ├── codehub-routes.ts        # CodeHub REST API 路由
│   │   ├── codehub-publisher.ts     # CodeHub MR 评论发布器
│   │   ├── repo-manager.ts          # 本地 Git 仓库管理
│   │   └── index.ts                 # 公共 API 导出
│   ├── review-rules/                # 内置规则集（JSON）
│   │   ├── npe.json
│   │   ├── quality.json
│   │   ├── security.json
│   │   ├── thread-safety.json
│   │   └── xss.json
│   ├── opencode-config/             # OpenCode 集成配置
│   │   ├── opencode.jsonc           # Agent + MCP 主配置
│   │   └── .opencode/
│   │       ├── agents/              # 3 个 Agent 定义
│   │       ├── commands/            # 4 个自定义命令
│   │       ├── rules/               # 审查规则指令
│   │       └── plugins/             # post-process 插件
│   ├── scripts/                     # 辅助脚本
│   ├── tests/                       # 单元 + 集成测试
│   ├── .github/workflows/           # CI 工作流
│   └── SPEC.md                      # 技术规格说明书
├── web/                     # Web UI 前端（React + Vite + Ant Design）
│   ├── src/
│   │   ├── main.tsx                 # 应用入口
│   │   ├── App.tsx                  # 根组件（路由配置）
│   │   ├── styles/
│   │   │   └── global.css           # 全局样式
│   │   ├── api/
│   │   │   ├── client.ts            # Axios 客户端
│   │   │   └── codehub.ts           # CodeHub API 封装
│   │   ├── store/
│   │   │   └── app.ts               # Zustand 状态管理
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── Sidebar.tsx      # 侧边栏导航
│   │   │   │   └── Header.tsx       # 顶部导航栏
│   │   │   └── diff/
│   │   │       └── DiffViewer.tsx   # Diff 查看器组件
│   │   └── pages/
│   │       ├── Dashboard.tsx        # 数据概览页面
│   │       ├── MRList.tsx           # MR 列表页面
│   │       ├── MRDetail.tsx         # MR 详情页面
│   │       ├── Repos.tsx            # 仓库管理页面
│   │       └── Settings.tsx         # 设置页面
│   ├── index.html                   # HTML 模板
│   ├── vite.config.ts               # Vite 配置
│   ├── tsconfig.json                # TypeScript 配置
│   └── package.json                 # 前端依赖
└── README.md
```

## 架构总览

```
Git Diff 文本
   │
   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ diff-parser  │ → │ file-filter  │ → │ bundleFiles  │
│ FileDiff[]   │   │ 过滤/排除    │   │ 关联文件打包 │
└──────────────┘   └──────────────┘   └──────────────┘
                                              │
                                              ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│prompt-builder│ ← │ mcp-adapter  │ ← │ rule-engine  │
│ 构建 AI 提示│   │ 图谱上下文   │   │ 规则标注     │
└──────────────┘   └──────────────┘   └──────────────┘
        │
        ▼  (AI 产出 Finding)
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│post-processor│ → │ai-reflection │ → │comment-publisher│
│ 行号修正+误报│   │ LLM 二次反思 │   │ 发布 PR 评论 │
└──────────────┘   └──────────────┘   └──────────────┘
```

**CodeHub 集成架构**：

```
CodeHub API
   │
   ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ codehub-client  │ → │ codehub-routes  │ → │   api-server    │
│ API 客户端      │   │ REST API 路由   │   │ HTTP 服务器     │
└─────────────────┘   └─────────────────┘   └────────┬────────┘
        │                                              │
        ▼                                              ▼
┌─────────────────┐                              ┌─────────────────┐
│ repo-manager    │                              │    Web UI       │
│ 本地仓库管理     │                              │ 代码检视界面    │
└─────────────────┘                              └─────────────────┘
```

**核心数据流**：`FileDiff[]` → `FileBundle[]` → `AnnotatedBundle[]` → `PipelineResult` → `Finding[]` → 过滤后的 `Finding[]`

---

## 快速开始

### 安装

```bash
# 全局安装（用于 CLI）
npm install -g code-review

# 或本地开发
cd code-review-pkg
npm install
npm run build

# 前端构建
cd web
npm install
npm run build
```

### 命令行使用

```bash
# 解析 diff 为结构化 JSON
git diff | code-review parse

# 生成 review prompt（管道 dry-run 输出）
git diff | code-review review

# 安全审查
git diff | code-review security-review

# 全量扫描
git diff | code-review scan

# 影响范围分析
git diff | code-review impact

# 发布评论到 GitHub PR
code-review publish \
  --owner bigDataZWH \
  --repo codeReview \
  --pr 42 \
  --file findings.json \
  --token "$GITHUB_TOKEN" \
  --mode incremental

# 启动 API 服务器（对接 OpenCode）
code-review serve \
  --hostname 0.0.0.0 \
  --port 4096 \
  --config .codehub-config.json \
  --static-dir ../web/dist
```

### CodeHub 配置

创建 `.codehub-config.json` 配置文件：

```json
{
  "baseUrl": "https://codehub.example.com",
  "token": "glpat-your-personal-access-token",
  "projectId": "your-group/your-project",
  "repoBaseDir": ".codehub-repos",
  "reviewConfig": {
    "defaultStrength": "standard",
    "securityReview": true,
    "defaultLanguage": "zh-CN"
  }
}
```

或通过环境变量配置：

```bash
export CODEHUB_URL=https://codehub.example.com
export CODEHUB_TOKEN=glpat-your-token
export CODEHUB_PROJECT_ID=group/project
```

---

## CLI 命令

| 命令 | 说明 |
| --- | --- |
| `parse` | 从 stdin 读取 diff，输出结构化 `FileDiff[]` JSON |
| `review` | 运行通用代码审查管道，输出构建好的 prompt |
| `security-review` | 运行安全专项审查（使用安全 prompt 模板） |
| `scan` | 全量扫描管道 |
| `impact` | 变更影响范围分析 |
| `publish` | 将 `findings.json` 发布为 GitHub PR inline 评论 |
| `serve` | 启动 HTTP API 服务器（支持 CodeHub 和 Web UI） |

### `serve` 命令参数

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `--port` | 监听端口 | 3000 |
| `--hostname` | 绑定地址 | 127.0.0.1 |
| `--config` | CodeHub 配置文件路径 | 无 |
| `--repo-dir` | 本地仓库目录 | 无 |
| `--static-dir` | Web UI 静态文件目录 | 无 |
| `--no-codehub` | 禁用 CodeHub 集成 | 启用 |
| `--no-static` | 禁用静态文件服务 | 启用 |

---

## 编程式 API

```typescript
import {
  runPipeline,
  applyFindings,
  runSecurityPipeline,
  parseDiff,
  buildReviewPrompt,
  publishReview,
  loadRules,
  DEFAULT_FILTER_CONFIG,
} from 'code-review';

// 1. 运行管道（确定性部分）
const result = await runPipeline(diffText, {
  filter: DEFAULT_FILTER_CONFIG,
  rules: loadRules('./review-rules'),
  mcpEnabled: true,
  dryRun: false,
});

// 2. 将 AI 返回的 findings 回填到 result（自动行号修正 + 误报过滤）
const final = applyFindings(result, aiFindings, customFPRules);

// 3. 发布到 PR
await publishReview({
  findings: final.processedFindings ?? [],
  owner: 'bigDataZWH',
  repo: 'codeReview',
  prNumber: 42,
  token: process.env.GITHUB_TOKEN!,
  mode: 'incremental',
});
```

### CodeHub API

```typescript
import {
  CodeHubClient,
  RepoManager,
  CodeHubCommentPublisher,
  loadCodeHubConfig,
} from 'code-review';

// 创建 CodeHub 客户端
const config = loadCodeHubConfig();
const client = new CodeHubClient(config);

// 获取 MR 列表
const mrs = await client.getMRList({ state: 'open' });

// 获取 MR Diff
const diff = await client.getMRDiff(mrIid);

// 运行代码审查
const result = await runPipeline(diff.changes.map(c => c.diff).join('\n'));

// 发布评论到 MR
const publisher = new CodeHubCommentPublisher(client, mrIid);
const publishResult = await publisher.publish(result.findings);

// 本地仓库管理
const repoManager = new RepoManager({
  baseDir: '.codehub-repos',
  codehubConfig: config,
});
await repoManager.cloneRepo('group/project');
await repoManager.fetchRepo('group/project');
```

### 管道中间件

```typescript
import { runPipelineWithMiddleware } from 'code-review';

const result = await runPipelineWithMiddleware(diffText, config, [
  {
    name: 'log-parsed',
    afterParse: (diffs) => {
      console.log(`Parsed ${diffs.length} files`);
      return diffs;
    },
  },
  {
    name: 'enrich-result',
    afterBuild: (r) => ({ ...r, /* custom fields */ }),
  },
]);
```

---

## 审查规则

规则以 JSON 文件形式存放在 [review-rules/](code-review-pkg/review-rules)，支持 5 种匹配方式：

| 类型 | 说明 |
| --- | --- |
| `regex` | 正则匹配 |
| `contains_any` | 包含任一关键词 |
| `contains_all` | 包含全部关键词 |
| `line_count_gt` | 文件行数大于阈值 |
| `file_size_gt` | 文件大小大于阈值 |

**示例规则**（`security.json`）：

```json
[
  {
    "id": "sql-injection",
    "name": "SQL 注入检测",
    "severity": "high",
    "category": "security",
    "patterns": [
      { "type": "regex", "pattern": "(execute|query)\\s*\\(\\s*[\"'].*\\+", "message": "检测到字符串拼接构造 SQL" },
      { "type": "contains_any", "items": ["String sql =", "const sql =", "sql :="], "message": "检测到直接赋值 SQL 字符串" }
    ]
  }
]
```

**内置规则集**：

| 文件 | 类别 | 覆盖 |
| --- | --- | --- |
| `npe.json` | logic | Java/Kotlin 空指针解引用、TS 可选链缺失 |
| `quality.json` | quality | TypeScript `any` 类型检测 |
| `security.json` | security | SQL 注入 |
| `thread-safety.json` | security | 共享可变状态检测 |
| `xss.json` | security | innerHTML / document.write / v-html 检测 |

---

## CodeHub 集成

### API 端点

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/api/v1/codehub/config` | GET/POST | 获取/保存 CodeHub 配置 |
| `/api/v1/codehub/config/test` | POST | 测试 CodeHub 连接 |
| `/api/v1/codehub/mrs` | GET | MR 列表（支持分页、筛选、搜索） |
| `/api/v1/codehub/mrs/:iid` | GET | MR 详情 |
| `/api/v1/codehub/mrs/:iid/diff` | GET | MR diff 变更 |
| `/api/v1/codehub/mrs/:iid/review` | POST | 运行代码审查 |
| `/api/v1/codehub/mrs/:iid/findings` | GET | 获取审查问题 |
| `/api/v1/codehub/mrs/:iid/comments` | GET/POST | 评论管理 |
| `/api/v1/codehub/repos` | GET | 本地仓库列表 |
| `/api/v1/codehub/repos/:id/clone` | POST | 克隆仓库 |
| `/api/v1/codehub/repos/:id/fetch` | POST | 拉取更新 |
| `/api/v1/codehub/repos/:id/pull` | POST | Pull 更新 |
| `/api/v1/codehub/repos/:id/checkout` | POST | 切换分支 |
| `/api/v1/codehub/repos/:id/branches` | GET | 获取分支列表 |
| `/api/v1/codehub/dashboard` | GET | 仪表盘统计数据 |

### 配置管理

支持三种配置方式（优先级从高到低）：

1. **命令行参数**：`--config`, `--repo-dir`
2. **环境变量**：`CODEHUB_URL`, `CODEHUB_TOKEN`, `CODEHUB_PROJECT_ID`
3. **配置文件**：`.codehub-config.json`

---

## Web UI

### 页面功能

| 页面 | 功能 |
| --- | --- |
| **Dashboard** | 数据概览：MR 统计卡片、问题严重级别分布饼图、审查趋势图 |
| **MR List** | MR 列表：状态过滤（打开/已合并/已关闭）、关键词搜索、分页 |
| **MR Detail** | MR 详情：Diff 查看器（行号高亮、问题标记）、审查问题列表、评论管理 |
| **Repos** | 仓库管理：克隆、拉取更新、切换分支、删除本地仓库 |
| **Settings** | 配置管理：CodeHub 连接、LLM 配置、审查参数 |

### 启动方式

```bash
# 开发模式
cd web
npm run dev

# 构建生产版本
npm run build

# 通过 API 服务器提供静态文件服务
code-review serve \
  --hostname 0.0.0.0 \
  --port 4096 \
  --static-dir ./dist
```

---

## OpenCode 集成

[opencode-config/](code-review-pkg/opencode-config) 目录提供完整的 OpenCode 集成：

### Agent 定义（`opencode.jsonc`）

| Agent | 模型 | 职责 |
| --- | --- | --- |
| `code-reviewer` | claude-sonnet-4-5 | 通用代码审查（质量/逻辑/性能/可维护性） |
| `security-reviewer` | claude-opus-4-1 | 安全专项审查（注入/认证/加密/数据泄露） |
| `impact-analyzer` | claude-haiku-4-5 | 变更影响半径与风险评分 |

### MCP 配置

```jsonc
{
  "mcp": {
    "code-review-graph": {
      "type": "local",
      "command": ["code-review-graph", "serve"],
      "enabled": false  // 默认关闭，按需启用
    }
  }
}
```

### 自定义命令

`review` / `review-pr` / `scan` / `security-review` 四个命令封装常用审查流程，详情见 [`.opencode/commands/`](code-review-pkg/opencode-config/.opencode/commands)。

### 通过 opencode serve 对接

```bash
# 在项目根目录启动
opencode serve --hostname 0.0.0.0 --port 4096
```

确保配置文件 `opencode.jsonc` 中启用了 API 服务，并正确配置 `--static-dir` 指向 Web UI 构建目录。

---

## GitHub Actions 集成

仓库内置两个工作流：

### 1. 通用代码审查（[code-review.yml](code-review-pkg/.github/workflows/code-review.yml)）

```yaml
on:
  pull_request:
    types: [opened, synchronize]
permissions:
  pull-requests: write
  contents: read
```

触发：PR 打开或同步时，对所有变更文件运行 review 管道。

### 2. 安全专项审查（[security-review.yml](code-review-pkg/.github/workflows/security-review.yml)）

触发：PR 涉及 `src/**` / `lib/**` / `api/**` / `internal/**` 路径时，运行 security-review 管道。

**所需 Secrets**：

- `ANTHROPIC_API_KEY` — Anthropic API Key（用于 LLM 审查与反思）
- `GITHUB_TOKEN` — 默认提供，用于发布 PR 评论

---

## 测试

```bash
cd code-review-pkg

# 运行全部测试
npm test

# 监听模式
npm run test:watch

# 覆盖率
npm run test:coverage

# 类型检查
npm run lint

# 功能测试（验证核心逻辑）
node test-functional.mjs
```

测试覆盖每个模块的纯函数（单元测试）以及管道端到端流程（集成测试），fixtures 位于 [tests/fixtures/](code-review-pkg/tests/fixtures)。

---

## 开发

```bash
cd code-review-pkg

# 安装依赖
npm install

# 构建（tsup）
npm run build

# CI 流程（lint + test）
npm run ci
```

```bash
cd web

# 安装依赖
npm install

# 开发模式
npm run dev

# 构建生产版本
npm run build

# 类型检查
npm run typecheck
```

**关键常量**（[constants.ts](code-review-pkg/src/constants.ts)）：

| 常量 | 默认值 | 说明 |
| --- | --- | --- |
| `MAX_DIFF_SIZE` | 5,000,000 | diff 最大字符数 |
| `DEFAULT_IOU_THRESHOLD` | 0.5 | 去重 IoU 阈值 |
| `HIGH_CONFIDENCE_THRESHOLD` | 0.85 | 高置信度阈值 |
| `maxPatchLength` | 100,000 | 单文件 patch 最大长度 |
| `DEFAULT_API_PORT` | 3000 | API 服务器默认端口 |
| `DEFAULT_API_HOST` | 127.0.0.1 | API 服务器默认绑定地址 |

---

## 许可证

MIT
