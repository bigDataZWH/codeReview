# 本地 Mock CodeHub Server Spec

## Why

当前开发环境无法访问内网 CodeHub（华为云），导致 Web UI 端到端集成测试无法进行：MR 列表加载、MR 详情展示、Diff 查看、运行审查、提交评论、创建 Issue 等核心流程均依赖真实 CodeHub API。需要一个本地 Mock 服务模拟 CodeHub API v3，让开发者在无内网环境下也能完整测试所有 Web 功能。

## What Changes

### 新增：Mock CodeHub Server 模块
- 新增 `code-review-pkg/src/mock-codehub-server.ts`，基于 Node.js 内置 `http` 模块实现一个独立的本地 HTTP 服务，模拟 CodeHub API v3 端点
- 支持内存状态管理：POST/PUT/DELETE 操作会更新内存数据，后续 GET 能返回更新后的状态
- 支持从 JSON fixture 文件初始化数据（MR 列表、Diff、评论等）

### 新增：Fixture 数据
- 新增 `code-review-pkg/mock-codehub-fixtures/` 目录，存放预置的 CodeHub API 响应数据
  - `project.json` — 项目信息
  - `mrs.json` — MR 列表（含 3-5 个不同状态的 MR：open/merged/closed）
  - `mr-1-diff.json` — MR 1 的 diff 数据（含多文件、不同变更类型）
  - `mr-1-comments.json` — MR 1 的现有评论
  - `mr-2-diff.json` / `mr-2-comments.json` — MR 2 数据
  - `branches.json` — 分支列表

### 新增：CLI 命令
- 新增 CLI 命令 `code-review mock-codehub`，独立启动 Mock 服务
  - 参数：`--port <port>`（默认 9099）、`--hostname <host>`（默认 127.0.0.1）、`--fixtures-dir <path>`（默认 `mock-codehub-fixtures`）
- 启动后打印可用端点和测试用配置示例

### 新增：集成测试
- 新增 `code-review-pkg/tests/integration/codehub-mock-integration.test.ts`，验证 Mock 服务端点行为
- 新增 `code-review-pkg/tests/integration/web-e2e-mock.test.ts`，端到端测试：启动 serve + mock-codehub，通过 API 完整验证 MR 列表 → 详情 → diff → 运行审查（mock opencode）→ 提交评论 → 创建 Issue 流程

### 不变更
- 现有 `CodeHubClient` 代码完全不改，只通过 `baseUrl` 指向 Mock 服务
- 现有 `codehub-routes.ts`、`api-server.ts`、`cli.ts` 的核心逻辑不变
- `opencode-config-manager.ts`、`opencode-process-manager.ts` 不变

## Impact

- **Affected specs**: 无（新建 spec，与 `add-web-opencode-review-flow` 互补）
- **Affected code**:
  - 新增：`code-review-pkg/src/mock-codehub-server.ts`
  - 新增：`code-review-pkg/mock-codehub-fixtures/*.json`（6 个 fixture 文件）
  - 修改：`code-review-pkg/src/cli.ts`（新增 `mock-codehub` 子命令）
  - 修改：`code-review-pkg/src/index.ts`（导出 `startMockCodeHubServer`）
  - 新增：`code-review-pkg/tests/integration/codehub-mock-integration.test.ts`
  - 新增：`code-review-pkg/tests/integration/web-e2e-mock.test.ts`
- **Dependencies**: 无外部依赖，纯 Node.js 内置模块实现

## ADDED Requirements

### Requirement: Mock CodeHub Server 模块
系统 SHALL 提供 `mock-codehub-server.ts` 模块，导出 `startMockCodeHubServer(options)` 函数，启动一个本地 HTTP 服务模拟 CodeHub API v3。

#### Scenario: 启动 Mock 服务
- **WHEN** 调用 `startMockCodeHubServer({ port: 9099, fixturesDir: 'mock-codehub-fixtures' })`
- **THEN** 在 `127.0.0.1:9099` 启动 HTTP 服务，返回 `{ ok: true, port, hostname, baseUrl }`

#### Scenario: 加载 fixture 数据
- **WHEN** 启动时指定 `fixturesDir`
- **AND** 目录中存在 `mrs.json`
- **THEN** 内存中初始化 MR 列表数据，后续 `GET /api/v3/projects/:id/merge_requests` 返回该数据

#### Scenario: fixture 目录不存在
- **WHEN** 启动时 `fixturesDir` 不存在
- **THEN** 使用内置默认数据，不报错，记录 warning 日志

### Requirement: 模拟 CodeHub API v3 端点
Mock 服务 SHALL 实现以下 CodeHub API v3 兼容端点：

#### Scenario: GET 项目信息
- **WHEN** `GET /api/v3/projects/:projectId`
- **THEN** 返回 200 + `{ id, name, path_with_namespace, default_branch, ... }`

#### Scenario: GET MR 列表
- **WHEN** `GET /api/v3/projects/:projectId/merge_requests?state=open&page=1&per_page=20`
- **THEN** 返回 200 + MR 数组（支持 state/page/per_page 过滤）

#### Scenario: GET MR 详情
- **WHEN** `GET /api/v3/projects/:projectId/merge_requests/:iid`
- **AND** iid 存在
- **THEN** 返回 200 + MR 详情对象
- **AND** iid 不存在时返回 404 + `{ message: 'Not Found' }`

#### Scenario: GET MR diff
- **WHEN** `GET /api/v3/projects/:projectId/merge_requests/:iid/diffs?unidiff=true`
- **THEN** 返回 200 + `{ id, iid, diff_refs: {...}, changes: [...] }`

#### Scenario: GET MR 评论
- **WHEN** `GET /api/v3/projects/:projectId/merge_requests/:iid/notes`
- **THEN** 返回 200 + 评论数组

#### Scenario: POST 创建 MR 评论
- **WHEN** `POST /api/v3/projects/:projectId/merge_requests/:iid/notes` 带 `{ body, position }`
- **THEN** 在内存中追加评论，返回 201 + 新评论对象（含自增 id、created_at）

#### Scenario: DELETE 删除 MR 评论
- **WHEN** `DELETE /api/v3/projects/:projectId/merge_requests/:iid/notes/:noteId`
- **THEN** 从内存中移除评论，返回 204

#### Scenario: POST 创建 Issue
- **WHEN** `POST /api/v3/projects/:id/issues` 带 `{ title, description, labels }`
- **THEN** 在内存中追加 Issue，返回 201 + 新 Issue 对象

#### Scenario: GET 分支列表
- **WHEN** `GET /api/v3/projects/:id/repository/branches`
- **THEN** 返回 200 + 分支数组

#### Scenario: 鉴权验证
- **WHEN** 请求未带 `PRIVATE-TOKEN` header
- **THEN** 返回 401 + `{ message: 'Unauthorized' }`（Mock 模式下接受任意非空 token）

### Requirement: 内存状态管理
Mock 服务 SHALL 维护内存状态，POST/PUT/DELETE 操作会更新内存，后续 GET 返回最新状态。

#### Scenario: 创建评论后立即可查询
- **WHEN** POST 创建评论成功
- **AND** 紧接着 GET 同一 MR 的评论列表
- **THEN** 返回的列表包含刚创建的评论

#### Scenario: 重启服务后状态重置
- **WHEN** 停止并重新启动 Mock 服务
- **THEN** 内存状态重置为 fixture 初始数据

### Requirement: CLI mock-codehub 命令
系统 SHALL 提供 `code-review mock-codehub` CLI 命令，独立启动 Mock 服务。

#### Scenario: 启动 Mock 服务
- **WHEN** 执行 `code-review mock-codehub --port 9099`
- **THEN** 启动 Mock 服务并打印：
  - 监听地址
  - 可用端点列表
  - 测试用 CodeHub 配置示例（baseUrl/projectId/token）

#### Scenario: 自定义 fixtures 目录
- **WHEN** 执行 `code-review mock-codehub --fixtures-dir /path/to/custom`
- **THEN** 从指定目录加载 fixture 数据

## MODIFIED Requirements

### Requirement: CLI 命令注册
现有 `code-review` CLI 新增 `mock-codehub` 子命令，参数：
- `--port <port>`：监听端口（默认 9099）
- `--hostname <host>`：监听地址（默认 127.0.0.1）
- `--fixtures-dir <path>`：fixture 目录（默认 `mock-codehub-fixtures`）

## Assumptions & Decisions

1. **基于 Node.js 内置 http 模块**：不引入 express 等框架，保持依赖最小化，与现有 `api-server.ts` 风格一致
2. **内存状态**：Mock 服务维护内存中的 MR 列表、评论、Issue，进程重启后状态重置为 fixture 数据
3. **API 路径兼容**：严格遵循 `CodeHubClient` 中 `buildUrl` 的路径模式：`{baseUrl}/api/v3/projects/{projectId}/...`
4. **鉴权宽松**：接受任意非空 `PRIVATE-TOKEN` header，便于测试；空 header 返回 401 模拟鉴权失败场景
5. **fixture 格式**：JSON 文件，结构匹配 `types.ts` 中的 TypeScript 接口（CodeHubMR、CodeHubMRDiff、CodeHubComment 等）
6. **不做完整 Git 模拟**：`/repository/files/:path/raw` 端点返回固定文本，`/repository/branches/:name` 返回 fixture 数据，不模拟真实 Git 操作
7. **不做 opencode CLI 模拟**：`POST /codehub/mrs/:iid/review` 端点仍调用真实 opencode CLI，集成测试中通过 mock opencode CLI 输出或跳过该路径
8. **默认端口 9099**：避开 serve 默认的 4096/3000 端口
9. **错误响应格式**：遵循 CodeHub API 风格，错误返回 `{ message: string }` 或 `{ error: string }`
