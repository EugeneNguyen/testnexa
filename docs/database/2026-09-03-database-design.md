# Database Document — Project Scaffold

**Date:** 2026-09-03
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [07 ERD](../product-discovery/07-erd-draft.md), [Scaffold design spec](../superpowers/specs/2026-09-03-project-scaffold-design.md), [ADR-0005](../adr/0005-traceability-link-dedicated-join-tables.md), [ADR-0006](../adr/0006-test-condition-optional.md), [ADR-0007](../adr/0007-real-multi-tenancy.md), [ADR-0008](../adr/0008-uuid-primary-keys.md), [ADR-0011](../adr/0011-login-rate-limiting.md), [ADR-0013](../adr/0013-refresh-token-rotation-policy.md), [ADR-0015](../adr/0015-ai-agent-credential-mechanics.md), [ADR-0016](../adr/0016-organization-bootstrap-creation-flow.md)

This document is the implementation-level schema, refined from the [07 ERD](../product-discovery/07-erd-draft.md) draft per the ADRs above. No code — this is the reference for the Alembic migration that will be written when implementation is authorized.

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

Partial unique index: `name` **WHERE `org_id IS NULL`** — prevents duplicate system-role templates (a plain `UNIQUE(org_id, name)` wouldn't catch this, since standard SQL treats `NULL <> NULL`, so two `(NULL, 'org_admin')` rows would not collide under a composite constraint). Org-scoped custom roles (`org_id` non-null) are unaffected by this index — nothing stops two different orgs each naming a custom role "QA Lead".

**System roles (seeded by an Alembic data migration, RBAC-4 — not created through the UI, not per-org runtime logic):** 5 rows, all `org_id = NULL`, `is_system_role = true`: `org_admin`, `test_manager`, `tester`, `auditor`, `ai_agent_scoped`. Being global templates (not org-scoped rows), they're available for `RoleAssignment` in every org — the per-org scoping happens on `RoleAssignment.org_id`, not on `Role.org_id`. Bundles (against the full `Permission` catalog below):

| Role | Bundle |
|---|---|
| `org_admin` | Every seeded `Permission` (superuser within its org) |
| `test_manager` | `test_plan.*` + `.approve`, `entry_exit_criteria.*`, `test_cycle.*`, `test_suite.*`, `approval.create`/`.read`, `requirement.read`/`.export_rtm`, `defect.read`, `risk_item.*`, `test_case.read`, `test_step.read`, `test_condition.read` |
| `tester` | `test_case.*`, `test_step.*`, `test_condition.*`, `test_execution.*`, `test_log.read`, `defect.create`/`.read`/`.update`, `test_plan.read`, `test_suite.read`, `requirement.read` — no `approval.*`, no `test_plan.approve` |
| `auditor` | `.read` on all 29 resources + `requirement.export_rtm` — nothing else, no writes anywhere |
| `ai_agent_scoped` | `test_case.create`/`.read`/`.update`, `test_step.create`/`.read`/`.update`, `test_execution.create`/`.read`/`.update`, `test_log.read` — no delete, no `approval.*`, no `role`/`role_assignment`/`org_membership` anything, and per [ADR-0004](../adr/0004-rbac-design.md)/RBAC-5, `test_plan.approve` is never seeded into this bundle |

Downgrading the seed migration removes only the 5 `Role` rows (`RolePermission` rows cascade via the FK below); the `Permission` catalog rows are left in place.

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
| project_id | uuid | FK → project.id, **nullable** (null = org-wide role) |
| role_id | uuid | FK → role.id, not null |
| created_at, updated_at | timestamptz | not null |

Unique: `(actor_id, org_id, project_id, role_id)`.

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

**Release**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| project_id | uuid | FK → project.id, not null, indexed |
| version_label | varchar | not null |
| target_date | date | nullable |
| created_at, updated_at | timestamptz | not null |

### 3.6 `assets.py` — Requirement, TestCondition, TestCase, TestStep, TestSuite (+ junction)

**Requirement**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| project_id | uuid | FK → project.id, not null, indexed |
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

**EntryExitCriteria**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| test_plan_id | uuid | FK → test_plan.id, not null, indexed, on delete cascade |
| type | enum(entry, exit, suspension, resumption) | not null |
| condition_text | text | not null |
| created_at, updated_at | timestamptz | not null |

**Environment** — *scoped to `project_id` (refinement beyond 07's unscoped draft, required for tenant isolation per NFR-1)*
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| project_id | uuid | FK → project.id, not null, indexed |
| name | varchar | not null |
| config_notes | text | nullable |
| created_at, updated_at | timestamptz | not null |

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

**TestLog** — *append-only, no `updated_at`, no update/delete API path*
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| test_execution_id | uuid | FK → test_execution.id, not null, indexed |
| logged_at | timestamptz | not null, default now() |
| event_type | enum(status_change, comment, attachment, agent_action) | not null |
| payload | jsonb | not null |
| created_at | timestamptz | not null |

Index: `(test_execution_id, logged_at)` — ordered timeline reads (EXEC-2).

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

### 3.9 `trace.py` — the 4 dedicated link tables ([ADR-0005](../adr/0005-traceability-link-dedicated-join-tables.md))

All four share the same shape: surrogate `uuid` PK, two FK columns, unique constraint on the pair, `created_at` only (links are immutable — delete-and-recreate, never edited).

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

Check constraint: `requirement_id IS NOT NULL OR test_plan_id IS NOT NULL`.

**Attachment**
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| test_case_id | uuid | FK → test_case.id, not null, indexed |
| url_or_path | varchar | not null |
| mime_type | varchar | not null |
| size_bytes | bigint | not null |
| created_at, updated_at | timestamptz | not null |

Storage backend (local filesystem vs. S3-compatible) is an application-config concern (`ATTACHMENT_STORAGE` env var), not a schema concern — `url_or_path` is opaque to the DB either way.

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
