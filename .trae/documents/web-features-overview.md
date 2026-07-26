# Web 功能清单

## 一、页面清单

| URL | 页面 | 文件 | 主要功能 |
|---|---|---|---|
| `/dashboard` | 概览 | [Dashboard.tsx](file:///d:/AI/project/check/review/web/src/pages/Dashboard.tsx) | 统计卡片 + 饼图（问题分布）+ 折线图（审查趋势）+ 快速统计 |
| `/mrs` | 合并请求列表 | [MRList.tsx](file:///d:/AI/project/check/review/web/src/pages/MRList.tsx) | 搜索 + 状态筛选 + 表格 + 分页 |
| `/mrs/:mrIid` | 合并请求详情 | [MRDetail.tsx](file:///d:/AI/project/check/review/web/src/pages/MRDetail.tsx) | 3 Tab：变更 diff / 审查问题 / 评论 |
| `/repos` | 代码仓库 | [Repos.tsx](file:///d:/AI/project/check/review/web/src/pages/Repos.tsx) | 仓库列表 + 克隆/Fetch/Pull/Checkout/Delete |
| `/settings` | 设置 | [Settings.tsx](file:///d:/AI/project/check/review/web/src/pages/Settings.tsx) | 2 Tab：CodeHub 配置 / 审查设置 |

## 二、各页面功能点

### 1. Dashboard 概览
- 4 个统计卡片：待处理 MR / 已合并 MR / 已关闭 MR / 发现问题
- 饼图：问题严重级别分布（critical/high/medium/low/info）
- 折线图：审查趋势
- 快速统计：待审查 / 今日已审查 / 本周已审查 / MR 总数

### 2. MRList 合并请求列表
- 搜索框（按标题搜索）
- 状态筛选：打开的 / 已合并 / 已关闭 / 全部
- 表格列：ID / 标题（可点击跳转）/ 状态 / 作者 / 更新时间 / 操作
- 分页：10/20/50/100 可选

### 3. MRDetail 合并请求详情

**MR 信息卡片**：标题 / 状态 / 作者 / 分支 / 变更统计 / 描述 / 刷新

**Tab 1：变更（diff）**
- 左侧：变更文件列表（带文件级问题数标记）
- 右侧：DiffViewer 组件（语法高亮 + 行级 findings 标记）

**Tab 2：审查问题（findings）**
- 提示信息：在 opencode 中执行 `/review-pr {mrIid}` 进行审查
- 严重级别统计 Tag 行（5 个）
- **"保存报告"按钮**：保存审查报告为本地 Markdown 文件
- **"提 Issue"按钮**：一键将审查结果提为 CodeHub Issue
- findings 列表（severity + 标题 + 位置 + 描述 + 建议）

**Tab 3：评论（comments）**
- 评论输入框 + 发表按钮
- 评论列表（作者 + 时间 + 内容）

### 4. Repos 代码仓库
- 仓库表格：项目 / 当前分支 / 本地路径 / 大小 / 最后拉取 / 操作
- 操作按钮：Fetch / Pull / 切换分支 / 删除
- **克隆仓库 Modal**：项目 ID / 分支 / 克隆深度
- **切换分支 Modal**：目标分支

### 5. Settings 设置
- **Tab 1：CodeHub 配置** — 地址 / Token / 项目 ID / 仓库目录 + 保存 + 测试连接
- **Tab 2：审查设置** — 审查强度（宽松/标准/严格）/ 安全审查开关 / 默认语言
- 注：**LLM 配置 Tab 已移除**，LLM 由 opencode 统一提供

## 三、组件清单

| 组件 | 文件 | 功能 |
|---|---|---|
| AppSidebar | [Sidebar.tsx](file:///d:/AI/project/check/review/web/src/components/layout/Sidebar.tsx) | 侧边栏导航（4 个菜单项，可折叠） |
| AppHeader | [Header.tsx](file:///d:/AI/project/check/review/web/src/components/layout/Header.tsx) | 顶部栏（折叠按钮 + 面包屑） |
| DiffViewer | [DiffViewer.tsx](file:///d:/AI/project/check/review/web/src/components/diff/DiffViewer.tsx) | Diff 渲染（行级问题标记 + Tooltip） |

## 四、API 清单

### CodeHub 配置
| 方法 | 路径 | 功能 |
|---|---|---|
| GET | `/api/v1/codehub/config` | 读取配置 |
| POST | `/api/v1/codehub/config` | 保存配置 |
| POST | `/api/v1/codehub/config/test` | 测试连接 |

### 合并请求（MR）
| 方法 | 路径 | 功能 |
|---|---|---|
| GET | `/api/v1/codehub/mrs` | MR 列表（state/page/search） |
| GET | `/api/v1/codehub/mrs/:mrIid` | MR 详情 |
| GET | `/api/v1/codehub/mrs/:mrIid/diff` | MR diff |
| GET | `/api/v1/codehub/mrs/:mrIid/findings` | 审查问题列表 |
| POST | `/api/v1/codehub/mrs/:mrIid/issue` | 一键提 Issue |
| POST | `/api/v1/codehub/mrs/:mrIid/report` | 保存报告为本地 Markdown |
| GET | `/api/v1/codehub/mrs/:mrIid/comments` | 评论列表 |
| POST | `/api/v1/codehub/mrs/:mrIid/comments` | 发表评论 |

### 代码仓库
| 方法 | 路径 | 功能 |
|---|---|---|
| GET | `/api/v1/codehub/repos` | 仓库列表 |
| POST | `/api/v1/codehub/repos/:projectId/clone` | 克隆仓库 |
| POST | `/api/v1/codehub/repos/:projectId/fetch` | git fetch |
| POST | `/api/v1/codehub/repos/:projectId/pull` | git pull |
| POST | `/api/v1/codehub/repos/:projectId/checkout` | 切换分支 |
| GET | `/api/v1/codehub/repos/:projectId/branches` | 分支列表 |
| DELETE | `/api/v1/codehub/repos/:projectId` | 删除仓库 |

### 其他
| 方法 | 路径 | 功能 |
|---|---|---|
| GET | `/api/v1/codehub/dashboard` | 概览统计 |
| GET | `/api/v1/health` | 健康检查 |

## 五、启动方式

```bash
# 生产模式（API + Web 同服务）
node dist/cli.js serve --hostname 0.0.0.0 --port 4096 --static-dir ../web/dist

# 访问 http://localhost:4096
```

## 六、技术栈

React 19 + TypeScript + Vite 6 + antd 5 + zustand + react-query + axios + ECharts + Tailwind CSS

## 七、功能缺口

- Dashboard 的 `reviewedToday` / `reviewedThisWeek` / `trend` 为占位（固定 0 / 空数组）
- `@monaco-editor/react` 已引入但未使用
- 删除评论 API 已有但前端无 UI
