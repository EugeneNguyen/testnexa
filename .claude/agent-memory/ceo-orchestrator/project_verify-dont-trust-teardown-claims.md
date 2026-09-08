---
name: verify-dont-trust-teardown-claims
description: A stated "already torn down / already at commit X" premise in this repo is a claim to re-verify — two such premises were wrong in one 2026-09-07 session
metadata:
  type: project
---

When a task brief in this repo asserts environment or git state as settled background fact, re-verify it before acting. Two independent premises were wrong in a single session (2026-09-07 merge of PRs #29/#30):

1. **"Both isolated test stacks were already torn down in a prior session."** `testnexa-exec1-test` was still running — 5 containers, up 4 hours, holding ports 31847 and 42619. Its compose files lived *inside* the `exec-1` worktree, so tearing it down had to happen **before** `git worktree remove`, or the config needed to bring it down cleanly would have been deleted first.
2. **"`main` is currently at `<sha>`."** That commit existed only in the local repo and had never been pushed; `origin/main` was one commit behind it. Merging the feature branches without first pushing it would have left `main` diverged and turned the final `git pull` into an unexpected local merge.

**Why:** These briefs are written from a prior session's memory of what it *intended* to do, and cleanup/push steps are exactly what gets dropped when a session ends early — the same failure class the root `CLAUDE.md` documents for stopped sub-agents, but applied to the premises handed *to* you rather than results reported *by* a child.

**How to apply:** Before a ship/cleanup task, spend two commands confirming the stated starting state: `docker compose ls` (grep for the project prefix) and `git rev-parse main origin/main` / `git rev-list --left-right --count origin/main...main`. Order matters — tear down any stack whose compose files live in a worktree *before* removing that worktree. Report premise corrections prominently; the user is reasoning from the stated version.

See also: [[shipping-worktree-branches]].
