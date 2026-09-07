# ADR-0033: PLAN-3 TestCycle creation + execution scope-check bespoke routes

**Status:** Accepted
**Date:** 2026-09-06
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0031](0031-plan1-test-plan-membership-and-status-transition-routes.md) (PLAN-1's `TestPlan`↔`TestSuite` membership + coverage query, reused verbatim by this ADR's scope-check), [ADR-0032](0032-plan2-entry-exit-criteria-visibility.md) (`TestPlanDetail`, the screen this ADR extends with a 5th section), [ADR-0019](0019-release-creation-flow.md) (`test_manager`/`release.*` RBAC-extension precedent this ADR's own migration follows), [ADR-0028](0028-req3-test-condition-rigor-path-bespoke-routes.md) (the "restrict generic `create` before/with a bespoke atomic route" precedent this ADR applies to `TestExecution`), [ADR-0030](0030-req4-test-suite-membership-bespoke-routes.md) (cross-project `422`, `chain_resolver` reuse pattern), [ADR-0022](0022-generic-crud-router-factory.md) (generic CRUD factory — still serves `TestCycle`'s `GET`/`PATCH`/`DELETE` and `Environment`'s full CRUD, unaffected by this ADR), [FR-PLAN-3](../requirements/2026-09-03-project-scaffold-requirements.md#25-test-planning--test-planning-storiesmd), [FR-EXEC-1](../requirements/2026-09-03-project-scaffold-requirements.md#26-test-execution--defects--test-execution-defect-storiesmd), [Database Document §3.7/§3.8](../database/2026-09-03-database-design.md), [API Document §3/§4](../api/2026-09-03-api-design.md), [TC-PLAN-006/007/008](../test-cases/2026-09-03-test-cases.md#test-planning)

## Context

`TestCycle` and `Environment` (Database Document §3.7) and `TestExecution` (§3.8) have existed at the model/migration layer since the initial schema. What's been deliberately missing, reserved for this story by name in three separate places (`app/api/routes/planning.py`'s module docstring, `app/schemas/planning.py`'s module docstring, API Document §3 footnote `******`), is `TestCycle`'s own `create` — the generic factory registers only `GET`/`PATCH`/`DELETE` for it. `Environment` already has full generic CRUD (including `create`) since ADMIN-2 — FR-PLAN-3 AC2's "admin screen" half of environment creation needed no new work. `TestExecution` already has full generic CRUD too (ADR-0027), including an unrestricted `POST /test-executions` — but nothing enforces FR-PLAN-3 AC3's scope rule against it, and no bespoke `POST /test-cycles/{id}/executions` exists yet, despite already being named in both the API Document §4 (with a "PLAN-3 scope check" annotation) and the MCP tool table (§6, `create_test_execution`) as the target shape.

FR-EXEC-1's own acceptance criteria says explicitly: *"Given a TestCase that's in scope for an active TestCycle (**per PLAN-3**)..."* — EXEC-1 is written assuming PLAN-3's own scope gate already exists as a precondition it can build on. Since the only create-execution path that exists today (`POST /test-executions`) enforces no such gate, closing FR-PLAN-3 AC3 for real means building *something* create-shaped to reject against — the plain generic route provides no hook for a cross-entity business-rule check, and the docs already commit both stories to the same bespoke route rather than two independent ones.

**Confirmed directly (2026-09-06), not left to implementation-time judgment:**

1. `POST /test-plans/{id}/test-cycles` validates that `release_id` and `environment_id` each resolve to the *same project* as the target `TestPlan` — same cross-project-rejection posture ADR-0030/ADR-0031 already established for suite/plan membership, applied here even though no story text says so explicitly (every other cross-entity link route in this codebase does this check; leaving `TestCycle` as the one exception would be an unreviewed inconsistency, not a deliberate simplification).
2. This ADR builds the **full** `POST /test-cycles/{id}/executions` route now — create + PLAN-3's scope-check together — rather than only a reusable scope-check helper for EXEC-1 to wire up later. TC-PLAN-008 needs a real create path to reject against, and API Document §4/§6 already fix this as the one route both stories share.
3. `test_manager`'s RBAC bundle is extended with `environment.create`/`.read`/`.update`/`.delete` (full CRUD parity — it held none of the four before this ADR) and `test_execution.create`/`.read` **only** (not `.update`/`.delete` — those stay open for EXEC-1/EXEC-3 to decide when re-run-editing/defect-workflow needs land).
4. AC2's "create an Environment inline while setting up a TestCycle" is a **frontend-only, sequential-calls** flow — `POST /environments` then `POST /test-plans/{id}/test-cycles` with the returned id — not a new atomic combined backend route. `environment_id` is a plain FK with no link-table side effect, unlike the atomic create+link routes ADR-0028/ADR-0029 built for `TestCondition`/`TestCase`; there's nothing here for an atomic route to protect that two sequential calls don't already get correctly.

## Decision

### Backend — two new bespoke routes, one generic-factory restriction, one RBAC migration

**`POST /test-plans/{id}/test-cycles`** (`app/api/routes/test_cycle_creation.py`, new module — same "one bespoke module per membership/creation concern" split ADR-0028/ADR-0030/ADR-0031 already established), gated `test_cycle.create`:

1. Fetch the `TestPlan` named by `id`; resolve its `org_id` via `_TEST_PLAN_CONFIG`'s existing `chain_resolver([])`. Missing plan, or caller has no `OrgMembership` in the resolved org → `404` (indistinguishable, NFR-1).
2. `has_permission(actor_id, org_id, "test_cycle.create")` → `403` if false.
3. Fetch `Release` by `release_id`: missing, or resolves to a different org → `404` (existence-hiding — no target-org existence to leak). Resolves to the *same org, different project* → `422 validation_error` (business-rule rejection, caller already proved org membership, ADR-0030/ADR-0031's posture). Same three-way check for `Environment` by `environment_id`.
4. Insert `TestCycle(test_plan_id=plan.id, release_id=..., environment_id=..., name=..., start_date=..., end_date=...)`; flush, catch `IntegrityError` → `422` (mirrors every other bespoke create route's posture).

No new resolver-completeness risk (contrast ADR-0029): `TestCycle`'s own resolver (`chain_resolver([(TestPlan, "test_plan_id")])`) already exists and this route produces no row shape it doesn't cover — the FK it writes (`test_plan_id`) is exactly the one hop that resolver already walks.

**`POST /test-cycles/{id}/executions`** (`app/api/routes/execution_authoring.py`, new module), gated `test_execution.create`:

1. Fetch the `TestCycle` named by `id`; resolve its `org_id` via `execution.py`'s existing `_resolve_test_execution_org_id`-shaped chain (`TestCycle.test_plan_id` → `TestPlan.project_id` → `Project.org_id`). Missing cycle, or no `OrgMembership` in the resolved org → `404`.
2. `has_permission(actor_id, org_id, "test_execution.create")` → `403` if false.
3. Fetch the `TestCase` named by the body's `test_case_id`, using `TestCase`'s existing 3-branch resolver (ADR-0029) — missing, or resolves to a different org → `404` (existence-hiding; this subsumes the cross-project case, since a cross-project `TestCase` can never legally be a suite member of a suite included in this cycle's plan to begin with — REQ-4's and PLAN-1's own upstream `422` checks already prevent that link from ever existing).
4. **PLAN-3 scope check:** run the same two-hop `TestPlan → TestSuite → TestCase` membership query `GET /test-plans/{id}/test-cases` (ADR-0031) already uses — `TestSuiteTestCase` joined to `TestPlanTestSuite` joined on the cycle's own `test_plan_id`, filtered to this specific `test_case_id`, `EXISTS` rather than the full paginated list. Not a member of any included suite → `422 validation_error` (business-rule rejection — this is FR-PLAN-3 AC3's own literal claim, not a tenant boundary, so never `404`).
5. Insert `TestExecution(test_cycle_id=cycle.id, test_case_id=..., result=..., actual_result=..., executed_at=..., executed_by_actor_id=actor.actor_id)` — `executed_by_actor_id` stamped from the authenticated actor, never client-supplied, same posture the existing generic `CreateTestExecutionRequest`'s docstring already established for this field. Flush, catch `IntegrityError` → `422`.

This route delivers only what FR-PLAN-3 AC3 and FR-EXEC-1 AC1's own literal text require — a gated create. Dashboard aggregation (EXEC-1 AC2) and re-run history assertions (EXEC-1 AC3) are unaffected either way (they're read-side/insert-shape concerns this route's plain insert already satisfies for free) but are not additionally built or tested here; raising a `Defect` (EXEC-3) is untouched.

**Generic-factory restriction** (`app/api/routes/execution.py`): `_TEST_EXECUTION_CONFIG.methods` drops `"create"`, `create_schema=None` — same posture `TestCase`/`TestCondition`/`Defect` already have. Required the same commit this bespoke route lands, per the standing rule (`backend/CLAUDE.md`): leaving the generic `POST /test-executions` reachable alongside the new bespoke route would let any caller bypass the scope check entirely by using the unrestricted path.

**RBAC migration** (new Alembic data migration, chained on `a91c4e0f7db5`, same idempotent existence-check-then-insert shape as the three prior `test_manager` bundle extensions — `b7f3a1c9d2e4`/`release.*`, the REQ-3 migration/`test_condition.*`+`test_case.*`): grants `test_manager`:

- `environment.create`, `environment.read`, `environment.update`, `environment.delete` (full CRUD — it held none of the four before this ADR, a pre-existing RBAC-4 seed gap the same class as ADR-0019's `release.*` fix, surfaced by AC2's own "user with `environment.create` permission" wording naming Priya's role directly).
- `test_execution.create`, `test_execution.read` (minimum to pass TC-PLAN-008 and reach FR-EXEC-1 AC1 as its own persona; `.update`/`.delete` deliberately withheld — no story text yet asks `test_manager` to edit/delete an execution result, and granting them now would be a silent scope expansion this ADR doesn't need).

`editing rbac_seed_catalog.py` alone is edited too (for a *fresh* DB's initial seed to match), but does not itself backfill an already-seeded database — the migration is the actual fix, per `backend/CLAUDE.md`'s standing rule.

### Frontend

**`entityConfigs/test-cycle.ts` stays without `"create"`** — `TestCycle` has no factory-registered `create` route (this ADR keeps it bespoke-only, same posture `TestCase`/`TestCondition` already have on the admin surface), so there is no admin-surface fallback for creating one. The only create path is:

**`TestPlanDetail.tsx`** gains a 5th section, "Test Cycles" (placed after PLAN-2's "Entry/Exit Criteria" section, per the same "next section down" convention every prior PLAN-* addition to this screen has used): a live list (`GET /test-cycles?test_plan_id=<testPlanId>`, the existing generic factory list route) and a "Create Cycle" modal with fields `release_id` (`FkAutocomplete` against `release`), `environment_id` (`FkAutocomplete` against `environment`, plus an inline "+ New Environment" toggle switching that one field to a nested create-then-select flow — `POST /environments` first, the returned `id` used as `environment_id` in the subsequent `POST /test-plans/{id}/test-cycles` call, two sequential requests per Decision #4 above, not one atomic call), `name`, `start_date`, `end_date`. Submits the new bespoke route, not the generic factory's create (which doesn't exist for this entity — see restriction above). Re-fetches the list afterward, same "always reflects the server's own current state" posture every other section on this screen already uses. A `422`/`403` renders as a dismissible `CAlert`, same convention as every other section.

Full UI layout, empty states, and edge cases: see the new [PLAN-3 UI Design Document](../ui-design/2026-09-06-plan-3-test-cycle-creation-ui-design.md).

## Consequences

**Positive:** Closes FR-PLAN-3 AC1/AC2/AC3 completely. Delivers FR-EXEC-1 AC1's own create path as a side effect (the route both stories were always going to share), without pulling forward EXEC-1's dashboard-aggregation or re-run-history work, which stay that story's own scope. Reuses PLAN-1's coverage-query join verbatim for the scope check — no new query shape invented, no risk of the two checks (coverage-query listing vs. scope-check `EXISTS`) drifting apart over time since they're built from the same join.

**Negative / accepted trade-offs:**

- **This ADR builds part of FR-EXEC-1's own route ahead of that story being separately scoped.** Accepted because the alternative — a scope-check helper with no caller — would leave TC-PLAN-008 unautomatable, and the API Document already fixed both stories to the same route before either was implemented. EXEC-1, when it lands, extends this route's *response*/*dashboard* surface, not its create/gate logic.
- **`test_manager` still cannot `PATCH`/`DELETE` a `TestExecution`.** If EXEC-1/EXEC-3 need that, it's their own RBAC migration to write — not silently expanded here.
- **The scope-check is a business-rule `422`, not a `404`,** even though "TestCase not in scope" might intuitively feel like a not-found. Kept consistent with every other cross-entity membership rejection in this codebase (ADR-0030/ADR-0031): the caller has already proven org membership and resolved the `TestCase` to a real row, so there's no existence left to hide.
- **`TestCycle` duplicate names within one `TestPlan` are allowed** (no unique constraint) — same non-uniqueness stance ADR-0019 took for `Release.version_label`, not revisited here.

## Alternatives considered

- **A `create_guard` hook on `CrudEntityConfig`** (mirroring the existing `update_guard` PLAN-1's status-transition check uses), re-enabling `TestCycle`'s generic `create` with a guard doing the cross-project release/environment check, instead of a fully bespoke route. Rejected: `TestCycle` creation needs to fetch and validate *two* separate related rows (`Release`, `Environment`) beyond the entity's own scope field, a shape the generic factory's single-row `create_item` path has no precedent or hook for (unlike `update_guard`, which only inspects the row being updated and the request body) — a bespoke route stays consistent with how every other multi-entity-validation create in this codebase (PLAN-1/REQ-4's membership routes) is built.
- **A shared scope-check helper only, no route, deferring `POST /test-cycles/{id}/executions` entirely to EXEC-1.** Rejected per Decision #2 above — leaves TC-PLAN-008 without anything to call.
- **An atomic `POST /test-plans/{id}/test-cycles` that accepts an inline `environment` object and creates both rows in one call**, instead of two sequential frontend calls. Rejected per Decision #4 above — no link table involved, so there's no atomicity property sequential calls would actually lose; matches how simple a plain-FK relationship should stay.
- **Granting `test_manager` full `test_execution.*` CRUD** (parity with the `test_condition.*`/`test_case.*` precedent), instead of `.create`/`.read` only. Rejected for now: no FR-PLAN-3 or FR-EXEC-1 acceptance criterion asks `test_manager` to edit or delete a recorded result: minimal grant now, extend later if EXEC-1/EXEC-3 need to.
