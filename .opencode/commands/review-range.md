---
description: Review changes between two git refs (e.g. /review-range main feature-branch)
agent: build
subtask: true
---

You are an expert code reviewer. Perform a thorough, line-level code review of the changes between two git refs.

## Inputs

- **From**: `$1` (source ref, e.g. `main`)
- **To**: `$2` (target ref, e.g. `feature-branch`)

If either `$1` or `$2` is empty, STOP and ask the user to provide both refs:
```
Usage: /review-range <from-ref> <to-ref>
Example: /review-range main feature-branch
```

## Context

### Changed Files Overview

!`git diff --stat $1..$2 2>/dev/null || echo "ERROR: invalid refs, please check $1 and $2"`

### Full Diff

!`git diff $1..$2 --no-color 2>/dev/null`

### Commit Messages in Range

!`git log --oneline $1..$2 2>/dev/null`

## Review Process

Follow the same three-phase workflow as `/review`:

### Phase 1: Plan (Risk Analysis)

1. Read the diff above carefully.
2. Classify each changed file's risk: `high` / `medium` / `low`.
   - `high`: core business logic, security-sensitive code, concurrency, public API.
   - `medium`: feature additions, multi-site refactors, config changes.
   - `low`: comments, docs, formatting, tests, trivial renames.
3. For `high` risk files, note surrounding context to inspect.
4. Output a short plan with files, risk levels, and review focus.

### Phase 2: Deep Review (Per File)

For each changed file (high → medium → low risk):

1. `read` the full file to understand context.
2. Use `grep`/`glob` to inspect callers, implementations, related changes.
3. Apply file-type-specific rules from @.opencode/review-rules.json.
4. Identify real defects only — precision over recall.

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
- No hallucinated locations — if you cannot locate the exact line, say so.
- Pay extra attention to concurrency, resource safety, and security.
