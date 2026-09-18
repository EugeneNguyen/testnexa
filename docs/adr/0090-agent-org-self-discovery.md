# 0090. `GET /agents/me/orgs` + `tn_agent_org_list` — an AIAgent's own org self-discovery

**Status:** Accepted
**Decider:** xuanbinh91@gmail.com (CTO)
**Date:** 2026-09-18
**Related:** [ADR-0036](0036-shell-6-organization-switcher-header-dropdown.md) (`GET /auth/me/orgs`, the human-only route this one mirrors), [ADR-0065](0065-mcp-5-full-crud-all-entities.md) Decision §2 (excludes `/auth/*` from the MCP surface — this ADR's own route deliberately sits outside that prefix), [ADR-0033](0033-mcp-server-architecture.md) (MCP architecture)

## Context

Every org-scoped MCP list route (`tn_project_list`, `tn_requirement_list`, ...) requires `org_id`/`project_id` up front — by design, per NFR-1 (cross-tenant existence is never confirmable). Nothing on the MCP surface lets an `AIAgent` caller discover which org(s) it may act within before making that first call: `GET /auth/me/orgs` exists for exactly this question, but explicitly 403s any `AIAgent` caller (`OrgMembership.user_id` FKs `user.actor_id`, and an `AIAgent` has no row there — ADR-0036's own docstring). An agent with a valid bearer key and no other channel to learn its own org id is stuck.

Found live: an MCP session with a real `tnx_agent_...` key had no way to answer "what org am I scoped to" — every list tool it tried failed validation on a missing `org_id`, and no tool existed to supply one.

## Decision

New route, `GET /agents/me/orgs` (`app/api/routes/agents.py`), the `AIAgent`-only mirror of `GET /auth/me/orgs`: same response shape (`MeOrgsResponse`/`OrgSummary`, reused verbatim), same `_active_orgs_for_user` query (`auth.py`, one definition of "the caller's orgs," not a second copy), gates inverted — a `User` caller gets `403 actor_forbidden`, an `AIAgent` caller gets its `acting_on_behalf_of_user_id`'s active-membership orgs. Identity-scoped, no `org_id` path param, no permission check — same posture ADR-0036's own route takes.

Deliberately **not** placed under `/auth/*` and not a change to `GET /auth/me/orgs`'s own gate — ADR-0065 Decision §2 excludes `/auth/*` from the MCP-reachable surface on purpose ("human-identity/token flows, not agent-actionable data"), and that exclusion is still correct for the human-identity question. This is a new, narrow route answering a different question (an *agent's* own scope), so it's additive alongside that exclusion, not a reversal of it.

Registered as a new 100%-bespoke pseudo-resource in `app/mcp/tool_registry.py` (`"agent_org": {"list": _agent_org_list}`, no `CrudEntityConfig`, same shape as `test_case_link_requirement`), generating `tn_agent_org_list` — no `scope`/`fields`/pagination arguments.

## Consequences

- An `AIAgent` can now bootstrap its own org context (`tn_agent_org_list`, no arguments) before calling any org-scoped tool — closes the gap this ADR's Context names.
- No change to `GET /auth/me/orgs`'s own behavior or gate — human callers are unaffected, verified by rerunning `test_shell6_me_orgs.py` unchanged.
- Registry resource count 31 → 32, CRUD-action count 129 → 130, total generated tools 158 → 159 (no new `describe` — config-less, same as `release`/`test_case_link_requirement`). `tests/unit/test_mcp_tool_naming.py`'s literal anchor and `_EXPECTED_CONFIGLESS` updated in the same commit.
- No schema change, no migration, no new permission code — this route needs none (identity-scoped, same as its human mirror).
- New integration test `test_adr90_agent_org_discovery.py`: agent → 200 active-only, human → 403 (no leak), unauthenticated → 401, zero active memberships → 200 empty, plus the identical call proven reachable over MCP and byte-identical to the REST response.
- Verified against an isolated stack cloned from `main` (`testnexa-adr90-test`): backend unit 915/915 unchanged + 28/28 `test_mcp_tool_naming.py`, new integration file 2/2, `test_shell6_me_orgs.py` 3/3 unchanged. Full suite 1328/1338 passed with 10 pre-existing failures confirmed unrelated (structurally untouched by this change's diff — bare-`/health`-via-nginx and other already-drifted schema/seed tests, none in `agents.py`/`tool_registry.py`/`auth.py`).

## Alternatives considered

- **Relax `GET /auth/me/orgs`'s own gate to also accept an `AIAgent`.** Rejected — that route's docstring and ADR-0065's exclusion both treat `/auth/*` as human-identity-only on purpose; branching its gate to serve a second, structurally different actor (an agent has no `OrgMembership` of its own, only a transitive one via `acting_on_behalf_of_user_id`) would blur a route this repo has otherwise kept single-purpose, for a saving of one new small route.
- **A generic "whoami" MCP tool that also returns identity (like `GET /auth/me`).** Rejected as unnecessary scope for the actual gap: an agent's identity is already knowable to it (it minted the request), the missing piece was specifically "which orgs," not "who am I."
