# Sitemap — Project Scaffold

**Date:** 2026-09-05
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** `frontend/src/App.tsx` (route source of truth — this document tracks it, not the reverse), [Generic Admin CRUD UI Design Document](../ui-design/2026-09-05-generic-admin-crud-ui-design.md), [ADR-0027](../adr/0027-generic-admin-crud-ui-and-backend-completion.md), [REQ-3 UI Design Document](../ui-design/2026-09-06-req-3-test-condition-rigor-path-ui-design.md), [ADR-0028](../adr/0028-req3-test-condition-rigor-path-bespoke-routes.md), [ADR-0029](../adr/0029-testcase-resolver-direct-link-fallback.md), [REQ-4 UI Design Document](../ui-design/2026-09-06-req-4-test-suite-membership-ui-design.md), [ADR-0030](../adr/0030-req4-test-suite-membership-bespoke-routes.md), [PLAN-1 UI Design Document](../ui-design/2026-09-06-plan-1-test-plan-membership-ui-design.md), [ADR-0031](../adr/0031-plan1-test-plan-membership-and-status-transition-routes.md), [PLAN-2 UI Design Document](../ui-design/2026-09-06-plan-2-entry-exit-criteria-visibility-ui-design.md), [ADR-0032](../adr/0032-plan2-entry-exit-criteria-visibility.md), [PLAN-3 UI Design Document](../ui-design/2026-09-06-plan-3-test-cycle-creation-ui-design.md), [ADR-0033](../adr/0033-plan3-test-cycle-creation-and-execution-scope-check.md)

First sitemap for this repo — no prior one existed; routes accreted story-by-story directly into `App.tsx`. Written now because the generic admin surface adds routes generated from a registry rather than one literal `<Route>` per entity, which is worth documenting as a pattern rather than 28 individual rows would otherwise obscure.

## Public (unauthenticated)

| Route | Screen | Notes |
|---|---|---|
| `/` | `LandingPage` | FR-LANDING-1; redirects to `/orgs/{id}` or `/orgs/pick` if already authenticated |
| `/login` | `Login` | FR-AUTH-1 |
| `/signup` | `Signup` | FR-RBAC-1, bootstrap-only (closes after the first `Organization` exists) |
| `/invites/:token/accept` | `AcceptInvite` | RBAC-2/ADR-0017, token-gated not `Authorization`-gated |

## Protected — bespoke workflow screens

| Route | Screen | Notes |
|---|---|---|
| `/orgs/pick` | `OrgPicker` | multi-org account, no org selected yet |
| `/orgs/:orgId` | `OrgHome` | project list, dashboard stat widgets (FR-SHELL-3) |
| `/orgs/:orgId/members` | `OrgMembers` | RBAC-2 |
| `/projects/:projectId` | `ProjectDetail` | Release list, per-release TestCycle/TestExecution audit view (PROJ-2), each cycle's nested view additionally showing its parent plan's `exit`-type EntryExitCriteria alongside its executions (PLAN-2, [ADR-0032](../adr/0032-plan2-entry-exit-criteria-visibility.md)); Requirement list + "New Requirement" modal (REQ-1); per-Requirement direct-link TestCase list + "New Test Case" modal, per-TestCase TestStep list + add/inline-edit (REQ-2, ADR-0006/[ADR-0029](../adr/0029-testcase-resolver-direct-link-fallback.md)); per-Requirement Test Condition list + create, per-Test-Condition Test Case create + list (REQ-3/REQ-4, [ADR-0028](../adr/0028-req3-test-condition-rigor-path-bespoke-routes.md)) — the two coexist per-TestCase within a project (ADR-0006); Test Suites list + create modal, per-suite live TestCase-membership view with add/remove (REQ-4, [ADR-0030](../adr/0030-req4-test-suite-membership-bespoke-routes.md), [REQ-4 UI Design Document](../ui-design/2026-09-06-req-4-test-suite-membership-ui-design.md)); Test Plans list, rows link to `TestPlanDetail` below rather than expanding in place (PLAN-1, [PLAN-1 UI Design Document](../ui-design/2026-09-06-plan-1-test-plan-membership-ui-design.md)) |
| `/projects/:projectId/test-plans/:testPlanId` | `TestPlanDetail` | Plan header (identifier/scope/approach/staffing/schedule/status, edit modal) + Test Suites section (live included-suites list, add/remove) + read-only Covered Test Cases section (PLAN-1, [ADR-0031](../adr/0031-plan1-test-plan-membership-and-status-transition-routes.md), [PLAN-1 UI Design Document](../ui-design/2026-09-06-plan-1-test-plan-membership-ui-design.md)) — first bespoke screen routed as its own dedicated per-entity page rather than a `ProjectDetail` expand-in-place section (§1 of that document), anticipating PLAN-2/PLAN-3's own further extensions of the same route; **PLAN-2 addition:** full-CRUD "Entry/Exit Criteria" section (all 4 types, list/add/edit/delete, reuses the generic admin surface's own `entry-exit-criteria` config) ([ADR-0032](../adr/0032-plan2-entry-exit-criteria-visibility.md), [PLAN-2 UI Design Document](../ui-design/2026-09-06-plan-2-entry-exit-criteria-visibility-ui-design.md)); **PLAN-3 addition (final of the three anticipated extensions):** "Test Cycles" section — live list + "Create Cycle" modal (`release_id`/`environment_id` `FkAutocomplete`s, inline "+ New Environment" sequential-create toggle), submits the new `POST /test-plans/{id}/test-cycles` ([ADR-0033](../adr/0033-plan3-test-cycle-creation-and-execution-scope-check.md), [PLAN-3 UI Design Document](../ui-design/2026-09-06-plan-3-test-cycle-creation-ui-design.md)) |
| `/orgs/:orgId/ui-elements/{colors,typography,icons}` | `Colors`/`Typography`/`Icons` | template-parity scaffolding, no FR backing (ADR-0020) |

**Correction (2026-09-06):** this doc's 2026-09-05 version reserved a dedicated `RequirementDetail` page for FR-REQ-1..3. REQ-1 had already shipped by then with its Requirement list/create inline on `ProjectDetail` instead (never on a separate page) — the reservation was stale before REQ-2/REQ-3 even started. Both REQ-2's direct-link path and REQ-3's TestCondition-mediated path continue that actual placement (see [REQ-3 UI Design Document](../ui-design/2026-09-06-req-3-test-condition-rigor-path-ui-design.md)) rather than resurrecting the unused reservation, which would have split one Requirement's authoring UI across two screens. `RequirementDetail` is removed from the reserved-paths list below.

**Correction (2026-09-06):** this doc's 2026-09-05 version also reserved a dedicated `TestSuiteBuilder` page for FR-REQ-4. REQ-4 instead extends `ProjectDetail` with a "Test Suites" section (same pattern as the Requirement/TestCondition corrections above) — see the [REQ-4 UI Design Document](../ui-design/2026-09-06-req-4-test-suite-membership-ui-design.md). `TestSuiteBuilder` is removed from the reserved-paths list below.

**Departure (2026-09-06, PLAN-1):** unlike every REQ-* story above, PLAN-1 does **not** extend `ProjectDetail` in place — it opens `/projects/:projectId/test-plans/:testPlanId` as `TestPlan`'s own dedicated route, on direct CTO direction, anticipating PLAN-2/PLAN-3's further extensions of the same object (see [PLAN-1 UI Design Document](../ui-design/2026-09-06-plan-1-test-plan-membership-ui-design.md) §1 for the full reasoning). `ProjectDetail` itself only gains a thin "Test Plans" list section whose rows link out to this new route, rather than expanding in place.

**Not yet built** (scoped by other, not-yet-implemented stories — listed here as reserved paths so a future generic-admin config never collides with them): `TestExecutionRunner` (FR-EXEC-1..3), `TraceabilityMatrix` (FR-TRACE-1..2).

## Protected — generic admin CRUD surface (ADR-0027)

Two page components (`EntityListPage`, `EntityFormPage`), routed generically off an entity registry — the rows below are the registry's contents, not 28 separate `<Route>` declarations in `App.tsx`.

**Org/global-scoped** — `/orgs/:orgId/admin/:entity`, reached via the sidebar's "Admin" nav group:

| `:entity` | Backs |
|---|---|
| `roles` | `Role` |
| `role-assignments` | `RoleAssignment` (edit/delete only) |
| `permissions` | `Permission` (read-only) |
| `test-design-techniques` | `TestDesignTechnique` |
| `test-levels` | `TestLevel` |
| `test-types` | `TestType` |
| `organizations` | `Organization` (coexists with `OrgHome`, UI Design Document §6) |
| `org-memberships` | `OrgMembership` (coexists with `OrgMembers`) |

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
| `defects` | `Defect` | plain (no create — reserved, same reason as `TestCase`) |
| `test-executions` | `TestExecution` | plain, no create via this surface as of [ADR-0033](../adr/0033-plan3-test-cycle-creation-and-execution-scope-check.md) (creation is bespoke, `POST /test-cycles/{id}/executions` — no frontend form calls it yet, PLAN-3's own non-goal, reserved for EXEC-1's `TestExecutionRunner`) |
| `test-logs` | `TestLog` | read-only |
| `risk-items` | `RiskItem` | scope-selector (Requirement **or** TestPlan) |
| `attachments` | `Attachment` | scope-selector (via TestCase) |
| `requirement-test-case-links` | `RequirementTestCaseLink` | read-only |
| `requirement-test-condition-links` | `RequirementTestConditionLink` | read-only |
| `test-condition-test-case-links` | `TestConditionTestCaseLink` | read-only |
| `test-case-defect-links` | `TestCaseDefectLink` | read-only |
| `projects` | `Project` | coexists with `ProjectDetail` itself |
| `releases` | `Release` | coexists with `ProjectDetail`'s own Release list |

28 entities total across both tables. **Deliberately absent from this surface, anywhere:** `Approval`, `User`, `AIAgent`, `AuthIdentity` — see [ADR-0027](../adr/0027-generic-admin-crud-ui-and-backend-completion.md) for why (no plain-field CRUD path exists for any of the four).

## Route tree (visual)

```
/                                        LandingPage (public)
/login                                   Login (public)
/signup                                  Signup (public)
/invites/:token/accept                   AcceptInvite (public, token-gated)
/orgs/pick                               OrgPicker
/orgs/:orgId                             OrgHome
├── /members                             OrgMembers
├── /ui-elements/{colors,typography,icons}   (no FR — template scaffolding)
└── /admin/:entity                       EntityListPage — 8 org/global entities (table above)
    └── /admin/:entity/:id/edit          EntityFormPage
/projects/:projectId                     ProjectDetail
├── /test-plans/:testPlanId              TestPlanDetail (PLAN-1)
└── /admin/:entity                       EntityListPage — 20 project-scoped entities (table above)
    └── /admin/:entity/:id/edit          EntityFormPage
```
