# Tasks

- [x] Task 1: 创建 Mock CodeHub Server 核心模块
  - [x] SubTask 1.1: 新增 `code-review-pkg/src/mock-codehub-server.ts`，实现 `startMockCodeHubServer(options)` 函数
  - [x] SubTask 1.2: 实现内存状态管理：维护 `mrs`、`comments`、`issues`、`branches` 数组，支持增删改查
  - [x] SubTask 1.3: 实现 HTTP 路由分发：解析 URL 路径和方法，分发到对应处理器
  - [x] SubTask 1.4: 实现 `PRIVATE-TOKEN` 鉴权中间件（空 token 返回 401）
  - [x] SubTask 1.5: 实现从 fixtures 目录加载初始数据（目录不存在时使用内置默认数据）

- [x] Task 2: 实现 CodeHub API v3 兼容端点
  - [x] SubTask 2.1: `GET /api/v3/projects/:id` — 返回项目信息
  - [x] SubTask 2.2: `GET /api/v3/projects/:id/merge_requests` — 返回 MR 列表（支持 state/page/per_page 过滤）
  - [x] SubTask 2.3: `GET /api/v3/projects/:id/merge_requests/:iid` — 返回 MR 详情（404 处理）
  - [x] SubTask 2.4: `GET /api/v3/projects/:id/merge_requests/:iid/diffs` — 返回 MR diff
  - [x] SubTask 2.5: `GET /api/v3/projects/:id/merge_requests/:iid/notes` — 返回评论列表
  - [x] SubTask 2.6: `POST /api/v3/projects/:id/merge_requests/:iid/notes` — 创建评论（自增 id + created_at）
  - [x] SubTask 2.7: `DELETE /api/v3/projects/:id/merge_requests/:iid/notes/:noteId` — 删除评论（204）
  - [x] SubTask 2.8: `POST /api/v3/projects/:id/issues` — 创建 Issue
  - [x] SubTask 2.9: `GET /api/v3/projects/:id/issues` — 返回 Issue 列表
  - [x] SubTask 2.10: `GET /api/v3/projects/:id/repository/branches` — 返回分支列表
  - [x] SubTask 2.11: `GET /api/v3/projects/:id/repository/branches/:name` — 返回分支详情

- [x] Task 3: 创建 Fixture 数据文件
  - [x] SubTask 3.1: 新增 `code-review-pkg/mock-codehub-fixtures/project.json` — 项目信息
  - [x] SubTask 3.2: 新增 `code-review-pkg/mock-codehub-fixtures/mrs.json` — 5 个 MR（open/merged/closed 各状态）
  - [x] SubTask 3.3: 新增 `code-review-pkg/mock-codehub-fixtures/mr-1-diff.json` — MR 1 diff（含 3 个文件：新增/修改/删除）
  - [x] SubTask 3.4: 新增 `code-review-pkg/mock-codehub-fixtures/mr-1-comments.json` — MR 1 现有评论（含行内评论）
  - [x] SubTask 3.5: 新增 `code-review-pkg/mock-codehub-fixtures/mr-2-diff.json` — MR 2 diff（用于多 MR 场景）
  - [x] SubTask 3.6: 新增 `code-review-pkg/mock-codehub-fixtures/branches.json` — 分支列表
  - [x] SubTask 3.7: 验证所有 fixture JSON 格式符合 `types.ts` 中的接口定义（7/7 通过 JSON.parse）

- [x] Task 4: 注册 CLI mock-codehub 命令
  - [x] SubTask 4.1: 在 `cli.ts` 中新增 `mock-codehub` 子命令处理分支
  - [x] SubTask 4.2: 解析参数 `--port`、`--hostname`、`--fixtures-dir`
  - [x] SubTask 4.3: 调用 `startMockCodeHubServer()` 启动服务
  - [x] SubTask 4.4: 启动后打印可用端点和测试用 CodeHub 配置示例
  - [x] SubTask 4.5: 更新 CLI 帮助文档中 commands 列表

- [x] Task 5: 导出新模块
  - [x] SubTask 5.1: 在 `code-review-pkg/src/index.ts` 中导出 `startMockCodeHubServer` 函数和 `MockCodeHubServerOptions` / `MockCodeHubServerHandle` 类型

- [x] Task 6: 创建 Mock 服务集成测试
  - [x] SubTask 6.1: 新增 `code-review-pkg/tests/integration/codehub-mock-integration.test.ts`
  - [x] SubTask 6.2: 测试每个端点的基本响应（GET 列表、GET 详情、POST 创建、DELETE 删除）
  - [x] SubTask 6.3: 测试内存状态一致性（POST 后 GET 返回最新数据）
  - [x] SubTask 6.4: 测试鉴权失败场景（空 token 返回 401）
  - [x] SubTask 6.5: 测试 404 场景（不存在的 MR iid）

- [x] Task 7: 创建 Web 端到端集成测试
  - [x] SubTask 7.1: 新增 `code-review-pkg/tests/integration/web-e2e-mock.test.ts`
  - [x] SubTask 7.2: 测试 setup：并行启动 mock-codehub (9092) + serve (动态端口)，CodeHub 配置 baseUrl 指向 mock
  - [x] SubTask 7.3: 测试流程：GET /api/v1/codehub/mrs → 返回 mock MR 列表（state=all 5 个，默认 open 3 个）
  - [x] SubTask 7.4: 测试流程：GET /api/v1/codehub/mrs/1 → 返回 mock MR 1 详情
  - [x] SubTask 7.5: 测试流程：GET /api/v1/codehub/mrs/1/diff → 返回 mock diff
  - [x] SubTask 7.6: 测试流程：GET /api/v1/codehub/mrs/1/comments → 返回 mock 评论
  - [x] SubTask 7.7: 测试流程：POST /api/v1/codehub/mrs/1/comments → 评论被转发到 mock，验证 mock 收到 POST /notes
  - [x] SubTask 7.8: 测试流程：POST /api/v1/codehub/mrs/1/issue → 无 findings 时返回 400 + 错误信息（预期行为）
  - [x] SubTask 7.9: 测试 teardown：停掉两个服务（含防御性 if 守卫）

- [x] Task 8: 后端构建验证
  - [x] SubTask 8.1: `cd code-review-pkg && npx tsc --noEmit` 无错误
  - [x] SubTask 8.2: `cd code-review-pkg && npm run build` 成功

- [x] Task 9: 运行集成测试
  - [x] SubTask 9.1: `cd code-review-pkg && npx vitest run tests/integration/codehub-mock-integration.test.ts` 通过（23 tests）
  - [x] SubTask 9.2: `cd code-review-pkg && npx vitest run tests/integration/web-e2e-mock.test.ts` 通过（9 tests）

- [x] Task 10: 手动端到端验证
  - [x] SubTask 10.1: 启动 mock-codehub：`node dist/cli.js mock-codehub --port 9099`（成功，输出端点列表和测试配置）
  - [x] SubTask 10.2: 验证 GET /api/v3/projects/1 返回项目信息（demo-project, main 分支）
  - [x] SubTask 10.3: 验证 GET MR 列表返回 5 个 MR（3 open / 1 merged / 1 closed）
  - [x] SubTask 10.4: 验证鉴权失败（无 token 返回 401）
  - [x] SubTask 10.5: 验证 POST 创建评论（返回 id=2003, created_at 时间戳）
  - [x] SubTask 10.6: 验证 POST 后 GET 评论列表包含新评论（数量增加）

# Task Dependencies

- Task 2 依赖 Task 1（核心模块）完成
- Task 3 可与 Task 1/2 并行（独立的 JSON 文件）
- Task 4 依赖 Task 1 完成（CLI 调用 startMockCodeHubServer）
- Task 5 依赖 Task 1 完成
- Task 6 依赖 Task 1 + Task 2 + Task 3 完成
- Task 7 依赖 Task 6 完成（mock 集成测试通过后再做 Web e2e）
- Task 8 依赖 Task 1-5 完成
- Task 9 依赖 Task 6 + Task 7 + Task 8 完成
- Task 10 依赖 Task 9 完成

# Parallelizable Work

- Task 3（fixture JSON 文件）可与 Task 1 + Task 2 完全并行
- Task 5（导出）可与 Task 4（CLI 命令）并行
