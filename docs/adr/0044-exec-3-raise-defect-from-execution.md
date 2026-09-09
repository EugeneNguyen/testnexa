# ADR-0044: EXEC-3 raise a Defect from a failed TestExecution

**Status:** Accepted
**Date:** 2026-09-08
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0022](0022-generic-crud-router-factory.md)/[ADR-0027](0027-generic-admin-crud-ui-and-backend-completion.md) (`Defect`/`TestCaseDefectLink` models + read-only factory routes, built ahead of this story), [ADR-0029](0029-testcase-resolver-direct-link-fallback.md) (`TestCase`'s 3-branch resolver, reused verbatim), [ADR-0033](0033-plan3-test-cycle-creation-and-execution-scope-check.md)/[ADR-0038](0038-exec-2-append-only-test-log.md) (`execution.py`'s `_fetch_execution_gated`/`_resolve_test_execution_org_id`, reused verbatim), [FR-EXEC-3](../requirements/2026-09-03-project-scaffold-requirements.md#26-test-execution--defects--test-execution-defect-storiesmd), [Database Document §3.8/§3.9](../database/2026-09-03-database-design.md), [API Document §4](../api/2026-09-03-api-design.md), [TC-EXEC-007/008/009/011/012](../test-cases/2026-09-03-test-cases.md)

## Context

`Defect` and `TestCaseDefectLink` have existed since ADR-0027: `Defect` has full `GET`/`PATCH`/`DELETE` via the generic factory (`create` deliberately excluded from the start, `execution.py`'s own module docstring reserving it for "a future bespoke `POST /executions/{id}/defects` atomic-create route"), and `TestCaseDefectLink` has `list`/`get` only, with no route anywhere that has ever written a row to it. The API Document's §4 route table already named the exact bespoke route (`POST /executions/{id}/defects`, `defect.create`) before this story began — this ADR is what actually builds it.

Two open questions were resolved with the user before implementation (plan-with-open-questions convention, root `CLAUDE.md`); both defaults were accepted as-is:

- **Q1 (TestCase detail's Defects view):** no `GET /test-cases` list route exists (`TestCase` has no safe `scope_field`, `app/schemas/assets.py`'s own module docstring), and the existing generic `GET /test-case-defect-links?test_case_id=` returns bare link rows with no ordering guarantee and no `Defect` fields — satisfying AC3's literal "most recent first" would otherwise mean N+1 frontend calls into an unordered list. Default: add one more bespoke read route, `GET /test-cases/{id}/defects`, doing the `TestCaseDefectLink`⋈`Defect` join server-side, ordered `Defect.created_at DESC` — not in the API Document's original EXEC-3 scope, added here the same way ADR-0030/ADR-0031 each added a nested read route beyond their own original scope once a real UI need for one surfaced.
- **Q2 (RBAC):** `test_manager` — Priya's own persona role since PLAN-3/ADR-0033 — held only `defect.read` (no `.create`) and neither `test_manager` nor `tester` held `test_case_defect_link.read` at all (only `org_admin`/`auditor` did). Default: extend `test_manager`'s seeded bundle with `defect.create` (leave `.update`/`.delete` withheld — no AC asks for either), and extend both `test_manager` and `tester` with `test_case_defect_link.read` (needed by either role to reach Q1's new view). The fifth such ad hoc extension for `test_manager` (after `release.*`, `test_condition.*`/`test_case.*`, `environment.*`/`test_execution.*`, and now this).

Two further defaults (status field shape, UI placement) needed no separate ADR-level debate — see Decision below.

## Decision

### Backend

**`POST /executions/{id}/defects`** (new bespoke route, `app/api/routes/execution.py`, reusing `_fetch_execution_gated`/`_resolve_test_execution_org_id` verbatim — no new resolver, no new 404-vs-403 gate shape). Gated `defect.create`. Boundary, in order:

1. Missing/cross-org `TestExecution` → `404` (existence-hiding, via the existing resolver + `_actor_membership_exists`).
2. Missing `defect.create` → `403`.
3. **`execution.result != TestExecutionResult.fail`** → `422 validation_error` — a business-rule rejection (the caller has already proven org membership and the execution genuinely exists), never `404`, same posture PLAN-3's own out-of-scope check established.
4. Insert `Defect` (`test_execution_id` = the path execution's id, `reported_by_actor_id` = the authenticated actor, `external_ref`/`severity`/`status` from the body, `status` defaulting to `"open"` if omitted — the model's own existing default, no new enum) **and** `TestCaseDefectLink` (`test_case_id` = `execution.test_case_id`, `defect_id` = the new `Defect`'s id) in the same transaction — the atomic create+link shape ADR-0028/ADR-0030 already established for their own bespoke routes. `IntegrityError` → rollback → `422`, same posture every other bespoke route here takes.

**Resolver completeness, checked (`backend/CLAUDE.md`'s standing rule):** the `Defect` row this route writes carries exactly the `test_execution_id` shape `_DEFECT_CONFIG`'s existing `resolve_org_id` (`TestExecution`→`TestCycle`→`TestPlan`) already expects — no ADR-0029-style gap, verified with a create-then-immediate-read test (TC-EXEC-007) rather than a create-only assertion.

**`GET /test-cases/{id}/defects`** (new bespoke route, same module, Q1's default). Gated `defect.read`. Resolves the path `TestCase`'s `org_id` via its existing 3-branch resolver (`resolve_test_case_org_id`, ADR-0029) — missing/unresolvable/cross-org → `404`. Joins `TestCaseDefectLink` (`test_case_id` = path id) to `Defect`, ordered `Defect.created_at DESC`, paginated (same `page`/`page_size` defaults as every other list route here). A `TestCase` with zero defects returns `200` with an empty list, not `404` — the case itself exists regardless of whether anything has ever failed against it.

**`CreateDefectForExecutionRequest`** (`app/schemas/execution.py`): `external_ref: str | None`, `severity: DefectSeverity`, `status: str | None = None` (server-side default `"open"` when omitted). `test_execution_id`/`reported_by_actor_id` don't exist on the request schema at all — same "stamped server-side, never client-supplied" posture every other bespoke create route in this codebase already takes for actor/parent-id fields.

**RBAC data migration** (idempotent existence-check-then-insert, the fifth such migration for `test_manager`, mirroring `b7f3a1c9d2e4`/the REQ-3 migration/`e5b21d7c8f40`): backfills `defect.create` for `test_manager`, and `test_case_defect_link.read` for both `test_manager` and `tester`. `rbac_seed_catalog.py`'s `build_role_bundles()` updated in the same change so a fresh seed also gets it.

### Frontend

**`TestCycleDetail`** (no new page): a "Raise Defect" button, next to the existing "History" button, appears only on `fail`-result execution-history rows — opening a `CModal` (`external_ref`, `severity`, `status`) submitting `POST /executions/{id}/defects`. Same attempt-then-error convention this screen family already uses (no permission-based hide/disable) and same "stay open, show the reason inline, never discard typed input" posture `onSubmitRecord`/EXEC-2's comment form already established for a `403`/`422`.

**`EntityFormPage`** (the generic admin surface's only detail view `TestCase` has, `methods = {"get","update","delete"}`, no bespoke `TestCaseDetail` page exists): when `entityKey === "test-cases"`, an additional read-only "Defects" section renders below the edit form, backed by `GET /test-cases/{id}/defects`, most-recent-first exactly as the route returns it (no client-side re-sort needed, unlike `TestCycleDetail`'s own `executed_at`-descending history list, which has no server-side `sort` param to rely on).

**No RBAC change on the frontend side beyond what the migration above grants** — `usePermissions`' existing convention needs no new wiring, just the two new permission codes reaching the roles that need them.

## Consequences

**Positive:** FR-EXEC-3's three ACs are all closed. AC1's "linked... and, via `TestCaseDefectLink`, traceable" is proven at the schema level by the atomic create+link insert and at the test level by a create-then-immediate-read (not a create-only assertion). AC2 (`external_ref` plain text/URL, no live integration) needed zero new mechanism — the column was always a nullable `varchar`. AC3 (most-recent-first) is answered by a genuinely ordered server-side query, not a client-side re-sort of an unordered generic list.

**Negative / accepted trade-offs:**

- **`GET /test-cases/{id}/defects` is new API surface the original API Document's EXEC-3 scope didn't name.** Flagged here rather than silently absorbed — same posture ADR-0030/ADR-0031 already took for their own nested reads added mid-story. The API Document is updated in the same pass to add this row rather than treating it as an undocumented side door.
- **`test_manager`'s bundle has now been extended ad hoc five separate times** (`release.*`; `test_condition.*`/`test_case.*`; `environment.*`/`test_execution.create`+`.read`; and now `defect.create`+`test_case_defect_link.read`). Each extension has its own ADR/migration/test, so the bundle's history stays reconstructable — but the Master Test Plan's own risk row (first raised at the third extension) is worth revisiting as a dedicated RBAC-bundle audit at some point rather than a sixth silent patch next time.
- **No `TestLog` entry is appended when a Defect is raised.** EXEC-2's own scope note explicitly listed "no Raise Defect affordance" as out of its scope; this story stays additive and doesn't retroactively extend `TestLogEventType` for it. Revisit only if a future story's AC literally asks for it.

## Alternatives considered

- **Reuse the existing generic `GET /test-case-defect-links?test_case_id=` + N per-defect `GET /defects/{id}` calls from the frontend**, instead of a new bespoke join route (Q1's rejected default). Rejected: the generic list has no ordering guarantee (UUIDv7 PKs are roughly time-ordered but not a guaranteed `ORDER BY`), and N+1 client-side fetches for what is a single well-defined server-side query is worse for a "most recent first" claim than a purpose-built route, the same reasoning `GET /executions/{id}/logs` (EXEC-2) already used over its own generic-list equivalent.
- **A fixed enum for `Defect.status`** instead of accepting the model's existing free-form `str`. Rejected: the column has been a plain `str` (default `"open"`) since ADR-0027 with no AC anywhere asking for a controlled vocabulary; introducing one now would be a schema change no story text requires.
- **Also granting `test_manager` `defect.update`/`.delete`** while touching this bundle anyway. Rejected: no FR-EXEC-3 AC asks for editing or deleting a raised Defect from this persona; granting either now would be a silent scope expansion, the same restraint ADR-0033 already exercised for `test_execution.update`/`.delete`.
