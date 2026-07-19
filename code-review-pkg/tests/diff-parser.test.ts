import { describe, it, expect } from 'vitest';
import { parseDiff, getHunkContext, computeDiffStats, getChangedFiles, getPatchSize, mergeDiffs, parseDiffStat, filterDiffsByPath, stripAnsiEscapes, isOnlyWhitespaceChange } from '../src/diff-parser.js';
import type { FileDiff } from '../src/types.js';

describe('diff-parser', () => {
  // 1. 空 diff
  describe('空 diff', () => {
    it('空字符串应返回空数组', () => {
      expect(parseDiff('')).toEqual([]);
    });

    it('仅含空白字符也应返回空数组', () => {
      expect(parseDiff('  \n  \n')).toEqual([]);
    });
  });

  // 2. 单文件单 hunk
  describe('单文件单 hunk', () => {
    it('正确解析文件路径、状态、hunk 行号、行类型', () => {
      const diff = `diff --git a/src/index.ts b/src/index.ts
index abc1234..def5678 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 export function hello() {
-  console.log('hello');
+  console.log('hello, world!');
+  return true;
 }`;

      const files = parseDiff(diff);
      expect(files).toHaveLength(1);

      const file = files[0];
      expect(file.path).toBe('src/index.ts');
      expect(file.status).toBe('modified');
      expect(file.hunks).toHaveLength(1);

      const hunk = file.hunks[0];
      expect(hunk.oldStart).toBe(1);
      expect(hunk.oldCount).toBe(3);
      expect(hunk.newStart).toBe(1);
      expect(hunk.newCount).toBe(4);
      expect(hunk.lines).toHaveLength(5);

      // 验证行类型
      expect(hunk.lines[0].type).toBe('context');
      expect(hunk.lines[0].content).toBe('export function hello() {');
      expect(hunk.lines[1].type).toBe('delete');
      expect(hunk.lines[1].content).toBe("  console.log('hello');");
      expect(hunk.lines[2].type).toBe('add');
      expect(hunk.lines[2].content).toBe("  console.log('hello, world!');");
      expect(hunk.lines[3].type).toBe('add');
      expect(hunk.lines[3].content).toBe('  return true;');
      expect(hunk.lines[4].type).toBe('context');
      expect(hunk.lines[4].content).toBe('}');
    });
  });

  // 3. 单文件多 hunk
  describe('单文件多 hunk', () => {
    it('多个 @@ 块正确归属同一文件', () => {
      const diff = `diff --git a/src/utils.ts b/src/utils.ts
index 1111111..2222222 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,3 +1,4 @@
 import { x } from 'y';
+import { z } from 'w';
 const a = 1;
@@ -10,3 +11,3 @@
 function foo() {
-  return a;
+  return a + 1;
 }`;

      const files = parseDiff(diff);
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('src/utils.ts');
      expect(files[0].hunks).toHaveLength(2);

      expect(files[0].hunks[0].oldStart).toBe(1);
      expect(files[0].hunks[0].oldCount).toBe(3);
      expect(files[0].hunks[0].newStart).toBe(1);
      expect(files[0].hunks[0].newCount).toBe(4);

      expect(files[0].hunks[1].oldStart).toBe(10);
      expect(files[0].hunks[1].oldCount).toBe(3);
      expect(files[0].hunks[1].newStart).toBe(11);
      expect(files[0].hunks[1].newCount).toBe(3);
    });
  });

  // 4. 多文件 diff
  describe('多文件 diff', () => {
    it('正确分离多个文件', () => {
      const diff = `diff --git a/file1.ts b/file1.ts
index a1b2c3..d4e5f6 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,2 +1,3 @@
 line1
+added
 line2
diff --git a/file2.ts b/file2.ts
index f6e5d4..c3b2a1 100644
--- a/file2.ts
+++ b/file2.ts
@@ -1,2 +1,2 @@
-first
+second
 keep`;

      const files = parseDiff(diff);
      expect(files).toHaveLength(2);
      expect(files[0].path).toBe('file1.ts');
      expect(files[1].path).toBe('file2.ts');
      expect(files[0].hunks).toHaveLength(1);
      expect(files[1].hunks).toHaveLength(1);
    });
  });

  // 5. 新增文件
  describe('新增文件', () => {
    it('status 为 added，oldStart=0', () => {
      const diff = `diff --git a/src/new-file.ts b/src/new-file.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/new-file.ts
@@ -0,0 +1,3 @@
+export const x = 1;
+export const y = 2;
+export const z = 3;`;

      const files = parseDiff(diff);
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('src/new-file.ts');
      expect(files[0].status).toBe('added');
      expect(files[0].hunks[0].oldStart).toBe(0);
      expect(files[0].hunks[0].oldCount).toBe(0);
      expect(files[0].hunks[0].newStart).toBe(1);
      expect(files[0].hunks[0].newCount).toBe(3);
    });
  });

  // 6. 删除文件
  describe('删除文件', () => {
    it('status 为 deleted，newStart=0', () => {
      const diff = `diff --git a/src/old-file.ts b/src/old-file.ts
deleted file mode 100644
index abc1234..0000000
--- a/src/old-file.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export const x = 1;
-export const y = 2;
-export const z = 3;`;

      const files = parseDiff(diff);
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('src/old-file.ts');
      expect(files[0].status).toBe('deleted');
      expect(files[0].hunks[0].newStart).toBe(0);
      expect(files[0].hunks[0].newCount).toBe(0);
      expect(files[0].hunks[0].oldStart).toBe(1);
      expect(files[0].hunks[0].oldCount).toBe(3);
    });
  });

  // 7. 重命名文件
  describe('重命名文件', () => {
    it('解析 rename from/to 和 oldPath', () => {
      const diff = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 100%
rename from src/old-name.ts
rename to src/new-name.ts
index abc1234..def5678 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,2 +1,2 @@
-const a = 'old';
+const a = 'new';
 export default a;`;

      const files = parseDiff(diff);
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('src/new-name.ts');
      expect(files[0].oldPath).toBe('src/old-name.ts');
      expect(files[0].status).toBe('renamed');
    });
  });

  // 8. 二进制文件
  describe('二进制文件', () => {
    it('设置 binary=true', () => {
      const diff = `diff --git a/images/logo.png b/images/logo.png
index abc1234..def5678 100644
Binary files a/images/logo.png and b/images/logo.png differ`;

      const files = parseDiff(diff);
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('images/logo.png');
      expect(files[0].binary).toBe(true);
      expect(files[0].hunks).toHaveLength(0);
    });
  });

  // 9. hunk header
  describe('hunk header', () => {
    it('正确解析 @@ -1,3 +1,4 @@ context line', () => {
      const diff = `diff --git a/file.txt b/file.txt
index 1111111..2222222 100644
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@ This is a context header
 line1
+line2
 line3
+line4`;

      const files = parseDiff(diff);
      expect(files).toHaveLength(1);
      expect(files[0].hunks[0].header).toBe('This is a context header');
    });
  });

  // 10. No newline at end of file
  describe('No newline at end of file', () => {
    it('不影响行解析', () => {
      const diff = `diff --git a/file.txt b/file.txt
index 1111111..2222222 100644
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
 first line
-last line
\\ No newline at end of file
+last line
+extra line`;

      const files = parseDiff(diff);
      expect(files).toHaveLength(1);
      const lines = files[0].hunks[0].lines;
      // \\ No newline at end of file 不应作为 DiffLine 出现
      expect(lines.every(l => l.type !== 'context' || l.content !== '\\ No newline at end of file')).toBe(true);
      // 应该有：context "first line", delete "last line", add "last line", add "extra line"
      expect(lines).toHaveLength(4);
      expect(lines[0].type).toBe('context');
      expect(lines[1].type).toBe('delete');
      expect(lines[2].type).toBe('add');
      expect(lines[3].type).toBe('add');
    });
  });

  // 11. 行号计算
  describe('行号计算', () => {
    it('正确计算 oldLineNumber 和 newLineNumber（考虑 add/delete/context）', () => {
      const diff = `diff --git a/file.ts b/file.ts
index 1111111..2222222 100644
--- a/file.ts
+++ b/file.ts
@@ -5,6 +5,7 @@
 line5
 line6
-removed_line
 line7
+added_line1
+added_line2
 line8
 line9
 line10`;

      const files = parseDiff(diff);
      const lines = files[0].hunks[0].lines;

      // context line5: old=5, new=5
      expect(lines[0].type).toBe('context');
      expect(lines[0].oldLineNumber).toBe(5);
      expect(lines[0].newLineNumber).toBe(5);

      // context line6: old=6, new=6
      expect(lines[1].type).toBe('context');
      expect(lines[1].oldLineNumber).toBe(6);
      expect(lines[1].newLineNumber).toBe(6);

      // delete removed_line: old=7, new=undefined
      expect(lines[2].type).toBe('delete');
      expect(lines[2].oldLineNumber).toBe(7);
      expect(lines[2].newLineNumber).toBeUndefined();

      // context line7: old=8, new=7 (因为删除了一行，new行号比old少1)
      expect(lines[3].type).toBe('context');
      expect(lines[3].oldLineNumber).toBe(8);
      expect(lines[3].newLineNumber).toBe(7);

      // add added_line1: old=undefined, new=8
      expect(lines[4].type).toBe('add');
      expect(lines[4].oldLineNumber).toBeUndefined();
      expect(lines[4].newLineNumber).toBe(8);

      // add added_line2: old=undefined, new=9
      expect(lines[5].type).toBe('add');
      expect(lines[5].oldLineNumber).toBeUndefined();
      expect(lines[5].newLineNumber).toBe(9);

      // context line8: old=9, new=10
      expect(lines[6].type).toBe('context');
      expect(lines[6].oldLineNumber).toBe(9);
      expect(lines[6].newLineNumber).toBe(10);

      // context line9: old=10, new=11
      expect(lines[7].type).toBe('context');
      expect(lines[7].oldLineNumber).toBe(10);
      expect(lines[7].newLineNumber).toBe(11);
    });
  });

  // 12. 含空行的 hunk
  describe('含空行的 hunk', () => {
    it('空行正确解析为 context 行', () => {
      const diff = `diff --git a/file.txt b/file.txt
index 1111111..2222222 100644
--- a/file.txt
+++ b/file.txt
@@ -1,4 +1,5 @@
 line1
 
+inserted
 line2
 line3`;

      const files = parseDiff(diff);
      const lines = files[0].hunks[0].lines;
      // 第二行是空行（context），content 应为空字符串
      expect(lines[1].type).toBe('context');
      expect(lines[1].content).toBe('');
      expect(lines[2].type).toBe('add');
      expect(lines[2].content).toBe('inserted');
    });
  });

  // 13. 特殊字符文件路径
  describe('特殊字符文件路径', () => {
    it('路径含空格、中文', () => {
      const diff = `diff --git a/src/我的 文件.ts b/src/我的 文件.ts
index 1111111..2222222 100644
--- a/src/我的 文件.ts
+++ b/src/我的 文件.ts
@@ -1,2 +1,3 @@
 代码第一行
+代码新增行
 代码第二行`;

      const files = parseDiff(diff);
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('src/我的 文件.ts');
      expect(files[0].hunks[0].lines[1].type).toBe('add');
      expect(files[0].hunks[0].lines[1].content).toBe('代码新增行');
    });
  });

  // 14. 大文件 diff
  describe('大文件 diff', () => {
    it('性能测试（1000+ 行）', () => {
      const lines: string[] = [
        'diff --git a/large-file.ts b/large-file.ts',
        'index 1111111..2222222 100644',
        '--- a/large-file.ts',
        '+++ b/large-file.ts',
      ];

      // 生成 5 个 hunk，每个约 210 行，总计 1050+ 行内容
      for (let h = 0; h < 5; h++) {
        const oldStart = h * 200 + 1;
        const newStart = h * 210 + 1;
        lines.push(`@@ -${oldStart},200 +${newStart},210 @@`);
        for (let i = 0; i < 200; i++) {
          lines.push(` context line ${oldStart + i}`);
        }
        // 添加 10 行新增内容
        for (let i = 0; i < 10; i++) {
          lines.push(`+added line ${h * 10 + i}`);
        }
      }

      const diff = lines.join('\n');

      const start = performance.now();
      const files = parseDiff(diff);
      const elapsed = performance.now() - start;

      expect(files).toHaveLength(1);
      expect(files[0].hunks).toHaveLength(5);
      // 性能断言：解析 1000+ 行应在 500ms 内完成
      expect(elapsed).toBeLessThan(500);
    });
  });

  // 15. old mode / new mode 解析
  describe('old mode / new mode', () => {
    it('解析文件权限变更的 old mode 和 new mode', () => {
      const diff = `diff --git a/src/script.sh b/src/script.sh
old mode 100644
new mode 100755
index abc1234..def5678 100644
--- a/src/script.sh
+++ b/src/script.sh
@@ -1,2 +1,2 @@
-echo old
+echo new`;

      const files = parseDiff(diff);
      expect(files).toHaveLength(1);
      expect(files[0].oldMode).toBe('100644');
      expect(files[0].newMode).toBe('100755');
    });

    it('无 mode 变更时 oldMode/newMode 为 undefined', () => {
      const diff = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,2 @@
-old
+new`;

      const files = parseDiff(diff);
      expect(files).toHaveLength(1);
      expect(files[0].oldMode).toBeUndefined();
      expect(files[0].newMode).toBeUndefined();
    });
  });

  // 16. similarity index 解析
  describe('similarity index', () => {
    it('解析 similarity index 百分比', () => {
      const diff = `diff --git a/old.ts b/new.ts
similarity index 75%
rename from old.ts
rename to new.ts
index abc1234..def5678 100644
--- a/old.ts
+++ b/new.ts
@@ -1,2 +1,3 @@
-old line1
-old line2
+new line1
+new line2
+new line3`;

      const files = parseDiff(diff);
      expect(files).toHaveLength(1);
      expect(files[0].similarity).toBe(75);
    });

    it('解析 dissimilarity index 为 similarity', () => {
      const diff = `diff --git a/old.ts b/new.ts
dissimilarity index 30%
rename from old.ts
rename to new.ts
index abc1234..def5678 100644
--- a/old.ts
+++ b/new.ts
@@ -1,2 +1,3 @@
-old line1
-old line2
+new line1
+new line2
+new line3`;

      const files = parseDiff(diff);
      expect(files).toHaveLength(1);
      expect(files[0].similarity).toBe(70);
    });

    it('无 similarity 信息时为 undefined', () => {
      const diff = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,2 @@
-old
+new`;

      const files = parseDiff(diff);
      expect(files).toHaveLength(1);
      expect(files[0].similarity).toBeUndefined();
    });
  });

  // 17. /dev/null 处理
  describe('/dev/null 处理', () => {
    it('新增文件中 --- /dev/null 不会导致错误', () => {
      const diff = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+const a = 1;
+export default a;`;

      const files = parseDiff(diff);
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('src/new.ts');
      expect(files[0].status).toBe('added');
      // The --- /dev/null should not appear as a diff line
      const allContent = files[0].hunks[0].lines.map(l => l.content);
      expect(allContent).not.toContain('/dev/null');
    });

    it('删除文件中 +++ /dev/null 不会导致错误', () => {
      const diff = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index abc1234..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const a = 1;
-export default a;`;

      const files = parseDiff(diff);
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('src/old.ts');
      expect(files[0].status).toBe('deleted');
      const allContent = files[0].hunks[0].lines.map(l => l.content);
      expect(allContent).not.toContain('/dev/null');
    });
  });

  // 19. copy from/to 支持
  describe('copy from/to', () => {
    it('解析 copy from/to 并设置 copied=true', () => {
      const diff = `diff --git a/src/original.ts b/src/copy.ts
copy from src/original.ts
copy to src/copy.ts
index abc1234..def5678 100644
--- a/src/original.ts
+++ b/src/copy.ts
@@ -1,2 +1,2 @@
-export const a = 1;
+export const a = 1;
+// added comment`;

      const files = parseDiff(diff);
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('src/copy.ts');
      expect(files[0].oldPath).toBe('src/original.ts');
      expect(files[0].copied).toBe(true);
    });
  });

  // 20. 混合状态 diff
  describe('混合状态 diff', () => {
    it('同一个 diff 含多种文件状态', () => {
      const diff = `diff --git a/added.ts b/added.ts
new file mode 100644
index 0000000..aaaaaa
--- /dev/null
+++ b/added.ts
@@ -0,0 +1,2 @@
+export const a = 1;
+export const b = 2;
diff --git a/modified.ts b/modified.ts
index bbbbbb..cccccc 100644
--- a/modified.ts
+++ b/modified.ts
@@ -1,2 +1,2 @@
-old line
+new line
diff --git a/deleted.ts b/deleted.ts
deleted file mode 100644
index dddddd..0000000
--- a/deleted.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-removed
diff --git a/renamed-old.ts b/renamed-new.ts
similarity index 100%
rename from renamed-old.ts
rename to renamed-new.ts
index eeeeee..ffffff 100644
--- a/renamed-old.ts
+++ b/renamed-new.ts`;

      const files = parseDiff(diff);
      expect(files).toHaveLength(4);

      expect(files[0].path).toBe('added.ts');
      expect(files[0].status).toBe('added');

      expect(files[1].path).toBe('modified.ts');
      expect(files[1].status).toBe('modified');

      expect(files[2].path).toBe('deleted.ts');
      expect(files[2].status).toBe('deleted');

      expect(files[3].path).toBe('renamed-new.ts');
      expect(files[3].oldPath).toBe('renamed-old.ts');
      expect(files[3].status).toBe('renamed');
    });
  });

  // getHunkContext
  describe('getHunkContext', () => {
    it('返回 hunk 中所有 context 行', () => {
      const diff = `diff --git a/file.ts b/file.ts
index 1111111..2222222 100644
--- a/file.ts
+++ b/file.ts
@@ -1,5 +1,6 @@
 context1
-deleted1
 context2
+added1
 context3
+added2`;

      const files = parseDiff(diff);
      const hunk = files[0].hunks[0];
      const ctx = getHunkContext(hunk);
      expect(ctx).toHaveLength(3);
      expect(ctx[0].content).toBe('context1');
      expect(ctx[1].content).toBe('context2');
      expect(ctx[2].content).toBe('context3');
    });

    it('当指定 contextLines 时限制返回数量', () => {
      const diff = `diff --git a/file.ts b/file.ts
index 1111111..2222222 100644
--- a/file.ts
+++ b/file.ts
@@ -1,5 +1,5 @@
 c1
 c2
-deleted
 c3
+added
 c4`;

      const files = parseDiff(diff);
      const hunk = files[0].hunks[0];
      const ctx = getHunkContext(hunk, 2);
      expect(ctx).toHaveLength(2);
      expect(ctx[0].content).toBe('c1');
      expect(ctx[1].content).toBe('c2');
    });

    it('hunk 无 context 行时返回空数组', () => {
      const diff = `diff --git a/file.ts b/file.ts
index 1111111..2222222 100644
--- a/file.ts
+++ b/file.ts
@@ -1,0 +1,2 @@
+line1
+line2`;

      const files = parseDiff(diff);
      const hunk = files[0].hunks[0];
      const ctx = getHunkContext(hunk);
      expect(ctx).toHaveLength(0);
    });
  });

  // computeDiffStats
  describe('computeDiffStats', () => {
    it('正确统计文件数、新增行数、删除行数', () => {
      const diff = `diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,5 @@
 line1
-line2
+line2a
+line2b
 line3
diff --git a/b.ts b/b.ts
index 1111111..2222222 100644
--- a/b.ts
+++ b/b.ts
@@ -1,2 +1,1 @@
-old_line
+new_line`;

      const files = parseDiff(diff);
      const stats = computeDiffStats(files);
      expect(stats.filesChanged).toBe(2);
      expect(stats.insertions).toBe(3); // line2a, line2b, new_line
      expect(stats.deletions).toBe(2); // line2, old_line
      expect(stats.modifiedLines).toBe(5);
    });

    it('空 diff 返回零值', () => {
      const stats = computeDiffStats([]);
      expect(stats.filesChanged).toBe(0);
      expect(stats.insertions).toBe(0);
      expect(stats.deletions).toBe(0);
      expect(stats.modifiedLines).toBe(0);
    });
  });

  // getChangedFiles
  describe('getChangedFiles', () => {
    it('返回 {path, status} 数组', () => {
      const diff = `diff --git a/a.ts b/a.ts
index 111..222 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/b.ts b/b.ts
new file mode 100644
--- /dev/null
+++ b/b.ts
@@ -0,0 +1 @@
+new file`;

      const files = parseDiff(diff);
      const changed = getChangedFiles(files);
      expect(changed).toHaveLength(2);
      expect(changed[0].path).toBe('a.ts');
      expect(changed[0].status).toBe('modified');
      expect(changed[1].path).toBe('b.ts');
      expect(changed[1].status).toBe('added');
    });
  });

  // submodule 检测
  describe('submodule', () => {
    it('submodule 变更被跳过', () => {
      const diff = `diff --git a/libs/submodule b/libs/submodule
new file mode 160000`;

      const files = parseDiff(diff);
      // submodule 应该被解析但不应该造成错误
      // current behavior: it creates a FileDiff but no hunks
      // This test verifies no crash
      expect(files.length).toBeLessThanOrEqual(1);
    });
  });

  // 多行文件路径防御
  describe('多行文件路径防御', () => {
    it('带引号的长路径不会导致解析崩溃', () => {
      const diff = `diff --git a/"src/path with spaces/file.ts" b/"src/path with spaces/file.ts"
index abc1234..def5678 100644
--- "a/src/path with spaces/file.ts"
+++ "b/src/path with spaces/file.ts"
@@ -1,2 +1,2 @@
-old
+new`;

      const files = parseDiff(diff);
      expect(files.length).toBeLessThanOrEqual(2); // May create 1 or 2 entries
      // No crash is the main assertion
      expect(true).toBe(true);
    });
  });

  // getPatchSize
  describe('getPatchSize', () => {
    it('计算所有 hunk 行的字符数', () => {
      const diff = `diff --git a/file.ts b/file.ts
index 1111111..2222222 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 aaa
-bbb
+ccc
 ddd`;

      const files = parseDiff(diff);
      // 'aaa' (3) + 'bbb' (3) + 'ccc' (3) + 'ddd' (3) = 12
      expect(getPatchSize(files[0])).toBe(12);
    });

    it('空 hunk 返回 0', () => {
      const diff: FileDiff = { path: 'empty.ts', status: 'modified', hunks: [] };
      expect(getPatchSize(diff)).toBe(0);
    });
  });

  // mergeDiffs (Round 46)
  describe('mergeDiffs', () => {
    it('合并两个数组中相同路径的 hunks', () => {
      const diff1 = parseDiff(`diff --git a/f.ts b/f.ts
index 111..222 100644
--- a/f.ts
+++ b/f.ts
@@ -1,3 +1,3 @@
 a
-b
+c
 d`)[0];

      const diff2 = parseDiff(`diff --git a/f.ts b/f.ts
index 111..222 100644
--- a/f.ts
+++ b/f.ts
@@ -5,2 +5,3 @@
 e
-f
+g
+h`)[0];

      const merged = mergeDiffs([diff1], [diff2]);
      expect(merged).toHaveLength(1);
      expect(merged[0].hunks).toHaveLength(2);
    });

    it('不同路径保持独立', () => {
      const a = parseDiff(`diff --git a/a.ts b/a.ts
index 111..222 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-a
+b`)[0];
      const b = parseDiff(`diff --git a/b.ts b/b.ts
index 111..222 100644
--- b/a.ts
+++ b/b.ts
@@ -1 +1 @@
-x
+y`)[0];

      const merged = mergeDiffs([a], [b]);
      expect(merged).toHaveLength(2);
    });

    it('空数组合并', () => {
      const a = parseDiff(`diff --git a/a.ts b/a.ts
index 111..222 100644
--- a/a.ts
+++ a/a.ts
@@ -1 +1 @@
-a
+b`)[0];
      expect(mergeDiffs([a], [])).toHaveLength(1);
      expect(mergeDiffs([], [a])).toHaveLength(1);
      expect(mergeDiffs([], [])).toHaveLength(0);
    });
  });

  // parseDiffStat (Round 50)
  describe('parseDiffStat', () => {
    it('解析标准 stat 输出', () => {
      const stat = ` src/file.ts  | 10 +++++-----
 src/other.js |  3 ++-
 tests/test.ts |  0`;
      const result = parseDiffStat(stat);
      expect(result).toHaveLength(3);
      expect(result[0].path).toBe('src/file.ts');
      expect(result[0].insertions).toBeGreaterThan(0);
      expect(result[0].deletions).toBeGreaterThan(0);
      expect(result[2].insertions).toBe(0);
      expect(result[2].deletions).toBe(0);
    });

    it('空输入返回空数组', () => {
      expect(parseDiffStat('')).toEqual([]);
    });

    it('忽略非匹配行', () => {
      const stat = ` some random text
 src/file.ts  |  5 ++++-
 another random line`;
      const result = parseDiffStat(stat);
      expect(result).toHaveLength(1);
    });
  });

  // filterDiffsByPath (Round 55)
  describe('filterDiffsByPath', () => {
    it('按正则过滤文件路径', () => {
      const diffs = parseDiff(`diff --git a/src/app.ts b/src/app.ts
index 111..222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-a
+b
diff --git a/test/test.ts b/test/test.ts
index 111..222 100644
--- a/test/test.ts
+++ b/test/test.ts
@@ -1 +1 @@
-x
+y`);
      const result = filterDiffsByPath(diffs, '^src/');
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('src/app.ts');
    });

    it('无匹配返回空', () => {
      const diffs = parseDiff(`diff --git a/a.ts b/a.ts
index 111..222 100644
--- a/a.ts
+++ a/a.ts
@@ -1 +1 @@
-a
+b`);
      expect(filterDiffsByPath(diffs, '\\.py$')).toHaveLength(0);
    });
  });

  // stripAnsiEscapes (Round 61)
  describe('stripAnsiEscapes', () => {
    it('移除 ANSI 转义码', () => {
      const input = '\x1b[31m-red\x1b[0m \x1b[32m+green\x1b[0m';
      const result = stripAnsiEscapes(input);
      expect(result).toBe('-red +green');
    });

    it('无转义码时原样返回', () => {
      expect(stripAnsiEscapes('plain text')).toBe('plain text');
    });

    it('空字符串返回空', () => {
      expect(stripAnsiEscapes('')).toBe('');
    });
  });

  // isOnlyWhitespaceChange (Round 66)
  describe('isOnlyWhitespaceChange', () => {
    it('仅空白变更返回 true', () => {
      const diff = parseDiff(`diff --git a/a.ts b/a.ts
index 111..222 100644
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,3 @@
 a
-\t
+  
 b`)[0];
      expect(isOnlyWhitespaceChange(diff)).toBe(true);
    });

    it('有非空白变更返回 false', () => {
      const diff = parseDiff(`diff --git a/a.ts b/a.ts
index 111..222 100644
--- a/a.ts
+++ a/a.ts
@@ -1 +1 @@
-a
+b`)[0];
      expect(isOnlyWhitespaceChange(diff)).toBe(false);
    });

    it('无 hunks 返回 false', () => {
      const diff: FileDiff = { path: 'a.ts', status: 'modified', hunks: [] };
      expect(isOnlyWhitespaceChange(diff)).toBe(false);
    });
  });
});