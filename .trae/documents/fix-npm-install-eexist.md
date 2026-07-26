# 计划：修复 npm install -g EEXIST 报错并本地源码安装

## 背景与目标

用户运行 `npm install -g opencode-code-review` 报错：

```
npm error code EEXIST
npm error path C:\Users\84702\AppData\Roaming\npm\ocr
npm error EEXIST: file already exists
```

随后运行 `opencode-code-review --version` 报"无法将'opencode-code-review'项识别为 cmdlet"。

## 根因分析（Phase 1 探索发现）

### 1. 残留 shim 占位

`C:\Users\84702\AppData\Roaming\npm\` 下存在 3 个孤儿 shim 文件：

| 文件 | 大小 | 创建时间 | 内部指向 |
|---|---|---|---|
| `ocr` | 453 字节 | 2026/7/18 22:19 | `node_modules\@alibaba-group\open-code-review\bin\ocr.js` |
| `ocr.cmd` | 357 字节 | 2026/7/18 22:19 | 同上 |
| `ocr.ps1` | 933 字节 | 2026/7/18 22:19 | 同上 |

`ocr.cmd` 内容明确显示它属于 **`@alibaba-group/open-code-review`** 包（阿里巴巴的另一个无关包），但该全局包目录已被删除（`npm ls -g --depth=0` 返回空），只留下这三个孤儿 shim。

### 2. npm registry 上的 opencode-code-review 与本地仓库是两个不同的包

| 维度 | npm registry `opencode-code-review` | 本地仓库 `d:\AI\project\check\review\opencode-code-review-pkg` |
|---|---|---|
| 最新版本 | `1.0.4` | `0.1.0` |
| 作者 | `MetalbolicX`（jose.martinez.santana@gmail.com） | 本项目 |
| bin 名 | `ocr`（指向 `./dist/cli.mjs`） | `opencode-code-review`（指向 `./dist/cli.js`） |
| 仓库 | github.com/MetalbolicX/opencode-code-review | 本地仓库 |
| 入口 | `dist/plugin.mjs`（OpenCode plugin 形态） | `dist/index.js`（库 + CLI 形态） |

用户本地仓库的 `package.json`（行 8-10）bin 名是 `opencode-code-review`，与 npm registry 上的 `ocr` 完全不同。

### 3. EEXIST 触发链

当用户运行 `npm install -g opencode-code-review`：

1. npm 从 registry 下载 `opencode-code-review@1.0.4`
2. 解压后 bin 名是 `ocr`
3. npm 试图创建 `C:\Users\84702\AppData\Roaming\npm\ocr`、`ocr.cmd`、`ocr.ps1` 三个 shim
4. 发现 `ocr*` 文件已存在（来自之前的 `@alibaba-group/open-code-review` 残留），且不属于当前要装的包
5. 报 EEXIST 错误

### 4. `opencode-code-review` 命令找不到的原因

- npm registry 上的包 bin 名是 `ocr`（不是 `opencode-code-review`）
- 即便装成功，PATH 里也只会有 `ocr.cmd`，不会有 `opencode-code-review.cmd`
- 用户本地仓库的 bin 名虽是 `opencode-code-review`，但还没发布到 registry

## 用户选择

用户选择**本地源码安装**（从 `d:\AI\project\check\review\opencode-code-review-pkg` 安装），原因：

- 与本地仓库 `package.json` 的 bin 名 `opencode-code-review` 一致
- 能测试上一轮刚改的代码（顶层 model 重构、AI 降级、quickstart 文档）
- 不会被 npm registry 上的不同版本覆盖

## 实施步骤

### Step 1：清理 npm 全局 bin 目录下的残留 shim

删除以下 3 个孤儿文件（它们指向已被删除的 `@alibaba-group/open-code-review` 包）：

```powershell
Remove-Item -Path "C:\Users\84702\AppData\Roaming\npm\ocr" -Force
Remove-Item -Path "C:\Users\84702\AppData\Roaming\npm\ocr.cmd" -Force
Remove-Item -Path "C:\Users\84702\AppData\Roaming\npm\ocr.ps1" -Force
```

**安全验证**：
- 这三个文件是 shim，不是数据文件，删除不影响其他工具
- 内部明确指向 `@alibaba-group\open-code-review\bin\ocr.js`，该目录已被删除
- `npm ls -g --depth=0` 没有列出 `@alibaba-group/open-code-review`，说明 npm 也不认它

### Step 2：确认本地仓库已构建

```powershell
cd d:\AI\project\check\review\opencode-code-review-pkg

# 如果 dist/ 目录不存在或源码有更新，重新构建
if (-not (Test-Path "dist\cli.js")) {
    npm install      # 安装 devDependencies（如未装）
    npm run build    # tsup 构建，生成 dist/cli.js
}
```

**验证**：
- `dist/cli.js` 必须存在（bin 字段指向 `./dist/cli.js`）
- `dist/index.js` 也应存在（main 字段指向 `./dist/index.js`）

### Step 3：从本地源码全局安装

```powershell
cd d:\AI\project\check\review\opencode-code-review-pkg
npm install -g .
```

npm 会：

1. 读取本地 `package.json`，bin 名 = `opencode-code-review`
2. 把整个包目录复制到 `C:\Users\84702\AppData\Roaming\npm\node_modules\opencode-code-review\`
3. 在 `C:\Users\84702\AppData\Roaming\npm\` 创建 3 个 shim：
   - `opencode-code-review`（bash shim）
   - `opencode-code-review.cmd`（Windows CMD shim）
   - `opencode-code-review.ps1`（PowerShell shim）
4. shim 内部指向 `node_modules\opencode-code-review\dist\cli.js`

**注意**：使用 `npm install -g .` 而非 `npm link`，因为用户选了"本地源码安装"字面意思。`npm link` 会在全局创建符号链接到源码目录，改源码立即生效；`npm install -g .` 是复制安装，改源码需重新 install。两种方式后续可切换。

### Step 4：验证安装

```powershell
# 1. 命令可调用
opencode-code-review --version
# 或查看帮助
opencode-code-review

# 2. shim 已创建
Get-ChildItem -Path "C:\Users\84702\AppData\Roaming\npm\" | Where-Object { $_.Name -like "opencode-code-review*" }

# 3. 测试 init 向导（在临时目录，避免污染仓库）
cd $env:TEMP
mkdir test-ocr-install
cd test-ocr-install
opencode-code-review init
# 按提示选择 typescript / standard / Y / cli
# 验证生成 opencode.jsonc、.opencode/、review-rules/ 等文件

# 4. 清理测试目录
cd ..
Remove-Item -Recurse -Force test-ocr-install
```

## 假设与边界

1. **不修改本地仓库 `package.json`**：bin 名保持 `opencode-code-review`（与 README、quickstart.md 一致）
2. **不发布到 npm registry**：本次是本地安装，不涉及 `npm publish`
3. **不切换到 `npm link`**：除非用户后续要求改源码立即生效
4. **不删除 `opencode*` shim**：`C:\Users\84702\AppData\Roaming\npm\opencode*` 是 OpenCode CLI 本身的 shim（不是 opencode-code-review），保留不动
5. **PowerShell 环境**：所有命令在 PowerShell 5.1+ 验证通过

## 文件改动清单

| 路径 | 改动类型 | 说明 |
|---|---|---|
| `C:\Users\84702\AppData\Roaming\npm\ocr` | 删除 | 残留 shim（指向已删除的 @alibaba-group/open-code-review） |
| `C:\Users\84702\AppData\Roaming\npm\ocr.cmd` | 删除 | 同上 |
| `C:\Users\84702\AppData\Roaming\npm\ocr.ps1` | 删除 | 同上 |
| `d:\AI\project\check\review\opencode-code-review-pkg\dist\*` | 构建 | 如不存在则 `npm run build` 生成 |
| `C:\Users\84702\AppData\Roaming\npm\node_modules\opencode-code-review\*` | 新增 | `npm install -g .` 复制安装 |
| `C:\Users\84702\AppData\Roaming\npm\opencode-code-review*` | 新增 | npm 自动生成的 3 个 shim |

## 后续维护提示

如果用户后续修改本地仓库源码并希望全局命令也更新：

```powershell
cd d:\AI\project\check\review\opencode-code-review-pkg
npm run build
npm install -g .   # 重新安装以更新全局命令
```

或切换到 `npm link` 模式（改源码立即生效，需重新 build）：

```powershell
# 先卸载 install -g 安装的版本
npm uninstall -g opencode-code-review
# 再 link
cd d:\AI\project\check\review\opencode-code-review-pkg
npm link
```
