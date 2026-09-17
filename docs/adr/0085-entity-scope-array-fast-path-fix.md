# 0085. `useEntityScope`'s fast path didn't recognize a branching `scopeField` array

**Status:** Accepted
**Decider:** xuanbinh91@gmail.com (CTO)
**Date:** 2026-09-17
**Related:** [ADR-0084](0084-test-cycle-project-scope.md) (the change that exposed this — found live, same-day, in the CTO's own manual click-through immediately after that ADR merged), [ADR-0078](0078-compound-create-through-bespoke-routes.md) (`scopeArmsOf`, the exact array-vs-string normalization helper this fix reuses)

## Context

Immediately after [ADR-0084](0084-test-cycle-project-scope.md) merged, a live manual check of `/projects/:projectId/admin/test-cycles` showed a manual "By test plan / By project" toggle defaulting to an empty "By test plan" search box — not the resolved list ADR-0084 was built to produce.

Root cause: `frontend/src/pages/admin/useEntityScope.ts`'s fast path (ADR-0060's "shape B" — resolve immediately from `routeParams.projectId`, no fetch, no picker) checked `config.scopeField === "project_id"`, a strict string comparison. `TestCycle`'s `scopeField` is now the branching array `["test_plan_id", "project_id"]` (ADR-0084) — always unequal to the literal string `"project_id"`, so the check silently failed and execution fell through to the `scopeSelector` picker branch, even on a route where `:projectId` was already sitting right there.

This is the identical class of bug `frontend/CLAUDE.md`'s own ADR-0078 note already documents fixing once, for a different call site (`EntityRelationTab.tsx`'s `pickerScopeParams`) — a comparison written when `scopeField` was only ever a string, silently answering "no" for an array. `useEntityScope.ts` was not touched by that earlier fix; nothing before ADR-0084 had ever given a `project_id`/`org_id`-containing tuple to this specific file's fast-path check, so the gap had no way to surface until now.

## Decision

Import and reuse `scopeArmsOf` (`EntityRelationTab.tsx`, exported for exactly this kind of reuse) in `useEntityScope.ts`'s fast-path check, replacing the two strict-equality comparisons:

```ts
const arms = scopeArmsOf(config);
if (arms.includes("project_id") && routeParams.projectId) { ... }
if (arms.includes("org_id") && routeParams.orgId) { ... }
```

`scopeArmsOf` normalizes `string | [string, string] | undefined` into a plain array, so a single-string `scopeField` (every entity except the branching ones) is unaffected — `["project_id"].includes("project_id")` is exactly as true as the old `"project_id" === "project_id"`.

## Consequences

- `/projects/:projectId/admin/test-cycles` (and any future entity that widens a `scopeField` to include `project_id`/`org_id` as one arm of a branching tuple) now resolves immediately from the route, no picker — the actual behavior ADR-0084 was written to produce.
- No other entity's behavior changes: `scopeArmsOf` on a plain string `scopeField` produces a single-element array, and `.includes(...)` on it is behaviorally identical to the old `===` check.
- Verified live against the real running `main` stack (a locally-minted access token via the `/auth/refresh`-mock technique, `backend/CLAUDE.md`'s documented pattern — no credential write) — before the fix, a screenshot showed the stuck picker; after, the resolved list ("No records found.", correct — `main`'s real DB currently has zero `TestCycle` rows).
- Two new Vitest cases added to `useEntityScope.test.tsx` (a `TestCycle`-shaped branching config: resolves immediately with `:projectId` present, stays not-ready with it absent) — pins this exact regression. Full frontend suite re-verified: `tsc --noEmit` clean, 98 files / 790 tests green.
- No backend change, no schema change, no new route.

## Alternatives considered

- **Widen the comparison inline** (`Array.isArray(config.scopeField) ? config.scopeField.includes("project_id") : config.scopeField === "project_id"`) instead of importing `scopeArmsOf`. Rejected — this is the exact duplicated-normalization risk `EntityRelationTab.tsx`'s own docstring for `scopeArmsOf` names as the reason it exists ("normalizing once is cheaper than auditing each comparison every time another config widens") — a second hand-rolled copy here would just be the same gap, one file over, waiting for a third config to widen and expose it again.
