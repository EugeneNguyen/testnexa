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
- No icon (see §4, open point 1).
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

Mounted at `/orgs/:orgId/projects`. Identical layout to what `OrgHome` used to render for its Project section — one `card` containing a heading ("Projects", not "Dashboard") + "New Project" button, then the search box + `Table` (client mode) + Edit/Delete modals below it:

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

1. **Should the new "Projects" nav item get an icon?** Resolved: no. DASH-2/TC-SHELL-021 established "Dashboard is the only sidebar item with an icon" as an explicit, tested invariant; expanding it wasn't asked for by this story and isn't free (it's a tested negative assertion), so it's left as-is. See ADR-0047 Consequences.
2. **Does "Dashboard" keep a Project-related affordance at all, or drop Projects entirely?** Resolved: keep the Project-count widget as a link — cheaper than a second "Projects" button and reuses an element already on the page.
3. **Does the "Members" quick-link button move with the table, stay on Dashboard, or get removed (redundant with the sidebar's own Members item)?** Resolved: stays on Dashboard, unchanged — a pre-existing convenience affordance from before the sidebar existed (RBAC-2), independent of this story's own scope; not removed without a story asking for that.
