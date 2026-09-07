# UI Design Document — DASH-2: `OrgHome` relabeled "Dashboard" + Project management table

**Date:** 2026-09-07
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [ADR-0039](../adr/0039-dash-2-org-home-dashboard-relabel-and-project-table.md), [ADR-0017](../adr/0017-project-creation-flow.md) (Project creation, unchanged), [ADR-0022](../adr/0022-generic-crud-router-factory.md) (`DELETE /projects/{id}`, now wired), [ADR-0018](../adr/0018-admin-shell-sidebar-layout.md) (sidebar), [ADR-0037](../adr/0037-shell-components-raw-html-not-coreui-react.md) (raw-HTML shell chrome), [ADR-0012](../adr/0012-coreui-design-system.md) (CoreUI design system)

## 0. Not to be confused with

**This document is about `OrgHome` (`/orgs/:orgId`), not the separate `Dashboard` screen at `/dashboard`** ([DASH-1 UI Design Document](2026-09-07-dash-1-root-redirect-dashboard-ui-design.md)). Both now display the word "Dashboard" to a logged-in user — an accepted, unresolved naming overlap (ADR-0039 Consequences, NFR-49). `/dashboard`'s empty placeholder is completely untouched by this pass.

## 1. Scope

1. Relabel `OrgHome`'s heading, sidebar nav item (+ icon), and breadcrumb label from "Org home"/"Org: {orgId}" to "Dashboard". Route stays `/orgs/:orgId`.
2. Extend the existing Project list into a management table: ID column, Edit modal (name + standards_profile), Delete button + confirm modal, search, sort, pagination.

No new route, no new screen component — `OrgHome.tsx` is edited in place.

## 2. Relabel surfaces

| Surface | Before | After |
|---|---|---|
| `OrgHome.tsx` `<h1>` | `Org: {orgId}` | `Dashboard` |
| `AppSidebar.tsx` nav item label | `Org home` | `Dashboard` (+ `cilSpeedometer` icon — the only nav item with one) |
| `AppBreadcrumb.tsx` route-derived label | `Org Home` | `Dashboard` |

The sidebar item's `key`/`data-testid`/`to` (`org-home`/`sidebar-nav-org-home`/`/orgs/:orgId`) are unchanged — only the visible string and the addition of an icon.

## 3. Project table layout

```
┌───────────────────────────────────────────────────────────────────┐
│  Dashboard                                    [Members] [New Project] │
├───────────────────────────────────────────────────────────────────┤
│  [ Search by name…            ]                                     │
│                                                                       │
│  ID ▲/▼   Name ▲/▼        Standards profile          Actions        │
│  ──────────────────────────────────────────────────────────────    │
│  a1b2…    Checkout Revamp  ISO-29119                 [Edit][Delete]  │
│  c3d4…    Payments Migr.   —                         [Edit][Delete]  │
│  ...                                                                 │
│                                                                       │
│           ‹ Previous  1  2  3  Next ›                                │
└───────────────────────────────────────────────────────────────────┘
```

- Card/heading/action-button row layout unchanged from the pre-existing screen (`CCard`/`CCardBody`, "Members"/"New Project" buttons stay where they are).
- Search box (`CFormInput type="search"`) sits above the table, only rendered when there's at least one project (empty-state "No projects yet." text is unchanged for a genuinely empty org).
- `ID`/`Name` column headers are clickable (`CTableHeaderCell`, `cursor: pointer`, `aria-sort` reflecting current state) — click toggles ascending/descending; a click on the other column resets to ascending on that column. `▲`/`▼` glyph indicates current sort.
- `Standards profile` column is display-only in the table (no more inline click-to-edit) — editing it happens through the Edit modal now.
- `Actions` column: `Edit` (secondary outline) and `Delete` (danger outline) buttons, same size/style convention as the rest of the admin surface (`EntityTable.tsx`'s own button styling).
- Pagination (`CPagination`/`CPaginationItem`, copied from `EntityTable.tsx`'s only existing usage in the repo) renders only when there's more than one page (page size 10). A zero-result search shows "No projects match your search." instead of the pagination control and table.

## 4. Edit modal

Replaces the old click-to-edit-in-place `standards_profile` field. Structurally identical to the existing "New Project" modal (RHF + Zod, `CModal`/`CModalHeader`/`CModalBody`/`CModalFooter`):

```
┌─────────────────────────────┐
│  Edit Project                │
├─────────────────────────────┤
│  Name        [___________]   │
│  Standards   [___________]   │
│  profile     Leave blank to  │
│              clear it.       │
├─────────────────────────────┤
│           [Cancel]  [Save]   │
└─────────────────────────────┘
```

Pre-filled from the clicked row's current `name`/`standards_profile`. Submits `PATCH /projects/{id}` (unchanged route) with both fields. A `422 field_errors.name` collision (renaming to a name already used in the org) surfaces inline on the `Name` field, same pattern `createProject`'s error handling already established.

## 5. Delete confirm modal

Mirrors `EntityListPage`'s existing `rowPendingDelete` pattern verbatim:

```
┌─────────────────────────────┐
│  Delete Project               │
├─────────────────────────────┤
│  Are you sure you want to    │
│  delete "Checkout Revamp"?   │
│  This cannot be undone.      │
├─────────────────────────────┤
│           [Cancel]  [Delete] │
└─────────────────────────────┘
```

Calls `DELETE /projects/{id}` (ADR-0022, first frontend caller). A `403` (caller lacks `project.delete` — anyone other than `org_admin` today) surfaces inline in the modal as a `CAlert`, modal stays open so the user isn't left wondering whether the delete silently no-op'd.

## 6. Search/sort/pagination — implementation note

All three are client-side, over the array `listProjects()` already returns in full (it pages through every row internally before returning — see that function's own docstring). No new `useQuery` key, no new backend call. Search/sort changes reset the current page to 1. This is a deliberate simplification (ADR-0039 Consequences) — revisit with server-side equivalents only if an org's project count grows large enough to matter.

## 7. Non-goals (explicit)

- `/dashboard` (DASH-1's separate placeholder) is not touched, not consolidated, not redirected into `OrgHome` — see §0 above.
- No new sidebar icon on any nav item other than the relabeled Dashboard one.
- No bulk-select/bulk-delete — one row's Delete button at a time, matching every other delete affordance in this codebase.
- No server-side search/sort/pagination — see §6.
