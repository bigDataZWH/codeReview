# 计划：编写 OpenCode 快速集成指南（用户上手指南）

## 背景与目标

用户希望有一份面向 **OpenCode 用户**（非开发者）的快速集成指南，告诉用户从零开始如何把 `opencode-code-review` 工具用起来——安装、生成配置、放入项目、在 OpenCode IDE 中触发命令、查看审查结果。

### 当前文档现状（Phase 1 探索发现）

README 已有两个相关章节，但都不是 step-by-step 上手指南：

1. **[README.md:52-122](file:///d:/AI/project/check/review/opencode-code-review-pkg/README.md#L52-L122) "快速开始"** — 偏向 CLI 用户，列了 6 个 CLI 子命令的用法，没有 OpenCode IDE 集成步骤
2. **[README.md:195-282](file:///d:/AI/project/check/review/opencode-code-review-pkg/README.md#L195-L282) "OpenCode 配置"** — 参考性质，介绍 `opencode-config/` 目录结构和 Agent 配置，但不是"复制→粘贴→运行"的步骤化指南
3. **没有独立的 quickstart 文档**：`docs/` 下只有 `architecture.md` 和 `design.html`，无 `quickstart.md` / `integration.md` / `usage.md`

### 关键断点（用户使用上的潜在障碍）

1. **README 第 232-251 行的 opencode.jsonc 代码片段已过时**：上一轮重构后顶层 `model` 字段已添加、agent 内 `model` 已移除，但 README 这里还展示 `"model": "anthropic/claude-sonnet-4-5"` 在 agent 内的旧格式，与新结构不一致
2. **`opencode-code-review init` 命令**：[src/cli.ts:81-165](file:///d:/AI/project/check/review/opencode-code-review-pkg/src/cli.ts#L81-L165) 实际能自动生成所有配置文件到 cwd，但 README 没有把它作为"快速集成入口"突出介绍
3. **命令文件不调用底层 pipeline**：4 个 `.opencode/commands/*.md` 通过 `!` 指令直接调 git/gh/find，与确定性 pipeline 解耦（这是已知的架构断点，本次"用户上手指南"不修复，只在文档中明确说明命令路径只走 Agent，不走 pipeline）

## 设计决策

1. **新建 `docs/quickstart.md`**：作为独立的快速集成指南，step-by-step 形式，面向 OpenCode 用户
2. **README 添加跳转链接**：在 README "快速开始"章节末尾添加"👉 [OpenCode 快速集成指南](./docs/quickstart.md)"链接
3. **顺手修复 README 第 232-251 行的过时代码片段**：与上一轮顶层 model 重构保持一致
4. **不修改代码**：本计划纯文档型，不动 `src/`、`opencode-config/`、测试
5. **文档语言为中文**：与 README 主体保持一致
6. **覆盖 5 种典型场景**：本地开发、PR 审查、安全审查、全量扫描、CI 自动化

## 实施步骤

### Step 1：新建 docs/quickstart.md

**文件**：`d:\AI\project\check\review\opencode-code-review-pkg\docs\quickstart.md`（新建）

**内容结构**：

```markdown
# OpenCode 快速集成指南

本指南面向首次使用 `opencode-code-review` 的 OpenCode 用户，5 分钟完成集成并触发首次代码审查。

## 前置条件

| 项 | 最低 | 推荐 |
|---|---|---|
| Node.js | 18.0 | 20 LTS |
| OpenCode CLI | 0.1+ | 最新版 |
| Git | 2.30+ | 2.40+ |
| Anthropic API Key | — | 必填（用于 Agent 调用） |

OpenCode 安装参考：https://opencode.ai/docs

## Step 1：安装 opencode-code-review

# 全局安装（推荐）
npm install -g opencode-code-review

# 验证
opencode-code-review --version
# 或查看帮助
opencode-code-review

## Step 2：在项目中生成配置

cd your-project
opencode-code-review init

# 交互式向导会问：
# 1. 项目语言（typescript/javascript/python/go/rust/java/cpp/c）
# 2. 审查强度（lenient/standard/strict）
# 3. 是否启用安全审查（Y/n）
# 4. 部署方式（cli/github-actions）

# 完成后会在 cwd 生成：
# - opencode.jsonc              # OpenCode 主配置（顶层 model + agent 定义）
# - .opencode/agents/*.md       # 4 个 Agent 定义
# - .opencode/commands/*.md     # 4 个自定义命令（/review、/security-review、/scan、/review-pr）
# - review-rules/security.json  # 安全规则
# - review-rules/quality.json   # 质量规则
# - .github/workflows/code-review.yml  # 仅当选择 github-actions 部署

## Step 3：配置 Anthropic API Key

# 方式 1：环境变量（推荐）
export ANTHROPIC_API_KEY=sk-ant-...

# 方式 2：写入 ~/.config/opencode/opencode.json（OpenCode 全局配置）
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "anthropic": {
      "apikey": "sk-ant-..."
    }
  }
}

## Step 4：在 OpenCode IDE 中触发审查

### 4.1 启动 OpenCode

opencode

### 4.2 触发 /review 命令

在 OpenCode 会话中输入：

/review

# OpenCode 会自动执行：
# 1. git diff main...HEAD --stat     # 变更统计
# 2. git diff main...HEAD            # 详细 diff
# 3. code-reviewer Agent 审查并输出 findings

### 4.3 触发其他命令

/security-review    # 安全专项审查（需在 init 时启用）
/scan               # 全量扫描指定目录
/review-pr 42       # 审查指定 PR（需要 gh CLI）

## Step 5：查看审查结果

OpenCode 会在会话中直接显示 Agent 输出的 findings，格式如：

[
  {
    "file": "src/app.ts",
    "line": 42,
    "severity": "high",
    "category": "security",
    "description": "检测到 SQL 字符串拼接",
    "suggestion": "改用参数化查询"
  }
]

## 常见场景

### 场景 A：本地开发时随手审查

git add -p                    # 暂存改动
git diff --cached | opencode-code-review review > review-prompt.txt
# 把 review-prompt.txt 内容粘贴到 OpenCode 会话，或直接 /review

### 场景 B：在 PR 中自动审查

# 1. init 时选择 github-actions 部署
# 2. 推送分支后自动触发 .github/workflows/code-review.yml
# 3. PR 中会自动出现 inline 评论

### 场景 C：安全专项审查

# 针对包含敏感逻辑的变更
git diff main...HEAD | opencode-code-review security-review
# 或在 OpenCode 中 /security-review

### 场景 D：全量扫描指定路径

opencode-code-review scan  # 注意：scan 读 stdin，需先构造 diff
# 或在 OpenCode 中 /scan src/

### 场景 E：发布 findings 到 PR

opencode-code-review publish \
  --owner your-name \
  --repo your-repo \
  --pr 42 \
  --file findings.json \
  --token "$GITHUB_TOKEN" \
  --mode incremental

## 进阶配置

### 自定义审查规则

编辑 `review-rules/security.json` 和 `review-rules/quality.json`，添加自定义规则：

{
  "id": "no-console-log",
  "name": "禁止 console.log",
  "severity": "low",
  "category": "quality",
  "patterns": [
    { "type": "regex", "pattern": "console\\.log\\(", "message": "生产代码不应使用 console.log" }
  ]
}

### 启用知识图谱 MCP（可选）

把 `opencode.jsonc` 中 `mcp.code-review-graph.enabled` 改为 `true`：

npm install -g code-review-graph
code-review-graph serve &

启用后 Agent 可查询调用链与爆炸半径，提升审查精度。不可用时自动降级为 grep。

### 切换模型

修改 `opencode.jsonc` 顶层 `model` 字段：

{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-opus-4-1-20250805",   // 换成更强模型
  "agent": { ... }
}

所有 Agent 自动继承顶层主模型。如需某个 Agent 用不同模型，在该 agent 内单独声明 `model` 覆盖。

## 故障排查

| 症状 | 原因 | 解决 |
|---|---|---|
| `LLM config is invalid` | API Key 未配置 | 检查 `ANTHROPIC_API_KEY` 环境变量 |
| Agent 输出为空 | diff 为空 | 确认 `git diff main...HEAD` 有内容 |
| `/review` 命令未触发 | OpenCode 未识别配置 | 重启 OpenCode，或检查 `opencode.jsonc` 语法 |
| MCP 不可用降级 grep | `code-review-graph` 未安装 | `npm install -g code-review-graph` 后重启 |
| 中文乱码 | Windows PowerShell 编码 | `chcp 65001` 切换到 UTF-8 |

## 下一步

- 阅读 [README.md](../README.md) 了解完整 API
- 阅读 [docs/architecture.md](./architecture.md) 了解六层架构
- 阅读 [SPEC.md](../SPEC.md) 了解设计哲学
- 自定义 `.opencode/agents/*.md` 调整 Agent prompt
```

### Step 2：README 添加跳转链接

**文件**：[README.md](file:///d:/AI/project/check/review/opencode-code-review-pkg/README.md)

**改动位置**：第 121 行 "更多示例参见 SPEC.md 与 tests/ 目录。" 之后

**新增内容**：

```markdown
👉 **OpenCode 用户**：请阅读 [OpenCode 快速集成指南](./docs/quickstart.md)，5 分钟完成集成并触发首次审查。
```

### Step 3：修复 README 第 232-251 行的过时代码片段

**文件**：[README.md:232-251](file:///d:/AI/project/check/review/opencode-code-review-pkg/README.md#L232-L251)

**当前过时内容**（与上一轮顶层 model 重构不一致）：

```jsonc
// opencode.jsonc 片段
{
  "agent": {
    "code-reviewer": {
      "description": "通用代码审查 Agent",
      "model": "anthropic/claude-sonnet-4-5",   // ← 过时：agent 内不应再有 model
      "tools": { "write": false, "edit": false }
    }
    // ... 其余 Agent
  },
  "mcp": { ... }
}
```

**改为**：

```jsonc
// opencode.jsonc 片段（顶层 model + agent 继承）
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-5",        // ← 顶层主模型，所有 agent 继承
  "agent": {
    "code-reviewer": {
      "description": "通用代码审查 Agent",
      "tools": { "write": false, "edit": false }  // ← agent 内不再声明 model
    }
    // ... 其余 Agent
  },
  "mcp": { ... }
}
```

## 验证步骤

1. **文档可读性**：
   - 通读 `docs/quickstart.md`，检查步骤连贯性
   - 验证所有命令片段在 PowerShell 下可执行（`opencode-code-review init`、`/review`、`export ANTHROPIC_API_KEY=...`）
   - 验证所有文件路径引用准确（`docs/quickstart.md` 引用 `../README.md`、`./architecture.md`、`../SPEC.md`）

2. **README 一致性**：
   - 检查 README 第 232-251 行的代码片段与 [opencode-config/opencode.jsonc](file:///d:/AI/project/check/review/opencode-code-review-pkg/opencode-config/opencode.jsonc) 实际结构一致
   - 检查 README 跳转链接 `./docs/quickstart.md` 指向的文件确实存在

3. **Markdown 渲染**：
   - 用 markdown linter（如 `npx markdownlint-cli2 docs/quickstart.md`）检查格式
   - 表格对齐、代码块语言标签完整

4. **不运行测试**：本计划纯文档型，不涉及代码改动，无需 `npm test` / `npm run lint`

## 假设与边界

1. **不修改任何代码**：`src/`、`opencode-config/`、`tests/` 全部不动
2. **不修复架构断点**：`.opencode/commands/*.md` 不调用底层 pipeline 的问题不在本次范围，文档中只在"故障排查"暗示用户即可
3. **不修复 `scan` 命令实现不一致**：cli.ts 的 `scan` 读 stdin 但 README 描述为 `scan ./src`，这是已知 bug，不在本次范围；quickstart.md 中明确说"scan 读 stdin，需先构造 diff"
4. **文档语言为中文**：与 README 主体保持一致
5. **覆盖 5 种典型场景**：本地开发、PR 审查、安全审查、全量扫描、CI 自动化
6. **故障排查表覆盖常见 5 个问题**：API Key、空 diff、命令未触发、MCP 不可用、Windows 编码

## 文件改动清单

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `docs/quickstart.md` | 新建 | OpenCode 快速集成指南，5 步上手 + 5 个场景 + 进阶配置 + 故障排查 |
| `README.md` | 编辑 | 第 121 行后添加跳转链接；第 232-251 行代码片段与顶层 model 重构保持一致 |
