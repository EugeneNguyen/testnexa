# ADR-0063: DASH-3 — `/dashboard` becomes an org list + chooser, single-org auto-redirect, `/orgs/pick` retired

**Date:** 2026-09-13
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0035](0035-dash-1-root-redirect-and-dashboard-placeholder.md) (DASH-1 — the empty `/dashboard` placeholder this ADR resolves; that ADR's own text explicitly deferred "org-scoped or global" to a future story), [ADR-0039](0039-dash-2-org-home-dashboard-relabel-and-project-table.md)/[ADR-0047](0047-proj-4-projects-page-sidebar-entry.md) (`OrgHome` labeled "Dashboard" too — the naming overlap this ADR does NOT resolve), [ADR-0036](0036-shell-6-organization-switcher-header-dropdown.md) (`GET /auth/me/orgs`, the route this ADR reuses unchanged), [ADR-0007](0007-real-multi-tenancy.md) (multi-tenancy — every screen still resolves through an explicit `org_id`)

## Context

`/dashboard` has been an intentionally empty placeholder since DASH-1 (2026-09-07) — no data fetch, no org concept at all. ADR-0035's own Consequences flagged this explicitly as an open question for whoever gave it real content: "the first story that gives it real content will need to decide whether it becomes org-scoped... or stays a single global route."

Separately, this codebase already has two independent, overlapping "list the user's orgs, let them pick one" mechanisms that evolved without seeing each other:

1. `OrgPicker.tsx` (`/orgs/pick`) — a full-screen picker shown only immediately post-login/signup/accept-invite when `AuthContext.orgContext === "picker"` (2+ active orgs). Reads `orgs` from `AuthContext`, populated once at login time and never refreshed — stale on any later page reload (the standing AUTH-2 gap NFR-35 already documents).
2. `AppHeader`'s org-switcher dropdown (SHELL-6/ADR-0036) — a lazy, uncached `GET /auth/me/orgs` fetch on every open, always rendered as global chrome regardless of route.

A user landing on `/dashboard` today (via `/`'s `accessToken`-only redirect, e.g. a bookmark or a reload) sees nothing useful and has no path forward except the header dropdown.

## Decision

1. **`/dashboard` stays a global route** (not `/orgs/:orgId/dashboard`) — no org is chosen yet at the point a user reaches it, so it cannot itself be org-scoped. This resolves ADR-0035's deferred question in favor of "stays global."
2. **`Dashboard.tsx` fetches `GET /auth/me/orgs` fresh on every mount** — no backend change (route already exists, already membership-filtered to `status = active`, [ADR-0036](0036-shell-6-organization-switcher-header-dropdown.md)) — and never reads `AuthContext.orgs`, specifically so it survives a reload the way `AuthContext.orgs` cannot (AUTH-2's known gap).
3. **Branches on the returned count:**
   - **0 orgs** → empty-state message + a "Create organization" call-to-action (routes to the existing `POST /orgs` create flow — no new backend surface).
   - **Exactly 1 org** → immediately `navigate()`s to `/orgs/{id}`, no intermediate list, no click required, no flash of Dashboard content.
   - **2+ orgs** → renders a card list under the heading "Select an organization"; clicking a card navigates to `/orgs/{id}`.
4. **`/orgs/pick` and `OrgPicker.tsx` are retired outright.** Post-login/signup/accept-invite redirect logic is simplified to always target `/dashboard` — `Dashboard` itself now owns 100% of the org-count branching that used to be split across `Login.tsx`'s own redirect effect and the separate `OrgPicker` screen. One source of truth for "list orgs, let the user pick," not two.
5. **Create-organization affordance also stays reachable from the 2+-org list state** (not just the 0-org empty state) — same posture `OrgPicker` already had (pick-or-create together), reusing the existing create-org route/form, no new backend work.

## Consequences

**Positive:** Closes ADR-0035's deferred question. Removes the duplicate-maintenance risk of two independently-evolving "list/pick an org" screens. Fixes a real latent bug class: `OrgPicker`'s `AuthContext.orgs`-sourced list would render stale/empty data on any reload landing on `/orgs/pick`, which `Dashboard`'s fresh fetch does not have. Frictionless single-org UX — the common case (most orgs today have exactly one member org) never sees an extra click.

**Negative / accepted trade-offs:**

- **The `/dashboard` ↔ `OrgHome` naming overlap (ADR-0039/NFR-49) is NOT resolved by this ADR.** `OrgHome` (`/orgs/:orgId`) still displays "Dashboard" as its own heading. This pass does incidentally soften the collision for the 2+-org path — `/dashboard`'s own on-screen heading is now "Select an organization," not the literal word "Dashboard" — but the 0-org empty state and the route's own identity are still named `/dashboard`, and a single-org user never sees any heading at all (instant redirect). Full consolidation remains explicitly out of scope, same as ADR-0039 originally deferred it.
- **Retiring `/orgs/pick` breaks any existing test fixture that used it as a stand-in "no `:orgId` in the route" example** (TC-SHELL-001/005/008/009 used it exactly this way, for reasons unrelated to org-picking — sidebar/breadcrumb/footer behavior with no org selected). Those rows are corrected in this same pass to reference `/dashboard` instead, which still satisfies the same "no `orgId` route param" precondition.
- **No backend/database change.** `GET /auth/me/orgs` already exists, already filters to active memberships, already returns the exact shape needed (`{orgs: [{id, name, slug}]}`). This is a pure frontend consolidation.
- **The full org list is still fetched in one call, unpaginated** — acceptable at expected per-user org-membership counts (the same posture `AppHeader`'s own switcher already takes); revisit only if that assumption stops holding.

## Alternatives considered

- **Keep `/orgs/pick` as a separate screen, have `/dashboard` redirect into it for 2+ orgs.** Rejected — reintroduces the exact duplicate-maintenance problem this ADR exists to close, and makes `/dashboard` a pure redirector with no value of its own.
- **Make `/dashboard` org-scoped (`/orgs/:orgId/dashboard`).** Rejected — no org is selected yet at the point a user reaches this route; an org-scoped path needs an `:orgId` that doesn't exist yet for a user who hasn't chosen one.
- **Always show the org list, even for exactly 1 org (no auto-redirect).** Rejected per explicit confirmation — an extra required click for the common single-org case is pure friction with no offsetting benefit.
