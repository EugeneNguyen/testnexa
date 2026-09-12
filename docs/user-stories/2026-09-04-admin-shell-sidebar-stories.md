# User Stories — CoreUI Admin Shell (Sidebar + Navbar Template)

**Date:** 2026-09-04
**Feature area:** Authenticated-app layout shell, on top of ~~CoreUI (ADR-0012)~~ **AdminLTE v4 as of 2026-09-08 ([ADR-0042](../adr/0042-adminlte-design-system.md))**

> **2026-09-08 — design system changed, [ADR-0042](../adr/0042-adminlte-design-system.md).** The *user needs* every story below expresses (a persistent shell, a way back from any screen, one nav-item list, a working narrow-viewport toggle) are unchanged and still binding — this note does not rewrite them. Two mechanism claims in the AC text are now stale and must not be read literally: **SHELL-1 AC4's "per CoreUI's own responsive sidebar behavior (no custom responsive logic hand-built)" is deliberately reversed** — AdminLTE's plugin JS is not vendored, so the collapse/toggle *is* hand-built in React (`sidebar-collapse`/`sidebar-open` on `<body>`, `matchMedia("(max-width: 991.98px)")` — AdminLTE's own constant, not an invented one), see NFR-24 as revised. And **SHELL-5's dark sidebar is no longer delivered**: the `sidebar-dark-*` skin family does not exist in AdminLTE v4. The user-observable AC ("the sidebar collapses and toggles on a narrow viewport") still holds and is still verified by TC-SHELL-004.
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

**Scope note (2026-09-04, [ADR-0019](../adr/0019-admin-shell-full-template-parity.md)):** this story's own scope boundary above (shell-only, no extras) is superseded — direction is now full parity with CoreUI's free admin template as the site's structural base, not just the sidebar/navbar piece. Breadcrumb, footer, dashboard widgets, dark/light mode toggle, and a set of UI-element reference pages (Colors/Typography/Icons) are added under ADR-0019. The UI-element reference pages are template scaffolding only — no FR/NFR/business case backs them; don't read them as product scope.

---

## Story SHELL-6: Organization switcher in the header

**As** Priya (QA Lead who belongs to more than one Organization),
**I want** a dropdown in the top header that lists every org I belong to and lets me switch into any of them,
**so that** I'm not stuck re-navigating through `/orgs/pick` (which only ever shows right after login, and goes blank on a reload) or hand-editing the `/orgs/:orgId` URL every time I need to move between orgs mid-session.

**Acceptance criteria:**

- Given an authenticated user is on any `ProtectedRoute` screen, when the page renders, then the header (`AppHeader`) shows an org-switcher icon/dropdown, visible unconditionally — including for an account with exactly one Organization.
- Given the user opens the dropdown, when it renders its contents, then it fetches the caller's org list on that open (`GET /auth/me/orgs`, [ADR-0036](../adr/0036-shell-6-organization-switcher-header-dropdown.md)) — not a value cached at login time — so the list is correct even after a page reload.
- Given the dropdown is open and the user is currently on a route under `/orgs/:orgId`, when the list renders, then the org matching the current `:orgId` is visually indicated as the active one.
- Given the user clicks a different org in the list, when the navigation completes, then they land on that org's root, `/orgs/{id}` — never an attempt to preserve whatever nested sub-route (members, admin, a project) they were previously on, since a nested resource ID has no meaning in a different org.
- Given the user's target org grants them a different (or no) role compared to their current org, when they land on the new org's screens, then each screen's own existing server-side permission check governs what's visible/actionable there — no separate client-side permission cache to go stale.
- Given the dropdown is open, it contains no "create new organization" action — org creation stays exclusively on `/orgs/pick`'s existing modal.
- Given a user with zero Organizations somehow reaches an authenticated screen (should not happen post-login, direct-nav edge case only), when the dropdown opens, then it renders an empty state, not an error or crash.

**Traceability:** [FR-SHELL-6](../requirements/2026-09-03-project-scaffold-requirements.md), [FR-AUTH-5](../requirements/2026-09-03-project-scaffold-requirements.md), [ADR-0036](../adr/0036-shell-6-organization-switcher-header-dropdown.md), [UI Design Document](../ui-design/2026-09-07-shell-6-org-switcher-ui-design.md). Closes, for this one surface only, the AUTH-2 gap [ADR-0035](../adr/0035-dash-1-root-redirect-and-dashboard-placeholder.md) explicitly deferred ("revisit if/when a future org-scoped feature needs it") — `AuthContext`'s login-time-only `orgs`/`orgContext` fields are otherwise unchanged.

---

## Story SHELL-7: Mini sidebar + org-scoped CRUD nav restructure

**As** Priya (QA Lead / org admin who spends most of her session inside one org, working through its Roles/Permissions/catalog admin screens),
**I want** the sidebar to (a) collapse to a compact, icon-only rail I can still recognize at a glance, and (b) group the org's CRUD admin screens into named categories instead of one flat list,
**so that** I keep more screen width for my actual work without losing the ability to navigate, and I can find "who can do what" (roles/permissions/assignments) or "org-wide catalogs" (test levels/types/techniques) without scanning an undifferentiated 8-item list every time.

**Acceptance criteria:**

- Given a desktop-width authenticated screen, when the sidebar is collapsed, then it renders as a narrow, icon-only rail (AdminLTE's `sidebar-mini` layout) rather than the pre-existing fully-hidden-label collapsed state — each rail icon still identifies its nav item.
- Given the collapsed rail, when the pointer hovers over it, then it expands to show labels again, and narrows back on pointer-leave — with no change to the underlying collapsed/expanded toggle state (this is a hover-only visual effect, not a click).
- Given a mobile-width viewport, when the sidebar is opened/closed via its existing toggle, then behavior is unchanged from today — `sidebar-mini` has no effect on the off-canvas mobile mechanism.
- Given an authenticated user with an org selected, when they view the sidebar, then the 8 org-scoped CRUD entities render under 3 named groups — Access Control (Roles, Permissions, Role assignments, Org memberships), Catalogs (Test design techniques, Test levels, Test types), Organization (Organizations) — each with its own icon, replacing today's single flat "Admin" group.
- Given the restructured groups, when any of the 8 entities' existing list/create/edit/delete screens are reached through its new group, then behavior (routes, permission gating) is unchanged — this story is a sidebar presentation change only, not a CRUD/backend change.
- Given the sidebar's `Members` item, when it renders, then it also gains an icon (previously icon-less) so no item is left without one under the new icon-only collapsed rail.
- Out of scope, explicitly: the `UI Elements` nav group (ADR-0020 scaffolding) — untouched, not folded into the new groups, not reordered relative to itself.

**Addendum (2026-09-12, [ADR-0058](../adr/0058-project-generic-admin-org-scoped.md)):** the registry gained a 9th org-scoped entity (`projects`) after this story shipped — deliberately excluded from all 3 groups (`ORG_EXCLUDED_ENTITY_KEYS`), since ADR-0047's bespoke `ProjectsPage` is its real nav path. This story's own "8 entities" ACs above are accurate as a historical record of what this story delivered, not a current count — see the Sitemap doc's org-scoped table for the current 9.

**Traceability:** [FR-SHELL-7](../requirements/2026-09-03-project-scaffold-requirements.md), [ADR-0046](../adr/0046-shell-7-sidebar-mini-org-crud-restructure.md), [UI Design Document](../ui-design/2026-09-08-shell-7-sidebar-mini-org-crud-restructure-ui-design.md). Presentation-only change over the existing `orgScopedEntities` registry (ADR-0025) — no new/changed entity, no new API route, no schema change.

---

## Story SHELL-9: Sidebar and breadcrumb work inside a project, not just inside an org

**As** Priya (QA Lead who opens a specific Project to work its Releases, Requirements, Test Plans, and Test Cycles),
**I want** the sidebar and breadcrumb to keep working normally while I'm inside a project — full nav, a real trail, and a click-path back to the Projects list — instead of going blank,
**so that** opening a project doesn't strand me the way `OrgMembers.tsx` once stranded a user with no link back to `OrgHome` (the exact defect SHELL-1 closed for org-scoped screens, now recurring one level deeper for project-scoped ones).

**Acceptance criteria:**

- Given an authenticated user navigates directly to `/projects/:projectId` (e.g. from a bookmark, a shared link, or `ProjectsPage`'s own table), when the page renders, then the sidebar shows the full org-scoped nav — Dashboard, Projects, Members, Access Control, Catalogs, Organization, UI Elements — identical to what renders on `/orgs/:orgId`, not an empty list.
- Given the same is true for every other project-scoped route (`TestPlanDetail`, `TestCycleDetail`, and any `/projects/:projectId/admin/:entity` page), when each renders, then its sidebar is equally fully populated — this is not scoped to `ProjectDetail` alone.
- Given the user is on any project-scoped screen and wants to return to the org's project list, when they click the sidebar's "Projects" item, then they land on `/orgs/:orgId/projects` — the literal "way back to the list" this story exists to provide, via the nav item PROJ-4 already ships, not a new one.
- Given the user is on `/projects/:projectId` (or any of its nested routes), when they inspect the breadcrumb, then it shows a real, clickable trail rooted at "Projects" and naming the current project by its actual name — not the bare, unlinked "Project" placeholder that renders today.
- Given the `:projectId` in the URL doesn't resolve (deleted, foreign-org, or malformed), when the page attempts to render its shell, then the sidebar/breadcrumb degrade to their existing empty/graceful states (same as `/orgs/pick` today) — no crash, no raw ID ever shown as a label.
- Out of scope, explicitly: any change to `useAdminRouteContext`/`useEntityScope` or the project-scoped admin pages' own permission-check plumbing — those already resolve org context correctly for their own purposes; this story only extends the same resolving idea to `AppSidebar`/`AppBreadcrumb`.

**Traceability:** [FR-SHELL-8](../requirements/2026-09-03-project-scaffold-requirements.md), [NFR-55](../requirements/2026-09-03-project-scaffold-requirements.md), [ADR-0050](../adr/0050-shell-9-project-scope-nav-context-resolution.md), [UI Design Document](../ui-design/2026-09-09-shell-9-project-scope-nav-context-ui-design.md). Closes, for project-scoped routes specifically, the same class of dead-end SHELL-1's own story first closed for org-scoped ones — see that story's own "so that" clause above for the precedent.

---

## Story SHELL-10: A project's sidebar is its own entity CRUD, not an org menu with a way out

**As** Priya (QA Lead working inside one specific Project's Requirements/Test Cases/Test Plans across a session),
**I want** the sidebar, once I'm inside a project, to show me that project's own manageable entities — Requirements, Test Cases, Test Conditions, Test Plans, Releases, Executions, Defects, Environments, Risk Items — grouped, not the org's Dashboard/Members/Access-Control menu SHELL-9 put there,
**so that** the sidebar does the same job inside a project that it already does inside an org: surface the things I'm actually here to manage, one click away, instead of a menu for a different job with a link back out.

**Acceptance criteria:**

- Given a user is on any project-scoped route (`ProjectDetail`, `TestPlanDetail`, `TestCycleDetail`, any `/projects/:projectId/admin/:entity` page), when the sidebar renders, then it shows 4 named, individually-iconed groups — Test Design (Requirement/Test Condition/Test Case/Test Suite), Test Planning (Test Plan/Entry-Exit Criteria/Test Cycle/Release), Execution & Defects (Test Execution/Test Log/Defect), Setup (Environment/Risk Item) — not the org nav SHELL-9 previously rendered there.
- Given a group is expanded, when its children render, then each links to that entity's already-shipped `/projects/:projectId/admin/<entity>` route and, when clicked, actually lands on and renders that real screen.
- Given the user wants to leave the project, when they look at the bottom of the sidebar, then they find two links — "Project Overview" (back to this project's own root, absent while already there) and "Back to Projects" (the org's Projects list, PROJ-4's existing item, just relocated) — both real clicks that really navigate.
- Given the org-context fetch (`useResolvedOrgId()`) hasn't resolved yet, or fails (404), when the sidebar renders, then it shows its existing empty-nav state — no partial nav, no group content before the project genuinely resolves.
- Given a user is on an org-scoped route (`/orgs/:orgId`, `/orgs/:orgId/members`, etc.), when the sidebar renders, then it is completely unaffected — the org nav SHELL-7/PROJ-4 already built, unchanged.
- Out of scope, explicitly: `useAdminRouteContext`'s own separate resolution path for the 20 project-admin pages' permission checks (untouched); `ProjectDetail`'s own bespoke Requirements/Releases/Test Suites sections (untouched, still the richer UI for those 3 entities — the sidebar's own links go to the generic-admin screen instead, a deliberate, documented choice per ADR-0051).

**Traceability:** [FR-SHELL-9](../requirements/2026-09-03-project-scaffold-requirements.md), [ADR-0051](../adr/0051-shell-10-project-scope-entity-nav.md). Amends SHELL-9's own sidebar-content decision (ADR-0050 Decision §2) after direct CTO review of the live result — SHELL-9's own org-context-resolution mechanism and breadcrumb work are unaffected, reused as-is.
