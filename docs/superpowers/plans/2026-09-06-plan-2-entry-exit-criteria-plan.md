# PLAN-2: Entry/Exit Criteria — Plan

**Story:** [PLAN-2](../../user-stories/2026-09-03-test-planning-stories.md#story-plan-2-define-entryexit-criteria)
**TCs:** TC-PLAN-004, TC-PLAN-005 (`docs/test-cases/2026-09-03-test-cases.md`)

## Ground truth found (no re-derive needed)

- `EntryExitCriteria` model/table/generic-CRUD routes/schemas/admin page **already ship in full** (ADMIN-2, ADR-0022/0027). Confirmed: `backend/app/models/planning.py`, `backend/app/api/routes/planning.py`, `backend/app/schemas/planning.py`, `frontend/src/entityConfigs/entry-exit-criteria.ts`. WBS doc already says this row "needed no bespoke work at all."
- Gap is **UI only**, two spots:
  1. `TestPlanDetail.tsx` has no criteria section (its own doc comment lists this as an explicit non-goal, "PLAN-2 still to come").
  2. `ProjectDetail.tsx`'s existing Release→TestCycle expand-in-place view (shows cycle name/dates + nested executions list, `getReleaseTestCycles`) has no criteria. This is the "cycle view" TC-PLAN-005 means — no dedicated TestCycle page exists yet (PLAN-3 non-goal), so this is the one place execution progress is already visible today.

## Scope

**Backend** (1 schema + 1 route change, both bespoke, no migration):
- `TestCycleSummary` (`backend/app/schemas/releases.py`) gains `exit_criteria: list[EntryExitCriteriaSummary]`, same nesting pattern as its existing `executions` field.
- `GET /releases/{id}/test-cycles` (`backend/app/api/routes/releases.py`) — for each cycle, query `EntryExitCriteria` where `test_plan_id = cycle.test_plan_id AND type = 'exit'`, attach. Batch by unique `test_plan_id` across the result set, not per-cycle, to avoid N+1.
- New ADR (0032) — this changes ADR-0019's `GET /releases/{id}/test-cycles` response contract; propagate to API doc §... and database doc if the contract table there lists this shape.

**Frontend:**
- `TestPlanDetail.tsx`: new "Entry/Exit Criteria" `CCard` section — flat list (type `CBadge` + condition_text), "Add Criteria" modal (type select + condition_text textarea), per-row **Edit** (reuses `EntityForm` + `entityConfigs/entry-exit-criteria.ts`, same pattern as the header's own Edit modal) and **Delete**. Full CRUD in-page (confirmed). Reuses `entityCrud.ts` generic list/create/update/delete — no new API-lib file needed.
- `ProjectDetail.tsx`: extend the existing cycle `<li>` in the Release→TestCycle expand view — render `cycle.exit_criteria` as a second nested `<ul>` next to the executions `<ul>`, same row, same expand state. `TestCycleSummary` (frontend, `lib/api/releases.ts`) gains the matching `exit_criteria` field.

**Database:** none — no new column/table.

## Edge cases

- TestPlan with zero criteria rows → both sections show empty state text, not blank.
- TestCycle whose `TestPlan` has entry/suspension/resumption rows but no `exit` rows → executions list still renders, criteria sub-list shows its own empty state (not the whole row hidden).
- Deleting a criteria row that's an `exit` type currently shown on a live TestCycle view → next fetch just drops it; no orphan-reference risk (`EntryExitCriteria` isn't FK'd from `TestExecution`/`TestCycle`).
- Multi-tenancy: `EntryExitCriteria` create in `TestPlanDetail.tsx` goes through the generic factory's existing one-hop resolver (`test_plan_id → TestPlan.project_id`) — already correct, no resolver gap (unlike ADR-0029's class of bug — this isn't a new create-route shape, it's the existing generic one).

## Open questions — resolved

1. New ADR-0032 (not an in-place ADR-0019 amend). Propagates to `docs/api/2026-09-03-api-design.md` and `docs/database/2026-09-03-database-design.md` wherever `GET /releases/{id}/test-cycles`'s shape is documented.
2. Full CRUD on `TestPlanDetail.tsx`'s criteria section — add/edit/delete, not add+delete only.
3. Only *exit*-type rows surface on the TestCycle-adjacent view; `TestPlanDetail`'s own list shows all 4 types.

## Checklist

**Docs pass (done, 2026-09-06 — code not yet written):**
- [x] ADR-0032 + ADR README index
- [x] Requirements doc — FR-PLAN-2 prose, NFR-42, traceability row
- [x] WBS — 4.2 note further-corrected, 4.2b (backend) + 8.7a (frontend), 11.16 changelog
- [x] Database Document — §3.5 (nested `exit_criteria`) + §3.7 (`EntryExitCriteria` posture note)
- [x] API Document — route table row + prose, quadruple gate
- [x] UI Design — new PLAN-2 document
- [x] Sitemap — `TestPlanDetail`/`ProjectDetail` route notes, admin-page cross-reference
- [x] Test Plan — release-blocking paragraph + 2 risk-table rows
- [x] Test Design — new §28 equivalence classes
- [x] Test Cases — TC-PLAN-004/005 sharpened (005 upgraded P2→P1), TC-PLAN-012/013 added, coverage summary + note updated (192/114 → 194/115)

**Code (not started — awaiting go-ahead):**
- [ ] Backend: `TestCycleSummary` + `get_release_test_cycles` — nested `exit_criteria`, batched query
- [ ] Backend: integration test — create-then-immediate-read round trip (TestPlan w/ exit criteria → cycle under it → assert `exit_criteria` populated in `GET /releases/{id}/test-cycles`), plus the mixed-type/empty/permission cases (TC-PLAN-005/012/013)
- [ ] Frontend: `TestCycleSummary` type (`lib/api/releases.ts`) + `exit_criteria` field
- [ ] Frontend: `TestPlanDetail.tsx` — Entry/Exit Criteria section (list/add/edit/delete, full CRUD)
- [ ] Frontend: `ProjectDetail.tsx` — exit criteria sub-list in the Release→TestCycle expand row
- [ ] Frontend unit tests: `TestPlanDetail.EntryExitCriteria.test.tsx`, `ProjectDetail.ExitCriteria.test.tsx` (or extend existing files per each screen's own convention)
- [ ] E2E: extend/add a spec covering TC-PLAN-004/005 literal wording
