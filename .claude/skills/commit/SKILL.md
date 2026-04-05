---
name: commit
description: Create a git commit following project conventions. Use when the user asks to commit changes, save progress, or says /commit.
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash(rtk git *)
---

# Git Commit

Create a well-formatted git commit following project conventions.

## Commit Message Format

This project uses **Conventional Commits** enforced by commitlint. Format:

```
<type>(<scope>): <description>
```

### Types

- `feat` — new feature
- `fix` — bug fix
- `refactor` — code restructuring without behavior change
- `chore` — maintenance, dependencies, config
- `docs` — documentation only
- `style` — formatting, no logic change
- `test` — adding or updating tests
- `perf` — performance improvement
- `ci` — CI/CD changes

### Scope

Optional. Use the primary area affected (e.g., `auth`, `yggdrasil`, `ui`, `db`, `oauth`, `plugin`).

### Description

- Use imperative mood ("add feature" not "added feature")
- Lowercase first letter
- No period at end
- Concise, focus on "why" not "what"
- Summarize the nature of the changes accurately: `add` = wholly new feature, `update` = enhancement to existing, `fix` = bug fix

## Workflow

**Step 1 — Gather info (run all three in parallel):**

- `rtk git status` — see all tracked/untracked changes
- `rtk git diff` + `rtk git diff --staged` — see unstaged and staged changes
- `rtk git log -5` — see recent commit style for reference

**Step 2 — Analyze and plan:**

- Review all changes (both staged and unstaged) holistically
- Determine if changes should be split into separate commits:
  - If changes span different concerns (e.g., new feature + formatting, config + bugfix), propose splitting and ask the user for confirmation
  - Each commit should be atomic — one logical change per commit
- For each planned commit:
  - Determine the correct type and scope
  - Draft a concise message that captures intent
- **Security check:** Do NOT commit files that likely contain secrets (`.env`, `credentials.json`, `*.key`, etc.). Warn the user if they specifically request to commit those files
- If there are no changes to commit, inform the user and stop

**Step 3 — Stage and commit:**

- Stage relevant files by name (NEVER use `git add -A` or `git add .`)
- Create the commit using a HEREDOC:
  ```bash
  rtk git commit -m "$(cat <<'EOF'
  type(scope): description
  EOF
  )"
  ```

**Step 4 — Verify:**

- Run `rtk git status` to confirm the commit succeeded
- If multiple commits were planned, repeat Steps 3-4 for each

If $ARGUMENTS is provided, use it as guidance for the commit message.

## Important

- ALWAYS prefix git commands with `rtk`
- NEVER amend existing commits unless explicitly asked
- NEVER push unless explicitly asked
- NEVER skip hooks (`--no-verify`) unless explicitly asked
- If pre-commit hook fails: fix the issue, re-stage, and create a NEW commit (do NOT amend — the failed commit never happened, so amend would modify the previous commit)
- Stage specific files, not everything
