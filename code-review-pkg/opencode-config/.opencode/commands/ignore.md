---
description: 管理 .reviewignore 忽略规则，支持查看、添加、删除、测试模式
agent: code-reviewer
subtask: true
params:
  - name: action
    type: string
    description: 操作类型，可选值：list（查看规则）、add（添加规则）、remove（删除规则）、test（测试文件是否被忽略）、validate（校验配置）
    enum:
      - list
      - add
      - remove
      - test
      - validate
  - name: pattern
    type: string
    description: 要添加/删除/测试的 glob 模式（add/remove 必填；test 时为文件路径）
    optional: true
  - name: path
    type: string
    description: .reviewignore 文件路径，默认为当前目录下的 .reviewignore
    default: .reviewignore
    optional: true
---

## .reviewignore 规则管理任务

### 操作参数
- **Action**: $action
- **Pattern**: $pattern
- **文件路径**: $path

### 文件格式说明

`.reviewignore` 文件格式参考 `.gitignore`，每行一条规则：

| 模式 | 含义 | 示例 |
|------|------|------|
| `dist/**` | 匹配 dist 目录下所有文件（含子目录） | 命中 `dist/foo.ts`、`dist/a/b/c.js` |
| `*.generated.ts` | 匹配任意路径下以 `.generated.ts` 结尾的文件 | 命中 `app.generated.ts`、`src/api.generated.ts` |
| `node_modules/` | 匹配目录及其下所有内容（末尾 `/` 表示目录） | 命中 `node_modules/lodash/index.js` |
| `/build` | 锚定到根目录的 build（前导 `/` 表示根锚定） | 仅命中根目录的 `build`，不命中 `src/build` |
| `!important.ts` | 取反规则，强制不忽略匹配的文件 | 在前述规则忽略后，重新包含 `important.ts` |
| `# comment` | 注释行（以 `#` 开头） | 解析时跳过 |
| `\#file.txt` | 字面 `#` 开头的文件名（`\#` 转义） | 命中 `#file.txt` |

### 匹配语义

应用规则时遵循 `.gitignore` 语义：
1. **默认不忽略**：未匹配任何规则的文件不会被忽略
2. **顺序敏感**：按规则出现顺序遍历，每条匹配规则更新"是否忽略"状态
3. **最后匹配优先**：若多条规则都匹配同一文件，以最后一条匹配规则的决定为准
4. **取反 (!) 重新包含**：取反规则将"是否忽略"状态置为 false

### 各 Action 执行说明

#### list
读取 `$path` 文件，列出所有有效规则（行号 + 原始内容 + 是否取反）。

```bash
code-review ignore list
```

#### add
将 `$pattern` 追加到 `$path` 文件末尾。若文件不存在则创建。
- 自动跳过空模式和重复模式
- 自动添加换行符

```bash
code-review ignore add "dist/**"
code-review ignore add "*.generated.ts"
code-review ignore add "node_modules/"
code-review ignore add "!important.ts"
```

#### remove
从 `$path` 中删除所有与 `$pattern` 完全相同的行（去除首尾空白后比较）。

```bash
code-review ignore remove "dist/**"
```

#### test
使用 `$pattern` 作为文件路径，加载 `$path` 配置后判断该路径是否会被忽略。

```bash
code-review ignore test "dist/bundle.js"
code-review ignore test "src/app.ts"
```

#### validate
校验 `$path` 文件的语法：检查每条模式是否能被 glob 解析器正确编译。

```bash
code-review ignore validate
```

### 输出格式

#### list 输出

```json
{
  "path": ".reviewignore",
  "patterns": [
    { "line": 1, "pattern": "dist/**", "negate": false },
    { "line": 2, "pattern": "*.generated.ts", "negate": false },
    { "line": 3, "pattern": "node_modules/", "negate": false },
    { "line": 4, "pattern": "important.ts", "negate": true }
  ]
}
```

#### test 输出

```json
{
  "file": "dist/bundle.js",
  "ignored": true,
  "matchedBy": "dist/**"
}
```

#### validate 输出

```json
{
  "path": ".reviewignore",
  "valid": true,
  "errors": []
}
```

### 集成行为

`.reviewignore` 文件被 `post-process` 插件的 `afterReview` 钩子自动加载（位于 `process.cwd()`）。
审查产出的 findings 中，凡 `file` 字段命中忽略规则的，将在后处理阶段被过滤掉，
不会出现在最终评论或报告中。

可通过以下方式控制：
- 在 OpenCode 调用上下文中传入 `ignoreConfig` 对象，跳过文件加载
- 传入 `ignoreConfigPath` 指定自定义路径
- 传入 `skipReviewIgnore: true` 完全禁用忽略机制

## Examples

### 场景 1：初始化 .reviewignore

为新项目创建一个标准的 `.reviewignore`，排除依赖、构建产物和生成文件。

```bash
code-review ignore add "node_modules/"
code-review ignore add "dist/**"
code-review ignore add "build/**"
code-review ignore add "*.generated.ts"
code-review ignore add "*.pb.go"
code-review ignore add "package-lock.json"
```

### 场景 2：取反规则保留重要文件

先忽略整个目录，再用取反规则保留目录中的重要文件。

```bash
code-review ignore add "vendor/**"
code-review ignore add "!vendor/important.ts"
```

### 场景 3：测试规则是否生效

在添加规则后，测试特定文件是否会被忽略。

```bash
code-review ignore test "vendor/lib/utils.ts"      # 预期 ignored: true
code-review ignore test "vendor/important.ts"      # 预期 ignored: false
code-review ignore test "src/app.ts"               # 预期 ignored: false
```

### 场景 4：批量清理过时规则

查看当前规则并删除不再需要的模式。

```bash
code-review ignore list
code-review ignore remove "*.bak"
code-review ignore remove "tmp/"
```

### 场景 5：校验配置文件

在团队共享配置变更后，校验语法是否正确。

```bash
code-review ignore validate
```
