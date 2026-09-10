# Sitemap — Project Scaffold

**Date:** 2026-09-05 (last content update 2026-09-09 — [SHELL-10 UI Design Document](../ui-design/2026-09-09-shell-10-project-scope-entity-nav-ui-design.md), [ADR-0051](../adr/0051-shell-10-project-scope-entity-nav.md); previously [SHELL-9 UI Design Document](../ui-design/2026-09-09-shell-9-project-scope-nav-context-ui-design.md), [ADR-0050](../adr/0050-shell-9-project-scope-nav-context-resolution.md); [BRAND-1 UI Design Document](../ui-design/2026-09-09-brand-1-logo-brand-system-ui-design.md), [ADR-0048](../adr/0048-brand-1-logo-brand-system.md); [PROJ-4 UI Design Document](../ui-design/2026-09-09-proj-4-projects-page-sidebar-entry-ui-design.md), [ADR-0047](../adr/0047-proj-4-projects-page-sidebar-entry.md))
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** `frontend/src/App.tsx` (route source of truth — this document tracks it, not the reverse), [Generic Admin CRUD UI Design Document](../ui-design/2026-09-05-generic-admin-crud-ui-design.md), [ADR-0027](../adr/0027-generic-admin-crud-ui-and-backend-completion.md), [REQ-3 UI Design Document](../ui-design/2026-09-06-req-3-test-condition-rigor-path-ui-design.md), [ADR-0028](../adr/0028-req3-test-condition-rigor-path-bespoke-routes.md), [ADR-0029](../adr/0029-testcase-resolver-direct-link-fallback.md), [REQ-4 UI Design Document](../ui-design/2026-09-06-req-4-test-suite-membership-ui-design.md), [ADR-0030](../adr/0030-req4-test-suite-membership-bespoke-routes.md), [PLAN-1 UI Design Document](../ui-design/2026-09-06-plan-1-test-plan-membership-ui-design.md), [ADR-0031](../adr/0031-plan1-test-plan-membership-and-status-transition-routes.md), [PLAN-2 UI Design Document](../ui-design/2026-09-06-plan-2-entry-exit-criteria-visibility-ui-design.md), [ADR-0032](../adr/0032-plan2-entry-exit-criteria-visibility.md), [PLAN-3 UI Design Document](../ui-design/2026-09-06-plan-3-test-cycle-creation-ui-design.md), [ADR-0033](../adr/0033-plan3-test-cycle-creation-and-execution-scope-check.md), [EXEC-1 UI Design Document](../ui-design/2026-09-07-exec-1-test-execution-recording-ui-design.md), [ADR-0034](../adr/0034-exec-1-test-execution-recording-dashboard.md), [DASH-1 UI Design Document](../ui-design/2026-09-07-dash-1-root-redirect-dashboard-ui-design.md), [ADR-0035](../adr/0035-dash-1-root-redirect-and-dashboard-placeholder.md), [SHELL-6 UI Design Document](../ui-design/2026-09-07-shell-6-org-switcher-ui-design.md), [ADR-0036](../adr/0036-shell-6-organization-switcher-header-dropdown.md), [EXEC-2 UI Design Document](../ui-design/2026-09-07-exec-2-append-only-test-log-ui-design.md), [ADR-0038](../adr/0038-exec-2-append-only-test-log.md), [EXEC-3 UI Design Document](../ui-design/2026-09-08-exec-3-raise-defect-ui-design.md), [ADR-0044](../adr/0044-exec-3-raise-defect-from-execution.md)

<!-- Merge note (switch-org, 2026-09-07): this line was previously tripled (a pre-existing bug, not introduced by this branch); main's `redirect-if-not-login` PR already deduplicated it and dropped a colliding `docs/adr/0033-mcp-server-architecture.md` reference (ADR-0033 has two files sharing that number, a known historical numbering collision — see `docs/adr/README.md`). This merge takes that clean line and appends this branch's own SHELL-6 refs to it, rather than reintroducing any duplicate. -->

First sitemap for this repo — no prior one existed; routes accreted story-by-story directly into `App.tsx`. Written now because the generic admin surface adds routes generated from a registry rather than one literal `<Route>` per entity, which is worth documenting as a pattern rather than 28 individual rows would otherwise obscure.

**SHELL-6** ([ADR-0036](../adr/0036-shell-6-organization-switcher-header-dropdown.md), FR-SHELL-6, [UI Design Document](../ui-design/2026-09-07-shell-6-org-switcher-ui-design.md)) — no new route. Adds a persistent header control (org-switcher dropdown in `AppHeader`, present on every `ProtectedRoute` screen below) rather than a screen of its own — noted here since this document's existing "Protected" tables are route-scoped and would otherwise never mention it; see the "Header controls" section below.

**MCP-1** ([ADR-0033](../adr/0033-mcp-server-architecture.md), FR-MCP-1) — reviewed, no Sitemap impact. The MCP server is an AI-agent-only surface (Claude Code / Cursor clients, not browser traffic); its endpoint (`POST /mcp`) is a backend-asgi mount, not a React Router route in `frontend/src/App.tsx` — this document's stated scope is the frontend route source of truth, so backend API endpoints (REST or MCP) are out of scope by definition. Noted here explicitly so the absence isn't mistaken for an oversight.

**BRAND-1** ([ADR-0048](../adr/0048-brand-1-logo-brand-system.md), FR-BRAND-1, [UI Design Document](../ui-design/2026-09-09-brand-1-logo-brand-system-ui-design.md)) — no new route. The logo/brand system touches persistent chrome present on (almost) every screen — `AppHeader`'s navbar-brand, `AppSidebar`'s `.sidebar-brand`, `AuthBoxLayout`'s `BrandLogo` (login/signup, public routes) — plus `index.html`'s favicon, not a route the tables below track. Noted here for the same reason as SHELL-6's note above: this document's route-scoped tables would otherwise never mention a change this visible.

**FRONTEND-1** ([ADR-0049](../adr/0049-frontend-co-locate-unit-tests.md), NFR-54) — no new route, no removed route, no changed screen, no changed chrome. Vitest unit-test files move from `frontend/tests/**.test.{ts,tsx}` to live co-located next to their source under `frontend/src/` — pure frontend file-layout, no `App.tsx` change, no router change. Noted here so the absence of any Sitemap impact isn't mistaken for an oversight (same posture this document takes for every prior frontend-only ADR's "no new route" annotation).

**Tabler CDN install, Phase 1** ([ADR-0053](../adr/0053-tabler-install-phase-1-cdn.md), FR-DS-3) — no new route, no removed route, no changed screen. Two CDN tags added to `index.html`'s `<head>`/`<body>` (same "touches `index.html`, not a route" shape as BRAND-1's favicon `<link>` above) — no component references any Tabler class yet, no `App.tsx` change, no router change.

## Public (unauthenticated)

**Correction (2026-09-07, DASH-1):** `/` is no longer a screen. `LandingPage` is deleted ([ADR-0035](../adr/0035-dash-1-root-redirect-and-dashboard-placeholder.md), supersedes [ADR-0024](../adr/0024-public-landing-page.md)) — `/` is now a pure redirect guard (spinner while `isInitializing`, else `/login` or `/dashboard` on `accessToken` alone, never `orgContext`). See the Route tree below and the Protected table's new `/dashboard` row.

| Route | Screen | Notes |
|---|---|---|
| `/login` | `Login` | FR-AUTH-1 |
| `/signup` | `Signup` | FR-RBAC-1, bootstrap-only (closes after the first `Organization` exists) |
| `/invites/:token/accept` | `AcceptInvite` | RBAC-2/ADR-0017, token-gated not `Authorization`-gated |

## Protected — bespoke workflow screens

| Route | Screen | Notes |
|---|---|---|
| `/dashboard` | `Dashboard` | FR-DASH-1, [ADR-0035](../adr/0035-dash-1-root-redirect-and-dashboard-placeholder.md), [DASH-1 UI Design Document](../ui-design/2026-09-07-dash-1-root-redirect-dashboard-ui-design.md) — empty placeholder, no data fetch; `/` redirects here when `accessToken` is present |
| `/orgs/pick` | `OrgPicker` | multi-org account, no org selected yet |
| `/orgs/:orgId` | `OrgHome` (**labeled "Dashboard" in the UI as of DASH-2, 2026-09-07** — heading/sidebar/breadcrumb text only, component name and route unchanged; see the naming-overlap note below) | **Revised 2026-09-09 (PROJ-4, [ADR-0047](../adr/0047-proj-4-projects-page-sidebar-entry.md)):** dashboard stat widgets (FR-SHELL-3, Project-count widget now links to `/orgs/:orgId/projects` below) + `RoleAssignmentsPanel` only — the Project management table (ID/Name/Standards profile/Actions, Edit/Delete modals, search/sort/pagination) that DASH-2/ADR-0039 originally placed here moved to its own route |
| `/orgs/:orgId/projects` | `ProjectsPage` | **New (PROJ-4, [ADR-0047](../adr/0047-proj-4-projects-page-sidebar-entry.md)):** the Project management table DASH-2/ADR-0039 originally built for `OrgHome` — ID/Name/Standards profile/Actions, "New Project"/Edit/Delete modals, client-side search/sort/pagination (moved verbatim, no behavior change) — reached via `AppSidebar`'s new "Projects" nav item, or the Dashboard's Project-count widget link; list fetched via `GET /projects?org_id=` (ADR-0022) |
| `/orgs/:orgId/members` | `OrgMembers` | RBAC-2 |
| `/projects/:projectId` | `ProjectDetail` | Release list, per-release TestCycle/TestExecution audit view (PROJ-2), each cycle's nested view additionally showing its parent plan's `exit`-type EntryExitCriteria alongside its executions (PLAN-2, [ADR-0032](../adr/0032-plan2-entry-exit-criteria-visibility.md)); Requirement list + "New Requirement" modal (REQ-1); per-Requirement direct-link TestCase list + "New Test Case" modal, per-TestCase TestStep list + add/inline-edit (REQ-2, ADR-0006/[ADR-0029](../adr/0029-testcase-resolver-direct-link-fallback.md)); per-Requirement Test Condition list + create, per-Test-Condition Test Case create + list (REQ-3/REQ-4, [ADR-0028](../adr/0028-req3-test-condition-rigor-path-bespoke-routes.md)) — the two coexist per-TestCase within a project (ADR-0006); Test Suites list + create modal, per-suite live TestCase-membership view with add/remove (REQ-4, [ADR-0030](../adr/0030-req4-test-suite-membership-bespoke-routes.md), [REQ-4 UI Design Document](../ui-design/2026-09-06-req-4-test-suite-membership-ui-design.md)); Test Plans list, rows link to `TestPlanDetail` below rather than expanding in place (PLAN-1, [PLAN-1 UI Design Document](../ui-design/2026-09-06-plan-1-test-plan-membership-ui-design.md)) |
| `/projects/:projectId/test-plans/:testPlanId` | `TestPlanDetail` | Plan header (identifier/scope/approach/staffing/schedule/status, edit modal) + Test Suites section (live included-suites list, add/remove) + read-only Covered Test Cases section (PLAN-1, [ADR-0031](../adr/0031-plan1-test-plan-membership-and-status-transition-routes.md), [PLAN-1 UI Design Document](../ui-design/2026-09-06-plan-1-test-plan-membership-ui-design.md)) — first bespoke screen routed as its own dedicated per-entity page rather than a `ProjectDetail` expand-in-place section (§1 of that document), anticipating PLAN-2/PLAN-3's own further extensions of the same route; **PLAN-2 addition:** full-CRUD "Entry/Exit Criteria" section (all 4 types, list/add/edit/delete, reuses the generic admin surface's own `entry-exit-criteria` config) ([ADR-0032](../adr/0032-plan2-entry-exit-criteria-visibility.md), [PLAN-2 UI Design Document](../ui-design/2026-09-06-plan-2-entry-exit-criteria-visibility-ui-design.md)); **PLAN-3 addition (final of the three anticipated extensions):** "Test Cycles" section — live list + "Create Cycle" modal (`release_id`/`environment_id` `FkAutocomplete`s, inline "+ New Environment" sequential-create toggle), submits the new `POST /test-plans/{id}/test-cycles` ([ADR-0033](../adr/0033-plan3-test-cycle-creation-and-execution-scope-check.md), [PLAN-3 UI Design Document](../ui-design/2026-09-06-plan-3-test-cycle-creation-ui-design.md)) |
| `/projects/:projectId/test-plans/:testPlanId/test-cycles/:testCycleId` | `TestCycleDetail` | Cycle header + live Pass/Fail/Blocked/Skipped dashboard (4 stat tiles, each reading the existing generic-list route's own `total`, no new route) + flat execution-history list (`GET /test-executions?test_cycle_id=`) + "Record Result" modal (`test_case_id` picker scoped to `GET /test-plans/{id}/test-cases`, submits `POST /test-cycles/{id}/executions`) — first frontend caller of the bespoke create route ADR-0033 built ahead of this story (EXEC-1, [ADR-0034](../adr/0034-exec-1-test-execution-recording-dashboard.md), [EXEC-1 UI Design Document](../ui-design/2026-09-07-exec-1-test-execution-recording-ui-design.md)); `TestPlanDetail`'s "Test Cycles" section rows now link here instead of being dead-end list rows; per-row "History" modal (ordered `TestLog` timeline + comment form, EXEC-2, [ADR-0038](../adr/0038-exec-2-append-only-test-log.md), [EXEC-2 UI Design Document](../ui-design/2026-09-07-exec-2-append-only-test-log-ui-design.md)); per-`fail`-row "Raise Defect" modal submitting `POST /executions/{id}/defects` (EXEC-3, [ADR-0044](../adr/0044-exec-3-raise-defect-from-execution.md), [EXEC-3 UI Design Document](../ui-design/2026-09-08-exec-3-raise-defect-ui-design.md)) |

**Correction (2026-09-06):** this doc's 2026-09-05 version reserved a dedicated `RequirementDetail` page for FR-REQ-1..3. REQ-1 had already shipped by then with its Requirement list/create inline on `ProjectDetail` instead (never on a separate page) — the reservation was stale before REQ-2/REQ-3 even started. Both REQ-2's direct-link path and REQ-3's TestCondition-mediated path continue that actual placement (see [REQ-3 UI Design Document](../ui-design/2026-09-06-req-3-test-condition-rigor-path-ui-design.md)) rather than resurrecting the unused reservation, which would have split one Requirement's authoring UI across two screens. `RequirementDetail` is removed from the reserved-paths list below.

**Correction (2026-09-06):** this doc's 2026-09-05 version also reserved a dedicated `TestSuiteBuilder` page for FR-REQ-4. REQ-4 instead extends `ProjectDetail` with a "Test Suites" section (same pattern as the Requirement/TestCondition corrections above) — see the [REQ-4 UI Design Document](../ui-design/2026-09-06-req-4-test-suite-membership-ui-design.md). `TestSuiteBuilder` is removed from the reserved-paths list below.

**SHELL-9 (2026-09-09, [ADR-0050](../adr/0050-shell-9-project-scope-nav-context-resolution.md)):** all 5 project-scoped route patterns in this table (`/projects/:projectId`, its two `test-plans`/`test-cycles` nestings, and both `/projects/:projectId/admin/:entity[/:id/edit]` rows below) now render a real `Projects → {project name}` breadcrumb root (previously a bare, unlinked "Project" label) — resolved via a new `GET /projects/{id}` fetch (`useResolvedOrgId()`), not a route/component change to any of these screens themselves. **Sidebar-content half superseded by SHELL-10 below**, kept here for history.

**SHELL-10 (2026-09-09, [ADR-0051](../adr/0051-shell-10-project-scope-entity-nav.md)):** the same 5 route patterns now render a distinct project-mode sidebar (4 entity groups over `projectScopedEntities` + 2 "back" links), not the org nav SHELL-9 rendered there — no route/component change to any of these screens, purely `AppSidebar`'s own content.

**Departure (2026-09-06, PLAN-1):** unlike every REQ-* story above, PLAN-1 does **not** extend `ProjectDetail` in place — it opens `/projects/:projectId/test-plans/:testPlanId` as `TestPlan`'s own dedicated route, on direct CTO direction, anticipating PLAN-2/PLAN-3's further extensions of the same object (see [PLAN-1 UI Design Document](../ui-design/2026-09-06-plan-1-test-plan-membership-ui-design.md) §1 for the full reasoning). `ProjectDetail` itself only gains a thin "Test Plans" list section whose rows link out to this new route, rather than expanding in place.

**Correction (2026-09-07, EXEC-1):** `TestExecutionRunner` above is now **partially** built as `TestCycleDetail` (FR-EXEC-1 only — see the route row above). The reservation stays in the "not yet built" list below only for FR-EXEC-2/3's own remaining scope (append-only `TestLog` timeline UI, raise-a-`Defect` flow) — neither has a screen yet, and neither is stubbed on `TestCycleDetail`.

**Correction (2026-09-07, EXEC-2):** FR-EXEC-2's own remaining surface is now built too, landing on `TestCycleDetail` itself exactly as this file's own "not yet built" note below anticipated — no new route, no new screen name. A "History" button per execution-history row opens a modal showing the ordered `TestLog` timeline plus a comment/attachment form ([EXEC-2 UI Design Document](../ui-design/2026-09-07-exec-2-append-only-test-log-ui-design.md), [ADR-0038](../adr/0038-exec-2-append-only-test-log.md)). Only FR-EXEC-3 (raise-a-`Defect` flow) remains in the "not yet built" list below.

**Correction (2026-09-07, DASH-1):** `LandingPage` (previously the sole entry in the "Public (unauthenticated)" table's `/` row) is deleted outright — see the "Public (unauthenticated)" section's own correction note above. `Dashboard` is new, added to the Protected table above; it is not org-scoped and carries no data of its own as of this pass (deliberate — see [DASH-1 UI Design Document](../ui-design/2026-09-07-dash-1-root-redirect-dashboard-ui-design.md) §4).

**Correction (2026-09-07, DASH-2) — naming overlap, flagged not resolved:** `OrgHome` (`/orgs/:orgId`) is now labeled "Dashboard" in its heading/sidebar/breadcrumb text (component name and route unchanged). This is a **different screen** from the `/dashboard` row directly above it in this same table — a logged-in user can reach two URLs that both display "Dashboard," one an empty placeholder (FR-DASH-1) and one their org's project list (FR-DASH-2). Accepted per [ADR-0039](../adr/0039-dash-2-org-home-dashboard-relabel-and-project-table.md)'s Consequences (NFR-49) — resolving the overlap (consolidating the two screens, or renaming one again) is explicitly deferred to a future story, not silently decided here.

**Correction (2026-09-08, EXEC-3):** FR-EXEC-3's own remaining surface is now built too — split across the two existing host screens the EXEC-1/EXEC-2 corrections above already anticipated `TestExecutionRunner` would resolve into, no new route or screen name either. `TestCycleDetail` gains a "Raise Defect" button on each `fail`-result execution-history row (next to the existing "History" button), opening a modal submitting the new `POST /executions/{id}/defects`. `EntityFormPage`'s `test-case` edit page (the generic admin surface's own `test-case` config — see below — is `TestCase`'s only detail view, there is no bespoke `TestCaseDetail` page) gains a read-only "Defects" section, backed by the new `GET /test-cases/{id}/defects`, most-recent-first ([EXEC-3 UI Design Document](../ui-design/2026-09-08-exec-3-raise-defect-ui-design.md), [ADR-0044](../adr/0044-exec-3-raise-defect-from-execution.md)). `TestExecutionRunner`'s reservation is now fully resolved — nothing remains in the "not yet built" list below for it.

**Not yet built** (scoped by other, not-yet-implemented stories — listed here as reserved paths so a future generic-admin config never collides with them): `TraceabilityMatrix` (FR-TRACE-1..2).

**Note (2026-09-07, DS-2):** every table-rendering screen listed in this document (`OrgHome`/Dashboard's Project table, `OrgMembers`, `ProjectDetail`'s Release/Test Suite/Risk Item tables, `TestPlanDetail`'s Test Plans list, `RoleAssignmentsPanel`, and the generic admin CRUD surface below) now shares one implementation, `frontend/src/container/Table.tsx` ([ADR-0041](../adr/0041-ds-2-table-container-shared-pagination.md)) — a component swap only, no route added, removed, or renamed, and no screen's URL/nav-item/breadcrumb changes. Not repeated as an edit on each row above.

**Note (2026-09-08, DS-3):** `OrgHome`/Dashboard's two count widgets and `TestCycleDetail`'s 4 execution-dashboard tiles now share one implementation, `components/molecules/info-box/InfoBox.tsx` ([ADR-0045](../adr/0045-ds-3-infobox-widget-consolidation.md)) — a component swap only, no route added, removed, or renamed, and no screen's URL/nav-item/breadcrumb changes.

## Protected — generic admin CRUD surface (ADR-0027)

Two page components (`EntityListPage`, `EntityFormPage`), routed generically off an entity registry — the rows below are the registry's contents, not 28 separate `<Route>` declarations in `App.tsx`. **One exception as of EXEC-3:** `EntityFormPage` renders one extra, bespoke read-only section (a `test-case`'s raised Defects, most recent first) when `entityKey === "test-cases"` specifically — every other entity's edit page is still the plain generic field form with no such addition ([ADR-0044](../adr/0044-exec-3-raise-defect-from-execution.md)).

**Org/global-scoped** — `/orgs/:orgId/admin/:entity`. **Restructured 2026-09-08 ([ADR-0046](../adr/0046-shell-7-sidebar-mini-org-crud-restructure.md), SHELL-7):** the single flat "Admin" nav group is replaced by 3 named groups — routes/entities below are unchanged, only which sidebar group reaches each one changed.

| `:entity` | Backs | Sidebar group (as of SHELL-7) |
|---|---|---|
| `roles` | `Role` | Access Control |
| `role-assignments` | `RoleAssignment` (edit/delete only) | Access Control |
| `permissions` | `Permission` (read-only) | Access Control |
| `org-memberships` | `OrgMembership` (coexists with `OrgMembers`) | Access Control |
| `test-design-techniques` | `TestDesignTechnique` | Catalogs |
| `test-levels` | `TestLevel` | Catalogs |
| `test-types` | `TestType` | Catalogs |
| `organizations` | `Organization` (coexists with `OrgHome`, UI Design Document §6) | Organization |

**Project-scoped** — `/projects/:projectId/admin/:entity`, reached via `ProjectDetail`'s "Admin" tab:

| `:entity` | Backs | Scope shape |
|---|---|---|
| `environments` | `Environment` | plain |
| `test-plans` | `TestPlan` | plain |
| `entry-exit-criteria` | `EntryExitCriteria` | plain — same rows also reachable, scoped to one plan, via `TestPlanDetail`'s own full-CRUD section (PLAN-2, [ADR-0032](../adr/0032-plan2-entry-exit-criteria-visibility.md)) |
| `test-cycles` | `TestCycle` | plain, no create via this surface as of [ADR-0033](../adr/0033-plan3-test-cycle-creation-and-execution-scope-check.md) (creation is bespoke, on `TestPlanDetail`) |
| `requirements` | `Requirement` | plain |
| `test-conditions` | `TestCondition` | plain, read/update/delete only — no create via this surface as of [ADR-0028](../adr/0028-req3-test-condition-rigor-path-bespoke-routes.md) (creation is bespoke, on `ProjectDetail`) |
| `test-cases` | `TestCase` | plain (no create on this generic-admin page — both REQ-2's direct-link create and REQ-3's TestCondition-mediated create exist only as `ProjectDetail`'s bespoke "New Test Case" modals, above, never here) |
| `test-steps` | `TestStep` | plain |
| `test-suites` | `TestSuite` | plain |
| `defects` | `Defect` | `GET`/`PATCH`/`DELETE` only, same reason as `TestCase` — creation is bespoke, `POST /executions/{id}/defects` (as of [ADR-0044](../adr/0044-exec-3-raise-defect-from-execution.md)/EXEC-3, called from `TestCycleDetail`'s "Raise Defect" modal, not this admin surface) |
| `test-executions` | `TestExecution` | plain, no create via this surface as of [ADR-0033](../adr/0033-plan3-test-cycle-creation-and-execution-scope-check.md) (creation is bespoke, `POST /test-cycles/{id}/executions` — as of [ADR-0034](../adr/0034-exec-1-test-execution-recording-dashboard.md)/EXEC-1, called from `TestCycleDetail`'s "Record Result" modal, not this admin surface) |
| `test-logs` | `TestLog` | read-only |
| `risk-items` | `RiskItem` | scope-selector (Requirement **or** TestPlan) |
| `attachments` | `Attachment` | scope-selector (via TestCase) |
| `requirement-test-case-links` | `RequirementTestCaseLink` | read-only |
| `requirement-test-condition-links` | `RequirementTestConditionLink` | read-only |
| `test-condition-test-case-links` | `TestConditionTestCaseLink` | read-only |
| `test-case-defect-links` | `TestCaseDefectLink` | read-only — row created only as a side effect of `POST /executions/{id}/defects` ([ADR-0044](../adr/0044-exec-3-raise-defect-from-execution.md)/EXEC-3); the ordering-guaranteed equivalent view is `GET /test-cases/{id}/defects`, surfaced on `EntityFormPage`'s `test-case` edit page, not this admin surface |
| `projects` | `Project` | coexists with `ProjectDetail` itself |
| `releases` | `Release` | coexists with `ProjectDetail`'s own Release list |

28 entities total across both tables. **Deliberately absent from this surface, anywhere:** `Approval`, `User`, `AIAgent`, `AuthIdentity` — see [ADR-0027](../adr/0027-generic-admin-crud-ui-and-backend-completion.md) for why (no plain-field CRUD path exists for any of the four).

## Header controls (persistent, not routes)

Chrome rendered inside `AppHeader` on every `ProtectedRoute` screen, not tied to any single route — the existing dark/light-mode toggle (ADR-0020) was never documented here either (it's route-independent, out of this route-scoped document's original stated scope), but the org switcher is called out explicitly because switching *changes* the current route (`navigate('/orgs/{id}')`), unlike the color-mode toggle:

| Control | Notes |
|---|---|
| Organization switcher (icon dropdown) | SHELL-6, [ADR-0036](../adr/0036-shell-6-organization-switcher-header-dropdown.md), [UI Design Document](../ui-design/2026-09-07-shell-6-org-switcher-ui-design.md) — lists the caller's orgs (`GET /auth/me/orgs`, lazy-fetched on open), selecting one navigates to that org's root `/orgs/{id}` |

## Route tree (visual)

```
/                                        (redirect guard, not a screen — DASH-1: /login or /dashboard)
/dashboard                               Dashboard (empty placeholder, DASH-1)
/login                                   Login (public)
/signup                                  Signup (public)
/invites/:token/accept                   AcceptInvite (public, token-gated)
/orgs/pick                               OrgPicker
/orgs/:orgId                             OrgHome (labeled "Dashboard" — DASH-2)
├── /projects                            ProjectsPage (PROJ-4 — Project CRUD, moved off Dashboard)
├── /members                             OrgMembers
└── /admin/:entity                       EntityListPage — 8 org/global entities (table above)
    └── /admin/:entity/:id/edit          EntityFormPage
/projects/:projectId                     ProjectDetail
├── /test-plans/:testPlanId              TestPlanDetail (PLAN-1)
└── /admin/:entity                       EntityListPage — 20 project-scoped entities (table above)
    └── /admin/:entity/:id/edit          EntityFormPage
```
