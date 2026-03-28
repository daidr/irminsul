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

## Workflow

1. Run `rtk git status` and `rtk git diff` (staged + unstaged) to understand current changes
2. Run `rtk git log -5` to see recent commit style for reference
3. Analyze all changes and draft a commit message:
   - Determine the correct type and scope
   - Write a concise description that captures the intent
   - Do NOT commit files that likely contain secrets (`.env`, credentials, etc.)
4. Stage relevant files by name (avoid `git add -A` or `git add .`)
5. Create the commit using a HEREDOC for the message:
   ```bash
   rtk git commit -m "$(cat <<'EOF'
   type(scope): description
   EOF
   )"
   ```
6. Run `rtk git status` to verify success

If $ARGUMENTS is provided, use it as guidance for the commit message.

## Important

- ALWAYS prefix git commands with `rtk`
- NEVER amend existing commits unless explicitly asked
- NEVER push unless explicitly asked
- If pre-commit hook fails, fix the issue and create a NEW commit (do not amend)
- Stage specific files, not everything
