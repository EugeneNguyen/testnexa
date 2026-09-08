---
name: known-red-e2e-specs
description: Two e2e specs fail on main for reasons unrelated to any new change — don't debug them as regressions when verifying a feature branch
metadata:
  type: project
---

As of 2026-09-06, two Playwright specs in `e2e/tests/` fail against a correctly
built isolated stack for reasons that have nothing to do with whatever branch
you are verifying:

1. **`admin2-generic-crud.spec.ts`** — "create Requirement -> TestCondition
   through nginx, then cross-org 404" calls `POST /api/v1/test-conditions`,
   which **REQ-3/ADR-0028 deliberately removed** (`assets.py`'s
   `_TEST_CONDITION_CONFIG` now has `create_schema=None` and no `"create"` in
   `methods`; the route genuinely does not exist in the OpenAPI spec). The spec
   was last touched 2026-09-05, the removal landed 2026-09-06 — it has been red
   on main since REQ-3 merged and was never updated.
2. **`auth-login.spec.ts`** — needs a pre-seeded account
   (`E2E_LOGIN_EMAIL`, default `e2e-auth1@example.com`) that does **not** exist
   in a DB cloned from main. Unlike the newer specs, it does not seed itself.

Also: `auth-refresh.spec.ts` looks broken but is not — it needs
`E2E_POSTGRES_CONTAINER` set to your stack's postgres container (its default is
a dead container name from a prior session, same trap as
`E2E_BACKEND_CONTAINER`). Set both env vars and it passes.

**Why:** verifying PLAN-1 (2026-09-06) burned real time proving these three
were not regressions from the branch under test. The repo's own rule is to
never trust a self-reported "done", so the failures had to be chased — but the
answer is archaeology (`git log` on the spec vs. the route removal), not
debugging.

**How to apply:** when a full e2e run comes back with failures, check this list
first. Expect roughly `36 passed / 2 failed / 1 skipped` from a full
`--workers=1` run on a healthy stack with both container env vars set. Only
investigate failures outside these two. If someone fixes the stale `admin2`
spec, delete that item from this memory.
