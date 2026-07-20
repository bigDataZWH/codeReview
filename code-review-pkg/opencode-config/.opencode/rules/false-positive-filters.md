# 误报硬排除规则

本文件由 `scripts/sync-rules-md.js` 自动生成，与 `src/post-processor.ts` 中的 `BUILTIN_FP_RULES` 保持同步。

共定义 17 条硬排除规则。当 finding 满足规则条件且 `confidence < 0.85` 时，应直接标记为误报并跳过。

## 高置信度保护
所有规则仅在 `confidence < 0.85` 时生效；高于该阈值的 finding 一律保留，避免误杀真实缺陷。

---

## 规则列表

### 1. 非 C/C++ 文件内存安全问题
- **ID**: builtin-memory-safety-non-c
- **匹配条件**: category == "memory-safety"，confidence < 0.85，file 不是 C/C++ 文件

### 2. 速率限制/DOS 类建议
- **ID**: builtin-rate-limit
- **匹配条件**: confidence < 0.85，message 包含: rate limit、rate-limit、dos

### 3. 开放重定向建议
- **ID**: builtin-open-redirect
- **匹配条件**: confidence < 0.85，message 包含: open redirect

### 4. 生成文件中的发现
- **ID**: builtin-generated-file
- **匹配条件**: confidence < 0.85，file 是生成文件

### 5. 测试文件中的低优先级安全发现
- **ID**: builtin-test-low-security
- **匹配条件**: category == "security"，severity == "low"，confidence < 0.85，file 是测试文件

### 6. TODO/FIXME 注释
- **ID**: builtin-todo-fixme
- **匹配条件**: confidence < 0.85，message 包含: todo、fixme

### 7. 日志级别建议
- **ID**: builtin-log-level
- **匹配条件**: severity == "low"，confidence < 0.85，message 包含: log level、log level、logging

### 8. console.log 相关低级别发现
- **ID**: builtin-console-log-low
- **匹配条件**: severity == "low"，confidence < 0.85，message 包含: console.log

### 9. JSDoc/注释添加建议
- **ID**: builtin-jsdoc-comment-suggestion
- **匹配条件**: severity == "low"，confidence < 0.85，message 包含: jsdoc、添加注释、添加文档、add comments、add a comment、consider adding comments、missing comments、document this

### 10. 命名风格建议
- **ID**: builtin-naming-style-suggestion
- **匹配条件**: severity == "low"，confidence < 0.85，message 包含: naming convention、naming style、camelcase、pascalcase、snake_case、variable name should、name should be more descriptive、function name should、should follow naming

### 11. import 排序建议
- **ID**: builtin-import-sort-suggestion
- **匹配条件**: severity == "low"，confidence < 0.85，message 包含: imports should be sorted、import order、import sort、sort imports、imports are not sorted、import statements should

### 12. 代码格式化建议（prettier/eslint 风格）
- **ID**: builtin-code-formatting-suggestion
- **匹配条件**: severity == "low"，confidence < 0.85，message 包含: use single quotes、use double quotes、missing semicolon、missing comma、trailing comma、indentation、prettier、eslint、expected indentation、line is too long

### 13. 错误处理建议类低价值发现
- **ID**: builtin-error-handling-suggestion
- **匹配条件**: severity in ["low", "medium"]，confidence < 0.85，message 包含: error handling、exception handling、add error handling、add exception handling、try-catch、try catch、consider try-catch、use try-catch

### 14. 空 catch 块建议类低价值发现
- **ID**: builtin-empty-catch
- **匹配条件**: severity in ["low", "medium"]，confidence < 0.85，message 包含: empty catch、catch block is empty、catch is empty、empty catch block

### 15. 可空引用建议类低价值发现
- **ID**: builtin-null-reference
- **匹配条件**: severity in ["low", "medium"]，confidence < 0.85，message 包含: null reference、potential null、possible null、may be null、might be null、could be null

### 16. 未使用变量建议类低价值发现
- **ID**: builtin-unused-variable
- **匹配条件**: severity in ["low", "medium"]，confidence < 0.85，message 包含: unused variable、variable is never used、is never used、never used

### 17. 过长函数建议类低价值发现
- **ID**: builtin-long-function
- **匹配条件**: severity in ["low", "medium"]，confidence < 0.85，message 包含: function too long、function is too long、method too long、method is too long、consider splitting、split this function、split this method

---

## 实现参考

上述规则在 `src/post-processor.ts` 的 `filterFalsePositives` 中以 `FalsePositiveRule` 形式实现；
高置信度保护通过 `HIGH_CONFIDENCE_THRESHOLD = 0.85` 实现。
