---
name: shipping-worktree-branches
description: Operational gotchas when pushing/PR-ing/merging this repo's worktree feature branches — gh --delete-branch silently skips remote deletion, and github.com HTTPS is very slow from this machine
metadata:
  type: project
---

Shipping a `.claude/worktrees/<name>` feature branch to `main` in this repo hits three recurring, non-obvious snags. Confirmed 2026-09-07 shipping PRs #29 (`fix-orghome-project-list`) and #30 (`exec-1-record-test-result`).

**1. `gh pr merge --merge --delete-branch` fails its local cleanup and never deletes the remote branch.**
- If the feature branch is checked out in a worktree: `cannot delete branch 'X' used by worktree at ...`
- If `main` is held by the main repo: `fatal: 'main' is already used by worktree at ...`

In both cases **the PR still merges successfully on GitHub** — only the cleanup step fails. But the *remote* branch is left behind too, despite `--delete-branch`.

**Why:** `gh` does local branch cleanup by checking out the base branch, which git refuses when any worktree holds that ref. This repo always has worktrees holding both.

**How to apply:** Treat `--delete-branch` as a no-op here. After merging, verify with `git ls-remote --heads origin | grep <branch>` and delete explicitly: `git push origin --delete <b1> <b2>`. Always confirm the merge landed via `gh pr view <N> --json state,mergedAt` rather than reading the command's exit output, since the error text looks like the merge failed when it didn't.

**2. `git push` to github.com times out; `gh api` works fine.**
TCP connects instantly and `api.github.com` is fast, but `github.com:443` TLS/HTTP takes ~20-75s. Default `git push` dies with `Failed to connect to github.com port 443 after 75003 ms`.

**Why:** Slow path to github.com specifically (edge region southeastasia), not a sandbox block — reproduced with the sandbox disabled.

**How to apply:** Push with `git -c http.version=HTTP/1.1 -c http.postBuffer=524288000 push ...` and give the Bash call a 300-420s timeout. Don't conclude the network or auth is broken — check `gh api user` first, which will succeed.

**3. `git branch -d` can refuse a fully-merged branch after any local ref drift.**
If the local branch ref ends up ahead of its `origin/` counterpart, `-d` warns "not yet merged to refs/remotes/origin/X, even though it is merged to HEAD."

**How to apply:** Verify containment before force-deleting — `git merge-base --is-ancestor <branch> main` and `git log --oneline main..<branch>` (empty = nothing lost) — then `-D`. Don't reflexively `-D` without that check.

See also: the root `CLAUDE.md` worktree/staleness section, and [[verify-dont-trust-teardown-claims]].
