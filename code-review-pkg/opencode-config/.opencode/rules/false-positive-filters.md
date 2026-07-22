# 误报硬排除规则

本文件由 `scripts/sync-rules-md.js` 自动生成，与 `src/post-processor.ts` 中的 `BUILTIN_FP_RULES` 保持同步。

共定义 13 条硬排除规则。当 finding 满足规则条件且 `confidence < 0.85` 时，应直接标记为误报并跳过。

## 高置信度保护
所有规则仅在 `confidence < 0.85` 时生效；高于该阈值的 finding 一律保留，避免误杀真实缺陷。

---

## 规则列表

### 1. 非 C/C++ 文件内存安全问题
- **ID**: builtin-memory-safety-non-c
- **匹配条件**: category == "memory-safety"，confidence < 0.85，file 不是 C/C++ 文件

### 2. 速率限制/DOS 类建议
- **ID**: builtin-rate-limit
- **匹配条件**: confidence < 0.85

### 3. 开放重定向建议
- **ID**: builtin-open-redirect
- **匹配条件**: confidence < 0.85

### 4. 生成文件中的发现
- **ID**: builtin-generated-file
- **匹配条件**: confidence < 0.85，file 是生成文件

### 5. 测试文件中的低优先级安全发现
- **ID**: builtin-test-low-security
- **匹配条件**: category == "security"，severity == "low"，confidence < 0.85，file 是测试文件

### 6. TODO/FIXME 注释
- **ID**: builtin-todo-fixme
- **匹配条件**: confidence < 0.85

### 7. 日志级别建议
- **ID**: builtin-log-level
- **匹配条件**: severity == "low"，confidence < 0.85

### 8. console.log 相关低级别发现
- **ID**: builtin-console-log-low
- **匹配条件**: severity == "low"，confidence < 0.85

### 9. 错误处理建议类低价值发现
- **ID**: builtin-error-handling-suggestion
- **匹配条件**: severity in ["low", "medium"]，confidence < 0.85

### 10. 空 catch 块建议类低价值发现
- **ID**: builtin-empty-catch
- **匹配条件**: severity in ["low", "medium"]，confidence < 0.85

### 11. 可空引用建议类低价值发现
- **ID**: builtin-null-reference
- **匹配条件**: severity in ["low", "medium"]，confidence < 0.85

### 12. 未使用变量建议类低价值发现
- **ID**: builtin-unused-variable
- **匹配条件**: severity in ["low", "medium"]，confidence < 0.85

### 13. 过长函数建议类低价值发现
- **ID**: builtin-long-function
- **匹配条件**: severity in ["low", "medium"]，confidence < 0.85

---

## 实现参考

上述规则在 `src/post-processor.ts` 的 `filterFalsePositives` 中以 `FalsePositiveRule` 形式实现；
高置信度保护通过 `HIGH_CONFIDENCE_THRESHOLD = 0.85` 实现。
