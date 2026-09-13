# UI Design Document — DASH-3: `Dashboard` becomes an org list + chooser

**Date:** 2026-09-13
**Related:** [ADR-0063](../adr/0063-dash-3-dashboard-org-list-and-chooser.md), [DASH-1 UI Design Document](2026-09-07-dash-1-root-redirect-dashboard-ui-design.md) (the placeholder this document replaces), [SHELL-6 UI Design Document](2026-09-07-shell-6-org-switcher-ui-design.md) (`GET /auth/me/orgs`, reused unchanged)

**This document is about `/dashboard` (`Dashboard`) only — not `OrgHome` (`/orgs/:orgId`), which is a separate screen also labeled "Dashboard" in its own UI (ADR-0039). That naming overlap is unaffected by this pass**, except that `/dashboard`'s own 2+-org heading text below is deliberately "Select an organization," not the literal word "Dashboard" — an incidental softening, not a fix (see ADR-0063 Consequences).

## 1. Scope

Replace `Dashboard`'s empty placeholder body (DASH-1) with real content: fetch the caller's active org memberships and either auto-advance (1 org), let them choose (2+ orgs), or offer to create one (0 orgs). Retire `/orgs/pick`/`OrgPicker.tsx` — this screen now owns that job.

## 2. Data

On mount: `GET /auth/me/orgs` (unchanged, [ADR-0036](../adr/0036-shell-6-organization-switcher-header-dropdown.md)) → `{orgs: [{id, name, slug}]}`. Fetched fresh every time — never read from `AuthContext.orgs` (which is stale after any reload, the AUTH-2 gap NFR-35 already documents).

## 3. States

### 3.1 Loading

```
┌────────────────────────────────────────┐
│                                          │
│              [ spinner ]                │
│                                          │
└────────────────────────────────────────┘
```

Same spinner convention as every other in-flight fetch in this app (`role="status"`).

### 3.2 Exactly 1 org

No render at all — the fetch's `then` immediately calls `navigate("/orgs/{id}", {replace: true})`. A user should never see this screen's content for a single-org account; at most the loading spinner flashes briefly.

### 3.3 0 orgs

```
┌────────────────────────────────────────┐
│  No organizations yet                   │
│  You don't belong to an organization    │
│  yet.                                   │
│                                          │
│  [ Create organization ]                │
└────────────────────────────────────────┘
```

- Heading avoids the literal word "Dashboard," consistent with softening the naming overlap.
- "Create organization" routes to the existing `POST /orgs` create flow (no new backend surface — reuses whatever form/route org creation already uses elsewhere in the app).

### 3.4 2+ orgs

```
┌────────────────────────────────────────┐
│  Select an organization                 │
│                                          │
│  ┌──────────────┐  ┌──────────────┐    │
│  │ Acme Corp     │  │ Beta Testing │    │
│  └──────────────┘  └──────────────┘    │
│                                          │
│  [ + Create organization ]              │
└────────────────────────────────────────┘
```

- Heading: "Select an organization."
- One card per org (name; org id/slug not shown to the end user). Click → `navigate("/orgs/{id}")`.
- A "Create organization" affordance stays visible here too (same posture `OrgPicker` already had — pick or create together), not just in the 0-org state.

## 4. Retirement of `/orgs/pick`/`OrgPicker.tsx`

- `App.tsx`'s `/orgs/pick` route and its `OrgPicker` import are removed.
- `Login.tsx`/`Signup.tsx`/accept-invite's post-auth redirect effect no longer branches on `orgContext`/org count — it always `navigate("/dashboard")`. `Dashboard` (this document) owns 100% of the org-count branching from here on.

## 5. Accessibility

- Empty/0-org state: heading is a real `<h1>`/`<h2>`, not styled text on a `<div>`.
- Org cards are real `<button>`s (or an anchor-styled-as-card with a real `href`), not `<div onClick>` — keyboard/screen-reader reachable, same posture root `CLAUDE.md`'s "hand-written markup owns its own accessible semantics" rule already requires everywhere else.
- Loading spinner keeps `role="status"`.

## 6. Open questions resolved (see ADR-0063 for the full reasoning)

1. Single-org auto-redirect vs. always-show-list: **auto-redirect**, confirmed.
2. Consolidate `/orgs/pick` into `/dashboard`: **yes**, confirmed.
3. 0-org empty state gets a create-org CTA: **yes**, confirmed.
4. `/dashboard` stays global (not `/orgs/:orgId/dashboard`): **yes**, confirmed.
5. Heading text: **"Select an organization"** (2+-org state), confirmed.
