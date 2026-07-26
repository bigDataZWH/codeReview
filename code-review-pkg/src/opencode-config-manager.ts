// src/opencode-config-manager.ts — opencode.jsonc 配置文件读写
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** opencode 配置中的单个 agent 定义 */
export interface OpencodeAgent {
  description: string;
  prompt: string;
  tools?: Record<string, boolean>;
  /** agent 可单独声明 model 覆盖顶层配置 */
  model?: string;
}

/** opencode 配置中的单个 MCP 定义 */
export interface OpencodeMcpEntry {
  type: string;
  command: string[];
  enabled: boolean;
}

/** opencode.jsonc 结构化配置（接口使用 agents 复数；文件中字段名为 agent 单数） */
export interface OpencodeConfig {
  /** JSON Schema 引用，写入时保留 */
  $schema?: string;
  model: string;
  agents: Record<string, OpencodeAgent>;
  mcp: Record<string, OpencodeMcpEntry>;
}

/** 默认配置文件路径（相对于 process.cwd()） */
export const DEFAULT_OPENCODE_CONFIG_PATH = 'opencode-config/opencode.jsonc';

/** 默认配置：文件不存在时返回 */
function createDefaultConfig(): OpencodeConfig {
  return {
    $schema: 'https://opencode.ai/config.json',
    model: '',
    agents: {},
    mcp: {},
  };
}

/**
 * strip JSONC 注释：
 * - 块注释 `/* ... *\/`
 * - 行注释 `//...`
 *
 * 逐字符扫描，正确跟踪字符串字面量状态：
 * 字符串内的 `//` 或 `/*` 不被当作注释处理（例如 URL 中的 `//`）。
 */
function stripJsonComments(content: string): string {
  let result = '';
  let i = 0;
  const len = content.length;
  let inString = false;

  while (i < len) {
    const ch = content[i];
    const next = i + 1 < len ? content[i + 1] : '';

    if (inString) {
      // 字符串状态内：保留所有字符，处理转义序列
      if (ch === '\\') {
        // 转义字符：连同下一字符一起原样保留
        result += ch;
        if (i + 1 < len) {
          result += content[i + 1];
          i += 2;
          continue;
        }
        i++;
        continue;
      }
      if (ch === '"') {
        // 非转义的 " 表示字符串结束
        inString = false;
        result += ch;
        i++;
        continue;
      }
      result += ch;
      i++;
      continue;
    }

    // 非字符串状态
    if (ch === '"') {
      inString = true;
      result += ch;
      i++;
      continue;
    }

    // 行注释 //：从 // 到行尾移除（保留换行符）
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < len && content[i] !== '\n' && content[i] !== '\r') {
        i++;
      }
      continue;
    }

    // 块注释 /* ... */：移除（保留其中的换行符以维持行号）
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < len && !(content[i] === '*' && i + 1 < len && content[i + 1] === '/')) {
        if (content[i] === '\n' || content[i] === '\r') {
          result += content[i];
        }
        i++;
      }
      // 跳过结束标记 */
      if (i < len) {
        i += 2;
      }
      continue;
    }

    result += ch;
    i++;
  }

  return result;
}

/**
 * 读取并解析 opencode.jsonc 配置文件。
 *
 * @param configPath 可选，默认使用 DEFAULT_OPENCODE_CONFIG_PATH（相对于 process.cwd()）
 * @returns 结构化配置；文件不存在时返回默认配置
 */
export function loadOpencodeConfig(configPath?: string): OpencodeConfig {
  const filePath = resolve(process.cwd(), configPath ?? DEFAULT_OPENCODE_CONFIG_PATH);

  if (!existsSync(filePath)) {
    return createDefaultConfig();
  }

  const raw = readFileSync(filePath, 'utf8');
  const stripped = stripJsonComments(raw);
  const trimmed = stripped.trim();

  if (!trimmed) {
    return createDefaultConfig();
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `Failed to parse opencode config at ${filePath}: ${(err as Error).message}`,
    );
  }

  const config = createDefaultConfig();

  if (typeof parsed.$schema === 'string') {
    config.$schema = parsed.$schema;
  }

  if (typeof parsed.model === 'string') {
    config.model = parsed.model;
  }

  // 文件中字段名为 "agent"（单数），映射为接口的 "agents"（复数）
  const agentRaw = parsed.agent;
  if (agentRaw && typeof agentRaw === 'object') {
    for (const [name, def] of Object.entries(agentRaw as Record<string, unknown>)) {
      if (def && typeof def === 'object') {
        const d = def as Record<string, unknown>;
        const agent: OpencodeAgent = {
          description: typeof d.description === 'string' ? d.description : '',
          prompt: typeof d.prompt === 'string' ? d.prompt : '',
        };
        if (d.tools && typeof d.tools === 'object') {
          agent.tools = d.tools as Record<string, boolean>;
        }
        if (typeof d.model === 'string') {
          agent.model = d.model;
        }
        config.agents[name] = agent;
      }
    }
  }

  const mcpRaw = parsed.mcp;
  if (mcpRaw && typeof mcpRaw === 'object') {
    for (const [name, def] of Object.entries(mcpRaw as Record<string, unknown>)) {
      if (def && typeof def === 'object') {
        const d = def as Record<string, unknown>;
        config.mcp[name] = {
          type: typeof d.type === 'string' ? d.type : 'local',
          command: Array.isArray(d.command)
            ? (d.command as unknown[]).map((c) => String(c))
            : [],
          enabled: typeof d.enabled === 'boolean' ? d.enabled : false,
        };
      }
    }
  }

  return config;
}

/**
 * 将配置写回文件（标准 JSON，2 空格缩进，不保留注释）。
 *
 * @param config 结构化配置
 * @param configPath 可选，默认使用 DEFAULT_OPENCODE_CONFIG_PATH（相对于 process.cwd()）
 */
export function saveOpencodeConfig(config: OpencodeConfig, configPath?: string): void {
  const filePath = resolve(process.cwd(), configPath ?? DEFAULT_OPENCODE_CONFIG_PATH);

  // 接口的 "agents"（复数）映射回文件中的 "agent"（单数）
  const output: Record<string, unknown> = {};

  if (config.$schema) {
    output.$schema = config.$schema;
  }

  output.model = config.model;
  output.agent = config.agents;
  output.mcp = config.mcp;

  const json = JSON.stringify(output, null, 2);
  writeFileSync(filePath, json, 'utf8');
}
