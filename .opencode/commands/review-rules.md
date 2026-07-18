---
description: Display the active review rules configuration
---

Here are the active review rules used by `/review`, `/review-range`, `/review-commit`, and `/review-scan`:

@.opencode/review-rules.json

## How Rules Work

1. **Matching**: Each rule has a `path` glob pattern. When reviewing a file, ALL rules whose pattern matches the file path apply cumulatively.

2. **Glob syntax**:
   - `**` — recursive wildcard (matches any number of directories)
   - `*` — matches any characters within a single path segment
   - `{a,b}` — brace expansion (matches `a` or `b`)

3. **Customization**: Edit `.opencode/review-rules.json` to add, remove, or modify rules for your project.

## Available Review Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/review` | Review workspace changes (staged + unstaged + untracked) | `/review` |
| `/review-range` | Review changes between two refs | `/review-range main feature` |
| `/review-commit` | Review a single commit | `/review-commit abc123` |
| `/review-scan` | Full-file audit (no diff needed) | `/review-scan src/` |
| `/review-rules` | Show this rules reference | `/review-rules` |

## Rule Priority

Rules are applied cumulatively — if a file matches multiple patterns, ALL matching rules are used. This lets you combine language-specific rules with project-specific rules.

Example: a file `src/api/User.java` matches both `**/*.java` and any custom `**/api/**` rule you add.
