import { describe, it, expect } from 'vitest';
import { globToRegex } from '../src/glob.js';

// ── globToRegex 单元测试 ──
//
// 覆盖：* / ** / ? / {a,b} 等标准 glob 语法，以及转义与边界情况。
// 行为基准来自 file-filter.ts 与 feedback.ts 的原有两个 globToRegex 实现，
// 合并后必须保持与原有测试一致。

describe('globToRegex', () => {
  // ── 简单匹配 * ──
  describe('简单匹配 *', () => {
    it('*.ts 匹配 foo.ts', () => {
      expect(globToRegex('*.ts').test('foo.ts')).toBe(true);
    });

    it('*.ts 不匹配 foo.js', () => {
      expect(globToRegex('*.ts').test('foo.js')).toBe(false);
    });

    it('* 不跨 /（单段通配）', () => {
      expect(globToRegex('*').test('foo/bar')).toBe(false);
    });

    it('* 匹配空字符串', () => {
      expect(globToRegex('*').test('')).toBe(true);
    });

    it('* 匹配单段路径', () => {
      expect(globToRegex('*').test('foo')).toBe(true);
    });
  });

  // ── 多级匹配 ** ──
  describe('多级匹配 **', () => {
    it('**/*.ts 匹配 src/foo.ts', () => {
      expect(globToRegex('**/*.ts').test('src/foo.ts')).toBe(true);
    });

    it('**/*.ts 匹配 src/nested/bar.ts', () => {
      expect(globToRegex('**/*.ts').test('src/nested/bar.ts')).toBe(true);
    });

    it('**/*.ts 匹配顶层 foo.ts', () => {
      expect(globToRegex('**/*.ts').test('foo.ts')).toBe(true);
    });

    it('**/*.ts 不匹配 foo.js', () => {
      expect(globToRegex('**/*.ts').test('foo.js')).toBe(false);
    });

    it('dist/** 匹配 dist/bundle.min.js', () => {
      expect(globToRegex('dist/**').test('dist/bundle.min.js')).toBe(true);
    });

    it('dist/** 不匹配 generated.ts', () => {
      expect(globToRegex('dist/**').test('generated.ts')).toBe(false);
    });

    it('**/test/** 匹配 src/test/foo.ts', () => {
      expect(globToRegex('**/test/**').test('src/test/foo.ts')).toBe(true);
    });

    it('**/test/** 不匹配 src/foo.ts', () => {
      expect(globToRegex('**/test/**').test('src/foo.ts')).toBe(false);
    });

    it('**/test/** 匹配 test/foo.ts（顶层 test 目录）', () => {
      expect(globToRegex('**/test/**').test('test/foo.ts')).toBe(true);
    });
  });

  // ── 单字符匹配 ? ──
  describe('单字符匹配 ?', () => {
    it('?.ts 匹配 a.ts', () => {
      expect(globToRegex('?.ts').test('a.ts')).toBe(true);
    });

    it('?.ts 不匹配 ab.ts', () => {
      expect(globToRegex('?.ts').test('ab.ts')).toBe(false);
    });

    it('? 不匹配 /', () => {
      expect(globToRegex('?').test('/')).toBe(false);
    });

    it('? 不匹配空字符串', () => {
      expect(globToRegex('?').test('')).toBe(false);
    });
  });

  // ── 大括号 {a,b} ──
  describe('大括号 {a,b}', () => {
    it('*.{ts,js} 匹配 foo.ts', () => {
      expect(globToRegex('*.{ts,js}').test('foo.ts')).toBe(true);
    });

    it('*.{ts,js} 匹配 foo.js', () => {
      expect(globToRegex('*.{ts,js}').test('foo.js')).toBe(true);
    });

    it('*.{ts,js} 不匹配 foo.py', () => {
      expect(globToRegex('*.{ts,js}').test('foo.py')).toBe(false);
    });

    it('{foo,bar}.ts 匹配 foo.ts', () => {
      expect(globToRegex('{foo,bar}.ts').test('foo.ts')).toBe(true);
    });

    it('{foo,bar}.ts 匹配 bar.ts', () => {
      expect(globToRegex('{foo,bar}.ts').test('bar.ts')).toBe(true);
    });

    it('{foo,bar}.ts 不匹配 baz.ts', () => {
      expect(globToRegex('{foo,bar}.ts').test('baz.ts')).toBe(false);
    });

    it('未闭合的 { 当作字面值处理', () => {
      expect(globToRegex('{abc').test('{abc')).toBe(true);
    });
  });

  // ── 字符类（不支持，按字面值处理） ──
  describe('字符类（不支持，按字面值处理）', () => {
    it('[abc].ts 不匹配 a.ts（[ 被当作字面字符）', () => {
      expect(globToRegex('[abc].ts').test('a.ts')).toBe(false);
    });

    it('[abc].ts 字面匹配 [abc].ts', () => {
      expect(globToRegex('[abc].ts').test('[abc].ts')).toBe(true);
    });
  });

  // ── 转义 ──
  describe('转义', () => {
    it('. 被当作字面值（不匹配任意字符）', () => {
      expect(globToRegex('foo.ts').test('foo.ts')).toBe(true);
      expect(globToRegex('foo.ts').test('fooxts')).toBe(false);
    });

    it('/ 被当作字面值', () => {
      expect(globToRegex('src/foo.ts').test('src/foo.ts')).toBe(true);
      expect(globToRegex('src/foo.ts').test('srcXfoo.ts')).toBe(false);
    });

    it('完整路径字面匹配', () => {
      expect(globToRegex('src/exact.ts').test('src/exact.ts')).toBe(true);
      expect(globToRegex('src/exact.ts').test('src/other.ts')).toBe(false);
    });

    it('正则特殊字符 ( ) | ^ $ + \\ 被转义', () => {
      // ( ) 当作字面值
      expect(globToRegex('foo(bar)').test('foo(bar)')).toBe(true);
      // | 当作字面值
      expect(globToRegex('a|b').test('a|b')).toBe(true);
      expect(globToRegex('a|b').test('a')).toBe(false);
    });
  });

  // ── 空字符串 ──
  describe('空字符串', () => {
    it('空模式只匹配空字符串', () => {
      expect(globToRegex('').test('')).toBe(true);
      expect(globToRegex('').test('foo')).toBe(false);
    });
  });

  // ── 锚定 ──
  describe('锚定', () => {
    it('正则被锚定到 ^ 和 $（不部分匹配）', () => {
      // *.ts 不应匹配 'foo.ts bar'（$ 锚定要求结尾是 .ts）
      expect(globToRegex('*.ts').test('foo.ts bar')).toBe(false);
      // *.ts 不应匹配 'foo.ts/bar'（* 不跨 /，且 $ 要求结尾）
      expect(globToRegex('*.ts').test('foo.ts/bar')).toBe(false);
    });
  });

  // ── 复杂组合（覆盖现有测试中用到的模式） ──
  describe('复杂组合', () => {
    it('**/*.test.ts 匹配任意深度的测试文件', () => {
      expect(globToRegex('**/*.test.ts').test('top-level.test.ts')).toBe(true);
      expect(globToRegex('**/*.test.ts').test('src/utils.test.ts')).toBe(true);
      expect(globToRegex('**/*.test.ts').test('packages/core/deep/nested/file.test.ts')).toBe(true);
    });

    it('**/*.min.js 匹配压缩文件', () => {
      expect(globToRegex('**/*.min.js').test('src/app.min.js')).toBe(true);
      expect(globToRegex('**/*.min.js').test('dist/vendor.min.js')).toBe(true);
      expect(globToRegex('**/*.min.js').test('app.js')).toBe(false);
    });

    it('**/*.min.css 匹配压缩样式', () => {
      expect(globToRegex('**/*.min.css').test('src/style.min.css')).toBe(true);
    });

    it('**/*.bundle.js 匹配打包文件', () => {
      expect(globToRegex('**/*.bundle.js').test('dist/vendor.bundle.js')).toBe(true);
    });

    it('**/generated.* 匹配任意扩展名的 generated 文件', () => {
      expect(globToRegex('**/generated.*').test('src/generated.ts')).toBe(true);
      expect(globToRegex('**/generated.*').test('src/generated.js')).toBe(true);
    });

    it('dist/** 与 node_modules/** 匹配子路径', () => {
      expect(globToRegex('dist/**').test('dist/bundle.js')).toBe(true);
      expect(globToRegex('node_modules/**').test('node_modules/lodash/index.js')).toBe(true);
    });
  });

  // ── 返回值类型 ──
  describe('返回值类型', () => {
    it('返回 RegExp 实例', () => {
      const re = globToRegex('*.ts');
      expect(re).toBeInstanceOf(RegExp);
    });
  });
});
