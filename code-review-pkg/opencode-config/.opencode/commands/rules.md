---
description: 管理代码审查规则：列出、查看、启用、禁用、覆盖规则参数
agent: code-reviewer
subtask: true
params:
  - name: action
    type: string
    description: 子命令，可选值：list、show、enable、disable、override
    enum:
      - list
      - show
      - enable
      - disable
      - override
  - name: ruleId
    type: string
    description: 规则 ID（show/enable/disable/override 必填；list 不需要）
    optional: true
  - name: severity
    type: string
    description: 覆盖严重度（仅 override 子命令使用），可选值：critical、high、medium、low
    enum:
      - critical
      - high
      - medium
      - low
    optional: true
  - name: name
    type: string
    description: 覆盖规则名称（仅 override 子命令使用）
    optional: true
  - name: category
    type: string
    description: 覆盖规则类别（仅 override 子命令使用）
    optional: true
  - name: description
    type: string
    description: 覆盖规则描述（仅 override 子命令使用）
    optional: true
  - name: rulesDir
    type: string
    description: 自定义规则目录路径，默认 review-rules
    default: review-rules
    optional: true
  - name: config
    type: string
    description: 规则定制配置文件路径，默认 .code-review-rules.json
    default: .code-review-rules.json
    optional: true
---

## 规则管理任务

### 任务参数
- **子命令**: $action
- **规则 ID**: $ruleId
- **严重度覆盖**: $severity
- **名称覆盖**: $name
- **类别覆盖**: $category
- **描述覆盖**: $description
- **规则目录**: $rulesDir
- **配置文件**: $config

### 任务目标
管理代码审查规则库，支持：
1. **列出所有规则**：展示当前激活与禁用的规则
2. **查看规则详情**：以 JSON 格式输出指定规则的完整定义
3. **启用规则**：取消之前禁用的规则
4. **禁用规则**：通过 ID 禁用特定规则（保留定义，仅标记为 disabled）
5. **覆盖规则参数**：通过配置覆盖默认规则的 severity / name / category / description

### 规则加载与定制流程

1. **加载自定义规则**：从 `$rulesDir` 目录读取所有 JSON / YAML 规则文件
2. **加载定制配置**：从 `$config` 文件读取已禁用规则 ID 列表与规则覆盖配置
3. **应用配置**：先应用 overrides 覆盖默认参数，再应用 disabled 列表禁用规则
4. **持久化**：enable / disable / override 操作会更新 `$config` 文件

### 调用方式

通过 `code-review rules` CLI 命令完成所有操作：

```bash
# 列出所有规则（激活与禁用）
code-review rules list

# 查看指定规则详情
code-review rules show <rule-id>

# 启用规则（取消禁用）
code-review rules enable <rule-id>

# 禁用规则
code-review rules disable <rule-id>

# 覆盖规则参数
code-review rules override <rule-id> --severity critical
code-review rules override <rule-id> --name "新名称" --category security
code-review rules override <rule-id> --description "新的规则描述"
```

### 自定义规则文件格式

在 `review-rules/` 目录下创建 JSON 文件，每个文件可包含单条规则或规则数组：

```json
[
  {
    "id": "custom-no-console",
    "name": "禁止 console.log",
    "severity": "low",
    "category": "quality",
    "language": ["typescript", "javascript"],
    "patterns": [
      { "type": "regex", "pattern": "console\\.log\\(", "message": "生产代码中不应使用 console.log" }
    ]
  }
]
```

### 配置文件格式

`.code-review-rules.json` 文件结构：

```json
{
  "disabled": ["rule-id-1", "rule-id-2"],
  "overrides": {
    "rule-id-3": {
      "severity": "critical",
      "name": "新名称",
      "description": "覆盖后的描述"
    }
  }
}
```

### 输出格式

#### `list` 子命令输出

```
Rules directory: /path/to/review-rules
Config file: /path/to/.code-review-rules.json
Total: 10  Active: 8  Disabled: 2

Active rules:
  - sql-injection  (high/security)  SQL 注入检测
  - xss  (high/security)  XSS 检测

Disabled rules:
  - no-any-type  (medium/quality)  禁止 any 类型
```

#### `show` 子命令输出

```json
{
  "id": "sql-injection",
  "name": "SQL 注入检测",
  "severity": "high",
  "category": "security",
  "patterns": [
    { "type": "regex", "pattern": "(execute|query)\\s*\\(\\s*[\"'].*\\+", "message": "检测到字符串拼接构造 SQL" }
  ]
}
```

#### `enable` / `disable` / `override` 子命令输出

```
Disabled rule: sql-injection
Config saved to: /path/to/.code-review-rules.json
```

### 注意

- 禁用规则不会从规则文件中删除，仅在配置中标记为 disabled，便于后续恢复
- 覆盖规则参数会持久化到 `.code-review-rules.json`，不修改原始规则文件
- 同一规则 ID 的多次覆盖会合并到现有覆盖配置中
- 规则 ID 不存在时，disable / enable 操作仍会写入配置（便于先于规则文件配置）
- override 操作至少需要一个覆盖选项（--severity / --name / --category / --description）

## Examples

### 场景 1：列出当前所有规则
查看 review-rules/ 目录中加载的所有规则，区分激活与禁用状态。

```bash
code-review rules list
```

### 场景 2：禁用特定规则
临时禁用某条误报率较高的规则，不删除规则文件。

```bash
code-review rules disable no-any-type
```

### 场景 3：提升规则严重度
将某条规则提升为 critical，确保高优先级匹配。

```bash
code-review rules override sql-injection --severity critical
```

### 场景 4：组合覆盖
同时覆盖规则名称和描述，使其更贴合团队规范。

```bash
code-review rules override no-any-type --name "禁止使用 any 类型" --description "所有 any 使用必须显式标注"
```

### 场景 5：恢复禁用规则
重新启用之前禁用的规则。

```bash
code-review rules enable no-any-type
```

### 场景 6：使用自定义规则目录
指定其他规则目录与配置文件路径。

```bash
code-review rules list --rules-dir ./custom-rules --config ./.custom-rules.json
```
