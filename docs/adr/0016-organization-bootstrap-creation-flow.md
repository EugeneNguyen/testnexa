# ADR-0016: Organization bootstrap & creation flow

**Date:** 2026-09-03
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0004](0004-rbac-design.md) (RBAC design), [ADR-0007](0007-real-multi-tenancy.md) (real multi-tenancy), [ADR-0015](0015-ai-agent-credential-mechanics.md) (minimal-RBAC-now precedent, 404-vs-403 boundary this ADR deliberately does NOT reuse in one case — see Decision), [RBAC-1 user story](../user-stories/2026-09-03-rbac-tenancy-stories.md#story-rbac-1-create-an-organization), [RBAC-1 scope plan](../superpowers/plans/2026-09-03-rbac-1-create-org-plan.md)

## Context

RBAC-1 needs two distinct ways to create an `Organization`: (a) the very first user on a fresh instance, with no account and no org yet — a public bootstrap; (b) an existing `org_admin` minting a second org, fully authenticated. ADR-0007 decided real multi-tenancy exists at all; it didn't decide how the first org (or any subsequent one) actually gets created.

Two gaps ADR-0015 left open surface directly here:

1. `require_permission(code)` resolves `org_id` from `request.path_params["org_id"]` — every route it's been used on so far (`/orgs/{org_id}/agents*`) already has a target org in its path. Creating a *second* org has no target `org_id` yet; the org doesn't exist until the call succeeds. The existing dependency doesn't fit as-is.
2. ADR-0015's 404-vs-403 boundary (`NFR-19`) is defined in terms of "the caller's membership in the path's `org_id`" — again presupposing a target org already exists. There is nothing to hide the existence of when the target org is the thing being created.

RBAC-4 landing first (seeded `org_admin` system `Role`, full `Permission` catalog including `organization.create`) removes what would otherwise have been this story's biggest open dependency — the org_admin role a first signup grants already exists as seed data, RBAC-1 only needs to assign it.

## Decision

- **Two routes, not one.** `POST /auth/signup` (public) handles case (a) only; `POST /orgs` (authenticated) handles case (b). They are not the same code path reused with an optional-auth branch — signup takes `{name, email, password, org_name, org_slug}` (creates a brand-new `User`), `POST /orgs` takes `{name, slug}` only (the caller is already a `User`/`AIAgent`).
- **Signup is bootstrap-only, not general self-registration.** `POST /auth/signup` works only while zero `Organization` rows exist deployment-wide; once the first org exists, it returns `409 signup_closed`. Further onboarding is either `POST /orgs` (an existing org_admin minting another org) or RBAC-2's invite flow (not yet built) — never open self-registration into an arbitrary org. Rejected alternative below.
- **Concurrent-bootstrap race, closed with an advisory lock.** Two simultaneous first-ever signup calls could both observe zero orgs before either commits and both succeed, violating "exactly one org gets created from a fresh instance's first signup." `POST /auth/signup` acquires `pg_advisory_xact_lock(<fixed key>)` before its exists-check, inside the same transaction as the insert — serializes concurrent bootstrap attempts without needing a row lock on a table that doesn't have a row yet.
- **Bespoke any-org permission gate for `POST /orgs`, not a forced fit into `require_permission`.** New helper `has_permission_in_any_org(actor_id, code)` in `app/core/rbac.py`: same `RoleAssignment → Role → RolePermission → Permission` join `has_permission` already uses, but with no `org_id` filter — answers "does this actor hold `code` org-wide (`project_id IS NULL`) in *any* org they belong to," which is the only well-formed question before the target org exists. `has_permission`/`require_permission` themselves are untouched; this is a sibling, not a modification.
- **No 404-vs-403 boundary on `POST /orgs`.** There is no target org to hide the existence of — a 403 `permission_denied` is the only rejection this route needs for an under-permissioned caller.
- **Creator auto-joins any org they create.** Both routes give the creator `OrgMembership(status=active)` + an org-wide `org_admin` `RoleAssignment` in the org just created — for signup this is definitionally the first membership; for `POST /orgs` it's a deliberate choice (see Alternatives) since RBAC-2's invite flow doesn't exist yet to add anyone else afterward.
- **`slug` is user-supplied on both routes**, validated `^[a-z0-9-]+$`, never server-derived from `name`. A uniqueness collision on either route is `422` (matches the already-documented **TC-RBAC-003** expectation) — `409` is reserved exclusively for the signup-closed case above, so the two failure modes are never confused on the wire.

## Consequences

**Positive:** RBAC-1 ships without waiting on RBAC-2/3's own business flows; the org_admin role assignment reuses RBAC-4's seed data exactly as designed (no per-org role duplication); the any-org gate is small, self-contained, and doesn't contort `require_permission`'s existing path-param-scoped contract to fit a route shape it wasn't built for; the bootstrap-closes-after-first-org rule gives a clear, testable answer to "what happens if someone hits signup twice" instead of leaving it implicit.

**Negative / Trade-offs:** Two separate org-creation code paths (signup vs. `POST /orgs`) duplicate some logic (org+membership+role-assignment creation, slug validation) rather than one fully unified path — accepted because their auth preconditions are genuinely different (unauthenticated-with-new-credentials vs. authenticated-existing-actor), and forcing them into one endpoint would mean an awkward optional-body-fields contract. `has_permission_in_any_org` is a second, subtly different permission-resolution function living alongside `has_permission` — a future maintainer adding a permission check must pick the right one deliberately; documented here and in the RBAC-1 scope plan specifically so it isn't mistaken for a redundant duplicate. The advisory-lock key is a fixed constant shared by every signup call — a very hot bootstrap-race window (many simultaneous first signups) would serialize on it, acceptable given this is a one-time-per-deployment event, not an expected steady-state load pattern.

## Alternatives considered

- **Single `POST /orgs` endpoint for both cases, with optional signup fields when unauthenticated** — rejected: conflates two different auth preconditions behind one contract, makes the "is this call authenticated or not" branch implicit in body-field presence rather than explicit in the route/auth-scheme, and complicates OpenAPI-schema clarity for API consumers.
- **Leave signup open indefinitely (every signup mints a new org, always)** — rejected: makes AC2's "existing org_admin creates a second org" scenario redundant with signup (anyone could just sign up again instead of using the authenticated route), and permanently-open self-registration undermines RBAC-2's eventual invite-only onboarding model — better to close the door now and open a narrower one (invites) later than to widen an already-open one.
- **No advisory lock; rely on the `slug` unique constraint to catch a concurrent-bootstrap race after the fact** — rejected: two concurrent first signups would typically use *different* slugs (each user picks their own), so the unique constraint wouldn't catch the case at all — the race isn't about colliding slugs, it's about two orgs being created when the invariant is "at most one org exists before the first signup completes."
- **Force-fit `require_permission`/the 404-vs-403 boundary onto `POST /orgs` by inventing a synthetic `org_id`** (e.g. a sentinel/zero UUID) — rejected: manufactures a fake tenant boundary to hide the existence of nothing, adds complexity with no corresponding security benefit, and risks a future reader assuming the sentinel means something real.
