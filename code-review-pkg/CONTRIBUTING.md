# 贡献指南

感谢你对 `code-review` 的关注！本文档描述如何参与本项目开发，包括代码贡献、规则贡献、问题反馈等流程。

- 项目仓库：<https://github.com/bigDataZWH/codeReview>
- 设计规格：[SPEC.md](./SPEC.md)
- 架构详解：[docs/architecture.md](./docs/architecture.md)

---

## 目录

- [贡献流程](#贡献流程)
- [TDD 开发流程](#tdd-开发流程)
- [代码风格](#代码风格)
- [测试要求](#测试要求)
- [提交规范](#提交规范)
- [规则贡献](#规则贡献)
- [Issue 报告](#issue-报告)

---

## 贡献流程

所有贡献通过 Pull Request 提交，遵循标准 Fork → Branch → Commit → PR 流程。

### 1. Fork 仓库

在 GitHub 上点击右上角 **Fork** 按钮，将仓库 fork 到你的个人账号下，然后克隆到本地：

```bash
git clone https://github.com/<你的用户名>/codeReview.git
cd codeReview
git remote add upstream https://github.com/bigDataZWH/codeReview.git
```

### 2. 安装依赖

```bash
npm install
```

### 3. 创建分支

从最新的 `main` 创建特性分支，分支名采用 `<type>/<scope>-<short-desc>` 形式：

```bash
git checkout main
git pull upstream main
git checkout -b feat/rule-engine-custom-matcher
```

`type` 取值与提交规范保持一致（见下文）。

### 4. 编码 + 测试

按 [TDD 开发流程](#tdd-开发流程) 先写测试再写实现。本地通过以下命令验证：

```bash
npm run lint        # TypeScript 严格模式类型检查
npm test            # 运行所有测试
npm run test:coverage
```

### 5. 提交并推送

按 [Conventional Commits](#提交规范) 撰写 commit message：

```bash
git add src/rule-engine.ts tests/rule-engine.test.ts
git commit -m "feat(rule-engine): 支持 contains_none 匹配器"
git push origin feat/rule-engine-custom-matcher
```

### 6. 发起 Pull Request

在 GitHub 上发起 PR：

- **目标分支**：`main`
- **标题**：与 commit 标题一致
- **描述**：说明动机、改动范围、测试情况；关联相关 Issue（`Closes #123`）
- **检查项**：CI 必须全绿（lint + test + coverage）

维护者会在 3 个工作日内进行 Code Review，可能要求修改或补充测试。

### PR 检查清单

- [ ] commit message 符合 Conventional Commits
- [ ] 新增/修改的代码有对应测试
- [ ] 总体覆盖率不低于 90%
- [ ] TypeScript 严格模式无报错
- [ ] 未引入新依赖（如必须引入，需在 PR 中说明）
- [ ] 文档已同步更新（README、SPEC、docs/）
- [ ] 未提交 `dist/`、`coverage/`、`.env` 等产物

---

## TDD 开发流程

本项目严格遵循 **红 → 绿 → 重构** (Red-Green-Refactor) 的 TDD 循环。

### 为什么 TDD？

- 项目目标是"确定性管道"，每个纯函数都应有可验证的输入输出契约
- 测试即文档：未读源码也能从测试名理解函数行为
- 现有 1092 个测试用例支撑了 96.38% 覆盖率，新增代码必须保持这一基准

### 红：先写失败的测试

在 `tests/<module>.test.ts` 中新增测试，描述期望行为，**先跑一次确认失败**：

```typescript
import { describe, it, expect } from 'vitest';
import { matchRules } from '../src/rule-engine.js';
import type { Rule, FileBundle } from '../src/types.js';

describe('matchRules - contains_none', () => {
  it('当文件包含 items 中的任何字符串时不应触发', () => {
    const rule: Rule = {
      id: 'no-console',
      name: '禁用 console',
      severity: 'low',
      category: 'quality',
      patterns: [
        { type: 'contains_none', items: ['console.log', 'console.debug'], message: '不应使用 console' },
      ],
    };
    const bundle: FileBundle = {
      id: 'b1',
      primary: { path: 'a.ts', status: 'modified', hunks: [] },
      related: [],
      annotations: [],
    };

    const annotations = matchRules(bundle, [rule]);
    expect(annotations).toHaveLength(1);
  });
});
```

```bash
npm test -- rule-engine   # 应红
```

### 绿：写最小实现

让测试通过，**不追求完美**：

```typescript
// src/rule-engine.ts
case 'contains_none': {
  const hasAny = pattern.items?.some(item => content.includes(item));
  if (!hasAny) { /* 命中 */ }
  break;
}
```

```bash
npm test -- rule-engine   # 应绿
```

### 重构：清理与抽象

测试通过后，重构代码（提取常量、简化逻辑），**确保测试仍绿**：

```bash
npm run test:coverage     # 覆盖率不下降
```

### 测试分层

| 类型 | 目录 | 何时使用 |
|---|---|---|
| 单元测试 | `tests/*.test.ts` | 纯函数、边界条件、错误路径 |
| 集成测试 | `tests/integration/` | 跨模块协作（如 pipeline → cache） |
| 端到端测试 | `tests/e2e/` | 完整流程（CI、大 PR、安全审查） |
| 基准测试 | `tests/benchmark/` | 性能与准确性回归 |
| 快照测试 | `tests/*.test.ts` 内 | prompt / markdown 输出格式 |
| 属性测试 | `tests/*.test.ts` 内 | 随机输入下的不变量（如 diff 解析幂等） |

---

## 代码风格

### TypeScript 严格模式

`tsconfig.json` 启用了全部严格选项：

- `strict: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noFallthroughCasesInSwitch: true`
- `forceConsistentCasingInFileNames: true`

提交前必须通过：

```bash
npm run lint
```

### ESM 模块

- `package.json` 声明 `"type": "module"`
- 编译目标 `ES2022`，`moduleResolution: bundler`
- **所有内部 import 必须带 `.js` 后缀**（TS 编译为 JS 后实际加载路径）：

```typescript
// 正确
import { parseDiff } from './diff-parser.js';
import type { FileDiff } from './types.js';

// 错误
import { parseDiff } from './diff-parser';
```

### JSDoc 中文注释

所有导出的函数、接口、类型必须有 JSDoc 注释，**使用中文撰写**，描述用途、参数、返回值、异常：

```typescript
/**
 * 解析 unified diff 文本为结构化 FileDiff 数组。
 *
 * 处理以下边界场景：
 * - 文件重命名（`rename from/to`）
 * - 二进制文件（`Binary files ... differ`）
 * - `No newline at end of file` 标记
 * - 含 Unicode 字符的文件路径
 *
 * @param diffText - unified diff 文本
 * @returns 解析出的文件变更数组；空 diff 返回 `[]`
 *
 * @example
 * ```typescript
 * const files = parseDiff(diffText);
 * console.log(files.length);
 * ```
 */
export function parseDiff(diffText: string): FileDiff[] {
  // ...
}
```

### 命名约定

| 类型 | 风格 | 示例 |
|---|---|---|
| 文件 | `kebab-case.ts` | `diff-parser.ts` |
| 函数 | `camelCase` | `parseDiff`、`buildReviewPrompt` |
| 类型/接口 | `PascalCase` | `FileDiff`、`PipelineConfig` |
| 常量 | `UPPER_SNAKE_CASE` | `MAX_DIFF_SIZE`、`SEVERITY_ORDER` |
| 私有 helper | `camelCase`，前缀 `_` 表示仅测试可见 | `_resetMCPContextCache` |

### 错误处理

- **确定性模块**（diff-parser、rule-engine 等纯函数）：抛出 `TypeError` / `RangeError`，不要吞异常
- **IO / 网络模块**（mcp-adapter、comment-publisher、cache）：返回 Result 风格或捕获后降级，记录 warning
- **不要使用 `any`**：必要时使用 `unknown` 配合类型守卫

### 禁止事项

- ❌ 在 `src/` 中引入 `console.log` / `console.error`（用结构化日志或抛异常）
- ❌ 在循环中 `await`（用 `Promise.all` 或 `batchProcess`）
- ❌ 直接修改入参对象（返回新对象）
- ❌ 在公共 API 中暴露内部实现细节

---

## 测试要求

### 覆盖率阈值

`vitest.config.ts` 强制要求：

```typescript
coverage: {
  provider: 'v8',
  include: ['src/**/*.ts'],
  thresholds: {
    branches: 90,
    functions: 90,
    lines: 90,
    statements: 90,
  },
},
```

任何 PR 不得让以下指标下降：

- 总覆盖率 < 90%
- 单个文件行覆盖率 < 85%
- 新增代码行覆盖率 < 95%

### 测试组织

- 一个 `describe` 块对应一个函数 / 类
- `it` 用中文描述期望行为：「应 …」「当 … 时返回 …」
- 边界、错误路径与正常路径同等重要
- 使用 `tests/fixtures/` 中的真实样本，避免在测试里造大量字符串字面量

### 测试命名示例

```typescript
describe('filterFalsePositives', () => {
  it('应过滤非 C/C++ 文件的内存安全 finding', () => { /* ... */ });
  it('当 confidence >= 0.85 时应保留 finding', () => { /* ... */ });
  it('应支持自定义 FalsePositiveRule', () => { /* ... */ });
  it('空数组输入应返回空数组', () => { /* ... */ });
});
```

### 运行命令

```bash
npm test                      # 运行全部测试
npm test -- rule-engine       # 仅运行文件名匹配的测试
npm run test:watch            # 监听模式
npm run test:coverage         # 覆盖率报告（coverage/index.html）
npm run ci                     # CI 模式：lint + test --coverage
```

---

## 提交规范

本项目采用 [Conventional Commits](https://www.conventionalcommits.org/) 1.0.0。

### 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type

| Type | 含义 | 何时使用 |
|---|---|---|
| `feat` | 新功能 | 新增模块、新增规则匹配器、新增 CLI 子命令 |
| `fix` | Bug 修复 | 修正错误行为 |
| `docs` | 文档 | README、CONTRIBUTING、SPEC、docs/ |
| `refactor` | 重构 | 不改变外部行为的代码重构 |
| `test` | 测试 | 新增/补充测试，不修改生产代码 |
| `perf` | 性能 | 提升性能（缓存、批处理、降级） |
| `chore` | 杂项 | 依赖升级、CI 配置、配置文件 |
| `style` | 风格 | 格式化、空格、分号（不改逻辑） |
| `ci` | CI | GitHub Actions 工作流 |
| `revert` | 回滚 | 撤销之前的 commit |

### Scope

可选，对齐模块名：`diff-parser` / `file-filter` / `rule-engine` / `mcp-adapter` / `post-processor` / `ai-reflection` / `pipeline` / `state` / `cache` / `feedback` / `orchestrator` / `comment-publisher` / `prompt-builder` / `token-optimizer` / `metrics` / `progress` / `init-wizard` / `cli` / `config` / `rules` / `docs`。

### 示例

```
feat(rule-engine): 支持 contains_none 匹配器

- 新增 MatchType 'contains_none'，当文件不包含 items 中任意字符串时触发
- 补充 5 个单元测试覆盖正向与边界
- 更新 SPEC.md 4.3 节规则格式说明

Closes #42
```

```
fix(post-processor): 修正 IoU 阈值为 0 时全量去重

当 deduplicateFindings 的 iouThreshold 设为 0 时，应去重所有
file/line 相同的 findings；此前实现下阈值边界判断有误。
```

```
docs: 补充 architecture.md 数据流图
```

```
test(feedback): 增加 autoTuneRules 边界用例
```

### 禁止

- ❌ 使用 `git commit -m "update"` 等无意义信息
- ❌ 一个 commit 包含多个不相关的改动（拆分为多个 commit）
- ❌ 在 commit message 中包含敏感信息（token、密码）
- ❌ 使用 `--no-verify` 跳过 pre-commit hook

---

## 规则贡献

欢迎贡献新的审查规则！规则存放于 `review-rules/` 目录，支持 YAML 与 JSON 两种格式。

### 添加规则

1. **创建规则文件**

   在 `review-rules/` 下新建 `<category>-<name>.json` 或 `.yaml`，例如 `review-rules/null-check.json`：

   ```json
   [
     {
       "id": "missing-null-check",
       "name": "缺少空值检查",
       "severity": "medium",
       "category": "quality",
       "language": ["typescript", "javascript"],
       "patterns": [
         {
           "type": "regex",
           "pattern": "(\\w+)\\.\\w+\\(\\);",
           "message": "调用方法前未做空值检查，建议使用可选链 ?. 操作符"
         }
       ],
       "excludePatterns": ["**/*.test.ts"]
     }
   ]
   ```

2. **添加测试 fixture**

   在 `tests/fixtures/rules/` 下放入一个会被规则命中的 diff 样本，并在 `tests/rule-engine.test.ts` 中新增测试用例。

3. **更新文档**

   在 [SPEC.md](./SPEC.md) 4.3 节与 [README.md](./README.md) 自定义规则小节同步说明。

### 规则质量要求

| 维度 | 要求 |
|---|---|
| **准确性** | 误报率 < 20%；优先使用 `regex` 而非过度宽泛的 `contains_any` |
| **可解释性** | `name` 与 `message` 用中文，描述具体到行/模式 |
| **作用域** | 用 `language` 与 `excludePatterns` 限定作用范围，避免误伤 |
| **severity** | 严格按业务影响定级；`critical` 仅用于安全/数据丢失/服务宕机 |
| **不重复** | 提交前搜索现有规则，避免与 `sql-injection`、`hardcoded-secret` 等重复 |

### 规则评审流程

1. PR 中列出规则的命中样例与误报样例
2. 维护者会用 `tests/fixtures/` 中的真实 PR diff 跑一遍回归
3. 误报率超过 30% 的规则会被打回，建议先以 `disabled: true` 合入并迭代

### 误报反馈

如发现某条规则误报：

1. 在 `.opencode-review-ignore` 中临时忽略
2. 在 [feedback 模块](./src/feedback.ts) 中调用 `markFalsePositive` 记录
3. 运行 `autoTuneRules` 查看调优建议
4. 提 Issue 标注 `rule-false-positive`，附上 finding 详情与上下文

---

## Issue 报告

提交 Issue 前请先搜索 [现有 Issue](https://github.com/bigDataZWH/codeReview/issues) 避免重复。

### Bug 报告模板

```markdown
**问题描述**
简洁描述 bug 是什么。

**复现步骤**
1. 准备 diff 文件 '...'
2. 运行命令 '...'
3. 看到输出 '...'

**期望行为**
描述应该发生什么。

**实际行为**
描述实际发生了什么，附上错误堆栈。

**环境**
- code-review 版本：[例如 0.1.0]
- Node.js 版本：[例如 20.10.0]
- 操作系统：[例如 Ubuntu 22.04]
- 调用方式：[CLI / 库 / GitHub Action]

**最小复现**
附上最小 diff 样本与命令，或链接到公开 PR。

**附加信息**
其他有助于诊断的日志、截图、配置。
```

### 特性请求模板

```markdown
**动机**
为什么需要这个特性，解决什么问题。

**期望方案**
描述你期望的 API / 行为。

**已考虑的替代方案**
你尝试过的其他做法。

**影响范围**
哪些模块/场景会受益。
```

### 安全漏洞

**不要在公开 Issue 中提交安全漏洞。** 请发邮件至维护者邮箱，邮件标题前缀 `[SECURITY]`，包含：

- 漏洞描述与影响范围
- 复现步骤
- 建议的修复方案（可选）

我们会在 48 小时内确认收到，并在 7 天内给出修复计划。

---

## 行为准则

参与本项目即代表你同意遵守 [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) 行为准则。请保持尊重、建设性的交流态度。

---

感谢你的贡献！🚀
