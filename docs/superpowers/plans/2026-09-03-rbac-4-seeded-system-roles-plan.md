# RBAC-4: Seeded System Roles — Plan

**Date:** 2026-09-03
**Story:** [RBAC-4](../../user-stories/2026-09-03-rbac-tenancy-stories.md#story-rbac-4-seeded-system-roles)
**Related:** ADR-0004 (RBAC design), [Database Doc §3.3](../../database/2026-09-03-database-design.md)

## Decisions (confirmed with user)

- **Q1:** `org_admin` = full permission catalog (superuser within org), not a narrow org/billing/membership-only bundle.
- **Q2:** Seed the full `Permission` catalog now (mechanical loop over an explicit resource list × standard actions), not just the codes the 4 non-admin bundles touch.
- **Q3:** `test_manager`/`tester`/`auditor`/`ai_agent_scoped` bundles per the recommended domain split below.
- **Q4:** Idempotency via a partial unique index (`role.name` WHERE `org_id IS NULL`) + existence-check inserts in the migration, not fixed UUIDs.

## Scope

Pure data migration. No app code, no routes, no frontend. `require_permission`/`has_permission` stay stubs (separate story) — this only makes the DB rows exist.

1. Schema tweak: partial unique index on `role.name` WHERE `org_id IS NULL` (prevents duplicate system-role templates; per-org custom roles are unrestricted by this index since `org_id IS NOT NULL` there).
2. New Alembic data migration, `down_revision = '3ea2dea9a1db'` (current head):
   - Insert `Permission` catalog: 29 resources × standard CRUD actions, with `permission`/`test_log`/the 4 traceability link tables read-only, plus special verbs `test_plan.approve` and `requirement.export_rtm`. ~100 rows.
   - Insert 5 `Role` rows: `org_admin`, `test_manager`, `tester`, `auditor`, `ai_agent_scoped` — `org_id=NULL`, `is_system_role=true`.
   - Insert `RolePermission` bundle rows per role (below).
   - All inserts existence-checked first (by `code` / by `name WHERE org_id IS NULL`) so re-running the migration is a no-op, not a duplicate/error.

## Permission catalog (resource list)

Standard CRUD (`create`/`read`/`update`/`delete`): `organization`, `org_membership`, `role`, `role_assignment`, `project`, `release`, `requirement`, `test_condition`, `test_case`, `test_step`, `test_suite`, `test_plan`, `entry_exit_criteria`, `test_cycle`, `environment`, `test_execution`, `defect`, `risk_item`, `attachment`, `test_design_technique`, `test_level`, `test_type`, `approval`.

Read-only: `permission`, `test_log`, `requirement_test_case_link`, `requirement_test_condition_link`, `test_condition_test_case_link`, `test_case_defect_link`.

Special verbs: `test_plan.approve`, `requirement.export_rtm`.

## Role bundles

- **org_admin:** every `Permission` row (all ~100 codes).
- **test_manager:** `test_plan.*`+`.approve`, `entry_exit_criteria.*`, `test_cycle.*`, `test_suite.*`, `approval.create/.read`, `requirement.read/.export_rtm`, `defect.read`, `risk_item.*`, `test_case.read`, `test_step.read`, `test_condition.read`.
- **tester:** `test_case.*`, `test_step.*`, `test_condition.*`, `test_execution.*`, `test_log.read`, `defect.create/.read/.update`, `test_plan.read`, `test_suite.read`, `requirement.read`. No `approval.*`, no `test_plan.approve`.
- **auditor:** `.read` on all 29 resources + `requirement.export_rtm`. Nothing else — no writes anywhere.
- **ai_agent_scoped:** `test_case.create/.read/.update`, `test_step.create/.read/.update`, `test_execution.create/.read/.update`, `test_log.read`. No delete, no `approval.*`, no `role`/`role_assignment`/`org_membership` anything (RBAC-5 guarantees no `test_plan.approve` here — verified by TC-RBAC-014).

## Affected files

- `backend/app/models/rbac.py` — add partial unique index on `Role`.
- `backend/alembic/versions/<new>_seed_rbac_system_roles.py` — new data migration (upgrade seeds; downgrade deletes only the 5 `Role` rows by name where `org_id IS NULL` — `RolePermission` rows cascade-delete via existing FK `ondelete="CASCADE"`; `Permission` catalog rows are left in place since they're a shared global catalog other roles/stories may already reference).
- `backend/tests/integration/test_rbac_seed.py` — new: TC-RBAC-012 (5 roles present, `is_system_role=true`), TC-RBAC-013 (inserting a custom `Role` with `org_id` set succeeds), TC-RBAC-014 (`ai_agent_scoped` bundle has no `test_plan.approve`).
- `docs/database/2026-09-03-database-design.md` — note the new partial unique index in the `Role` table section.

## Edge cases

- Postgres treats `NULL <> NULL`, so a plain `UniqueConstraint(org_id, name)` would **not** stop duplicate system-role rows (two `(NULL, 'org_admin')` rows don't collide under standard SQL). Hence the partial index (`WHERE org_id IS NULL`) instead of a composite constraint.
- Migration re-run / redeploy: existence-check before each insert (by `Permission.code`, by `Role.name` where `org_id IS NULL`) makes upgrade idempotent without relying on DB-specific `ON CONFLICT` + partial-index target matching.
- `RolePermission` unique constraint `(role_id, permission_id)` already exists on the model — safe against double-linking even without an extra check, but we still existence-check for clean re-run logs.
- Custom per-org roles (`Role.org_id` non-null) are entirely unaffected by the new partial index — AC3 (org_admin can define custom roles) needs no code change, the model already supports it; TC-RBAC-013 just proves it.
- TC-TRACE-004 (auditor blocked from all writes) is **not** achievable yet — needs `require_permission` implemented (separate story). Out of RBAC-4's scope; noted so it isn't mistaken for a regression later.

## Out of scope

- `require_permission`/`has_permission` implementation.
- Org-creation flow wiring (RBAC-1/2/3 API routes) — this migration seeds global templates independent of any org-creation code path.
- ADMIN-2's generic CRUD screens for `Role`/`Permission`.
