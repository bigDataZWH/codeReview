# LLM 默认连接 OpenCode — 实施计划

## 概述

移除 Web UI 中独立的 LLM 配置，LLM 能力统一由 opencode 提供。同时新增并发代码检视、检视报告保存为本地 md 文档、一键将检视结果提 issue 到 CodeHub 的能力。

## 当前状态分析

### 现有 LLM 配置流程（将被移除）
- Web UI `Settings.tsx` 有独立的 "LLM 配置" Tab（Provider/API Key/Model/Base URL）
- 后端 `codehub-config.ts` 的 `CodeHubFullConfig.llmConfig` 字段存储 LLM 配置
- `codehub-routes.ts` 的 GET/POST `/codehub/config` 端点处理 llmConfig 的脱敏与保存
- **关键问题**：这些 llmConfig 配置实际上是"死配置"——生产代码中没有任何地方读取它来调用 LLM。真正生效的 AI 审查通过 opencode（`opencode.jsonc` 顶层 `model: anthropic/claude-sonnet-4-5`）执行。

### 现有审查执行流程（将被调整）
- Web UI `MRDetail.tsx` 的"运行审查"按钮调用 `POST /api/v1/codehub/mrs/:iid/review`
- 该端点调用 `runPipeline(diffText, { filter: {} })`，**只构建 prompt，不调 LLM**
- 审查结果（findings）存储在内存 Map 中，非持久化

### 现有并发基础设施（可复用）
- `parallel-tuner.ts`：CPU 核数检测、动态并行度调优
- `orchestrator.ts`：`runWithConcurrency<T>()` 通用并发 worker pool、wave-based DAG 调度
- `pipeline.ts`：大 PR 分批处理（文件数 ≥ 30 触发）

### 现有报告生成能力（可复用）
- `result-exporter.ts`：`exportMarkdown(findings, options)` 支持 `outputFile` 直接写文件
- `format.ts`：`formatFindingsMarkdown(findings)` 生成完整 Markdown 报告
- `codehub-publisher.ts`：`formatSummaryMarkdown(findings, language)` 生成 MR 评论摘要

### 现有 CodeHub Issue 能力（需新增）
- `codehub-client.ts` **没有** `createIssue` 方法
- `types.ts` **没有** `CodeHubIssue` 类型定义
- CodeHub 兼容 GitLab v3 API，创建 issue 端点为 `POST /api/v3/projects/:id/issues`

---

## 变更清单

### 第一部分：移除独立 LLM 配置

#### 1. `web/src/pages/Settings.tsx`
- **什么**：移除 "LLM 配置" Tab（`llm` tabItem），保留 CodeHub 配置 Tab 和审查设置 Tab
- **为什么**：LLM 由 opencode 提供，无需在 Web UI 重复配置
- **如何**：
  - 删除 `llm` tabItem（行 205-258 的整个 Tab 对象）
  - 删除 `RobotOutlined` 导入
  - 删除 `saveMutation` 中 llmConfig 相关字段（llmProvider/llmApiKey/llmModel/llmBaseURL）
  - 删除 `useEffect` 中 llmConfig 相关字段的 `form.setFieldsValue`

#### 2. `web/src/api/codehub.ts`
- **什么**：移除 `CodeHubConfig` 接口中的 `llmConfig` 字段
- **为什么**：前端不再需要 LLM 配置类型
- **如何**：删除 `CodeHubConfig.llmConfig` 字段定义（行 8-13）

#### 3. `code-review-pkg/src/codehub-config.ts`
- **什么**：移除 `CodeHubFullConfig` 中的 `llmConfig` 字段及相关加载/保存逻辑
- **为什么**：后端不再需要独立 LLM 配置
- **如何**：
  - 删除 `CodeHubFullConfig.llmConfig` 字段（行 15-20）
  - 删除环境变量加载：`LLM_PROVIDER`/`LLM_API_KEY`/`LLM_MODEL`/`LLM_BASE_URL`（行 52-60）
  - 删除 `saveCodeHubConfig` 中 llmConfig 合并逻辑（行 110-113）
  - 删除 `DEFAULT_CONFIG` 中 llmConfig 相关默认值

#### 4. `code-review-pkg/src/codehub-routes.ts`
- **什么**：移除 config 端点中 llmConfig 的脱敏处理
- **为什么**：不再需要处理 LLM 配置
- **如何**：
  - GET `/codehub/config`：删除 llmConfig 脱敏代码（行 136-141）
  - POST `/codehub/config`：删除 llmConfig 脱敏代码（行 154-159）

### 第二部分：调整 Web UI 审查功能

#### 5. `web/src/pages/MRDetail.tsx`
- **什么**：移除"运行审查"按钮，改为提示在 opencode 中执行审查
- **为什么**：审查在 opencode 中执行，Web UI 仅查看
- **如何**：
  - 移除 `reviewMutation`（useMutation 调用 `codehubApi.runMRReview`）
  - 移除"运行审查"按钮（行 215-222）
  - 在 findings Tab 顶部添加提示信息："代码审查请在 opencode 中执行 `/review-pr $mrIid` 命令"
  - findings 数据改为从 CodeHub MR 评论中解析（保留 `getMRFindings` 端点，但数据来源改为解析 MR 评论中的 `<!-- code-review:finding -->` 标记）

#### 6. `web/src/api/codehub.ts`
- **什么**：移除 `runMRReview` 方法（不再需要从 Web UI 触发审查）
- **为什么**：审查在 opencode 中执行
- **如何**：删除 `runMRReview` 方法定义

### 第三部分：新增 CodeHub Issue 能力

#### 7. `code-review-pkg/src/types.ts`
- **什么**：新增 `CodeHubIssue` 接口
- **为什么**：支持将检视结果提为 CodeHub issue
- **如何**：在文件末尾添加：
```typescript
export interface CodeHubIssue {
  id: number;
  iid: number;
  title: string;
  description: string;
  state: 'opened' | 'closed';
  author: CodeHubUser;
  labels: string[];
  web_url?: string;
  created_at: string;
  updated_at: string;
}

export interface CodeHubCreateIssueOptions {
  title: string;
  description: string;
  labels?: string[];
  assigneeId?: number;
  milestoneId?: number;
}
```

#### 8. `code-review-pkg/src/codehub-client.ts`
- **什么**：新增 `createIssue` 方法
- **为什么**：支持通过 API 创建 CodeHub issue
- **如何**：在 `CodeHubClient` 类中添加：
```typescript
async createIssue(options: CodeHubCreateIssueOptions): Promise<CodeHubIssue> {
  const payload: Record<string, unknown> = {
    title: options.title,
    description: options.description,
  };
  if (options.labels?.length) payload.labels = options.labels.join(',');
  if (options.assigneeId) payload.assignee_id = options.assigneeId;
  if (options.milestoneId) payload.milestone_id = options.milestoneId;
  return this.request<CodeHubIssue>('/issues', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async getIssues(options?: { state?: 'opened' | 'closed' | 'all'; labels?: string[]; page?: number; perPage?: number }): Promise<CodeHubIssue[]> {
  return this.request<CodeHubIssue[]>('/issues', {
    method: 'GET',
    query: {
      state: options?.state,
      labels: options?.labels?.join(','),
      page: options?.page,
      per_page: options?.perPage,
    },
  });
}
```

#### 9. `code-review-pkg/src/codehub-publisher.ts`
- **什么**：新增 `publishFindingsAsIssue` 函数和 `saveReportToFile` 函数
- **为什么**：支持将检视结果保存为 md 文件并提为 CodeHub issue
- **如何**：
  - 新增 `saveReportToFile(findings, filePath, options)` 函数：利用 `formatSummaryMarkdown` 生成完整报告并写入文件
  - 新增 `publishFindingsAsIssue(options)` 函数：将检视结果格式化为 Markdown，调用 `client.createIssue()` 提交为 issue
```typescript
export async function saveReportToFile(
  findings: Finding[],
  filePath: string,
  options?: { mrTitle?: string; mrIid?: number; language?: string },
): Promise<void> {
  const report = formatFullReport(findings, options);
  writeFileSync(filePath, report, 'utf-8');
}

export async function publishFindingsAsIssue(options: {
  client: CodeHubClient;
  findings: Finding[];
  mrIid?: number;
  mrTitle?: string;
  language?: string;
  labels?: string[];
}): Promise<{ ok: boolean; issue?: CodeHubIssue; error?: string }> {
  const title = `[代码审查] ${options.mrTitle ?? `MR !${options.mrIid}`} - ${options.findings.length} 个问题`;
  const description = formatFullReport(options.findings, { mrIid: options.mrIid, mrTitle: options.mrTitle, language: options.language });
  const issue = await options.client.createIssue({ title, description, labels: options.labels ?? ['code-review'] });
  return { ok: true, issue };
}
```
  - 新增私有 `formatFullReport(findings, options)` 函数：生成完整的 Markdown 报告（含标题、统计表格、按文件分组的问题详情），用于保存文件和提 issue

### 第四部分：新增 API 端点

#### 10. `code-review-pkg/src/codehub-routes.ts`
- **什么**：新增 issue 创建端点
- **为什么**：支持 Web UI 中"一键提 Issue"功能
- **如何**：
  - 新增 `POST /api/v1/codehub/mrs/:mrIid/issue` 端点：
    - 从 `reviewFindingsStore` 获取该 MR 的 findings
    - 调用 `publishFindingsAsIssue` 创建 issue
    - 返回 issue 信息
  - 新增 `POST /api/v1/codehub/mrs/:mrIid/report` 端点：
    - 从 `reviewFindingsStore` 获取 findings
    - 调用 `saveReportToFile` 保存为 md 文件
    - 返回文件路径

#### 11. `web/src/api/codehub.ts`
- **什么**：新增 issue 和报告相关 API 方法
- **为什么**：前端调用后端新增的端点
- **如何**：
```typescript
createMRIssue: (mrIid: number, options?: { labels?: string[] }) =>
  api.post(`/codehub/mrs/${mrIid}/issue`, options).then((r) => r.data),
saveMRReport: (mrIid: number, options?: { filePath?: string }) =>
  api.post(`/codehub/mrs/${mrIid}/report`, options).then((r) => r.data),
```

#### 12. `web/src/pages/MRDetail.tsx`
- **什么**：在 findings Tab 新增"保存报告"和"提 Issue"按钮
- **为什么**：支持一键保存检视报告和提 issue
- **如何**：
  - 在 findings Tab 顶部操作区添加两个按钮：
    - "保存报告"：调用 `codehubApi.saveMRReport(mrIid)`，成功后提示文件路径
    - "提 Issue"：调用 `codehubApi.createMRIssue(mrIid)`，成功后提示 issue 链接

### 第五部分：新增 opencode 并发检视命令

#### 13. `code-review-pkg/opencode-config/.opencode/commands/review-pr.md`
- **什么**：增强 review-pr 命令，支持并发检视、保存报告、提 issue
- **为什么**：用户需要在 opencode 中执行并发代码检视并保存结果
- **如何**：
  - 保留现有的 DAG 编排结构（第一层并行：rule-engine + code-reviewer + security-reviewer）
  - 在命令末尾新增"报告保存"步骤：
    ```
    ## 报告保存
    审查完成后，将检视报告保存为 Markdown 文件到本地：
    !`code-review export --format markdown --output .code-review-reports/review-pr-$1-$(date +%Y%m%d%H%M%S).md`
    
    ## 提 Issue 到 CodeHub
    将检视结果一键提为 CodeHub Issue：
    !`code-review codehub-issue --mr-iid $1 --file .code-review-reports/review-pr-$1-latest.md`
    ```

#### 14. 新增 `code-review-pkg/opencode-config/.opencode/commands/review-batch.md`
- **什么**：新增批量并发检视命令
- **为什么**：支持并发检视多个 MR
- **如何**：
```markdown
---
description: 批量并发代码检视多个 MR
agent: code-reviewer
subtask: true
params:
  - name: mr_iids
    type: string
    description: MR IID 列表，逗号分隔（如 "1,2,3"）
---
## 批量并发检视

对以下 MR 进行并发检视：$ARGUMENTS

每个 MR 独立执行审查流程，并发度由系统自动调优。

### 执行步骤
1. 获取每个 MR 的 diff
2. 并发执行审查（rule-engine + code-reviewer + security-reviewer 并行）
3. 每个 MR 审查完成后保存报告
4. 可选：将结果提为 issue

!`code-review codehub-batch --mr-iids $ARGUMENTS --concurrent --save-report --output-dir .code-review-reports/`
```

### 第六部分：CLI 新增命令

#### 15. `code-review-pkg/src/cli.ts`
- **什么**：新增 `codehub-issue` 和 `codehub-batch` 子命令
- **为什么**：支持从命令行提 issue 和批量检视
- **如何**：
  - `codehub-issue --mr-iid <iid> [--file <report.md>] [--labels <labels>]`：
    - 读取 CodeHub 配置
    - 如有 report 文件则读取内容作为 issue description
    - 否则从 MR 评论中解析 findings
    - 调用 `publishFindingsAsIssue` 创建 issue
  - `codehub-batch --mr-iids <iid1,iid2,...> [--concurrent] [--save-report] [--output-dir <dir>] [--create-issues]`：
    - 加载 CodeHub 配置
    - 并发获取多个 MR 的 diff
    - 利用 `runWithConcurrency` 并发执行 `runPipeline`
    - 可选保存报告到 `--output-dir`
    - 可选创建 issues

### 第七部分：更新 index.ts 导出

#### 16. `code-review-pkg/src/index.ts`
- **什么**：导出新增的类型和方法
- **为什么**：供外部使用
- **如何**：
```typescript
export type { CodeHubIssue, CodeHubCreateIssueOptions } from './types.js';
export { saveReportToFile, publishFindingsAsIssue } from './codehub-publisher.js';
```

---

## 假设与决策

1. **LLM 配置完全移除**：不在后端保留任何 llmConfig 字段，LLM 能力完全由 opencode 提供
2. **Web UI 审查按钮移除**：不再从 Web UI 触发 LLM 审查，改为在 opencode 中执行
3. **findings 数据来源**：保留 `reviewFindingsStore` 内存存储，Web UI 的 findings Tab 展示已存储的检视结果（由 opencode 审查后通过 API 写入）
4. **报告格式**：统一使用 Markdown 格式，保存到 `.code-review-reports/` 目录
5. **Issue 标签**：默认使用 `code-review` 标签，可通过参数自定义
6. **并发度**：由 `parallel-tuner.ts` 自动调优，不强制指定
7. **callLLM 和 ai-reflection.ts 保留**：不删除 `callLLM` 函数和 `ai-reflection.ts`，因为 `orchestrator.ts` 的 DAG 仍可能使用它（由 opencode 的 post-process 插件注入）

## 验证步骤

1. **后端构建**：`cd code-review-pkg && npm run build` 确认无编译错误
2. **前端构建**：`cd web && npm run build` 确认无编译错误
3. **启动服务**：`node dist/cli.js serve --hostname 0.0.0.0 --port 4096 --static-dir ../web/dist`
4. **验证 LLM Tab 已移除**：访问 `http://localhost:4096` → 设置页面，确认只有 CodeHub 配置和审查设置两个 Tab
5. **验证 issue 端点**：`Invoke-RestMethod http://localhost:4096/api/v1/codehub/mrs/1/issue -Method POST` 返回正确响应
6. **验证报告端点**：`Invoke-RestMethod http://localhost:4096/api/v1/codehub/mrs/1/report -Method POST` 返回文件路径
7. **验证 CLI 命令**：`node dist/cli.js codehub-issue --mr-iid 1` 和 `node dist/cli.js codehub-batch --mr-iids 1,2,3` 正常执行
