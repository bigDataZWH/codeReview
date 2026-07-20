import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = process.cwd();

interface NpmPackFile {
  path: string;
  size: number;
  mode: number;
}

interface NpmPackResult {
  id: string;
  name: string;
  version: string;
  files: NpmPackFile[];
}

function runNpmPackDryRun(): string[] {
  const stdout = execSync('npm pack --dry-run --json', {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf-8',
  });
  // npm pack --json 只输出 JSON 到 stdout；如有 warning 也会在 stderr
  const result = JSON.parse(stdout) as NpmPackResult[];
  return result[0].files.map((f) => f.path);
}

describe('npm pack contents (npm publish readiness)', () => {
  let packedPaths: string[];

  beforeAll(() => {
    // 先构建确保 dist 存在；npm pack 依赖 dist 内容
    execSync('npm run build', { cwd: projectRoot, stdio: 'pipe' });
    packedPaths = runNpmPackDryRun();
  }, 120_000);

  it('includes dist/cli.js', () => {
    expect(packedPaths).toContain('dist/cli.js');
  });

  it('includes dist/index.js', () => {
    expect(packedPaths).toContain('dist/index.js');
  });

  it('includes dist/index.d.ts', () => {
    expect(packedPaths).toContain('dist/index.d.ts');
  });

  it('includes README.md', () => {
    expect(packedPaths).toContain('README.md');
  });

  it('includes review-rules/ prefix when review-rules directory exists', () => {
    const reviewRulesDir = join(projectRoot, 'review-rules');
    if (!existsSync(reviewRulesDir)) {
      // 如果目录不存在跳过断言（任务规范允许）
      expect(true).toBe(true);
      return;
    }
    const hasReviewRules = packedPaths.some((p) => p.startsWith('review-rules/'));
    expect(hasReviewRules).toBe(true);
  });

  it('includes opencode-config/ prefix when opencode-config directory exists', () => {
    const opencodeDir = join(projectRoot, 'opencode-config');
    if (!existsSync(opencodeDir)) {
      expect(true).toBe(true);
      return;
    }
    const hasOpencode = packedPaths.some((p) => p.startsWith('opencode-config/'));
    expect(hasOpencode).toBe(true);
  });

  it('does NOT include any src/ paths', () => {
    const srcPaths = packedPaths.filter((p) => p.startsWith('src/'));
    expect(srcPaths).toEqual([]);
  });

  it('does NOT include any tests/ paths', () => {
    const testPaths = packedPaths.filter((p) => p.startsWith('tests/'));
    expect(testPaths).toEqual([]);
  });

  it('does NOT include any node_modules/ paths', () => {
    const nmPaths = packedPaths.filter((p) => p.startsWith('node_modules/'));
    expect(nmPaths).toEqual([]);
  });
});
