import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const COMMAND_PATH = join(__dirname, '../../../opencode-config/.opencode/commands/review-pr.md');

describe('review-pr command', () => {
  it('exists and is readable', () => {
    expect(existsSync(COMMAND_PATH)).toBe(true);
  });

  describe('publish step', () => {
    let commandContent: string;

    beforeEach(() => {
      commandContent = readFileSync(COMMAND_PATH, 'utf-8');
    });

    it('contains publish step that calls code-review publish', () => {
      expect(commandContent).toContain('code-review publish');
    });

    it('uses gh CLI to get PR info before publishing', () => {
      expect(commandContent).toContain('gh pr view');
      expect(commandContent).toContain('gh pr diff');
    });

    it('publish step uses $ARGUMENTS for PR reference', () => {
      expect(commandContent).toContain('#$ARGUMENTS');
    });

    it('publish step is placed after review requirements', () => {
      const reviewSectionIndex = commandContent.indexOf('### 审查要求');
      const publishSectionIndex = commandContent.indexOf('code-review publish');
      expect(reviewSectionIndex).not.toBe(-1);
      expect(publishSectionIndex).not.toBe(-1);
      expect(publishSectionIndex).toBeGreaterThan(reviewSectionIndex);
    });
  });
});