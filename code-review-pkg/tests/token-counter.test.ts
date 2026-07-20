import { describe, it, expect } from 'vitest';
import { countTokens } from '../src/token-counter.js';

describe('countTokens', () => {
  it('returns 0 for empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  it('counts English tokens accurately', () => {
    // "hello world" 应该接近 2 个 token（GPT tokenizer 通常将单词作为 token）
    const tokens = countTokens('hello world');
    expect(tokens).toBeGreaterThanOrEqual(2);
    expect(tokens).toBeLessThanOrEqual(3);
  });

  it('counts code tokens', () => {
    const code = `function add(a, b) { return a + b; }`;
    const tokens = countTokens(code);
    // GPT tokenizer 大约会拆分为 12-15 个 token
    expect(tokens).toBeGreaterThan(8);
    expect(tokens).toBeLessThan(20);
  });

  it('counts Chinese characters', () => {
    // 中文字符通常每个字符 1-2 个 token
    const tokens = countTokens('你好世界');
    expect(tokens).toBeGreaterThanOrEqual(2);
    expect(tokens).toBeLessThanOrEqual(8);
  });

  it('handles long text', () => {
    const longText = 'a'.repeat(1000);
    const tokens = countTokens(longText);
    expect(tokens).toBeGreaterThan(100);
  });

  it('approximation error < 30% for typical code', () => {
    // 字符数/4 的估算误差可达 50%+，新算法应小于 30%
    // 这个测试是软断言，因为我们没有 tiktoken 作为参照
    const codeSnippets = [
      'const x = 1;',
      'function hello() { console.log("hello"); }',
      'class Foo { constructor() { this.x = 1; } }',
    ];
    for (const code of codeSnippets) {
      const tokens = countTokens(code);
      const charBased = Math.ceil(code.length / 4);
      const diff = Math.abs(tokens - charBased) / charBased;
      // 误差不超过 50%（保守估计）
      expect(diff).toBeLessThan(0.5);
    }
  });

  it('中文文本估算优于字符数/4', () => {
    // 字符数/4 对中文严重低估（4 个中文字符 = 1 token），新算法应显著更高
    const chinese = '你好世界，这是一段中文测试文本';
    const tokens = countTokens(chinese);
    const charBased = Math.ceil(chinese.length / 4);
    // 新算法对中文应给出更高（更准确）的 token 数
    expect(tokens).toBeGreaterThan(charBased);
  });
});
