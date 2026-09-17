# 0083. AIAgent permission checks inherit from `acting_on_behalf_of_user_id`

**Status:** Accepted
**Decider:** xuanbinh91@gmail.com (CTO)
**Date:** 2026-09-17
**Related:** [ADR-0015](0015-ai-agent-credential-mechanics.md) (AI agent credential mechanics — "minimal-RBAC-now"), [ADR-0017](0017-project-creation-flow.md)/RBAC-2 (suspended-member gate, `_has_active_membership`), MCP-1 (`_actor_membership_exists`'s existing behalf-user fallback for the NFR-1 existence boundary)

## Context

`app/core/rbac.py`'s `has_permission`/`has_permission_in_any_org` are the sole authorization gate behind every permission-checked route (13 call sites, both bespoke and the generic factory). Before this change, both checked only the calling actor's own `actor_id` — an `AIAgent` with zero `RoleAssignment` rows of its own always failed, regardless of whether the human it was minted to act for (`acting_on_behalf_of_user_id`) held the permission.

This was a real operational blocker, found the hard way in this session: an MCP server's own bootstrap key had no `RoleAssignment`, and granting one required a human to already be using the app UI — a chicken-and-egg gap for any agent minted before its first grant. It's also an inconsistency already present elsewhere in the codebase: MCP-1/ADR-0033 already gives `_actor_membership_exists` (the NFR-1 *existence* boundary — "does this org exist, is the caller a member") a behalf-user fallback for exactly this actor type. Authorization (*may this actor do X*) had no equivalent fallback, only authentication/existence did.

ADR-0015 titled its own posture "minimal-RBAC-now" — this ADR revises that specifically for the inheritance question, not the rest of ADR-0015's scope.

## Decision

`has_permission(actor: User | AIAgent, org_id, code, project_id=None)` and `has_permission_in_any_org(actor: User | AIAgent, code)` now take the actor object, not a bare id (mirroring `_actor_membership_exists`'s existing shape). Internally, the set of ids checked is:

- **Always:** the actor's own `actor_id`.
- **Additionally, when `actor` is an `AIAgent`:** its `acting_on_behalf_of_user_id`, **UNION'd in** — not a replacement, not an AND. An agent's own narrower grant (e.g. the seeded `ai_agent_scoped` bundle) keeps working exactly as before; the human's grant is an additional way to pass, not a requirement layered on top.

**`has_permission` (org-scoped) additionally requires the behalf-user to hold an *active*-status `OrgMembership` in this exact `org_id`** before their grant counts — reusing `_has_active_membership`, the same helper `require_permission`'s own suspended-member gate already calls for a `User` actor directly. A suspended human's agent must not gain more reach than the human currently has. This is checked with the same DB round-trip pattern `has_permission` already used (its own short-lived `AsyncSessionLocal` session).

**`has_permission_in_any_org` does NOT add an active-membership check** — it has no single `org_id` to check membership against (that's the reason the function exists at all: `POST /orgs` has no target org yet), and its own `User` path has never had one either. Adding an asymmetric requirement to only the `AIAgent` branch would check something this function was never gated on for a human caller.

All 13 call sites (`crud_factory.py`, `assets.py`, `projects.py`, `execution_authoring.py`, `organizations.py`, `execution.py`, `releases.py`, `test_condition_authoring.py`, `test_plan_membership.py`, `test_cycle_creation.py`, `test_suite_membership.py`, `trace.py`, plus `rbac.py`'s own `require_permission`) updated to pass the actor object instead of `str(actor.actor_id)` — a mechanical signature-shape change, no call site's own permission code or org/project resolution logic touched.

## Consequences

- An `AIAgent` with no `RoleAssignment` of its own can now perform any action its `acting_on_behalf_of_user_id` could, in any org where that human holds an active membership and the relevant grant — closing the bootstrap gap this session hit directly.
- A `User` actor's own behavior is byte-identical to before: exactly one id checked, no new gate, no new query shape. Verified: full backend unit suite 906/906 unchanged.
- New integration tests (`tests/integration/test_adr83_aiagent_permission_inheritance.py`): (1) agent with zero own grant, behalf-user active + granted → succeeds; (2) same, but behalf-user's membership suspended → `403 permission_denied`, not inherited; (3) agent's own grant alone, behalf-user has nothing in this org → still succeeds (union, not replace, regression guard). All three pass against a live isolated stack cloned from `main`.
- **No audit-trail change** — every write path still records the acting `Actor`'s own `actor_id` (the agent's, not the human's). "Who is accountable for this inherited-permission action" is out of scope here (question 5's default from this ADR's own plan-with-open-questions pass) — a future story's call if per-action "acting on behalf of X" attribution is ever needed beyond what `AIAgent.acting_on_behalf_of_user_id` already records statically on the agent row.
- No schema/database/migration change — this is pure query-logic, no new columns, no new tables.
- No RBAC seed-catalog change — no new permission codes, no new role bundles.
- **Numbering:** checked against `origin/main` immediately before writing (`git fetch`, zero commits behind) — `0083` is next-free after this same session's own `ADR-0082` (the unrelated `role_assignment` generic-list fix, drafted earlier the same session and separately renumbered once for a peer-session collision on `origin/main`'s `ADR-0073..0081`).

### Amendment (2026-09-17, same day, pre-merge correction): fallback-only, not a per-check union

The Decision above, as first written and implemented, UNION'd the behalf-user's `RoleAssignment` rows into **every** `has_permission` check for an `AIAgent`, unconditionally. Running the full backend integration suite against this exposed a real regression: `test_projects.py::test_aiagent_grantee_resolves_identically_to_human_grantee` (TC-RBAC-011) — a pre-existing, deliberately-authored test proving an agent's permission resolution stays isolated to its own `RoleAssignment` rows, "identically to a human." That test narrows an agent to a project-A-only grant and asserts project B still `403`s. With the unconditional union, it didn't: the agent's behalf-user held `org_admin` **org-wide** the whole time (never revoked, unrelated to the test's own project-scoped swap), and since the project-B check is a fresh query each time, the agent's own non-matching row simply fell through to the human's matching one.

The bug in the original design: **existence of *a* grant for the agent is not the same claim as *this specific check* matching one of the agent's own rows** — a per-check union means an agent with any real but narrower grant still leaks through to the human's broader access on every check that grant doesn't happen to cover, not just the zero-grants bootstrap case this ADR was actually motivated by.

**Fix:** the fallback is now gated on existence, not per-check match — an `AIAgent` inherits its behalf-user's grants only when `_actor_has_any_role_assignment_in_org` (`has_permission`) / `_actor_has_any_role_assignment_anywhere` (`has_permission_in_any_org`) returns `False` for the agent itself. An agent holding any `RoleAssignment` at all — anywhere in the org, regardless of whether it covers the specific `code`/`project_id` being checked right now — is fully self-contained and never falls through, exactly restoring TC-RBAC-011's invariant. A genuinely grant-less agent (the actual motivating case: an MCP key minted with nothing yet) still inherits exactly as designed. Every other part of the Decision (active-membership requirement on the behalf-user, no active-membership check for `has_permission_in_any_org`, union-not-AND framing for the *fallback itself*) is unchanged — only the trigger condition (unconditional vs. existence-gated) was wrong.

`test_agent_own_grant_still_works_with_no_behalf_user_permission` (this ADR's own regression guard, written before this bug was found) did not catch it, because it tests the inverse shape (agent has a grant, human has *none* — the union and the fallback-only design produce the same answer there). TC-RBAC-011 caught it specifically because it tests an agent with a grant that doesn't cover *this* check while the human's *does* — the one cell the two designs disagree on. Re-verified after the fix: TC-RBAC-011 passes; all three of this ADR's own new tests still pass; full backend integration suite otherwise unaffected (5 unrelated failures — `test_admin_testtype_seed.py`'s pre-existing seed-data/`alembic`-not-on-`$PATH` environment issues, and two host-contention `ReadTimeout` flakes that passed clean on an isolated rerun — none touch `rbac.py` or any of its 13 call sites).

## Alternatives considered

- **AND instead of union** (agent must hold the permission itself AND the human must too). Rejected — this would make the existing `ai_agent_scoped` system role bundle pointless dead weight for any agent that also has a behalf-user, and doesn't match the plain-language reading of "acting on behalf of."
- **Replace the agent's own `RoleAssignment` mechanism entirely** with pure inheritance. Rejected — an agent scoped to fewer permissions than its behalf-user on purpose (a deliberately narrow bot) is a legitimate shape this repo already supports; removing it would be a real capability regression for no stated benefit.
- **No active-membership check on the behalf-user for `has_permission`.** Rejected — would let a suspended human's agent keep acting indefinitely, directly contradicting RBAC-2/ADR-0017's whole point (a suspended member's still-recorded grants must never satisfy a permission check) for the human path; extending that same posture to the inherited path is the consistent choice.
- **Thread a `db: AsyncSession` parameter through `has_permission` instead of opening its own session**, to make the new active-membership check one round trip instead of two. Rejected for this pass — `has_permission`'s signature has been fixed at "no `db` param" since AUTH-4 specifically so it stays usable outside a request lifecycle (the function's own docstring); changing that is a separate, larger refactor this story doesn't need to force through to close a real, narrow gap.
