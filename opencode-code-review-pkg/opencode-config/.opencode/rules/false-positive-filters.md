# 误报硬排除规则

本文件定义 17 条硬排除规则。当 finding 的 message / file / category 命中任意一条正则，
且 `confidence < 0.85`（高置信度阈值，参见 `src/post-processor.ts` 的 `HIGH_CONFIDENCE_THRESHOLD`）时，
应直接标记为误报并跳过，不进入最终输出。

规则与 `src/post-processor.ts` 中的 `BUILTIN_FP_RULES` 实现保持一致并扩展。

## 匹配字段约定
- `message` — 对 finding.message（转小写后）做正则匹配
- `file` — 对 finding.file（路径）做正则匹配
- `category+severity` — 组合条件，需同时满足类别与严重级别

## 高置信度保护
所有规则仅在 `confidence < 0.85` 时生效；高于该阈值的 finding 一律保留，避免误杀真实缺陷。

---

## 规则列表

### 1. DOS / 速率限制建议
- **ID**: fp-rate-limit
- **字段**: message
- **正则**: `rate[\s_-]?limit|denial[\s_-]?of[\s_-]?service|\bdos\b|brute[\s_-]?force|throttle`
- **说明**: 除非有明确可利用漏洞，否则速率限制 / DOS 类建议视为噪音

### 2. 非 C/C++ 文件的内存安全问题
- **ID**: fp-memory-safety-non-c
- **字段**: category + file
- **正则（file 非匹配 C/C++）**: `(?<!\.(c|h|cpp|hpp|cc|cxx|ixx|cppm|ccm|cxxm))$`
- **类别条件**: `category == "memory-safety"`
- **说明**: 内存安全（buffer overflow / use-after-free / double free）仅对 C/C++ 系语言有意义

### 3. 开放重定向（低风险场景）
- **ID**: fp-open-redirect
- **字段**: message
- **正则**: `open[\s_-]?redirect|unvalidated[\s_-]?redirect`
- **说明**: 开放重定向在多数内部应用中风险有限，低置信度时过滤

### 4. 生成文件中的发现
- **ID**: fp-generated-file
- **字段**: file
- **正则**: `/generated/|/gen/|\.pb\.(go|rs)$|\.generated\.\w+$|\.g\.ts$`
- **说明**: protobuf、代码生成器产物不应由人工审查修复

### 5. 测试文件中的低危安全发现
- **ID**: fp-test-low-security
- **字段**: file + severity + category
- **正则（file）**: `\.(test|spec)\.(ts|js|tsx|jsx|py|java|go|rs)$|\.test\.|\.spec\.`
- **组合条件**: `severity == "low" && category == "security"`
- **说明**: 测试文件中的低危安全建议（如弱随机数）通常无需修复

### 6. TODO / FIXME 注释类发现
- **ID**: fp-todo-fixme
- **字段**: message
- **正则**: `\b(todo|fixme|hack|xxx)\b`
- **说明**: 注释中的 TODO/FIXME 不应作为审查 finding 上报

### 7. 日志级别建议
- **ID**: fp-log-level
- **字段**: message + severity
- **正则**: `log[\s_-]?level|logging[\s_-]?level|use[\s_-]?(warn|error|info|debug)|should[\s_-]?be[\s_-]?(warn|error|info)`
- **组合条件**: `severity == "low"`
- **说明**: 日志级别调整属于风格建议，低危时过滤

### 8. console.log 相关低危发现
- **ID**: fp-console-log-low
- **字段**: message + severity
- **正则**: `console\.(log|debug|info|trace)`
- **组合条件**: `severity == "low"`
- **说明**: console.log 移除建议在低危场景下噪音较大

### 9. 拼写 / typo 建议
- **ID**: fp-spelling
- **字段**: message
- **正则**: `spelling|typo|misspell|incorrect[\s_-]?spelling`
- **说明**: 拼写问题应由 linter 处理，不占用审查带宽

### 10. import 排序 / 格式化建议
- **ID**: fp-import-order
- **字段**: message
- **正则**: `import[\s_-]?order|import[\s_-]?sort|reorder[\s_-]?imports|organize[\s_-]?imports`
- **说明**: import 排序属格式化范畴，应由工具自动修复

### 11. 缺少 JSDoc / docstring（非公共 API）
- **ID**: fp-missing-jsdoc
- **字段**: message + severity
- **正则**: `missing[\s_-]?(jsdoc|docstring|comment)|add[\s_-]?(comment|doc)`
- **组合条件**: `severity == "low"`
- **说明**: 私有 / 内部方法缺少文档不应作为审查阻塞项

### 12. 魔法数字建议
- **ID**: fp-magic-number
- **字段**: message + severity
- **正则**: `magic[\s_-]?number`
- **组合条件**: `severity == "low"`
- **说明**: 魔法数字提取为常量属低危重构建议

### 13. 文件过长建议
- **ID**: fp-file-too-long
- **字段**: message + severity
- **正则**: `file[\s_-]?(too[\s_-]?long|length|size)|too[\s_-]?many[\s_-]?lines`
- **组合条件**: `severity == "low"`
- **说明**: 文件长度属架构性问题，单次审查难以根治

### 14. 函数过长 / 圈复杂度
- **ID**: fp-function-complexity
- **字段**: message + severity
- **正则**: `function[\s_-]?(too[\s_-]?long|length)|cyclomatic[\s_-]?complexity|cognitive[\s_-]?complexity|too[\s_-]?complex`
- **组合条件**: `severity == "low"`
- **说明**: 复杂度建议需大范围重构，低危时过滤

### 15. 缺少测试覆盖建议（低危）
- **ID**: fp-missing-test
- **字段**: message + severity
- **正则**: `missing[\s_-]?test|add[\s_-]?test|test[\s_-]?coverage|no[\s_-]?test[\s_-]?for`
- **组合条件**: `severity == "low"`
- **说明**: 测试覆盖建议应进入测试计划，而非阻塞代码审查

### 16. bundle / 依赖大小建议
- **ID**: fp-bundle-size
- **字段**: message
- **正则**: `bundle[\s_-]?size|dependency[\s_-]?size|package[\s_-]?size|reduce[\s_-]?bundle`
- **说明**: bundle 体积优化属性能调优范畴，非审查阻塞项

### 17. CSS 属性排序 / 样式格式化
- **ID**: fp-css-order
- **字段**: message
- **正则**: `css[\s_-]?(property[\s_-]?order|ordering|sort)|style[\s_-]?order|reorder[\s_-]?(css|properties)`
- **说明**: CSS 属性排序应由 stylelint 等工具自动处理

---

## 实现参考

上述规则在 `src/post-processor.ts` 的 `filterFalsePositives` 中以 `FalsePositiveRule` 形式实现；
高置信度保护通过 `HIGH_CONFIDENCE_THRESHOLD = 0.85` 实现。
脚本入口位于 `scripts/false-positive-filters.js`，支持 `--custom-rules` 传入额外 JSON 规则。
