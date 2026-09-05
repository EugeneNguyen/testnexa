# ADR-0024: Public landing page replaces root scaffold-verification page

**Date:** 2026-09-05
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0012](0012-coreui-design-system.md) (CoreUI design system), [ADR-0003](0003-auth-token-strategy.md) (auth/token strategy — `AuthContext`'s `orgContext`/`orgs` state this ADR reuses), [LANDING-1 user story](../user-stories/2026-09-05-landing-page-stories.md#story-landing-1-public-landing-page-for-logged-out-visitors)

## Context

The root route (`/`) currently renders `ScaffoldVerificationPage`, a dev-only widget added during initial scaffolding purely to prove frontend↔backend wiring (it calls `GET /api/health` and shows the result). It carries no product content and no path to login — a not-logged-in visitor landing on `/` today sees an internal debug tool, not an entry point.

CTO direction: build a real public landing page at `/` with a link to log in. Three things needed a decision before implementation: (1) what happens to the scaffold-verification content once the route is repurposed, (2) whether an already-authenticated visitor hitting `/` should see the landing page or be redirected, (3) how much marketing depth the initial content should carry.

## Decision

- **New `LandingPage`** (`frontend/src/pages/workflows/`) mounts at `/`, replacing `ScaffoldVerificationPage` in `App.tsx`. CoreUI-only (ADR-0012), same `CCard`/`CContainer` page-shell pattern `Login.tsx`/`Signup.tsx` already use. Content is bare-bones: product name, one-line pitch, a "Log in" primary `CButton`/`Link` to `/login`, a "Sign up" secondary link to `/signup`. No features grid, testimonials, or persona-targeted copy in this pass.
- **`ScaffoldVerificationPage` is deleted outright**, not relocated to e.g. `/scaffold`. Its wiring-proof job is done — no route links to it, it backs no monitoring/ops workflow, and `GET /api/health` itself remains directly reachable (curl, uptime checks) without a dedicated UI. An unlinked debug route left in the router is more likely to bit-rot unnoticed than to ever be used again.
- **An already-authenticated visitor hitting `/` is redirected off the landing page**, not shown it — to `/orgs/{orgs[0].id}` when `orgContext === "auto"`, to `/orgs/pick` when `orgContext === "picker"`. This reuses `Login.tsx`'s existing `useEffect`-driven redirect logic over `AuthContext`'s `orgContext`/`orgs` state verbatim (same two branches, same targets) — not a second, independently-maintained redirect implementation.
- **Public route:** `LandingPage` sits outside `ProtectedRoute` in `App.tsx`, alongside `/login`, `/signup`, and `/invites/:token/accept`. It makes no API call on render — no token is needed to view it, and nothing about its own content depends on backend state.

## Consequences

**Positive:** the root URL finally serves a real, presentable entry point instead of an internal debug tool, at zero backend/API/schema surface (frontend-only change). Reusing `Login.tsx`'s existing redirect logic rather than writing a second implementation means there's exactly one place that ever decides "where does a logged-in user's org context send them," not two to keep in sync.

**Negative / Trade-offs:** the backend↔frontend wiring health-check `ScaffoldVerificationPage` provided no longer has a dedicated UI once it's deleted — accepted, since it was scaffold-phase tooling only, and `GET /api/health` stays directly callable outside the SPA for anyone who still needs to check it. Bare-bones content means the landing page carries no real marketing copy yet; revisit with a dedicated story if/when this needs to serve outbound marketing traffic rather than just an internal auth funnel.

## Alternatives considered

- **Relocate `ScaffoldVerificationPage` to `/scaffold` instead of deleting it** — rejected: nothing links to it today, it's not part of any monitoring/ops workflow, and keeping an orphaned debug route around costs more in silent bit-rot risk than it saves in preserved capability.
- **Render the landing page unconditionally, even for an already-authenticated visitor** — rejected: showing a "log in" pitch to someone already logged in is confusing UX, and `Login.tsx` already solved this exact "where does an authenticated visitor belong" redirect once; reusing it costs nothing extra.
- **Full marketing-depth content (features grid, testimonials, persona-targeted sections) now** — rejected: no business-case/persona research backs specific marketing copy yet; this is scope creep against what's fundamentally an auth-funnel need today, not a marketing-site need.
