import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadIgnoreConfig,
  parseIgnoreContent,
  shouldIgnore,
  applyIgnoreRules,
} from '../src/ignore-manager.js';

describe('ignore-manager 单元测试', () => {
  describe('parseIgnoreContent - 边界情况', () => {
    it('处理只有空格的行', () => {
      const config = parseIgnoreContent('   \n\t  \n');
      expect(config.patterns).toEqual([]);
    });

    it('处理 \\# 和 \\! 之外的转义（按字面处理）', () => {
      const config = parseIgnoreContent('\\.gitignore\n');
      expect(config.patterns).toHaveLength(1);
      expect(config.patterns[0].pattern).toBe('\\.gitignore');
    });

    it('取反后再转义 \\#', () => {
      const config = parseIgnoreContent('!\\#important\n');
      expect(config.patterns).toHaveLength(1);
      expect(config.patterns[0].pattern).toBe('#important');
      expect(config.patterns[0].negate).toBe(true);
    });

    it('取反后再转义 \\!', () => {
      const config = parseIgnoreContent('!\\!special\n');
      expect(config.patterns).toHaveLength(1);
      expect(config.patterns[0].pattern).toBe('!special');
      expect(config.patterns[0].negate).toBe(true);
    });

    it('单 / 作为模式（根目录）', () => {
      const config = parseIgnoreContent('/\n');
      expect(config.patterns).toHaveLength(1);
      expect(config.patterns[0].pattern).toBe('/');
    });

    it('多个连续空行和注释', () => {
      const text = '\n\n\n# comment1\n\n# comment2\n\ndist/**\n\n\n';
      const config = parseIgnoreContent(text);
      expect(config.patterns).toHaveLength(1);
      expect(config.patterns[0].pattern).toBe('dist/**');
    });

    it('行内注释不支持（# 后面的内容作为模式的一部分）', () => {
      const config = parseIgnoreContent('dist/** # build output\n');
      expect(config.patterns).toHaveLength(1);
      expect(config.patterns[0].pattern).toBe('dist/** # build output');
    });

    it('source 为 undefined 时不设置', () => {
      const config = parseIgnoreContent('dist/**\n');
      expect(config.source).toBeUndefined();
    });

    it('source 为空字符串时也设置', () => {
      const config = parseIgnoreContent('dist/**\n', '');
      expect(config.source).toBe('');
    });

    it('模式首尾有空格时会被 trim', () => {
      const config = parseIgnoreContent('  dist/**  \n');
      expect(config.patterns).toHaveLength(1);
      expect(config.patterns[0].pattern).toBe('dist/**');
    });
  });

  describe('parseIgnoreContent - 目录规则规范化', () => {
    it('目录规则去除尾部 / 后存储在 pattern 字段', () => {
      const config = parseIgnoreContent('node_modules/\n');
      expect(config.patterns[0].pattern).toBe('node_modules');
    });

    it('非目录规则保留原样', () => {
      const config = parseIgnoreContent('*.log\n');
      expect(config.patterns[0].pattern).toBe('*.log');
    });

    it('根锚定的目录规则', () => {
      const config = parseIgnoreContent('/dist/\n');
      expect(config.patterns[0].pattern).toBe('/dist');
    });

    it('只有尾部 / 的单字符目录（如 a/）', () => {
      const config = parseIgnoreContent('a/\n');
      expect(config.patterns[0].pattern).toBe('a');
    });
  });

  describe('shouldIgnore - 路径规范化', () => {
    const config = parseIgnoreContent('dist/**\n*.log\n/build\n');

    it('前导 / 的路径被正确规范化', () => {
      expect(shouldIgnore('/dist/bundle.js', config)).toBe(true);
      expect(shouldIgnore('///dist/bundle.js', config)).toBe(true);
      expect(shouldIgnore('/build/output.js', config)).toBe(true);
    });

    it('尾部 / 的路径被正确规范化（目录匹配）', () => {
      expect(shouldIgnore('build/', config)).toBe(true);
      expect(shouldIgnore('/build/', config)).toBe(true);
    });

    it('尾部 / 的文件路径规范化后正确匹配', () => {
      expect(shouldIgnore('app.log/', config)).toBe(true);
      expect(shouldIgnore('/app.log/', config)).toBe(true);
    });

    it('前后都有 / 的路径被正确规范化', () => {
      expect(shouldIgnore('//build//', config)).toBe(true);
    });

    it('只含 / 的路径返回 false', () => {
      expect(shouldIgnore('/', config)).toBe(false);
      expect(shouldIgnore('///', config)).toBe(false);
    });
  });

  describe('shouldIgnore - 边界输入', () => {
    const config = parseIgnoreContent('dist/**\n');

    it('null config 返回 false', () => {
      expect(shouldIgnore('dist/a.js', null as any)).toBe(false);
    });

    it('undefined config 返回 false', () => {
      expect(shouldIgnore('dist/a.js', undefined as any)).toBe(false);
    });

    it('空 patterns 的 config 返回 false', () => {
      expect(shouldIgnore('dist/a.js', { patterns: [] })).toBe(false);
    });

    it('filePath 为 null 返回 false', () => {
      expect(shouldIgnore(null as any, config)).toBe(false);
    });

    it('filePath 为 undefined 返回 false', () => {
      expect(shouldIgnore(undefined as any, config)).toBe(false);
    });

    it('filePath 为数字返回 false', () => {
      expect(shouldIgnore(123 as any, config)).toBe(false);
    });

    it('filePath 为对象返回 false', () => {
      expect(shouldIgnore({} as any, config)).toBe(false);
    });
  });

  describe('shouldIgnore - 模式匹配边界', () => {
    it('空模式匹配空字符串（但空路径被规范化后返回 false）', () => {
      const config = parseIgnoreContent('/\n');
      expect(shouldIgnore('', config)).toBe(false);
    });

    it('** 模式匹配任意路径', () => {
      const config = parseIgnoreContent('**\n');
      expect(shouldIgnore('a/b/c.js', config)).toBe(true);
      expect(shouldIgnore('a.js', config)).toBe(true);
    });

    it('单字符 ? 通配符', () => {
      const config = parseIgnoreContent('file?.txt\n');
      expect(shouldIgnore('file1.txt', config)).toBe(true);
      expect(shouldIgnore('fileA.txt', config)).toBe(true);
      expect(shouldIgnore('file.txt', config)).toBe(false);
      expect(shouldIgnore('file12.txt', config)).toBe(false);
    });

    it('大括号 alternation', () => {
      const config = parseIgnoreContent('*.{js,ts}\n');
      expect(shouldIgnore('app.js', config)).toBe(true);
      expect(shouldIgnore('app.ts', config)).toBe(true);
      expect(shouldIgnore('app.jsx', config)).toBe(false);
    });

    it('多级目录的取反规则', () => {
      const config = parseIgnoreContent('vendor/**\n!vendor/**/index.js\n');
      expect(shouldIgnore('vendor/lib.js', config)).toBe(true);
      expect(shouldIgnore('vendor/sub/index.js', config)).toBe(false);
      expect(shouldIgnore('vendor/a/b/c/index.js', config)).toBe(false);
    });
  });

  describe('applyIgnoreRules - 边界情况', () => {
    const config = parseIgnoreContent('dist/**\n');

    it('null findings 返回原数组引用', () => {
      const findings: any = null;
      const result = applyIgnoreRules(findings, config);
      expect(result).toBeNull();
    });

    it('undefined findings 返回原引用', () => {
      const findings: any = undefined;
      const result = applyIgnoreRules(findings, config);
      expect(result).toBeUndefined();
    });

    it('非数组 findings 返回原引用', () => {
      const findings: any = 'not-an-array';
      const result = applyIgnoreRules(findings, config);
      expect(result).toBe('not-an-array');
    });

    it('null config 返回原数组', () => {
      const findings = [{ file: 'a.js' }];
      const result = applyIgnoreRules(findings, null as any);
      expect(result).toBe(findings);
    });

    it('undefined config 返回原数组', () => {
      const findings = [{ file: 'a.js' }];
      const result = applyIgnoreRules(findings, undefined as any);
      expect(result).toBe(findings);
    });

    it('空 patterns config 返回原数组', () => {
      const findings = [{ file: 'a.js' }];
      const result = applyIgnoreRules(findings, { patterns: [] });
      expect(result).toBe(findings);
    });

    it('保持原数组不变', () => {
      const findings = [
        { file: 'src/a.ts', id: 1 },
        { file: 'dist/b.js', id: 2 },
      ];
      const original = [...findings];
      applyIgnoreRules(findings, config);
      expect(findings).toEqual(original);
      expect(findings).toHaveLength(2);
    });
  });

  describe('applyIgnoreRules - 泛型支持', () => {
    it('支持自定义 Finding 类型', () => {
      interface CustomFinding {
        file: string;
        line: number;
        message: string;
        severity: 'high' | 'low';
      }
      const config = parseIgnoreContent('dist/**\n');
      const findings: CustomFinding[] = [
        { file: 'src/a.ts', line: 1, message: 'ok', severity: 'low' },
        { file: 'dist/b.js', line: 2, message: 'skip', severity: 'high' },
      ];
      const result = applyIgnoreRules(findings, config);
      expect(result).toHaveLength(1);
      expect(result[0].file).toBe('src/a.ts');
      expect(result[0].severity).toBe('low');
    });
  });

  describe('loadIgnoreConfig - 边界情况', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'ignore-mgr-unit-test-'));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('空文件返回空 patterns', () => {
      const filePath = join(tmpDir, '.reviewignore');
      writeFileSync(filePath, '', 'utf8');
      const config = loadIgnoreConfig(filePath);
      expect(config.patterns).toEqual([]);
      expect(config.source).toBe(filePath);
    });

    it('只有注释的文件返回空 patterns', () => {
      const filePath = join(tmpDir, '.reviewignore');
      writeFileSync(filePath, '# just a comment\n', 'utf8');
      const config = loadIgnoreConfig(filePath);
      expect(config.patterns).toEqual([]);
    });

    it('configPath 为 null 抛出错误', () => {
      expect(() => loadIgnoreConfig(null as any)).toThrow(/not found/);
    });

    it('configPath 为 undefined 抛出错误', () => {
      expect(() => loadIgnoreConfig(undefined as any)).toThrow(/not found/);
    });
  });

  describe('IgnorePattern 接口一致性', () => {
    it('pattern 字段存储规范化后的模式（无尾部 /，保留前导 /）', () => {
      const config = parseIgnoreContent('node_modules/\n/dist/\n');
      expect(config.patterns[0].pattern).toBe('node_modules');
      expect(config.patterns[1].pattern).toBe('/dist');
    });

    it('negate 字段正确反映 ! 前缀', () => {
      const config = parseIgnoreContent('a.js\n!b.js\n');
      expect(config.patterns[0].negate).toBe(false);
      expect(config.patterns[1].negate).toBe(true);
    });

    it('regex 字段是 RegExp 实例', () => {
      const config = parseIgnoreContent('*.js\n');
      expect(config.patterns[0].regex).toBeInstanceOf(RegExp);
    });
  });

  describe('复杂规则组合', () => {
    it('多组取反和忽略交替', () => {
      const config = parseIgnoreContent(`
        vendor/**
        !vendor/important/
        vendor/important/secret/**
        !vendor/important/secret/key.pub
      `);
      expect(shouldIgnore('vendor/lib.js', config)).toBe(true);
      expect(shouldIgnore('vendor/important/index.js', config)).toBe(false);
      expect(shouldIgnore('vendor/important/secret/key.priv', config)).toBe(true);
      expect(shouldIgnore('vendor/important/secret/key.pub', config)).toBe(false);
    });

    it('带路径的模式只匹配对应路径前缀', () => {
      const config = parseIgnoreContent('src/**/*.test.ts\n');
      expect(shouldIgnore('src/utils.test.ts', config)).toBe(true);
      expect(shouldIgnore('src/sub/helper.test.ts', config)).toBe(true);
      expect(shouldIgnore('tests/utils.test.ts', config)).toBe(false);
    });

    it('根锚定规则精确匹配', () => {
      const config = parseIgnoreContent('/build/\n');
      expect(shouldIgnore('build/output.js', config)).toBe(true);
      expect(shouldIgnore('src/build/output.js', config)).toBe(false);
      expect(shouldIgnore('packages/app/build/output.js', config)).toBe(false);
    });
  });
});
