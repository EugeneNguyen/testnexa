# UI Design Document — DASH-1: Root redirect + empty `Dashboard` placeholder

**Date:** 2026-09-07
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [ADR-0035](../adr/0035-dash-1-root-redirect-and-dashboard-placeholder.md), [DASH-1 user story](../user-stories/2026-09-07-dashboard-root-redirect-stories.md), [ADR-0024](../adr/0024-public-landing-page.md) (superseded), [ADR-0012](../adr/0012-coreui-design-system.md) (CoreUI design system)

## 1. Scope

Two things, both frontend-only:

1. `/` stops being a screen and becomes a redirect guard.
2. A new, currently-empty `Dashboard` screen at `/dashboard`.

`LandingPage.tsx` and its content are deleted, not reused or relocated.

## 2. `/` root guard

Not a visible "page" — no CoreUI card/layout of its own. Three states, evaluated in this order:

| `AuthContext` state | Renders |
|---|---|
| `isInitializing === true` | `CSpinner` centered full-viewport — identical markup to `ProtectedRoute.tsx`'s own spinner state, reused for visual consistency (not copy-pasted into a second implementation if a shared component already exists for it). |
| `isInitializing === false`, `accessToken === null` | `<Navigate to="/login" replace>` |
| `isInitializing === false`, `accessToken` present | `<Navigate to="/dashboard" replace>` |

No branch reads `orgContext`/`orgs` — this is the deliberate fix in ADR-0035, not an oversight to fill in later.

## 3. `Dashboard` screen (`/dashboard`)

Route: `/dashboard`, wrapped in `ProtectedRoute` (so it renders inside `AppShell` — sidebar + navbar — like every other protected screen, and so direct navigation while logged out redirects to `/login` via the existing mechanism, no new guard).

Content, this pass only:

```
┌─────────────────────────────────────────┐
│  Dashboard                               │  <- CCard header or page heading
├─────────────────────────────────────────┤
│                                           │
│   (empty — no widgets, no data, no       │
│    API call)                             │
│                                           │
└─────────────────────────────────────────┘
```

- ~~CoreUI-only (`CCard`/`CCardBody`/`CContainer`~~ **revised 2026-09-08, [ADR-0042](../adr/0042-adminlte-design-system.md): raw AdminLTE/Bootstrap markup — `div.card`/`div.card-body`/`div.container-fluid`**), matching every other bespoke screen's shell pattern.
- A single heading ("Dashboard") and, optionally, one line of placeholder copy (e.g. "Nothing here yet.") — no features grid, no stat tiles, no chart, nothing borrowed from `OrgHome`'s widget pattern. This is intentionally barer than LANDING-1's old pitch content ever was.
- **No `apiFetch`/`useQuery` call of any kind.** This is a hard requirement (NFR-47), not a temporary stub that happens not to call anything yet — a future story adding content here needs its own ADR/UI-Design update if it introduces org-scoping or a data source.
- Not org-scoped (`/dashboard`, not `/orgs/:orgId/dashboard`) — deferred decision, see ADR-0035 Consequences.

## 4. Non-goals (explicit)

- No marketing/pitch content anywhere in this pass — `LandingPage`'s old copy is not ported into `Dashboard` or anywhere else.
- No dashboard widgets, counts, or charts — that's real content, explicitly out of this story's scope.
- No change to `Login.tsx`/`Signup.tsx`/`AcceptInvite.tsx`'s own post-auth `orgContext`/`orgs` redirect logic — untouched, still targets `/orgs/{id}` or `/orgs/pick`.
