// tests/ux-improvements.test.ts — 迭代 9：用户体验优化（渐进式输出 + 初始化向导 + 误报标记）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProgressEmitter, type ProgressEvent, type ProgressPayloadMap } from '../src/progress.js';
import { generateConfig, type WizardOptions, type GeneratedConfig } from '../src/init-wizard.js';
import { FeedbackStore, markFalsePositive, shouldIgnore, type IgnoreConfig } from '../src/feedback.js';
import type { Finding } from '../src/types.js';

/**
 * 字符串感知的 JSONC 注释剥离：避免误删字符串内的 // 与 /*
 */
function stripJsonComments(text: string): string {
  let result = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      result += ch;
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        result += ch;
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      result += ch;
      continue;
    }
    if (ch === '"') {
      inString = true;
      result += ch;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      result += '\n';
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    result += ch;
  }
  return result;
}

// ==================== ProgressEmitter 渐进式输出 ====================

describe('ProgressEmitter 渐进式输出', () => {
  let emitter: ProgressEmitter;

  beforeEach(() => {
    emitter = new ProgressEmitter();
  });

  it('on 注册的事件监听器被 emit 触发', () => {
    const fn = vi.fn();
    emitter.on('start', fn);
    emitter.emit('start', { totalFiles: 10 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ totalFiles: 10 });
  });

  it('支持多个监听器同时触发', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    emitter.on('start', fn1);
    emitter.on('start', fn2);
    emitter.emit('start', { totalFiles: 5 });
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it('once 注册的监听器只触发一次', () => {
    const fn = vi.fn();
    emitter.once('start', fn);
    emitter.emit('start', { totalFiles: 1 });
    emitter.emit('start', { totalFiles: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('off 取消已注册的监听器', () => {
    const fn = vi.fn();
    emitter.on('start', fn);
    emitter.off('start', fn);
    emitter.emit('start', { totalFiles: 1 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('支持所有事件类型：start, file-start, file-complete, file-error, complete, error', () => {
    const startFn = vi.fn();
    const fileStartFn = vi.fn();
    const fileCompleteFn = vi.fn();
    const fileErrorFn = vi.fn();
    const completeFn = vi.fn();
    const errorFn = vi.fn();

    emitter.on('start', startFn);
    emitter.on('file-start', fileStartFn);
    emitter.on('file-complete', fileCompleteFn);
    emitter.on('file-error', fileErrorFn);
    emitter.on('complete', completeFn);
    emitter.on('error', errorFn);

    emitter.emit('start', { totalFiles: 2 });
    emitter.emit('file-start', { file: 'a.ts', index: 0, total: 2 });
    emitter.emit('file-complete', { file: 'a.ts', index: 0, total: 2, findings: [] });
    emitter.emit('file-error', { file: 'b.ts', index: 1, total: 2, error: new Error('boom') });
    emitter.emit('complete', { totalFiles: 2, findingsCount: 0, durationMs: 100 });
    emitter.emit('error', { error: new Error('global'), stage: 'parse' });

    expect(startFn).toHaveBeenCalledTimes(1);
    expect(fileStartFn).toHaveBeenCalledTimes(1);
    expect(fileCompleteFn).toHaveBeenCalledTimes(1);
    expect(fileErrorFn).toHaveBeenCalledTimes(1);
    expect(completeFn).toHaveBeenCalledTimes(1);
    expect(errorFn).toHaveBeenCalledTimes(1);
  });

  it('getProgress 返回当前进度百分比（0-100）', () => {
    expect(emitter.getProgress()).toBe(0);
    emitter.emit('start', { totalFiles: 4 });
    expect(emitter.getProgress()).toBe(0);
    emitter.emit('file-complete', { file: 'a.ts', index: 0, total: 4, findings: [] });
    expect(emitter.getProgress()).toBe(25);
    emitter.emit('file-complete', { file: 'b.ts', index: 1, total: 4, findings: [] });
    expect(emitter.getProgress()).toBe(50);
    emitter.emit('file-complete', { file: 'c.ts', index: 2, total: 4, findings: [] });
    expect(emitter.getProgress()).toBe(75);
    emitter.emit('file-complete', { file: 'd.ts', index: 3, total: 4, findings: [] });
    expect(emitter.getProgress()).toBe(100);
  });

  it('emit complete 事件后进度固定为 100', () => {
    emitter.emit('start', { totalFiles: 10 });
    emitter.emit('complete', { totalFiles: 10, findingsCount: 5, durationMs: 200 });
    expect(emitter.getProgress()).toBe(100);
  });

  it('file-error 也计入已处理进度', () => {
    emitter.emit('start', { totalFiles: 2 });
    emitter.emit('file-error', { file: 'a.ts', index: 0, total: 2, error: new Error('x') });
    expect(emitter.getProgress()).toBe(50);
  });

  it('未 emit start 时 getProgress 返回 0', () => {
    expect(emitter.getProgress()).toBe(0);
  });

  it('totalFiles 为 0 时 getProgress 返回 100（无文件即完成）', () => {
    emitter.emit('start', { totalFiles: 0 });
    expect(emitter.getProgress()).toBe(100);
  });

  it('listenerCount 返回指定事件监听器数量', () => {
    emitter.on('start', () => {});
    emitter.on('start', () => {});
    expect(emitter.listenerCount('start')).toBe(2);
    expect(emitter.listenerCount('complete')).toBe(0);
  });

  it('removeAllListeners 清空指定事件监听器', () => {
    emitter.on('start', () => {});
    emitter.on('start', () => {});
    emitter.removeAllListeners('start');
    expect(emitter.listenerCount('start')).toBe(0);
  });

  it('emit 未注册事件不抛错', () => {
    expect(() => emitter.emit('complete', { totalFiles: 0, findingsCount: 0, durationMs: 0 })).not.toThrow();
  });
});

// ==================== generateConfig 初始化向导 ====================

describe('generateConfig 初始化向导', () => {
  it('生成基础配置：默认语言 typescript', () => {
    const result = generateConfig({ language: 'typescript' });
    expect(result.language).toBe('typescript');
    expect(result.files['opencode.jsonc']).toBeTypeOf('string');
    expect(result.files['opencode.jsonc']).toContain('agent');
  });

  it('根据语言选择对应 agent 模型与提示', () => {
    const ts = generateConfig({ language: 'typescript' });
    const py = generateConfig({ language: 'python' });
    const go = generateConfig({ language: 'go' });
    expect(ts.files['opencode.jsonc']).toMatch(/typescript|ts/i);
    expect(py.files['opencode.jsonc']).toMatch(/python/i);
    expect(go.files['opencode.jsonc']).toMatch(/\bgo\b/i);
  });

  it('reviewStrength 影响 agent prompt 严格度', () => {
    const strict = generateConfig({ language: 'typescript', reviewStrength: 'strict' });
    const lenient = generateConfig({ language: 'typescript', reviewStrength: 'lenient' });
    expect(strict.files['opencode.jsonc']).not.toBe(lenient.files['opencode.jsonc']);
    // strict 应当包含更严格的措辞
    expect(strict.files['opencode.jsonc'].length).toBeGreaterThan(0);
  });

  it('securityReview=false 时不生成 security-reviewer agent', () => {
    const result = generateConfig({ language: 'typescript', securityReview: false });
    expect(result.files['.opencode/agents/security-reviewer.md']).toBeUndefined();
  });

  it('securityReview=true（默认）生成 security-reviewer agent', () => {
    const result = generateConfig({ language: 'typescript' });
    expect(result.files['.opencode/agents/security-reviewer.md']).toBeTypeOf('string');
    expect(result.files['.opencode/agents/security-reviewer.md']).toContain('security');
  });

  it('graphEnabled=true 生成 MCP 图谱配置', () => {
    const result = generateConfig({ language: 'typescript', graphEnabled: true });
    expect(result.files['opencode.jsonc']).toMatch(/code-review-graph|mcp/i);
  });

  it('graphEnabled=false（默认）禁用 MCP', () => {
    const result = generateConfig({ language: 'typescript', graphEnabled: false });
    expect(result.files['opencode.jsonc']).toMatch(/"enabled":\s*false|mcp/i);
  });

  it('defaultModel 自定义模型名写入 agent 配置', () => {
    const result = generateConfig({
      language: 'typescript',
      defaultModel: 'anthropic/claude-opus-4-1-20250805',
    });
    expect(result.files['opencode.jsonc']).toContain('anthropic/claude-opus-4-1-20250805');
  });

  it('deployment 影响 workflow 文件生成', () => {
    const github = generateConfig({ language: 'typescript', deployment: 'github-actions' });
    expect(github.files['.github/workflows/code-review.yml']).toBeTypeOf('string');
  });

  it('deployment=cli 时不生成 GitHub workflow', () => {
    const result = generateConfig({ language: 'typescript', deployment: 'cli' });
    expect(result.files['.github/workflows/code-review.yml']).toBeUndefined();
  });

  it('生成 review-rules 默认规则文件', () => {
    const result = generateConfig({ language: 'typescript' });
    expect(result.files['review-rules/security.json']).toBeTypeOf('string');
    expect(result.files['review-rules/quality.json']).toBeTypeOf('string');
  });

  it('生成 .opencode/commands/ 命令文件', () => {
    const result = generateConfig({ language: 'typescript' });
    expect(result.files['.opencode/commands/review.md']).toBeTypeOf('string');
    expect(result.files['.opencode/commands/security-review.md']).toBeTypeOf('string');
  });

  it('生成的 opencode.jsonc 是有效 JSONC', () => {
    const result = generateConfig({ language: 'typescript' });
    const jsonc = result.files['opencode.jsonc'];
    // 使用字符串感知的 JSONC 注释剥离（避免误删 URL 中的 //）
    const cleaned = stripJsonComments(jsonc);
    expect(() => JSON.parse(cleaned)).not.toThrow();
  });

  it('生成的 review-rules JSON 是有效 JSON', () => {
    const result = generateConfig({ language: 'typescript' });
    expect(() => JSON.parse(result.files['review-rules/security.json'])).not.toThrow();
    expect(() => JSON.parse(result.files['review-rules/quality.json'])).not.toThrow();
  });

  it('reviewStrength=standard（默认）生成中等严格度配置', () => {
    const result = generateConfig({ language: 'typescript' });
    expect(result.reviewStrength).toBe('standard');
  });

  it('返回的 GeneratedConfig 包含所有 files 字段', () => {
    const result = generateConfig({ language: 'typescript' });
    expect(Object.keys(result.files).length).toBeGreaterThanOrEqual(5);
    expect(result.language).toBe('typescript');
  });
});

// ==================== markFalsePositive 一键标记误报 ====================

describe('markFalsePositive 一键标记误报', () => {
  let store: FeedbackStore;

  beforeEach(() => {
    store = new FeedbackStore();
  });

  it('一键标记 finding 为误报（reject）', () => {
    const finding: Finding = {
      file: 'src/app.ts',
      line: 10,
      severity: 'high',
      category: 'security',
      message: 'SQL injection',
      confidence: 0.9,
      source: 'rule',
      ruleId: 'sql-injection',
    };
    const record = markFalsePositive(store, 'f1', finding, '误报：测试用例');
    expect(record.action).toBe('reject');
    expect(record.reason).toContain('误报');
    expect(record.findingId).toBe('f1');
    expect(store.getFeedbackByFinding('f1')).toHaveLength(1);
    expect(store.getFeedbackByFinding('f1')[0].action).toBe('reject');
  });

  it('不传 reason 时使用默认 reason', () => {
    const record = markFalsePositive(store, 'f1');
    expect(record.action).toBe('reject');
    expect(record.reason).toBeTypeOf('string');
    expect(record.reason!.length).toBeGreaterThan(0);
  });

  it('同时生成忽略规则配置，便于下次自动过滤', () => {
    const finding: Finding = {
      file: 'src/app.ts',
      line: 10,
      severity: 'high',
      category: 'security',
      message: 'SQL injection',
      confidence: 0.9,
      source: 'rule',
      ruleId: 'sql-injection',
    };
    const result = markFalsePositive(store, 'f1', finding);
    expect(result.ignoreRule).toBeDefined();
    expect(result.ignoreRule?.ruleId).toBe('sql-injection');
    expect(result.ignoreRule?.category).toBe('security');
  });

  it('生成 filePattern 忽略规则（按文件）', () => {
    const finding: Finding = {
      file: 'src/test/fixtures/seed.ts',
      line: 1,
      severity: 'low',
      category: 'style',
      message: 'unused var',
      confidence: 0.5,
      source: 'rule',
    };
    const result = markFalsePositive(store, 'f1', finding);
    expect(result.ignoreRule?.filePattern).toBe('src/test/fixtures/seed.ts');
  });

  it('返回的 IgnoreConfig 可用于 shouldIgnore 判定', () => {
    const finding: Finding = {
      file: 'src/app.ts',
      line: 10,
      severity: 'high',
      category: 'security',
      message: 'SQL injection',
      confidence: 0.9,
      source: 'rule',
      ruleId: 'sql-injection',
    };
    const result = markFalsePositive(store, 'f1', finding);
    const ignoreConfig: IgnoreConfig = { rules: [result.ignoreRule!] };
    // 同一 finding 应被忽略
    expect(shouldIgnore(finding, ignoreConfig)).toBe(true);
  });

  it('不传 finding 时仍可标记但忽略规则为 undefined', () => {
    const result = markFalsePositive(store, 'f1');
    expect(result.ignoreRule).toBeUndefined();
    expect(result.record ? true : false).toBe(true);
  });

  it('批量标记多条 finding 为误报', () => {
    const findings: Finding[] = [
      { file: 'a.ts', line: 1, severity: 'high', category: 'security', message: 'x', confidence: 0.9, source: 'rule', ruleId: 'r1' },
      { file: 'b.ts', line: 2, severity: 'medium', category: 'style', message: 'y', confidence: 0.7, source: 'rule', ruleId: 'r2' },
    ];
    const results = findings.map((f, i) => markFalsePositive(store, `f-${i}`, f));
    expect(results).toHaveLength(2);
    expect(store.size()).toBe(2);
    expect(results.every((r) => r.action === 'reject')).toBe(true);
  });
});
