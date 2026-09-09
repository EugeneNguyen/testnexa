# UI Design Document — PROJ-4: Projects page + sidebar entry

**Date:** 2026-09-09
**Story:** [PROJ-4](../user-stories/2026-09-03-project-release-stories.md#story-proj-4-access-project-management-from-the-side-menu)
**ADR:** [ADR-0047](../adr/0047-proj-4-projects-page-sidebar-entry.md)

## 1. Scope

Relocate the Project management table (and its three modals) that DASH-2/[ADR-0039](../adr/0039-dash-2-org-home-dashboard-relabel-and-project-table.md) placed on `OrgHome`/"Dashboard" onto its own dedicated page, reached via a new sidebar nav item. No new visual design — every modal, form field, table column, and interaction is pixel-identical to what shipped under ADR-0039/ADR-0040/ADR-0041; this document covers *placement*, not new markup.

## 2. Screens touched

### 2.1 `AppSidebar` (`components/organisms/app-sidebar/`)

New flat nav item, inserted between "Dashboard" and "Members" (the sidebar's existing flat-item ordering):

```
Dashboard
Projects   <-- new
Members
```

- `key`: `"projects"`, `testId`: `"sidebar-nav-projects"`, `to`: `/orgs/:orgId/projects`, label `"Projects"`.
- `fa-solid fa-folder` icon (amended 2026-09-09 — see §4, open point 1).
- Gated on `orgId` presence, same as every other flat item — absent on `/orgs/pick`.

### 2.2 `OrgHome` (`pages/workflows/OrgHome.tsx`) — "Dashboard"

Trimmed to:

```
[Dashboard heading]                              [Members button]
[Project-count widget, now a link]  [Active-member-count widget]
[RoleAssignmentsPanel]
```

The Project table, "New Project" button, and all three modals are removed from this screen entirely (moved to §2.3). The Project-count `InfoBox` widget is wrapped in a `<Link to="/orgs/:orgId/projects">` — visually unchanged (no button chrome, no visible affordance beyond the pointer cursor a link implies), same as ADR-0042's existing "New Project" `Link`-as-button precedent elsewhere in this app but *without* button styling here, since the widget itself already reads as clickable content.

### 2.3 `ProjectsPage` (new, `pages/workflows/ProjectsPage.tsx`)

Mounted at `/orgs/:orgId/projects`. Same content as what `OrgHome` used to render for its Project section — one `card` containing a heading ("Projects", not "Dashboard") + "New Project" button, then the search box + `Table` (client mode) + Edit/Delete modals below it — **but full-width (amended 2026-09-09, CTO direct instruction, post-manual-test), not the centered `row.justify-content-center > col-md-10.col-lg-8` OrgHome originally used.** The `card` now sits directly in `container-fluid`, matching `EntityListPage.tsx`'s own existing full-width convention (`frontend/CLAUDE.md`'s `h-100` note already documents that shape) rather than a bespoke centered-column layout carried over from `OrgHome` by the original verbatim extraction.

```
[Projects heading]                                [New Project button]
[Search box]
[ID | Name | Standards profile | Actions table, paginated]
```

### 2.4 `AppBreadcrumb`

New trail for `/orgs/:orgId/projects`: `Dashboard` (linked) → `Projects` (active), inserted before the generic `/orgs/:orgId` catch-all pattern.

## 3. Data / API

No change. `ProjectsPage` calls exactly the functions `OrgHome` used to (`listProjects`, `createProject`, `updateProject`, `deleteProject` — `lib/api/projects.ts`, unchanged).

## 4. Open points resolved during implementation

1. **Should the new "Projects" nav item get an icon?** Originally resolved "no" (DASH-2/TC-SHELL-021's "Dashboard is the only sidebar item with an icon" invariant, not expanded without a story asking for it). **Reopened and reversed 2026-09-09**, CTO direct instruction after manual testing — the item gets `fa-solid fa-folder` (same glyph `ProjectCountWidget` already uses). See ADR-0047 Decision §2's own amendment note for the fuller reasoning, including that the original invariant was already stale by the time this document was written (SHELL-7 had already given `Members` an icon).
2. **Does "Dashboard" keep a Project-related affordance at all, or drop Projects entirely?** Resolved: keep the Project-count widget as a link — cheaper than a second "Projects" button and reuses an element already on the page.
3. **Does the "Members" quick-link button move with the table, stay on Dashboard, or get removed (redundant with the sidebar's own Members item)?** Resolved: stays on Dashboard, unchanged — a pre-existing convenience affordance from before the sidebar existed (RBAC-2), independent of this story's own scope; not removed without a story asking for that.
