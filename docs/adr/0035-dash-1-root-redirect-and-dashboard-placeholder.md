# ADR-0035: DASH-1 root route becomes a pure auth-state redirect; new empty `Dashboard` placeholder replaces the public landing page

**Date:** 2026-09-07
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0024](0024-public-landing-page.md) (superseded by this ADR), [ADR-0003](0003-auth-token-strategy.md) (auth/token strategy — `AuthContext`'s `accessToken`/`isInitializing` state this ADR reuses), [ADR-0020](0020-admin-shell-full-template-parity.md) (dashboard stat-widget precedent, `OrgHome`), [DASH-1 user story](../user-stories/2026-09-07-dashboard-root-redirect-stories.md)

## Context

ADR-0024 (LANDING-1) put a public marketing/pitch page at `/` for logged-out visitors, redirecting only already-authenticated visitors off it. CTO direction reverses this: `/` should never show marketing content — a logged-out visitor goes straight to `/login`, a logged-in visitor goes straight to a dashboard.

Two things surfaced during scoping that needed a decision before implementation:

1. **No `Dashboard` screen exists.** The closest thing, `OrgHome` (`/orgs/:orgId`), is org-scoped and already reachable via `Login.tsx`'s own post-login `orgContext`/`orgs` redirect. CTO direction: build a new, separate, currently-empty `Dashboard` page rather than repointing `/` at `OrgHome` — content is deferred to a future story.
2. **A known AUTH-2 gap** (`AuthContext.tsx`'s own docstring): the boot-time silent refresh restores `accessToken` from the refresh cookie but never restores `orgContext`/`orgs` (no endpoint returns org membership on refresh). ADR-0024's redirect logic branches on `orgContext`, so a user who reloads `/` with a valid session cookie but no fresh `orgContext` fell through to the landing page instead of anywhere useful — the literal bug this story was reported against.

## Decision

- **`LandingPage.tsx` is deleted outright**, not relocated — same posture ADR-0024 itself took toward `ScaffoldVerificationPage`. No public marketing page exists anywhere in this scaffold as of this ADR.
- **`/` becomes a pure guard, not a screen**: while `AuthContext`'s `isInitializing` is `true` (boot refresh in flight), render a loading spinner — same pattern `ProtectedRoute` already uses, needed for the same race-avoidance reason. Once settled: no `accessToken` → `<Navigate to="/login">`; `accessToken` present → `<Navigate to="/dashboard">`.
- **This guard checks `accessToken` only, never `orgContext`/`orgs`.** This is the deliberate fix for the AUTH-2 gap above, not a workaround for it: because the new `Dashboard` page (below) has no org-scoped content yet, routing off `/` never needs to resolve which org the user belongs to, so the gap simply doesn't reach this decision point anymore. `Login.tsx`'s own separate post-login `orgContext`/`orgs` redirect (to `/orgs/{id}` or `/orgs/pick`) is untouched — that flow still runs immediately after an explicit login/signup/accept-invite, independent of this root guard.
- **New `Dashboard` page** (`frontend/src/pages/workflows/`) at a new route `/dashboard`, wrapped in the existing `ProtectedRoute` (so it gets `AppShell` — sidebar/navbar — for free, and so direct navigation to `/dashboard` while logged out redirects to `/login` via the same mechanism every other protected route already uses, not a second bespoke guard). Content is an empty CoreUI shell placeholder — no data fetch, no stat widgets, no `apiFetch` call of any kind. Filling it in is explicitly out of scope for this ADR/story.
- **`GET /api/health` and `ScaffoldVerificationPage`'s deletion (ADR-0024) are unaffected** — this ADR only changes what `/` in the SPA router resolves to.

## Consequences

**Positive:** Fixes the reported bug (reload-while-logged-in landing on a page that looked logged-out) as a side effect of a simpler design, not a patch — the root guard no longer depends on `orgContext`, which was the actual source of the flakiness. Zero backend/schema/API surface. Reuses `ProtectedRoute` and `isInitializing` verbatim rather than introducing a third redirect implementation alongside `Login.tsx`'s and the old `LandingPage.tsx`'s.

**Negative / accepted trade-offs:**

- **No public marketing/pitch page exists anywhere in the product now.** Accepted per explicit CTO direction; if a future story wants one, it needs its own route (e.g. `/welcome`) and its own ADR — reintroducing one at `/` would conflict with this ADR's decision.
- **`Dashboard` ships empty.** A logged-in user landing on `/` sees a page with no content beyond the shell chrome. Accepted as an explicit, temporary placeholder — the alternative (routing `/` straight to `OrgHome`) was considered and rejected below.
- **`Dashboard` is not org-scoped.** Because it's empty, this costs nothing today, but the first story that gives it real content will need to decide whether it becomes org-scoped (`/orgs/:orgId/dashboard`, matching `OrgHome`'s own convention) or stays a single global route — an open question for that future story, not resolved here.

## Alternatives considered

- **Route `/` straight to `OrgHome` (`/orgs/{orgs[0].id}`), reusing it as "the dashboard."** Rejected per explicit CTO direction — a new, separate `Dashboard` page was requested rather than repointing an existing org-scoped screen. Also would have kept the `orgContext`-resolution dependency this ADR specifically removes from the root guard.
- **Keep `LandingPage.tsx` reachable at a different path (e.g. `/welcome`) instead of deleting it.** Rejected for this pass — no requirement asks for a marketing page to still exist anywhere; deleting outright matches ADR-0024's own precedent for handling a page whose job is done, and avoids an orphaned, unlinked route.
- **Fix the AUTH-2 `orgContext` gap directly** (extend boot refresh or add an endpoint to resolve org membership on reload), keeping `/` routed to `OrgHome`/`orgs/pick` via the existing `orgContext` branch. Rejected for this pass: it requires backend work with no story asking for it yet, where the empty-`Dashboard` design achieves the same reload-correctness outcome with zero backend touch. Revisit if/when `Dashboard` itself needs org-scoped content and the gap resurfaces there.
