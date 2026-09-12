# ADR-0062: Project-mode sidebar's "Overview" item moves to the top of the nav and always renders

**Date:** 2026-09-12
**Status:** Accepted — **Partially supersedes [ADR-0051](0051-shell-10-project-scope-entity-nav.md)'s Decision §3**, which put "Project Overview" at the *bottom* of the project-mode nav, suppressed while already on `/projects/:projectId` itself. Every other decision in ADR-0051 (project-mode nav replacing the org nav, `PROJECT_ENTITY_GROUPS`' 4 groups, the `orgId`-gating fix, org-mode being unaffected) stands unchanged.
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0051](0051-shell-10-project-scope-entity-nav.md) (the ADR this partially supersedes), [ADR-0050](0050-shell-9-project-scope-nav-context-resolution.md) (`useResolvedOrgId()`, `mode`, unaffected)

## Context

ADR-0051 put "Project Overview" (→ `/projects/:projectId`) at the bottom of the project-mode nav, alongside "Back to Projects," and suppressed it entirely while already on that exact route — reasoning it would otherwise be a dead self-link.

Direct product ask (2026-09-12), after live use: (1) rename "Project Overview" to "Overview" and move it to the top of the nav, above the entity groups; (2) a follow-up report that the item disappears entirely when landing directly on a project's own `/projects/:projectId` URL — surprising, and inconsistent with org-mode's own "Dashboard" item, which does not hide itself on `/orgs/:orgId`, it just gets `NavLink`'s active-state styling.

## Decision

1. **"Project Overview" renamed "Overview."**
2. **Moved from `bottomNavItems` (bottom of nav) to `navItems` (top of nav, above the entity groups)** — project mode's own equivalent of org mode's `navItems` slot, which already renders "Dashboard"/"Projects"/"Members" at the top for org-scoped routes.
3. **No longer suppressed on `/projects/:projectId` itself.** The `isOnProjectOverview`/`useMatch` check that hid it is removed entirely — same posture as "Dashboard" in org mode, which relies on `NavLink`'s own `active` class (not conditional rendering) to show "you are here."
4. **Still gated on `orgId`, not just `projectId`** (a gap this ADR closes, not one ADR-0051 had — ADR-0051's own suppression logic happened to mask it): the old code rendered "Project Overview" whenever `mode === "project" && projectId`, with no `orgId` check, unlike `navGroups`/`bottomNavItems` which both required `orgId` too. Confirmed by two Vitest regressions surfacing the instant the suppression was removed (`TC-SHELL-033(a)`/`(b)`, pending/404 states) — "Overview" was rendering alone while the rest of the nav correctly stayed empty. Fixed by adding the same `orgId` gate, preserving ADR-0050 §4's "one fetch's worth of blank sidebar, no partial nav" trade-off for this item too.
5. **"Back to Projects" is unaffected** — stays at the bottom of the nav, unchanged.

## Consequences

**Positive:** consistent with org-mode's own top-of-nav/always-visible/active-styled pattern for its own "you are here" item (Dashboard). No more "the item vanishes on its own page" surprise. A real, previously-latent gap (Overview rendering without `orgId`, alone, during the pending/error window) is closed as a side effect of this change, not left for a later pass to find.

**Negative / accepted trade-offs:**

- **TC-SHELL-029 and TC-SHELL-030's literal wording is now false** ("no 'Project Overview', already on that exact route" / "plus 'Project Overview' (present on nested routes, unlike the bare project route)") — corrected in place in `docs/test-cases/2026-09-03-test-cases.md`.
- **3 Vitest tests needed updating** (`TC-SHELL-029`, `TC-SHELL-033(a)`, `TC-SHELL-033(b)`), and one e2e assertion (`shell9-project-nav-context.spec.ts`) — the e2e change is **untested live** this pass, same credential-access blocker as ADR-0061.
- **A second independently-hand-rolled gap this reveals**: the fix in Decision §4 was only caught because removing suppression forced the pending/404 tests to actually exercise the item's own gating — had "Overview" happened to be tested less thoroughly, this gap could have shipped silently, the same class of miss root `CLAUDE.md`'s "a died agent can leave one file mid-refactor" and "read every conditional against the story's own stated intent" notes already warn about, just self-inflicted rather than inherited from a stopped agent.

## Alternatives considered

- **Keep the suppression, just move the item to the top.** Rejected — this was the first attempt, and immediately reported back as still surprising (the reported bug: "when I go to this, the overview disappears... 2 different sidemenus?"). Confirmed there is only one `AppSidebar`; the suppression itself was the cause, not a second component.
- **Suppress the `NavLink`'s `onClick` on its own page instead of hiding it (CoreUI's old CPaginationItem-active-as-span pattern, `frontend/CLAUDE.md`).** Rejected — that pattern is documented in this repo as something to avoid reintroducing (a same-page click silently doing nothing reads as a broken handler); a real, always-clickable link with active styling is the established, tested pattern (`container/Table.tsx`'s pagination buttons already made the same call for the same reason).
