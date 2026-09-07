# User Stories — Dashboard & Root Redirect

**Date:** 2026-09-07
**Feature area:** Dashboard (protected, authenticated landing point) & root-route redirect
**Context:** [Business case](../business-case/2026-09-03-sovereign-ai-testing-business-case.md), [Auth stories](2026-09-03-auth-stories.md), [Landing page stories](2026-09-05-landing-page-stories.md) (superseded by this file's DASH-1), [ADR-0035](../adr/0035-dash-1-root-redirect-and-dashboard-placeholder.md)

---

## Story DASH-1: Root redirect to login or dashboard, replacing the public landing page

**As** any visitor arriving at the deployment's root URL (`/`),
**I want** to be sent straight to the login screen if I have no session, or straight to a dashboard if I do,
**so that** `/` always takes me somewhere actionable instead of showing a public marketing page I have to click through.

**Acceptance criteria:**
- Given a visitor with no valid session (no access token, no restorable refresh session), when they load `/`, then they are redirected to `/login` — no landing/marketing content renders at any point.
- Given an already-authenticated visitor (valid access token), when they load `/`, then they are redirected to `/dashboard`.
- Given the boot-time silent session restore (`AuthContext`'s `isInitializing`) is still in flight, when a visitor loads `/`, then a loading indicator renders and neither redirect fires until it settles — avoids a flash of the wrong destination.
- Given a visitor with a valid session cookie but a page that has just reloaded (so `orgContext`/`orgs` have not yet been re-populated — the known AUTH-2 boot-refresh limitation), when they load `/`, then they still reach `/dashboard`, not `/login` — the root redirect must not depend on `orgContext`/`orgs`.
- Given a visitor with no valid session, when they navigate directly to `/dashboard` (not via `/`), then they are redirected to `/login`, same as any other protected route.
- Given an authenticated visitor on `/dashboard`, when the page renders, then it shows an empty placeholder screen (product shell — sidebar/navbar — with no widgets/data yet) and makes no data-fetching API call.

**Note:** This story supersedes [LANDING-1](2026-09-05-landing-page-stories.md) — the public landing page at `/` is deleted, not kept reachable elsewhere, per [ADR-0035](../adr/0035-dash-1-root-redirect-and-dashboard-placeholder.md). `Dashboard`'s content is explicitly out of scope here; this story only establishes the route, the auth guard, and an empty shell. Filling `Dashboard` with real content (and deciding whether it becomes org-scoped) is a future story's scope.
