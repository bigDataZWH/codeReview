# Checklist

## Mock CodeHub Server 核心模块
- [x] `mock-codehub-server.ts` 实现 `startMockCodeHubServer(options)` 函数
- [x] 函数返回 `{ ok: true, port, hostname, baseUrl }`
- [x] 内存状态管理：维护 mrs/comments/issues/branches 数组
- [x] POST/PUT/DELETE 操作更新内存，GET 返回最新状态
- [x] HTTP 路由分发：解析 URL 路径和方法
- [x] `PRIVATE-TOKEN` 鉴权中间件（空 token 返回 401）
- [x] 从 fixtures 目录加载初始数据
- [x] fixtures 目录不存在时使用内置默认数据（不报错，仅 warning）

## CodeHub API v3 兼容端点
- [x] `GET /api/v3/projects/:id` 返回项目信息
- [x] `GET /api/v3/projects/:id/merge_requests` 返回 MR 列表（支持 state/page/per_page 过滤）
- [x] `GET /api/v3/projects/:id/merge_requests/:iid` 返回 MR 详情（不存在返回 404）
- [x] `GET /api/v3/projects/:id/merge_requests/:iid/diffs` 返回 MR diff
- [x] `GET /api/v3/projects/:id/merge_requests/:iid/notes` 返回评论列表
- [x] `POST /api/v3/projects/:id/merge_requests/:iid/notes` 创建评论（自增 id + created_at）
- [x] `DELETE /api/v3/projects/:id/merge_requests/:iid/notes/:noteId` 删除评论（返回 204）
- [x] `POST /api/v3/projects/:id/issues` 创建 Issue
- [x] `GET /api/v3/projects/:id/issues` 返回 Issue 列表
- [x] `GET /api/v3/projects/:id/repository/branches` 返回分支列表
- [x] `GET /api/v3/projects/:id/repository/branches/:name` 返回分支详情

## Fixture 数据文件
- [x] `mock-codehub-fixtures/project.json` 项目信息
- [x] `mock-codehub-fixtures/mrs.json` MR 列表（5 个，覆盖 open/merged/closed 状态）
- [x] `mock-codehub-fixtures/mr-1-diff.json` MR 1 diff（含 3 个文件：新增/修改/删除）
- [x] `mock-codehub-fixtures/mr-1-comments.json` MR 1 评论（含行内评论）
- [x] `mock-codehub-fixtures/mr-2-diff.json` MR 2 diff
- [x] `mock-codehub-fixtures/branches.json` 分支列表
- [x] 所有 fixture JSON 格式符合 `types.ts` 接口定义（7/7 通过 JSON.parse）

## CLI mock-codehub 命令
- [x] `code-review mock-codehub` 命令可执行
- [x] 参数 `--port`（默认 9099）支持
- [x] 参数 `--hostname`（默认 127.0.0.1）支持
- [x] 参数 `--fixtures-dir`（默认 mock-codehub-fixtures）支持
- [x] 启动后打印监听地址
- [x] 启动后打印可用端点列表
- [x] 启动后打印测试用 CodeHub 配置示例（baseUrl/projectId/token）
- [x] CLI 帮助文档更新

## 模块导出
- [x] `index.ts` 导出 `startMockCodeHubServer` 函数
- [x] `index.ts` 导出 `MockCodeHubServerOptions` / `MockCodeHubServerHandle` 类型

## 集成测试
- [x] `tests/integration/codehub-mock-integration.test.ts` 创建
- [x] 测试每个端点基本响应
- [x] 测试内存状态一致性（POST 后 GET 返回最新）
- [x] 测试鉴权失败场景（空 token 返回 401）
- [x] 测试 404 场景（不存在的 MR iid）

## Web 端到端测试
- [x] `tests/integration/web-e2e-mock.test.ts` 创建
- [x] 并行启动 mock-codehub + serve（动态端口避免冲突）
- [x] 测试 `/api/v1/codehub/mrs` 返回 mock MR 列表（state=all 5 个，默认 open 3 个）
- [x] 测试 `/api/v1/codehub/mrs/1` 返回 mock MR 详情
- [x] 测试 `/api/v1/codehub/mrs/1/diff` 返回 mock diff
- [x] 测试 `/api/v1/codehub/mrs/1/comments` 返回 mock 评论
- [x] 测试 `/api/v1/codehub/mrs/1/comments` POST 创建评论转发到 mock
- [x] 测试 `/api/v1/codehub/mrs/1/issue` 无 findings 时返回 400（预期行为）
- [x] 测试 teardown 清理服务

## 构建与验证
- [x] 后端 `npx tsc --noEmit` 无错误
- [x] 后端 `npm run build` 成功
- [x] `npx vitest run tests/integration/codehub-mock-integration.test.ts` 通过（23 tests）
- [x] `npx vitest run tests/integration/web-e2e-mock.test.ts` 通过（9 tests）

## 手动端到端验证
- [x] 启动 mock-codehub：`node dist/cli.js mock-codehub --port 9099`
- [x] GET /api/v3/projects/1 返回项目信息（demo-project, main 分支）
- [x] GET MR 列表返回 5 个 MR（3 open / 1 merged / 1 closed）
- [x] 鉴权失败场景：无 token 返回 401
- [x] POST 创建评论返回 id=2003 + created_at 时间戳
- [x] POST 后 GET 评论列表包含新评论（数量增加）
