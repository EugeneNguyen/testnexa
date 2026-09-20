# ADR-0095: Retire the standalone `EntryExitCriteria`/`TestCycle` admin list pages, extend `TestCycle` to full inline CRUD

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** xuanbinh91@gmail.com (CTO)
- **Amends:** [ADR-0050](0050-shell-9-project-scope-nav-context-resolution.md) (removes `entry-exit-criteria`/`test-cycles` from the Test Planning sidebar group it added), [ADR-0032](0032-plan2-entry-exit-criteria-visibility.md) (its own `TestPlanDetail` Entry/Exit Criteria section is untouched — this ADR only removes the *standalone* surface, which was always redundant with it), [ADR-0033](0033-plan3-test-cycle-creation-and-execution-scope-check.md) (its own "create-and-view only, edit/delete live on the generic admin surface" posture is superseded — `TestCycle`'s `TestPlanDetail` section gains full CRUD in this ADR), [ADR-0080](0080-standalone-list-page-compound-create.md)/[ADR-0081](0081-scope-selector-cascading-via.md) (their own `entry-exit-criteria`/`test-cycles` standalone-list-page compound-create/cascading-picker wiring becomes unreachable, not incorrect — the declarations stay valid for the other entities they also cover), [ADR-0093](0093-retire-test-conditions-standalone-admin-page.md) (same mechanism, second entity pair — this ADR reuses ADR-0093's registry/sidebar/route-gate pattern verbatim, no new gate logic).

## Context

CTO instruction, direct continuation of ADR-0093's own retirement pattern: the
standalone `/admin/entry-exit-criteria` and `/admin/test-cycles` list pages
should not appear in the sidebar — both entities are already (or, for
`TestCycle`, should be made) fully manageable from `TestPlanDetail`, the
screen that actually owns their lifecycle within one plan.

The two entities are **not symmetric** underneath, found while planning this
ADR (not assumed from their shared sidebar group):

1. **`EntryExitCriteria`** (PLAN-2, ADR-0032) already has full CRUD on
   `TestPlanDetail` — list/add/edit/delete, its own modal, zero dependency on
   the standalone admin page. Retiring the standalone surface here is the
   identical, zero-risk move ADR-0093 made for `TestCondition`.
2. **`TestCycle`** (PLAN-3, ADR-0033) does not. `TestPlanDetail`'s own Test
   Cycles section was deliberately built **create-and-view only**
   ("`TestCycle`'s edit/delete already exist on the generic admin surface, so
   this section links there instead of duplicating them" — ADR-0033's own
   Decision) — every row's "View in Admin" link is the *only* place
   `PATCH`/`DELETE /test-cycles/{id}` are reachable from the UI at all.
   `TestCycleDetail` (the cycle's own execution-history screen, EXEC-1/
   ADR-0034) has no edit/delete either. Retiring the standalone page for
   `TestCycle` without building a replacement would delete a capability, not
   just relocate a redundant one.

## Decision

**Two different treatments for the two entities, same mechanism for the
retirement half, reusing ADR-0093's pattern verbatim — no new gate logic.**

1. **`frontend/src/pages/admin/registry.ts`** — delete both
   `entry("Entry/exit criteria", "entry-exit-criteria")` and
   `entry("Test cycles", "test-cycles")` from `projectScopedEntities`. This
   also removes them from `ADMIN_ENTITY_KEYS` and `entityLabelByKey`.
2. **`frontend/src/components/organisms/app-sidebar/app-sidebar.tsx`** —
   remove both keys from `PROJECT_ENTITY_GROUPS`'s "Test Planning" group
   `entityKeys` (4 children → 2: Test Plans, Releases).
3. **`frontend/src/pages/admin/useAdminRouteContext.ts`** — **no change.**
   ADR-0093's own `ADMIN_ENTITY_KEYS.has(entityKey)` gate is generic, keyed
   off the registry, not a per-entity allow-list — removing the two registry
   entries makes the existing gate cover them automatically. A direct/typed
   visit to either retired URL renders the same pre-existing "Unknown admin
   entity" branch every other bad `:entity` key already gets.
4. **`TestPlanDetail.tsx`'s Test Cycles section gains inline Edit/Delete**,
   closing the gap `EntryExitCriteria` never had:
   - A new `cycleEditConfig` (`useEntitySchema("test-cycles")`'s schema,
     filtered to drop `test_plan_id`/`project_id`/`release_id` — none is
     reassignable, `UpdateTestCycleRequest` accepts none of the three, and
     the backend already marks all three `readOnly: true` since `TestCycle`
     has no generic `create` at all — the writable-field union for its
     derived schema is `UpdateTestCycleRequest` alone). Same derivation
     `criteriaConfig` already performs for its own `test_plan_id`.
     `project_id` needed live verification to even find: the Vitest mock
     schema used while building this omitted it, and only a real browser
     against the real backend's `GET /entities/test-cycles/schema` surfaced
     it. Excluding it isn't cosmetic — `EntityForm` renders even a
     `readOnly` `fk` field via `FkAutocomplete`/`FkSelect` in a display-only
     mode, which still fetches its ref entity's list; `project` is
     org-scoped, not project-scoped, so that fetch `422`s with no
     `fkExtraParams` shape that could satisfy it. Confirmed live before and
     after the fix (three `422`s in the browser console → zero).
   - The remaining editable `environment_id` field needs
     `fkExtraParams={{ project_id: projectId }}` passed to `EntityForm`
     (ADR-0086's own mechanism, named in its doc comment as exactly this
     entity's "first case") — without it, `environment`'s own list route
     422s the same way, confirmed live.
   - Each cycle row's "View in Admin" link is replaced with "Edit"
     (`PATCH /test-cycles/{id}` via `updateEntity`, opens a generic
     `EntityForm` modal) and "Delete" (`DELETE /test-cycles/{id}` via
     `deleteEntity`, no confirmation modal — same no-confirm convention
     `onDeleteCriteria`/the Test Suites section's "Remove" already use).
   - On a successful edit, both the cycle list and the environment-label
     lookup re-fetch (an edit can repoint `environment_id` at a row not yet
     labelled) — the same "always reflects the server's own current state"
     posture every other section on this screen already takes.
   - Create is **unchanged** — the existing bespoke "Create Cycle" modal
     (release/environment `FkAutocomplete`s, inline "+ New Environment"
     sequential-create toggle) stays exactly as ADR-0033 built it. This ADR
     only touches edit/delete.

**Backend stays exactly as-is, for both entities.** `_ENTRY_EXIT_CRITERIA
_CONFIG`/`_TEST_CYCLE_CONFIG`, their generic CRUD routes,
`POST /test-plans/{id}/test-cycles` (the bespoke create route), RBAC
permission seeds, and every `tn_entry_exit_criteria_*`/`tn_test_cycle_*` MCP
tool are all still needed by `TestPlanDetail`'s own inline sections and by
MCP callers — removing any of them would break working, in-scope
functionality to solve a frontend-only problem. `TestCycle`'s edit/delete
route reachability doesn't change either; only *which UI screen* calls it
does.

## Consequences

- **`/admin/entry-exit-criteria` and `/admin/test-cycles` (list, `/:id`
  detail, `/:id/edit` form) all render "Unknown admin entity"** for a
  direct/typed visit — not a 404, not a redirect, the same existing
  unknown-`:entity` UX ADR-0093 already established.
- **The Test Planning group's own partition goes from 4 `entityKeys` to 2**
  (`test-plans`, `releases`) — `projectScopedEntities` itself now carries
  **19 entries**, verified by direct count (`sed -n '/projectScopedEntities/,/^\];/p' registry.ts | grep -c entry`), not derived from ADR-0093's own prior
  arithmetic. `AppSidebar.test.tsx`'s partition test (iterates the live
  registry, not a hardcoded count) needs no logic change, only
  `useEntitySchema.test.tsx`'s own now-historical "load-bearing negative"
  comment, corrected in place, not deleted (see Consequences below).
- **ADR-0080/ADR-0081's `entry-exit-criteria`/`test-cycles`-specific findings
  become dead code paths, not wrong ones** — same posture ADR-0093 already
  established for `test-conditions`.
- **`TestCycleDetail.tsx` is unaffected** — it never had edit/delete of its
  own, and this ADR doesn't add any there; the new inline Edit/Delete lives
  entirely on `TestPlanDetail`, the screen that already owns the cycle list.
- **4 e2e specs reference `entry-exit-criteria`/`test-cycles`** in some form
  (`plan2-entry-exit-criteria.spec.ts`, `plan3-test-cycle.spec.ts`,
  `admin3-entity-schema.spec.ts`, `shell2-breadcrumb-coverage.spec.ts`) —
  audited at implementation time. 3 of the 4 needed zero changes (direct
  backend API calls, or `TestCycleDetail`'s own unrelated bespoke route,
  never a navigation to either standalone page). `plan3-test-cycle.spec.ts`
  needed one assertion updated: its own "the row links to the generic admin
  surface" check (asserting `view-in-admin-{id}`'s `href`) now asserts the
  new `edit-cycle-{id}`/`delete-cycle-{id}` buttons instead, and that
  `view-in-admin-{id}` is absent. A repo-wide `grep -rn "admin/entry-exit-
  criteria\|admin/test-cycles"` across `e2e/`/`frontend/` turned up no other
  real navigations to either retired URL.
- **PLAN-3's own UI Design Document** (`docs/ui-design/2026-09-06-plan-3-test-cycle-creation-ui-design.md`) made two claims now superseded, not just stale: "no Edit/Delete... a 'View in Admin' link" and "there is no admin-surface fallback, by design." Both struck through in place with an `### Amendment`-style forward-pointer to this ADR, per this repo's own "superseded, don't silently rewrite" convention. **PLAN-2's own UI Design Document needed no change** — it never described the standalone page at all, only `TestPlanDetail`'s own section, which is unaffected.
- **`docs/test-cases/2026-09-03-test-cases.md`'s TC-ADMIN-134/TC-ADMIN-140
  and `docs/test-design/2026-09-03-test-design.md`'s §69/§72** each carry a
  `test-cycles`/`entry-exit-criteria` finding that was true when written and
  is now historical — corrected in place with a forward-pointer to this ADR,
  not rewritten as if the finding never happened
  (`docs/CLAUDE.md`'s "reciprocal staleness" convention). New TC-PLAN-018
  (retirement) and TC-PLAN-019 (the new inline Edit/Delete) — see
  Test-Design §74.

## Alternatives considered

- **Hide `TestCycle` from nav only, leave the standalone page reachable for
  edit/delete (the `ORG_EXCLUDED_ENTITY_KEYS`/`projects` precedent, and what
  ADR-0093 itself rejected for `test-conditions`).** Rejected for the same
  reason ADR-0093 rejected it — that precedent exists because `projects` has
  a *replacement* bespoke page at a different URL; leaving `test-cycles`'
  standalone page reachable-but-unlinked would mean the *only* way to
  edit/delete a cycle is a URL nobody can navigate to from anywhere in the
  app, which is strictly worse than either keeping the sidebar link or
  building the inline replacement.
- **Retire `EntryExitCriteria`'s standalone page but leave `TestCycle`'s
  alone, deferring its inline-CRUD build to a separate story.** Rejected —
  it would leave `test-cycles` as the one remaining standalone-admin sidebar
  entry with no sibling in its own nav group, an inconsistent partial state
  for no benefit; the inline-CRUD build is small (one config derivation, two
  buttons, one modal, reusing `EntityForm`/`entityCrud` exactly as
  `EntryExitCriteria`'s own section already does) and was judged worth doing
  in the same change.
- **Also restrict/remove the backend's generic CRUD routes for either
  entity.** Rejected — `TestPlanDetail`'s own sections, the bespoke create
  route, and every relevant MCP tool all depend on the same backend config
  and schema-serving route staying alive. Restricting it would fix nothing
  the frontend-only removal doesn't already fix, and would break working,
  in-scope functionality.

## Verification

**Frontend unit:** `tsc --noEmit` clean. Full Vitest suite **808/808** (102
files) — 2 new cases in `TestPlanDetail.TestCycles.test.tsx` (inline
edit/delete), the existing "View in Admin" case rewritten to assert the new
buttons, `AppSidebar.test.tsx`'s partition test and `registry.test.ts`
re-run unmodified as the registry-absence regression proof (both are
diff-based against the live registry, not a hardcoded count, so they needed
no edits to correctly reflect the two removed entries).

**Backend:** zero backend files touched (`git diff --stat -- backend/`
empty) — no backend test layer re-run needed per this repo's own "empty
diff is sufficient proof" rule.

**E2E:** `plan3-test-cycle.spec.ts`'s one affected assertion updated (see
Consequences). Full automated e2e suite run — not run this pass (the live
manual verification below covers the same ground for this specific change);
flagged as an open follow-up, not silently skipped.

**Live workflow check (explicit CTO ask), against an isolated stack
(`testnexa-plansb-test`, cloned from `main`, `alembic_version` matched,
both-IP health-checked) — confirmed via a real browser (Playwright,
throwaway script, deleted after use) driven against the real backend, not
assumed from the diff:**

1. Sidebar has zero `entry-exit-criteria`/`test-cycles` links; direct
   navigation to both retired `/admin/...` URLs renders "Unknown admin
   entity".
2. On `TestPlanDetail`: create a Test Cycle (release + environment via the
   existing bespoke modal) — `201`, row appears, no "View in Admin" link
   anywhere on the page.
3. Edit the new cycle's name via the new inline modal — `200 PATCH`, row
   reflects the new name.
4. Delete the cycle — `204 DELETE`, row gone, empty state renders; confirmed
   independently via a direct `GET /test-cycles?test_plan_id=` returning
   `"items":[]` after the UI delete, not just a DOM read.

**This live pass is what found the `project_id`/422 gap described in the
Decision above** — the first attempt at `cycleEditConfig` (filtering only
`test_plan_id`/`release_id`, matching the Vitest mock's field list at the
time) produced three `422` console errors the instant the Edit modal
opened, invisible to `tsc`/Vitest because the mock schema itself was
incomplete relative to the real backend's. Fixed (drop `project_id` too,
add `fkExtraParams`), re-verified live (zero errors), then the Vitest mock
itself was corrected to include `project_id` so this gap can't recur
unnoticed in this file's own coverage.
