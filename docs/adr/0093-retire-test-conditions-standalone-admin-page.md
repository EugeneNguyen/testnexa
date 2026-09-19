# ADR-0093: Retire the standalone `TestCondition` admin list page

- **Status:** Accepted
- **Date:** 2026-09-19
- **Deciders:** xuanbinh91@gmail.com (CTO)
- **Amends:** [ADR-0051](0051-shell-10-project-scope-entity-nav.md) (removes `test-conditions` from the Test Design sidebar group it added), [ADR-0080](0080-standalone-list-page-compound-create.md)/[ADR-0081](0081-scope-selector-cascading-via.md) (the `test-conditions` standalone-list-page compound-create/cascading-picker wiring those ADRs built becomes unreachable, not incorrect — the declarations stay valid for the other entities they also cover), [ADR-0087](0087-fk-select-for-bounded-catalogs.md)/[ADR-0089](0089-scope-selector-label-field.md) (their own `test-conditions` live-verification examples become historical). Does **not** touch [ADR-0028](0028-req3-test-condition-rigor-path-bespoke-routes.md) (the inline `ProjectDetail` authoring path) or [ADR-0074](0074-entity-detail-relationship-tabs.md)/[ADR-0079](0079-child-compound-create-for-one-to-many-tabs.md) (`Requirement`'s "Test conditions" relation tab) — both stay exactly as they are; this ADR is what makes them the *only* surfaces left.

## Context

`TestCondition` already has two working, CTO-approved surfaces for exactly
the same job the standalone `/admin/test-conditions` page does — list,
create, edit, delete, scoped to a `Requirement`:

1. **`ProjectDetail`'s inline "Test Conditions" section**, per `Requirement`
   row (ADR-0028 — which already explicitly rejected a dedicated
   `RequirementDetail` page in favor of this inline authoring, before the
   generic admin surface existed at all).
2. **The generic Requirement detail page's "Test conditions" relation tab**
   (`/admin/requirements/:id?tab=test-conditions`, ADR-0074/ADR-0079),
   compound-create wired so "New" needs no parent picker (`Requirement` is
   already the record being viewed).

The **standalone** `/admin/test-conditions` list page (project-scoped
generic-admin `:entity` route, registered via `registry.ts` since ADMIN-2,
linked from the sidebar's "Test Design" group since ADR-0051) is a third,
redundant entry point to the identical data — its own generic `create` was
never enabled (`ADR-0028` reserved creation for the bespoke inline path),
and it later gained a *compound*-create "New" button anyway (ADR-0080),
making it functionally a thinner duplicate of the relation tab. CTO
instruction: remove this third surface entirely, including the sidebar
link — the feature lives inside the Requirement detail page from here on,
not as its own admin entity.

## Decision

**Frontend-only removal, both the nav entry and the route's own
reachability — backend, model, MCP tools, and both remaining
`TestCondition` surfaces are untouched.**

1. **`frontend/src/pages/admin/registry.ts`** — delete
   `entry("Test conditions", "test-conditions")` from
   `projectScopedEntities`. This also removes it from `ADMIN_ENTITY_KEYS`
   and `entityLabelByKey`.
2. **`frontend/src/components/organisms/app-sidebar/app-sidebar.tsx`** —
   remove `"test-conditions"` from `PROJECT_ENTITY_GROUPS`'s "Test Design"
   group `entityKeys` (4 children → 3: Requirements, Test Cases, Test
   Suites).
3. **`frontend/src/pages/admin/useAdminRouteContext.ts`** — gate the
   `:entity` route param against `ADMIN_ENTITY_KEYS` *before* calling
   `useEntitySchema`, not just relying on the registry edit alone. Without
   this, a typed URL to `/admin/test-conditions` would still work — the
   generic `:entity` route is not registry-gated at the fetch level (it
   calls `GET /entities/{resource}/schema` directly, and the backend keeps
   serving that schema on purpose, for the relation tab). The gate makes
   `config` resolve to `undefined` immediately for any key the registry
   doesn't carry, which is exactly the existing "Unknown admin entity"
   branch every generic admin page (`EntityListPage`/`EntityFormPage`/
   `EntityDetailPage`) already renders for a typo'd key — no new UI, an
   existing code path simply starts firing for this key too.

**Backend stays exactly as-is.** `_TEST_CONDITION_CONFIG`, its generic CRUD
routes, `POST /requirements/{id}/test-conditions` (the relation tab's
compound-create route), RBAC permission seeds, `RequirementTestConditionLink`/
`TestConditionTestCaseLink` junctions, `TestCase.test_condition_id`, and
every `tn_test_condition_*`/`tn_requirement_test_condition_link_*` MCP tool
are all still needed by the two remaining surfaces and by MCP callers —
removing any of them would break working, in-scope functionality to solve a
frontend-only problem.

## Consequences

- **`/admin/test-conditions` (list, `/:id` detail, `/:id/edit` form) all
  render "Unknown admin entity" for a direct/typed visit** — not a 404, the
  same existing unknown-`:entity` UX every other bad admin URL already
  gets. No redirect to the relation tab is built; a user following a stale
  bookmark lands on that message, not automatically forwarded.
- **ADR-0051's "13 of 20" Test Design partition becomes "12 of 19"** — the
  registry itself now carries 19 `projectScopedEntities`, not 20. `AppSidebar
  .test.tsx`'s partition test (which iterates the live registry, not a
  hardcoded count) needs no logic change, only its literal expected total
  corrected.
- **ADR-0080/ADR-0081's `test-conditions`-specific findings (the compound
  "New" button, the cascading scope-selector `via`) become dead code paths,
  not wrong ones.** Both ADRs' declarations and mechanisms stay correct and
  in active use for their other covered entities (`test-cycles`, `defects`,
  `test-logs`, `test-executions`, `entry-exit-criteria`, `risk-items`) —
  this ADR does not revisit either decision, it just removes the one entity
  those mechanisms can no longer reach a UI for.
- **TC-ADMIN-134 (§69) and TC-SHELL-035 (§42)** each have a `test-conditions`
  reference that was true when written and is now historical — corrected
  in place with a forward-pointer to this ADR and §73 below, not rewritten
  as if the finding never happened (`docs/CLAUDE.md`'s "reciprocal
  staleness" convention).
- **4 e2e specs reference `test-conditions`** in some form
  (`admin2-generic-crud.spec.ts`, `admin10-compound-create.spec.ts`,
  `admin7-entity-relation-tabs.spec.ts`, `req3-test-condition-rigor-path.
  spec.ts`) — audited at implementation time (`grep -n "test-conditions"`
  against each file, every hit read in context). **All 4 needed zero
  changes**: every reference is either a direct backend API call
  (`POST/DELETE /api/v1/test-conditions`, `admin2-generic-crud.spec.ts`,
  proving the generic factory route works, not a UI navigation) or the
  relation-tab/compound-create UI path (`entity-detail-tab-test-conditions`,
  `?tab=test-conditions`, `POST /requirements/{id}/test-conditions`) —
  none of the 4 ever navigates to the standalone `/admin/test-conditions`
  page. A repo-wide `grep -rn "admin/test-conditions"` across `e2e/` and
  `frontend/` turned up zero real navigations to that URL anywhere. One new
  spec, `adr93-retire-test-conditions.spec.ts`, covers TC-SHELL-040/041.

## Alternatives considered

- **Hide from nav only, leave the registry entry and route reachable
  (matches the existing `ORG_EXCLUDED_ENTITY_KEYS`/`projects` precedent).**
  Rejected on explicit CTO instruction — that precedent exists because
  `projects` has a *replacement* bespoke page at a different URL; `test-
  conditions` has no standalone replacement at all, the capability moves
  fully inside `Requirement`'s own detail page, so a still-reachable orphan
  route serves no purpose.
- **Also restrict/remove the backend's generic CRUD routes for
  `test_condition`.** Rejected — the relation tab's compound-create route,
  MCP's `tn_test_condition_*`/`tn_requirement_test_condition_link_*` tools,
  and the junction-link entities all depend on the same backend config and
  schema-serving route staying alive. Restricting it would fix nothing the
  frontend-only removal doesn't already fix, and would break three things
  that are explicitly meant to keep working.

## Verification

**Pending implementation** — this ADR is authored ahead of the code change,
per this repo's docs-first convention (plan/ADR on `main` or in-worktree,
then implement against it). No test numbers are claimed here; the
implementation pass fills in `tsc --noEmit`/Vitest/e2e results against this
Decision once it lands, per this file's own §73 test-design classes.
