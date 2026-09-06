# ADR-0031: PLAN-1 TestPlan↔TestSuite membership bespoke routes, coverage query, and status-transition guard

**Status:** Accepted
**Date:** 2026-09-06
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0022](0022-generic-crud-router-factory.md) (generic CRUD router factory — already serves `TestPlan`'s own identifier/scope/approach/staffing/schedule CRUD in full, unaffected by this ADR), [ADR-0030](0030-req4-test-suite-membership-bespoke-routes.md) (REQ-4's `TestSuiteTestCase` membership routes — direct template this ADR follows for `TestPlanTestSuite`), [ADR-0004](0004-rbac-design.md) (human-only Approval, RBAC-5 — the boundary this ADR's transition guard deliberately does *not* enforce, see Consequences), [FR-PLAN-1](../requirements/2026-09-03-project-scaffold-requirements.md#25-test-planning--test-planning-storiesmd), [Database Document §3.7](../database/2026-09-03-database-design.md#37-planningpy--testplan-entryexitcriteria-testcycle-environment--junction), [API Document §4](../api/2026-09-03-api-design.md#4-bespoke-routes), [TC-PLAN-001/002/003](../test-cases/2026-09-03-test-cases.md#test-planning)

## Context

`TestPlan` (identifier/scope/approach/staffing_and_training/schedule, project-scoped) already has full generic CRUD via ADR-0022's factory — `POST /test-plans` already creates a row with `status=draft` by column default, closing PLAN-1's AC1 with zero new route code. The two gaps FR-PLAN-1 actually needs closed:

1. **Many-to-many scope side.** `TestPlanTestSuite` (migrated in the initial schema, model present) had no route at all, same shape REQ-4 found for `TestSuiteTestCase` before ADR-0030. AC2's "which TestCases does executing this plan cover" claim has nothing to call without both a membership route and a coverage query — `docs/api/2026-09-03-api-design.md` §4 only ever reserved the `POST` row for this (never the `DELETE`/`GET` siblings or a coverage route), same partial-reservation shape ADR-0030 found for REQ-4.
2. **Status-transition legality.** The generic factory's `PATCH /test-plans/{id}` accepts an arbitrary `status` value in the body — nothing today stops a `draft`→`superseded` direct write, or a backward `approved`→`draft` write, even though AC3 and [Test Design §5](../test-design/2026-09-03-test-design.md#5-state-transition-testing) both specify `draft → approved → superseded` as the only legal path. Left unguarded, TC-PLAN-003's negative case (`draft`→`superseded` directly rejected) has nothing to assert against.

Three decisions were needed before writing anything, resolved by direct CTO confirmation (2026-09-06), not left to implementation-time judgment:

1. **Cross-project add**, same question ADR-0030 answered for `TestSuiteTestCase`: `TestPlan.project_id` and `TestSuite.project_id` can differ even within the same org. Decided: **reject** (`422`), same posture and same rationale as ADR-0030 — a plan's scope is meant to be that plan's own project's suites, not an arbitrary cross-project mix. Simpler to resolve than REQ-4's case, since both `TestPlan` and `TestSuite` carry a *direct* `project_id` column — no resolver-branch fan-out to worry about (contrast ADR-0030's three-branch `TestCase` resolver).
2. **Duplicate add**: the `(test_plan_id, test_suite_id)` unique constraint already exists at the schema level. Decided: **409** (`already_included_in_plan`), same idempotency-conflict posture as ADR-0030's `already_in_suite` — the fourth distinct `409` meaning in this API (see Decision below), not reused verbatim as `already_in_suite` itself, since the two conflicts are about different relationships and a client distinguishing them by route family still needs a distinct code to log/branch on.
3. **Status-transition legality now, ahead of GOV-1's own `/approve` route.** GOV-1 (a separate, not-yet-built story) owns *who* may transition a plan to `approved` — a human-only, double-enforced gate (RBAC-5) on its own dedicated `POST /test-plans/{id}/approve` route. That is a narrower question than *which* transitions are ever legal at all, which is what AC3/TC-PLAN-003 actually test. Decided: add the transition-legality guard to the generic `PATCH /test-plans/{id}` route now, independent of GOV-1's landing — otherwise PLAN-1 ships with a real hole (any transition, any order, freely writable) that GOV-1 would silently have to close later, and TC-PLAN-003's negative case would have nothing to assert against until GOV-1 exists. See Consequences for the trade-off this creates.

## Decision

### Three new bespoke routes, one new module

`app/api/routes/test_plan_membership.py` (kept separate from `planning.py`'s generic-factory-only scope, same split ADR-0028/ADR-0030 established for their own bespoke modules):

```
POST   /test-plans/{id}/test-suites/{suite_id}   test_plan.update   -- include suite in plan (join row)
DELETE /test-plans/{id}/test-suites/{suite_id}   test_plan.update   -- remove suite from plan
GET    /test-plans/{id}/test-suites              test_plan.read     -- live list of included suites
GET    /test-plans/{id}/test-cases                test_plan.read     -- coverage query (below)
```

`POST`/`DELETE`/`GET .../test-suites` reuse the exact shape ADR-0030 established: fetch the `TestPlan` row, resolve its `org_id` via the same `chain_resolver([])` `_TEST_PLAN_CONFIG` already uses, `404` on missing/cross-org, `has_permission` called directly (no `org_id` path segment at this depth) for `403`. The `TestSuite` side resolves via its own existing `chain_resolver([])` (`_TEST_SUITE_CONFIG`) — no new resolver logic, same reuse posture ADR-0030 established for `resolve_test_case_org_id`.

**Include** (`POST`), in order:
1. `TestPlan`/`TestSuite` both exist and resolve to the caller's org → else `404` (existence-hiding, NFR-1).
2. `TestSuite.project_id` equals `TestPlan.project_id` → else `422 validation_error` (same-org, cross-project rejection, decision #1 above — simpler than ADR-0030's check since both sides are direct columns, no branching resolver to walk).
3. Insert `TestPlanTestSuite(test_plan_id, test_suite_id)` → `IntegrityError` on the unique constraint → rollback → `409 already_included_in_plan` (decision #2 above), the fourth distinct `409` meaning this API now carries (alongside `restrict_blocked`, `signup_closed`, `already_in_suite`) — see API Document §1's revised error-code note.

**Remove** (`DELETE`): same `404`/`403` boundary; the join row not existing → `404` — same asymmetric-with-`POST` posture ADR-0030 established (a `DELETE`'s "already true" case reads as not-found, not conflict).

**List suites** (`GET .../test-suites`): same `404`/`403` boundary, gated `test_plan.read`. Returns every `TestSuite` currently joined via `TestPlanTestSuite` as `TestSuiteSummary[]`, paginated, `{items, total, page, page_size}` — a live query against the join table, same posture ADR-0030's own membership-list route established.

### New coverage query — `GET /test-plans/{id}/test-cases`

AC2's literal wording is "which TestCases does executing this plan cover," not "which TestSuites are included" — a suites-list alone doesn't answer that question, it only answers a one-hop-shallower one. This route resolves the full two-hop chain in one call: `TestPlan` → (every included `TestSuite` via `TestPlanTestSuite`) → (every `TestCase` in each, via `TestSuiteTestCase`) → a **deduplicated** `TestCaseSummary[]` (a `TestCase` belonging to two different suites both included in the same plan is returned once, not twice — `SELECT DISTINCT` on `test_case.id`, not a naive join-and-list). Same `404`/`403` boundary, gated `test_plan.read`; a plan with zero included suites, or suites with zero members, returns `200` with an empty list, not an error — same "valid, common state" posture ADR-0030's zero-membership case established.

### Status-transition guard on the generic `PATCH /test-plans/{id}`

Applies only when the request body includes a `status` field — every other field (`identifier`/`scope`/`approach`/`staffing_and_training`/`schedule`) is unaffected, still a plain partial update via ADR-0022's existing factory code path. When `status` is present, the new value is checked against the current row's `status` before the update is applied:

| Current | Requested | Result |
|---|---|---|
| `draft` | `approved` | Allowed |
| `approved` | `superseded` | Allowed |
| `draft` | `superseded` | `409 invalid_status_transition` |
| `approved` | `draft` | `409 invalid_status_transition` |
| `superseded` | anything | `409 invalid_status_transition` (terminal state) |
| `draft` | `draft`, `approved` | `approved` | `409 invalid_status_transition` (idempotent re-approval, Test Design §5) |

Same `409 invalid_status_transition` code regardless of which illegal pair was attempted — a client distinguishing the specific violation reads it from the request/current-state pair it already has, not from a per-pair error code. This is the fifth distinct `409` meaning this API now carries (alongside `restrict_blocked`, `signup_closed`, `already_in_suite`, `already_included_in_plan`).

### No RBAC catalog change

`test_manager` already holds `test_plan.*` + `.approve` (Database Document §3.3, RBAC-4's original seed) and `test_suite.*` — both permission codes these routes gate on (`test_plan.update`/`.read`, `test_suite.read` implicitly via the `TestSuite` resolver reuse) are already reachable without a new migration, same "no bundle change needed" outcome ADR-0030 reached for REQ-4.

## Consequences

**Positive:** Closes the only real gaps FR-PLAN-1 had (membership + coverage query — `TestPlan`'s own entity CRUD was already complete). Reuses 100% of existing resolver/permission-check primitives, no new backend architecture. TC-PLAN-003's negative case (`draft`→`superseded` rejected) now has a real mechanism to assert against, not a permanently-undeliverable test.

**Negative / accepted trade-offs:**
- **The transition guard governs *legality*, not *authority*.** Until GOV-1's dedicated `POST /test-plans/{id}/approve` ships (human-only, RBAC-5-enforced), any actor holding `test_plan.update` — including an `AIAgent` under `test_manager`'s bundle, since `ai_agent_scoped` doesn't hold `test_plan.update` today but a future custom bundle could — can move a plan `draft`→`approved` via the plain generic `PATCH`, with no human-only check at all. This is a known, explicitly flagged gap, not a silent hole: GOV-1 is next on the WBS critical path specifically to close it (its own human-only gate applies *in addition to* this ADR's legality guard, not instead of it — once GOV-1 ships, `draft`→`approved` remains reachable via both the dedicated `/approve` route *and* the generic `PATCH`, until/unless a future ADR narrows `PATCH`'s own `status` field further). Accepted because blocking the legality guard on GOV-1's own unrelated timeline would leave TC-PLAN-003 permanently unsatisfiable, a worse outcome than a flagged, temporary authority gap.
- **A fourth and fifth `409` meaning** (`already_included_in_plan`, `invalid_status_transition` — alongside `restrict_blocked`/`signup_closed`/`already_in_suite`) is two more code paths a client must distinguish by route family — accepted per the same precedent ADR-0030 already established (a `409` meaning is scoped to its own route family, never a universal "conflict" semantic in this API).
- **Cross-project add being a hard `422`** (no opt-in override) — same accepted trade-off ADR-0030 made for `TestSuiteTestCase`, for the same reason: no story or persona interview asked for cross-project plan/suite sharing.

## Alternatives considered

- **Route the status-transition guard through a bespoke `PATCH`-alternative instead of the generic factory's existing `PATCH`** — rejected: would fragment `TestPlan`'s update surface into two routes for what's still logically one partial-update operation, and every other field on `TestPlan` has no such split; a body-shape-conditional check inside the existing factory-produced handler is a smaller, more honest diff than a second route.
- **Defer the transition guard entirely until GOV-1 ships**, reasoning that "no legality check + no authority check" is at least consistent — rejected: leaves TC-PLAN-003 (already written, already release-blocking per the Master Test Plan) with nothing to test, and ships a materially worse gap (anyone can move a plan anywhere, not just skip the human-only check on one specific transition) for a longer window.
- **Have `PATCH`'s status guard also enforce GOV-1's human-only rule pre-emptively** (reject any `status: approved` write from an `AIAgent`, even via generic `PATCH`) — rejected: this ADR's own scope is PLAN-1, not GOV-1; folding GOV-1's authority rule in here would mean re-deciding it without GOV-1's own ADR process, and would leave a second, undocumented copy of that rule to keep in sync once GOV-1 lands its own.
- **`422` instead of `409` for an invalid transition** — rejected: same reasoning ADR-0030 already applied to duplicate-add — this is "the request is well-formed but conflicts with the resource's current state," the textbook `409 Conflict` case, not malformed input.
