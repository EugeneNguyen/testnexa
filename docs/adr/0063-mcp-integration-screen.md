# ADR-0063: MCP Integration screen — client docs + live agent-key management

**Date:** 2026-09-13
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0033](0033-mcp-server-architecture.md) (the MCP server this screen documents/manages credentials for), [ADR-0015](0015-ai-agent-credential-mechanics.md) (`AIAgent` credential mechanics — `create`/`revoke` reused unchanged), [ADR-0050](0050-shell-9-project-scope-nav-context-resolution.md) (`useResolvedOrgId()`, reused for org-vs-project mode resolution), [MCP-4 UI Design Document](../ui-design/2026-09-13-mcp-4-mcp-integration-screen-ui-design.md)

## Context

`backend/app/mcp/` (ADR-0033) has shipped a real, working MCP server since MCP-1 — but nothing in the product surfaces it to a human. Connecting a client (Claude Code, Codex, Cursor) requires reading `backend/app/mcp/README.md` (an implementer-facing doc, not user-facing) and knowing the exact bearer-key config syntax each client expects. Issuing/revoking an `AIAgent` credential is API-only: `POST /orgs/{org_id}/agents` and `POST /orgs/{org_id}/agents/{agent_id}/revoke` (ADR-0015) exist and are fully tested, but there was no `GET` list route and no frontend caller for any of the three — a human wanting to connect an agent had to craft raw `curl` requests.

Direct product ask (2026-09-13): a page in the org nav and a page in the project nav explaining MCP and how to integrate with Claude Code/Codex/(and, expanded during scoping, Cursor + a generic fallback), plus live key generation and management.

## Decision

1. **One shared screen component** (`pages/workflows/McpIntegration/`), mounted at both `/orgs/:orgId/mcp` and `/projects/:projectId/mcp` — not a `scope` prop. It resolves org-vs-project mode itself via `useResolvedOrgId()` (SHELL-9/ADR-0050), the same hook `AppSidebar`/`AppBreadcrumb` already use for the identical question, avoiding a second, driftable source of the same fact.
2. **Client-connection docs cover Claude Code, Codex CLI, Cursor, and a generic "any MCP-HTTP client" fallback** — verified current config syntax for each (not guessed): Claude Code's `claude mcp add --transport http` / `.mcp.json` with a `headers` object; Codex's `~/.codex/config.toml` `[mcp_servers.<name>]` + `bearer_token_env_var`; Cursor's `.cursor/mcp.json`, same shape as Claude Code's JSON form. The server URL is derived from `window.location.origin` at render time, not a `<your-host>` placeholder, so the snippet is copy-pasteable as-is.
3. **New backend route: `GET /orgs/{org_id}/agents`** (list, paginated `{items,total,page,page_size}` envelope, NFR-6) — the one missing piece of AUTH-4/ADR-0015's credential lifecycle. Same gate order as `create_agent`/`revoke_agent` (human-only, then the 404-vs-403 org-membership boundary, then a permission check), same "belongs to `org_id` via `acting_on_behalf_of_user_id`'s own `OrgMembership`" resolution `revoke_agent` already established. Includes revoked agents (not filtered out) — management needs the history.
4. **Permission code reused, not added**: the list route gates on `ai_agent.create` rather than a new `ai_agent.read` — ADR-0015's own minimal-RBAC-now posture, extended rather than reopened. No new Alembic data migration needed as a result. Revisit if a future story needs list-only access without create rights.
5. **Live key management (org mode only)**: issue (name + optional model/provider + `acting_on_behalf_of_user_id` picked from the org's active members), list (active + revoked), revoke — all three reuse the existing/new routes above, no new backend surface beyond the list route in #3. The raw key is shown exactly once, copy-to-clipboard, same one-time-secret UX `OrgMembers.tsx`'s invite-link flow already established (`navigator.clipboard`-with-`execCommand`-fallback, copied rather than shared this pass — see Consequences).
6. **Project-mode screen is docs-only** — a link back to the org-scoped screen for key management, since `AIAgent` credentials are org-scoped (ADR-0015), not per-project. No per-project credential concept is introduced.
7. **Sidebar nav item, both modes**: "MCP Integration" (`fa-solid fa-plug`) after "Members" (org) / after "Overview" (project).

## Consequences

**Positive:** MCP-1..3's already-shipped backend capability finally has a discoverable, usable human entry point. Zero new backend surface beyond one list route reusing every existing gate/permission pattern verbatim. Connection instructions are sourced from a live web search against each client's current documented config format at write time, not remembered/guessed syntax that could be stale or wrong.

**Negative / accepted trade-offs:**
- **The copy-to-clipboard helper is duplicated** between `OrgMembers.tsx` and this screen's `AgentKeyManagement`, rather than extracted into a shared hook — two occurrences alone doesn't decisively cross this repo's own "not-once by the time a second call site wants it" reuse threshold (`frontend/CLAUDE.md`) for a mid-task extraction; a third call site should prompt a `useCopyToClipboard` hook.
- **No new `ai_agent.read` permission code** — the list route piggybacks on `ai_agent.create`, meaning any role that can issue a key can also see every other agent's metadata (never the raw key) in the org. Acceptable for this pass's minimal-RBAC-now scope; a future story wanting finer-grained separation needs its own permission code + RBAC seed migration.
- **Client-connection snippets can drift from the real clients' own config format over time** (Claude Code/Codex/Cursor are all still evolving their own MCP config surfaces) — this screen's snippets are a point-in-time capture, not a live-fetched reference; revisit if a client changes its config shape and a user reports a broken snippet.

### Amendment (2026-09-13, CTO manual-verification pass — same branch, unmerged)

Decision §5's `acting_on_behalf_of_user_id` picker originally listed every active org member unconditionally, gated only on `ai_agent.create` (this screen's own stated minimum). Manual click-through found this over-broad: a member holding only `ai_agent.create` (not `org_membership.read`, a separate RBAC-2 permission) could pick *any* active member to hold accountable — a privilege escalation of sorts, since accountability-assignment for someone else arguably needs the same "can see/manage other members" bar `org_membership.read` already gates.

**Fixed**: `GET /orgs/{org_id}/members` is now fetched as a **best-effort** call, independent of the panel's hard requirements (`listAgents` + `GET /auth/me`). If it succeeds, the picker renders as before, now defaulting to the logged-in user rather than blank. If it 403s, that's read as "not an org-membership admin" — the picker is replaced by a disabled, read-only "You (email)" display, and every key is issued on behalf of the logged-in user, resolved via the already-existing `GET /auth/me` route (no new backend route). No permission code — new or reused — needed to change; this is a purely frontend fix using a signal (`org_membership.read` via the member-list call's own success/failure) already available.

This also fixed a second, real bug the same investigation surfaced: requiring `listMembers` to succeed via a single `Promise.all` meant a member holding only `ai_agent.create` couldn't issue a key for *themselves* either — the member-list dependency was accidentally a hard blocker for the screen's own stated minimum permission, not just for the picker specifically.

TC-MCP-015 (below) covers the non-admin fallback; TC-MCP-014 (the original full-flow case) is unaffected — the seeded human in that flow already holds `org_membership.read`.

## Alternatives considered

- **A new `ai_agent.read` permission code, properly separated from `ai_agent.create`.** Rejected for this pass — adds an Alembic data migration + RBAC seed-bundle update for a persona (MCP-1..3's own "Could," not "Must," priority) where the finer separation has no concrete demand yet; easy to add later without breaking the route's existing shape.
- **A `scope` prop on the shared screen instead of resolving mode via `useResolvedOrgId()`.** Rejected — the hook already answers this exact question for the same two route shapes (`AppSidebar`), and a prop would just be a second, hand-maintained source of the same fact, risking the two drifting apart the way `frontend/CLAUDE.md`'s reuse-gap notes already warn against for a different kind of duplication.
- **A dedicated "Agents" top-level admin entity (generic-admin CRUD surface) instead of a bespoke panel on this page.** Rejected — `AIAgent` has no natural fit in the generic factory (no direct `org_id` column, transitive-only tenancy resolution, a create flow with a one-time-secret response the generic form/table pattern doesn't support), and the key-management UX (issue-then-copy-once, revoke) is materially different from a plain CRUD list/edit/delete screen.
