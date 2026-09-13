# UI Design Document — MCP-4: MCP Integration screen

**Date:** 2026-09-13
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [ADR-0063](../adr/0063-mcp-integration-screen.md), [ADR-0033](../adr/0033-mcp-server-architecture.md) (the MCP server this screen documents), [ADR-0015](../adr/0015-ai-agent-credential-mechanics.md) (AIAgent credential mechanics — `create`/`revoke` reused), [ADR-0050](../adr/0050-shell-9-project-scope-nav-context-resolution.md) (`useResolvedOrgId()`), [Story MCP-4](../user-stories/2026-09-03-ai-agent-mcp-stories.md)

## 1. Scope

One new component, `frontend/src/pages/workflows/McpIntegration/McpIntegration.tsx`, mounted at two routes:

| Route | Mode | Content |
|---|---|---|
| `/orgs/:orgId/mcp` | org | Explainer + connect-a-client docs + live key-management panel |
| `/projects/:projectId/mcp` | project | Explainer + connect-a-client docs + a link back to the org-scoped route (no key management — agents are org-scoped) |

Mode is resolved internally via `useResolvedOrgId()` — **no `scope` prop**, same reasoning `AppSidebar`'s own org/project split already established (ADR-0050). New backend route: `GET /orgs/{org_id}/agents` (ADR-0063), consumed only by this screen's key-management panel.

## 2. Layout

```
┌────────────────────────────────────────────────────────┐
│  MCP Integration                                        │  <h1>
├────────────────────────────────────────────────────────┤
│  ┌ Card: What is MCP? ─────────────────────────────┐    │
│  │  explainer paragraph + server URL/transport/auth │    │
│  └────────────────────────────────────────────────┘    │
│  ┌ Card: Connect a client ─────────────────────────┐    │
│  │  Claude Code    <pre> snippet </pre>              │    │
│  │  Codex CLI      <pre> snippet </pre>              │    │
│  │  Cursor         <pre> snippet </pre>              │    │
│  │  Any other MCP client   (prose, no snippet)       │    │
│  └────────────────────────────────────────────────┘    │
│  ┌ Card: API keys (org mode only) ──────────────────┐   │
│  │  [issue-key form: name | model | acting-on-      │   │
│  │   behalf-of select | Issue key]                   │   │
│  │  [raw key shown once, copy-once alert]            │   │
│  │  table: Name | Model | Prefix | On behalf of |    │   │
│  │         Issued | Last used | Status | Actions      │   │
│  └────────────────────────────────────────────────┘   │
│  (project mode: a single card, "manage from the org     │
│   page" + link, instead of the API-keys card)            │
└────────────────────────────────────────────────────────┘
```

Single-column, `container-fluid` + `col-12 col-lg-9` centered layout — same shape as `OrgMembers.tsx` (the closest existing bespoke org-scoped screen), not the two-column admin-CRUD layout.

## 3. Client-connection snippets (verified, not guessed)

Each client's config syntax was confirmed via a live web search at write time (not remembered/assumed), per ADR-0063's Context:

- **Claude Code**: `claude mcp add --transport http testnexa <url> --header "Authorization: Bearer <key>"`, plus the `.mcp.json` equivalent (`{"mcpServers":{"testnexa":{"type":"http","url":...,"headers":{...}}}}`).
- **Codex CLI**: `~/.codex/config.toml`'s `[mcp_servers.testnexa]` + `url` + `bearer_token_env_var` (token supplied via an env var at launch, not inline in the file).
- **Cursor**: `.cursor/mcp.json`, same JSON shape as Claude Code's (`url` + `headers`, no `type` key needed).
- **Generic**: prose only — "any MCP-HTTP client, point it at the URL, send the bearer header."

`<url>` is `${window.location.origin}/mcp`, computed at render time — never a `<your-host>` placeholder, so every snippet is copy-pasteable as shown. The placeholder API key text (`tnx_agent_xxxxxxxx_your-api-key`) is replaced by a real one once the user issues a key further down the same page — no cross-reference/auto-fill between the two cards, since the snippets are meant to be copied once and reused across future keys too.

## 4. API-keys panel (org mode only)

- **Issue-key form**: `agent_name` (required, `FormField`), `model_or_provider` (optional, `FormField`), `acting_on_behalf_of_user_id` (required, `Select` populated from `GET /orgs/{org_id}/members`'s **active** members only — an org-wide accountability link per ADR-0015, not an approver). React Hook Form + Zod, same convention as every other form in this codebase.
- **Raw-key display**: on successful issue, a `div.alert-success` shows the raw key in a readonly `<input>` + Copy button (`navigator.clipboard` with an `execCommand` fallback for non-secure-context/LAN-IP access) — same one-time-secret UX `OrgMembers.tsx`'s invite-link flow already established. Never shown again after this point; the table row that appears afterward shows only `key_prefix`.
- **Table**: one row per issued agent (active + revoked, not filtered), sourced from the new `GET /orgs/{org_id}/agents` list route. Revoked rows render with `text-body-secondary` + a "Revoked" badge (`bg-secondary`) and no Revoke button; active rows get a `bg-success` "Active" badge + a `Revoke` button (`btn-outline-danger`, same styling convention `OrgMembers.tsx`'s own action buttons use).
- **Loading/error states**: same shape as `OrgMembers.tsx` — a `spinner-border` + "Loading..." text while the initial `Promise.all([listAgents, listMembers])` is in flight, an `Alert` on failure (e.g. a permission-denied response if the seeded/real role is missing `org_membership.read` — a real gap found and fixed during this story's own e2e pass, see ADR-0063).

## 5. Open items resolved during implementation

- **Testid on the panel root**: `Card` (the shared atom) doesn't forward arbitrary props/`data-testid` — the panel wraps its `Card` in a plain `<div data-testid="mcp-agent-key-management">` rather than extending the shared atom's prop surface for one caller's test-anchor need.
- **Seed-fixture permission set for the e2e spec**: the live UI flow needs `ai_agent.create` **and** `ai_agent.update` **and** `org_membership.read` together (issue + revoke + list-members-for-the-dropdown) — a fixture granting only `ai_agent.create` (sufficient for the backend integration tests, which don't exercise revoke or the members list through this screen) 403s partway through the UI flow. Documented here so a future e2e spec touching this screen copies the full 3-permission fixture, not the narrower backend-test one.
- **Admin-gating for the picker (ADR-0063's `### Amendment`, same-day CTO manual-verification pass)**: `GET /orgs/{org_id}/members` is fetched independently of `listAgents`/`GET /auth/me` (both hard requirements) — its own success/failure is the signal this screen uses in place of a generic "is org_admin" flag (which nothing in this app's RBAC model exposes to the frontend). Success → picker, defaulting to self. 403 → no picker, a disabled "You (email)" display, `acting_on_behalf_of_user_id` fixed to the logged-in user. This also fixed the original version's real bug: bundling the member-list fetch into the same `Promise.all` as `listAgents` meant a member with only `ai_agent.create` (this screen's own stated minimum) couldn't use the panel at all.

## 6. Out of scope (explicit)

A generic-admin CRUD surface for `AIAgent` (rejected in ADR-0063 — no natural fit: no direct `org_id` column, one-time-secret create response); a new `ai_agent.read` permission code (reuses `ai_agent.create`, ADR-0063); per-project credentials (agents are org-scoped only); a shared `useCopyToClipboard` hook (the copy-to-clipboard helper is duplicated from `OrgMembers.tsx` this pass — two occurrences doesn't yet cross this repo's own reuse threshold, `frontend/CLAUDE.md`).
