# ADR-0066: ADMIN-5 — seed the `TestLevel` catalog with 5 ISTQB test levels

**Status:** Accepted
**Date:** 2026-09-13
**Deciders:** xuanbinh91@gmail.com (CTO)

## Context

`TestLevel` (`backend/app/models/taxonomy.py`) is a global lookup catalog — `id`, `name` (unique), `created_at`/`updated_at`, no `org_id` — served by the generic CRUD factory ([ADR-0022](0022-generic-crud-router-factory.md)) with full `list`/`get`/`create`/`update`/`delete`. `TestCase.test_level_id` is a `not null` FK into it (Database Document §3.9), and both the direct `TestCase` create form and the `TestCondition`-mediated one (`ProjectDetail.tsx`) render a `<select>` populated from `listTestLevels()`.

FR-ADMIN-1's own acceptance criterion, written 2026-09-03, already reads: "Given the seeded `TestDesignTechnique`, `TestLevel`, `TestType` lookup tables (ISTQB CTFL v4.0.1 vocabulary, seeded via Alembic data migration)..." — but no migration has ever actually inserted a row into any of the three tables. Confirmed empty on `main` itself, not just a freshly-cloned stack (root `CLAUDE.md`, 2026-09-06). The result: the `TestCase` create form's level/type dropdowns are empty on every fresh environment, blocking the most basic manual test-authoring walkthrough with no error — just nothing to select. Root `CLAUDE.md` flagged whether these catalogs should ship a permanent default seed (the same way RBAC-4/[ADR-0004](0004-rbac-design.md) seeds `Role`/`Permission`) as an explicit open product decision for a future story/ADR, not something to silently decide inside a docs or verification pass.

This story (ADMIN-5) closes that decision for `TestLevel` specifically — the ISTQB CTFL v4.0.1 test levels are a small, standard, universally-applicable vocabulary (unlike `TestType`, which this codebase's own docs don't yet enumerate a canonical list for) and the CTO's own task description names the exact 5 values to seed.

## Decision

1. **Seed exactly 5 `TestLevel` rows**, via a new Alembic data migration, same shape as RBAC-4's own seed migrations (`sa.table()` proxy, not the ORM model — [ADR-0004](0004-rbac-design.md)):
   - Component Testing
   - Component Integration Testing
   - System Testing
   - System Integration Testing
   - Acceptance Testing
2. **Idempotent, existence-checked by `name`** — mirrors NFR-20's own RBAC-4 precedent. Re-running `alembic upgrade head` inserts no duplicates, relying on `TestLevel.name`'s existing unique constraint (Database Document §3.10) plus an explicit pre-insert existence check (not the constraint alone, so a re-run doesn't throw an `IntegrityError`).
3. **Symmetric `downgrade()`** — deletes exactly these 5 rows by name, leaving any other `TestLevel` row (e.g. one created after the seed via the existing generic CRUD `create` route) untouched. Never a blanket `DELETE FROM test_level`.
4. **`TestType`/`TestDesignTechnique` are explicitly out of scope** — this ADR resolves the open seeding question for `TestLevel` only. The task's own description names only Test Levels; `TestType` has no canonical value list documented anywhere in this repo yet, and seeding one without a source-of-truth vocabulary would be inventing product data, not implementing a spec. A future story can seed `TestType` the same way, once its own vocabulary is decided.
5. **Catalog inline in the migration file**, not a separate `app/db/*_seed_catalog.py` module — RBAC-4's separate catalog module earns its keep because that seed data (permission codes, role bundles) is large and cross-referenced by more than one migration; 5 static strings used exactly once don't need that indirection.
6. **No schema, API, or frontend change.** The generic factory's `GET /test-levels` route and the `TestCase` create-form dropdowns already exist and already work — this ADR only makes them non-empty.

## Consequences

- Every fresh environment (a new dev stack, an isolated test stack cloned from `main`, a from-scratch `alembic upgrade head`) now has a usable `TestLevel` dropdown without a manual hand-seed step — the exact gap root `CLAUDE.md`'s "ship with full CRUD but zero seeded rows" note flagged.
- `TestType` remains empty until a future story seeds it — a manual test-authoring walkthrough that also needs `TestType` still hits the same empty-dropdown gap this ADR doesn't close. Documented explicitly here so it isn't mistaken for an oversight.
- A `TestLevel` row created directly (bypassing this seed) with a `name` colliding with one of the 5 seeded values would violate the existing unique constraint regardless of this migration — not a new risk this ADR introduces.
- Because `TestLevel` has no `org_id` (a global catalog, ADR-0022), this seed applies identically to every organization on the instance — there is no per-tenant seeding question here, unlike RBAC-4's own per-org `RoleAssignment` grants.

## Alternatives considered

- **Seed via application-startup code (e.g. a FastAPI lifespan hook) instead of a migration.** Rejected — every other seeded catalog in this repo (RBAC-4's roles/permissions) uses an Alembic data migration; a second seeding mechanism would be an unnecessary inconsistency with no benefit (this data changes at deploy time, not at runtime).
- **Seed `TestType`/`TestDesignTechnique` in the same migration, since they're mentioned in the same open-question note.** Rejected — the task's own scope names only Test Levels, and `TestType` has no canonical vocabulary decided anywhere in this repo yet to seed correctly.
- **A separate `app/db/test_level_seed_catalog.py` module, mirroring RBAC-4's `rbac_seed_catalog.py`.** Rejected for this story's scope — 5 static strings, referenced by exactly one migration, don't need a dedicated module; revisit if a future migration needs to reference the same list (e.g. a `TestType` seed migration wanting a shared naming convention).
