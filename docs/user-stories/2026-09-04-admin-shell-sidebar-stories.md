# User Stories — CoreUI Admin Shell (Sidebar + Navbar Template)

**Date:** 2026-09-04
**Feature area:** Authenticated-app layout shell, on top of CoreUI (ADR-0012)
**Context:** [Business case](../business-case/2026-09-04-coreui-admin-shell-sidebar-business-case.md) (GO), [Personas](../personas/2026-09-04-admin-shell-navigation-personas.md) (Priya — primary evidence; Marcus — secondary, scope-bounded), [Journeys](../user-journeys/2026-09-04-admin-shell-navigation-journeys.md) (Journey 1, step 4 — the one FACT-level defect this discovery found)

**Scope note, carried from the business case's GO finding:** one story below, deliberately narrow — adopt CoreUI's existing sidebar+navbar shell and wrap the 3 routes that exist **today**. Per the business case's own scope boundary: **do not** pre-build nav links for FR-ADMIN-2 entity screens that aren't built yet (avoids dead links); nav items get added story-by-story as those screens ship. Inventing a full future nav tree now would outrun the evidence, the same over-reach the sibling atomic-design business case explicitly rejected.

**Not included here (belongs elsewhere, not as a user story):** any actual cross-entity traceability view (Marcus's real Job #4 need) is out of scope — the personas/journeys docs are explicit that a nav shell only makes screens reachable, it doesn't build the links between a requirement, its test cases, and their results. That's a separate future initiative, not part of SHELL-1.

---

## Story SHELL-1: Persistent sidebar + navbar shell for the authenticated app

**As** Priya (QA Lead navigating between org administration and her day-to-day testing work — [Persona 1](../personas/2026-09-04-admin-shell-navigation-personas.md)),
**I want** a persistent sidebar and top navbar wrapping every authenticated screen, with a working way back to org home from any page,
**so that** I never hit a dead end like the one that exists today — `OrgMembers.tsx` has zero link back to `OrgHome`, confirmed by direct inspection ([journey](../user-journeys/2026-09-04-admin-shell-navigation-journeys.md), Journey 1 step 4) — and so that every new screen added under FR-ADMIN-2 going forward is reachable without a developer having to remember to add its own way back each time.

**Acceptance criteria:**

- Given an authenticated user is on any route under `ProtectedRoute` (`/orgs/:orgId`, `/orgs/:orgId/members`, and any route added after this story), when the page renders, then a persistent sidebar (`CSidebar`/`CSidebarNav`) and top navbar (`CHeader`) from CoreUI's own template components wrap the page content — not a bespoke hand-built nav, per ADR-0012's own already-accepted rationale.
- Given the sidebar is rendered, when it lists nav items, then it includes (at minimum) links to org home and org members — the two authenticated screens that exist today — with the current route visually indicated as active.
- Given a user is on `/orgs/:orgId/members`, when they use the sidebar's org-home link, then they land on `/orgs/:orgId` — closing the exact dead-end this discovery found (Journey 1, step 4), verified with a Playwright test that navigates to members and back via the shell, not the browser back button.
- Given the viewport is narrow (mobile/tablet width), when the sidebar is shown, then it collapses/toggles per CoreUI's own responsive sidebar behavior (no custom responsive logic hand-built) — consistent with "adopt the template" scope, not "build a new one."
- Given a new route is added under `ProtectedRoute` in a future story, when a contributor wires it up, then adding its sidebar nav-item entry is the only additional step required to make it reachable from the shell (i.e., the shell's nav-item list is a single, obvious place to extend — not scattered per-page link management like today's one-off `CButton as={Link}` pattern in `OrgHome.tsx:193-195`).
- Out of scope for this story (explicitly, per the business case's scope boundary): nav items/placeholder links for any FR-ADMIN-2 entity screen not yet built (`Project`, `Requirement`, `TestCase`, etc.) — those get added when their own screens ship, not pre-built here; any cross-entity traceability view (Marcus's Job #4) — separate initiative, not this shell.

**Traceability:** implements the [admin-shell business case](../business-case/2026-09-04-coreui-admin-shell-sidebar-business-case.md)'s GO recommendation. No FR/NFR in `docs/requirements/2026-09-03-project-scaffold-requirements.md` currently covers authenticated-app layout — flag for whoever picks this up: add a requirements entry (e.g. an FR under a new "Layout/Navigation" heading) once this is scoped for implementation, consistent with how other ADR-driven changes have propagated across docs in this repo's history (per CLAUDE.md).
