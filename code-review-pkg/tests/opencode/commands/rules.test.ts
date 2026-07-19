import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadCustomRules,
  overrideRule,
  disableRule,
  enableRule,
  getActiveRules,
  getDisabledRules,
  loadRulesConfig,
  saveRulesConfig,
  applyRulesConfig,
  loadActiveCustomRules,
  DEFAULT_RULES_DIR,
  RULES_CONFIG_FILE,
} from '../../../src/rule-customizer.js';
import type { Rule } from '../../../src/types.js';

// ---- 测试用规则数据 ----

const SAMPLE_RULES_DIR_CONTENT: Record<string, string> = {
  'security.json': JSON.stringify([
    {
      id: 'SEC001',
      name: '禁止硬编码密码',
      severity: 'high',
      category: 'security',
      language: ['python', 'javascript'],
      patterns: [
        { type: 'regex', pattern: 'password\\s*=\\s*[\'"][^\'"]+[\'"]', message: '检测到硬编码密码' },
      ],
    },
    {
      id: 'SEC002',
      name: '禁止 eval',
      severity: 'critical',
      category: 'security',
      patterns: [
        { type: 'contains_any', items: ['eval(', 'exec('], message: '禁止 eval/exec' },
      ],
    },
  ]),
  'quality.json': JSON.stringify([
    {
      id: 'QUAL001',
      name: '禁止 any 类型',
      severity: 'medium',
      category: 'quality',
      language: ['typescript'],
      patterns: [
        { type: 'regex', pattern: ':\\s*any\\b', message: '使用 any 失去类型安全' },
      ],
    },
  ]),
};

const SAMPLE_RULES: Rule[] = [
  {
    id: 'R1',
    name: 'Rule 1',
    severity: 'high',
    category: 'security',
    patterns: [{ type: 'regex', pattern: 'x', message: 'm1' }],
  },
  {
    id: 'R2',
    name: 'Rule 2',
    severity: 'medium',
    category: 'quality',
    patterns: [{ type: 'regex', pattern: 'y', message: 'm2' }],
  },
  {
    id: 'R3',
    name: 'Rule 3',
    severity: 'low',
    category: 'style',
    disabled: true,
    patterns: [{ type: 'regex', pattern: 'z', message: 'm3' }],
  },
];

// ---- CLI 测试辅助 ----

interface TestState {
  exitError: Error | null;
  stdout: string[];
  stderr: string[];
}

const testState: TestState = {
  exitError: null,
  stdout: [],
  stderr: [],
};

async function loadCli(opts: {
  argv: string[];
}): Promise<{
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}> {
  const { argv } = opts;

  testState.exitError = null;
  testState.stdout = [];
  testState.stderr = [];

  const origArgv = process.argv;
  process.argv = ['node', '/tmp/cli.js', ...argv];

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    testState.stdout.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    testState.stderr.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });

  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    const err = new Error(`__PROCESS_EXIT_${code ?? 0}__`);
    testState.exitError = err;
    throw err;
  }) as never);

  vi.resetModules();

  try {
    await import('../../../src/cli.js');
    return {
      stdout: [...testState.stdout],
      stderr: [...testState.stderr],
      exitCode: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const match = msg.match(/^__PROCESS_EXIT_(\d+)__$/);
    if (match) {
      return {
        stdout: [...testState.stdout],
        stderr: [...testState.stderr],
        exitCode: parseInt(match[1], 10),
      };
    }
    throw err;
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    process.argv = origArgv;
    vi.resetModules();
  }
}

function writeRuleFiles(dir: string, files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, 'utf-8');
  }
}

// ---- 测试 ----

describe('rules 命令 (CLI + 库函数)', () => {
  let tmpDir: string;
  let rulesDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rules-test-'));
    rulesDir = join(tmpDir, 'review-rules');
    mkdirSync(rulesDir, { recursive: true });
    writeRuleFiles(rulesDir, SAMPLE_RULES_DIR_CONTENT);
    configPath = join(tmpDir, '.code-review-rules.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ==================== 库函数：loadCustomRules ====================
  describe('loadCustomRules', () => {
    it('从 review-rules 目录加载自定义规则', async () => {
      const rules = await loadCustomRules(rulesDir);
      expect(rules.length).toBe(3);
      const ids = rules.map((r) => r.id);
      expect(ids).toContain('SEC001');
      expect(ids).toContain('SEC002');
      expect(ids).toContain('QUAL001');
    });

    it('目录不存在时返回空数组', async () => {
      const rules = await loadCustomRules(join(tmpDir, 'non-existent'));
      expect(rules).toEqual([]);
    });

    it('默认目录参数为 review-rules', () => {
      expect(DEFAULT_RULES_DIR).toBe('review-rules');
    });

    it('加载的规则包含必要字段', async () => {
      const rules = await loadCustomRules(rulesDir);
      for (const rule of rules) {
        expect(rule.id).toBeTruthy();
        expect(rule.name).toBeTruthy();
        expect(['critical', 'high', 'medium', 'low']).toContain(rule.severity);
        expect(rule.category).toBeTruthy();
        expect(Array.isArray(rule.patterns)).toBe(true);
        expect(rule.patterns.length).toBeGreaterThan(0);
      }
    });
  });

  // ==================== 库函数：overrideRule ====================
  describe('overrideRule', () => {
    it('覆盖规则 severity', () => {
      const result = overrideRule(SAMPLE_RULES, 'R1', { severity: 'critical' });
      const r1 = result.find((r) => r.id === 'R1');
      expect(r1?.severity).toBe('critical');
    });

    it('覆盖规则 name', () => {
      const result = overrideRule(SAMPLE_RULES, 'R2', { name: 'New Name' });
      const r2 = result.find((r) => r.id === 'R2');
      expect(r2?.name).toBe('New Name');
    });

    it('覆盖规则 description', () => {
      const result = overrideRule(SAMPLE_RULES, 'R1', { description: 'desc' });
      const r1 = result.find((r) => r.id === 'R1');
      expect(r1?.description).toBe('desc');
    });

    it('覆盖规则 category', () => {
      const result = overrideRule(SAMPLE_RULES, 'R1', { category: 'performance' });
      const r1 = result.find((r) => r.id === 'R1');
      expect(r1?.category).toBe('performance');
    });

    it('覆盖规则 language', () => {
      const result = overrideRule(SAMPLE_RULES, 'R1', { language: ['go'] });
      const r1 = result.find((r) => r.id === 'R1');
      expect(r1?.language).toEqual(['go']);
    });

    it('覆盖规则 excludePatterns', () => {
      const result = overrideRule(SAMPLE_RULES, 'R1', { excludePatterns: ['^vendor/'] });
      const r1 = result.find((r) => r.id === 'R1');
      expect(r1?.excludePatterns).toEqual(['^vendor/']);
    });

    it('不修改原数组（不可变）', () => {
      const original = [...SAMPLE_RULES];
      overrideRule(SAMPLE_RULES, 'R1', { severity: 'critical' });
      expect(SAMPLE_RULES).toEqual(original);
    });

    it('未覆盖字段保持原值', () => {
      const result = overrideRule(SAMPLE_RULES, 'R1', { severity: 'critical' });
      const r1 = result.find((r) => r.id === 'R1');
      expect(r1?.name).toBe('Rule 1');
      expect(r1?.category).toBe('security');
      expect(r1?.patterns).toEqual(SAMPLE_RULES[0].patterns);
    });

    it('规则 ID 不存在时返回原数组副本', () => {
      const result = overrideRule(SAMPLE_RULES, 'NON_EXISTENT', { severity: 'critical' });
      expect(result).toEqual(SAMPLE_RULES);
      expect(result).not.toBe(SAMPLE_RULES);
    });
  });

  // ==================== 库函数：disableRule / enableRule ====================
  describe('disableRule', () => {
    it('通过 ID 禁用规则', () => {
      const result = disableRule(SAMPLE_RULES, 'R1');
      const r1 = result.find((r) => r.id === 'R1');
      expect(r1?.disabled).toBe(true);
    });

    it('不修改原数组', () => {
      const original = [...SAMPLE_RULES];
      disableRule(SAMPLE_RULES, 'R1');
      expect(SAMPLE_RULES).toEqual(original);
    });

    it('规则 ID 不存在时返回原数组副本', () => {
      const result = disableRule(SAMPLE_RULES, 'NON_EXISTENT');
      expect(result).toEqual(SAMPLE_RULES);
      expect(result).not.toBe(SAMPLE_RULES);
    });

    it('其他规则不受影响', () => {
      const result = disableRule(SAMPLE_RULES, 'R1');
      const r2 = result.find((r) => r.id === 'R2');
      expect(r2?.disabled).toBeFalsy();
    });
  });

  describe('enableRule', () => {
    it('通过 ID 启用规则（取消禁用）', () => {
      const result = enableRule(SAMPLE_RULES, 'R3');
      const r3 = result.find((r) => r.id === 'R3');
      expect(r3?.disabled).toBe(false);
    });

    it('不修改原数组', () => {
      const original = [...SAMPLE_RULES];
      enableRule(SAMPLE_RULES, 'R3');
      expect(SAMPLE_RULES).toEqual(original);
    });
  });

  // ==================== 库函数：getActiveRules / getDisabledRules ====================
  describe('getActiveRules', () => {
    it('返回所有未禁用的规则', () => {
      const active = getActiveRules(SAMPLE_RULES);
      expect(active).toHaveLength(2);
      const ids = active.map((r) => r.id);
      expect(ids).toContain('R1');
      expect(ids).toContain('R2');
      expect(ids).not.toContain('R3');
    });

    it('禁用所有规则后返回空数组', () => {
      const allDisabled = SAMPLE_RULES.map((r) => ({ ...r, disabled: true }));
      const active = getActiveRules(allDisabled);
      expect(active).toEqual([]);
    });
  });

  describe('getDisabledRules', () => {
    it('返回所有被禁用的规则', () => {
      const disabled = getDisabledRules(SAMPLE_RULES);
      expect(disabled).toHaveLength(1);
      expect(disabled[0].id).toBe('R3');
    });
  });

  // ==================== 库函数：loadRulesConfig / saveRulesConfig ====================
  describe('loadRulesConfig', () => {
    it('配置文件不存在时返回空配置', () => {
      const config = loadRulesConfig(join(tmpDir, 'non-existent.json'));
      expect(config.disabled).toEqual([]);
      expect(config.overrides).toEqual({});
    });

    it('加载已存在的配置文件', () => {
      const configPath = join(tmpDir, 'config.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          disabled: ['R1'],
          overrides: { R2: { severity: 'critical' } },
        }),
        'utf-8',
      );

      const config = loadRulesConfig(configPath);
      expect(config.disabled).toEqual(['R1']);
      expect(config.overrides.R2?.severity).toBe('critical');
    });

    it('配置文件解析失败时返回空配置', () => {
      const configPath = join(tmpDir, 'invalid.json');
      writeFileSync(configPath, 'not valid json', 'utf-8');

      const config = loadRulesConfig(configPath);
      expect(config.disabled).toEqual([]);
      expect(config.overrides).toEqual({});
    });

    it('disabled 字段非数组时返回空 disabled', () => {
      const configPath = join(tmpDir, 'bad.json');
      writeFileSync(
        configPath,
        JSON.stringify({ disabled: 'not-an-array', overrides: {} }),
        'utf-8',
      );

      const config = loadRulesConfig(configPath);
      expect(config.disabled).toEqual([]);
    });

    it('默认配置文件名为 .code-review-rules.json', () => {
      expect(RULES_CONFIG_FILE).toBe('.code-review-rules.json');
    });
  });

  describe('saveRulesConfig', () => {
    it('将配置写入磁盘', () => {
      const configPath = join(tmpDir, 'config.json');
      saveRulesConfig(
        { disabled: ['R1'], overrides: { R2: { severity: 'critical' } } },
        configPath,
      );

      expect(existsSync(configPath)).toBe(true);
      const content = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.disabled).toEqual(['R1']);
      expect(parsed.overrides.R2.severity).toBe('critical');
    });

    it('父目录不存在时自动创建', () => {
      const nestedConfig = join(tmpDir, 'nested', 'deep', 'config.json');
      saveRulesConfig({ disabled: [], overrides: {} }, nestedConfig);
      expect(existsSync(nestedConfig)).toBe(true);
    });
  });

  // ==================== 库函数：applyRulesConfig ====================
  describe('applyRulesConfig', () => {
    it('应用 overrides 覆盖规则参数', () => {
      const config = {
        disabled: [],
        overrides: { R1: { severity: 'critical' } },
      };
      const result = applyRulesConfig(SAMPLE_RULES, config);
      const r1 = result.find((r) => r.id === 'R1');
      expect(r1?.severity).toBe('critical');
    });

    it('应用 disabled 列表禁用规则', () => {
      const config = {
        disabled: ['R1'],
        overrides: {},
      };
      const result = applyRulesConfig(SAMPLE_RULES, config);
      const r1 = result.find((r) => r.id === 'R1');
      expect(r1?.disabled).toBe(true);
    });

    it('同时应用 overrides 和 disabled', () => {
      const config = {
        disabled: ['R2'],
        overrides: { R1: { severity: 'critical' } },
      };
      const result = applyRulesConfig(SAMPLE_RULES, config);
      const r1 = result.find((r) => r.id === 'R1');
      const r2 = result.find((r) => r.id === 'R2');
      expect(r1?.severity).toBe('critical');
      expect(r1?.disabled).toBeFalsy();
      expect(r2?.disabled).toBe(true);
    });

    it('空配置不修改规则', () => {
      const result = applyRulesConfig(SAMPLE_RULES, { disabled: [], overrides: {} });
      expect(result).toEqual(SAMPLE_RULES);
    });
  });

  // ==================== 库函数：loadActiveCustomRules ====================
  describe('loadActiveCustomRules', () => {
    it('加载并应用规则定制配置', async () => {
      // 写入配置文件
      saveRulesConfig(
        { disabled: ['SEC001'], overrides: { SEC002: { severity: 'medium' } } },
        configPath,
      );

      const rules = await loadActiveCustomRules(rulesDir, configPath);
      const sec001 = rules.find((r) => r.id === 'SEC001');
      const sec002 = rules.find((r) => r.id === 'SEC002');

      expect(sec001?.disabled).toBe(true);
      expect(sec002?.severity).toBe('medium');

      const active = getActiveRules(rules);
      expect(active.map((r) => r.id)).not.toContain('SEC001');
    });
  });

  // ==================== CLI: rules list ====================
  describe('CLI: rules list', () => {
    it('列出所有规则（激活与禁用）', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: ['rules', 'list', '--rules-dir', rulesDir, '--config', configPath],
      });

      expect(exitCode).toBeNull();
      const output = stdout.join('\n');
      expect(output).toContain('Active rules:');
      expect(output).toContain('SEC001');
      expect(output).toContain('SEC002');
      expect(output).toContain('QUAL001');
      expect(output).toContain('Total: 3');
      expect(output).toContain('Active: 3');
      expect(output).toContain('Disabled: 0');
    });

    it('显示禁用规则区域', async () => {
      saveRulesConfig({ disabled: ['SEC001'], overrides: {} }, configPath);

      const { stdout, exitCode } = await loadCli({
        argv: ['rules', 'list', '--rules-dir', rulesDir, '--config', configPath],
      });

      expect(exitCode).toBeNull();
      const output = stdout.join('\n');
      expect(output).toContain('Disabled: 1');
      expect(output).toContain('Disabled rules:');
      expect(output).toContain('SEC001');
    });

    it('显示规则目录与配置文件路径', async () => {
      const { stdout } = await loadCli({
        argv: ['rules', 'list', '--rules-dir', rulesDir, '--config', configPath],
      });

      const output = stdout.join('\n');
      expect(output).toContain(`Rules directory: ${rulesDir}`);
      expect(output).toContain(`Config file: ${configPath}`);
    });
  });

  // ==================== CLI: rules show ====================
  describe('CLI: rules show', () => {
    it('显示指定规则的 JSON 详情', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: ['rules', 'show', 'SEC001', '--rules-dir', rulesDir, '--config', configPath],
      });

      expect(exitCode).toBeNull();
      const output = stdout.join('\n');
      const rule = JSON.parse(output);
      expect(rule.id).toBe('SEC001');
      expect(rule.name).toBe('禁止硬编码密码');
      expect(rule.severity).toBe('high');
      expect(rule.category).toBe('security');
    });

    it('规则不存在时报错', async () => {
      const { stderr, exitCode } = await loadCli({
        argv: ['rules', 'show', 'NON_EXISTENT', '--rules-dir', rulesDir, '--config', configPath],
      });

      expect(exitCode).toBe(1);
      expect(stderr.some((s) => s.includes('not found'))).toBe(true);
    });

    it('缺少 ruleId 时输出 Usage', async () => {
      const { stderr, exitCode } = await loadCli({
        argv: ['rules', 'show', '--rules-dir', rulesDir, '--config', configPath],
      });

      expect(exitCode).toBe(1);
      expect(stderr.some((s) => s.includes('Usage'))).toBe(true);
    });

    it('反映 override 配置', async () => {
      saveRulesConfig(
        { disabled: [], overrides: { SEC001: { severity: 'critical' } } },
        configPath,
      );

      const { stdout, exitCode } = await loadCli({
        argv: ['rules', 'show', 'SEC001', '--rules-dir', rulesDir, '--config', configPath],
      });

      expect(exitCode).toBeNull();
      const rule = JSON.parse(stdout.join('\n'));
      expect(rule.severity).toBe('critical');
    });
  });

  // ==================== CLI: rules disable ====================
  describe('CLI: rules disable', () => {
    it('禁用规则并持久化到配置文件', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: ['rules', 'disable', 'SEC001', '--rules-dir', rulesDir, '--config', configPath],
      });

      expect(exitCode).toBeNull();
      expect(stdout.some((s) => s.includes('Disabled rule: SEC001'))).toBe(true);

      // 验证配置已持久化
      const config = loadRulesConfig(configPath);
      expect(config.disabled).toContain('SEC001');
    });

    it('重复禁用不重复添加', async () => {
      // 预先禁用
      saveRulesConfig({ disabled: ['SEC001'], overrides: {} }, configPath);

      const { exitCode } = await loadCli({
        argv: ['rules', 'disable', 'SEC001', '--rules-dir', rulesDir, '--config', configPath],
      });

      expect(exitCode).toBeNull();
      const config = loadRulesConfig(configPath);
      expect(config.disabled.filter((id) => id === 'SEC001')).toHaveLength(1);
    });

    it('缺少 ruleId 时输出 Usage', async () => {
      const { stderr, exitCode } = await loadCli({
        argv: ['rules', 'disable', '--config', configPath],
      });

      expect(exitCode).toBe(1);
      expect(stderr.some((s) => s.includes('Usage'))).toBe(true);
    });

    it('保留已有的 overrides 配置', async () => {
      saveRulesConfig(
        { disabled: [], overrides: { SEC002: { severity: 'low' } } },
        configPath,
      );

      await loadCli({
        argv: ['rules', 'disable', 'SEC001', '--rules-dir', rulesDir, '--config', configPath],
      });

      const config = loadRulesConfig(configPath);
      expect(config.disabled).toContain('SEC001');
      expect(config.overrides.SEC002?.severity).toBe('low');
    });
  });

  // ==================== CLI: rules enable ====================
  describe('CLI: rules enable', () => {
    it('启用之前禁用的规则', async () => {
      saveRulesConfig({ disabled: ['SEC001', 'SEC002'], overrides: {} }, configPath);

      const { stdout, exitCode } = await loadCli({
        argv: ['rules', 'enable', 'SEC001', '--rules-dir', rulesDir, '--config', configPath],
      });

      expect(exitCode).toBeNull();
      expect(stdout.some((s) => s.includes('Enabled rule: SEC001'))).toBe(true);

      const config = loadRulesConfig(configPath);
      expect(config.disabled).not.toContain('SEC001');
      expect(config.disabled).toContain('SEC002');
    });

    it('启用未禁用的规则不报错', async () => {
      const { exitCode } = await loadCli({
        argv: ['rules', 'enable', 'SEC001', '--rules-dir', rulesDir, '--config', configPath],
      });

      expect(exitCode).toBeNull();
      const config = loadRulesConfig(configPath);
      expect(config.disabled).not.toContain('SEC001');
    });

    it('缺少 ruleId 时输出 Usage', async () => {
      const { stderr, exitCode } = await loadCli({
        argv: ['rules', 'enable', '--config', configPath],
      });

      expect(exitCode).toBe(1);
      expect(stderr.some((s) => s.includes('Usage'))).toBe(true);
    });
  });

  // ==================== CLI: rules override ====================
  describe('CLI: rules override', () => {
    it('覆盖规则 severity 并持久化', async () => {
      const { stdout, exitCode } = await loadCli({
        argv: [
          'rules',
          'override',
          'SEC001',
          '--severity',
          'critical',
          '--rules-dir',
          rulesDir,
          '--config',
          configPath,
        ],
      });

      expect(exitCode).toBeNull();
      expect(stdout.some((s) => s.includes('Overrode rule: SEC001'))).toBe(true);

      const config = loadRulesConfig(configPath);
      expect(config.overrides.SEC001?.severity).toBe('critical');
    });

    it('覆盖规则 name', async () => {
      const { exitCode } = await loadCli({
        argv: [
          'rules',
          'override',
          'SEC001',
          '--name',
          '新名称',
          '--rules-dir',
          rulesDir,
          '--config',
          configPath,
        ],
      });

      expect(exitCode).toBeNull();
      const config = loadRulesConfig(configPath);
      expect(config.overrides.SEC001?.name).toBe('新名称');
    });

    it('覆盖规则 category', async () => {
      const { exitCode } = await loadCli({
        argv: [
          'rules',
          'override',
          'SEC001',
          '--category',
          'performance',
          '--rules-dir',
          rulesDir,
          '--config',
          configPath,
        ],
      });

      expect(exitCode).toBeNull();
      const config = loadRulesConfig(configPath);
      expect(config.overrides.SEC001?.category).toBe('performance');
    });

    it('覆盖规则 description', async () => {
      const { exitCode } = await loadCli({
        argv: [
          'rules',
          'override',
          'SEC001',
          '--description',
          '新描述',
          '--rules-dir',
          rulesDir,
          '--config',
          configPath,
        ],
      });

      expect(exitCode).toBeNull();
      const config = loadRulesConfig(configPath);
      expect(config.overrides.SEC001?.description).toBe('新描述');
    });

    it('组合多个覆盖选项', async () => {
      const { exitCode } = await loadCli({
        argv: [
          'rules',
          'override',
          'SEC001',
          '--severity',
          'critical',
          '--name',
          '新名称',
          '--description',
          '新描述',
          '--rules-dir',
          rulesDir,
          '--config',
          configPath,
        ],
      });

      expect(exitCode).toBeNull();
      const config = loadRulesConfig(configPath);
      expect(config.overrides.SEC001?.severity).toBe('critical');
      expect(config.overrides.SEC001?.name).toBe('新名称');
      expect(config.overrides.SEC001?.description).toBe('新描述');
    });

    it('多次覆盖合并到已有配置', async () => {
      // 先覆盖 severity
      saveRulesConfig(
        { disabled: [], overrides: { SEC001: { severity: 'critical' } } },
        configPath,
      );

      // 再覆盖 name
      const { exitCode } = await loadCli({
        argv: [
          'rules',
          'override',
          'SEC001',
          '--name',
          'Second Name',
          '--rules-dir',
          rulesDir,
          '--config',
          configPath,
        ],
      });

      expect(exitCode).toBeNull();
      const config = loadRulesConfig(configPath);
      expect(config.overrides.SEC001?.severity).toBe('critical');
      expect(config.overrides.SEC001?.name).toBe('Second Name');
    });

    it('非法 severity 时报错', async () => {
      const { stderr, exitCode } = await loadCli({
        argv: [
          'rules',
          'override',
          'SEC001',
          '--severity',
          'invalid-severity',
          '--rules-dir',
          rulesDir,
          '--config',
          configPath,
        ],
      });

      expect(exitCode).toBe(1);
      expect(stderr.some((s) => s.includes('invalid severity'))).toBe(true);
    });

    it('缺少覆盖选项时报错', async () => {
      const { stderr, exitCode } = await loadCli({
        argv: [
          'rules',
          'override',
          'SEC001',
          '--rules-dir',
          rulesDir,
          '--config',
          configPath,
        ],
      });

      expect(exitCode).toBe(1);
      expect(stderr.some((s) => s.includes('at least one override option'))).toBe(true);
    });

    it('缺少 ruleId 时输出 Usage', async () => {
      const { stderr, exitCode } = await loadCli({
        argv: ['rules', 'override', '--config', configPath],
      });

      expect(exitCode).toBe(1);
      expect(stderr.some((s) => s.includes('Usage'))).toBe(true);
    });
  });

  // ==================== CLI: 无效子命令 ====================
  describe('CLI: 无效子命令', () => {
    it('无效子命令输出 Usage 并退出 1', async () => {
      const { stderr, exitCode } = await loadCli({
        argv: ['rules', 'invalid-sub', '--rules-dir', rulesDir, '--config', configPath],
      });

      expect(exitCode).toBe(1);
      expect(stderr.some((s) => s.includes('Usage'))).toBe(true);
    });

    it('未提供子命令输出 Usage', async () => {
      const { stderr, exitCode } = await loadCli({
        argv: ['rules', '--rules-dir', rulesDir, '--config', configPath],
      });

      expect(exitCode).toBe(1);
      expect(stderr.some((s) => s.includes('Usage'))).toBe(true);
    });
  });

  // ==================== 集成：disable → list → enable 流程 ====================
  describe('集成：禁用 → 列出 → 启用 流程', () => {
    it('完整流程跨子命令持久化', async () => {
      // 1. 初始 list：3 个规则全激活
      const list1 = await loadCli({
        argv: ['rules', 'list', '--rules-dir', rulesDir, '--config', configPath],
      });
      expect(list1.stdout.join('\n')).toContain('Active: 3');
      expect(list1.stdout.join('\n')).toContain('Disabled: 0');

      // 2. 禁用 SEC001
      await loadCli({
        argv: ['rules', 'disable', 'SEC001', '--rules-dir', rulesDir, '--config', configPath],
      });

      // 3. 再次 list：应显示 2 active, 1 disabled
      const list2 = await loadCli({
        argv: ['rules', 'list', '--rules-dir', rulesDir, '--config', configPath],
      });
      const out2 = list2.stdout.join('\n');
      expect(out2).toContain('Active: 2');
      expect(out2).toContain('Disabled: 1');
      expect(out2).toContain('Disabled rules:');

      // 4. 启用 SEC001
      await loadCli({
        argv: ['rules', 'enable', 'SEC001', '--rules-dir', rulesDir, '--config', configPath],
      });

      // 5. 再次 list：3 个全部激活
      const list3 = await loadCli({
        argv: ['rules', 'list', '--rules-dir', rulesDir, '--config', configPath],
      });
      expect(list3.stdout.join('\n')).toContain('Active: 3');
      expect(list3.stdout.join('\n')).toContain('Disabled: 0');
    });

    it('override + disable 组合持久化', async () => {
      // 覆盖 SEC001 severity
      await loadCli({
        argv: [
          'rules',
          'override',
          'SEC001',
          '--severity',
          'critical',
          '--rules-dir',
          rulesDir,
          '--config',
          configPath,
        ],
      });

      // 禁用 SEC002
      await loadCli({
        argv: ['rules', 'disable', 'SEC002', '--rules-dir', rulesDir, '--config', configPath],
      });

      // 验证 show 反映 override
      const showResult = await loadCli({
        argv: ['rules', 'show', 'SEC001', '--rules-dir', rulesDir, '--config', configPath],
      });
      const sec001 = JSON.parse(showResult.stdout.join('\n'));
      expect(sec001.severity).toBe('critical');

      // 验证 list 反映 disable
      const listResult = await loadCli({
        argv: ['rules', 'list', '--rules-dir', rulesDir, '--config', configPath],
      });
      const listOutput = listResult.stdout.join('\n');
      expect(listOutput).toContain('Disabled: 1');
      expect(listOutput).toContain('SEC002');
    });
  });
});

// ---- rules.md 命令文件存在性 ----

describe('rules.md 命令文件', () => {
  const COMMAND_PATH = join(__dirname, '../../../opencode-config/.opencode/commands/rules.md');

  it('文件存在', () => {
    expect(existsSync(COMMAND_PATH)).toBe(true);
  });

  it('包含 frontmatter 描述', () => {
    const content = readFileSync(COMMAND_PATH, 'utf-8');
    expect(content).toContain('---');
    expect(content).toContain('description:');
    expect(content).toContain('agent: code-reviewer');
  });

  it('声明 list / show / enable / disable / override 子命令', () => {
    const content = readFileSync(COMMAND_PATH, 'utf-8');
    expect(content).toContain('list');
    expect(content).toContain('show');
    expect(content).toContain('enable');
    expect(content).toContain('disable');
    expect(content).toContain('override');
  });

  it('包含 rules.md 示例调用', () => {
    const content = readFileSync(COMMAND_PATH, 'utf-8');
    expect(content).toContain('code-review rules list');
    expect(content).toContain('code-review rules disable');
    expect(content).toContain('code-review rules enable');
    expect(content).toContain('code-review rules override');
  });
});
