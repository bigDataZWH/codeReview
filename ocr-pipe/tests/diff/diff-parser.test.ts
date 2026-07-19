// tests/diff/diff-parser.test.ts
import { DiffParser } from '@/diff/parser';
import { readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES_DIR = join(__dirname, '__fixtures__');

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8');
}

describe('DiffParser', () => {
  let parser: DiffParser;

  beforeEach(() => {
    parser = new DiffParser();
  });

  describe('parse', () => {
    it('应该解析空 diff 并返回空数组', () => {
      const result = parser.parse('');
      expect(result.files).toEqual([]);
      expect(result.totalAdditions).toBe(0);
      expect(result.totalDeletions).toBe(0);
    });

    it('应该解析单个新增文件', () => {
      const diff = loadFixture('single-added.diff');
      const result = parser.parse(diff);

      expect(result.files).toHaveLength(1);
      const file = result.files[0];
      expect(file.path).toBe('src/auth/login.py');
      expect(file.changeType).toBe('added');
      expect(file.additions).toBe(3);
      expect(file.deletions).toBe(0);
      expect(file.oldPath).toBeNull();
      expect(file.hunks).toHaveLength(1);
      expect(file.contentHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('应该解析单个修改文件', () => {
      const diff = loadFixture('single-modified.diff');
      const result = parser.parse(diff);

      const file = result.files[0];
      expect(file.changeType).toBe('modified');
      expect(file.additions).toBe(2);
      expect(file.deletions).toBe(1);
    });

    it('应该解析删除文件', () => {
      const diff = loadFixture('single-deleted.diff');
      const result = parser.parse(diff);

      const file = result.files[0];
      expect(file.changeType).toBe('deleted');
      expect(file.deletions).toBeGreaterThan(0);
    });

    it('应该解析重命名文件', () => {
      const diff = loadFixture('renamed.diff');
      const result = parser.parse(diff);

      const file = result.files[0];
      expect(file.changeType).toBe('renamed');
      expect(file.oldPath).toBe('src/old_name.py');
      expect(file.path).toBe('src/new_name.py');
    });

    it('应该解析多文件 diff', () => {
      const diff = loadFixture('multi-files.diff');
      const result = parser.parse(diff);

      expect(result.files).toHaveLength(3);
      expect(result.totalAdditions).toBeGreaterThan(0);
      expect(result.totalDeletions).toBeGreaterThan(0);
    });

    it('应该正确解析 Hunk 行号', () => {
      const diff = loadFixture('single-modified.diff');
      const result = parser.parse(diff);

      const hunk = result.files[0].hunks[0];
      expect(hunk.oldStart).toBeGreaterThan(0);
      expect(hunk.newStart).toBeGreaterThan(0);
      expect(hunk.header).toMatch(/^@@/);

      const addLines = hunk.lines.filter(l => l.type === 'add');
      const delLines = hunk.lines.filter(l => l.type === 'del');
      const ctxLines = hunk.lines.filter(l => l.type === 'context');

      expect(addLines.length).toBeGreaterThan(0);
      expect(delLines.length).toBeGreaterThan(0);
      expect(ctxLines.length).toBeGreaterThanOrEqual(0);

      // 新增行应该有 newLineNumber
      addLines.forEach(line => {
        expect(line.newLineNumber).not.toBeNull();
        expect(line.oldLineNumber).toBeNull();
      });

      // 删除行应该有 oldLineNumber
      delLines.forEach(line => {
        expect(line.oldLineNumber).not.toBeNull();
        expect(line.newLineNumber).toBeNull();
      });

      // 上下文行应该两者都有
      ctxLines.forEach(line => {
        expect(line.oldLineNumber).not.toBeNull();
        expect(line.newLineNumber).not.toBeNull();
      });
    });

    it('应该处理二进制文件 diff', () => {
      const diff = loadFixture('binary.diff');
      const result = parser.parse(diff);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].hunks).toEqual([]);
    });

    it('应该计算文件内容哈希（基于文件路径+内容）', () => {
      const diff = loadFixture('single-added.diff');
      const result1 = parser.parse(diff);
      const result2 = parser.parse(diff);

      expect(result1.files[0].contentHash).toBe(result2.files[0].contentHash);
    });
  });

  describe('parseFromGit', () => {
    it('应该处理 git diff 输出格式', () => {
      // 模拟 git diff 输出（带 diff --git 前缀）
      const gitDiff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,3 +1,4 @@
 line1
+line2
 line3
`;
      const result = parser.parse(gitDiff);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe('src/test.ts');
    });
  });

  describe('统计信息', () => {
    it('应该正确统计总新增和删除行数', () => {
      const diff = loadFixture('multi-files.diff');
      const result = parser.parse(diff);

      const expectedAdd = result.files.reduce((s, f) => s + f.additions, 0);
      const expectedDel = result.files.reduce((s, f) => s + f.deletions, 0);

      expect(result.totalAdditions).toBe(expectedAdd);
      expect(result.totalDeletions).toBe(expectedDel);
    });

    it('应该返回变更文件数量', () => {
      const diff = loadFixture('multi-files.diff');
      const result = parser.parse(diff);
      expect(result.fileCount).toBe(result.files.length);
    });
  });
});
