# OCR-Pipe — OpenCode 代码审查确定性管道

> 基于 TDD 开发的代码审查核心管道，承载优化方案中的"确定性管道层 + 编排控制层 + 状态数据层 + 后处理层 + 反馈闭环"。

## 核心能力

- **Git Diff 解析器**：解析变更文件列表与 Hunk 内容
- **文件过滤与智能打包**：基于 glob/正则过滤，关联文件归并
- **规则引擎匹配器**：YAML 规则模板 + 预标注
- **编排控制层**：会话管理、Agent DAG 编排、任务调度
- **状态存储**：SQLite 持久化 + 三级缓存
- **三阶段后处理**：硬规则过滤 → 定位修正 → AI 反思
- **反馈闭环**：采集 → 分析 → 调优建议
- **大 PR 分级策略**：4 级分级处理
- **异常处理与降级**：MCP 不可用、模型超时等场景

## 技术栈

- TypeScript 5.4 + Node.js 18+
- Jest（测试驱动开发）
- 原生 SQLite（better-sqlite3 可选）

## 快速开始

```bash
npm install
npm test              # 运行测试
npm run build         # 构建
npm run test:coverage # 覆盖率报告
```

## 架构对应

参见 `../opencode-code-review/opencode-code-review-optimized.html` 中的六层架构设计。
