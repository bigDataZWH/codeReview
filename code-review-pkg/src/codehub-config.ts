import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { CodeHubConfig } from './types.js';

export const DEFAULT_CONFIG_FILE = '.codehub-config.json';

export interface CodeHubFullConfig {
  baseUrl: string;
  token: string;
  projectId: string;
  repoBaseDir: string;
  reviewConfig?: {
    defaultStrength?: 'lenient' | 'standard' | 'strict';
    securityReview?: boolean;
    defaultLanguage?: string;
  };
}

const DEFAULT_CONFIG: Partial<CodeHubFullConfig> = {
  repoBaseDir: '.codehub-repos',
  reviewConfig: {
    defaultStrength: 'standard',
    securityReview: true,
  },
};

export function loadCodeHubConfig(
  configPath: string = DEFAULT_CONFIG_FILE,
): CodeHubFullConfig {
  const absPath = resolve(process.cwd(), configPath);

  const envConfig: Partial<CodeHubFullConfig> = {};
  if (process.env.CODEHUB_URL) {
    envConfig.baseUrl = process.env.CODEHUB_URL;
  }
  if (process.env.CODEHUB_TOKEN) {
    envConfig.token = process.env.CODEHUB_TOKEN;
  }
  if (process.env.CODEHUB_PROJECT_ID) {
    envConfig.projectId = process.env.CODEHUB_PROJECT_ID;
  }
  if (process.env.CODEHUB_REPO_DIR) {
    envConfig.repoBaseDir = process.env.CODEHUB_REPO_DIR;
  }

  let fileConfig: Partial<CodeHubFullConfig> = {};
  if (existsSync(absPath)) {
    try {
      const content = readFileSync(absPath, 'utf-8');
      fileConfig = JSON.parse(content) as Partial<CodeHubFullConfig>;
    } catch (err) {
      console.warn(`[codehub-config] Failed to parse config file: ${absPath}`, err);
    }
  }

  const merged: CodeHubFullConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...envConfig,
    reviewConfig: {
      ...DEFAULT_CONFIG.reviewConfig,
      ...fileConfig.reviewConfig,
      ...envConfig.reviewConfig,
    },
  } as CodeHubFullConfig;

  return merged;
}

export function saveCodeHubConfig(
  config: Partial<CodeHubFullConfig>,
  configPath: string = DEFAULT_CONFIG_FILE,
): CodeHubFullConfig {
  const absPath = resolve(process.cwd(), configPath);
  const dir = dirname(absPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const existing = existsSync(absPath)
    ? (JSON.parse(readFileSync(absPath, 'utf-8')) as Partial<CodeHubFullConfig>)
    : {};

  const merged: CodeHubFullConfig = {
    ...existing,
    ...config,
    reviewConfig: {
      ...existing.reviewConfig,
      ...config.reviewConfig,
    },
  } as CodeHubFullConfig;

  writeFileSync(absPath, JSON.stringify(merged, null, 2), 'utf-8');

  return merged;
}

export function getCodeHubConfig(config?: Partial<CodeHubConfig>): CodeHubConfig {
  const merged = loadCodeHubConfig();
  const finalConfig = { ...merged, ...config };

  return {
    baseUrl: finalConfig.baseUrl ?? '',
    token: finalConfig.token ?? '',
    projectId: finalConfig.projectId ?? '',
  };
}

export function isCodeHubConfigValid(config: Partial<CodeHubConfig> | undefined | null): boolean {
  if (!config) return false;
  return Boolean(config.baseUrl && config.token && config.projectId);
}

export function maskToken(token: string): string {
  if (!token || token.length <= 8) {
    return '****';
  }
  return `${token.slice(0, 4)}****${token.slice(-4)}`;
}
