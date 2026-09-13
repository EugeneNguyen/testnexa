# ADR-0066: TestType catalog ships with a permanent default seed

**Date:** 2026-09-13
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0022](0022-generic-crud-router-factory.md) (generic CRUD factory `TestType` is served through, unchanged), [User Stories: ADMIN-1](../user-stories/2026-09-03-taxonomy-admin-crud-stories.md), [TC-ADMIN-001](../test-cases/2026-09-03-test-cases.md), [TC-ADMIN-040](../test-cases/2026-09-03-test-cases.md)

## Context

`TestType` (`app/models/taxonomy.py`) ships full CRUD via the generic factory (ADR-0022) but zero seeded rows — confirmed empty on `main` itself, not just a freshly-cloned stack. Root `CLAUDE.md`'s own testing notes already flag this: a fresh manual-test handoff hits it immediately, the TestCase create/edit form's TestType dropdown has nothing to select, no error, just an empty control — and explicitly leave "whether these ship with a permanent default seed (like RBAC-4 seeds `Role`/`Permission`) is an open product decision for a future story/ADR, not something to silently decide inside a docs or verification pass." This ADR is that decision, for `TestType` only.

`TestLevel` has the identical gap and is deliberately **out of scope here** — this story's own request named `TestType` specifically; `TestLevel`'s own seed is a separate future decision, not silently bundled in.

## Decision

1. **Seed `TestType` with 5 permanent default rows**, ISTQB CTFL v4.0.1-aligned (NFR-5's "structured lookups matching ISTQB vocabulary, not free text" requirement): `Functional Testing`, `Non-functional Testing`, `Black-box Testing`, `White-box Testing`, `Confirmation Testing`.
2. **Idempotent Alembic data migration**, existence-checked by `name` — same pattern as `34053c46f9fc_seed_rbac_system_roles.py`. Re-running it (or applying to a DB that already has some of these rows) inserts only what's missing, never duplicates.
3. **No schema change.** `TestType` (`id`/`name`/`created_at`/`updated_at`, `name` unique) is unchanged; this is pure data.
4. **`downgrade()` deletes only these 5 rows by name**, not the whole table — any admin-added custom `TestType` row (the entity keeps full CRUD, an org admin with `test_type.create`/`.delete` can still add/remove rows) is left untouched, same posture RBAC-4's own seed migration takes toward its system roles.

## Consequences

**Positive.** The TestCase create/edit form's TestType dropdown is populated out of the box on any fresh or cloned DB — closes the exact gap root `CLAUDE.md`'s testing notes already named, unblocks TC-ADMIN-001's own precondition ("Seeded TestLevel/TestType/TestDesignTechnique") for the `TestType` half. No frontend or API change needed — both already read/write `TestType` through the existing generic factory.

**Negative / Trade-offs.** The 5 names are now a de facto default vocabulary; an org that wants a different classification scheme still can (full CRUD, not locked), but starts with these 5 present rather than a blank slate. `TestLevel` stays unseeded, so the dropdown gap persists for that one field until its own future decision — noted explicitly here so it isn't mistaken for an oversight.

## Alternatives considered

- **Seed both `TestLevel` and `TestType` together**, closing the whole gap root `CLAUDE.md` flags at once. Rejected for this pass — the task's own scope named `TestType` only; bundling an unrequested change risks picking `TestLevel`'s own 3-value ISTQB set (`Component`/`Integration`/`System`/`Acceptance`) without an explicit ask.
- **No migration, seed via a one-off script run manually per environment.** Rejected — doesn't travel with the DB clone recipe (root `CLAUDE.md`'s isolated-stack step 5) or a fresh `alembic upgrade head`, would need re-running by hand on every new environment, exactly the failure mode RBAC-4's own migration-based seed already avoids.
