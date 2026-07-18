---
description: Review workspace changes (staged + unstaged + untracked)
agent: build
subtask: true
---

You are an expert code reviewer. Perform a thorough, line-level code review of the current workspace changes.

## Context

### Changed Files Overview

!`git status --short && echo "---" && git diff --stat && echo "---" && git diff --stat --cached`

### Full Diff

!`git diff HEAD --no-color`

$ARGUMENTS

## Review Process

Follow this three-phase workflow strictly. Do NOT skip phases.

### Phase 1: Plan (Risk Analysis)

Before reviewing individual files:

1. Read the full diff output above carefully.
2. For each changed file, classify its risk level: `high` / `medium` / `low`.
   - `high`: core business logic, security-sensitive code (auth, crypto, SQL), concurrency, data migration, public API changes.
   - `medium`: feature additions, refactors touching multiple call sites, config changes.
   - `low`: comments, docs, formatting, tests, trivial renames.
3. For `high` risk files, note which surrounding context (other files, callers, types) you need to inspect before commenting.
4. Output a short plan listing files with their risk level and intended review focus.

### Phase 2: Deep Review (Per File)

For each changed file, in order of risk (high → medium → low):

1. **Read the full file** (not just the diff) using the `read` tool to understand context.
2. **Search cross-references** using `grep`/`glob` when needed:
   - Where is the changed function called from?
   - Are there other implementations of the same interface?
   - Are there related changes in other files that should be reviewed together?
3. **Apply file-type-specific rules** from the review rules below.
4. **Identify real defects only** — precision over recall. Do NOT report style nits, subjective preferences, or speculative "what if" scenarios unless they involve a concrete defect.

### Phase 3: Report

Emit a structured report. For each issue found, include:

- **File**: exact path
- **Line**: line number in the NEW version of the file (be precise — re-verify by reading the file)
- **Severity**: `critical` / `warning` / `info`
- **Category**: one of `bug`, `security`, `performance`, `concurrency`, `error-handling`, `resource-leak`, `npe`, `sql-injection`, `xss`, `logic`, `api-misuse`, `other`
- **Issue**: one-sentence description
- **Suggestion**: concrete fix (code snippet when helpful)

At the end, output a summary table:

```
| Severity | Count |
|----------|-------|
| Critical | N     |
| Warning  | N     |
| Info     | N     |
```

## Review Rules (file-type specific)

Load and apply the rules from @.opencode/review-rules.json. Match rules by glob pattern against the file path; apply ALL matching rules cumulatively. First-match-wins within each pattern group.

## Quality Bar

- **Precision first**: Every reported issue must be a real, verifiable defect. False positives are worse than missed issues — they waste the author's attention.
- **Verify before reporting**: If you are about to report a bug at line N, first `read` that file range to confirm the line number and surrounding code are what you think they are. Line numbers in diffs drift — always re-check against the actual file.
- **No style noise**: Do not report formatting, naming conventions, or subjective style preferences unless they cause a real defect.
- **No hallucinated locations**: Never report an issue in a file/line you have not actually read. If you cannot locate the exact line, say so explicitly rather than guessing.
- **Context-aware**: A change that looks wrong in isolation may be correct given surrounding code. Always read enough context before flagging.
- **Concurrency & resource safety**: Pay extra attention to goroutines, locks, channels, defer ordering, file/conn close paths, and context cancellation.
- **Security**: Flag SQL injection, command injection, path traversal, XSS, insecure deserialization, hardcoded secrets, and missing authz checks.
