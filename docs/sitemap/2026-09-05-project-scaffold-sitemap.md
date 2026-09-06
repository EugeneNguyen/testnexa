# Sitemap — Project Scaffold

**Date:** 2026-09-05
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** `frontend/src/App.tsx` (route source of truth — this document tracks it, not the reverse), [Generic Admin CRUD UI Design Document](../ui-design/2026-09-05-generic-admin-crud-ui-design.md), [ADR-0027](../adr/0027-generic-admin-crud-ui-and-backend-completion.md), [REQ-3 UI Design Document](../ui-design/2026-09-06-req-3-test-condition-rigor-path-ui-design.md), [ADR-0028](../adr/0028-req3-test-condition-rigor-path-bespoke-routes.md)

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
| `/projects/:projectId` | `ProjectDetail` | Release list, per-release TestCycle/TestExecution audit view (PROJ-2); Requirement list + create (REQ-1); per-Requirement Test Condition list + create, per-Test-Condition Test Case create (REQ-3, [ADR-0028](../adr/0028-req3-test-condition-rigor-path-bespoke-routes.md)) |
| `/orgs/:orgId/ui-elements/{colors,typography,icons}` | `Colors`/`Typography`/`Icons` | template-parity scaffolding, no FR backing (ADR-0020) |

**Correction (2026-09-06):** this doc's 2026-09-05 version reserved a dedicated `RequirementDetail` page for FR-REQ-1..3. REQ-1 had already shipped by then with its Requirement list/create inline on `ProjectDetail` instead (never on a separate page) — the reservation was stale before REQ-3 even started. REQ-3 continues that actual placement (see [REQ-3 UI Design Document](../ui-design/2026-09-06-req-3-test-condition-rigor-path-ui-design.md)) rather than resurrecting the unused reservation, which would have split one Requirement's authoring UI across two screens. `RequirementDetail` is removed from the reserved-paths list below.

**Not yet built** (scoped by other, not-yet-implemented stories — listed here as reserved paths so a future generic-admin config never collides with them): `TestSuiteBuilder` (FR-REQ-4), `TestExecutionRunner` (FR-EXEC-1..3), `TraceabilityMatrix` (FR-TRACE-1..2). FR-REQ-2's own direct-link "New Test Case" modal (on `ProjectDetail`, alongside REQ-3's Test Condition UI) also remains not-yet-built.

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
| `entry-exit-criteria` | `EntryExitCriteria` | plain |
| `test-cycles` | `TestCycle` | plain |
| `requirements` | `Requirement` | plain |
| `test-conditions` | `TestCondition` | plain, read/update/delete only — no create via this surface as of [ADR-0028](../adr/0028-req3-test-condition-rigor-path-bespoke-routes.md) (creation is bespoke, on `ProjectDetail`) |
| `test-cases` | `TestCase` | plain (no create — reserved for a future bespoke atomic-create route) |
| `test-steps` | `TestStep` | plain |
| `test-suites` | `TestSuite` | plain |
| `defects` | `Defect` | plain (no create — reserved, same reason as `TestCase`) |
| `test-executions` | `TestExecution` | plain |
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
└── /admin/:entity                       EntityListPage — 20 project-scoped entities (table above)
    └── /admin/:entity/:id/edit          EntityFormPage
```
