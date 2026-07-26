# Web 端 opencode 配置启动与 MR 检视流程 Spec

## Why

当前 Web UI 只能查看检视结果，无法触发检视（需用户手动在 opencode 终端执行 `/review-pr`）；opencode 配置需手动编辑 JSON 文件；findings 只能一次性整体提为单个 Issue，无法逐条精确定位到代码行提交为 MR 评论。本 spec 让用户在 Web UI 中完成 opencode 配置、启停 opencode serve 进程、一键触发指定 MR 的代码检视，并支持将每条 finding 逐条提交为 MR 行内评论。

## What Changes

### 新增：opencode 配置管理
- 后端新增 `opencode-config-manager.ts` 模块，读写 `opencode-config/opencode.jsonc`（含 model / agents / mcp 配置）
- 后端新增 API 端点：`GET /api/v1/opencode/config`、`PUT /api/v1/opencode/config`
- 前端 Settings 页面新增 "opencode 配置" Tab（编辑 model、agents 描述、mcp 启用状态）

### 新增：opencode serve 进程管理
- 后端新增 `opencode-process-manager.ts` 模块，基于 `child_process.spawn` 启停 `opencode serve` 子进程
- 后端新增 API 端点：`POST /api/v1/opencode/serve/start`、`POST /api/v1/opencode/serve/stop`、`GET /api/v1/opencode/serve/status`
- 前端 Settings 新增进程控制区：启动/停止按钮 + 进程状态（running/stopped + PID + 端口）+ 最近日志输出

### 修改：Web 触发 MR 代码检视
- 后端修改 `POST /api/v1/codehub/mrs/:mrIid/review` 端点：不再直接调用 `runPipeline`，改为通过 `review-runner.ts` 调用 `opencode` CLI 执行 review-pr 命令，LLM 由 opencode 提供
- 后端新增 `review-runner.ts` 模块：封装 opencode CLI 调用、解析审查结果、写回 `reviewFindingsStore`
- 前端 MRDetail 恢复"运行审查"按钮：调用 review 端点、显示 loading、findings 加载到列表

### 修改：逐条提交 MR 评论
- 后端新增 API 端点：`POST /api/v1/codehub/mrs/:mrIid/findings/:findingId/comment`，将单条 finding 提交为 MR 行内评论（含 position 信息：new_path / new_line）
- 前端 MRDetail findings 列表每条新增"提评论"按钮，调用端点，成功后刷新评论列表

### 不变更
- 保留现有 "保存报告" 和 "提 Issue" 按钮（整体提交为 Issue）
- 保留 opencode 命令文件 `review-pr.md` 不变
- 保留 `codehub-publisher.ts` 现有函数

## Impact

- **Affected specs**: 无（新建 spec）
- **Affected code**:
  - 新增：`code-review-pkg/src/opencode-config-manager.ts`
  - 新增：`code-review-pkg/src/opencode-process-manager.ts`
  - 新增：`code-review-pkg/src/review-runner.ts`
  - 修改：`code-review-pkg/src/codehub-routes.ts`（修改 review 端点 + 新增 finding-comment 端点 + 新增 opencode 路由）
  - 修改：`code-review-pkg/src/api-server.ts`（注册 opencode 路由处理器）
  - 修改：`code-review-pkg/src/cli.ts`（serve 命令初始化 process-manager）
  - 修改：`code-review-pkg/src/index.ts`（导出新模块）
  - 修改：`web/src/pages/Settings.tsx`（新增 opencode Tab + 进程控制）
  - 修改：`web/src/pages/MRDetail.tsx`（恢复运行审查按钮 + 新增逐条提评论按钮）
  - 修改：`web/src/api/codehub.ts`（新增 opencode 相关 API 方法）
- **Dependencies**: 系统需安装 `opencode` CLI 并在 PATH 中可用

## ADDED Requirements

### Requirement: opencode 配置管理 API
系统 SHALL 提供 `GET /api/v1/opencode/config` 端点读取 opencode.jsonc 配置，返回 `{ ok, config: { model, agents, mcp } }`；SHALL 提供 `PUT /api/v1/opencode/config` 端点写入配置到文件。

#### Scenario: 读取配置成功
- **WHEN** 调用 `GET /api/v1/opencode/config`
- **THEN** 返回 200 + `{ ok: true, config: { model: "anthropic/claude-sonnet-4-5", agents: {...}, mcp: {...} } }`

#### Scenario: 写入配置成功
- **WHEN** 调用 `PUT /api/v1/opencode/config` 带 body `{ model: "anthropic/claude-sonnet-4-5", agents: {...} }`
- **THEN** 配置写入 `opencode-config/opencode.jsonc`，返回 200 + `{ ok: true }`

### Requirement: opencode serve 进程管理 API
系统 SHALL 提供 `POST /api/v1/opencode/serve/start` 启动 opencode serve 子进程（参数 hostname/port）；SHALL 提供 `POST /api/v1/opencode/serve/stop` 停止；SHALL 提供 `GET /api/v1/opencode/serve/status` 返回 `{ running, pid?, port?, startedAt?, lastLogLines: string[] }`。

#### Scenario: 启动进程成功
- **WHEN** 调用 `POST /api/v1/opencode/serve/start` 带 `{ port: 4096 }`
- **AND** opencode CLI 在 PATH 中可用
- **THEN** 启动 `opencode serve --hostname 127.0.0.1 --port 4096` 子进程，返回 200 + `{ ok: true, pid, port }`

#### Scenario: 进程已在运行
- **WHEN** 调用 start 但进程已运行
- **THEN** 返回 409 + `{ ok: false, error: "opencode serve already running" }`

#### Scenario: 停止进程
- **WHEN** 调用 `POST /api/v1/opencode/serve/stop`
- **THEN** 终止子进程，返回 200 + `{ ok: true }`

#### Scenario: 查询状态
- **WHEN** 调用 `GET /api/v1/opencode/serve/status`
- **THEN** 返回 `{ running: true/false, pid?, port?, startedAt?, lastLogLines: [...最近20行] }`

### Requirement: Web 触发 MR 代码检视
系统 SHALL 修改 `POST /api/v1/codehub/mrs/:mrIid/review` 端点，通过调用 `opencode` CLI 执行 review-pr 命令进行代码检视，LLM 由 opencode 提供，结果写回 `reviewFindingsStore`。

#### Scenario: 触发检视成功
- **WHEN** 调用 `POST /api/v1/codehub/mrs/123/review`
- **AND** opencode CLI 可用且配置有效
- **THEN** 后端拉取 MR diff，调用 `opencode review-pr 123`（或等效命令），解析输出为 findings，写入 `reviewFindingsStore.set('mr:123', findings)`，返回 200 + `{ ok: true, findings, count, mrIid }`

#### Scenario: opencode CLI 不可用
- **WHEN** 调用 review 端点但 opencode CLI 不在 PATH
- **THEN** 返回 500 + `{ ok: false, error: "opencode CLI not found in PATH" }`

### Requirement: 逐条提交 MR 评论
系统 SHALL 提供 `POST /api/v1/codehub/mrs/:mrIid/findings/:findingId/comment` 端点，将单条 finding 提交为 MR 行内评论（包含 position: new_path / new_line）。

#### Scenario: 提交单条评论成功
- **WHEN** 调用 `POST /api/v1/codehub/mrs/123/findings/abc/comment`
- **AND** finding 存在于 store 且有 file + line 信息
- **THEN** 调用 `CodeHubClient.createMRComment(mrIid, { body: 格式化内容, path: finding.file, line: finding.line, line_type: 'new' })`，返回 200 + `{ ok: true, comment }`

#### Scenario: finding 不存在
- **WHEN** findingId 不在 store 中
- **THEN** 返回 404 + `{ ok: false, error: "finding not found" }`

#### Scenario: finding 缺少行号
- **WHEN** finding.line 为 0 或缺失
- **THEN** 提交为普通评论（不带 position），返回 200 + `{ ok: true, comment }`

## MODIFIED Requirements

### Requirement: Web UI Settings 页面
Settings 页面原有 2 个 Tab（CodeHub 配置 / 审查设置），新增第 3 个 Tab "opencode 配置"，包含：
- 配置编辑区：model 输入框、agents 列表（可编辑 description/prompt）、mcp 启用开关
- 进程控制区：启动/停止按钮 + 状态徽标（running 绿色 / stopped 灰色）+ PID + 端口 + 日志预览（最近 20 行）

### Requirement: Web UI MRDetail 页面
MRDetail 的 findings Tab：
- 恢复"运行审查"按钮（调用 `POST /api/v1/codehub/mrs/:mrIid/review`），loading 时禁用并显示进度
- 每条 finding 新增"提评论"按钮（调用 finding-comment 端点），成功后刷新评论列表
- 保留现有"保存报告"和"提 Issue"按钮

## Assumptions & Decisions

1. **opencode CLI 调用方式**：后端通过 `child_process.spawn('opencode', [...args])` 调用，使用 `execFile` Promise 化封装
2. **review-pr 命令输出格式**：opencode review-pr 命令输出 findings JSON 到 stdout 或指定文件，后端解析
3. **进程管理单例**：opencode-process-manager 维护单个 opencode serve 进程实例（不支持多实例）
4. **日志缓冲**：进程管理器维护最近 100 行日志的环形缓冲，status 端点返回最近 20 行
5. **finding ID 生成**：findings 需有稳定 ID（基于 file+line+ruleId 哈希），便于 finding-comment 端点定位
6. **opencode 配置文件路径**：固定为 `code-review-pkg/opencode-config/opencode.jsonc`，可通过 `--opencode-config` CLI 参数覆盖
7. **不删除现有 `runPipeline`**：保留 `runPipeline` 函数，review 端点改为调用 review-runner，但 runPipeline 仍可用于非 LLM 场景
8. **进程退出处理**：opencode serve 子进程异常退出时，process-manager 更新状态并保留退出日志
