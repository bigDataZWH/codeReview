import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workflowsDir = join(process.cwd(), '.github', 'workflows');

function readWorkflow(name: string): string {
  return readFileSync(join(workflowsDir, name), 'utf-8');
}

describe('CI workflow (.github/workflows/ci.yml)', () => {
  const content = readWorkflow('ci.yml');

  it('defines a name field', () => {
    expect(content).toMatch(/^name:\s*CI/m);
  });

  it('triggers on push to main/master branches', () => {
    expect(content).toMatch(/on:\s*\n\s*push:\s*\n\s*branches:\s*\[main,\s*master\]/);
  });

  it('triggers on pull_request to main/master branches', () => {
    expect(content).toMatch(/pull_request:\s*\n\s*branches:\s*\[main,\s*master\]/);
  });

  it('uses a node matrix with versions 18, 20, 22', () => {
    expect(content).toContain('node: [18, 20, 22]');
  });

  it('disables fail-fast in the matrix strategy', () => {
    expect(content).toContain('fail-fast: false');
  });

  it('runs on ubuntu-latest', () => {
    expect(content).toContain('runs-on: ubuntu-latest');
  });

  it('uses actions/checkout@v4', () => {
    expect(content).toContain('actions/checkout@v4');
  });

  it('uses actions/setup-node@v4 with cache npm', () => {
    expect(content).toContain('actions/setup-node@v4');
    expect(content).toContain("cache: 'npm'");
  });

  it('installs dependencies via npm ci', () => {
    expect(content).toContain('npm ci');
  });

  it('runs the lint step', () => {
    expect(content).toContain('npm run lint');
  });

  it('runs tests with coverage', () => {
    expect(content).toContain('npm run test -- --coverage');
  });

  it('runs the build step', () => {
    expect(content).toContain('npm run build');
  });

  it('uploads coverage to Codecov via codecov-action', () => {
    expect(content).toContain('codecov/codecov-action');
  });

  it('uses spaces for indentation, not tabs', () => {
    expect(content).not.toMatch(/\t/);
  });
});

describe('Release workflow (.github/workflows/release.yml)', () => {
  const content = readWorkflow('release.yml');

  it('defines a name field', () => {
    expect(content).toMatch(/^name:\s*Release/m);
  });

  it('triggers on push of version tags', () => {
    expect(content).toMatch(/on:\s*\n\s*push:\s*\n\s*tags:/);
    expect(content).toContain('v*.*.*');
  });

  it('runs on ubuntu-latest', () => {
    expect(content).toContain('runs-on: ubuntu-latest');
  });

  it('declares id-token: write permission for provenance', () => {
    expect(content).toContain('id-token: write');
  });

  it('uses actions/checkout@v4', () => {
    expect(content).toContain('actions/checkout@v4');
  });

  it('uses actions/setup-node@v4 with node 20 and registry url', () => {
    expect(content).toContain('actions/setup-node@v4');
    expect(content).toContain('node-version: 20');
    expect(content).toContain('registry-url:');
    expect(content).toContain('registry.npmjs.org');
  });

  it('installs dependencies via npm ci', () => {
    expect(content).toContain('npm ci');
  });

  it('runs the build step before publish', () => {
    expect(content).toContain('npm run build');
  });

  it('publishes to npm', () => {
    expect(content).toContain('npm publish');
  });

  it('uses provenance flag when publishing', () => {
    expect(content).toContain('--provenance');
  });

  it('sets NODE_AUTH_TOKEN from NPM_TOKEN secret', () => {
    expect(content).toContain('NODE_AUTH_TOKEN');
    expect(content).toContain('secrets.NPM_TOKEN');
  });

  it('uses spaces for indentation, not tabs', () => {
    expect(content).not.toMatch(/\t/);
  });
});
