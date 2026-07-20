import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ReviewTUI,
  launchTUI,
  renderFindings,
  sortFindings,
  sortFindingsBySeverity,
  sortFindingsByFile,
  sortFindingsByLine,
  sortFindingsByCategory,
  filterFindings,
  severityAnsiColor,
  colorizeSeverityTag,
  TUI_KEYS,
  ANSI_CLEAR_SCREEN,
  ANSI_SHOW_CURSOR,
  ANSI_REVERSE,
  ANSI_REVERSE_OFF,
  ANSI_RESET,
  ANSI_BOLD,
  ANSI_FG,
  type TUIOptions,
  type TUIFilter,
  type TUISortMode,
} from '../../../src/tui.js';
import type { Finding } from '../../../src/types.js';

// ── 测试 fixtures ──

function makeFinding(partial: Partial<Finding> = {}): Finding {
  return {
    file: 'src/app.ts',
    line: 10,
    severity: 'high',
    category: 'security',
    message: 'test finding',
    confidence: 0.8,
    source: 'rule',
    ...partial,
  };
}

const SAMPLE_FINDINGS: Finding[] = [
  makeFinding({ file: 'src/a.ts', line: 10, severity: 'low', category: 'style', message: 'low severity in a.ts' }),
  makeFinding({ file: 'src/b.ts', line: 20, severity: 'critical', category: 'security', message: 'critical in b.ts' }),
  makeFinding({ file: 'src/c.ts', line: 30, severity: 'medium', category: 'quality', message: 'medium in c.ts' }),
  makeFinding({ file: 'src/d.ts', line: 40, severity: 'high', category: 'performance', message: 'high in d.ts' }),
  makeFinding({ file: 'src/e.ts', line: 50, severity: 'info', category: 'style', message: 'info in e.ts' }),
];

// ==================== ANSI 常量 ====================

describe('ANSI 转义序列常量', () => {
  it('ANSI_CLEAR_SCREEN 包含清屏与光标复位', () => {
    expect(ANSI_CLEAR_SCREEN).toContain('\x1b[2J');
    expect(ANSI_CLEAR_SCREEN).toContain('\x1b[H');
  });

  it('ANSI_SHOW_CURSOR 正确', () => {
    expect(ANSI_SHOW_CURSOR).toBe('\x1b[?25h');
  });

  it('ANSI_REVERSE / ANSI_REVERSE_OFF 正确', () => {
    expect(ANSI_REVERSE).toBe('\x1b[7m');
    expect(ANSI_REVERSE_OFF).toBe('\x1b[27m');
  });

  it('ANSI_RESET / ANSI_BOLD 正确', () => {
    expect(ANSI_RESET).toBe('\x1b[0m');
    expect(ANSI_BOLD).toBe('\x1b[1m');
  });

  it('ANSI_FG 包含 red/yellow/blue/green/gray', () => {
    expect(ANSI_FG.red).toBe('\x1b[31m');
    expect(ANSI_FG.yellow).toBe('\x1b[33m');
    expect(ANSI_FG.blue).toBe('\x1b[34m');
    expect(ANSI_FG.green).toBe('\x1b[32m');
    expect(ANSI_FG.gray).toBe('\x1b[90m');
  });
});

// ==================== TUI_KEYS 按键常量 ====================

describe('TUI_KEYS 按键常量', () => {
  it('UP/DOWN 是 ANSI 方向键', () => {
    expect(TUI_KEYS.UP).toBe('\x1b[A');
    expect(TUI_KEYS.DOWN).toBe('\x1b[B');
  });

  it('Q/ESC/CTRL_C 是退出键', () => {
    expect(TUI_KEYS.Q).toBe('q');
    expect(TUI_KEYS.ESC).toBe('\x1b');
    expect(TUI_KEYS.CTRL_C).toBe('\x03');
  });

  it('J/K 是 vim 风格导航键', () => {
    expect(TUI_KEYS.J).toBe('j');
    expect(TUI_KEYS.K).toBe('k');
  });

  it('PAGE_UP/PAGE_DOWN 是翻页键', () => {
    expect(TUI_KEYS.PAGE_UP).toContain('\x1b[5');
    expect(TUI_KEYS.PAGE_DOWN).toContain('\x1b[6');
  });

  it('G 是跳转键', () => {
    expect(TUI_KEYS.G).toBe('g');
  });

  it('F/S 是过滤/排序键', () => {
    expect(TUI_KEYS.F).toBe('f');
    expect(TUI_KEYS.S).toBe('s');
  });
});

// ==================== 排序辅助函数 ====================

describe('排序辅助函数', () => {
  it('sortFindingsBySeverity 按 critical → info 降序', () => {
    const sorted = sortFindingsBySeverity(SAMPLE_FINDINGS);
    expect(sorted[0].severity).toBe('critical');
    expect(sorted[1].severity).toBe('high');
    expect(sorted[2].severity).toBe('medium');
    expect(sorted[3].severity).toBe('low');
    expect(sorted[4].severity).toBe('info');
  });

  it('sortFindingsByFile 按文件名升序', () => {
    const sorted = sortFindingsByFile(SAMPLE_FINDINGS);
    expect(sorted[0].file).toBe('src/a.ts');
    expect(sorted[1].file).toBe('src/b.ts');
    expect(sorted[4].file).toBe('src/e.ts');
  });

  it('sortFindingsByLine 按行号升序', () => {
    const sorted = sortFindingsByLine(SAMPLE_FINDINGS);
    expect(sorted[0].line).toBe(10);
    expect(sorted[1].line).toBe(20);
    expect(sorted[4].line).toBe(50);
  });

  it('sortFindingsByCategory 按类别升序', () => {
    const sorted = sortFindingsByCategory(SAMPLE_FINDINGS);
    // performance < quality < security < style (alphabetical)
    expect(sorted[0].category).toBe('performance');
    expect(sorted[1].category).toBe('quality');
    expect(sorted[2].category).toBe('security');
    expect(sorted[3].category).toBe('style');
  });

  it('sortFindings 按 severity 模式', () => {
    const sorted = sortFindings(SAMPLE_FINDINGS, 'severity');
    expect(sorted[0].severity).toBe('critical');
  });

  it('sortFindings 按 file 模式', () => {
    const sorted = sortFindings(SAMPLE_FINDINGS, 'file');
    expect(sorted[0].file).toBe('src/a.ts');
  });

  it('sortFindings 按 line 模式', () => {
    const sorted = sortFindings(SAMPLE_FINDINGS, 'line');
    expect(sorted[0].line).toBe(10);
  });

  it('sortFindings 按 category 模式', () => {
    const sorted = sortFindings(SAMPLE_FINDINGS, 'category');
    expect(sorted[0].category).toBe('performance');
  });

  it('sortFindings 不修改原数组', () => {
    const original = [...SAMPLE_FINDINGS];
    sortFindings(SAMPLE_FINDINGS, 'line');
    expect(SAMPLE_FINDINGS).toEqual(original);
  });
});

// ==================== 过滤辅助函数 ====================

describe('filterFindings 过滤函数', () => {
  it('按 severity 过滤', () => {
    const filtered = filterFindings(SAMPLE_FINDINGS, { severity: 'critical' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].severity).toBe('critical');
  });

  it('按 category 过滤', () => {
    const filtered = filterFindings(SAMPLE_FINDINGS, { category: 'style' });
    expect(filtered).toHaveLength(2);
    expect(filtered.every((f) => f.category === 'style')).toBe(true);
  });

  it('按 file 子串过滤（大小写不敏感）', () => {
    const filtered = filterFindings(SAMPLE_FINDINGS, { file: 'A.TS' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].file).toBe('src/a.ts');
  });

  it('按 message 子串过滤', () => {
    const filtered = filterFindings(SAMPLE_FINDINGS, { message: 'critical' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].message).toContain('critical');
  });

  it('组合过滤条件（AND）', () => {
    const filtered = filterFindings(SAMPLE_FINDINGS, {
      severity: 'low',
      category: 'style',
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].file).toBe('src/a.ts');
  });

  it('空过滤条件返回全部', () => {
    const filtered = filterFindings(SAMPLE_FINDINGS, {});
    expect(filtered).toHaveLength(SAMPLE_FINDINGS.length);
  });

  it('无匹配时返回空数组', () => {
    const filtered = filterFindings(SAMPLE_FINDINGS, { file: 'not-exist' });
    expect(filtered).toEqual([]);
  });
});

// ==================== 颜色辅助 ====================

describe('severityAnsiColor', () => {
  it('critical 返回红色', () => {
    expect(severityAnsiColor('critical')).toBe(ANSI_FG.red);
  });
  it('high 返回黄色', () => {
    expect(severityAnsiColor('high')).toBe(ANSI_FG.yellow);
  });
  it('medium 返回蓝色', () => {
    expect(severityAnsiColor('medium')).toBe(ANSI_FG.blue);
  });
  it('low 返回绿色', () => {
    expect(severityAnsiColor('low')).toBe(ANSI_FG.green);
  });
  it('info 返回灰色', () => {
    expect(severityAnsiColor('info')).toBe(ANSI_FG.gray);
  });
});

describe('colorizeSeverityTag', () => {
  it('启用颜色时包含 ANSI 转义序列', () => {
    const tag = colorizeSeverityTag('critical', true);
    expect(tag).toContain(ANSI_FG.red);
    expect(tag).toContain(ANSI_RESET);
    expect(tag).toContain('[CRITICAL]');
  });

  it('禁用颜色时仅返回纯文本', () => {
    const tag = colorizeSeverityTag('high', false);
    expect(tag).toBe('[HIGH]');
    expect(tag).not.toContain('\x1b');
  });

  it('各严重度对应正确颜色', () => {
    expect(colorizeSeverityTag('critical', true)).toContain(ANSI_FG.red);
    expect(colorizeSeverityTag('high', true)).toContain(ANSI_FG.yellow);
    expect(colorizeSeverityTag('medium', true)).toContain(ANSI_FG.blue);
    expect(colorizeSeverityTag('low', true)).toContain(ANSI_FG.green);
    expect(colorizeSeverityTag('info', true)).toContain(ANSI_FG.gray);
  });
});

// ==================== renderFindings ====================

describe('renderFindings', () => {
  it('渲染空 findings 返回 No findings 消息', () => {
    const out = renderFindings([], { useColor: false });
    expect(out).toContain('No findings to display');
    expect(out).toContain('Total: 0');
  });

  it('渲染包含标题', () => {
    const out = renderFindings(SAMPLE_FINDINGS, { useColor: false, title: 'My Title' });
    expect(out).toContain('My Title');
  });

  it('渲染包含总数', () => {
    const out = renderFindings(SAMPLE_FINDINGS, { useColor: false });
    expect(out).toContain(`Total: ${SAMPLE_FINDINGS.length}`);
  });

  it('渲染包含每条 finding 的文件路径', () => {
    const out = renderFindings(SAMPLE_FINDINGS, { useColor: false });
    for (const f of SAMPLE_FINDINGS) {
      expect(out).toContain(f.file);
    }
  });

  it('启用颜色时包含 ANSI 颜色码', () => {
    const out = renderFindings(SAMPLE_FINDINGS, { useColor: true });
    expect(out).toContain(ANSI_FG.red); // critical
    expect(out).toContain(ANSI_FG.yellow); // high
    expect(out).toContain(ANSI_BOLD); // 标题
    expect(out).toContain(ANSI_RESET);
  });

  it('禁用颜色时不包含 ANSI 颜色码', () => {
    const out = renderFindings(SAMPLE_FINDINGS, { useColor: false });
    expect(out).not.toContain('\x1b');
  });

  it('cursor 高亮当前行（启用颜色时使用反色）', () => {
    const sorted = sortFindingsBySeverity(SAMPLE_FINDINGS);
    const out = renderFindings(sorted, { useColor: true, cursor: 0 });
    expect(out).toContain(ANSI_REVERSE);
    expect(out).toContain(ANSI_REVERSE_OFF);
  });

  it('cursor 高亮当前行（禁用颜色时使用 ▶ 标记）', () => {
    const sorted = sortFindingsBySeverity(SAMPLE_FINDINGS);
    const out = renderFindings(sorted, { useColor: false, cursor: 0 });
    expect(out).toContain('▶');
  });

  it('pageSize 限制显示行数', () => {
    const manyFindings = Array.from({ length: 50 }, (_, i) =>
      makeFinding({ file: `f${i}.ts`, line: i + 1, severity: 'low' }),
    );
    const out = renderFindings(manyFindings, { useColor: false, pageSize: 5 });
    // 显示 5 行 + 表头 + 摘要 + 帮助
    const fileLineCount = (out.match(/f\d+\.ts/g) || []).length;
    expect(fileLineCount).toBeLessThanOrEqual(5);
  });

  it('offset 跳过前 N 条 findings', () => {
    const out = renderFindings(SAMPLE_FINDINGS, { useColor: false, offset: 2, pageSize: 10 });
    expect(out).toContain('from offset 2');
  });

  it('包含帮助行', () => {
    const out = renderFindings(SAMPLE_FINDINGS, { useColor: false });
    expect(out).toMatch(/navigate|j\/k/i);
    expect(out).toMatch(/quit/i);
  });

  it('包含表头 SEVERITY/FILE/LINE', () => {
    const out = renderFindings(SAMPLE_FINDINGS, { useColor: false });
    expect(out).toContain('SEVERITY');
    expect(out).toContain('FILE');
    expect(out).toContain('LINE');
  });
});

// ==================== ReviewTUI 类 ====================

describe('ReviewTUI', () => {
  describe('构造器', () => {
    it('使用默认值创建', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      expect(tui.getTotalCount()).toBe(SAMPLE_FINDINGS.length);
      expect(tui.getCursor()).toBe(0);
      expect(tui.getOffset()).toBe(0);
      expect(tui.getSortMode()).toBe('severity');
    });

    it('接受自定义初始过滤与排序', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS, {
        initialFilter: { severity: 'critical' },
        initialSort: 'file',
      });
      expect(tui.getFilter().severity).toBe('critical');
      expect(tui.getSortMode()).toBe('file');
    });

    it('接受自定义 pageSize 与 useColor', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS, { pageSize: 5, useColor: false });
      expect(tui.getVisibleFindings().length).toBe(SAMPLE_FINDINGS.length);
    });
  });

  describe('状态查询', () => {
    it('getVisibleFindings 默认按 severity 排序', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      const visible = tui.getVisibleFindings();
      expect(visible[0].severity).toBe('critical');
      expect(visible[1].severity).toBe('high');
    });

    it('getVisibleFindings 应用过滤条件', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS, { initialFilter: { severity: 'critical' } });
      const visible = tui.getVisibleFindings();
      expect(visible).toHaveLength(1);
      expect(visible[0].severity).toBe('critical');
    });

    it('getCurrentFinding 返回光标所指 finding', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      const current = tui.getCurrentFinding();
      expect(current).not.toBeNull();
      // 默认按 severity 排序后第一条是 critical
      expect(current?.severity).toBe('critical');
    });

    it('空 findings 时 getCurrentFinding 返回 null', () => {
      const tui = new ReviewTUI([]);
      expect(tui.getCurrentFinding()).toBeNull();
    });

    it('getTotalCount 返回原始 findings 总数（不受过滤影响）', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS, { initialFilter: { severity: 'critical' } });
      expect(tui.getTotalCount()).toBe(SAMPLE_FINDINGS.length);
    });
  });

  describe('导航', () => {
    it('moveDown 向下移动光标', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      expect(tui.getCursor()).toBe(0);
      tui.moveDown();
      expect(tui.getCursor()).toBe(1);
      tui.moveDown();
      expect(tui.getCursor()).toBe(2);
    });

    it('moveUp 向上移动光标', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      tui.moveDown();
      tui.moveDown();
      expect(tui.getCursor()).toBe(2);
      tui.moveUp();
      expect(tui.getCursor()).toBe(1);
    });

    it('moveUp 在顶部时不移动', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      tui.moveUp();
      expect(tui.getCursor()).toBe(0);
    });

    it('moveDown 在底部时不移动', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      const last = tui.getVisibleFindings().length - 1;
      for (let i = 0; i < last + 5; i++) tui.moveDown();
      expect(tui.getCursor()).toBe(last);
    });

    it('pageDown 翻页', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS, { pageSize: 2 });
      tui.pageDown();
      expect(tui.getCursor()).toBe(2);
    });

    it('pageUp 翻页', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS, { pageSize: 2 });
      tui.moveDown();
      tui.moveDown();
      tui.moveDown();
      tui.pageUp();
      expect(tui.getCursor()).toBe(1);
    });

    it('goToTop 跳到顶部', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      tui.moveDown();
      tui.moveDown();
      tui.goToTop();
      expect(tui.getCursor()).toBe(0);
      expect(tui.getOffset()).toBe(0);
    });

    it('goToBottom 跳到底部', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      tui.goToBottom();
      const visible = tui.getVisibleFindings();
      expect(tui.getCursor()).toBe(visible.length - 1);
    });

    it('滚动偏移随光标调整', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS, { pageSize: 2 });
      // 向下移动超过一页
      tui.moveDown();
      tui.moveDown();
      tui.moveDown();
      expect(tui.getOffset()).toBeGreaterThan(0);
    });
  });

  describe('过滤', () => {
    it('setFilter 设置过滤后光标重置', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      tui.moveDown();
      tui.moveDown();
      tui.setFilter({ severity: 'critical' });
      expect(tui.getCursor()).toBe(0);
      expect(tui.getOffset()).toBe(0);
      expect(tui.getVisibleFindings()).toHaveLength(1);
    });

    it('clearFilter 清空过滤', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS, { initialFilter: { severity: 'critical' } });
      expect(tui.getVisibleFindings()).toHaveLength(1);
      tui.clearFilter();
      expect(tui.getVisibleFindings()).toHaveLength(SAMPLE_FINDINGS.length);
    });

    it('setFilter 合并到现有过滤条件', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS, { initialFilter: { category: 'style' } });
      tui.setFilter({ severity: 'low' });
      expect(tui.getVisibleFindings()).toHaveLength(1);
      expect(tui.getVisibleFindings()[0].severity).toBe('low');
      expect(tui.getVisibleFindings()[0].category).toBe('style');
    });
  });

  describe('排序', () => {
    it('setSortMode 切换排序模式', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      tui.setSortMode('file');
      expect(tui.getSortMode()).toBe('file');
      expect(tui.getVisibleFindings()[0].file).toBe('src/a.ts');
    });

    it('cycleSortMode 循环切换 severity → file → line → category', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      expect(tui.getSortMode()).toBe('severity');
      tui.cycleSortMode();
      expect(tui.getSortMode()).toBe('file');
      tui.cycleSortMode();
      expect(tui.getSortMode()).toBe('line');
      tui.cycleSortMode();
      expect(tui.getSortMode()).toBe('category');
      tui.cycleSortMode();
      expect(tui.getSortMode()).toBe('severity');
    });
  });

  describe('渲染', () => {
    it('render 返回包含 findings 信息的字符串', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS, { useColor: false });
      const out = tui.render();
      expect(out).toContain('Code Review Findings');
      expect(out).toContain('sort: severity');
      expect(out).toContain(`[${SAMPLE_FINDINGS.length}/${SAMPLE_FINDINGS.length}]`);
    });

    it('render 包含当前排序模式', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS, { useColor: false, initialSort: 'file' });
      expect(tui.render()).toContain('sort: file');
    });

    it('render 包含过滤信息', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS, {
        useColor: false,
        initialFilter: { severity: 'critical' },
      });
      const out = tui.render();
      expect(out).toContain('filter:');
      expect(out).toContain('severity=critical');
    });

    it('paint 写入到 writer', () => {
      const written: string[] = [];
      const tui = new ReviewTUI(SAMPLE_FINDINGS, {
        useColor: false,
        writer: (s) => written.push(s),
      });
      tui.paint();
      const output = written.join('');
      expect(output).toContain(ANSI_CLEAR_SCREEN);
      expect(output).toContain('Code Review Findings');
    });

    it('clearScreen 写入清屏序列', () => {
      const written: string[] = [];
      const tui = new ReviewTUI(SAMPLE_FINDINGS, {
        writer: (s) => written.push(s),
      });
      tui.clearScreen();
      expect(written[0]).toBe(ANSI_CLEAR_SCREEN);
    });
  });

  describe('handleKey 按键处理', () => {
    it('UP 键向上移动', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      tui.moveDown();
      const before = tui.getCursor();
      tui.handleKey(TUI_KEYS.UP);
      expect(tui.getCursor()).toBe(before - 1);
    });

    it('DOWN 键向下移动', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      const before = tui.getCursor();
      tui.handleKey(TUI_KEYS.DOWN);
      expect(tui.getCursor()).toBe(before + 1);
    });

    it('K 键向上移动（vim 风格）', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      tui.moveDown();
      const before = tui.getCursor();
      tui.handleKey(TUI_KEYS.K);
      expect(tui.getCursor()).toBe(before - 1);
    });

    it('J 键向下移动（vim 风格）', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      const before = tui.getCursor();
      tui.handleKey(TUI_KEYS.J);
      expect(tui.getCursor()).toBe(before + 1);
    });

    it('PAGE_DOWN 翻页', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS, { pageSize: 2 });
      tui.handleKey(TUI_KEYS.PAGE_DOWN);
      expect(tui.getCursor()).toBe(2);
    });

    it('PAGE_UP 翻页', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS, { pageSize: 2 });
      tui.moveDown();
      tui.moveDown();
      tui.moveDown();
      tui.handleKey(TUI_KEYS.PAGE_UP);
      expect(tui.getCursor()).toBe(1);
    });

    it('HOME / G 跳到顶部', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      tui.moveDown();
      tui.moveDown();
      tui.handleKey(TUI_KEYS.G);
      expect(tui.getCursor()).toBe(0);
    });

    it('END 跳到底部', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      tui.handleKey(TUI_KEYS.END);
      expect(tui.getCursor()).toBe(tui.getVisibleFindings().length - 1);
    });

    it('S 键循环切换排序模式', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      expect(tui.getSortMode()).toBe('severity');
      tui.handleKey(TUI_KEYS.S);
      expect(tui.getSortMode()).toBe('file');
    });

    it('Q 键返回 false 表示退出', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      expect(tui.handleKey(TUI_KEYS.Q)).toBe(false);
    });

    it('ESC 键返回 false 表示退出', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      expect(tui.handleKey(TUI_KEYS.ESC)).toBe(false);
    });

    it('CTRL_C 返回 false 表示退出', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      expect(tui.handleKey(TUI_KEYS.CTRL_C)).toBe(false);
    });

    it('未知键返回 true 继续运行', () => {
      const tui = new ReviewTUI(SAMPLE_FINDINGS);
      expect(tui.handleKey('x')).toBe(true);
    });
  });

  describe('start 交互循环', () => {
    it('reader 返回 null 时立即退出（无 reader 且非 TTY）', async () => {
      const written: string[] = [];
      const tui = new ReviewTUI(SAMPLE_FINDINGS, {
        useColor: false,
        writer: (s) => written.push(s),
        interactive: false,
      });
      await tui.start();
      const output = written.join('');
      expect(output).toContain('Code Review Findings');
      // 应显示一次后立即退出
      expect(output).toContain(ANSI_SHOW_CURSOR);
    });

    it('reader 提供按键序列时正确导航后退出', async () => {
      const written: string[] = [];
      const keys = [TUI_KEYS.DOWN, TUI_KEYS.DOWN, TUI_KEYS.Q];
      let idx = 0;
      const reader = () => Promise.resolve(idx < keys.length ? keys[idx++] : null);
      const tui = new ReviewTUI(SAMPLE_FINDINGS, {
        useColor: false,
        writer: (s) => written.push(s),
        reader,
      });
      await tui.start();
      expect(tui.getCursor()).toBe(2);
    });

    it('reader 返回 ESC 退出', async () => {
      const keys = [TUI_KEYS.ESC];
      let idx = 0;
      const reader = () => Promise.resolve(idx < keys.length ? keys[idx++] : null);
      const tui = new ReviewTUI(SAMPLE_FINDINGS, { reader, useColor: false });
      await tui.start();
      // 没崩
      expect(tui.getCursor()).toBe(0);
    });

    it('reader 返回 null 退出', async () => {
      const reader = () => Promise.resolve(null);
      const tui = new ReviewTUI(SAMPLE_FINDINGS, { reader, useColor: false });
      await tui.start();
      expect(tui.getCursor()).toBe(0);
    });

    it('同步 reader 也支持', async () => {
      const keys = [TUI_KEYS.J, TUI_KEYS.Q];
      let idx = 0;
      const reader = () => (idx < keys.length ? keys[idx++] : null);
      const tui = new ReviewTUI(SAMPLE_FINDINGS, { reader, useColor: false });
      await tui.start();
      expect(tui.getCursor()).toBe(1);
    });

    it('paint 至少调用一次', async () => {
      const written: string[] = [];
      const tui = new ReviewTUI(SAMPLE_FINDINGS, {
        useColor: false,
        writer: (s) => written.push(s),
        interactive: false,
      });
      await tui.start();
      expect(written.length).toBeGreaterThan(0);
    });

    it('stop 停止循环', async () => {
      let calls = 0;
      const reader = () => {
        calls++;
        if (calls > 100) return Promise.resolve(null);
        return Promise.resolve('x'); // 未知键
      };
      const tui = new ReviewTUI(SAMPLE_FINDINGS, { reader, useColor: false });
      // 异步启动并立即停止
      const promise = tui.start();
      tui.stop();
      await promise;
      // 不应陷入死循环
      expect(calls).toBeLessThan(1000);
    });
  });
});

// ==================== launchTUI 便捷函数 ====================

describe('launchTUI', () => {
  it('调用后正常返回（非交互模式）', async () => {
    const written: string[] = [];
    await launchTUI(SAMPLE_FINDINGS, {
      useColor: false,
      writer: (s) => written.push(s),
      interactive: false,
    });
    const output = written.join('');
    expect(output).toContain('Code Review Findings');
  });

  it('使用 reader 进行交互', async () => {
    const keys = [TUI_KEYS.DOWN, TUI_KEYS.DOWN, TUI_KEYS.DOWN, TUI_KEYS.Q];
    let idx = 0;
    await launchTUI(SAMPLE_FINDINGS, {
      useColor: false,
      reader: () => Promise.resolve(idx < keys.length ? keys[idx++] : null),
    });
    // 没崩即可
  });

  it('空 findings 不崩', async () => {
    const written: string[] = [];
    await launchTUI([], {
      useColor: false,
      writer: (s) => written.push(s),
      interactive: false,
    });
    expect(written.join('')).toContain('No findings');
  });
});

// ==================== CLI 集成：review --tui ====================

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

describe('CLI: review --tui', () => {
  beforeEach(() => {
    testState.stdin = '';
    testState.stdout = [];
    testState.stderr = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('--tui 从 stdin 读取 findings JSON 并渲染 TUI', async () => {
    const findings = [
      makeFinding({ severity: 'critical', message: 'cli critical' }),
      makeFinding({ severity: 'high', message: 'cli high' }),
    ];
    const { stdout, exitCode } = await loadCli({
      argv: ['review', '--tui'],
      stdin: JSON.stringify(findings),
    });

    const output = stdout.join('\n');
    // 非 TTY 环境：TUI 仅渲染一次后退出，不报错
    expect(exitCode).toBeNull();
    expect(output).toContain('Code Review Findings');
    expect(output).toContain('cli critical');
  });

  it('--tui 标志被识别（不抛未知 flag 错误）', async () => {
    const { exitCode, stdout } = await loadCli({
      argv: ['review', '--tui'],
      stdin: '[]',
    });
    expect(exitCode).toBeNull();
    // 空 findings 输入渲染 "No findings"
    expect(stdout.join('\n')).toContain('No findings');
  });

  it('--tui 输出包含 ANSI 清屏序列', async () => {
    const findings = [makeFinding({ severity: 'high' })];
    const { stdout } = await loadCli({
      argv: ['review', '--tui'],
      stdin: JSON.stringify(findings),
    });
    const output = stdout.join('\n');
    expect(output).toContain(ANSI_CLEAR_SCREEN);
  });
});

// ==================== 类型导出 ====================

describe('类型导出', () => {
  it('TUIOptions 接口存在', () => {
    const opts: TUIOptions = { pageSize: 10, useColor: false };
    expect(opts.pageSize).toBe(10);
  });

  it('TUIFilter 接口存在', () => {
    const f: TUIFilter = { severity: 'high', category: 'security' };
    expect(f.severity).toBe('high');
  });

  it('TUISortMode 类型存在', () => {
    const m: TUISortMode = 'severity';
    expect(m).toBe('severity');
  });
});
