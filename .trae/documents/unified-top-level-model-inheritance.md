# 计划：将所有 agent 改为继承 OpenCode 顶层主模型

## 背景与目标

当前 `opencode.jsonc` 中 4 个 agent 各自在 `agent.<name>.model` 字段里重复声明同一个值 `anthropic/claude-sonnet-4-5`，对应的 `.opencode/agents/*.md` frontmatter 也重复写了 `model:`。这种"重复硬编码"违反了 OpenCode 官方的"单一主模型配置源"约定。

**OpenCode 官方约定**（来自 [opencode.ai/docs/config](https://opencode.ai/docs/config)）：
- 顶层 `"model": "anthropic/claude-sonnet-4-5"` 字段即 **OpenCode 主 agent 模型**
- agent 定义中不指定 `model` 时，自动**继承顶层主模型**
- agent 可在自身作用域内单独声明 `model` 覆盖主模型（用于差异化场景）

**目标**：把项目改为"顶层 `model` 主模型 + agent 继承"的标准 OpenCode 约定，移除每个 agent 重复的 `model` 字段。

## 当前状态分析

### 实际生效配置（4 处重复）
- [opencode-config/opencode.jsonc](file:///d:/AI/project/check/review/opencode-code-review-pkg/opencode-config/opencode.jsonc) 第 6、12、18、24 行：4 个 agent 各自声明 `"model": "anthropic/claude-sonnet-4-5"`
- 顶层目前**没有** `model` 字段，只有 `$schema` / `agent` / `mcp` 三个顶层键

### Agent markdown frontmatter（4 处重复）
- [code-reviewer.md:3](file:///d:/AI/project/check/review/opencode-code-review-pkg/opencode-config/.opencode/agents/code-reviewer.md#L3)
- [security-reviewer.md:3](file:///d:/AI/project/check/review/opencode-code-review-pkg/opencode-config/.opencode/agents/security-reviewer.md#L3)
- [impact-analyzer.md:3](file:///d:/AI/project/check/review/opencode-code-review-pkg/opencode-config/.opencode/agents/impact-analyzer.md#L3)
- [reflector.md:3](file:///d:/AI/project/check/review/opencode-code-review-pkg/opencode-config/.opencode/agents/reflector.md#L3)
- 每个文件 frontmatter 都有 `model: anthropic/claude-sonnet-4-5`

### 生成器代码（同样重复写入 4 次）
[src/init-wizard.ts:171-235](file:///d:/AI/project/check/review/opencode-code-review-pkg/src/init-wizard.ts#L171-L235) `generateOpenCodeJsonc`：
- 第 188、197、204、210 行：4 个 agent 模板里都嵌 `"model": "${opts.defaultModel}"`
- 没有在顶层写入 `model` 字段

[src/init-wizard.ts:238-316](file:///d:/AI/project/check/review/opencode-code-review-pkg/src/init-wizard.ts#L238-L316)：
- `generateCodeReviewerAgent` 第 243 行：`model: ${model}`
- `generateSecurityReviewerAgent` 第 272 行：`model: ${model}`
- `generateImpactAnalyzerAgent` 第 294 行：`model: ${model}`
- `generateReflectorAgent` 第 308 行：`model: ${model}`

### 文档已经声称"共享主模型"但实现方式不对
- [README.md:224](file:///d:/AI/project/check/review/opencode-code-review-pkg/README.md#L224) 说"所有 Agent 默认共享同一个主模型"
- [docs/architecture.md:218](file:///d:/AI/project/check/review/opencode-code-review-pkg/docs/architecture.md#L218) 说"默认共享同一个主模型"
- 实际实现是"每个 agent 重复声明同一个值"，**不是** OpenCode 标准的顶层继承机制

### 相关测试
- [tests/ux-improvements.test.ts:228-234](file:///d:/AI/project/check/review/opencode-code-review-pkg/tests/ux-improvements.test.ts#L228-L234)：`defaultModel 自定义模型名写入 agent 配置` 测试仅断言 `result.files['opencode.jsonc']` 包含自定义模型字符串，没断言写在哪个位置。改造后这个断言仍能通过（顶层 model 字段同样包含该字符串），但应增强断言验证写在顶层。

## 设计决策

1. **顶层 `model` 字段放在 `$schema` 之后、`agent` 之前**：遵循 OpenCode 官方示例的顺序
2. **`init-wizard.ts` 中各 `generate*Agent` 函数保留 `model` 参数**：保持公共 API 兼容性，避免破坏性变更。但函数内部不再把 `model` 写入 frontmatter，仅作为占位以备未来可能的差异化覆盖
3. **不修改 `docs/design.html`**：设计稿与实际配置本就不一致，不在本次改动范围
4. **不修改 `src/token-optimizer.ts`**：其 `DEFAULT_MODEL_TIERS`（gpt-4o 系列）是成本估算 tier，与 agent 主模型解耦，保持现状

## 实施步骤

### Step 1：修改 opencode-config/opencode.jsonc（实际生效配置）

**文件**：[opencode-config/opencode.jsonc](file:///d:/AI/project/check/review/opencode-code-review-pkg/opencode-config/opencode.jsonc)

**改动**：
1. 在第 2 行 `$schema` 之后、`agent` 之前插入顶层 `model` 字段：
   ```jsonc
   "$schema": "https://opencode.ai/config.json",
   "model": "anthropic/claude-sonnet-4-5",
   "agent": {
   ```
2. 删除 4 处 agent 内的 `"model": "anthropic/claude-sonnet-4-5",` 行（第 6、12、18、24 行）

### Step 2：修改 4 个 agent markdown 文件

**文件**：
- [code-reviewer.md](file:///d:/AI/project/check/review/opencode-code-review-pkg/opencode-config/.opencode/agents/code-reviewer.md)
- [security-reviewer.md](file:///d:/AI/project/check/review/opencode-code-review-pkg/opencode-config/.opencode/agents/security-reviewer.md)
- [impact-analyzer.md](file:///d:/AI/project/check/review/opencode-code-review-pkg/opencode-config/.opencode/agents/impact-analyzer.md)
- [reflector.md](file:///d:/AI/project/check/review/opencode-code-review-pkg/opencode-config/.opencode/agents/reflector.md)

**改动**：删除每个文件 frontmatter 中的 `model: anthropic/claude-sonnet-4-5` 行，让 agent 通过继承顶层主模型获得模型配置。

### Step 3：修改 src/init-wizard.ts（生成器代码）

**文件**：[src/init-wizard.ts](file:///d:/AI/project/check/review/opencode-code-review-pkg/src/init-wizard.ts)

**改动 3.1 - `generateOpenCodeJsonc` 函数（第 171-235 行）**：
- 在模板顶层添加 `"model": "${opts.defaultModel}"` 字段（紧跟 `$schema` 和注释块之后）
- 删除 4 个 agent 模板里的 `"model": "${opts.defaultModel}",` 行（第 188、197、204、210 行）

修改后的模板骨架：
```ts
return `{
  "$schema": "https://opencode.ai/config.json",
  // 项目语言: ${opts.language}
  // 审查强度: ${opts.reviewStrength}
  // 安全审查: ${opts.securityReview}
  // 图谱: ${opts.graphEnabled}
  "model": "${opts.defaultModel}",
  "agent": {
${agents.join(',\n')}
  },
  ${mcpSection}
}
`;
```

**改动 3.2 - 4 个 `generate*Agent` 函数（第 238-316 行）**：
- `generateCodeReviewerAgent`：删除第 243 行 `model: ${model}`（保留 `model` 参数以维持 API 兼容，但不写入 frontmatter）
- `generateSecurityReviewerAgent`：删除第 272 行 `model: ${model}`
- `generateImpactAnalyzerAgent`：删除第 294 行 `model: ${model}`
- `generateReflectorAgent`：删除第 308 行 `model: ${model}`
- 注：这 4 个函数的 `model` 参数变成 unused，可加下划线前缀 `_model` 或加 `// eslint-disable-next-line @typescript-eslint/no-unused-vars` 抑制告警；考虑到是公共 API，保留参数名 `model` 但加注释说明"参数保留以维持 API 兼容，主模型现在通过顶层 model 字段继承"

### Step 4：更新 README.md

**文件**：[README.md](file:///d:/AI/project/check/review/opencode-code-review-pkg/README.md)（第 222-231 行附近）

**改动**：把"所有 Agent 默认共享同一个主模型"段落改写为说明 OpenCode 顶层 `model` 字段继承机制：

```markdown
### Agent 配置

`opencode.jsonc` 顶层通过 `"model": "anthropic/claude-sonnet-4-5"` 声明 **OpenCode 主 agent 模型**，所有 agent 不指定 `model` 时自动继承顶层主模型（OpenCode 官方约定）。如需差异化，可在 agent 内单独声明 `model` 覆盖顶层主模型。

| Agent | 模型来源 | 职责 |
|---|---|---|
| `code-reviewer` | 继承顶层 `model` | 通用代码审查：质量/逻辑/性能/可维护性 |
| `security-reviewer` | 继承顶层 `model` | 安全专项，三层分析方法论 |
| `impact-analyzer` | 继承顶层 `model` | 变更影响半径分析，输出风险评分 |
| `reflector` | 继承顶层 `model` | 对汇总 findings 做统一置信度评估 |
```

### Step 5：更新 docs/architecture.md

**文件**：[docs/architecture.md](file:///d:/AI/project/check/review/opencode-code-review-pkg/docs/architecture.md)（第 218-235 行附近）

**改动**：同步表格说明，改为"模型来源 = 继承顶层 `model`"，并补充一段说明 OpenCode 顶层 `model` 字段继承机制。

### Step 6：更新测试

**文件**：[tests/ux-improvements.test.ts](file:///d:/AI/project/check/review/opencode-code-review-pkg/tests/ux-improvements.test.ts)（第 228-234 行附近）

**改动**：增强现有测试，新增 2 个测试用例：

1. **增强 `defaultModel 自定义模型名写入 agent 配置`**（第 228-234 行）：
   ```ts
   it('defaultModel 自定义模型名写入顶层 model 字段（非 agent 内）', () => {
     const result = generateConfig({
       language: 'typescript',
       defaultModel: 'anthropic/claude-opus-4-1-20250805',
     });
     const jsonc = result.files['opencode.jsonc'];
     // 顶层 model 字段存在
     expect(jsonc).toMatch(/"model":\s*"anthropic\/claude-opus-4-1-20250805"/);
     // agent 内不应再声明 model 字段
     expect(jsonc).not.toMatch(/"code-reviewer":[\s\S]*?"model":/);
     expect(jsonc).not.toMatch(/"reflector":[\s\S]*?"model":/);
   });
   ```

2. **新增测试**：验证生成的 agent markdown frontmatter 不含 `model`：
   ```ts
   it('生成的 agent markdown 不再写 model frontmatter（继承顶层主模型）', () => {
     const result = generateConfig({ language: 'typescript' });
     const codeReviewer = result.files['.opencode/agents/code-reviewer.md'];
     expect(codeReviewer).not.toMatch(/^model:/m);
     const reflector = result.files['.opencode/agents/reflector.md'];
     expect(reflector).not.toMatch(/^model:/m);
   });
   ```

3. **新增测试**：验证默认场景下顶层 model 字段为 `anthropic/claude-sonnet-4-5`：
   ```ts
   it('不传 defaultModel 时顶层 model 默认为 anthropic/claude-sonnet-4-5', () => {
     const result = generateConfig({ language: 'typescript' });
     expect(result.files['opencode.jsonc']).toMatch(
       /"model":\s*"anthropic\/claude-sonnet-4-5"/,
     );
   });
   ```

## 验证步骤

1. **静态检查**：
   - `npm run lint`：确保 TypeScript 类型检查和 ESLint 通过
   - `npm run format`（如存在）：保持代码格式一致

2. **测试验证**：
   - `npm test`：全量 1111 个测试通过（含本次新增的 3 个用例）
   - 重点关注 `tests/ux-improvements.test.ts` 中 init-wizard 相关测试

3. **配置验证**：
   - 手动检查 `opencode-config/opencode.jsonc` 顶层 `model` 字段已添加
   - 手动检查 4 个 `.opencode/agents/*.md` frontmatter 已移除 `model` 行
   - 用 `node -e "JSON.parse(require('fs').readFileSync('opencode-config/opencode.jsonc', 'utf8').replace(/\/\/.*$/gm, ''))"` 验证 JSONC 仍可解析

4. **OpenCode 行为验证**（可选，需本地有 OpenCode）：
   - 在 `opencode-config/` 目录运行 `opencode`，触发任意 agent，验证其使用顶层 `model` 指定的模型

## 假设与边界

1. **保留 `init-wizard.ts` 公共 API**：`generate*Agent` 函数保留 `model` 参数，避免破坏外部调用方
2. **不修改 `docs/design.html`**：设计稿与实际配置本就不一致，本次不动
3. **不修改 `src/token-optimizer.ts`**：成本估算 tier 与 agent 主模型解耦
4. **不修改 `src/ai-reflection.ts` 中 LLMProviderConfig**：LLM Provider 配置是运行时 AI 调用用的，与 OpenCode agent 模型配置正交
5. **OpenCode 版本兼容性**：顶层 `model` 字段是 OpenCode 官方文档明确支持的字段，兼容所有现代版本

## 文件改动清单

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `opencode-config/opencode.jsonc` | 编辑 | 顶层添加 `model`，删除 4 处 agent 内 `model` |
| `opencode-config/.opencode/agents/code-reviewer.md` | 编辑 | 删除 frontmatter `model:` 行 |
| `opencode-config/.opencode/agents/security-reviewer.md` | 编辑 | 删除 frontmatter `model:` 行 |
| `opencode-config/.opencode/agents/impact-analyzer.md` | 编辑 | 删除 frontmatter `model:` 行 |
| `opencode-config/.opencode/agents/reflector.md` | 编辑 | 删除 frontmatter `model:` 行 |
| `src/init-wizard.ts` | 编辑 | 生成器顶层加 `model`，agent 内移除 `model`，markdown 不再写 `model` |
| `README.md` | 编辑 | 更新 Agent 配置表格说明 |
| `docs/architecture.md` | 编辑 | 同步顶层 `model` 继承说明 |
| `tests/ux-improvements.test.ts` | 编辑 | 增强 1 个测试，新增 2 个测试 |
