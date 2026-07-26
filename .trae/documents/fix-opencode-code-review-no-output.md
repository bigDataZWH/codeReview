# 修复 opencode-code-review 命令无输出问题

## 问题根因

通过对沙箱重定向目录 `C:\Users\84702\AppData\Roaming\TRAE SOLO CN\ModularData\ai-agent\vm\tools\node\` 中 shim 文件的对比分析，**找到了根本原因**：

### shim 直接调用 .js 文件而未显式调用 node

对比两个 `.cmd` shim：

**opencode-code-review.cmd**（错误）：
```cmd
"%dp0%\node_modules\opencode-code-review\dist\cli.js"   %*
```

**marp.cmd**（正确，带 shebang 识别）：
```cmd
IF EXIST "%dp0%\node.exe" (SET "_prog=%dp0%\node.exe") ELSE (SET "_prog=node")
endLocal & ... "%_prog%"  "%dp0%\node_modules\@marp-team\marp-cli\marp-cli.js" %*
```

**根因**：npm 在生成 shim 时，会检测目标文件第一行是否为 `#!/usr/bin/env node` shebang：
- **有 shebang** → 生成显式调用 `node` 的 shim（如 marp.cmd）
- **无 shebang** → 视为普通可执行文件，shim 直接调用 `.js` 路径（如当前 opencode-code-review.cmd）

当前 `dist/cli.js` 第一行是 `import { ... }`，**没有 shebang**。Windows 上直接调用 `.js` 文件会用默认文件关联（通常是 WScript.exe GUI 模式），所以 **exit code 0 但无 stdout 输出**。

## 现状确认

- `d:\AI\project\check\review\opencode-code-review-pkg\src\cli.ts` 第一行是 import 语句，无 shebang
- `d:\AI\project\check\review\opencode-code-review-pkg\tsup.config.ts` 未配置 `banner` 选项
- `d:\AI\project\check\review\opencode-code-review-pkg\dist\cli.js` 第一行是 `import { ... }`
- npm prefix 被重定向到 `C:\Users\84702\AppData\Roaming\TRAE SOLO CN\ModularData\ai-agent\vm\tools\node\`
- 该目录下已存在 `opencode-code-review` / `.cmd` / `.ps1` 三个 shim，但都未显式调用 node

## 修复方案

### Step 1：修改 tsup.config.ts，为 ESM 输出添加 shebang banner

**文件**：`d:\AI\project\check\review\opencode-code-review-pkg\tsup.config.ts`

**改动**：添加 `banner.js = '#!/usr/bin/env node'`

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
```

**说明**：
- `banner.js` 会给所有输出 `.js` 文件顶部注入 shebang
- `dist/index.js` 也会带 shebang，但 Node.js v12+ 在加载模块时自动忽略首行 shebang，无副作用
- `dist/cli.js` 加上 shebang 后，npm 重新生成 shim 时会识别它并显式调用 node

### Step 2：重新构建 dist

```bash
cd d:\AI\project\check\review\opencode-code-review-pkg
npm run build
```

**验证**：构建完成后，用 Read 工具确认 `dist/cli.js` 第一行是 `#!/usr/bin/env node`。

### Step 3：重新生成 shim

```bash
cd d:\AI\project\check\review\opencode-code-review-pkg
npm install -g . --force
```

**说明**：
- `--force` 覆盖现有 shim
- 安装完成后，npm 会因 dist/cli.js 含 shebang 而生成显式调用 node 的正确 shim
- 用 Read 工具确认 `C:\Users\84702\AppData\Roaming\TRAE SOLO CN\ModularData\ai-agent\vm\tools\node\opencode-code-review.cmd` 中包含 `node` 调用

### Step 4：验证命令可用

```powershell
# 在 d:\AI\project\check\review 目录或任何位置执行
opencode-code-review
# 预期输出：打印帮助文本（opencode-code-review v0.1.0 + Usage: ...）

opencode-code-review --version
# 预期：因 cli.ts 未实现 --version 分支，会进入 else 分支打印帮助（命令本身可用即说明修复成功）
```

**验证标准**：
- 命令调用后 **有可见 stdout 输出**（不再是空白）
- exit code 0
- 输出包含 `opencode-code-review v0.1.0` 与 `Usage:` 字样

### Step 5：功能验证（可选）

```powershell
# 验证 parse 子命令（用一个简单的 diff 测试）
echo "" | opencode-code-review parse
# 预期：输出 `[]`（空 diff 解析结果）
```

## 假设与决策

### 假设
1. npm shim 生成机制依赖 shebang 检测，已通过 marp.cmd vs opencode-code-review.cmd 对比验证
2. `banner.js` 给 index.js 也加 shebang 无副作用（Node.js 自动忽略模块顶部 shebang）
3. 重新 `npm install -g . --force` 会覆盖旧 shim，生成正确的（显式调用 node 的）shim

### 决策
- 选择 `banner` 方案而非"构建后脚本注入"方案，理由：tsup 原生支持，配置集中，无需额外脚本
- 选择所有 js 都加 shebang 而非按入口区分，理由：tsup 的 banner 是全局选项，副作用可忽略（Node.js 模块加载器自动处理）
- 使用 `--force` 而非先删除后安装，理由：避免 TRAE 沙箱删除 npm 全局目录的限制

### 不修复的范围
- 不修复最初 `npm install -g opencode-code-review` 报 EEXIST（注册表同名包冲突）—— 已通过改用本地源码 `npm install -g .` 绕过
- 不修改 `src/cli.ts` 添加 shebang —— tsup 的 banner 会在构建时统一注入，源码保持纯净
- 不删除残留 `ocr*` shim —— TRAE 沙箱不允许删除，且与本地仓库 bin 名不冲突

## 验证步骤（最终）

完成 Step 1-4 后，执行以下命令作为最终验收：

```powershell
# 1. 命令存在
Get-Command opencode-code-review

# 2. 调用有输出
opencode-code-review 2>&1 | Out-String
# 预期：输出包含 "opencode-code-review v0.1.0"
```

如果仍有问题，备选验证方式（在真实 PowerShell 终端，非 TRAE 沙箱）：
```powershell
where.exe opencode-code-review
opencode-code-review
```
