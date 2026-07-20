# 将 opencode-code-review 改名为 code-review - 实施计划

## 一、仓库调研结论

### 1.1 项目结构

项目包含以下关键目录和文件：

| 目录/文件 | 说明 | 重命名需求 |
|-----------|------|-----------|
| `/workspace/opencode-code-review/` | 静态 HTML 报告查看器 | 是 |
| `/workspace/opencode-code-review-pkg/` | 主包（核心代码） | 是 |
| `/workspace/.trae-html-share-packages/opencode-code-review/` | HTML 共享包 | 是 |

### 1.2 需要修改的文件类型

根据搜索结果，共有 **88 处** `opencode-code-review` 引用分布在以下文件中：

- **配置文件**: `package.json`, `package-lock.json`
- **源代码**: `src/cli.ts`, `src/comment-publisher.ts`, `src/init-wizard.ts`
- **配置插件**: `opencode-config/.opencode/plugins/post-process.js`
- **文档**: `README.md` (root), `README.md` (pkg), `CONTRIBUTING.md`, `SPEC.md`, `docs/quickstart.md`, `docs/architecture.md`
- **CI/CD**: `.github/workflows/code-review.yml`, `.github/workflows/security-review.yml`
- **测试**: `tests/cli.test.ts`, `tests/comment-publisher.test.ts`, `tests/e2e/ci-flow.test.ts`
- **Trae 配置**: `.trae/specs/implement-ocr-system/spec.md`

---

## 二、修改步骤

### Phase 1: 目录和文件重命名

#### Step 1.1: 重命名主目录

```bash
mv /workspace/opencode-code-review /workspace/code-review
mv /workspace/opencode-code-review-pkg /workspace/code-review-pkg
mv /workspace/.trae-html-share-packages/opencode-code-review /workspace/.trae-html-share-packages/code-review
```

#### Step 1.2: 重命名目录内的 HTML 文件

```bash
mv /workspace/code-review/opencode-code-review.html /workspace/code-review/code-review.html
mv /workspace/code-review/opencode-code-review-optimized.html /workspace/code-review/code-review-optimized.html
mv /workspace/.trae-html-share-packages/code-review/opencode-code-review.html.zip /workspace/.trae-html-share-packages/code-review/code-review.html.zip
mv /workspace/.trae-html-share-packages/code-review/opencode-code-review-optimized.html.zip /workspace/.trae-html-share-packages/code-review/code-review-optimized.html.zip
```

#### Step 1.3: 重命名配置示例文件

```bash
mv /workspace/code-review-pkg/.opencode-review-ignore.example /workspace/code-review-pkg/.code-review-ignore.example
```

### Phase 2: 修改 package.json 和 package-lock.json

#### Step 2.1: 修改 package.json

- `name` 字段: `"opencode-code-review"` → `"code-review"`
- `bin` 字段: `"opencode-code-review"` → `"code-review"`

#### Step 2.2: 修改 package-lock.json

- `name` 字段: `"opencode-code-review"` → `"code-review"`

### Phase 3: 修改源代码文件

#### Step 3.1: 修改 src/cli.ts

- CLI 命令名（多处）: `opencode-code-review` → `code-review`
- 帮助信息中的命令名

#### Step 3.2: 修改 src/comment-publisher.ts

- `SUMMARY_MARKER`: `<!-- opencode-code-review:summary -->` → `<!-- code-review:summary -->`
- `User-Agent`: `opencode-code-review` → `code-review`

#### Step 3.3: 修改 src/init-wizard.ts

- npx 命令引用: `npx opencode-code-review` → `npx code-review`

#### Step 3.4: 修改 opencode-config/.opencode/plugins/post-process.js

- 插件名称: `opencode-code-review-post-process` → `code-review-post-process`
- 包引用注释中的包名

### Phase 4: 修改文档文件

#### Step 4.1: 修改根目录 README.md

- 所有目录引用路径更新
- 所有命令示例更新（`opencode-code-review` → `code-review`）
- 所有包名引用更新

#### Step 4.2: 修改 pkg/README.md

- 项目描述中的包名
- 所有安装命令和使用示例

#### Step 4.3: 修改 CONTRIBUTING.md

- 项目名称引用

#### Step 4.4: 修改 SPEC.md

- 文档标题中的项目名称

#### Step 4.5: 修改 docs/quickstart.md

- 所有命令示例和包名引用

#### Step 4.6: 修改 docs/architecture.md

- 文档标题中的项目名称

### Phase 5: 修改 CI/CD 配置

#### Step 5.1: 修改 .github/workflows/code-review.yml

- npm 安装命令: `npm install -g opencode-code-review` → `npm install -g code-review`
- CLI 命令调用

#### Step 5.2: 修改 .github/workflows/security-review.yml

- npm 安装命令和 CLI 命令调用

### Phase 6: 修改测试文件

#### Step 6.1: 修改 tests/cli.test.ts

- 测试期望中的命令名

#### Step 6.2: 修改 tests/comment-publisher.test.ts

- 测试中的 SUMMARY_MARKER 引用

#### Step 6.3: 修改 tests/e2e/ci-flow.test.ts

- 测试中的 SUMMARY_MARKER 引用

### Phase 7: 修改 Trae 配置

#### Step 7.1: 修改 .trae/specs/implement-ocr-system/spec.md

- HTML 文件引用路径更新

---

## 三、潜在依赖和注意事项

### 3.1 关键风险点

1. **全局替换风险**: 需要确保只替换项目相关的 `opencode-code-review`，避免误替换其他代码中引用的外部项目（如阿里巴巴的 `open-code-review`）
2. **文件路径引用**: 所有 Markdown 中的链接引用需要同步更新
3. **测试用例**: 测试中硬编码的字符串需要同步修改
4. **缓存和构建产物**: 可能需要清理 `node_modules` 和 `dist` 目录后重新构建

### 3.2 验证步骤

完成重命名后，应执行以下验证：

1. 运行测试: `cd code-review-pkg && npm test`
2. 构建项目: `cd code-review-pkg && npm run build`
3. 检查 CLI 帮助: `node dist/cli.js --help`
4. 检查所有引用是否已更新: `grep -r "opencode-code-review" /workspace --include="*.ts" --include="*.js" --include="*.json" --include="*.md"`

---

## 四、修改文件清单

### 需要重命名的目录（3个）

1. `/workspace/opencode-code-review/` → `/workspace/code-review/`
2. `/workspace/opencode-code-review-pkg/` → `/workspace/code-review-pkg/`
3. `/workspace/.trae-html-share-packages/opencode-code-review/` → `/workspace/.trae-html-share-packages/code-review/`

### 需要重命名的文件（6个）

1. `opencode-code-review.html` → `code-review.html`
2. `opencode-code-review-optimized.html` → `code-review-optimized.html`
3. `opencode-code-review.html.zip` → `code-review.html.zip`
4. `opencode-code-review-optimized.html.zip` → `code-review-optimized.html.zip`
5. `.opencode-review-ignore.example` → `.code-review-ignore.example`

### 需要内容修改的文件（17个）

| 文件路径 | 修改内容 |
|----------|----------|
| `code-review-pkg/package.json` | name, bin 字段 |
| `code-review-pkg/package-lock.json` | name 字段 |
| `code-review-pkg/src/cli.ts` | CLI 命令名、帮助信息 |
| `code-review-pkg/src/comment-publisher.ts` | SUMMARY_MARKER、User-Agent |
| `code-review-pkg/src/init-wizard.ts` | npx 命令引用 |
| `code-review-pkg/opencode-config/.opencode/plugins/post-process.js` | 插件名、包引用 |
| `README.md` (root) | 目录引用、命令示例、包名 |
| `code-review-pkg/README.md` | 项目描述、命令示例 |
| `code-review-pkg/CONTRIBUTING.md` | 项目名称 |
| `code-review-pkg/SPEC.md` | 文档标题 |
| `code-review-pkg/docs/quickstart.md` | 命令示例、包名 |
| `code-review-pkg/docs/architecture.md` | 文档标题 |
| `code-review-pkg/.github/workflows/code-review.yml` | npm 安装命令、CLI 调用 |
| `code-review-pkg/.github/workflows/security-review.yml` | npm 安装命令、CLI 调用 |
| `code-review-pkg/tests/cli.test.ts` | 测试期望 |
| `code-review-pkg/tests/comment-publisher.test.ts` | SUMMARY_MARKER |
| `code-review-pkg/tests/e2e/ci-flow.test.ts` | SUMMARY_MARKER |
| `.trae/specs/implement-ocr-system/spec.md` | HTML 文件路径 |

---

## 五、执行顺序

建议按照以下顺序执行修改：

1. **Phase 1**: 目录和文件重命名（先处理物理文件）
2. **Phase 2**: package.json 和 package-lock.json（核心配置）
3. **Phase 3**: 源代码文件（核心逻辑）
4. **Phase 4**: 文档文件
5. **Phase 5**: CI/CD 配置
6. **Phase 6**: 测试文件
7. **Phase 7**: Trae 配置
8. **验证**: 构建和测试