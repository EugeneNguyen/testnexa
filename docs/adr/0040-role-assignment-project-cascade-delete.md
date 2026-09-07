# ADR-0040: `role_assignment.project_id` FK changes to `ON DELETE CASCADE` (was `RESTRICT`), unblocking Project delete

**Date:** 2026-09-07
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0039](0039-dash-2-org-home-dashboard-relabel-and-project-table.md) (DASH-2 — its Consequences addendum first found and characterized this defect), [ADR-0017](0017-project-creation-flow.md) (Project creation, step 5's auto-grant is the actual source of the row being deleted), [ADR-0022](0022-generic-crud-router-factory.md) (`DELETE /projects/{id}`, the route this unblocks)

## Context

ADR-0039's own verification pass found that `DELETE /projects/{id}` — shipped by ADR-0022's generic factory, given its first frontend caller by DASH-2's Project-table "Delete" button — `409`s `restrict_blocked` for **every** Project ever created through the app's own `POST /orgs/{org_id}/projects` route. That route unconditionally grants the creator a project-scoped `test_manager` `RoleAssignment` (ADR-0017 step 5), and `role_assignment.project_id`'s FK was `ON DELETE RESTRICT` — so the one row every real Project always has blocks its own deletion, permanently. ADR-0039 documented this as a known, unresolved defect rather than silently fixing it; this ADR is the follow-up decision closing it.

## Decision

Change `role_assignment.project_id`'s FK from `ON DELETE RESTRICT` to `ON DELETE CASCADE` — deleting a Project now also deletes every `RoleAssignment` scoped to it (project-scoped grants only; org-wide grants have `project_id IS NULL` and are never touched by this FK at all).

**Scope: this FK only.** Every other entity FK'd to `project.id` (`Release`, `Requirement`, `TestSuite`, `TestPlan`, `Environment`, `RiskItem`, `Attachment`, etc.) keeps its own `RESTRICT` — a Project with real test-management content should still fail to delete, and that's correct, unrelated behavior this ADR does not touch.

Implementation: `backend/app/models/rbac.py`'s `RoleAssignment.project_id` column definition + Alembic migration `6a11a6a1d803` (drops and recreates the named FK constraint under the same name, since Postgres has no in-place `ALTER ... ON DELETE`).

**Rationale for CASCADE over the other options ADR-0039 listed:**

- A project-scoped `RoleAssignment` has no meaning once its own Project is gone — unlike a `Requirement`/`TestCase`/other real artifact a user might want to recover or reassign, there is no "orphaned scope" state worth preserving. Deleting it along with the Project it scopes is the semantically correct behavior, not merely a workaround to unblock the UI button.
- A bespoke delete route with explicit cleanup logic (ADR-0039's second alternative) would duplicate exactly what a database-level `CASCADE` already does for free, for no benefit — the generic factory's plain `DELETE` stays usable, no new route needed.
- Changing the UI instead (surfacing the 409 more clearly, or disabling Delete) was rejected — it would leave the *actual* capability broken forever for the only real-world case (a UI-created Project), just with better error copy. That's polishing a bug, not fixing it.

## Consequences

**Positive:** `DELETE /projects/{id}` now works for its primary real-world case — a Project created through the app's own UI. No new route, no schema addition beyond the one FK's `ON DELETE` clause, no RBAC/permission change (the gate itself — `project.delete` — is unchanged).

**Negative / accepted trade-offs:**

- **Deleting a Project now silently removes other actors' project-scoped role grants too, not just the creator's.** If an `org_admin` had explicitly granted a second user a project-scoped role on that Project (RBAC-2/RBAC-3), deleting the Project removes that grant with no separate confirmation or notice beyond the existing "this cannot be undone" delete-confirm copy. This is correct (the grant's scope no longer exists) but worth naming explicitly — no story has yet asked for a "this will also remove N role assignments" warning in the confirm modal, and this ADR does not add one.
- **Still won't delete a Project with real content.** `Release`/`Requirement`/`TestSuite`/etc.'s own `RESTRICT` FKs are unchanged and will still `409` for any Project with real test-management artifacts — expected, not a regression, not addressed by this ADR (a Project with real content genuinely shouldn't be deletable via a simple button click without cascading a much larger and more consequential set of data, which is out of scope here).

## Alternatives considered

See ADR-0039's Consequences addendum, which enumerated the same three options this ADR chooses between (cascade the FK, bespoke delete route with explicit cleanup, or UI-only mitigation) — reproduced and resolved here rather than duplicated.
