# ADR-0018: Admin shell layout — CoreUI sidebar+navbar template

**Date:** 2026-09-04
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0012](0012-coreui-design-system.md) (CoreUI design system — this ADR applies its own template components), [ADR-0009](0009-frontend-stack.md) (frontend stack, unchanged)

## Context

AUTH-3 shipped a minimal `CHeader` (`AppHeader.tsx` — brand + "Log out" only) mounted inside `ProtectedRoute`, with sidebar/breadcrumbs/nav explicitly out of that story's scope. That gap is now a confirmed, directly-observed defect, not a hypothesis: `OrgMembers.tsx` has **zero** link back to `OrgHome.tsx` (grepped for `Link`/`to=`, zero results) — the only way back today is the browser back button or re-typing the URL. The one nav link that exists at all (`OrgHome.tsx:193-195`, a bespoke `CButton as={Link}`) is a one-off, per-page pattern, not a reusable one. [Business case](../business-case/2026-09-04-coreui-admin-shell-sidebar-business-case.md) (GO), [personas](../personas/2026-09-04-admin-shell-navigation-personas.md), and [journey mapping](../user-journeys/2026-09-04-admin-shell-navigation-journeys.md) (Journey 1, step 4 — the FACT-level finding) trace this gap to Priya's real navigation job. Every future FR-ADMIN-2 screen would repeat the same dead-end pattern unless a persistent shell exists before those screens ship.

## Decision

- Adopt CoreUI's own admin-template layout components — `CSidebar`/`CSidebarNav` + `CHeader` — as the persistent shell wrapping every `ProtectedRoute` screen, per [ADR-0012](0012-coreui-design-system.md)'s already-accepted "build from CoreUI's components, don't hand-roll" rationale. Not a bespoke nav.
- `AppSidebar.tsx` (new) owns exactly one nav-item list — org-home, org-members today — the single, obvious place a future story adds its own entry (per-page `CButton as={Link}` link management, `OrgHome.tsx:193-195`'s pattern, is not repeated or extended further).
- Active-route highlighting via React Router's `NavLink` (`end` match on the org-home item, so it doesn't read "active" while on `/members`, a prefix of its own path).
- `AppShell.tsx` (new) composes sidebar + header + page content and owns the sidebar's `visible` state; `AppHeader.tsx` gains a `CHeaderToggler` that flips it. This is CoreUI's own documented template pattern (`visible`/`onVisibleChange` on `CSidebar`, a toggler button in the header) — not hand-built breakpoint/media-query logic. `ProtectedRoute` renders `<AppShell>{children}</AppShell>` in place of AUTH-3's bare `<AppHeader/>{children}`.
- Org-scoped nav items (org-home, org-members) need an `orgId`. On `/orgs/pick` (`OrgPicker`, `ProtectedRoute`-wrapped but no `orgId` route param — no org selected yet), the sidebar still mounts (brand only) but renders an empty nav-item list rather than a disabled/greyed pair — there is nothing yet to link to, and a disabled control implies a temporarily-unavailable action rather than a genuinely absent one.
- Out of scope, per the business case's own scope boundary: nav-item entries for any FR-ADMIN-2 entity screen not yet built (`Project`, `Requirement`, `TestCase`, etc.) — added when their own screens ship, not pre-built; any cross-entity traceability view (a separate future initiative).

## Consequences

**Positive:** closes the one FACT-level dead-end this discovery found (Journey 1, step 4); every future `ProtectedRoute` screen is reachable by adding one nav-item entry, not by a contributor remembering to wire its own way back; consistent with ADR-0012's existing "adopt the template, don't build a new one" stance — no new responsive/collapse logic to maintain.

**Negative / Trade-offs:** the sidebar narrows available content width for the 3 existing screens' own `CContainer` layouts — none currently overflow, but a later screen with a wide table may need its container width revisited; not a blocker now. The nav-item list has no automated test that catches a contributor forgetting to add an entry for a new route (AC5 is a code-review-time contract, not a runtime-enforced one) — see [Test Design](../test-design/2026-09-03-test-design.md) §15/[Test Plan](../test-plan/2026-09-03-master-test-plan.md) risk log.

## Alternatives considered

- **Per-page bespoke back-links** (extend `OrgHome.tsx:193-195`'s pattern to every screen) — rejected: exactly the scattered, easy-to-forget pattern this story exists to replace; doesn't cover screens that don't exist yet.
- **Breadcrumbs only, no persistent sidebar** — rejected: doesn't give Priya a stable, always-visible way back from *any* screen the way a persistent sidebar does; CoreUI's own admin template is a sidebar+navbar shape, not a breadcrumb-only one, and ADR-0012 already committed to that template shape.
- **Custom-built responsive collapse (media queries, own toggle state machine)** — rejected: `CSidebar` already ships this; hand-building it would violate ADR-0012's own "adopt CoreUI's template components" rationale for no articulated benefit.
