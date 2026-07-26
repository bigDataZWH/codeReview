# 华为 CodeHub MR 代码检视适配计划

## 一、需求分析

### 1.1 核心需求
1. **华为 CodeHub 适配**：对接华为 CodeHub 平台的 Merge Request (MR) 代码检视能力
2. **仓库拉取**：支持将 CodeHub 代码仓库克隆/拉取到本地
3. **代码检视 Web 界面**：提供可视化的代码检视 Web 页面（使用现代可扩展技术栈）
4. **opencode serve 对接**：通过 `opencode serve --hostname 0.0.0.0 --port 4096` 方式提供服务对接

### 1.2 现有项目基础

**code-review-pkg 核心模块：**
- [cli.ts](file:///d:/AI/project/check/review/code-review-pkg/src/cli.ts)：CLI 入口，已有 `serve` 命令
- [api-server.ts](file:///d:/AI/project/check/review/code-review-pkg/src/api-server.ts)：HTTP API 服务器（内置 http 模块，无外部依赖）
- [comment-publisher.ts](file:///d:/AI/project/check/review/code-review-pkg/src/comment-publisher.ts)：GitHub PR 评论发布（仅支持 GitHub）
- [diff-parser.ts](file:///d:/AI/project/check/review/code-review-pkg/src/diff-parser.ts)：Diff 解析器
- [pipeline.ts]：审查管道执行引擎
- [types.ts](file:///d:/AI/project/check/review/code-review-pkg/src/types.ts)：类型定义

**现有静态页面：**
- [code-review.html](file:///d:/AI/project/check/review/code-review/code-review.html)：代码检视介绍页（非功能型页面）

## 二、整体架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    CodeHub Review Web UI                    │
│        (React + TypeScript + Vite + Ant Design)             │
│  MR列表 / 代码Diff / 审查结果 / 评论管理 / 仪表盘           │
└─────────────────────────────┬───────────────────────────────┘
                              │ HTTP API (REST + WebSocket)
┌─────────────────────────────▼───────────────────────────────┐
│              opencode serve (扩展 API Server)                │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  /codehub/* │  │ /api/v1/*    │  │  /web/* (静态页) │   │
│  │  CodeHub    │  │ 原有审查API  │  │  Web UI 构建产物 │   │
│  │  适配层     │  │              │  │                  │   │
│  └──────┬──────┘  └──────┬───────┘  └──────────────────┘   │
└─────────┼────────────────┼──────────────────────────────────┘
          │                │
    ┌─────▼──────┐  ┌──────▼──────┐
    │ CodeHub    │  │  审查管道    │
    │ API Client │  │  (复用现有)  │
    └─────┬──────┘  └─────────────┘
          │
    ┌─────▼──────┐
    │ 本地 Git    │
    │ 仓库管理    │
    └────────────┘
```

## 三、详细实现计划

### 模块 1：CodeHub API 适配器 (`src/codehub-client.ts`)

**功能描述：**
- 封装华为 CodeHub OpenAPI 调用
- 支持 MR 信息获取、diff 获取、评论发布等

**核心接口：**
```typescript
interface CodeHubConfig {
  baseUrl: string;        // CodeHub 平台地址
  token: string;          // Personal Access Token
  projectId: string;      // 项目 ID / 路径
}

interface CodeHubMR {
  id: number;
  iid: number;
  title: string;
  description: string;
  state: 'open' | 'merged' | 'closed';
  source_branch: string;
  target_branch: string;
  author: { name: string; avatar_url?: string };
  created_at: string;
  updated_at: string;
  web_url: string;
}

interface CodeHubDiff {
  diff: string;
  new_path: string;
  old_path: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
}

interface CodeHubComment {
  id: number;
  body: string;
  path?: string;
  line?: number;
  author: { name: string };
  created_at: string;
}
```

**主要方法：**
- `getMRList(state?, page?, perPage?)`：获取 MR 列表
- `getMR(mrIid)`：获取单个 MR 详情
- `getMRDiff(mrIid)`：获取 MR diff
- `getMRComments(mrIid)`：获取 MR 评论列表
- `createMRComment(mrIid, body, path?, line?)`：创建 MR 评论
- `updateMRComment(mrIid, commentId, body)`：更新评论
- `deleteMRComment(mrIid, commentId)`：删除评论

### 模块 2：本地仓库管理器 (`src/repo-manager.ts`)

**功能描述：**
- 管理本地 Git 仓库的克隆、拉取、切换分支
- 维护工作目录结构

**核心接口：**
```typescript
interface RepoManagerOptions {
  baseDir: string;         // 本地仓库根目录
  codehubConfig: CodeHubConfig;
}

interface RepoInfo {
  projectId: string;
  localPath: string;
  currentBranch: string;
  lastFetchedAt: string;
}
```

**主要方法：**
- `cloneRepo(projectId)`：克隆仓库到本地
- `fetchRepo(projectId)`：拉取最新代码
- `checkoutBranch(projectId, branch)`：切换分支
- `getRepoInfo(projectId)`：获取仓库信息
- `getDiff(projectId, fromBranch, toBranch)`：获取分支间 diff
- `listRepos()`：列出本地所有仓库

### 模块 3：扩展 API Server (`src/api-server.ts` + `src/codehub-routes.ts`)

**新增 API 端点：**

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/codehub/mrs` | 获取 MR 列表 |
| GET | `/api/v1/codehub/mrs/:mrIid` | 获取 MR 详情 |
| GET | `/api/v1/codehub/mrs/:mrIid/diff` | 获取 MR diff |
| POST | `/api/v1/codehub/mrs/:mrIid/review` | 触发 MR 代码审查 |
| GET | `/api/v1/codehub/mrs/:mrIid/findings` | 获取 MR 审查结果 |
| POST | `/api/v1/codehub/mrs/:mrIid/comments` | 发布 MR 评论 |
| GET | `/api/v1/codehub/mrs/:mrIid/comments` | 获取 MR 评论列表 |
| GET | `/api/v1/codehub/repos` | 列出本地仓库 |
| POST | `/api/v1/codehub/repos/:projectId/clone` | 克隆仓库 |
| POST | `/api/v1/codehub/repos/:projectId/fetch` | 拉取仓库 |
| GET | `/api/v1/codehub/config` | 获取 CodeHub 配置 |
| POST | `/api/v1/codehub/config` | 更新 CodeHub 配置 |
| GET | `/api/v1/codehub/dashboard` | 获取仪表盘统计数据 |

**配置管理：**
- 支持通过环境变量或配置文件设置 CodeHub 连接信息
- 环境变量：`CODEHUB_URL`, `CODEHUB_TOKEN`, `CODEHUB_PROJECT_ID`
- 配置文件：`.codehub-config.json`

### 模块 4：代码检视 Web UI (`web/` 目录)

#### 4.1 技术选型

**核心技术栈：**
- **框架**：React 19 + TypeScript（类型安全，组件化开发，生态最成熟）
- **构建工具**：Vite 6（极速 HMR，构建速度快，配置简单）
- **UI 组件库**：Ant Design 5（企业级组件库，与代码检视场景匹配度高）
- **状态管理**：Zustand（轻量、简洁、支持 devtools，学习成本低）
- **路由**：React Router v7（声明式路由，支持嵌套路由和动态路由）
- **数据请求**：TanStack Query（React Query v5，缓存、重试、乐观更新、SSR 支持）
- **代码 Diff 展示**：@monaco-editor/react + diff 编辑器（VS Code 同款编辑器体验）
- **样式方案**：TailwindCSS + Ant Design 主题定制（灵活与效率兼顾）
- **图表可视化**：ECharts（仪表盘数据可视化，功能强大）
- **代码高亮**：Prism.js / shiki（行内代码高亮）
- **Markdown 渲染**：react-markdown + remark-gfm（评论、描述支持 Markdown）

**开发工具：**
- ESLint + Prettier（代码规范）
- Vitest + React Testing Library（单元测试）
- Storybook（组件文档与调试，可选）

#### 4.2 页面路由结构

```
/                          # 首页（仪表盘概览）
/mrs                       # MR 列表页
/mrs/:mrIid                # MR 详情页
  /mrs/:mrIid/diff         #   - Diff 视图（默认）
  /mrs/:mrIid/findings     #   - 审查结果
  /mrs/:mrIid/comments     #   - 评论列表
/repos                     # 仓库管理页
/rules                     # 审查规则管理页
/settings                  # 系统设置页
  /settings/codehub        #   - CodeHub 连接配置
  /settings/review         #   - 审查规则配置
  /settings/model          #   - 模型配置
```

#### 4.3 核心页面功能

**1. 仪表盘首页 (`/`)**
- 今日/本周审查统计（审查 MR 数、发现问题数、按严重级别分布）
- 待处理 MR 列表
- 最近审查活动时间线
- 趋势图表（近 7 天/30 天审查趋势）

**2. MR 列表页 (`/mrs`)**
- MR 列表展示（标题、状态、作者、源/目标分支、更新时间、审查状态）
- 高级筛选（状态、作者、标签、搜索关键词、时间范围）
- 排序（创建时间、更新时间、标题）
- 分页
- 批量触发审查
- MR 状态标签（open/merged/closed、审查中/待审查/已完成）

**3. MR 详情页 (`/mrs/:mrIid`)**
- MR 头部信息（标题、描述、作者、状态、分支、创建/更新时间、跳转 CodeHub）
- Tab 切换：
  - **Diff 视图**：
    - 文件树导航（可折叠，按文件状态着色）
    - Monaco Editor 左右对比视图
    - 行内审查结果标记（高亮 + 悬浮卡片）
    - 行内评论展示与回复
    - 审查结果侧边栏（按文件/严重级别分组，点击跳转）
  - **审查结果**：
    - Findings 列表（支持按文件、严重级别、类别筛选）
    - 每条详情：问题描述、修复建议、代码位置、严重级别、置信度
    - 误报标记 / 接受操作
    - 一键发布评论到 CodeHub
  - **评论列表**：
    - 所有评论时间线
    - 支持 Markdown 展示
    - 回复/编辑/删除操作

**4. 仓库管理页 (`/repos`)**
- 本地仓库列表
- 克隆新仓库
- 拉取更新
- 仓库详情（分支列表、提交历史）

**5. 审查规则管理页 (`/rules`)**
- 规则列表（分组展示：安全/质量/性能等）
- 启用/禁用规则
- 规则参数覆盖（严重级别、描述等）
- 自定义规则编辑（JSON 可视化编辑器）
- 规则导入/导出

**6. 系统设置页 (`/settings`)**
- CodeHub 连接配置（地址、Token、项目 ID）
- 连接测试
- 模型配置（LLM Provider、API Key、模型选择）
- 审查默认配置（强度、语言、是否启用安全审查等）

#### 4.4 项目目录结构

```
web/                                    # Web UI 项目根目录
├── public/                             # 静态资源
│   └── favicon.ico
├── src/
│   ├── main.tsx                        # 应用入口
│   ├── App.tsx                         # 根组件
│   ├── router/                         # 路由配置
│   │   └── index.tsx
│   ├── pages/                          # 页面组件
│   │   ├── Dashboard/                  # 仪表盘
│   │   │   ├── index.tsx
│   │   │   ├── components/
│   │   │   │   ├── StatsCards.tsx
│   │   │   │   ├── TrendChart.tsx
│   │   │   │   ├── PendingMRs.tsx
│   │   │   │   └── ActivityTimeline.tsx
│   │   │   └── hooks/useDashboard.ts
│   │   ├── MRList/                     # MR 列表页
│   │   │   ├── index.tsx
│   │   │   ├── components/
│   │   │   │   ├── MRTable.tsx
│   │   │   │   ├── MRFilter.tsx
│   │   │   │   └── MRStatusTag.tsx
│   │   │   └── hooks/useMRList.ts
│   │   ├── MRDetail/                   # MR 详情页
│   │   │   ├── index.tsx
│   │   │   ├── components/
│   │   │   │   ├── MRHeader.tsx
│   │   │   │   ├── FileTree.tsx
│   │   │   │   ├── DiffViewer.tsx
│   │   │   │   ├── FindingPanel.tsx
│   │   │   │   ├── FindingCard.tsx
│   │   │   │   ├── CommentList.tsx
│   │   │   │   └── CommentEditor.tsx
│   │   │   └── hooks/
│   │   │       ├── useMRDetail.ts
│   │   │       └── useReview.ts
│   │   ├── Repos/                      # 仓库管理
│   │   │   ├── index.tsx
│   │   │   ├── components/
│   │   │   │   ├── RepoList.tsx
│   │   │   │   └── CloneModal.tsx
│   │   │   └── hooks/useRepos.ts
│   │   ├── Rules/                      # 规则管理
│   │   │   ├── index.tsx
│   │   │   ├── components/
│   │   │   │   ├── RuleList.tsx
│   │   │   │   ├── RuleEditor.tsx
│   │   │   │   └── RuleFilter.tsx
│   │   │   └── hooks/useRules.ts
│   │   └── Settings/                   # 设置页
│   │       ├── index.tsx
│   │       ├── components/
│   │       │   ├── CodeHubSettings.tsx
│   │       │   ├── ReviewSettings.tsx
│   │       │   └── ModelSettings.tsx
│   │       └── hooks/useSettings.ts
│   ├── components/                     # 通用组件
│   │   ├── layout/                     # 布局组件
│   │   │   ├── MainLayout.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Header.tsx
│   │   │   └── Breadcrumb.tsx
│   │   ├── common/                     # 通用 UI 组件
│   │   │   ├── StatusBadge.tsx
│   │   │   ├── SeverityTag.tsx
│   │   │   ├── EmptyState.tsx
│   │   │   ├── Loading.tsx
│   │   │   ├── ErrorBoundary.tsx
│   │   │   └── ConfirmModal.tsx
│   │   └── diff/                       # Diff 相关组件
│   │       ├── DiffEditor.tsx
│   │       ├── DiffLine.tsx
│   │       └── InlineComment.tsx
│   ├── store/                          # 状态管理 (Zustand)
│   │   ├── useAuthStore.ts
│   │   ├── useReviewStore.ts
│   │   ├── useConfigStore.ts
│   │   └── useUIStore.ts
│   ├── services/                       # API 服务层
│   │   ├── api.ts                      # axios 实例 + 拦截器
│   │   ├── codehub.ts                  # CodeHub 相关 API
│   │   ├── review.ts                   # 审查相关 API
│   │   ├── rules.ts                    # 规则相关 API
│   │   └── repos.ts                    # 仓库相关 API
│   ├── hooks/                          # 通用自定义 Hooks
│   │   ├── useDebounce.ts
│   │   ├── usePagination.ts
│   │   ├── useWebSocket.ts
│   │   └── useLocalStorage.ts
│   ├── types/                          # TypeScript 类型定义
│   │   ├── codehub.ts
│   │   ├── review.ts
│   │   ├── rules.ts
│   │   └── common.ts
│   ├── utils/                          # 工具函数
│   │   ├── format.ts
│   │   ├── diff.ts
│   │   ├── date.ts
│   │   └── storage.ts
│   ├── styles/                         # 全局样式
│   │   ├── index.css
│   │   ├── tailwind.css
│   │   └── theme.ts                    # Ant Design 主题定制
│   └── config/                         # 配置常量
│       └── constants.ts
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts                      # Vite 配置
├── tailwind.config.js
├── postcss.config.js
├── .eslintrc.cjs
└── .prettierrc
```

#### 4.5 关键技术点

**1. Monaco Diff Editor 集成**
- 使用 @monaco-editor/react 封装
- 实现行内 finding 标记（gutter 图标 + 行高亮）
- 实现行内评论（悬浮卡片 + 编辑）
- 文件树与编辑器联动

**2. TanStack Query 数据管理**
- 缓存策略（MR 列表、详情）
- 乐观更新（发布评论、触发审查）
- 后台刷新
- 错误重试

**3. WebSocket 实时更新**
- 审查进度实时推送
- 新评论实时通知
- 可选 SSE 降级方案

**4. 可扩展性设计**
- 插件化架构预留（后续可添加代码注释、AI 对话等）
- 组件按功能模块组织，便于新增页面
- 类型定义与后端共享（通过类型导出）

### 模块 5：CLI 扩展 (`src/cli.ts`)

**现有 serve 命令增强：**
```bash
# 原有用法
code-review serve --port 3000 --host 127.0.0.1

# 新增选项
code-review serve \
  --port 4096 \
  --hostname 0.0.0.0 \
  --codehub-url https://codehub.example.com \
  --codehub-token <token> \
  --codehub-project <project-id> \
  --web-dir ./web/dist
```

**新增命令：**
```bash
# CodeHub 配置管理
code-review codehub config --url <url> --token <token> --project <id>

# MR 审查（命令行直接触发）
code-review codehub review <mr-iid> --execute --llm-config <json>

# 仓库管理
code-review codehub clone <project-id>
code-review codehub fetch <project-id>
```

### 模块 6：CodeHub 评论发布器 (`src/codehub-publisher.ts`)

**功能：**
- 类似 [comment-publisher.ts](file:///d:/AI/project/check/review/code-review-pkg/src/comment-publisher.ts)，但适配 CodeHub API
- 支持 replace / incremental 两种模式
- 支持行内评论和 summary 评论

**核心接口：**
```typescript
interface CodeHubPublishOptions {
  findings: Finding[];
  projectId: string;
  mrIid: number;
  token: string;
  baseUrl: string;
  mode?: 'replace' | 'incremental';
}

interface CodeHubPublishResult {
  inlineCount: number;
  summaryUpdated: boolean;
  skipped: number;
}
```

## 四、文件变更清单

### 新增文件（后端 TypeScript）
1. `src/codehub-client.ts` - CodeHub API 客户端
2. `src/repo-manager.ts` - 本地仓库管理器
3. `src/codehub-publisher.ts` - CodeHub 评论发布器
4. `src/codehub-routes.ts` - CodeHub API 路由处理
5. `src/codehub-config.ts` - CodeHub 配置管理

### 新增文件（Web UI - React 项目，文件众多，以上述结构为准）
- `web/` 目录下完整的 React + TypeScript + Vite 项目

### 修改文件
1. `src/api-server.ts` - 扩展 API Server，支持静态文件服务和 CodeHub 路由挂载
2. `src/cli.ts` - 新增 codehub 子命令，增强 serve 命令
3. `src/index.ts` - 新增导出
4. `src/types.ts` - 新增 CodeHub 相关类型定义
5. `code-review-pkg/package.json` - 更新 files 字段，新增 web 构建脚本
6. `tsup.config.ts` - 更新构建配置
7. 根目录 `package.json` - 新增 workspaces 或构建脚本

## 五、实施步骤

### 阶段 1：基础适配层（后端核心）
1. 扩展 `types.ts` - 添加 CodeHub 类型定义
2. 实现 `codehub-client.ts` - CodeHub API 客户端
3. 实现 `repo-manager.ts` - 本地仓库管理
4. 实现 `codehub-config.ts` - 配置管理

### 阶段 2：API 扩展（服务端）
1. 实现 `codehub-routes.ts` - CodeHub API 路由
2. 修改 `api-server.ts` - 集成 CodeHub 路由和静态文件服务
3. 实现 `codehub-publisher.ts` - 评论发布器
4. API 集成测试

### 阶段 3：Web UI 基础搭建
1. 初始化 React + TypeScript + Vite 项目
2. 配置 Ant Design、TailwindCSS、React Router、Zustand、TanStack Query
3. 搭建整体布局（Sidebar + Header + 主内容区）
4. 配置 API 服务层（axios 封装）
5. 配置状态管理 store

### 阶段 4：Web UI 核心页面
1. 实现仪表盘首页
2. 实现 MR 列表页（筛选、分页、搜索）
3. 实现 MR 详情页 - Diff 视图（Monaco Editor 集成）
4. 实现 MR 详情页 - 审查结果面板
5. 实现 MR 详情页 - 评论列表

### 阶段 5：Web UI 扩展页面
1. 实现仓库管理页
2. 实现审查规则管理页
3. 实现系统设置页

### 阶段 6：CLI 集成与构建
1. 修改 `cli.ts` - 新增 codehub 子命令
2. 增强 serve 命令
3. 更新 `index.ts` 导出
4. 配置前端构建（集成到整体构建流程）
5. 构建与打包验证

### 阶段 7：测试与优化
1. 后端单元测试
2. 前端组件测试
3. 端到端功能验证
4. 性能优化（首屏加载、diff 渲染性能）
5. 文档完善

## 六、技术风险与处理

| 风险 | 影响 | 处理方案 |
|------|------|----------|
| CodeHub API 与 GitLab API 差异 | 中 | 先基于 GitLab v4 API 兼容实现，再根据实际 CodeHub 接口调整 |
| 大 MR diff 性能问题 | 高 | 复用现有分批处理逻辑 + 虚拟滚动 + Monaco Editor 懒加载 |
| Monaco Editor 包体积大 | 中 | 使用 CDN 加载 + 按需引入语言包 + 构建时 code split |
| 本地仓库磁盘空间管理 | 中 | 增加仓库清理策略，支持配置保留数量和 LRU 淘汰 |
| 前后端类型不一致 | 低 | 共享类型定义文件，后端类型通过类型导出供前端使用 |
| 认证安全性 | 高 | Token 仅存储于本地配置，支持环境变量注入，不硬编码 |
| WebSocket 兼容性 | 低 | 优先 WebSocket，降级为 SSE 或轮询 |

## 七、依赖分析

### 后端依赖（无新增 npm 依赖）
全部使用 Node.js 内置模块：
- `node:http` / `node:https` - HTTP 请求（复用现有模式）
- `node:child_process` - 执行 git 命令
- `node:fs` / `node:path` - 文件系统操作
- `node:url` - URL 解析

### 前端依赖（新增）
**核心依赖：**
- `react` ^19.0.0
- `react-dom` ^19.0.0
- `react-router-dom` ^7.0.0
- `antd` ^5.20.0
- `@ant-design/icons` ^6.0.0
- `zustand` ^5.0.0
- `@tanstack/react-query` ^5.0.0
- `axios` ^1.7.0
- `@monaco-editor/react` ^4.6.0
- `monaco-editor` ^0.52.0
- `echarts` ^5.5.0
- `echarts-for-react` ^3.0.0
- `react-markdown` ^9.0.0
- `remark-gfm` ^4.0.0
- `dayjs` ^1.11.0
- `lodash-es` ^4.17.0

**开发依赖：**
- `typescript` ^5.5.0
- `vite` ^6.0.0
- `@vitejs/plugin-react` ^4.3.0
- `tailwindcss` ^3.4.0
- `postcss` ^8.4.0
- `autoprefixer` ^10.4.0
- `eslint` ^9.0.0
- `prettier` ^3.3.0
- `vitest` ^2.0.0
- `@testing-library/react` ^16.0.0
- `jsdom` ^25.0.0

### 外部系统依赖
- 系统需安装 `git` 命令行工具
- 华为 CodeHub 平台访问权限及 Personal Access Token

## 八、与 opencode 对接方式

用户通过 `opencode serve --hostname 0.0.0.0 --port 4096` 启动服务后：

1. **Web UI 访问**：浏览器打开 `http://<server-ip>:4096/web/`（自动重定向到首页）
2. **API 对接**：通过 `http://<server-ip>:4096/api/v1/codehub/*` 端点
3. **原有审查 API**：`http://<server-ip>:4096/api/v1/review` 等继续可用
4. **配置方式**：
   - 启动参数：`--codehub-url`, `--codehub-token`, `--codehub-project`
   - 环境变量：`CODEHUB_URL`, `CODEHUB_TOKEN`, `CODEHUB_PROJECT_ID`
   - 配置文件：`.codehub-config.json`
   - Web 界面设置页动态修改

**前端开发模式：**
- 开发阶段：`cd web && npm run dev`，通过 Vite 开发服务器运行，API 请求代理到后端 serve
- 生产构建：`npm run build` 生成 `dist/` 目录，由后端 serve 静态托管
