import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadOpencodeManagerConfig,
  saveOpencodeManagerConfig,
  createDefaultOpencodeManagerConfig,
  type OpencodeManagerConfig,
} from '../../src/opencode-manager-config.js';

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'opencode-mgr-config-test-'));
});

afterAll(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('opencode-manager-config', () => {
  it('createDefaultOpencodeManagerConfig 返回默认值', () => {
    const config = createDefaultOpencodeManagerConfig();
    expect(config.startCommand).toBe('opencode serve --hostname {hostname} --port {port}');
    expect(config.workDir).toBe('./');
  });

  it('loadOpencodeManagerConfig 文件不存在时返回默认值', () => {
    const config = loadOpencodeManagerConfig(join(tmpDir, 'nonexistent.json'));
    expect(config.startCommand).toBe('opencode serve --hostname {hostname} --port {port}');
    expect(config.workDir).toBe('./');
  });

  it('saveOpencodeManagerConfig 写入后读取值一致', () => {
    const configPath = join(tmpDir, 'test-save.json');
    const config: OpencodeManagerConfig = {
      startCommand: 'my-opencode --port {port}',
      workDir: './my-workspace',
    };
    saveOpencodeManagerConfig(config, configPath);
    const loaded = loadOpencodeManagerConfig(configPath);
    expect(loaded).toEqual(config);
  });

  it('saveOpencodeManagerConfig 自动创建不存在的目录', () => {
    const nestedPath = join(tmpDir, 'nested', 'dir', 'config.json');
    const config: OpencodeManagerConfig = {
      startCommand: 'test',
      workDir: './test',
    };
    saveOpencodeManagerConfig(config, nestedPath);
    expect(existsSync(nestedPath)).toBe(true);
    const loaded = loadOpencodeManagerConfig(nestedPath);
    expect(loaded).toEqual(config);
  });

  it('loadOpencodeManagerConfig 解析失败时返回默认值', () => {
    const configPath = join(tmpDir, 'invalid.json');
    writeFileSync(configPath, '{ invalid json }', 'utf8');
    const config = loadOpencodeManagerConfig(configPath);
    expect(config.startCommand).toBe('opencode serve --hostname {hostname} --port {port}');
    expect(config.workDir).toBe('./');
  });

  it('loadOpencodeManagerConfig 部分字段缺失时补默认值', () => {
    const configPath = join(tmpDir, 'partial.json');
    writeFileSync(configPath, JSON.stringify({ startCommand: 'custom-cmd' }), 'utf8');
    const config = loadOpencodeManagerConfig(configPath);
    expect(config.startCommand).toBe('custom-cmd');
    expect(config.workDir).toBe('./');
  });
});
