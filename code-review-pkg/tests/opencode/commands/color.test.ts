import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  colorizeSeverity,
  colorizeFinding,
  formatColoredOutput,
  shouldUseColor,
  severityColor,
  stripAnsi,
  hasAnsiColor,
  RESET,
  BOLD,
  DIM,
  UNDERLINE,
  FG,
  BG,
  SEVERITY_COLOR,
  SEVERITY_LABEL,
  SEVERITY_ICON,
  type ColorizeFindingOptions,
  type FormatColoredOutputOptions,
} from '../../../src/color-output.js';
import type { Finding } from '../../../src/types.js';

// ── 测试 fixtures ──

function makeFinding(partial: Partial<Finding> = {}): Finding {
  return {
    file: 'src/app.ts',
    line: 10,
    severity: 'high',
    category: 'security',
    message: 'SQL injection detected',
    confidence: 0.85,
    source: 'rule',
    ruleId: 'sql-injection',
    suggestion: 'Use parameterized queries',
    ...partial,
  };
}

const SAMPLE_FINDINGS: Finding[] = [
  makeFinding({ file: 'src/a.ts', line: 10, severity: 'critical', message: 'critical issue' }),
  makeFinding({ file: 'src/b.ts', line: 20, severity: 'high', message: 'high issue' }),
  makeFinding({ file: 'src/c.ts', line: 30, severity: 'medium', message: 'medium issue' }),
  makeFinding({ file: 'src/d.ts', line: 40, severity: 'low', message: 'low issue' }),
  makeFinding({ file: 'src/e.ts', line: 50, severity: 'info', message: 'info issue' }),
];

// ==================== ANSI 常量 ====================

describe('ANSI 颜色常量', () => {
  it('RESET 是 \\x1b[0m', () => {
    expect(RESET).toBe('\x1b[0m');
  });

  it('BOLD 是 \\x1b[1m', () => {
    expect(BOLD).toBe('\x1b[1m');
  });

  it('DIM 是 \\x1b[2m', () => {
    expect(DIM).toBe('\x1b[2m');
  });

  it('UNDERLINE 是 \\x1b[4m', () => {
    expect(UNDERLINE).toBe('\x1b[4m');
  });

  it('FG.red 是 \\x1b[31m', () => {
    expect(FG.red).toBe('\x1b[31m');
  });

  it('FG.yellow 是 \\x1b[33m', () => {
    expect(FG.yellow).toBe('\x1b[33m');
  });

  it('FG.blue 是 \\x1b[34m', () => {
    expect(FG.blue).toBe('\x1b[34m');
  });

  it('FG.green 是 \\x1b[32m', () => {
    expect(FG.green).toBe('\x1b[32m');
  });

  it('FG.gray 是 \\x1b[90m', () => {
    expect(FG.gray).toBe('\x1b[90m');
  });

  it('BG.red 是 \\x1b[41m', () => {
    expect(BG.red).toBe('\x1b[41m');
  });
});

// ==================== SEVERITY_COLOR / LABEL / ICON 映射 ====================

describe('SEVERITY_COLOR 映射', () => {
  it('critical 映射到红色', () => {
    expect(SEVERITY_COLOR.critical).toBe(FG.red);
  });
  it('high 映射到黄色', () => {
    expect(SEVERITY_COLOR.high).toBe(FG.yellow);
  });
  it('medium 映射到蓝色', () => {
    expect(SEVERITY_COLOR.medium).toBe(FG.blue);
  });
  it('low 映射到绿色', () => {
    expect(SEVERITY_COLOR.low).toBe(FG.green);
  });
  it('info 映射到灰色', () => {
    expect(SEVERITY_COLOR.info).toBe(FG.gray);
  });
});

describe('SEVERITY_LABEL 映射', () => {
  it('各 severity 对应大写标签', () => {
    expect(SEVERITY_LABEL.critical).toBe('CRITICAL');
    expect(SEVERITY_LABEL.high).toBe('HIGH');
    expect(SEVERITY_LABEL.medium).toBe('MEDIUM');
    expect(SEVERITY_LABEL.low).toBe('LOW');
    expect(SEVERITY_LABEL.info).toBe('INFO');
  });
});

describe('SEVERITY_ICON 映射', () => {
  it('每个 severity 都有图标', () => {
    expect(SEVERITY_ICON.critical).toBeTruthy();
    expect(SEVERITY_ICON.high).toBeTruthy();
    expect(SEVERITY_ICON.medium).toBeTruthy();
    expect(SEVERITY_ICON.low).toBeTruthy();
    expect(SEVERITY_ICON.info).toBeTruthy();
  });
});

// ==================== severityColor ====================

describe('severityColor', () => {
  it('返回 severity 对应的 ANSI 颜色码', () => {
    expect(severityColor('critical')).toBe(FG.red);
    expect(severityColor('high')).toBe(FG.yellow);
    expect(severityColor('medium')).toBe(FG.blue);
    expect(severityColor('low')).toBe(FG.green);
    expect(severityColor('info')).toBe(FG.gray);
  });
});

// ==================== colorizeSeverity ====================

describe('colorizeSeverity', () => {
  it('启用颜色时返回带 ANSI 码的标签', () => {
    const result = colorizeSeverity('critical', true);
    expect(result).toContain(FG.red);
    expect(result).toContain(RESET);
    expect(result).toContain('CRITICAL');
  });

  it('禁用颜色时返回纯文本标签', () => {
    const result = colorizeSeverity('high', false);
    expect(result).toBe('HIGH');
    expect(result).not.toContain('\x1b');
  });

  it('默认启用颜色', () => {
    const result = colorizeSeverity('low');
    expect(result).toContain(FG.green);
    expect(result).toContain('LOW');
  });

  it('各 severity 对应正确颜色', () => {
    expect(colorizeSeverity('critical', true)).toContain(FG.red);
    expect(colorizeSeverity('high', true)).toContain(FG.yellow);
    expect(colorizeSeverity('medium', true)).toContain(FG.blue);
    expect(colorizeSeverity('low', true)).toContain(FG.green);
    expect(colorizeSeverity('info', true)).toContain(FG.gray);
  });

  it('标签包裹在颜色码与 reset 之间', () => {
    const result = colorizeSeverity('critical', true);
    expect(result).toBe(`${FG.red}CRITICAL${RESET}`);
  });
});

// ==================== colorizeFinding ====================

describe('colorizeFinding', () => {
  it('多行模式：包含文件路径、行号、消息', () => {
    const f = makeFinding();
    const result = colorizeFinding(f, { useColor: false });
    expect(result).toContain('src/app.ts');
    expect(result).toContain(':10');
    expect(result).toContain('SQL injection detected');
    expect(result).toContain('security');
  });

  it('多行模式：包含 confidence 与 source', () => {
    const f = makeFinding();
    const result = colorizeFinding(f, { useColor: false });
    expect(result).toContain('confidence: 85%');
    expect(result).toContain('source: rule');
    expect(result).toContain('(sql-injection)');
  });

  it('多行模式：包含 suggestion', () => {
    const f = makeFinding();
    const result = colorizeFinding(f, { useColor: false });
    expect(result).toContain('Use parameterized queries');
  });

  it('启用颜色时包含 ANSI 颜色码', () => {
    const f = makeFinding({ severity: 'critical' });
    const result = colorizeFinding(f, { useColor: true });
    expect(result).toContain(FG.red); // critical
    expect(result).toContain(BOLD); // 消息加粗
    expect(result).toContain(RESET);
  });

  it('禁用颜色时不包含 ANSI 转义序列', () => {
    const f = makeFinding();
    const result = colorizeFinding(f, { useColor: false });
    expect(result).not.toContain('\x1b');
  });

  it('单行模式：单行显示', () => {
    const f = makeFinding();
    const result = colorizeFinding(f, { useColor: false, singleLine: true });
    expect(result).not.toContain('\n');
    expect(result).toContain('src/app.ts:10');
    expect(result).toContain('SQL injection detected');
  });

  it('showIcon=false 时不显示图标', () => {
    const f = makeFinding({ severity: 'critical' });
    const withIcon = colorizeFinding(f, { useColor: false, showIcon: true });
    const withoutIcon = colorizeFinding(f, { useColor: false, showIcon: false });
    expect(withIcon).toContain(SEVERITY_ICON.critical);
    expect(withoutIcon).not.toContain(SEVERITY_ICON.critical);
  });

  it('showConfidence=false 时隐藏 confidence', () => {
    const f = makeFinding();
    const result = colorizeFinding(f, { useColor: false, showConfidence: false });
    expect(result).not.toContain('confidence');
  });

  it('showSuggestion=false 时隐藏 suggestion', () => {
    const f = makeFinding();
    const result = colorizeFinding(f, { useColor: false, showSuggestion: false });
    expect(result).not.toContain('Use parameterized queries');
  });

  it('无 suggestion 时不显示 suggestion 行', () => {
    const f = makeFinding({ suggestion: undefined });
    const result = colorizeFinding(f, { useColor: false });
    expect(result).not.toContain('💡');
  });

  it('包含 endLine 时显示行号范围', () => {
    const f = makeFinding({ line: 10, endLine: 15 });
    const result = colorizeFinding(f, { useColor: false });
    expect(result).toContain('src/app.ts:10-15');
  });

  it('confidence 颜色根据百分比变化（≥85 绿, ≥60 黄, 否则红）', () => {
    const high = colorizeFinding(makeFinding({ confidence: 0.9 }), { useColor: true });
    const mid = colorizeFinding(makeFinding({ confidence: 0.7 }), { useColor: true });
    const low = colorizeFinding(makeFinding({ confidence: 0.3 }), { useColor: true });
    expect(high).toContain(FG.green);
    expect(mid).toContain(FG.yellow);
    expect(low).toContain(FG.red);
  });

  it('单行模式启用颜色时仍包含 severity 颜色', () => {
    const f = makeFinding({ severity: 'critical' });
    const result = colorizeFinding(f, { useColor: true, singleLine: true });
    expect(result).toContain(FG.red);
    expect(result).toContain(RESET);
  });
});

// ==================== formatColoredOutput ====================

describe('formatColoredOutput', () => {
  it('空 findings 显示 "No findings" 消息', () => {
    const result = formatColoredOutput([], { useColor: false });
    expect(result).toContain('No findings');
  });

  it('包含标题', () => {
    const result = formatColoredOutput([], { useColor: false, title: 'My Report' });
    expect(result).toContain('My Report');
  });

  it('默认标题为 "Code Review Report"', () => {
    const result = formatColoredOutput([], { useColor: false });
    expect(result).toContain('Code Review Report');
  });

  it('包含 Summary 行（按 severity 计数）', () => {
    const result = formatColoredOutput(SAMPLE_FINDINGS, { useColor: false });
    expect(result).toContain('Summary:');
    expect(result).toContain('CRITICAL: 1');
    expect(result).toContain('HIGH: 1');
    expect(result).toContain('MEDIUM: 1');
    expect(result).toContain('LOW: 1');
    expect(result).toContain('INFO: 1');
    expect(result).toContain('Total: 5');
  });

  it('按 severity 降序排序 findings', () => {
    const shuffled: Finding[] = [
      makeFinding({ severity: 'low', message: 'low' }),
      makeFinding({ severity: 'critical', message: 'critical' }),
      makeFinding({ severity: 'high', message: 'high' }),
    ];
    const result = formatColoredOutput(shuffled, { useColor: false });
    // 第一条应是 critical
    const lines = result.split('\n');
    const firstFindingLine = lines.find((l) => l.startsWith('1.'));
    expect(firstFindingLine).toContain('critical');
  });

  it('sortBySeverity=false 保留原顺序', () => {
    const shuffled: Finding[] = [
      makeFinding({ severity: 'low', message: 'first' }),
      makeFinding({ severity: 'critical', message: 'second' }),
    ];
    const result = formatColoredOutput(shuffled, { useColor: false, sortBySeverity: false });
    const lines = result.split('\n');
    const firstFindingLine = lines.find((l) => l.startsWith('1.'));
    expect(firstFindingLine).toContain('first');
  });

  it('启用颜色时包含 ANSI 颜色码', () => {
    const result = formatColoredOutput(SAMPLE_FINDINGS, { useColor: true });
    expect(result).toContain(FG.red); // critical
    expect(result).toContain(FG.yellow); // high
    expect(result).toContain(FG.blue); // medium
    expect(result).toContain(FG.green); // low
    expect(result).toContain(FG.gray); // info
    expect(result).toContain(BOLD);
    expect(result).toContain(RESET);
  });

  it('禁用颜色时不包含 ANSI 转义序列', () => {
    const result = formatColoredOutput(SAMPLE_FINDINGS, { useColor: false });
    expect(result).not.toContain('\x1b');
  });

  it('每条 finding 编号递增', () => {
    const result = formatColoredOutput(SAMPLE_FINDINGS, { useColor: false });
    expect(result).toContain('1. ');
    expect(result).toContain('2. ');
    expect(result).toContain('3. ');
    expect(result).toContain('4. ');
    expect(result).toContain('5. ');
  });

  it('包含每条 finding 的文件路径', () => {
    const result = formatColoredOutput(SAMPLE_FINDINGS, { useColor: false });
    for (const f of SAMPLE_FINDINGS) {
      expect(result).toContain(f.file);
    }
  });

  it('showIcon=false 时不显示图标', () => {
    const result = formatColoredOutput(SAMPLE_FINDINGS, { useColor: false, showIcon: false });
    expect(result).not.toContain(SEVERITY_ICON.critical);
  });

  it('默认显示图标', () => {
    const result = formatColoredOutput(SAMPLE_FINDINGS, { useColor: false });
    expect(result).toContain(SEVERITY_ICON.critical);
  });
});

// ==================== shouldUseColor ====================

describe('shouldUseColor', () => {
  it('显式 useColor=true 时返回 true', () => {
    expect(shouldUseColor({ useColor: true })).toBe(true);
  });

  it('显式 useColor=false 时返回 false', () => {
    expect(shouldUseColor({ useColor: false })).toBe(false);
  });

  it('NO_COLOR 环境变量设置时返回 false', () => {
    expect(shouldUseColor({ env: { NO_COLOR: '1' } })).toBe(false);
  });

  it('NO_COLOR 为空字符串时仍判定为未设置', () => {
    // NO_COLOR='' 视为未设置
    expect(shouldUseColor({ env: { NO_COLOR: '' }, stream: { isTTY: true } })).toBe(true);
  });

  it('NO_COLOR 优先级高于 FORCE_COLOR', () => {
    expect(shouldUseColor({ env: { NO_COLOR: '1', FORCE_COLOR: '1' } })).toBe(false);
  });

  it('FORCE_COLOR 环境变量设置时返回 true', () => {
    expect(shouldUseColor({ env: { FORCE_COLOR: '1' }, stream: { isTTY: false } })).toBe(true);
  });

  it('FORCE_COLOR=0 视为未设置', () => {
    expect(shouldUseColor({ env: { FORCE_COLOR: '0' }, stream: { isTTY: false } })).toBe(false);
  });

  it('noColorFlag=true 时返回 false', () => {
    expect(shouldUseColor({ noColorFlag: true, stream: { isTTY: true } })).toBe(false);
  });

  it('stream.isTTY=true 时返回 true', () => {
    expect(shouldUseColor({ stream: { isTTY: true } })).toBe(true);
  });

  it('stream.isTTY=false 时返回 false', () => {
    expect(shouldUseColor({ stream: { isTTY: false } })).toBe(false);
  });

  it('useColor 优先级最高（覆盖 NO_COLOR）', () => {
    expect(shouldUseColor({ useColor: true, env: { NO_COLOR: '1' } })).toBe(true);
  });

  it('useColor 优先级最高（覆盖 noColorFlag）', () => {
    expect(shouldUseColor({ useColor: true, noColorFlag: true })).toBe(true);
  });
});

// ==================== stripAnsi / hasAnsiColor ====================

describe('stripAnsi', () => {
  it('移除字符串中的 ANSI 颜色码', () => {
    const text = `${FG.red}hello${RESET} ${BOLD}world${RESET}`;
    expect(stripAnsi(text)).toBe('hello world');
  });

  it('无 ANSI 码时返回原字符串', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
  });

  it('空字符串', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('处理多参数 ANSI 序列', () => {
    const text = '\x1b[1;31mred bold\x1b[0m';
    expect(stripAnsi(text)).toBe('red bold');
  });
});

describe('hasAnsiColor', () => {
  it('包含 ANSI 码时返回 true', () => {
    expect(hasAnsiColor(`${FG.red}hello${RESET}`)).toBe(true);
  });

  it('不包含 ANSI 码时返回 false', () => {
    expect(hasAnsiColor('plain text')).toBe(false);
  });

  it('空字符串返回 false', () => {
    expect(hasAnsiColor('')).toBe(false);
  });
});

// ==================== 类型导出 ====================

describe('类型导出', () => {
  it('ColorizeFindingOptions 接口存在', () => {
    const opts: ColorizeFindingOptions = { useColor: false, singleLine: true };
    expect(opts.useColor).toBe(false);
  });

  it('FormatColoredOutputOptions 接口存在', () => {
    const opts: FormatColoredOutputOptions = { useColor: true, title: 'Test' };
    expect(opts.title).toBe('Test');
  });
});

// ==================== CLI 集成：--no-color 标志 ====================

interface TestState {
  stdin: string;
  exitError: Error | null;
  stdout: string[];
  stderr: string[];
}

const testState: TestState = {
  stdin: '',
  exitError: null,
  stdout: [],
  stderr: [],
};

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn((...args: unknown[]) => {
      const fd = args[0];
      if (fd === 0 || fd === '0') {
        return testState.stdin;
      }
      return (actual.readFileSync as (...a: unknown[]) => unknown)(...args);
    }),
  };
});

async function loadCli(opts: {
  argv: string[];
  stdin?: string;
}): Promise<{
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}> {
  const { argv, stdin = '' } = opts;

  testState.stdin = stdin;
  testState.exitError = null;
  testState.stdout = [];
  testState.stderr = [];

  const origArgv = process.argv;
  process.argv = ['node', '/tmp/cli.js', ...argv];

  vi.resetModules();

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    testState.stdout.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    testState.stderr.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  });
  const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    if (typeof chunk === 'string') {
      testState.stdout.push(chunk);
    }
    return true;
  });

  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    const err = new Error(`__PROCESS_EXIT_${code ?? 0}__`);
    testState.exitError = err;
    throw err;
  }) as never);

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
    writeSpy.mockRestore();
    exitSpy.mockRestore();
    process.argv = origArgv;
    vi.resetModules();
  }
}

describe('CLI: review --tui --no-color', () => {
  beforeEach(() => {
    testState.stdin = '';
    testState.stdout = [];
    testState.stderr = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('--tui --no-color 不输出 ANSI 颜色码', async () => {
    const findings = [makeFinding({ severity: 'critical' })];
    const { stdout, exitCode } = await loadCli({
      argv: ['review', '--tui', '--no-color'],
      stdin: JSON.stringify(findings),
    });

    expect(exitCode).toBeNull();
    const output = stdout.join('\n');
    // 不应包含 ANSI 颜色码（清屏序列除外，但 --no-color 时 TUI 也不应输出颜色码）
    // 注意：ANSI_CLEAR_SCREEN 仍会输出，但 severity 颜色码不应出现
    expect(output).not.toContain(FG.red);
    expect(output).not.toContain(FG.yellow);
    expect(output).not.toContain(BOLD);
  });

  it('--tui 不带 --no-color 时输出颜色码', async () => {
    const findings = [makeFinding({ severity: 'critical' })];
    const { stdout } = await loadCli({
      argv: ['review', '--tui'],
      stdin: JSON.stringify(findings),
    });
    const output = stdout.join('\n');
    // 应包含 critical 红色码
    expect(output).toContain(FG.red);
  });
});
