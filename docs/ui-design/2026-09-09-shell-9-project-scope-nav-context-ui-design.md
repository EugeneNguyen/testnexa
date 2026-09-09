# UI Design Document — SHELL-9: Project-scope nav context (sidebar + breadcrumb)

**Date:** 2026-09-09
**Story:** [SHELL-9](../user-stories/2026-09-04-admin-shell-sidebar-stories.md)
**ADR:** [ADR-0049](../adr/0049-shell-9-project-scope-nav-context-resolution.md)

## 1. What changes visually

No new screen, no new component tree shape — `AppSidebar`/`AppBreadcrumb`'s existing markup (AdminLTE v4 raw HTML, ADR-0042) is unchanged. Only the **data feeding them** changes on project-scoped routes.

### 1a. Sidebar, before/after, on `/projects/:projectId`

**Before (today):**

```
┌─────────────────────┐
│ TestNexa             │
├─────────────────────┤
│ (nothing else)        │
└─────────────────────┘
```

**After:**

```
┌─────────────────────┐
│ TestNexa             │
├─────────────────────┤
│ 🎚  Dashboard         │
│ 📁  Projects          │
│ 👥  Members           │
│ 🛡  Access Control  ▸ │
│ 🗂  Catalogs        ▸ │
│ 🏢  Organization    ▸ │
│    UI Elements      ▸ │
└─────────────────────┘
```

Byte-for-byte the same nav `AppSidebar` already renders on `/orgs/:orgId` (~~icons per ADR-0046/ADR-0047 — Dashboard and the 3 admin groups get one, Projects/Members/UI Elements don't~~). **Icon parenthetical corrected in place 2026-09-09 (rebase onto `main` `32e7d1e`) — it was wrong on two counts, one of them already wrong when written.** `Projects` gained `fa-solid fa-folder` on `main` (CTO manual-test instruction, amending ADR-0047 §2's original "no icon" call) *after* this document was authored, so that half is ordinary staleness. But `Members` already had `fa-solid fa-users` from SHELL-7/ADR-0046 — merged before this document existed — so that half was never true; it was inherited from DASH-2/TC-SHELL-021's "Dashboard is the only icon item" invariant, which SHELL-7 had already broken. **Current shape: `Dashboard` (`fa-gauge-high`), `Projects` (`fa-folder`), `Members` (`fa-users`) and the 3 admin groups each carry exactly one icon; only the 8 entity children inside those groups and the `UI Elements` group toggle stay icon-less.** Per `frontend/CLAUDE.md`'s own note, this rule has now reversed three times across three stories — read `app-sidebar.tsx`'s array literals and `AppSidebar.test.tsx`'s assertions directly rather than trusting this paragraph. The ASCII sketch above has been corrected to match (`📁` Projects, `👥` Members), per root `CLAUDE.md`'s rule that a UI Design Document's prose and its own layout sketch must agree rather than each being separately plausible. No item is highlighted "active," since none of `Dashboard`/`Projects`/`Members`/the admin groups' own routes match `/projects/:projectId` — this is expected and correct; there is no sidebar item *for* an individual project today, and none is added by this story (see §3, rejected alternative).

### 1b. Breadcrumb, before/after

`/projects/:projectId` today: `Project` (single segment, plain text, no link).

`/projects/:projectId` after:

```
Projects  /  Acme Payments Gateway
```

("Projects" is a `<Link>` to `/orgs/:orgId/projects`; the project's real name is the active, unlinked final segment.)

`/projects/:projectId/test-plans/:testPlanId/test-cycles/:testCycleId` today: `Project / Test Plan / Test Cycle` (first segment linked to `/projects/:projectId`, unnamed).

After:

```
Projects  /  Acme Payments Gateway  /  Test Plan  /  Test Cycle
```

(`Projects` linked to the org list, the project name linked to `/projects/:projectId`, `Test Plan` linked to its own route, `Test Cycle` active.) The `/projects/:projectId/admin/:entity[/:id/edit]` pair gets the identical two-segment prefix (`Projects` → `{project name}`) ahead of its existing `{entity label}` [→ `Edit`] segment(s).

## 2. Loading / error states

No spinner, no skeleton (confirmed default, root `CLAUDE.md`'s plan-with-open-questions pattern — this repo's general non-skeleton convention for small, fast fetches). While `useResolvedOrgId()`'s fetch is pending or has failed:

- **Sidebar:** renders exactly its pre-existing `orgId`-absent state — brand only, no nav items. Population happens the instant the fetch resolves; no intermediate "half nav" state exists, since `navItems`/`navGroups` are computed from one `orgId` value, not built incrementally.
- **Breadcrumb:** the route's `ROUTE_BREADCRUMBS` entry still matches, but `segments()` for a project-scoped pattern needs `projectName` — while unresolved, it returns `[]` (or omits the `Projects`/name segments and falls back to today's bare label, see open question below), which trips the existing `segments.length === 0 → null` graceful-degradation path already proven by TC-SHELL-008. No raw project ID, no `undefined`, ever rendered as a label.

## 3. Alternatives considered (visual)

- **A distinct "← Back to Projects" link/button, separate from the sidebar's own "Projects" item**, positioned above the nav list or in the breadcrumb. Rejected — once the org nav renders at all on project routes (§1a), "Projects" already does this; inventing a second, differently-styled affordance pointing at the identical URL is visual noise ADR-0047's own reasoning already rejected for a similar pair.
- **Highlighting "Projects" as visually "active" while on any `/projects/:projectId...` route**, to signal "you're inside a project, this is where you came from." Considered, not adopted this pass — `NavLink`'s active-class semantics are route-prefix-based (ADR-0018's own established convention), and `/projects/:projectId` isn't a sub-path of `/orgs/:orgId/projects`, so faking "active" here would need bespoke logic outside `NavLink`'s existing pattern for a purely cosmetic signal. Flagged as a future polish item, not blocking this story's own scope (a working, reachable link matters more than which item glows).

## 4. Open question (flagged, not silently decided)

**Breadcrumb's graceful-degradation fallback during the fetch:** should a project-scoped route show *nothing* (today's `null`, extending the existing pattern) or *today's bare "Project" label* while `useResolvedOrgId()` is loading, for the ~1 fetch's worth of time before the real trail resolves? **Default (recommended): nothing**, consistent with TC-SHELL-008's existing "no fallback branch that echoes a raw/partial label" invariant — a flash of "Project" that then relabels itself to the real name a moment later is arguably worse UX than a brief blank breadcrumb bar. Implementer should confirm this doesn't read as "broken" in practice (a quick live check, not a static read, per root `CLAUDE.md`'s testing philosophy) before finalizing.
