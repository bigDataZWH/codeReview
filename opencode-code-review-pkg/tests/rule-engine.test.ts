import { describe, it, expect } from 'vitest';
import { loadRules, matchRules, getRulesByCategory, getRulesBySeverity } from '../src/rule-engine.js';
import type { FileBundle, Rule, DiffLine, Hunk, FileDiff } from '../src/types.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures', 'rules');

// ---- 辅助函数 ----

function makeHunk(lines: DiffLine[], newStart = 1, oldStart = 1): Hunk {
  const addLines = lines.filter((l) => l.type === 'add').length;
  const delLines = lines.filter((l) => l.type === 'delete').length;
  const ctxLines = lines.filter((l) => l.type === 'context').length;
  return {
    oldStart,
    oldCount: delLines + ctxLines,
    newStart,
    newCount: addLines + ctxLines,
    header: `@@ -${oldStart},${delLines + ctxLines} +${newStart},${addLines + ctxLines} @@`,
    lines,
  };
}

function makeFileDiff(overrides: Partial<FileDiff> & { path: string }): FileDiff {
  return { status: 'modified', hunks: [], ...overrides };
}

function makeBundle(primary: FileDiff, overrides?: Partial<Omit<FileBundle, 'primary'>>): FileBundle {
  return { id: 'test-bundle', related: [], annotations: [], primary, ...overrides };
}

// ---- 测试 ----

describe('rule-engine', () => {
  // ==================== loadRules ====================
  describe('loadRules', () => {
    it('从 JSON 目录加载规则文件', async () => {
      const rules = await loadRules(fixturesDir);
      expect(rules.length).toBeGreaterThan(0);

      // 三个 JSON 文件 + 子目录共 8 条规则
      const ids = rules.map((r) => r.id);
      expect(ids).toContain('SEC001');
      expect(ids).toContain('SEC002');
      expect(ids).toContain('SEC003');
      expect(ids).toContain('SIZE001');
      expect(ids).toContain('SIZE002');
      expect(ids).toContain('STYLE001');
      expect(ids).toContain('STYLE002');
      expect(rules).toHaveLength(8);
    });

    it('加载的规则包含必要字段且格式正确', async () => {
      const rules = await loadRules(fixturesDir);
      for (const rule of rules) {
        expect(rule.id).toBeTruthy();
        expect(rule.name).toBeTruthy();
        expect(['critical', 'high', 'medium', 'low']).toContain(rule.severity);
        expect(rule.category).toBeTruthy();
        expect(Array.isArray(rule.patterns)).toBe(true);
        expect(rule.patterns.length).toBeGreaterThan(0);
        for (const p of rule.patterns) {
          expect(p.type).toBeTruthy();
          expect(p.message).toBeTruthy();
        }
      }
    });
  });

  // ==================== matchRules ====================
  describe('matchRules', () => {
    // 1. regex 匹配
    it('正则表达式在文件 diff 行中匹配', () => {
      const bundle = makeBundle(
        makeFileDiff({
          path: 'src/main.py',
          language: 'python',
          hunks: [
            makeHunk(
              [
                { type: 'context', content: ' context line', oldLineNumber: 4, newLineNumber: 4 },
                { type: 'add', content: '+password = "hardcoded123"', newLineNumber: 5 },
              ],
              4,
              4,
            ),
          ],
        }),
      );

      const rules: Rule[] = [
        {
          id: 'R001',
          name: '禁止硬编码密码',
          severity: 'high',
          category: 'security',
          patterns: [
            {
              type: 'regex',
              pattern: 'password\\s*=\\s*["\'][^"\']+["\']',
              message: '检测到硬编码密码',
            },
          ],
        },
      ];

      const annotations = matchRules(bundle, rules);
      expect(annotations).toHaveLength(1);
      expect(annotations[0].ruleId).toBe('R001');
      expect(annotations[0].message).toBe('检测到硬编码密码');
      expect(annotations[0].line).toBe(5);
    });

    // 2. contains_any — 任一关键词匹配即触发
    it('contains_any：任一关键词匹配即触发', () => {
      const bundle = makeBundle(
        makeFileDiff({
          path: 'src/app.py',
          language: 'python',
          hunks: [
            makeHunk(
              [
                { type: 'add', content: '+eval(user_input)', newLineNumber: 10 },
                { type: 'add', content: '+x = 1', newLineNumber: 11 },
              ],
              10,
              10,
            ),
          ],
        }),
      );

      const rules: Rule[] = [
        {
          id: 'R002',
          name: '禁止 eval/exec',
          severity: 'critical',
          category: 'security',
          patterns: [
            {
              type: 'contains_any',
              items: ['eval(', 'exec('],
              message: '禁止使用 eval/exec',
            },
          ],
        },
      ];

      const annotations = matchRules(bundle, rules);
      expect(annotations).toHaveLength(1);
      expect(annotations[0].ruleId).toBe('R002');
      expect(annotations[0].line).toBe(10);
    });

    // 3. contains_all — 所有关键词均匹配才触发
    it('contains_all：所有关键词均匹配才触发', () => {
      const bundle = makeBundle(
        makeFileDiff({
          path: 'src/utils.py',
          language: 'python',
          hunks: [
            makeHunk(
              [
                { type: 'add', content: '+# TODO refactor this', newLineNumber: 20 },
                { type: 'add', content: '+# FIXME hacky workaround', newLineNumber: 21 },
              ],
              20,
              20,
            ),
          ],
        }),
      );

      const rules: Rule[] = [
        {
          id: 'R003',
          name: 'TODO + FIXME 同时出现',
          severity: 'low',
          category: 'style',
          patterns: [
            {
              type: 'contains_all',
              items: ['TODO', 'FIXME'],
              message: '同时存在 TODO 和 FIXME',
            },
          ],
        },
      ];

      const annotations = matchRules(bundle, rules);
      expect(annotations).toHaveLength(1);
      expect(annotations[0].ruleId).toBe('R003');
    });

    it('contains_all：缺少关键词时不触发', () => {
      const bundle = makeBundle(
        makeFileDiff({
          path: 'src/utils.py',
          language: 'python',
          hunks: [
            makeHunk([{ type: 'add', content: '+# TODO refactor this', newLineNumber: 20 }], 20, 20),
          ],
        }),
      );

      const rules: Rule[] = [
        {
          id: 'R003',
          name: 'TODO + FIXME 同时出现',
          severity: 'low',
          category: 'style',
          patterns: [
            {
              type: 'contains_all',
              items: ['TODO', 'FIXME'],
              message: '同时存在 TODO 和 FIXME',
            },
          ],
        },
      ];

      const annotations = matchRules(bundle, rules);
      expect(annotations).toHaveLength(0);
    });

    // 4. line_count_gt — diff 行数超过阈值触发
    it('line_count_gt：diff 变更行数超过阈值触发', () => {
      // 6 行 add/delete，阈值 5
      const lines: DiffLine[] = [];
      for (let i = 0; i < 6; i++) {
        lines.push({ type: 'add', content: `+new line ${i}`, newLineNumber: 10 + i });
      }
      const bundle = makeBundle(
        makeFileDiff({
          path: 'src/big.py',
          language: 'python',
          hunks: [makeHunk(lines, 10, 10)],
        }),
      );

      const rules: Rule[] = [
        {
          id: 'R004',
          name: '大文件变更',
          severity: 'medium',
          category: 'maintainability',
          patterns: [
            {
              type: 'line_count_gt',
              threshold: 5,
              message: '变更行数超过 5 行',
            },
          ],
        },
      ];

      const annotations = matchRules(bundle, rules);
      expect(annotations).toHaveLength(1);
      expect(annotations[0].ruleId).toBe('R004');
      expect(annotations[0].line).toBeUndefined();
    });

    it('line_count_gt：未超过阈值时不触发', () => {
      const lines: DiffLine[] = [
        { type: 'add', content: '+a', newLineNumber: 1 },
        { type: 'add', content: '+b', newLineNumber: 2 },
        { type: 'add', content: '+c', newLineNumber: 3 },
      ];
      const bundle = makeBundle(
        makeFileDiff({
          path: 'src/small.py',
          language: 'python',
          hunks: [makeHunk(lines, 1, 1)],
        }),
      );

      const rules: Rule[] = [
        {
          id: 'R004',
          name: '大文件变更',
          severity: 'medium',
          category: 'maintainability',
          patterns: [
            {
              type: 'line_count_gt',
              threshold: 5,
              message: '变更行数超过 5 行',
            },
          ],
        },
      ];

      const annotations = matchRules(bundle, rules);
      expect(annotations).toHaveLength(0);
    });

    // 5. file_size_gt — 文件 patch 大小超过阈值触发
    it('file_size_gt：文件 patch 大小超过阈值触发', () => {
      // 构造一个总内容长度 > 200 字节的 patch
      const lines: DiffLine[] = [
        { type: 'add', content: '+const veryLongLine = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"', newLineNumber: 1 },
        { type: 'add', content: '+const anotherLine = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"', newLineNumber: 2 },
      ];
      const bundle = makeBundle(
        makeFileDiff({
          path: 'src/big.ts',
          language: 'typescript',
          hunks: [makeHunk(lines, 1, 1)],
        }),
      );

      const rules: Rule[] = [
        {
          id: 'R005',
          name: '大文件 patch',
          severity: 'low',
          category: 'maintainability',
          patterns: [
            {
              type: 'file_size_gt',
              threshold: 200,
              message: 'patch 大小超过 200 字节',
            },
          ],
        },
      ];

      const annotations = matchRules(bundle, rules);
      expect(annotations).toHaveLength(1);
      expect(annotations[0].ruleId).toBe('R005');
    });

    // 6. 语言过滤 — rule.language 限制仅匹配指定语言文件
    it('语言过滤：仅匹配指定语言文件', () => {
      const bundle = makeBundle(
        makeFileDiff({
          path: 'src/app.py',
          language: 'python',
          hunks: [
            makeHunk([{ type: 'add', content: '+password = "secret"', newLineNumber: 5 }], 5, 5),
          ],
        }),
      );

      // 规则仅限 javascript/typescript
      const rules: Rule[] = [
        {
          id: 'R006',
          name: 'JS 硬编码密码',
          severity: 'high',
          category: 'security',
          language: ['javascript', 'typescript'],
          patterns: [
            {
              type: 'regex',
              pattern: 'password\\s*=\\s*["\'][^"\']+["\']',
              message: '检测到硬编码密码',
            },
          ],
        },
      ];

      const annotations = matchRules(bundle, rules);
      expect(annotations).toHaveLength(0);
    });

    it('语言过滤：语言匹配时正常触发', () => {
      const bundle = makeBundle(
        makeFileDiff({
          path: 'src/app.ts',
          language: 'typescript',
          hunks: [
            makeHunk([{ type: 'add', content: '+password = "secret"', newLineNumber: 5 }], 5, 5),
          ],
        }),
      );

      const rules: Rule[] = [
        {
          id: 'R006',
          name: 'TS 硬编码密码',
          severity: 'high',
          category: 'security',
          language: ['typescript'],
          patterns: [
            {
              type: 'regex',
              pattern: 'password\\s*=\\s*["\'][^"\']+["\']',
              message: '检测到硬编码密码',
            },
          ],
        },
      ];

      const annotations = matchRules(bundle, rules);
      expect(annotations).toHaveLength(1);
    });

    // 7. 无匹配 — 返回空标注数组
    it('无匹配：返回空标注数组', () => {
      const bundle = makeBundle(
        makeFileDiff({
          path: 'src/clean.ts',
          language: 'typescript',
          hunks: [
            makeHunk([{ type: 'add', content: '+const x = 42;', newLineNumber: 1 }], 1, 1),
          ],
        }),
      );

      const rules: Rule[] = [
        {
          id: 'R007',
          name: '禁止 eval',
          severity: 'critical',
          category: 'security',
          patterns: [
            {
              type: 'regex',
              pattern: 'eval\\(',
              message: '禁止 eval',
            },
          ],
        },
      ];

      const annotations = matchRules(bundle, rules);
      expect(annotations).toHaveLength(0);
      expect(Array.isArray(annotations)).toBe(true);
    });

    // 8. 多规则匹配 — 同一文件匹配多条规则
    it('多规则匹配：同一文件匹配多条规则', () => {
      const bundle = makeBundle(
        makeFileDiff({
          path: 'src/bad.py',
          language: 'python',
          hunks: [
            makeHunk(
              [
                { type: 'add', content: '+eval(user_input)', newLineNumber: 10 },
                { type: 'add', content: '+password = "admin123"', newLineNumber: 11 },
              ],
              10,
              10,
            ),
          ],
        }),
      );

      const rules: Rule[] = [
        {
          id: 'R002',
          name: '禁止 eval/exec',
          severity: 'critical',
          category: 'security',
          patterns: [
            {
              type: 'contains_any',
              items: ['eval(', 'exec('],
              message: '禁止使用 eval/exec',
            },
          ],
        },
        {
          id: 'R001',
          name: '禁止硬编码密码',
          severity: 'high',
          category: 'security',
          patterns: [
            {
              type: 'regex',
              pattern: 'password\\s*=\\s*["\'][^"\']+["\']',
              message: '检测到硬编码密码',
            },
          ],
        },
      ];

      const annotations = matchRules(bundle, rules);
      expect(annotations).toHaveLength(2);
      const ids = annotations.map((a) => a.ruleId);
      expect(ids).toContain('R001');
      expect(ids).toContain('R002');
    });

    // 9. 规则优先级 — severity 正确按规则定义
    it('规则优先级：severity 正确按规则定义', () => {
      const bundle = makeBundle(
        makeFileDiff({
          path: 'src/mixed.py',
          language: 'python',
          hunks: [
            makeHunk(
              [
                { type: 'add', content: '+eval(user_input)', newLineNumber: 1 },
                { type: 'add', content: '+password = "secret"', newLineNumber: 2 },
              ],
              1,
              1,
            ),
          ],
        }),
      );

      const rules: Rule[] = [
        {
          id: 'LOW_RULE',
          name: '低优先级规则',
          severity: 'low',
          category: 'style',
          patterns: [
            { type: 'contains_any', items: ['eval('], message: '使用了 eval' },
          ],
        },
        {
          id: 'CRIT_RULE',
          name: '高优先级规则',
          severity: 'critical',
          category: 'security',
          patterns: [
            { type: 'contains_any', items: ['eval('], message: '禁止使用 eval' },
          ],
        },
      ];

      const annotations = matchRules(bundle, rules);
      expect(annotations).toHaveLength(2);

      const lowRule = annotations.find((a) => a.ruleId === 'LOW_RULE');
      const critRule = annotations.find((a) => a.ruleId === 'CRIT_RULE');

      expect(lowRule!.severity).toBe('low');
      expect(critRule!.severity).toBe('critical');
    });

    // 11. file_size_gt 边界 — 恰好等于阈值时不触发
    it('file_size_gt：恰好等于阈值时不触发', () => {
      // 构造总内容长度恰好 200 字符的 patch
      const content = 'A'.repeat(200);
      const lines: DiffLine[] = [
        { type: 'add', content, newLineNumber: 1 },
      ];
      const bundle = makeBundle(
        makeFileDiff({
          path: 'src/exact.ts',
          language: 'typescript',
          hunks: [makeHunk(lines, 1, 1)],
        }),
      );

      const rules: Rule[] = [
        {
          id: 'R005',
          name: '精确阈值',
          severity: 'low',
          category: 'maintainability',
          patterns: [
            {
              type: 'file_size_gt',
              threshold: 200,
              message: 'patch 大小超过 200 字节',
            },
          ],
        },
      ];

      const annotations = matchRules(bundle, rules);
      expect(annotations).toHaveLength(0);
    });

    // 12. file_size_gt — threshold 未定义时不触发
    it('file_size_gt：threshold 未定义时不触发', () => {
      const lines: DiffLine[] = [
        { type: 'add', content: '+very long line', newLineNumber: 1 },
      ];
      const bundle = makeBundle(
        makeFileDiff({
          path: 'src/big.ts',
          language: 'typescript',
          hunks: [makeHunk(lines, 1, 1)],
        }),
      );

      const rules: Rule[] = [
        {
          id: 'R005',
          name: '无阈值',
          severity: 'low',
          category: 'maintainability',
          patterns: [
            {
              type: 'file_size_gt',
              message: 'patch 大小超过阈值',
            },
          ],
        },
      ];

      const annotations = matchRules(bundle, rules);
      expect(annotations).toHaveLength(0);
    });

    // 13. line_count_gt 边界 — 恰好等于阈值时不触发
    it('line_count_gt：恰好等于阈值时不触发', () => {
      const lines: DiffLine[] = [];
      for (let i = 0; i < 5; i++) {
        lines.push({ type: 'add', content: `+line ${i}`, newLineNumber: 10 + i });
      }
      const bundle = makeBundle(
        makeFileDiff({
          path: 'src/exact.py',
          language: 'python',
          hunks: [makeHunk(lines, 10, 10)],
        }),
      );

      const rules: Rule[] = [
        {
          id: 'R004',
          name: '边界测试',
          severity: 'medium',
          category: 'maintainability',
          patterns: [
            {
              type: 'line_count_gt',
              threshold: 5,
              message: '变更行数超过 5 行',
            },
          ],
        },
      ];

      const annotations = matchRules(bundle, rules);
      expect(annotations).toHaveLength(0);
    });

    // 14. 从 fixture 加载并匹配
    it('从 fixture 加载的规则正确匹配', async () => {
      const rules = await loadRules(fixturesDir);

      const bundle = makeBundle(
        makeFileDiff({
          path: 'src/auth.py',
          language: 'python',
          hunks: [
            makeHunk(
              [
                { type: 'add', content: '+password = "hardcoded123"', newLineNumber: 15 },
                { type: 'add', content: '+cursor.execute(f"SELECT * FROM users WHERE id={uid}")', newLineNumber: 16 },
              ],
              15,
              15,
            ),
          ],
        }),
      );

      const annotations = matchRules(bundle, rules);
      const ids = annotations.map((a) => a.ruleId);
      // SEC001 (硬编码密码) 和 SEC003 (SQL 注入) 应该匹配（language=python）
      expect(ids).toContain('SEC001');
      expect(ids).toContain('SEC003');
      // SEC002 不匹配（没有 eval/exec）
      expect(ids).not.toContain('SEC002');
    });

    // 15. regex flags — 支持 i 标志忽略大小写
    it('regex flags：支持 i 标志忽略大小写', () => {
      const bundle = makeBundle(
        makeFileDiff({
          path: 'src/app.ts',
          language: 'typescript',
          hunks: [
            makeHunk(
              [
                { type: 'add', content: '+const TODO = "fix later"', newLineNumber: 1 },
                { type: 'add', content: '+console.log("Todo list")', newLineNumber: 2 },
              ],
              1,
              1,
            ),
          ],
        }),
      );

      // 不带 flags，只匹配小写 todo
      const rulesNoFlags: Rule[] = [
        {
          id: 'R-NOFLAG',
          name: '小写 todo',
          severity: 'low',
          category: 'style',
          patterns: [
            { type: 'regex', pattern: '\\btodo\\b', message: 'found todo' },
          ],
        },
      ];

      const annotationsNoFlags = matchRules(bundle, rulesNoFlags);
      expect(annotationsNoFlags).toHaveLength(0);

      // 带 flags: 'i'，匹配大小写不敏感
      const rulesWithFlags: Rule[] = [
        {
          id: 'R-FLAG-I',
          name: '忽略大小写 todo',
          severity: 'low',
          category: 'style',
          patterns: [
            { type: 'regex', pattern: '\\btodo\\b', flags: 'i', message: 'found todo (case insensitive)' },
          ],
        },
      ];

      const annotationsWithFlags = matchRules(bundle, rulesWithFlags);
      expect(annotationsWithFlags).toHaveLength(1);
      expect(annotationsWithFlags[0].line).toBe(1);
      expect(annotationsWithFlags[0].ruleId).toBe('R-FLAG-I');
    });
  });

  // ==================== loadRules 正则验证 ====================
  describe('loadRules regex validation', () => {
    it('非法正则 pattern 抛出明确错误', async () => {
      const { mkdir, writeFile, rm } = await import('node:fs/promises');
      const tmpDir = join(fixturesDir, '_tmp_invalid_regex');
      await mkdir(tmpDir, { recursive: true });
      await writeFile(
        join(tmpDir, 'bad-rule.json'),
        JSON.stringify([{
          id: 'BAD001',
          name: 'Bad Regex',
          severity: 'high',
          category: 'security',
          patterns: [{
            type: 'regex',
            pattern: '[invalid(',
            message: 'bad pattern',
          }],
        }]),
      );

      try {
        await expect(loadRules(tmpDir)).rejects.toThrow('invalid regex');
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });
  });
});

// ==================== Round 26: 规则优先级排序 ====================

describe('matchRules severity ordering', () => {
  it('匹配结果按 severity 排序（critical > high > medium > low）', () => {
    const bundle = makeBundle(
      makeFileDiff({
        path: 'src/app.py',
        language: 'python',
        hunks: [
          makeHunk(
            [
              { type: 'add', content: '+password = "secret"', newLineNumber: 1 },
              { type: 'add', content: '+eval(user_input)', newLineNumber: 2 },
              { type: 'add', content: '+print("debug")', newLineNumber: 3 },
            ],
            1,
            1,
          ),
        ],
      }),
    );

    const rules: Rule[] = [
      {
        id: 'R-LOW',
        name: 'low rule',
        severity: 'low',
        category: 'style',
        patterns: [{ type: 'regex', pattern: 'print\\(', message: 'debug print' }],
      },
      {
        id: 'R-CRIT',
        name: 'crit rule',
        severity: 'critical',
        category: 'security',
        patterns: [{ type: 'regex', pattern: 'password\\s*=', message: 'hardcoded password' }],
      },
      {
        id: 'R-MED',
        name: 'med rule',
        severity: 'medium',
        category: 'security',
        patterns: [{ type: 'regex', pattern: 'eval\\(', message: 'eval usage' }],
      },
    ];

    const annotations = matchRules(bundle, rules);
    expect(annotations).toHaveLength(3);
    expect(annotations[0].severity).toBe('critical');
    expect(annotations[1].severity).toBe('medium');
    expect(annotations[2].severity).toBe('low');
  });
});

// ==================== Round 33: YAML 规则文件支持 ====================

describe('loadRules YAML support', () => {
  it('从 YAML 文件加载规则', async () => {
    const { mkdir, writeFile, rm } = await import('node:fs/promises');
    const tmpDir = join(fixturesDir, '_tmp_yaml');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      join(tmpDir, 'rules.yaml'),
      `- id: YAML001
  name: YAML Password Rule
  severity: high
  category: security
  patterns:
    - type: regex
      pattern: password\\s*=\\s*["'][^"']+["']
      message: hardcoded password in yaml
`,
    );

    try {
      const rules = await loadRules(tmpDir);
      expect(rules.length).toBeGreaterThan(0);
      const yamlRule = rules.find((r) => r.id === 'YAML001');
      expect(yamlRule).toBeDefined();
      expect(yamlRule!.severity).toBe('high');
      expect(yamlRule!.patterns).toHaveLength(1);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('忽略空的 YAML 规则', async () => {
    const { mkdir, writeFile, rm } = await import('node:fs/promises');
    const tmpDir = join(fixturesDir, '_tmp_yaml_empty');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      join(tmpDir, 'empty.yaml'),
      `# empty rules file
`,
    );

    try {
      const rules = await loadRules(tmpDir);
      // no valid rules should be loaded
      const yamlRules = rules.filter((r) => r.id.startsWith('YAML'));
      expect(yamlRules).toHaveLength(0);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });
});

// ── getRulesByCategory ──

describe('getRulesByCategory', () => {
  it('filters rules by category', () => {
    const rules: Rule[] = [
      { id: 'R1', name: 'Security', severity: 'high', category: 'security', patterns: [{ type: 'regex', pattern: 'x', message: 'm' }] },
      { id: 'R2', name: 'Style', severity: 'low', category: 'style', patterns: [{ type: 'regex', pattern: 'y', message: 'm' }] },
      { id: 'R3', name: 'More Security', severity: 'critical', category: 'security', patterns: [{ type: 'regex', pattern: 'z', message: 'm' }] },
    ];
    expect(getRulesByCategory(rules, 'security')).toHaveLength(2);
    expect(getRulesByCategory(rules, 'style')).toHaveLength(1);
    expect(getRulesByCategory(rules, 'nonexistent')).toHaveLength(0);
  });
});

// ── getRulesBySeverity ──

describe('getRulesBySeverity', () => {
  it('filters rules by severity', () => {
    const rules: Rule[] = [
      { id: 'R1', name: 'High', severity: 'high', category: 'security', patterns: [{ type: 'regex', pattern: 'x', message: 'm' }] },
      { id: 'R2', name: 'Low', severity: 'low', category: 'style', patterns: [{ type: 'regex', pattern: 'y', message: 'm' }] },
      { id: 'R3', name: 'High2', severity: 'high', category: 'perf', patterns: [{ type: 'regex', pattern: 'z', message: 'm' }] },
    ];
    expect(getRulesBySeverity(rules, 'high')).toHaveLength(2);
    expect(getRulesBySeverity(rules, 'low')).toHaveLength(1);
    expect(getRulesBySeverity(rules, 'critical')).toHaveLength(0);
  });
});

// ── loadRules 递归目录扫描 ──

describe('loadRules recursive scan', () => {
  it('loads rules from subdirectories', async () => {
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rules');

    const rules = await loadRules(fixturesDir);
    const subdirRule = rules.find((r) => r.id === 'SUB01');
    expect(subdirRule).toBeDefined();
    expect(subdirRule!.category).toBe('style');
  });
});

// ── matchRules group filtering (Round 45) ──

describe('matchRules group filtering', () => {
  it('按 group 过滤规则', () => {
    const bundle = makeBundle(
      makeFileDiff({
        path: 'src/app.ts',
        language: 'typescript',
        hunks: [
          makeHunk([{ type: 'add', content: '+eval(x)', newLineNumber: 1 }], 1, 1),
        ],
      }),
    );

    const rules: Rule[] = [
      { id: 'G1', name: 'eval', severity: 'critical', category: 'security', group: 'security', patterns: [{ type: 'regex', pattern: 'eval\\(', message: 'eval found' }] },
      { id: 'G2', name: 'todo', severity: 'low', category: 'style', group: 'style', patterns: [{ type: 'regex', pattern: 'TODO', message: 'todo found' }] },
      { id: 'G3', name: 'nogroup', severity: 'high', category: 'security', patterns: [{ type: 'regex', pattern: 'eval\\(', message: 'eval no group' }] },
    ];

    // 只匹配 security group
    const result = matchRules(bundle, rules, { group: 'security' });
    expect(result).toHaveLength(1);
    expect(result[0].ruleId).toBe('G1');
  });

  it('不传 group 时匹配所有规则', () => {
    const bundle = makeBundle(
      makeFileDiff({
        path: 'src/app.ts',
        language: 'typescript',
        hunks: [
          makeHunk([{ type: 'add', content: '+eval(x)', newLineNumber: 1 }], 1, 1),
        ],
      }),
    );

    const rules: Rule[] = [
      { id: 'G1', name: 'eval', severity: 'critical', category: 'security', group: 'a', patterns: [{ type: 'regex', pattern: 'eval\\(', message: 'm' }] },
      { id: 'G2', name: 'eval2', severity: 'high', category: 'security', group: 'b', patterns: [{ type: 'regex', pattern: 'eval\\(', message: 'm2' }] },
    ];

    const result = matchRules(bundle, rules);
    expect(result).toHaveLength(2);
  });
});

// ── Round 52: multiline regex ──

describe('matchRules multiline regex', () => {
  it('匹配跨行正则模式', () => {
    const bundle = makeBundle(
      makeFileDiff({
        path: 'src/app.ts',
        language: 'typescript',
        hunks: [
          makeHunk(
            [
              { type: 'add', content: '+const query = "SELECT', newLineNumber: 1 },
              { type: 'add', content: '+  FROM users WHERE id=" + userId;', newLineNumber: 2 },
            ],
            1, 1,
          ),
        ],
      }),
    );

    const rules: Rule[] = [
      {
        id: 'ML-1',
        name: 'SQL injection multiline',
        severity: 'critical',
        category: 'security',
        patterns: [
          { type: 'regex', pattern: 'SELECT\\n.*\\+\\s*userId', message: 'SQL injection' },
        ],
      },
    ];

    const result = matchRules(bundle, rules);
    expect(result).toHaveLength(1);
    expect(result[0].ruleId).toBe('ML-1');
  });
});

// ── Round 58: rule description ──

describe('matchRules description', () => {
  it('description 字段传递到 annotation', () => {
    const bundle = makeBundle(
      makeFileDiff({
        path: 'src/app.ts',
        language: 'typescript',
        hunks: [
          makeHunk([{ type: 'add', content: '+eval(x)', newLineNumber: 1 }], 1, 1),
        ],
      }),
    );

    const rules: Rule[] = [
      {
        id: 'D1', name: 'eval', severity: 'critical', category: 'security',
        description: '使用 eval 是危险的',
        patterns: [{ type: 'regex', pattern: 'eval\\(', message: 'eval found' }],
      },
    ];

    const result = matchRules(bundle, rules);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('使用 eval 是危险的');
  });

  it('无 description 时 annotation 无 description', () => {
    const bundle = makeBundle(
      makeFileDiff({
        path: 'a.ts', language: 'typescript',
        hunks: [makeHunk([{ type: 'add', content: '+eval(x)', newLineNumber: 1 }], 1, 1)],
      }),
    );

    const rules: Rule[] = [
      { id: 'D2', name: 'eval', severity: 'critical', category: 'security', patterns: [{ type: 'regex', pattern: 'eval\\(', message: 'm' }] },
    ];

    const result = matchRules(bundle, rules);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBeUndefined();
  });
});

// ── Round 63: disabled rules ──

describe('matchRules disabled', () => {
  it('跳过 disabled 规则', () => {
    const bundle = makeBundle(
      makeFileDiff({
        path: 'a.ts', language: 'typescript',
        hunks: [makeHunk([{ type: 'add', content: '+eval(x)', newLineNumber: 1 }], 1, 1)],
      }),
    );

    const rules: Rule[] = [
      { id: 'R1', name: 'eval', severity: 'critical', category: 'security', disabled: true, patterns: [{ type: 'regex', pattern: 'eval\\(', message: 'eval' }] },
      { id: 'R2', name: 'todo', severity: 'low', category: 'style', patterns: [{ type: 'regex', pattern: 'TODO', message: 'todo' }] },
    ];

    const result = matchRules(bundle, rules);
    expect(result).toHaveLength(0);
  });

  it('disabled 为 false 时不跳过', () => {
    const bundle = makeBundle(
      makeFileDiff({
        path: 'a.ts', language: 'typescript',
        hunks: [makeHunk([{ type: 'add', content: '+eval(x)', newLineNumber: 1 }], 1, 1)],
      }),
    );

    const rules: Rule[] = [
      { id: 'R1', name: 'eval', severity: 'critical', category: 'security', disabled: false, patterns: [{ type: 'regex', pattern: 'eval\\(', message: 'eval' }] },
    ];

    const result = matchRules(bundle, rules);
    expect(result).toHaveLength(1);
  });
});

// ── Round 68: excludePatterns ──

describe('matchRules excludePatterns', () => {
  it('排除匹配路径的文件', () => {
    const bundle = makeBundle(
      makeFileDiff({
        path: 'vendor/lib.ts', language: 'typescript',
        hunks: [makeHunk([{ type: 'add', content: '+eval(x)', newLineNumber: 1 }], 1, 1)],
      }),
    );

    const rules: Rule[] = [
      {
        id: 'EX1', name: 'eval', severity: 'critical', category: 'security',
        excludePatterns: ['^vendor/'],
        patterns: [{ type: 'regex', pattern: 'eval\\(', message: 'eval' }],
      },
    ];

    const result = matchRules(bundle, rules);
    expect(result).toHaveLength(0);
  });

  it('不匹配排除路径时正常匹配', () => {
    const bundle = makeBundle(
      makeFileDiff({
        path: 'src/app.ts', language: 'typescript',
        hunks: [makeHunk([{ type: 'add', content: '+eval(x)', newLineNumber: 1 }], 1, 1)],
      }),
    );

    const rules: Rule[] = [
      {
        id: 'EX2', name: 'eval', severity: 'critical', category: 'security',
        excludePatterns: ['^vendor/'],
        patterns: [{ type: 'regex', pattern: 'eval\\(', message: 'eval' }],
      },
    ];

    const result = matchRules(bundle, rules);
    expect(result).toHaveLength(1);
  });
});