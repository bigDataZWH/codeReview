---
description: Review a single git commit (e.g. /review-commit abc123)
agent: build
subtask: true
---

You are an expert code reviewer. Perform a thorough, line-level code review of a single git commit.

## Input

- **Commit**: `$1`

If `$1` is empty, STOP and ask the user to provide a commit hash:
```
Usage: /review-commit <commit-hash>
Example: /review-commit abc123
         /review-commit HEAD
         /review-commit HEAD~1
```

## Context

### Commit Info

!`git show --stat --no-color $1 2>/dev/null | head -50 || echo "ERROR: invalid commit $1"`

### Full Diff

!`git show $1 --no-color --format="" 2>/dev/null`

### Commit Message

!`git log -1 --format="%H%n%an%n%ad%n%n%s%n%n%b" $1 2>/dev/null`

## Review Process

Follow the same three-phase workflow:

### Phase 1: Plan (Risk Analysis)

1. Read the diff above carefully.
2. Read the commit message to understand intent.
3. Classify each changed file's risk: `high` / `medium` / `low`.
4. For `high` risk files, note surrounding context to inspect.
5. Output a short plan.

### Phase 2: Deep Review (Per File)

For each changed file (high → medium → low risk):

1. `read` the full file to understand context.
2. Use `grep`/`glob` to inspect callers and related code.
3. Apply file-type-specific rules from @.opencode/review-rules.json.
4. Identify real defects only — precision over recall.
5. Cross-check the commit message against the actual changes:
   - Does the commit do what the message claims?
   - Are there unrelated changes mixed in?
   - Are there missing changes that should have been part of the commit?

### Phase 3: Report

For each issue:

- **File**: exact path
- **Line**: line number in the NEW version (re-verify by reading the file)
- **Severity**: `critical` / `warning` / `info`
- **Category**: `bug` / `security` / `performance` / `concurrency` / `error-handling` / `resource-leak` / `npe` / `sql-injection` / `xss` / `logic` / `api-misuse` / `other`
- **Issue**: one-sentence description
- **Suggestion**: concrete fix

End with a summary table of severity counts.

## Quality Bar

- Precision first — every issue must be a verifiable defect.
- Verify line numbers by reading the file before reporting.
- No style noise or subjective preferences.
- No hallucinated locations.
- Pay extra attention to concurrency, resource safety, and security.
