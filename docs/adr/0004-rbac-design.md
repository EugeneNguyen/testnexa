# ADR-0004: RBAC — dependency-injected permission checks over a shared Actor

**Date:** 2026-09-03
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [Scaffold design spec](../superpowers/specs/2026-09-03-project-scaffold-design.md), [RBAC-1..5 user stories](../user-stories/2026-09-03-rbac-tenancy-stories.md), [GOV-1 user story](../user-stories/2026-09-03-governance-stories.md)

## Context

The same permission system must govern both human `User` and machine `AIAgent` actors, support both org-wide and project-scoped grants, and give a structural — not merely policy-document — answer to "can an AI agent approve a test plan?"

## Decision

- `Role` / `Permission` / `RolePermission` / `RoleAssignment` model; `RoleAssignment.actor_id` references the shared `Actor` supertype (resolves to `User` or `AIAgent`), and `RoleAssignment.project_id` is nullable (null = org-wide grant).
- Every protected route depends on `require_permission(code: str)`, a FastAPI dependency that resolves the calling `Actor` from the bearer token and checks its resolved permission set.
- The Approval-creation endpoint additionally hardcodes a 403 for any request whose actor resolves to `AIAgent`, regardless of what `RoleAssignment`/`RolePermission` data says — enforced twice (seed data never grants `test_plan.approve` to `ai_agent_scoped`, and the endpoint rejects it defense-in-depth even if a future custom role tried to).
- **System role seeding (RBAC-4):** the 5 system roles are global templates — `Role.org_id = NULL`, `is_system_role = true` — seeded once by an Alembic data migration, not per-org at org-creation time. They're assignable into any org via `RoleAssignment.org_id` (which does the actual per-org scoping), so "available for assignment without further setup" holds for every org without a runtime seeding step. `org_admin` is granted the full `Permission` catalog (superuser within its org); the other 4 roles get curated bundles matching their story description exactly (see [Database Document](../database/2026-09-03-database-design.md) §3.3 for the bundle table). A partial unique index on `role.name WHERE org_id IS NULL` prevents a re-run of the seed migration from duplicating the 5 templates; org-scoped custom roles (AC3) are unaffected by that index. Downgrading the seed migration removes only the 5 `Role` rows (their `RolePermission` links cascade via the existing FK) — the `Permission` catalog itself is left in place as a shared, additive resource other roles may already reference.

## Consequences

**Positive:** the permission check is explicit and visible per route (not implicit middleware magic); it extends uniformly to AI agents without a special-cased "is this a bot" branch anywhere except the one intentional Approval exception; the allow/deny behavior is directly testable as an RBAC matrix (see [Test Design](../test-design/2026-09-03-test-design.md)).

**Negative / Trade-offs:** every new route must remember to attach the dependency — mitigated for the common case because the generic CRUD router factory (ADMIN-2) bakes the check in by construction, so only genuinely bespoke routes carry manual risk. Seeding the full ~100-code `Permission` catalog up front (rather than only the codes the 4 non-admin bundles touch) means RBAC-4's migration does work that conceptually belongs to ADMIN-2's "mechanical generation from the model registry" — accepted as a one-time duplication cost so `org_admin` is a genuine superuser on day one; ADMIN-2 should treat the catalog as already-seeded and only add rows for entities added after RBAC-4 ships.

## Alternatives considered

- **Attribute-based access control / external policy engine (e.g. OPA)** — rejected as over-engineered for this scaffold's scope; revisit if per-org custom policies beyond role bundles are needed later.
