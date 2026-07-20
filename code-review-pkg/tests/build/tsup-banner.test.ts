import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const projectRoot = process.cwd();
const distDir = join(projectRoot, 'dist');

function readFirstLine(filePath: string): string {
  const content = readFileSync(filePath, 'utf-8');
  const newlineIdx = content.indexOf('\n');
  return newlineIdx === -1 ? content : content.slice(0, newlineIdx);
}

describe('tsup banner injection (dist artifacts)', () => {
  beforeAll(() => {
    // 重新构建以确保 dist 反映最新 tsup.config.ts
    execSync('npm run build', { cwd: projectRoot, stdio: 'pipe' });
  }, 120_000);

  it('dist/cli.js exists', () => {
    expect(existsSync(join(distDir, 'cli.js'))).toBe(true);
  });

  it('dist/index.js exists', () => {
    expect(existsSync(join(distDir, 'index.js'))).toBe(true);
  });

  it('dist/cli.js first line starts with node shebang', () => {
    const firstLine = readFirstLine(join(distDir, 'cli.js'));
    expect(firstLine.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('dist/index.js first line does NOT start with node shebang', () => {
    const firstLine = readFirstLine(join(distDir, 'index.js'));
    expect(firstLine.startsWith('#!/usr/bin/env node')).toBe(false);
  });
});
