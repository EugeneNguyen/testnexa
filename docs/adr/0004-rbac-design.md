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

## Consequences

**Positive:** the permission check is explicit and visible per route (not implicit middleware magic); it extends uniformly to AI agents without a special-cased "is this a bot" branch anywhere except the one intentional Approval exception; the allow/deny behavior is directly testable as an RBAC matrix (see [Test Design](../test-design/2026-09-03-test-design.md)).

**Negative / Trade-offs:** every new route must remember to attach the dependency — mitigated for the common case because the generic CRUD router factory (ADMIN-2) bakes the check in by construction, so only genuinely bespoke routes carry manual risk.

## Alternatives considered

- **Attribute-based access control / external policy engine (e.g. OPA)** — rejected as over-engineered for this scaffold's scope; revisit if per-org custom policies beyond role bundles are needed later.
