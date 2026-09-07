# ADR-0034: EXEC-1 TestExecution recording screen + live dashboard aggregation (no new backend route)

**Status:** Accepted
**Date:** 2026-09-07
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0033](0033-plan3-test-cycle-creation-and-execution-scope-check.md) (built `POST /test-cycles/{id}/executions` — this story's own create path — and the `test_manager` RBAC grant, ahead of this story being separately scoped), [ADR-0020](0020-admin-shell-full-template-parity.md) (FR-SHELL-3's "reuse existing generic-CRUD list `total`, no new route" precedent this ADR applies to the dashboard), [ADR-0031](0031-plan1-test-plan-membership-and-status-transition-routes.md) (`GET /test-plans/{id}/test-cases` coverage query, reused here to scope the record-result picker), [FR-EXEC-1](../requirements/2026-09-03-project-scaffold-requirements.md#26-test-execution--defects--test-execution-defect-storiesmd), [Database Document §3.8](../database/2026-09-03-database-design.md), [API Document §4](../api/2026-09-03-api-design.md), [TC-EXEC-001/002/003](../test-cases/2026-09-03-test-cases.md)

## Context

ADR-0033 already built everything FR-EXEC-1 AC1 needs at the backend layer: `POST /test-cycles/{id}/executions`, gated `test_execution.create`, stamps `executed_by_actor_id`/`executed_at` server-side, and is a plain insert with no upsert (so AC3's "re-run creates a new row, not an overwrite" already holds structurally — it was never built any other way). `test_manager` already holds `test_execution.create`/`.read`. What ADR-0033 explicitly deferred (Consequences: "EXEC-1, when it lands, extends this route's *response*/*dashboard* surface, not its create/gate logic") is everything AC2 and the actual UI need:

- No frontend screen calls `POST /test-cycles/{id}/executions` at all yet (sitemap's reserved `TestExecutionRunner` path, `entityConfigs/test-execution.ts`'s own docstring).
- No dashboard aggregation (AC2) exists anywhere — pass/fail/blocked/skipped counts are not surfaced.
- AC1's create path is reachable but there is no create-then-immediate-read integration test proving resolver completeness for this exact response shape from the UI's perspective, and no test yet asserts AC3's re-run claim directly (ADR-0033's own tests cover the *scope-check*, not the *history-preservation* claim).

## Decision

### Backend — no new route

**AC2's dashboard reuses the existing generic factory list route, the same posture FR-SHELL-3 established (NFR-27, [ADR-0020](0020-admin-shell-full-template-parity.md)):** four calls, one per `result` value, each `GET /test-executions?test_cycle_id=<id>&result=<pass|fail|blocked|skipped>&page_size=1`, reading only the response's `total` field (the count), never its `items`. No new aggregate/summary endpoint is added. This keeps the dashboard "live" (AC2's own literal requirement — no manually maintained summary) for free: the count comes from the same `TestExecution` table `TestExecutionSummary`/the generic factory's `list` already queries, on every render, with no denormalized snapshot anywhere to go stale. The existing composite index `(test_cycle_id, test_case_id)` (Database Document §3.8) does not itself cover `result`-filtered counting, but at scaffold scale (a `TestCycle`'s own execution count) this is not a query worth a dedicated aggregate route or a new index for — same proportionality judgment ADR-0020 made for the org-home widgets.

AC3 (re-run history) needs no route change — `execution_authoring.py`'s create is already a plain `db.add`/`flush`, no lookup-existing-then-update. What was missing was a *test* proving it, not code.

Two integration tests close the gap ADR-0033 left open:

- **TC-EXEC-002** (dashboard aggregation): seed one `TestCycle` with a deliberately mixed set of `TestExecution` rows (at least one of each `result` value), then call the four filtered-list `page_size=1` requests and assert each `total` matches the seeded count for that value exactly — not inferred from one result value's count being right.
- **TC-EXEC-003** (re-execution history): `POST /test-cycles/{id}/executions` twice for the same `test_cycle_id`+`test_case_id` pair (different `result` each time), assert `201` both times with two distinct `id`s, assert both rows independently readable via `GET /test-executions/{id}`, and assert the first row's `result`/`actual_result` are byte-for-byte unchanged after the second `POST` — an overwrite bug would silently pass a test that only checks "two rows exist" without also re-reading the first one.

### Frontend — one new bespoke screen, `TestCycleDetail`

Route: `/projects/:projectId/test-plans/:testPlanId/test-cycles/:testCycleId` — nested under `TestPlanDetail`'s own route, matching that screen's own established "dedicated per-entity page, not an expand-in-place section" precedent ([PLAN-1 UI Design Document](../ui-design/2026-09-06-plan-1-test-plan-membership-ui-design.md) §1) for exactly the same reason: a `TestCycle`'s own execution history and dashboard is enough surface to need its own addressable URL, and `TestPlanDetail`'s "Test Cycles" section (ADR-0033) already anticipated this by making each cycle row link out rather than expand in place. Full layout: [EXEC-1 UI Design Document](../ui-design/2026-09-07-exec-1-test-execution-recording-ui-design.md).

Three sections:

1. **Dashboard** — four stat tiles (Pass/Fail/Blocked/Skipped), each sourced from its own filtered-list `total` per the backend decision above. Refetched (not manually incremented) after every successful "Record Result" submission — the same "always reflects the server's own current state" posture every other `TestPlanDetail` section already uses, and the literal mechanism that makes AC2's "live, not manually maintained" claim true on the frontend, not just the backend.
2. **Execution history** — a flat list (`frontend/CLAUDE.md`'s nested-`<CTable>` a11y rule — this is not itself a nested list, but kept flat regardless since it's the outermost list on this screen), `GET /test-executions?test_cycle_id=<id>`, ordered `executed_at` descending, each row showing `test_case_id` (resolved to its title), `result`, `actual_result`, `executed_at`, and the executing actor's display name.
3. **Record Result modal** — `test_case_id` (`FkAutocomplete`, **scoped to `GET /test-plans/{id}/test-cases`'s own result set**, not every `TestCase` in the project — see Decision below), `result` (enum select), `actual_result` (textarea), `executed_at` (defaults to now, editable). Submits `POST /test-cycles/{id}/executions`. A `422` (out-of-scope `TestCase`, should be structurally unreachable given the scoped picker, but the route is still the enforcement boundary per NFR-10) renders as a dismissible `CAlert`, same convention as every other section on this family of screens.

**Test-case picker scoped to the plan's own coverage query, not every project `TestCase`:** the picker's options come from `GET /test-plans/{id}/test-cases` (`test_cycle.test_plan_id` resolved client-side first), the exact same join `POST /test-cycles/{id}/executions`'s own scope-check (ADR-0033) already enforces server-side. This is a UX decision, not a security one — the backend gate is what actually prevents an out-of-scope submission, and stays authoritative regardless of what the picker offers (NFR-10) — but presenting only legal choices avoids a QA lead hitting a confusing 422 on a case that looks selectable. Rejected alternative: an unscoped picker over every project `TestCase` relying on the 422 to catch mistakes — technically correct but a worse experience with zero benefit, since the coverage query the picker would need already exists and needs no new backend work to reuse.

**Actor display for `executed_by_actor_id`:** resolves to either a `User`'s name or an `AIAgent`'s name via whatever shared actor-display convention `created_by_actor_id` already renders with elsewhere on this screen family (no new mechanism — same shared Actor model, ADR-0004).

**No RBAC change.** `test_manager` already holds `test_execution.create`/`.read` (ADR-0033); no FR-EXEC-1 acceptance criterion asks for a broader grant, and this ADR does not add one — same minimal-grant posture ADR-0033 itself took.

**Out of scope, explicitly:** EXEC-2 (`TestLog` timeline/status-change-log UI) and EXEC-3 (raise-a-`Defect`-from-a-failed-execution UI) are untouched by this ADR — no stub, no placeholder button. `TestExecutionRunner`'s reserved sitemap entry is only partially resolved by this pass (FR-EXEC-1 only, not FR-EXEC-2/3).

## Consequences

**Positive:** Closes FR-EXEC-1 AC1/AC2/AC3 completely with zero new backend routes and zero schema changes — the backend was already load-bearing for this story since ADR-0033. Dashboard counts can never drift from real data because there is no separate aggregate query or cache to drift; the same generic list route every other entity's admin page already exercises is the only thing being called.

**Negative / accepted trade-offs:**

- **Four HTTP round-trips to render one dashboard**, instead of one dedicated aggregate endpoint. Accepted at scaffold scale (a `TestCycle`'s own execution count is not expected to be large); revisit with a dedicated `GET`-with-`GROUP BY` route only if a future story's scale requirement makes four small requests measurably worse than one bigger one — not speculatively built now.
- **The test-case picker's scoping duplicates, client-side, the same join the backend already enforces.** Accepted as a UX-only convenience (NFR-10 unchanged: the backend stays the actual boundary) — if `GET /test-plans/{id}/test-cases`'s own join ever changes, the picker and the create route's scope-check could in principle diverge, but they're the *same* backend route on both sides (ADR-0033 already pinned the create route's own `EXISTS` check to this exact query for the same reason), so there is no second implementation to drift.
- **EXEC-2/EXEC-3 UI stays unbuilt.** A QA lead recording a `fail` result today has no in-UI path to raise a `Defect` or see a status-change log — acceptable, since neither is this story's own scope, but worth flagging so it isn't mistaken for an oversight in this pass specifically.

## Alternatives considered

- **A dedicated `GET /test-cycles/{id}/execution-summary` aggregate route** (single `GROUP BY result` query, one round trip). Rejected for now: no FR/NFR asks for it, FR-SHELL-3's own precedent (NFR-27) already established "reuse existing list totals, no new route" as this codebase's default posture for exactly this shape of requirement, and four `page_size=1` requests is a cheap, already-existing query shape rather than new backend code with its own new test surface.
- **An unscoped test-case picker** relying entirely on the backend's `422` to catch out-of-scope selections. Rejected — see Decision above; strictly worse UX for zero additional correctness, since the scoping query already exists.
- **Granting a broader RBAC bundle** (e.g. `tester` role also gaining `test_execution.create`) as part of this pass. Rejected: no story text asks for it; a role-bundle change is its own decision, not a silent side effect of a UI story landing.
