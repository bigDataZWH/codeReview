import { describe, it, expect } from 'vitest';
import { generateConfig } from '../../src/init-wizard.js';
import { LARGE_PR_THRESHOLD } from '../../src/constants.js';
import type { ProjectLanguage } from '../../src/init-wizard.js';

describe('MCP code-review-graph 动态启用', () => {
  const language: ProjectLanguage = 'typescript';

  it('小 PR（文件数 < LARGE_PR_THRESHOLD）时 MCP 默认禁用', () => {
    const config = generateConfig({ language });
    const opencodeJsonc = config.files['opencode.jsonc'];
    expect(opencodeJsonc).toContain('"enabled": false');
  });

  it('大 PR（文件数 >= LARGE_PR_THRESHOLD）时 MCP 自动启用', () => {
    const config = generateConfig({ 
      language,
      diffFileCount: LARGE_PR_THRESHOLD,
    });
    const opencodeJsonc = config.files['opencode.jsonc'];
    expect(opencodeJsonc).toContain('"enabled": true');
  });

  it('超大 PR（文件数 >> LARGE_PR_THRESHOLD）时 MCP 自动启用', () => {
    const config = generateConfig({ 
      language,
      diffFileCount: 100,
    });
    const opencodeJsonc = config.files['opencode.jsonc'];
    expect(opencodeJsonc).toContain('"enabled": true');
  });

  it('小 PR（文件数 = LARGE_PR_THRESHOLD - 1）时 MCP 默认禁用', () => {
    const config = generateConfig({ 
      language,
      diffFileCount: LARGE_PR_THRESHOLD - 1,
    });
    const opencodeJsonc = config.files['opencode.jsonc'];
    expect(opencodeJsonc).toContain('"enabled": false');
  });

  it('LARGE_PR_THRESHOLD 常量值为 30', () => {
    expect(LARGE_PR_THRESHOLD).toBe(30);
  });

  it('graphEnabled 显式设为 false 时始终禁用（即使是大 PR）', () => {
    const config = generateConfig({ 
      language,
      diffFileCount: 100,
      graphEnabled: false,
    });
    const opencodeJsonc = config.files['opencode.jsonc'];
    expect(opencodeJsonc).toContain('"enabled": false');
  });

  it('graphEnabled 显式设为 true 时始终启用（即使是小 PR）', () => {
    const config = generateConfig({ 
      language,
      diffFileCount: 5,
      graphEnabled: true,
    });
    const opencodeJsonc = config.files['opencode.jsonc'];
    expect(opencodeJsonc).toContain('"enabled": true');
  });

  it('生成的 opencode.jsonc 包含 code-review-graph MCP 配置', () => {
    const config = generateConfig({ language });
    const opencodeJsonc = config.files['opencode.jsonc'];
    expect(opencodeJsonc).toContain('"code-review-graph"');
    expect(opencodeJsonc).toContain('"type": "local"');
    expect(opencodeJsonc).toContain('"command": ["code-review-graph", "serve"]');
  });
});