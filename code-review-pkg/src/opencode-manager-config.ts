// src/opencode-manager-config.ts — opencode manager 配置文件读写
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

/** opencode manager 配置结构 */
export interface OpencodeManagerConfig {
  startCommand: string;
  workDir: string;
}

/** 默认配置文件路径（相对于 process.cwd()） */
export const DEFAULT_OPENCODE_MANAGER_CONFIG_PATH = '.opencode-manager.json';

/**
 * 创建默认配置对象。
 *
 * @returns 默认配置
 */
export function createDefaultOpencodeManagerConfig(): OpencodeManagerConfig {
  return {
    startCommand: 'opencode serve --hostname {hostname} --port {port}',
    workDir: './',
  };
}

/**
 * 读取并解析 opencode manager 配置文件。
 *
 * @param configPath 可选，默认使用 DEFAULT_OPENCODE_MANAGER_CONFIG_PATH（相对于 process.cwd()）
 * @returns 结构化配置；文件不存在或解析失败时返回默认配置
 */
export function loadOpencodeManagerConfig(configPath?: string): OpencodeManagerConfig {
  const filePath = resolve(process.cwd(), configPath ?? DEFAULT_OPENCODE_MANAGER_CONFIG_PATH);

  if (!existsSync(filePath)) {
    return createDefaultOpencodeManagerConfig();
  }

  let parsed: Record<string, unknown>;
  try {
    const raw = readFileSync(filePath, 'utf8');
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(
      `Failed to parse opencode manager config at ${filePath}, using default: ${(err as Error).message}`,
    );
    return createDefaultOpencodeManagerConfig();
  }

  const config = createDefaultOpencodeManagerConfig();

  if (typeof parsed.startCommand === 'string') {
    config.startCommand = parsed.startCommand;
  }

  if (typeof parsed.workDir === 'string') {
    config.workDir = parsed.workDir;
  }

  return config;
}

/**
 * 将配置写回文件（标准 JSON，2 空格缩进）。
 *
 * @param config 结构化配置
 * @param configPath 可选，默认使用 DEFAULT_OPENCODE_MANAGER_CONFIG_PATH（相对于 process.cwd()）
 * @returns 传入的 config 对象
 */
export function saveOpencodeManagerConfig(
  config: OpencodeManagerConfig,
  configPath?: string,
): OpencodeManagerConfig {
  const filePath = resolve(process.cwd(), configPath ?? DEFAULT_OPENCODE_MANAGER_CONFIG_PATH);
  const dir = dirname(filePath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const json = JSON.stringify(config, null, 2);
  writeFileSync(filePath, json, 'utf8');

  return config;
}
