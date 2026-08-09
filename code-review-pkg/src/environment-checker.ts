// src/environment-checker.ts — 环境检测模块
//
// 功能：
// - 检查 opencode 命令是否可用（child_process execSync 'opencode --version'）
// - 检查 Node.js 版本
// - 检查指定端口是否被占用（net.createServer 测试）
// - 返回 EnvironmentCheckResult 结构

import { execSync } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadCodeHubConfig } from './codehub-config.js';
import { loadOpencodeConfig } from './opencode-config-manager.js';

/** 端口检测结果 */
export interface PortCheck {
  port: number;
  available: boolean;
}

/** 环境检测结果 */
export interface EnvironmentCheckResult {
  ok: boolean;
  opencode: {
    installed: boolean;
    version?: string;
    error?: string;
  };
  nodejs: {
    version: string;
    supported: boolean;
  };
  ports: {
    opencode: PortCheck;
    api: PortCheck;
    web: PortCheck;
  };
  config: {
    codehubConfigured: boolean;
    opencodeConfigured: boolean;
    reviewConfigured: boolean;
  };
}

/** 检测配置选项 */
export interface CheckEnvironmentOptions {
  opencodePort?: number;
  apiPort?: number;
  webPort?: number;
  codehubConfigPath?: string;
  opencodeConfigPath?: string;
}

const DEFAULT_OPENCODE_PORT = 4096;
const DEFAULT_API_PORT = 3000;
const DEFAULT_WEB_PORT = 5173;
const MIN_NODE_VERSION = 18;

/**
 * 检查指定端口是否可用。
 * 通过尝试在该端口创建 TCP 服务器来判断是否被占用。
 */
function checkPortAvailable(port: number): Promise<PortCheck> {
  return new Promise((resolve) => {
    const server: Server = createServer();
    server.unref();
    server.on('error', () => {
      resolve({ port, available: false });
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        resolve({ port, available: true });
      });
    });
  });
}

/**
 * 检查 opencode CLI 是否可用。
 */
function checkOpencode(): { installed: boolean; version?: string; error?: string } {
  try {
    const output = execSync('opencode --version', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return {
      installed: true,
      version: output || 'unknown',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      installed: false,
      error: message.includes('ENOENT')
        ? 'opencode CLI not found in PATH'
        : message,
    };
  }
}

/**
 * 检查 Node.js 版本是否满足要求（>= 18）。
 */
function checkNodejs(): { version: string; supported: boolean } {
  const version = process.versions.node;
  const major = parseInt(version.split('.')[0], 10);
  return {
    version,
    supported: major >= MIN_NODE_VERSION,
  };
}

/**
 * 检查配置文件是否存在并配置了必要内容。
 */
function checkConfig(
  codehubConfigPath?: string,
  opencodeConfigPath?: string,
): {
  codehubConfigured: boolean;
  opencodeConfigured: boolean;
  reviewConfigured: boolean;
} {
  const codehubPath = resolve(process.cwd(), codehubConfigPath ?? '.codehub-config.json');
  const opencodePath = resolve(
    process.cwd(),
    opencodeConfigPath ?? 'opencode-config/opencode.jsonc',
  );

  let codehubConfigured = false;
  if (existsSync(codehubPath)) {
    try {
      const config = loadCodeHubConfig(codehubConfigPath);
      codehubConfigured = config.repos.length > 0 && Boolean(config.activeRepoId);
    } catch {
      codehubConfigured = false;
    }
  }

  let opencodeConfigured = false;
  if (existsSync(opencodePath)) {
    try {
      const config = loadOpencodeConfig(opencodeConfigPath);
      opencodeConfigured = Boolean(config.model && config.model.trim());
    } catch {
      opencodeConfigured = false;
    }
  }

  let reviewConfigured = false;
  if (existsSync(codehubPath)) {
    try {
      const config = loadCodeHubConfig(codehubConfigPath);
      reviewConfigured = Boolean(config.reviewConfig);
    } catch {
      reviewConfigured = false;
    }
  }

  return {
    codehubConfigured,
    opencodeConfigured,
    reviewConfigured,
  };
}

/**
 * 执行完整的环境检测。
 *
 * 检测项：
 * - opencode CLI 是否安装
 * - Node.js 版本是否 >= 18
 * - opencode / api / web 端口是否可用
 * - CodeHub / opencode / 审查参数配置是否存在
 */
export async function checkEnvironment(
  options: CheckEnvironmentOptions = {},
): Promise<EnvironmentCheckResult> {
  const opencodePort = options.opencodePort ?? DEFAULT_OPENCODE_PORT;
  const apiPort = options.apiPort ?? DEFAULT_API_PORT;
  const webPort = options.webPort ?? DEFAULT_WEB_PORT;

  const opencodeResult = checkOpencode();
  const nodejsResult = checkNodejs();

  const [opencodePortResult, apiPortResult, webPortResult] = await Promise.all([
    checkPortAvailable(opencodePort),
    checkPortAvailable(apiPort),
    checkPortAvailable(webPort),
  ]);

  const configResult = checkConfig(options.codehubConfigPath, options.opencodeConfigPath);

  const ok =
    opencodeResult.installed &&
    nodejsResult.supported &&
    opencodePortResult.available &&
    apiPortResult.available &&
    webPortResult.available;

  return {
    ok,
    opencode: opencodeResult,
    nodejs: nodejsResult,
    ports: {
      opencode: opencodePortResult,
      api: apiPortResult,
      web: webPortResult,
    },
    config: configResult,
  };
}