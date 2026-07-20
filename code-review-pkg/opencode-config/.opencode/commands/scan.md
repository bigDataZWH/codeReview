---
description: 全量扫描指定目录的代码问题，支持语言识别、生成文件排除和自定义过滤
agent: code-reviewer
subtask: true
params:
  - name: path
    type: string
    description: 扫描目录路径，默认当前目录
    default: "."
  - name: language
    type: string[]
    description: 指定语言过滤，可选值：typescript, javascript, python, go, rust, java, cpp, c, ruby, php 等
    optional: true
  - name: limit
    type: number
    description: 限制扫描文件数量，默认不限制（0）
    default: 0
  - name: exclude
    type: string[]
    description: 排除模式（glob），如 "vendor/**", "node_modules/**", "*.generated.ts"
    optional: true
---

## 全量代码扫描任务

### 扫描配置
- **扫描路径**: $path
- **语言过滤**: $language (未指定时自动识别)
- **文件限制**: $limit (0 表示不限制)
- **排除模式**: $exclude

### 扫描内容
!`find $path -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.kt" -o -name "*.cpp" -o -name "*.c" -o -name "*.rb" -o -name "*.php" -o -name "*.swift" -o -name "*.dart" -o -name "*.vue" -o -name "*.svelte" -o -name "*.html" -o -name "*.css" -o -name "*.scss" -o -name "*.json" -o -name "*.yaml" -o -name "*.yml" -o -name "*.sql" -o -name "*.sh" -o -name "*.dockerfile" -o -name "Dockerfile" -o -name "Makefile" \) | head -${limit:-50}`

### 扫描预处理规则
1. **自动语言识别**: 使用文件扩展名自动识别编程语言
2. **生成文件排除**: 自动排除包含 `@generated` 标记的文件
3. **排除模式过滤**: 根据 $exclude 参数过滤指定模式的文件
4. **文件数量限制**: 根据 $limit 参数限制扫描文件数量

### 扫描要求
对指定目录中的代码进行全面审查：
1. 安全漏洞（SQL注入、XSS、CSRF、路径遍历等）
2. 代码质量问题（复杂度、可维护性、命名规范）
3. 架构和设计问题（耦合度、职责划分）
4. 性能问题（内存泄漏、N+1 查询等）
5. 测试覆盖不足

### 语言特定审查提示

**TypeScript/JavaScript**: 关注类型安全，避免 `any`，检查类型断言，确保泛型约束正确；检查 undefined/null 处理，避免隐式类型转换，验证异步错误处理

**Python**: 关注类型提示，避免可变默认参数，确保资源正确释放，检查异常处理完整性

**Go**: 关注错误处理（err != nil），避免 goroutine 泄漏，确保并发安全，检查 defer 使用

**Rust**: 关注 unsafe 使用，避免不必要的 clone，确保生命周期正确，检查 borrow checker 问题

**Java**: 关注空指针处理，避免资源泄漏，确保异常处理完整，检查并发安全

**C/C++**: 关注内存管理（智能指针），避免缓冲区溢出，确保 RAII 模式，检查未定义行为

### 输出格式
输出格式为 JSON 数组，每个 finding 对象包含以下字段：

```json
[
  {
    "file": "src/app.ts",
    "line": 42,
    "severity": "medium",
    "category": "security",
    "message": "SQL injection vulnerability",
    "suggestion": "Use parameterized queries",
    "confidence": 0.8,
    "source": "ai"
  }
]
```

**字段说明**：
- `file`: 文件路径（必需）
- `line`: 行号（必需，数字）
- `severity`: 严重程度（必需，取值：critical / high / medium / low / info）
- `category`: 类别（必需，取值：security / quality / architecture / performance / test）
- `message`: 问题描述（必需）
- `suggestion`: 修复建议（可选）
- `confidence`: 置信度（必需，0-1 之间的数字）
- `source`: 来源（必需，取值：rule / ai）

### 注意
- 仅关注高价值发现（Medium 及以上）
- 给出具体的文件路径和行号
- 每个发现附带修复建议
- 自动排除生成文件，无需人工筛选

## Examples

### 场景 1：扫描当前目录
扫描当前目录下所有支持的代码文件，自动识别语言类型。

```bash
code-review scan
```

### 场景 2：扫描指定语言
仅扫描 TypeScript 和 Python 文件，排除其他语言。

```bash
code-review scan --language typescript --language python
```

### 场景 3：排除特定目录扫描
扫描项目但排除 node_modules、dist 和 vendor 目录。

```bash
code-review scan --exclude "node_modules/**" --exclude "dist/**" --exclude "vendor/**"
```

### 场景 4：限制扫描文件数量
扫描前 100 个文件，适用于大型项目的快速评估。

```bash
code-review scan --limit 100
```