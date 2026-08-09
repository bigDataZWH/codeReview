import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateCommandSafety,
  replaceCommandVars,
  parseCommandToArgv,
  copyConfigFilesToWorkDir,
} from '../../src/opencode-process-manager.js';

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'opencode-pm-fns-test-'));
});

afterAll(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('validateCommandSafety', () => {
  it('安全命令通过', () => {
    expect(() => validateCommandSafety('opencode serve --port 4096')).not.toThrow();
    expect(() => validateCommandSafety('node -e "console.log(1)"')).not.toThrow();
  });

  it('包含 && 被拒绝', () => {
    expect(() => validateCommandSafety('a && b')).toThrow(/Unsafe command/);
  });

  it('包含 ; 被拒绝', () => {
    expect(() => validateCommandSafety('a; b')).toThrow(/Unsafe command/);
  });

  it('包含 | 被拒绝', () => {
    expect(() => validateCommandSafety('a | b')).toThrow(/Unsafe command/);
  });

  it('包含 $() 被拒绝', () => {
    expect(() => validateCommandSafety('echo $(whoami)')).toThrow(/Unsafe command/);
  });

  it('包含反引号被拒绝', () => {
    expect(() => validateCommandSafety('echo `whoami`')).toThrow(/Unsafe command/);
  });

  it('包含 > 被拒绝', () => {
    expect(() => validateCommandSafety('echo x > file')).toThrow(/Unsafe command/);
  });
});

describe('replaceCommandVars', () => {
  it('替换 {hostname} 和 {port}', () => {
    const result = replaceCommandVars('opencode serve --hostname {hostname} --port {port}', '127.0.0.1', 4096);
    expect(result).toBe('opencode serve --hostname 127.0.0.1 --port 4096');
  });

  it('不含占位符时原样返回', () => {
    const result = replaceCommandVars('opencode serve', '127.0.0.1', 4096);
    expect(result).toBe('opencode serve');
  });

  it('null/undefined 返回空串', () => {
    expect(replaceCommandVars(null, '127.0.0.1', 4096)).toBe('');
    expect(replaceCommandVars(undefined, '127.0.0.1', 4096)).toBe('');
  });

  it('多次出现占位符全部替换', () => {
    const result = replaceCommandVars('{hostname}:{port} {hostname}', '0.0.0.0', 8080);
    expect(result).toBe('0.0.0.0:8080 0.0.0.0');
  });
});

describe('parseCommandToArgv', () => {
  it('简单命令解析', () => {
    expect(parseCommandToArgv('node script.js')).toEqual(['node', 'script.js']);
  });

  it('双引号内容保留为整体', () => {
    expect(parseCommandToArgv('node -e "console.log(1)"')).toEqual(['node', '-e', 'console.log(1)']);
  });

  it('空字符串返回空数组', () => {
    expect(parseCommandToArgv('')).toEqual([]);
  });

  it('多个空格正确处理', () => {
    expect(parseCommandToArgv('a   b   c')).toEqual(['a', 'b', 'c']);
  });
});

describe('copyConfigFilesToWorkDir', () => {
  it('创建目标目录并拷贝存在的文件', () => {
    // 准备源文件
    const srcDir = join(tmpDir, 'src1');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'opencode.jsonc'), '{"model":"test"}', 'utf8');
    writeFileSync(join(srcDir, '.codehub-config.json'), '{"repos":[]}', 'utf8');

    const workDir = join(tmpDir, 'workdir1');
    const count = copyConfigFilesToWorkDir(workDir, join(srcDir, 'opencode.jsonc'), join(srcDir, '.codehub-config.json'));

    expect(count).toBeGreaterThanOrEqual(2);
    expect(existsSync(join(workDir, 'opencode.jsonc'))).toBe(true);
    expect(existsSync(join(workDir, '.codehub-config.json'))).toBe(true);
  });

  it('源文件不存在时不报错只跳过', () => {
    const workDir = join(tmpDir, 'workdir2');
    // 注意：copyConfigFilesToWorkDir 还会扫描 process.cwd()/opencode-config 目录
    // 因此 count 可能 >= 0（取决于 cwd 下是否存在 opencode-config 目录）
    const count = copyConfigFilesToWorkDir(workDir, join(tmpDir, 'nonexistent.jsonc'), join(tmpDir, 'nonexistent-config.json'));
    expect(count).toBeGreaterThanOrEqual(0);
    expect(existsSync(workDir)).toBe(true);
  });
});
