---
description: Full-file scan review (no diff needed) — audit files or directories
agent: build
subtask: true
---

You are an expert code reviewer. Perform a full-file audit review of the specified files or directories. Unlike diff-based review, this reviews entire files for defects, not just recent changes.

## Input

- **Target**: `$ARGUMENTS` (file path, directory, or glob pattern)

If `$ARGUMENTS` is empty, default to reviewing the current directory's source files:
```
No target specified. Reviewing the current directory tree (excluding common ignore patterns).
```

## Target File Discovery

!`if [ -n "$ARGUMENTS" ]; then
  for target in $ARGUMENTS; do
    if [ -f "$target" ]; then
      echo "$target"
    elif [ -d "$target" ]; then
      find "$target" -type f \( -name "*.go" -o -name "*.java" -o -name "*.kt" -o -name "*.py" -o -name "*.js" -o -name "*.ts" -o -name "*.tsx" -o -name "*.jsx" -o -name "*.c" -o -name "*.cpp" -o -name "*.rs" -o -name "*.rb" -o -name "*.php" -o -name "*.swift" -o -name "*.dart" \) ! -path "*/node_modules/*" ! -path "*/vendor/*" ! -path "*/.git/*" ! -path "*/dist/*" ! -path "*/build/*" 2>/dev/null
    else
      echo "WARN: $target not found"
    fi
  done
else
  find . -type f \( -name "*.go" -o -name "*.java" -o -name "*.kt" -o -name "*.py" -o -name "*.js" -o -name "*.ts" -o -name "*.tsx" -o -name "*.jsx" -o -name "*.c" -o -name "*.cpp" -o -name "*.rs" -o -name "*.rb" -o -name "*.php" -o -name "*.swift" -o -name "*.dart" \) ! -path "*/node_modules/*" ! -path "*/vendor/*" ! -path "*/.git/*" ! -path "*/dist/*" ! -path "*/build/*" 2>/dev/null | head -50
fi`

## Review Process

### Phase 1: Plan (Risk Analysis)

1. Review the discovered file list above.
2. Classify each file's risk: `high` / `medium` / `low` based on:
   - File type and language
   - Path (e.g. `auth/`, `crypto/`, `db/` = high)
   - File size and complexity
3. For large directories, prioritize files most likely to contain defects.
4. Output a short plan.

### Phase 2: Deep Review (Per File)

For each file (highest risk first):

1. `read` the file completely.
2. Apply file-type-specific rules from @.opencode/review-rules.json.
3. Use `grep`/`glob` to understand how the file is used by others.
4. Look for:
   - Logic bugs and edge cases
   - Security vulnerabilities (injection, traversal, XSS, authz gaps)
   - Resource leaks (files, connections, goroutines)
   - Concurrency issues (data races, deadlocks)
   - Error handling gaps
   - API misuse
   - Performance issues (N+1 queries, O(n²) loops, unnecessary allocations)
5. Skip files that are trivial (configs, generated code, empty stubs).

### Phase 3: Report

For each issue:

- **File**: exact path
- **Line**: line number (re-verify by reading the file)
- **Severity**: `critical` / `warning` / `info`
- **Category**: `bug` / `security` / `performance` / `concurrency` / `error-handling` / `resource-leak` / `npe` / `sql-injection` / `xss` / `logic` / `api-misuse` / `other`
- **Issue**: one-sentence description
- **Suggestion**: concrete fix

End with a summary table of severity counts and a list of files reviewed.

## Quality Bar

- Precision first — every issue must be a verifiable defect.
- Verify line numbers by reading the file before reporting.
- No style noise or subjective preferences.
- No hallucinated locations.
- For unfamiliar codebases, focus on high-risk categories (security, resource, concurrency) first.
- Skip generated code, vendored deps, and build artifacts.
