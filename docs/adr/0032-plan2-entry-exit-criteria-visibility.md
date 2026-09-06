# ADR-0032: PLAN-2 EntryExitCriteria visibility — TestPlanDetail full CRUD section + nested exit-criteria on the Release→TestCycle audit query

**Status:** Accepted
**Date:** 2026-09-06
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0031](0031-plan1-test-plan-membership-and-status-transition-routes.md) (PLAN-1's `TestPlanDetail` route this story extends), [ADR-0019](0019-release-creation-flow.md) (the `GET /releases/{id}/test-cycles` audit query this ADR changes the response shape of), [ADR-0022](0022-generic-crud-router-factory.md) (generic CRUD factory — already serves `EntryExitCriteria`'s own CRUD in full, unaffected by this ADR), [FR-PLAN-2](../requirements/2026-09-03-project-scaffold-requirements.md#25-test-planning--test-planning-storiesmd), [Database Document §3.5/§3.7](../database/2026-09-03-database-design.md), [API Document §3/§4](../api/2026-09-03-api-design.md), [TC-PLAN-004/005/012/013](../test-cases/2026-09-03-test-cases.md#test-planning)

## Context

Unlike every prior PLAN-* gap, `EntryExitCriteria` itself needs **zero new backend route code** — it was already one of ADR-0022's factory-served entities (full CRUD: `POST`/`GET`/`PATCH`/`DELETE /entry-exit-criteria`, one-hop `test_plan_id → TestPlan.project_id` resolver, already correct) since ADMIN-2 (confirmed directly against `backend/app/models/planning.py`, `app/api/routes/planning.py`, `app/schemas/planning.py` — no gap of the class ADR-0029/ADR-0030 found elsewhere). The two real gaps FR-PLAN-2 needs closed are both **read/write-surface**, not new entity plumbing:

1. **AC1 has nowhere to be exercised from a TestPlan's own screen.** `TestPlanDetail.tsx` (ADR-0031) explicitly reserved "no entry/exit-criteria UI (PLAN-2)" as a non-goal — a user can only reach `EntryExitCriteria` today via the generic admin surface's own `/projects/:projectId/admin/entry-exit-criteria` page, which lists **every** criteria row for the whole project, not scoped to "listed against that plan" the way AC1's literal wording asks for.
2. **AC2's "one view" claim has no route to back it.** `GET /releases/{id}/test-cycles` (ADR-0019) already nests each `TestCycle`'s `TestExecution`s — the "execution progress" AC2 refers to — but nests nothing from `EntryExitCriteria` at all. Today, seeing a plan's exit criteria next to a cycle's executions requires a second, separate navigation to the plan's own screen (or the generic admin list) — exactly the "separate lookup" AC2 says not to require.

Two decisions, confirmed directly (2026-09-06), not left to implementation-time judgment:

1. **`TestPlanDetail`'s new criteria section gets full CRUD (add/edit/delete)**, not the add+delete-only shape the Test Suites section above it uses — `EntryExitCriteria` rows are freestanding data (no join-table membership semantics to protect), so there's no reason to withhold `PATCH` the way a many-to-many include/remove pair would need to.
2. **Only `type = exit` rows surface on the Release→TestCycle audit view** — AC2's own wording says "its exit criteria," not "its criteria." Entry/suspension/resumption rows remain visible only on `TestPlanDetail`'s own section.

## Decision

### Backend — one schema field, one route change, no migration

`GET /releases/{id}/test-cycles`'s response schema, `TestCycleSummary` (`backend/app/schemas/releases.py`), gains a new field:

```python
exit_criteria: list[EntryExitCriteriaSummary]
```

reusing the existing `EntryExitCriteriaSummary` schema (`app/schemas/planning.py`) verbatim — no new nested-shape schema to invent. `get_release_test_cycles` (`backend/app/api/routes/releases.py`) is extended to, for the full set of `TestCycle` rows the query already fetches, collect the **distinct** `test_plan_id`s across them and issue one additional query — `EntryExitCriteria` where `test_plan_id IN (...)` and `type = 'exit'` — then attach each cycle's matching subset in Python. Batched by unique `test_plan_id` across the whole result set, not once per cycle, since two cycles under the same plan (a real, legal shape — nothing prevents 2+ `TestCycle`s referencing one `TestPlan`) would otherwise issue the same query twice.

**Route permission gate** extends from the existing triple (`release.read` AND `test_cycle.read` AND `test_execution.read`, NFR-26) to a **quadruple**: **AND `entry_exit_criteria.read`**. No RBAC bundle migration needed — every system role that can reach this route today already holds `entry_exit_criteria.read`: `test_manager` (`entry_exit_criteria.*`, RBAC-4 original seed), `org_admin` (superuser), `auditor` (`.read` on all 29 resources). `tester` cannot reach this route today regardless (it holds neither `release.read` nor `test_cycle.read` to begin with, a pre-existing gap this ADR does not change or attempt to close — out of PLAN-2's scope).

A `TestCycle` whose parent `TestPlan` has zero `exit`-type rows returns `exit_criteria: []`, never an omitted field or a `404` — same "valid, common state" posture the existing `executions: []` empty case already established.

### Frontend

**`TestPlanDetail.tsx`** gains a new "Entry/Exit Criteria" section (full CRUD: list, "Add Criteria" modal, per-row "Edit" and "Delete"), reusing `entityCrud.ts`'s generic list/create/update/delete against `entityConfigs/entry-exit-criteria.ts` filtered by `?test_plan_id=<testPlanId>` — the same config the generic admin page already renders, same reuse posture the header's own "Edit" modal established for `TestPlan`'s config (ADR-0031 §2). No new API-lib file.

**`ProjectDetail.tsx`**'s existing Release→TestCycle expand-in-place row (the same view `GET /releases/{id}/test-cycles` already backs) renders `cycle.exit_criteria` as a second flat `<ul>` alongside the existing executions `<ul>`, in the same expanded cell — this is the "cycle view" AC2 means; no dedicated `TestCycle` detail page exists yet (that's PLAN-3's scope), so this is the one place execution progress is visible today, and the one place this ADR adds exit-criteria visibility to.

## Consequences

**Positive:** Closes both of FR-PLAN-2's real gaps with no new backend entity, no migration, and one schema field. Reuses 100% of existing generic-CRUD/config/resolver machinery for AC1; reuses ADR-0019's existing nested-response pattern for AC2 rather than inventing a new shape.

**Negative / accepted trade-offs:**
- **A fourth permission on an already-unusual triple-gated route.** `GET /releases/{id}/test-cycles` was already this codebase's one departure from single-permission-per-route (ADR-0019); this ADR makes it a quadruple. Accepted for the same reason ADR-0019 accepted the triple: the route exposes data across three (now four) distinct resources without any of their IDs in the request path, so under-gating any one of them would let a narrower grant see data outside it.
- **`tester`'s pre-existing inability to reach this route at all is left unresolved.** Fixing it is a `release.read`/`test_cycle.read` bundle question entirely independent of this ADR's own scope (`EntryExitCriteria` visibility) — flagged here so a future bundle change is recognized as its own decision, not folded silently into this one.
- **Full CRUD on `TestPlanDetail`'s criteria section, no permission-based hide/disable** — same attempt-then-error convention every other bespoke workflow screen in this codebase already uses (ADR-0031 §5), not a new UI convention to review.

## Alternatives considered

- **A separate `GET /test-plans/{id}/entry-exit-criteria` list route**, mirroring `test_plan_membership.py`'s own bespoke-route shape, instead of reusing the generic factory's existing `?test_plan_id=` filter. Rejected: the generic route already does exactly this with zero new code: `GET /entry-exit-criteria?test_plan_id=<id>` is already a valid, permission-gated, org-resolved list call via ADR-0022's factory. Adding a bespoke duplicate route would be pure redundancy with no new capability.
- **Denormalizing `exit_criteria` counts/text onto `TestCycle` itself** at write time, instead of a live join at read time. Rejected: same reasoning ADR-0031 already established for the coverage query — a live query never drifts from the source rows, at negligible extra cost for the data volumes this scaffold targets.
- **Showing all 4 criteria types on the Release→TestCycle view**, not just `exit`. Rejected per the CTO's direct confirmation above — AC2's literal wording specifies exit criteria only; entry/suspension/resumption stay scoped to `TestPlanDetail`'s own section, where they're equally visible just not duplicated onto every cycle view.
