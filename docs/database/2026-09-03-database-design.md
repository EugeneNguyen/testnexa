# Database Document — Project Scaffold

**Date:** 2026-09-03
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [07 ERD](../product-discovery/07-erd-draft.md), [Scaffold design spec](../superpowers/specs/2026-09-03-project-scaffold-design.md), [ADR-0005](../adr/0005-traceability-link-dedicated-join-tables.md), [ADR-0006](../adr/0006-test-condition-optional.md), [ADR-0007](../adr/0007-real-multi-tenancy.md), [ADR-0008](../adr/0008-uuid-primary-keys.md), [ADR-0011](../adr/0011-login-rate-limiting.md), [ADR-0013](../adr/0013-refresh-token-rotation-policy.md), [ADR-0015](../adr/0015-ai-agent-credential-mechanics.md), [ADR-0016](../adr/0016-organization-bootstrap-creation-flow.md), [ADR-0022](../adr/0022-generic-crud-router-factory.md), [ADR-0025](../adr/0025-requirement-title-field.md), [ADR-0027](../adr/0027-generic-admin-crud-ui-and-backend-completion.md), [ADR-0029](../adr/0029-testcase-resolver-direct-link-fallback.md), [ADR-0030](../adr/0030-req4-test-suite-membership-bespoke-routes.md), [ADR-0031](../adr/0031-plan1-test-plan-membership-and-status-transition-routes.md)

This document is the implementation-level schema, refined from the [07 ERD](../product-discovery/07-erd-draft.md) draft per the ADRs above. No code — this is the reference for the Alembic migration that will be written when implementation is authorized.

**SHELL-1** ([ADR-0018](../adr/0018-admin-shell-sidebar-layout.md), FR-SHELL-1) — reviewed, no schema impact. The admin shell (sidebar + navbar) is frontend-only: no new table, column, or index. Noted here explicitly so the gap isn't mistaken for an oversight.

**ADMIN-4** ([ADR-0056](../adr/0056-admin-4-generic-admin-crud-column-sort.md), FR-ADMIN-3/NFR-60) — reviewed, no schema impact. Column sort is a query-param-driven `ORDER BY` over already-defined columns (`apply_sort`, application-layer only) — no new table, column, index, or migration.

**FRONTEND-1** ([ADR-0049](../adr/0049-frontend-co-locate-unit-tests.md), NFR-54) — reviewed, no schema impact. Vitest unit-test files move from `frontend/tests/**.test.{ts,tsx}` to live co-located next to their source under `frontend/src/`; the single non-test file (`frontend/test-setup/setup.ts`, the jsdom-polyfill setup) moves to a renamed folder of the same level. No table, column, index, migration, or seed change — purely frontend file-layout. Noted here explicitly so the gap isn't mistaken for an oversight (same posture this section's other "no schema impact" annotations take for prior frontend-only ADRs).

**MCP-1** ([ADR-0033](../adr/0033-mcp-server-architecture.md), FR-MCP-1, NFR-43) — reviewed, no schema impact. The MCP server is a thin client over the existing service layer: same `AIAgent` (already covered §3.4), same `RoleAssignment`/`RolePermission` permission resolution (no new codes — `test_case.create`/`.read` already in the RBAC-4 catalog), same `Requirement`/`TestCase`/`RequirementTestCaseLink` tables (REQ-2's pre-existing schema). The `_actor_membership_exists` route-side helper added in `app/api/routes/assets.py` is application-layer logic, not schema; `OrgMembership.user_id` FKs `user.actor_id` exactly as §3.1 already documents (Database Document §3.1's "AIAgent has no `user` row of its own, org relationship is transitive via `acting_on_behalf_of_user_id`" note already covers the constraint the new helper enforces). Noted here explicitly so the gap isn't mistaken for an oversight.

**Sidebar dark color scheme** ([ADR-0026](../adr/0026-sidebar-dark-color-scheme.md), FR-SHELL-5) — reviewed, no schema impact. A `CSidebar` prop value; no table, column, or index change.

**SHELL-2/3/4** ([ADR-0020](../adr/0020-admin-shell-full-template-parity.md), FR-SHELL-2/3/4) — reviewed, no schema impact. Breadcrumb/footer are frontend-only; dashboard stat widgets read existing `Project`/`OrgMembership` rows via already-built generic-CRUD list queries (no new table/column); dark/light mode preference is `localStorage`-only (NFR-26) — deliberately not a new `User`/`Actor` column, since it's presentation state, not account data worth persisting server-side in this scaffold. *(Corrected 2026-09-07, SHELL-6 pass: this line previously cited ADR-0019 — that's the Release-creation-flow ADR; the full-template-parity ADR is 0020.)*

**SHELL-6** ([ADR-0036](../adr/0036-shell-6-organization-switcher-header-dropdown.md), FR-SHELL-6, FR-AUTH-5) — reviewed, no schema impact. The header org switcher is a pure read of existing `OrgMembership`/`Organization`/`User` rows (§3.1) via the new `GET /auth/me/orgs` route, which reuses `OrgSummary` (already defined for `LoginResponse`) verbatim and applies the exact same `status = active` filter login/refresh already use — no new table, column, or index.

**ADMIN-2** ([ADR-0022](../adr/0022-generic-crud-router-factory.md), FR-ADMIN-2) — reviewed, no schema impact: the generic CRUD router factory adds no table/column/index, only application-layer routing and permission-check logic over tables already defined below. Annotated inline where a table's existing shape drives factory behavior: `Role.org_id`'s nullability (§3.3), `TestCase.test_condition_id`'s nullability (§3.6), `RiskItem`'s branching FK pair (§3.11), `Attachment`'s create scope (§3.11).

**DS-1** ([ADR-0023](../adr/0023-frontend-shared-component-location.md), FR-DS-1) — reviewed, no schema impact. `FormField` is a pure presentational component; `Login.tsx`/`Signup.tsx`'s migration onto React Hook Form + Zod changes client-side validation only, not the request payload shape either route already accepts.

**LANDING-1** ([ADR-0024](../adr/0024-public-landing-page.md), FR-LANDING-1, superseded by DASH-1 below) — reviewed, no schema impact. The public landing page is frontend-only: no new table, column, or index, and it makes no API call at all (authenticated or otherwise). Deleting `ScaffoldVerificationPage` likewise has no schema impact — it never wrote to or read from any table itself, only `GET /api/health`.

**DASH-1** ([ADR-0035](../adr/0035-dash-1-root-redirect-and-dashboard-placeholder.md), FR-DASH-1) — reviewed, no schema impact. The `/` root guard reads only `AuthContext`'s existing client-side `accessToken`/`isInitializing` state (no new table/column/index); the new `Dashboard` screen makes no API call at all — it is an empty placeholder with no data of its own to query.

**REQ-1** ([ADR-0025](../adr/0025-requirement-title-field.md), FR-REQ-1) — one column added: `Requirement.title` (§3.6), closing a gap between the schema and FR-REQ-1/TC-REQ-001's always-specified `title` field. No other schema impact — `Requirement`'s create/read/update/delete/list routes, permission gating, and tenant-scoping were already fully delivered by ADMIN-2's generic CRUD factory before this story.

**ADR-0027** (generic admin CRUD UI + execution/traceability backend completion, FR-ADMIN-2 completion) — reviewed, no schema impact. `TestExecution`/`TestLog` (§3.8) and the 4 link tables (§3.9) were already fully specified below — this pass only adds application-layer routes/permission-check wiring over tables already defined, same posture ADR-0022's own note above already established for the other 20 entities. `GET /orgs/{org_id}/permissions/mine` reads existing `RoleAssignment`/`Role`/`RolePermission`/`Permission` rows (§3.3) — no new table/column/index.

**SHELL-7** ([ADR-0046](../adr/0046-shell-7-sidebar-mini-org-crud-restructure.md), FR-SHELL-7) — reviewed, no schema impact. The sidebar-mini layout is a body-class CSS toggle; the org-scoped CRUD nav restructure only regroups `AppSidebar.tsx`'s presentation of the existing `orgScopedEntities` registry (`Role`, `Permission`, `RoleAssignment`, `OrgMembership`, `TestDesignTechnique`, `TestLevel`, `TestType`, `Organization`) into 3 named groups — no table, column, index, or route reads/writes any differently. Noted here explicitly so the gap isn't mistaken for an oversight.

**PROJ-4** ([ADR-0047](../adr/0047-proj-4-projects-page-sidebar-entry.md), FR-PROJ-3/FR-PROJ-4) — reviewed, no schema impact. Relocating Project CRUD from `OrgHome`/"Dashboard" to its own `ProjectsPage`/`/orgs/:orgId/projects` is a frontend route/component move — the `Project` table (§3.5) and every route/query it already backed are unchanged. Noted here explicitly so the gap isn't mistaken for an oversight.

**BRAND-1** ([ADR-0048](../adr/0048-brand-1-logo-brand-system.md), FR-BRAND-1) — reviewed, no schema impact. The entire logo/brand system (SVG assets, favicon, `BrandLogo`/`AppHeader`/`AppSidebar` markup) is frontend-only presentation — no table, column, index, or query reads/writes any differently. Noted here explicitly so the gap isn't mistaken for an oversight.

**SHELL-9** ([ADR-0050](../adr/0050-shell-9-project-scope-nav-context-resolution.md), FR-SHELL-8) — reviewed, no schema impact. `useResolvedOrgId()`'s fetch-when-absent branch reads the `Project` table's own existing `org_id` column (§3.5) via the already-shipped `GET /projects/{id}`; no new table, column, index, or query shape. Noted here explicitly so the gap isn't mistaken for an oversight.

**SHELL-10** ([ADR-0051](../adr/0051-shell-10-project-scope-entity-nav.md), FR-SHELL-9) — reviewed, no schema impact. A sidebar presentation change only — every entity `PROJECT_ENTITY_GROUPS` groups is already fully specified in the sections below, reached via its already-shipped `/projects/:projectId/admin/<entity>` route (ADR-0025/ADR-0027's registry). No table, column, index, or route reads/writes any differently. Noted here explicitly so the gap isn't mistaken for an oversight.

**Tabler CDN install, Phase 1** ([ADR-0053](../adr/0053-tabler-install-phase-1-cdn.md), FR-DS-3) — reviewed, no schema impact. A static frontend asset addition only (`frontend/index.html` gains two CDN tags) — no table, column, index, or migration of any kind.

---

## 1. Entity count reconciliation

07's "28 entities" (20 core + 8 extended) is a business-entity count. The physical schema below has more tables, all structural additions with no independent business meaning of their own:

- **28 → 31**: `TraceabilityLink` (1 entity in 07) is replaced by 4 dedicated tables (`RequirementTestCaseLink`, `RequirementTestConditionLink`, `TestConditionTestCaseLink`, `TestCaseDefectLink`) per ADR-0005.
- **+1**: `RefreshToken` — an implementation necessity for revocable sessions (AUTH-2), not in 07's original entity list.
- **+1**: `LoginAttempt` — an implementation necessity for login rate limiting ([ADR-0011](../adr/0011-login-rate-limiting.md)), not in 07's original entity list.
- **+3 pure junction tables**: `TestSuiteTestCase`, `TestPlanTestSuite`, `TestCaseTestDesignTechnique` — many-to-many joins 07 drew as diagram relationships (`}o--o{`) without naming a table. These carry no attributes beyond the two FK columns.

**Total physical tables: 36.**

## 2. Schema-wide conventions

- **Primary keys:** every table has a surrogate `id UUID PRIMARY KEY`, generated application-side as **UUIDv7** (time-sortable) — no auto-increment integers anywhere, including junction/link tables. See [ADR-0008](../adr/0008-uuid-primary-keys.md).
- **Timestamps:** every table has `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` and `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` (auto-touched on update), **except `TestLog`**, which has only `logged_at` — no `updated_at` column exists, enforcing immutability at the schema level, not just via a missing API endpoint.
- **Tenant isolation:** every tenant-scoped table carries a resolvable path to `org_id` (directly or via one FK hop) so every query can filter by `org_id` — see NFR-1 in the [Requirements Document](../requirements/2026-09-03-project-scaffold-requirements.md).
- **Deletes:** FKs default to `ON DELETE RESTRICT` for core test-asset entities (favor status-field transitions — e.g. `TestCase.status = deprecated` — over hard deletes, to preserve audit history). Junction/link tables use `ON DELETE CASCADE` on both FK columns (a link is meaningless once either side is gone). Lookup tables (`Role`, `Permission`, `TestLevel`, `TestType`, `TestDesignTechnique`, `Environment`) allow hard delete by an admin with the corresponding `.delete` permission.
- **Enums:** modeled as Postgres `ENUM` types (or `VARCHAR` + `CHECK` constraint, implementation's choice) — never free text, per NFR-5.

## 3. Tables by cluster

### 3.1 `tenancy.py` — Organization, OrgMembership

**Organization**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| name | varchar | not null |
| slug | varchar | not null, unique (deployment-wide, RBAC-1) |
| default_standards_profile | varchar | nullable |
| created_at, updated_at | timestamptz | not null |

**OrgMembership**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| org_id | uuid | FK → organization.id, not null, indexed |
| user_id | uuid | FK → user.id, not null, indexed |
| status | enum(invited, active, suspended) | not null, default invited |
| joined_at | timestamptz | nullable (set on invite-acceptance) |
| created_at, updated_at | timestamptz | not null |

Unique: `(org_id, user_id)`.

**Creation flow** (RBAC-1, [ADR-0016](../adr/0016-organization-bootstrap-creation-flow.md)) is application logic, not a schema concern — no dedicated migration beyond what RBAC-4 already seeds (the `org_admin` `Role` a first signup/second-org creation assigns already exists as a global template, `org_id = NULL`). Two creation paths exist: bootstrap `POST /auth/signup` (public, closes once any `Organization` row exists) and authenticated `POST /orgs` (existing org_admin). Both insert one `Organization` row + one `OrgMembership(status=active)` row + one org-wide `RoleAssignment` (`project_id = NULL`, `role_id` = the seeded `org_admin` `Role`) for the creator, in the same transaction.

`default_standards_profile` (PROJ-1, [ADR-0017](../adr/0017-project-creation-flow.md)) had no consumer until PROJ-1: it's the org-wide fallback a new `Project.standards_profile` inherits when the create request omits the field — see §3.5.

### 3.2 `auth.py` — AuthIdentity, RefreshToken

**AuthIdentity**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK → user.id, not null, indexed |
| provider | enum(local, oidc, saml, ldap, github, google) | not null — **only `local` has working auth logic in this scaffold**; others are schema-ready per 07, unimplemented (out of scope) |
| external_id | varchar | nullable |
| is_primary | boolean | not null, default true |
| last_login_at | timestamptz | nullable |
| created_at, updated_at | timestamptz | not null |

**RefreshToken** *(not in 07 — added per [ADR-0003](../adr/0003-auth-token-strategy.md); rotation semantics per [ADR-0013](../adr/0013-refresh-token-rotation-policy.md); logout revocation semantics per [ADR-0014](../adr/0014-logout-session-revocation-policy.md))*
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK → user.id, not null, indexed |
| token_hash | varchar | not null, **unique, indexed** — raw token never stored. Uniqueness/index added in ADR-0013: `POST /auth/refresh` looks this column up by value on every renewal (a hot path once sessions persist across restarts), unlike AUTH-1 which only ever wrote it |
| issued_at | timestamptz | not null |
| expires_at | timestamptz | not null — on rotation, copied verbatim from the token being replaced, **not** recomputed as `now + JWT_REFRESH_TTL_DAYS` (ADR-0013: caps a session's absolute lifetime at 30 days from original login regardless of renewal frequency) |
| revoked_at | timestamptz | nullable |
| revoked_reason | varchar | nullable — `logout` (AUTH-3/ADR-0014: revoked via the atomic `WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL` compare-and-swap, scoped to the authenticated caller so a foreign token is never touched), `admin_force_logout` (no admin UI yet, but any write to this column achieves it), `rotated` (ADR-0013: every `POST /auth/refresh` revokes the token it consumes, single-use) |
| created_at, updated_at | timestamptz | not null |

**Rotation chain note:** a session is a chain of `RefreshToken` rows linked only implicitly (each rotation's new row copies the prior row's `expires_at`) — there is no explicit `session_id`/chain-root column. This is a deliberate minimalism: the copy-forward is sufficient to bound absolute session lifetime without an extra column, and nothing in AUTH-2's scope needs to enumerate a session's full rotation history.

**LoginAttempt** *(not in 07 — added per [ADR-0011](../adr/0011-login-rate-limiting.md), login rate limiting)*
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| email | varchar | not null, indexed — stored lowercased, matches the login lookup key even when the email doesn't resolve to a `User` |
| client_ip | varchar | not null, indexed |
| succeeded | boolean | not null |
| attempted_at | timestamptz | not null, default now() |
| created_at | timestamptz | not null |

Composite index: `(email, client_ip, attempted_at)` — the throttle query is "count `succeeded = false` rows for this `(email, client_ip)` within the last 15 minutes." Rows are append-only (no update/delete API), consistent with `TestLog`'s immutability pattern; a scheduled cleanup of rows older than the throttle window is an operational concern, not a schema one.

### 3.3 `rbac.py` — Role, Permission, RolePermission, RoleAssignment

**Role**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| org_id | uuid | FK → organization.id, **nullable** (null = built-in system-role template) |
| name | varchar | not null |
| is_system_role | boolean | not null, default false |
| created_at, updated_at | timestamptz | not null |

**Generic CRUD factory posture** ([ADR-0022](../adr/0022-generic-crud-router-factory.md)): `org_id` is `Role`'s own direct scope column. When `org_id IS NULL` (a system-role template), `GET /roles/{id}` falls back to `has_permission_in_any_org` (readable — needed for role-assignment UI to list the catalog), but `PATCH`/`DELETE /roles/{id}` return `404` — a client can never mutate or delete a system-role template via this route. `POST /roles` always requires a non-null `org_id` in the body.

Partial unique index: `name` **WHERE `org_id IS NULL`** — prevents duplicate system-role templates (a plain `UNIQUE(org_id, name)` wouldn't catch this, since standard SQL treats `NULL <> NULL`, so two `(NULL, 'org_admin')` rows would not collide under a composite constraint). Org-scoped custom roles (`org_id` non-null) are unaffected by this index — nothing stops two different orgs each naming a custom role "QA Lead".

**System roles (seeded by an Alembic data migration, RBAC-4 — not created through the UI, not per-org runtime logic):** 5 rows, all `org_id = NULL`, `is_system_role = true`: `org_admin`, `test_manager`, `tester`, `auditor`, `ai_agent_scoped`. Being global templates (not org-scoped rows), they're available for `RoleAssignment` in every org — the per-org scoping happens on `RoleAssignment.org_id`, not on `Role.org_id`. Bundles (against the full `Permission` catalog below):

| Role | Bundle |
|---|---|
| `org_admin` | Every seeded `Permission` (superuser within its org) |
| `test_manager` | `test_plan.*` + `.approve`, `entry_exit_criteria.*`, `test_cycle.*`, `test_suite.*`, `release.create`/`.read`/`.update`, `environment.*`, `test_execution.create`/`.read`, `project.read`/`.update` (RBAC-3/[ADR-0021](../adr/0021-role-assignment-creation-flow.md) — closes a gap that made TC-RBAC-035's regression case unprovable: a project's own creator, auto-granted this Role project-scoped by PROJ-1, couldn't otherwise view or rename the project itself), `approval.create`/`.read`, `requirement.read`/`.export_rtm`, `defect.read`, `risk_item.*`, `test_case.read`, `test_step.read`, `test_condition.read` |
| `tester` | `test_case.*`, `test_step.*`, `test_condition.*`, `test_execution.*`, `test_log.read`, `defect.create`/`.read`/`.update`, `test_plan.read`, `test_suite.read`, `requirement.read` — no `approval.*`, no `test_plan.approve` |
| `auditor` | `.read` on all 29 resources + `requirement.export_rtm` — nothing else, no writes anywhere |
| `ai_agent_scoped` | `test_case.create`/`.read`/`.update`, `test_step.create`/`.read`/`.update`, `test_execution.create`/`.read`/`.update`, `test_log.read` — no delete, no `approval.*`, no `role`/`role_assignment`/`org_membership` anything, and per [ADR-0004](../adr/0004-rbac-design.md)/RBAC-5, `test_plan.approve` is never seeded into this bundle |

Downgrading the seed migration removes only the 5 `Role` rows (`RolePermission` rows cascade via the FK below); the `Permission` catalog rows are left in place.

`test_manager`'s `release.create`/`.read`/`.update` grants above were added by a second, later data migration (PROJ-2, [ADR-0019](../adr/0019-release-creation-flow.md)) — not part of RBAC-4's original seed. Same existence-checked-insert idempotency posture, but a reader auditing `test_manager`'s full permission set must know to check both migrations, not RBAC-4's alone.

`test_manager`'s `environment.*` (full CRUD — held none of the four before this migration) and `test_execution.create`/`.read` (not `.update`/`.delete`, deliberately withheld) grants above were added by a fourth such data migration (PLAN-3, [ADR-0033](../adr/0033-plan3-test-cycle-creation-and-execution-scope-check.md)), chained on the REQ-3 migration — same idempotent existence-checked-insert posture as the `release.*` and `test_condition.*`/`test_case.*` migrations before it. A reader auditing `test_manager`'s full permission set must now check four migrations, not RBAC-4's original seed alone.

**Permission** *(global catalog, no org scoping)*
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| code | varchar | not null, unique — `<resource>.<action>` (see [API Document](../api/2026-09-03-api-design.md) §Permission codes) |
| resource | varchar | not null |
| action | varchar | not null |
| created_at, updated_at | timestamptz | not null |

**Seeded catalog (RBAC-4, ~100 rows):** standard CRUD (`create`/`read`/`update`/`delete`) for 23 resources — `organization`, `org_membership`, `role`, `role_assignment`, `project`, `release`, `requirement`, `test_condition`, `test_case`, `test_step`, `test_suite`, `test_plan`, `entry_exit_criteria`, `test_cycle`, `environment`, `test_execution`, `defect`, `risk_item`, `attachment`, `test_design_technique`, `test_level`, `test_type`, `approval`; `read`-only for 6 resources — `permission`, `test_log`, `requirement_test_case_link`, `requirement_test_condition_link`, `test_condition_test_case_link`, `test_case_defect_link`; plus 2 special verbs — `test_plan.approve`, `requirement.export_rtm`. Seeded as an explicit, hand-authored resource list in the same Alembic data migration as the system roles (not generated from the model registry at runtime) — see [API Document](../api/2026-09-03-api-design.md) §1.

**RolePermission** *(junction)*
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| role_id | uuid | FK → role.id, not null, on delete cascade |
| permission_id | uuid | FK → permission.id, not null, on delete cascade |
| created_at | timestamptz | not null |

Unique: `(role_id, permission_id)`.

**RoleAssignment**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| actor_id | uuid | FK → actor.id, not null, indexed |
| org_id | uuid | FK → organization.id, not null, indexed |
| project_id | uuid | FK → project.id, **nullable** (null = org-wide role), **`ON DELETE CASCADE`** (was `RESTRICT` until [ADR-0040](../adr/0040-role-assignment-project-cascade-delete.md), migration `6a11a6a1d803`, 2026-09-07) |
| role_id | uuid | FK → role.id, not null |
| created_at, updated_at | timestamptz | not null |

Unique: `(actor_id, org_id, project_id, role_id)`, **plus a partial unique index `(actor_id, org_id, role_id) WHERE project_id IS NULL`** (RBAC-3 migration, added when this story's own duplicate-grant test exposed a real pre-existing gap — same `NULL <> NULL` reasoning as `Role.uq_role_name_system_role`: a plain composite `UNIQUE` including a nullable `project_id` column never catches two org-wide (`project_id = NULL`) rows for the same `actor_id`/`org_id`/`role_id`, since Postgres treats every `NULL` as distinct from every other `NULL`; the partial index is what actually enforces "no duplicate org-wide grant," the base composite constraint alone only ever covered the project-scoped case).

**Creation flow (RBAC-3, [ADR-0021](../adr/0021-role-assignment-creation-flow.md))** is application logic — `POST /orgs/{org_id}/role-assignments` inserts one row directly; the two constraints above are what turn a duplicate-grant attempt (org-wide or project-scoped) into `422` (caught `IntegrityError`) rather than a silent second row. `project_id NULL` (org-wide) vs. non-null (project-scoped) was already schema-supported since the initial migration — RBAC-3 is the first story to expose creating either shape through a real route, and the first to prove `has_permission`'s `project_id`-aware resolution branch against a real HTTP call (`GET`/`PATCH /projects/{id}`, fixed by the same story to pass `project_id` through — see ADR-0021).

**`project_id` FK `RESTRICT` → `CASCADE` ([ADR-0040](../adr/0040-role-assignment-project-cascade-delete.md), 2026-09-07):** originally `RESTRICT` from the initial schema migration, which meant `DELETE /projects/{id}` (ADR-0022) permanently `409`'d for every Project ever created through `POST /orgs/{org_id}/projects` — that route's own creator-grant (ADR-0017 step 5) was the row always blocking its own Project's deletion. Found during DASH-2's isolated-env verification, fixed same-day: a project-scoped `RoleAssignment` has no meaning once its own Project is gone, so cascading it away is correct semantics, not a workaround. Every other `project_id`-FK'd entity (`Release`/`Requirement`/`TestSuite`/etc.) is unaffected and keeps `RESTRICT`.

### 3.4 `actor.py` — Actor, User, AIAgent (joined-table inheritance)

**Actor** *(supertype)*
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| actor_type | enum(user, ai_agent) | not null |
| created_at, updated_at | timestamptz | not null |

**User**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| actor_id | uuid | FK → actor.id, not null, unique (1:1) |
| name | varchar | not null |
| email | varchar | not null, unique (deployment-wide) |
| password_hash | varchar | not null (argon2) |
| created_at, updated_at | timestamptz | not null |

**AIAgent** *(credential fields added beyond 07's draft, per AUTH-4)*
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| actor_id | uuid | FK → actor.id, not null, unique (1:1) |
| agent_name | varchar | not null |
| model_or_provider | varchar | nullable |
| mcp_session_ref | varchar | nullable |
| acting_on_behalf_of_user_id | uuid | FK → user.id, not null — accountability link, not an approver |
| key_hash | varchar | not null (argon2) |
| key_prefix | varchar(8) | not null, **indexed** — display hint AND the lookup-narrowing key: argon2 hashes aren't equality-lookupable, so `get_current_actor`'s agent branch selects candidates by `key_prefix` first, then argon2-verifies the full raw key against `key_hash` ([ADR-0015](../adr/0015-ai-agent-credential-mechanics.md)) |
| issued_at | timestamptz | not null |
| revoked_at | timestamptz | nullable |
| last_used_at | timestamptz | nullable — updated on every successful agent-bearer authentication; the `AuthIdentity.last_login_at`-equivalent for agent sessions ([ADR-0015](../adr/0015-ai-agent-credential-mechanics.md), AUTH-4 AC3) |
| created_at, updated_at | timestamptz | not null |

Raw key format on the wire: `tnx_agent_<key_prefix>_<secret>` — `key_prefix` is 8 URL-safe characters (matches the column above), `secret` is a `secrets.token_urlsafe(32)`-length random string. The literal `tnx_agent_` prefix lets the auth dependency branch on bearer-token shape before attempting a JWT decode.

> `Actor` is never queried alone in practice — the backend uses one shared "resolve actor to `User` or `AIAgent`" helper everywhere a `created_by`/`executed_by`/`reported_by` field is serialized, per [ADR-0002](../adr/0002-backend-framework-orm-migrations.md)'s consequence note.

> **Known drift (flagged, not fixed by this pass):** `app/models/actor.py` implements `User`/`AIAgent` as standard SQLAlchemy joined-table inheritance — `actor_id` is *both* the primary key and the FK to `actor.id`, there is no separate `id` column on `user`/`ai_agent`. This document's tables above (and every FK listed elsewhere in this document as `FK → user.id`, e.g. `OrgMembership.user_id`, `AuthIdentity.user_id`, `RefreshToken.user_id`, `Approval.approved_by_user_id`, `AIAgent.acting_on_behalf_of_user_id`) predates that implementation choice and still shows the literal association-table shape (`id` + separate `actor_id`). In the real schema, read every `FK → user.id` in this document as `FK → user.actor_id`. Reconciling this document's column listings to match is out of scope for the AUTH-1 documentation pass — tracked here so it isn't lost, not silently left inconsistent.

### 3.5 `project.py` — Project, Release

**Project**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| org_id | uuid | FK → organization.id, not null, indexed — tenant isolation root |
| name | varchar | not null |
| standards_profile | varchar | nullable |
| created_at, updated_at | timestamptz | not null |

Unique: `(org_id, name)`.

**Creation flow** (PROJ-1, [ADR-0017](../adr/0017-project-creation-flow.md)): `POST /orgs/{org_id}/projects` — bespoke, org-path-scoped (reuses `require_permission` and the established any-status-`OrgMembership` 404-vs-403 check as-is, same shape as `agents.py`/`organizations.py`). `standards_profile`, if omitted from the request, inherits `Organization.default_standards_profile` at creation time (a one-time copy, not a live reference — later changes to the org's default do not retroactively change an existing Project's value); an explicit value (including explicit `null`) in the request always overrides. Creating the row also inserts one project-scoped `RoleAssignment` (`org_id` = the Project's org, `project_id` = the new Project, `role_id` = the seeded `test_manager` `Role`) for the creator, unconditionally — not derived from the creator's org-level role, since only `org_admin`'s seeded bundle currently reaches `project.create` at all. `GET`/`PATCH /projects/{id}` resolve `org_id` from the fetched row itself (no `org_id` path segment), anticipating the eventual generic CRUD factory's item-route shape.

**DASH-2** ([ADR-0039](../adr/0039-dash-2-org-home-dashboard-relabel-and-project-table.md)) — reviewed, no schema impact of its own. The `OrgHome`→"Dashboard" relabel is frontend-only (heading/sidebar/breadcrumb text). The Project table's new Edit modal reuses `PATCH /projects/{id}` unchanged; Delete wires the already-shipped `DELETE /projects/{id}` (ADR-0022's factory, `_PROJECT_FACTORY_CONFIG`) to a UI action for the first time — no route/schema change, no new column. Search/sort/pagination are client-side over the existing `GET /projects?org_id=` response — no new query parameter. **DASH-2's own verification of that Delete wiring is what found the `role_assignment.project_id` `RESTRICT` defect — the actual schema fix is [ADR-0040](../adr/0040-role-assignment-project-cascade-delete.md)'s own separate FK change, documented above under §3.3's `RoleAssignment` entry, not this section.**

**DS-2** ([ADR-0041](../adr/0041-ds-2-table-container-shared-pagination.md)) — reviewed, no schema impact. The shared `Table` container, the `page_size` ceiling change (25→100), and adding pagination to `GET /orgs/{org_id}/role-assignments` are all API/frontend-layer changes — no new column, no new table, no FK/constraint change. `role_assignment`'s columns (including `project_id`'s `ON DELETE CASCADE`, [ADR-0040](../adr/0040-role-assignment-project-cascade-delete.md) above) are unaffected; the route's response envelope changes shape, not the underlying query's `WHERE`/join.

**DS-3** ([ADR-0045](../adr/0045-ds-3-infobox-widget-consolidation.md)) — reviewed, no schema impact. A frontend-only markup swap (new `InfoBox` component, retires `WidgetStatsTile`/`StatTile`) over data both retired components already sourced from existing routes' `total` fields — no new column, table, FK, or query shape.

**Release**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| project_id | uuid | FK → project.id, not null, indexed |
| version_label | varchar | not null |
| target_date | date | nullable |
| created_at, updated_at | timestamptz | not null |

No uniqueness constraint on `version_label` — AC doesn't require it, and unlike `Project.name` (unique per org), two Releases in the same Project may share a `version_label` (e.g. a re-cut build under the same version).

**Creation flow** (PROJ-2, [ADR-0019](../adr/0019-release-creation-flow.md)): `POST /projects/{project_id}/releases` — bespoke, project-path-scoped. No `org_id` path segment exists at this depth, so unlike `POST /orgs/{org_id}/projects` this route fetches the `Project` row first to resolve `org_id` for the 404-vs-403 boundary, then calls `has_permission` directly (`release.create`) — same posture as `GET`/`PATCH /projects/{id}`, one level down. `GET /projects/{project_id}/releases` (list) sorts by `target_date`, `NULLS LAST` pinned explicitly for both `asc`/`desc` (NFR-25) — not the query engine's untouched per-direction default. `GET /releases/{id}` and `GET /releases/{id}/test-cycles` are row-resolved (no path `project_id`), same one-level-deeper extension of `Project`'s own row-resolved read pattern.

`GET /releases/{id}/test-cycles` (AC2's query — "what was tested for release X") returns every `TestCycle` with `release_id` matching the path `id`, each with its `TestExecution` rows nested in the response (not a cycles-only list) — proven queryable via `TestCycle.release_id`/`TestExecution.test_cycle_id`, both already non-nullable FKs. `TestCycle` itself has no create route in this codebase (FR-PLAN-3's scope); this query works against however a `TestCycle` row came to exist. The route requires all three of `release.read`, `test_cycle.read`, `test_execution.read` (NFR-26) — the one route in this scaffold exposing `TestExecution` data without a `test_cycle_id` in the request path, so a single-permission gate would let a Release-only viewer see execution data outside their own granted permissions.

**PLAN-2 extension** ([ADR-0032](../adr/0032-plan2-entry-exit-criteria-visibility.md), NFR-42): each nested `TestCycle` in this same response also carries `exit_criteria` — every `EntryExitCriteria` row of `type = exit` belonging to that cycle's parent `TestPlan` (`TestCycle.test_plan_id`), `[]` when none exist, never omitted. Resolved by one additional query batched across the result set's distinct `test_plan_id`s, not once per cycle. The route's permission gate extends from the triple above to a quadruple: **AND `entry_exit_criteria.read`**.

### 3.6 `assets.py` — Requirement, TestCondition, TestCase, TestStep, TestSuite (+ junction)

**Requirement**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| project_id | uuid | FK → project.id, not null, indexed |
| title | varchar | not null — [ADR-0025](../adr/0025-requirement-title-field.md), added 2026-09-05 (gap-fill; FR-REQ-1/TC-REQ-001 always specified this field) |
| external_ref | varchar | nullable |
| description | text | not null |
| source | varchar | nullable |
| created_at, updated_at | timestamptz | not null |

**TestCondition**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| requirement_id | uuid | FK → requirement.id, not null, indexed |
| description | text | not null |
| priority | enum(low, medium, high) | not null |
| created_at, updated_at | timestamptz | not null |

**Generic CRUD factory posture on `TestCondition`** ([ADR-0028](../adr/0028-req3-test-condition-rigor-path-bespoke-routes.md)): no `POST /test-conditions` via the factory — the route existed briefly under ADR-0022 but only ever wrote the `TestCondition` row, never the `RequirementTestConditionLink` row FR-REQ-3's own AC1 requires, so it's removed rather than left as a second, link-less creation path. Creation stays bespoke: `POST /requirements/{id}/test-conditions` (API Document §4) creates both rows atomically. `GET`/`PATCH`/`DELETE /test-conditions/{id}` are unaffected — same resolver (`requirement_id` → `Requirement.project_id` → `Project.org_id`) as before.

**TestCase**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| test_condition_id | uuid | FK → test_condition.id, **nullable** — [ADR-0006](../adr/0006-test-condition-optional.md) |
| test_level_id | uuid | FK → test_level.id, not null |
| test_type_id | uuid | FK → test_type.id, not null |
| created_by_actor_id | uuid | FK → actor.id, not null |
| title | varchar | not null |
| preconditions | text | nullable |
| expected_result | text | nullable |
| status | enum(draft, reviewed, approved, deprecated) | not null, default draft |
| created_at, updated_at | timestamptz | not null |

**TestStep**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| test_case_id | uuid | FK → test_case.id, not null, indexed, on delete cascade |
| sequence | integer | not null |
| action | text | not null |
| expected_result | text | nullable |
| created_at, updated_at | timestamptz | not null |

Unique: `(test_case_id, sequence)`.

**Generic CRUD factory posture on `TestCase`** ([ADR-0022](../adr/0022-generic-crud-router-factory.md)): no `POST /test-cases` via the factory — creation is bespoke instead (API Document §4, atomic create+link): `POST /requirements/{id}/test-cases` (direct-link path, FR-REQ-2) and `POST /test-conditions/{id}/test-cases` (test-condition-mediated path, FR-REQ-3, [ADR-0028](../adr/0028-req3-test-condition-rigor-path-bespoke-routes.md)) are both built, coexisting per-TestCase within a project (ADR-0006). `GET`/`PATCH`/`DELETE /test-cases/{id}` resolve `org_id` by walking `test_condition_id` → `TestCondition.requirement_id` → `Requirement.project_id` when set; if `test_condition_id IS NULL` (ADR-0006), the resolver falls back first to any linked `RequirementTestCaseLink` → `Requirement.project_id` (REQ-2's direct-link path — first-class, not an edge case, so it's checked before the suite fallback, [ADR-0029](../adr/0029-testcase-resolver-direct-link-fallback.md) gap-fill), then to any linked `TestSuiteTestCase` → `TestSuite.project_id`; a row satisfying none of the three (orphaned — schema-legal, but no create path in this codebase produces it) resolves to `404`, same as a genuinely missing row. `TestStep`/`Attachment` (both scoped by `test_case_id`) delegate to this same resolver.

**TestSuite**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| project_id | uuid | FK → project.id, not null, indexed |
| name | varchar | not null |
| purpose | varchar | nullable (e.g. regression/smoke/acceptance) |
| created_at, updated_at | timestamptz | not null |

**TestSuiteTestCase** *(junction, many-to-many)*
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| test_suite_id | uuid | FK → test_suite.id, not null, on delete cascade |
| test_case_id | uuid | FK → test_case.id, not null, on delete cascade |
| created_at | timestamptz | not null |

Unique: `(test_suite_id, test_case_id)`.

**Generic CRUD factory posture on `TestSuiteTestCase`** ([ADR-0030](../adr/0030-req4-test-suite-membership-bespoke-routes.md)): no route via the factory at all, generic or otherwise — `POST`/`DELETE /test-suites/{id}/test-cases/{case_id}` (join row add/remove) plus a new `GET /test-suites/{id}/test-cases` (live membership list, `TestCaseSummary[]`, not raw join rows) are bespoke, `app/api/routes/test_suite_membership.py`. `org_id` resolution reuses `_TEST_SUITE_CONFIG`'s existing `chain_resolver([])` for the `TestSuite` side and `resolve_test_case_org_id` ([ADR-0029](../adr/0029-testcase-resolver-direct-link-fallback.md)) verbatim for the `TestCase` side — no new resolver. Add rejects (`422`) when the `TestCase`'s own resolved `project_id` differs from the `TestSuite`'s `project_id` (same org, different project — a data-modeling rejection, not a tenant boundary); the unique constraint above surfaces as `409 already_in_suite` on a duplicate add, not `422`. `TestSuite`'s own name/purpose CRUD is unaffected — still full generic CRUD via `_TEST_SUITE_CONFIG`, this ADR only adds membership routes on top.

### 3.7 `planning.py` — TestPlan, EntryExitCriteria, TestCycle, Environment (+ junction)

**TestPlan**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| project_id | uuid | FK → project.id, not null, indexed |
| created_by_actor_id | uuid | FK → actor.id, not null |
| identifier | varchar | not null — IEEE 829/29119-3 Test Plan Identifier |
| scope | text | nullable |
| approach | text | nullable |
| staffing_and_training | text | nullable |
| schedule | text | nullable |
| status | enum(draft, approved, superseded) | not null, default draft |
| created_at, updated_at | timestamptz | not null |

**TestPlanTestSuite** *(junction, many-to-many)*
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| test_plan_id | uuid | FK → test_plan.id, not null, on delete cascade |
| test_suite_id | uuid | FK → test_suite.id, not null, on delete cascade |
| created_at | timestamptz | not null |

Unique: `(test_plan_id, test_suite_id)`.

**Generic CRUD factory posture on `TestPlanTestSuite`** ([ADR-0031](../adr/0031-plan1-test-plan-membership-and-status-transition-routes.md)): no route via the factory at all, generic or otherwise — same posture ADR-0030 established for `TestSuiteTestCase`. `POST`/`DELETE /test-plans/{id}/test-suites/{suite_id}` (join row add/remove) plus a live `GET /test-plans/{id}/test-suites` and a new coverage query `GET /test-plans/{id}/test-cases` (resolves the two-hop `TestPlan`→`TestSuite`→`TestCase` chain across every included suite, deduplicated) are bespoke, `app/api/routes/test_plan_membership.py`. `org_id` resolution reuses `_TEST_PLAN_CONFIG`'s and `_TEST_SUITE_CONFIG`'s existing `chain_resolver([])` for each side — no new resolver, simpler than `TestSuiteTestCase`'s own since both `TestPlan.project_id` and `TestSuite.project_id` are direct columns (no branching chain to walk). Include rejects (`422`) when `TestSuite.project_id` differs from `TestPlan.project_id` (same org, different project); the unique constraint above surfaces as `409 already_included_in_plan` on a duplicate include, not `422` — a fourth, distinct `409` meaning alongside `already_in_suite`.

**`TestPlan.status`-transition guard** ([ADR-0031](../adr/0031-plan1-test-plan-membership-and-status-transition-routes.md)): the generic factory's own `PATCH /test-plans/{id}` gains an application-layer legality check on the `status` column specifically — no schema change (still a plain `SAEnum`, no Postgres-level transition constraint) — rejecting (`409 invalid_status_transition`) any requested `status` value other than `draft→approved` or `approved→superseded`, including same-state writes and any backward/skip-ahead transition. This governs transition *legality* only; it is not a substitute for GOV-1's own separate, human-only `/approve` route (not yet built) — see ADR-0031's Consequences for the accepted interim gap.

**EntryExitCriteria**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| test_plan_id | uuid | FK → test_plan.id, not null, indexed, on delete cascade |
| type | enum(entry, exit, suspension, resumption) | not null |
| condition_text | text | not null |
| created_at, updated_at | timestamptz | not null |

**Generic CRUD factory posture on `EntryExitCriteria`** — unlike every other PLAN-* gap, this entity needed **zero new backend route code**: full CRUD (`POST`/`GET`/`PATCH`/`DELETE /entry-exit-criteria`) was already factory-served via `_ENTRY_EXIT_CRITERIA_CONFIG`'s one-hop `chain_resolver([(TestPlan, "test_plan_id")])` since ADMIN-2 — no resolver gap of the ADR-0029/ADR-0030 class. PLAN-2 ([ADR-0032](../adr/0032-plan2-entry-exit-criteria-visibility.md)) is a visibility-surface story only: `TestPlanDetail.tsx` gains a full-CRUD (add/edit/delete) section reusing this same config filtered by `?test_plan_id=`, and `type = exit` rows are additionally nested onto `GET /releases/{id}/test-cycles` (§3.5's PLAN-2 extension note above) — no schema change either way.

**Environment** — *scoped to `project_id` (refinement beyond 07's unscoped draft, required for tenant isolation per NFR-1)*
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| project_id | uuid | FK → project.id, not null, indexed |
| name | varchar | not null |
| config_notes | text | nullable |
| created_at, updated_at | timestamptz | not null |

**Generic CRUD factory posture on `Environment`** — unaffected by [ADR-0033](../adr/0033-plan3-test-cycle-creation-and-execution-scope-check.md): full CRUD was already factory-served since ADMIN-2, no schema/route change. What PLAN-3 closes is the pre-existing RBAC gap (`test_manager` held none of `environment.*` before this story's migration, above) and adds a frontend inline-create flow (sequential `POST /environments` then `POST /test-plans/{id}/test-cycles`, no new backend route) — see the [PLAN-3 UI Design Document](../ui-design/2026-09-06-plan-3-test-cycle-creation-ui-design.md).

**TestCycle**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| test_plan_id | uuid | FK → test_plan.id, not null, indexed |
| release_id | uuid | FK → release.id, not null |
| environment_id | uuid | FK → environment.id, not null |
| name | varchar | not null |
| start_date | date | nullable |
| end_date | date | nullable |
| created_at, updated_at | timestamptz | not null |

**Generic CRUD factory posture on `TestCycle`** ([ADR-0033](../adr/0033-plan3-test-cycle-creation-and-execution-scope-check.md)): `create` stays excluded from the factory (`GET`/`PATCH`/`DELETE` only, unchanged from ADMIN-2) — `POST /test-plans/{id}/test-cycles` is bespoke, `app/api/routes/test_cycle_creation.py`, gated `test_cycle.create`. `org_id` resolution reuses `_TEST_CYCLE_CONFIG`'s existing `chain_resolver([(TestPlan, "test_plan_id")])` for the path `TestPlan` side — no new resolver, and no resolver-completeness risk (the row this route writes carries exactly the `test_plan_id` FK that resolver already walks). `release_id`/`environment_id` are each independently checked against the target `TestPlan`'s own `project_id`: missing, or resolving to a different org, → `404` (no target-org existence to leak); resolving to the same org but a different project → `422 validation_error` (same cross-project posture NFR-38/NFR-41 already established for `TestSuiteTestCase`/`TestPlanTestSuite`, applied here even though schema alone doesn't enforce it). No unique constraint on `(test_plan_id, name)` — duplicate cycle names within one plan are allowed, same non-uniqueness stance already taken for `Release.version_label` (§3.5).

### 3.8 `execution.py` — TestExecution, TestLog, Defect

**TestExecution**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| test_cycle_id | uuid | FK → test_cycle.id, not null, indexed |
| test_case_id | uuid | FK → test_case.id, not null, indexed |
| executed_by_actor_id | uuid | FK → actor.id, not null |
| result | enum(pass, fail, blocked, skipped) | not null |
| actual_result | text | nullable |
| executed_at | timestamptz | not null |
| created_at, updated_at | timestamptz | not null |

Composite index: `(test_cycle_id, test_case_id)` — dashboard aggregation (EXEC-1) and execution-scope-check (PLAN-3) both filter on this pair.

**Generic CRUD factory posture on `TestExecution`** ([ADR-0033](../adr/0033-plan3-test-cycle-creation-and-execution-scope-check.md)): `create` is removed from `_TEST_EXECUTION_CONFIG` (`GET`/`PATCH`/`DELETE` only from here on, same posture `TestCase`/`TestCondition`/`Defect` already have) — the unrestricted generic `POST /test-executions` had no way to enforce FR-PLAN-3 AC3's scope rule, so leaving it reachable alongside the new bespoke route would let a caller bypass the check entirely. `POST /test-cycles/{id}/executions` is bespoke, `app/api/routes/execution_authoring.py`, gated `test_execution.create`: resolves `test_case_id` via `TestCase`'s existing 3-branch resolver ([ADR-0029](../adr/0029-testcase-resolver-direct-link-fallback.md)), then runs an `EXISTS` check against the same `TestPlan`→`TestSuite`→`TestCase` join `GET /test-plans/{id}/test-cases` ([ADR-0031](../adr/0031-plan1-test-plan-membership-and-status-transition-routes.md)) already resolves, scoped to the path `TestCycle`'s own `test_plan_id` — not a member of any suite included in that plan → `422 validation_error`. `executed_by_actor_id` is stamped from the authenticated actor, never client-supplied, same posture the existing generic schema's docstring already established for this field.

**EXEC-1 ([ADR-0034](../adr/0034-exec-1-test-execution-recording-dashboard.md)) introduces no schema change to this table or any other.** The `(test_cycle_id, test_case_id)` composite index above already anticipated the dashboard's own filtering shape; the dashboard itself (FR-EXEC-1 AC2) is answered by four `result`-filtered calls to the existing generic list route reading only its `total` field, not a new aggregate query or a denormalized summary column. AC3's "re-run creates a new row, not an overwrite" needed no schema enforcement either — `TestExecution` has no unique constraint on `(test_cycle_id, test_case_id)` (deliberately: re-execution is the expected, supported case, not a conflict), so the same plain `INSERT` the bespoke create route already performs is sufficient.

**TestLog** — *append-only, no `updated_at`, no update/delete API path (list/get only, [ADR-0027](../adr/0027-generic-admin-crud-ui-and-backend-completion.md))*
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| test_execution_id | uuid | FK → test_execution.id, not null, indexed |
| logged_at | timestamptz | not null, default now() |
| event_type | enum(status_change, comment, attachment, agent_action) | not null |
| payload | jsonb | not null |
| created_at | timestamptz | not null |

Index: `(test_execution_id, logged_at)` — ordered timeline reads (EXEC-2).

**EXEC-2 ([ADR-0038](../adr/0038-exec-2-append-only-test-log.md)) introduces no schema change to this table.** The `(test_execution_id, logged_at)` index above already anticipated the ordered-timeline read this story adds (`GET /executions/{id}/logs`); the write side (`POST /test-cycles/{id}/executions`, `PATCH /test-executions/{id}`, and the new `POST /executions/{id}/comments`) is a plain `INSERT` into columns already specified above, no new column/index/constraint. One real, previously-untested consequence of `test_execution_id`'s existing `ON DELETE RESTRICT`, worth stating explicitly now that rows are actually being written: once any `TestLog` row references a `TestExecution`, that `TestExecution` can no longer be deleted through the still-registered generic `DELETE /test-executions/{id}` route — `409 restrict_blocked`, not `204`. This is the correct behavior for an append-only audit log (the schema-level immutability note above is only meaningful if the parent row can't be deleted out from under it), not a regression to fix.

**Defect**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| test_execution_id | uuid | FK → test_execution.id, not null, indexed |
| reported_by_actor_id | uuid | FK → actor.id, not null |
| external_ref | varchar | nullable |
| severity | enum(low, medium, high, critical) | not null |
| status | varchar | not null, default `open` |
| created_at, updated_at | timestamptz | not null |

**EXEC-3 ([ADR-0044](../adr/0044-exec-3-raise-defect-from-execution.md)) introduces no schema change to this table or `trace.py`'s `TestCaseDefectLink` (§3.9).** Every column above already existed since ADR-0027; this story is the first to actually write a `Defect`+`TestCaseDefectLink` pair, via the new bespoke `POST /executions/{id}/defects` (`test_execution_id` and `reported_by_actor_id` populated exactly as this table already specifies, `test_case_id` for the link row derived from the target `TestExecution`'s own `test_case_id`, not client-supplied). `status` stays the plain `varchar` it always was — `Defect`'s own `create` never needed a new controlled vocabulary, only a request schema exposing what the column already allows. The new read side, `GET /test-cases/{id}/defects`, is a plain `SELECT ... ORDER BY defect.created_at DESC` join against the two tables above — no new index required at scaffold scale (`TestCaseDefectLink.test_case_id` is already indexed, §3.9).

### 3.9 `trace.py` — the 4 dedicated link tables ([ADR-0005](../adr/0005-traceability-link-dedicated-join-tables.md))

All four share the same shape: surrogate `uuid` PK, two FK columns, unique constraint on the pair, `created_at` only (links are immutable — delete-and-recreate, never edited). List/get routes only ([ADR-0027](../adr/0027-generic-admin-crud-ui-and-backend-completion.md)) — a row is still only ever written as a side effect of the bespoke routes in API Document §4, never via a direct `POST`/`PATCH`/`DELETE` on the link table itself. `RequirementTestConditionLink` and `TestConditionTestCaseLink` rows are populated this way by [ADR-0028](../adr/0028-req3-test-condition-rigor-path-bespoke-routes.md)'s two REQ-3 routes; `RequirementTestCaseLink` rows are populated this way by REQ-2's direct-link `POST /requirements/{id}/test-cases` route ([ADR-0029](../adr/0029-testcase-resolver-direct-link-fallback.md)); `TestCaseDefectLink` rows are populated this way by EXEC-3's `POST /executions/{id}/defects` route ([ADR-0044](../adr/0044-exec-3-raise-defect-from-execution.md)) — the last of the four link tables to actually have a row written to it.

| Table | FK 1 | FK 2 |
|---|---|---|
| RequirementTestCaseLink | requirement_id → requirement.id | test_case_id → test_case.id |
| RequirementTestConditionLink | requirement_id → requirement.id | test_condition_id → test_condition.id |
| TestConditionTestCaseLink | test_condition_id → test_condition.id | test_case_id → test_case.id |
| TestCaseDefectLink | test_case_id → test_case.id | defect_id → defect.id |

Each FK: not null, indexed, `on delete cascade`. Unique constraint on `(fk_1, fk_2)` per table.

### 3.10 `taxonomy.py` — TestDesignTechnique, TestLevel, TestType (+ junction)

**TestDesignTechnique**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| name | varchar | not null, unique |
| istqb_chapter_ref | varchar | nullable |
| created_at, updated_at | timestamptz | not null |

**TestLevel**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| name | varchar | not null, unique |
| created_at, updated_at | timestamptz | not null |

**TestType**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| name | varchar | not null, unique |
| created_at, updated_at | timestamptz | not null |

**TestCaseTestDesignTechnique** *(junction, many-to-many, ADMIN-1)*
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| test_case_id | uuid | FK → test_case.id, not null, on delete cascade |
| test_design_technique_id | uuid | FK → test_design_technique.id, not null, on delete cascade |
| created_at | timestamptz | not null |

Unique: `(test_case_id, test_design_technique_id)`.

### 3.11 `governance.py` — Approval, RiskItem, Attachment

**Approval** — *`approved_by_user_id` FKs `user.id` directly, never `actor.id`, structurally enforcing human-only per [ADR-0004](../adr/0004-rbac-design.md)*
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| test_plan_id | uuid | FK → test_plan.id, not null, indexed |
| approved_by_user_id | uuid | FK → user.id, not null |
| approved_at | timestamptz | not null |
| role | varchar | not null — descriptive note, "policy: human User only, never AIAgent" |
| created_at | timestamptz | not null |

**RiskItem**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| requirement_id | uuid | FK → requirement.id, nullable |
| test_plan_id | uuid | FK → test_plan.id, nullable |
| description | text | not null |
| likelihood | enum(low, medium, high) | not null |
| impact | enum(low, medium, high) | not null |
| mitigation | text | nullable |
| created_at, updated_at | timestamptz | not null |

Check constraint: `requirement_id IS NOT NULL OR test_plan_id IS NOT NULL` — `OR`, not `XOR`; both non-null is schema-legal. **Generic CRUD factory posture** ([ADR-0022](../adr/0022-generic-crud-router-factory.md)): `POST /risk-items` rejects both-set at the Pydantic validation layer (`422`) — exactly one, never both, since a resolver has no defined precedence rule between them. `resolve_org_id` branches on whichever one is non-null, one hop to `Requirement.project_id` or `TestPlan.project_id`.

**Attachment**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| test_case_id | uuid | FK → test_case.id, not null, indexed |
| url_or_path | varchar | not null |
| mime_type | varchar | not null |
| size_bytes | bigint | not null |
| created_at, updated_at | timestamptz | not null |

Storage backend (local filesystem vs. S3-compatible) is an application-config concern (`ATTACHMENT_STORAGE` env var), not a schema concern — `url_or_path` is opaque to the DB either way. **Generic CRUD factory posture** ([ADR-0022](../adr/0022-generic-crud-router-factory.md)): `POST /attachments` via the factory is metadata-only — the request body supplies `url_or_path`/`mime_type`/`size_bytes` directly, already-uploaded; the factory adds no multipart file-upload handling, that mechanic is GOV-3's own separate, not-yet-built concern.

## 4. Indexing summary

- Every FK column is indexed (listed inline per table above; omitted only where a table has ≤1 FK and it's already covered by a unique constraint).
- Every table with a direct `org_id` or `project_id` column has that column indexed — the primary lever for NFR-1 tenant-isolation query performance.
- Composite indexes called out explicitly: `TestExecution(test_cycle_id, test_case_id)`, `TestLog(test_execution_id, logged_at)`.
- The 4 link tables in §3.9 are each indexed on both FK columns individually (supports lookup from either direction for RTM traversal, FR-TRACE-1).
- `RefreshToken.token_hash` has a unique index (ADR-0013) — the refresh route's lookup key, a hot path once sessions persist across restarts.
- `AIAgent.key_prefix` is indexed ([ADR-0015](../adr/0015-ai-agent-credential-mechanics.md)) — narrows the agent-bearer lookup to a candidate row before the argon2 verify; not unique (astronomically-unlikely prefix collision is handled by verifying each candidate, not assumed away).

## 5. Deviations from the 07 ERD draft (for the record)

| 07 draft | This schema | Why |
|---|---|---|
| `TraceabilityLink` (1 polymorphic table) | 4 dedicated link tables | ADR-0005 |
| No `RefreshToken` table | Added | ADR-0003 (revocable sessions) |
| `TestCase.test_condition_id` implied required | Nullable | ADR-0006 |
| `Environment` unscoped | `project_id` FK added, not null | NFR-1 tenant isolation |
| Integer/unspecified PK style | UUIDv7 everywhere | ADR-0008 |
| No `AIAgent` credential fields | `key_hash`/`key_prefix`/`issued_at`/`revoked_at` added | AUTH-4 |
| `}o--o{` many-to-many drawn without table names | `TestSuiteTestCase`, `TestPlanTestSuite`, `TestCaseTestDesignTechnique` named explicitly | Implementation necessity |
| No `LoginAttempt` table | Added | ADR-0011 (login rate limiting) |
| `RefreshToken.token_hash` unspecified index | Unique index added | ADR-0013 (refresh rotation makes it a lookup key, not just a write target) |
| No `AIAgent.last_used_at` column | Added, nullable, updated per successful agent auth | ADR-0015 (AUTH-4 AC3, `AuthIdentity.last_login_at`-equivalent) |
| `AIAgent.key_prefix` unspecified index | Indexed (non-unique) | ADR-0015 (lookup-narrowing key for argon2 verify, not just a display hint) |
