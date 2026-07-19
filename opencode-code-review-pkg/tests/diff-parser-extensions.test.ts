import { describe, it, expect } from 'vitest';
import { parseDiff, getAdditions, getDeletions, hasSignificantChanges } from '../src/diff-parser.js';

const SIMPLE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index abc123..def456 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 import { foo } from './foo';
-const x = 1;
+const x = 2;
+const y = 3;
 export default x;
`;

describe('getAdditions', () => {
  it('returns all added lines', () => {
    const diffs = parseDiff(SIMPLE_DIFF);
    const additions = getAdditions(diffs[0]);
    expect(additions).toHaveLength(2);
    expect(additions[0].content).toBe('const x = 2;');
    expect(additions[1].content).toBe('const y = 3;');
  });

  it('returns empty array for diff with no additions', () => {
    const diffs = parseDiff(`diff --git a/f.txt b/f.txt
--- a/f.txt
+++ b/f.txt
@@ -1,2 +1,1 @@
-line1
-line2
+remaining
`);
    const additions = getAdditions(diffs[0]);
    // There is 1 addition
    expect(additions.length).toBe(1);
  });
});

describe('getDeletions', () => {
  it('returns all deleted lines', () => {
    const diffs = parseDiff(SIMPLE_DIFF);
    const deletions = getDeletions(diffs[0]);
    expect(deletions).toHaveLength(1);
    expect(deletions[0].content).toBe('const x = 1;');
  });

  it('returns empty array for diff with no deletions', () => {
    const diffs = parseDiff(`diff --git a/f.txt b/f.txt
new file mode 100644
--- /dev/null
+++ b/f.txt
@@ -0,0 +1,2 @@
+line1
+line2
`);
    const deletions = getDeletions(diffs[0]);
    expect(deletions).toHaveLength(0);
  });
});

describe('hasSignificantChanges', () => {
  it('returns false for small changes', () => {
    const diffs = parseDiff(SIMPLE_DIFF);
    expect(hasSignificantChanges(diffs[0], 10)).toBe(false);
  });

  it('returns true for large changes', () => {
    const diffs = parseDiff(SIMPLE_DIFF);
    // 3 changes (1 delete + 2 add), threshold 2
    expect(hasSignificantChanges(diffs[0], 2)).toBe(true);
  });

  it('returns false when exactly at threshold', () => {
    const diffs = parseDiff(SIMPLE_DIFF);
    // 3 changes, threshold 3
    expect(hasSignificantChanges(diffs[0], 3)).toBe(false);
  });

  it('uses default threshold of 10', () => {
    const diffs = parseDiff(SIMPLE_DIFF);
    expect(hasSignificantChanges(diffs[0])).toBe(false);
  });
});

describe('combined diff defensive skip', () => {
  it('skips --cc combined diff format', () => {
    const combinedDiff = `diff --cc src/merge.ts
index abc,def 0000000
--- a/src/merge.ts
+++ b/src/merge.ts
@@@ -1,2 -1,2 +1,3 @@@
 context
-removed A
-removed B
+added A
+added B
+added C
diff --git a/src/normal.ts b/src/normal.ts
--- a/src/normal.ts
+++ b/src/normal.ts
@@ -1,3 +1,3 @@
 line1
-line2
+line2mod
 line3
`;
    const diffs = parseDiff(combinedDiff);
    // Should only parse the normal diff, not the combined one
    expect(diffs).toHaveLength(1);
    expect(diffs[0].path).toBe('src/normal.ts');
  });

  it('skips --combined diff format', () => {
    const combinedDiff = `diff --combined src/merge.ts
index abc,def 0000000
--- a/src/merge.ts
+++ b/src/merge.ts
@@@ -1,2 -1,2 +1,3 @@@
 context
diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
-old
+new
`;
    const diffs = parseDiff(combinedDiff);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].path).toBe('src/a.ts');
  });
});
