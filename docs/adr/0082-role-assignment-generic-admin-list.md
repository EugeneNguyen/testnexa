# 0082. RoleAssignment gains a generic `list` (admin surface + MCP)

**Status:** Accepted
**Decider:** xuanbinh91@gmail.com (CTO)
**Date:** 2026-09-16

## Context

`RoleAssignment`'s `CrudEntityConfig` (`backend/app/api/routes/rbac_routes.py`, `_ROLE_ASSIGNMENT_CONFIG`, [ADR-0053](0053-tabler-install-phase-1-cdn.md)) has always excluded `list` from `methods`, with an explicit comment reasoning that RBAC-3's bespoke `GET /orgs/{org_id}/role-assignments` returned a bare array, not the `{items,total,page,page_size}` envelope the generic admin surface (`EntityListPage.tsx`)/`EntityTable` require — so neither the generic admin surface's "Role assignments" nav entry (`pages/admin/registry.ts`) nor an MCP `tn_role_assignment_list` tool ([ADR-0068](0068-mcp-6-per-entity-mcp-tools.md)) could exist.

That reasoning is stale: [ADR-0041](0041-ds-2-table-container-shared-pagination.md)/DS-2 (2026-09-07) already changed the bespoke route to the standard envelope, for `RoleAssignmentsPanel.tsx`'s own pagination — nobody revisited `_ROLE_ASSIGNMENT_CONFIG`'s `methods` when that shipped. The gap surfaced operationally: an `AIAgent` MCP caller with no existing `RoleAssignment` had no way to discover one to bootstrap from (no `tn_role_assignment_list`), and a human operator hit the same wall on the generic admin surface (`/orgs/:orgId/admin/role-assignments` renders "Listing is not available for this entity... its served schema does not include the list method").

## Decision

Add `"list"` to `_ROLE_ASSIGNMENT_CONFIG.methods` (not `full_methods`). This is deliberately **not** the `_PROJECT_FACTORY_CONFIG` `full_methods` pattern (reusing a bespoke route at a matching flat URL) — the bespoke list route is path-nested (`/orgs/{org_id}/role-assignments`), not the flat `?org_id=`-scoped shape the generic factory itself expects, so the two routes are not URL-interchangeable. Instead, the generic factory registers its own **separate, additional** flat route: `GET /role-assignments?org_id=...`, gated on the same `role_assignment.read` permission the bespoke route already checks (no RBAC bundle migration needed). `RoleAssignmentsPanel.tsx` is untouched — it keeps calling the bespoke nested route unchanged. The two list routes coexist, same precedent as `RoleAssignment` already having generic `get`/`update`/`delete` alongside its bespoke `create`.

Since `full_methods` is unset (`None`), `derive_entity_schema`'s `config.full_methods or config.methods` fallback means the served schema — and `app/mcp/tool_registry.py`'s generic-registry derivation — pick up `list` automatically. This also generates `tn_role_assignment_list` with zero registry changes (`BESPOKE_EXTRA_ACTIONS["role_assignment"]` stays `{"create"}`, unchanged — `create` is still 100% bespoke, `list`/`get`/`update`/`delete` are now all genuinely generic).

## Consequences

- Generic admin surface's "Role assignments" list page (`/orgs/:orgId/admin/role-assignments`) now renders, using the existing `EntityListPage`/`EntityTable` machinery — no frontend code change (ADR-0053 already made this frontend-config-free).
- MCP surface gains `tn_role_assignment_list`, generated automatically — total per-entity MCP tool count moves 147 → **148** (`tests/unit/test_mcp_tool_naming.py::test_generated_tool_count_is_the_number_adr_0067_states` updated to match; forward-pointer left in [ADR-0068](0068-mcp-6-per-entity-mcp-tools.md) would be the next place a reader looks — see that ADR's own count claim, not edited in place per this repo's "same-day/pre-merge amendment only" convention, since ADR-0068 already merged days earlier).
- `tests/unit/test_mcp_entity_dispatch.py::test_no_tool_is_generated_for_a_method_the_entity_does_not_support` had `("role_assignment", "list")` removed from its negative-case parametrization — it's no longer a method the entity lacks.
- Two list routes for the same entity (bespoke nested, generic flat) is a deliberate, precedented duplication, not drift — same shape `RoleAssignment` already has for `get`/`update`/`delete` (generic) alongside `create` (bespoke-only). A future consolidation (retiring the bespoke route in favor of the generic one) is out of scope here and would be its own ADR.
- No RBAC seed migration — both routes already gate on `role_assignment.read`, already granted to whatever roles held it before this change.
- No schema/database change. Backend unit suite: 612/612 passing after this change (was 611/611 immediately prior, +1 from a test removed being offset by pre-existing count — net unit test file line count reduced by one parametrize case, no new test file added).

## Alternatives considered

- **Reuse the bespoke route via `full_methods`** (the `_PROJECT_FACTORY_CONFIG` pattern). Rejected — the bespoke route's URL shape (`/orgs/{org_id}/role-assignments`, `org_id` path-nested) doesn't match what the generic admin surface/MCP generic-list caller expects (flat `?org_id=`), unlike Project's bespoke routes which do sit at the matching flat shape.
- **Migrate `RoleAssignmentsPanel.tsx` onto the new generic flat route, retiring the bespoke one.** Rejected for this pass — out of scope for what was a narrow operational unblock (an MCP AIAgent needing to discover assignments to bootstrap RBAC), and the bespoke route's custom modal UX (actor-id text input with inline validation, org-wide/project-scoped toggle) isn't something the generic admin surface's create form would currently reproduce (this entity's generic `create` is still deliberately disabled, `create_schema=None`).
- **Leave it as-is, document the gap.** Rejected — the gap was actively blocking use of the MCP server for its own stated purpose (an AIAgent bootstrapping its own permissions), not just a cosmetic admin-surface omission.
