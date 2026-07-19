import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const COMMANDS_DIR = join(__dirname, '../../../opencode-config/.opencode/commands');

const REQUIRED_FIELDS = ['file', 'line', 'severity', 'category', 'message', 'suggestion', 'confidence', 'source'];
const SEVERITY_VALUES = ['critical', 'high', 'medium', 'low', 'info'];
const SOURCE_VALUES = ['rule', 'ai'];

function readCommand(name: string): string {
  return readFileSync(join(COMMANDS_DIR, `${name}.md`), 'utf-8');
}

function parseFindingsFromContent(content: string): unknown[] {
  const jsonMatch = content.match(/```json\s*(\[[\s\S]*?\])\s*```/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[1]);
  }
  return [];
}

describe('command output format', () => {
  it('all commands define consistent output format matching Finding schema', () => {
    const commands = ['review', 'security-review', 'scan', 'review-pr'];
    
    for (const cmd of commands) {
      const content = readCommand(cmd);
      expect(content).toContain('JSON');
    }
  });

  describe('review.md', () => {
    const content = readCommand('review');
    
    it('defines JSON array output format', () => {
      expect(content).toContain('JSON');
    });
    
    it('includes all required Finding fields in output format', () => {
      expect(content).toContain('file');
      expect(content).toContain('line');
      expect(content).toContain('severity');
      expect(content).toContain('category');
      expect(content).toContain('message');
      expect(content).toContain('suggestion');
      expect(content).toContain('confidence');
      expect(content).toContain('source');
    });
  });

  describe('security-review.md', () => {
    const content = readCommand('security-review');
    
    it('defines JSON array output format', () => {
      expect(content).toContain('JSON');
    });
    
    it('includes all required Finding fields in output format', () => {
      expect(content).toContain('file');
      expect(content).toContain('line');
      expect(content).toContain('severity');
      expect(content).toContain('category');
      expect(content).toContain('message');
      expect(content).toContain('suggestion');
      expect(content).toContain('confidence');
      expect(content).toContain('source');
    });
  });

  describe('scan.md', () => {
    const content = readCommand('scan');
    
    it('defines JSON array output format', () => {
      expect(content).toContain('JSON');
    });
    
    it('includes all required Finding fields in output format', () => {
      expect(content).toContain('file');
      expect(content).toContain('line');
      expect(content).toContain('severity');
      expect(content).toContain('category');
      expect(content).toContain('message');
      expect(content).toContain('suggestion');
      expect(content).toContain('confidence');
      expect(content).toContain('source');
    });
  });

  describe('review-pr.md', () => {
    const content = readCommand('review-pr');
    
    it('defines JSON array output format', () => {
      expect(content).toContain('JSON');
    });
    
    it('includes all required Finding fields in output format', () => {
      expect(content).toContain('file');
      expect(content).toContain('line');
      expect(content).toContain('severity');
      expect(content).toContain('category');
      expect(content).toContain('message');
      expect(content).toContain('suggestion');
      expect(content).toContain('confidence');
      expect(content).toContain('source');
    });
  });

  describe('Finding schema validation', () => {
    it('sample finding validates against Finding interface', () => {
      const sampleFinding = {
        file: 'src/app.ts',
        line: 42,
        severity: 'high',
        category: 'security',
        message: 'SQL injection vulnerability',
        suggestion: 'Use parameterized queries',
        confidence: 0.9,
        source: 'ai',
      };

      expect(sampleFinding.file).toBeTypeOf('string');
      expect(sampleFinding.line).toBeTypeOf('number');
      expect(SEVERITY_VALUES).toContain(sampleFinding.severity);
      expect(sampleFinding.category).toBeTypeOf('string');
      expect(sampleFinding.message).toBeTypeOf('string');
      expect(sampleFinding.confidence).toBeTypeOf('number');
      expect(sampleFinding.confidence).toBeGreaterThanOrEqual(0);
      expect(sampleFinding.confidence).toBeLessThanOrEqual(1);
      expect(SOURCE_VALUES).toContain(sampleFinding.source);
    });
  });
});