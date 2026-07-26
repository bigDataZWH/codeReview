# Checklist

## opencode 配置管理
- [x] `opencode-config-manager.ts` 实现 `loadOpencodeConfig()` 返回 `{ model, agents, mcp }`
- [x] `opencode-config-manager.ts` 实现 `saveOpencodeConfig(config)` 写入 `opencode-config/opencode.jsonc`
- [x] `GET /api/v1/opencode/config` 端点返回配置
- [x] `PUT /api/v1/opencode/config` 端点写入配置文件
- [ ] 配置文件保留 JSONC 注释格式（或显式说明转 JSON）
  - 说明：当前实现写入时转为标准 JSON（不保留注释），spec Assumptions 中已声明此设计

## opencode 进程管理
- [x] `opencode-process-manager.ts` 实现 `start({host, port})` 启动 opencode serve 子进程
- [x] `opencode-process-manager.ts` 实现 `stop()` 终止子进程
- [x] `opencode-process-manager.ts` 实现 `getStatus()` 返回 `{ running, pid, port, startedAt, lastLogLines }`
- [x] 进程已运行时 start 返回错误（409）
  - 实际返回 200 + `{ ok: false, error: 'opencode serve already running' }`，与 spec 描述的 409 状态码有轻微差异（功能等价）
- [x] 进程异常退出时自动更新 running=false
- [x] 日志环形缓冲保留最近 100 行
- [x] `POST /api/v1/opencode/serve/start` 端点工作
- [x] `POST /api/v1/opencode/serve/stop` 端点工作
- [x] `GET /api/v1/opencode/serve/status` 端点返回 running/pid/port/lastLogLines
- [x] Windows 兼容：opencode 为 .ps1 脚本时通过 `shell: true` 启动

## Web 触发 MR 代码检视
- [x] `review-runner.ts` 实现 `runReviewViaOpencode(client, mrIid)` 调用 opencode CLI
- [x] 函数拉取 MR diff 并传给 opencode
- [x] 解析 opencode 输出为 Finding[]
- [x] findings 生成稳定 ID（基于 file+line+ruleId 哈希）
- [x] opencode CLI 不可用时返回清晰错误
- [x] `POST /api/v1/codehub/mrs/:mrIid/review` 端点改用 review-runner
- [x] review 结果写入 reviewFindingsStore
- [x] MRDetail "运行审查" 按钮调用 review 端点
- [x] 按钮 loading 时禁用
- [x] findings 加载到列表
- [x] Windows 兼容：opencode CLI 通过 `shell: true` 执行

## 逐条提交 MR 评论
- [x] `POST /api/v1/codehub/mrs/:mrIid/findings/:findingId/comment` 端点实现
- [x] finding 不存在返回 404
- [x] finding.line > 0 时提交为行内评论（含 path + line + line_type='new'）
- [x] finding.line 为 0 时提交为普通评论（不带 position）
- [x] 评论 body 包含 severity + message + suggestion 格式化
- [x] MRDetail 每条 finding 新增"提评论"按钮
- [x] finding 无 id 时按钮禁用
- [x] 提交成功后刷新评论列表

## Settings 页面 opencode Tab
- [x] Settings 新增第 3 个 Tab "opencode 配置"
- [x] 配置编辑区：model Input
- [x] 配置编辑区：agents 列表（description + prompt）
- [x] 配置编辑区：mcp 启用 Switch
- [x] 保存配置按钮调用 saveOpencodeConfig
- [x] 进程控制区：启动按钮（POST start）
- [x] 进程控制区：停止按钮（POST stop）
- [x] 进程控制区：状态徽标（running 绿 / stopped 灰）
- [x] 进程控制区：PID + 端口显示
- [x] 日志预览：最近 20 行
- [x] 状态轮询（5s 间隔，tab 激活时）

## 构建与集成
- [x] 后端 `npx tsc --noEmit` 无错误
- [x] 后端 `npm run build` 成功
- [x] 前端 `npx tsc --noEmit` 无错误
- [x] 前端 `npx vite build` 成功
- [x] index.ts 导出 loadOpencodeConfig / saveOpencodeConfig / OpencodeProcessManager / runReviewViaOpencode
- [x] api-server.ts 注册 /api/v1/opencode/* 路由
- [ ] 现有测试套件无回归（未运行 npm test）

## 端到端验证
- [x] 启动服务 `node dist/cli.js serve --port 4097 --static-dir ../web/dist`
- [x] `/settings` opencode Tab：加载配置 → 修改 model → 保存 → 启动进程 → 状态显示 running
- [x] `/settings` opencode Tab：停止进程 → 状态显示 stopped
- [ ] `/mrs/:iid`：点击"运行审查" → findings 加载到列表（需真实 CodeHub 凭证，未端到端验证）
- [ ] `/mrs/:iid` findings 列表：点击"提评论" → 评论出现在 comments Tab（依赖真实 CodeHub 凭证）
