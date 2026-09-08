# UI Design Document — DS-2: Shared `Table` container (pagination + page-size selector)

**Date:** 2026-09-07
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [ADR-0041](../adr/0041-ds-2-table-container-shared-pagination.md), [ADR-0023](../adr/0023-frontend-shared-component-location.md) (location convention, amended), [ADR-0027](../adr/0027-generic-admin-crud-ui-and-backend-completion.md) (`EntityTable`), [ADR-0039](../adr/0039-dash-2-org-home-dashboard-relabel-and-project-table.md) (DASH-2 Project table, partially superseded), [DS-2 user story](../user-stories/2026-09-04-design-system-component-stories.md#story-ds-2-reusable-table-container-pagination--page-size-selector)

## 1. Scope

One new component, `frontend/src/container/Table.tsx`, and six migrations onto it:

| # | Screen | File | Current pagination | Migration mode |
|---|---|---|---|---|
| 1 | Generic admin CRUD list (24 entities) | `components/crud/EntityTable.tsx` | Server, own `CPagination`, hardcoded 25, no selector | Server |
| 2 | Dashboard (`/orgs/:orgId`) Project table | `pages/workflows/OrgHome.tsx` | Client, own `CPagination`, hardcoded 10, no selector | Client |
| 3 | Org Role Assignments | `RoleAssignmentsPanel.tsx` | None (full array) | Server (new: `role-assignments` route gains pagination) |
| 4 | Org Members | `pages/workflows/OrgMembers.tsx` | None (full array) | Server |
| 5 | Project → Releases / Test Suites / Risk Items (outer level only) | `pages/workflows/ProjectDetail.tsx` | None (full array) | Server |
| 6 | Project → Test Plans list | `pages/workflows/TestPlanDetail.tsx` | None (full array) | Server |

**Explicitly out of scope:** any nested/child list rendered inside an expanded table row (`frontend/CLAUDE.md`'s flat-`<ul>/<li>` rule — e.g. `ProjectDetail`'s Requirement→TestCase→TestStep sections, `TestCycleDetail`'s execution history). The container is for outermost, non-nested tables only, same boundary that rule already draws.

## 2. Component shape

```
┌───────────────────────────────────────────────────────────────────┐
│  <caller-supplied header/toolbar slot — search box, title, etc.>    │
├───────────────────────────────────────────────────────────────────┤
│  <CTable — caller-supplied column headers + row renderer>           │
│  ...                                                                 │
├───────────────────────────────────────────────────────────────────┤
│  Rows per page: [ 25 ▾]        ‹ Previous  1  2  3  Next ›          │
└───────────────────────────────────────────────────────────────────┘
```

- **Header/toolbar slot** is a plain render-prop/children passthrough — the container renders whatever the caller gives it (or nothing) above the table. This is where `OrgHome`'s existing search box and sortable `<CTableHeaderCell>` click handlers keep living; the container itself has no opinion on search/sort.
- **Table body**: caller supplies the column headers and a row-renderer (or a `rows`/`columns` pair for the simple case) — the container does not know the row shape, same posture `EntityTable` already has relative to its own `fields[]`.
- **Pagination row**: `CPagination`/`CPaginationItem` (identical markup to `EntityTable`'s existing implementation — copied, not reinvented) + a `CFormSelect` labeled "Rows per page" offering `10`/`25`/`50`/`100`.
- **Two modes, one prop (`mode: "server" | "client"`):**
  - `mode="server"`: caller passes `items` (the current page's rows only), `total`, `page`, `pageSize`, `onPageChange`, `onPageSizeChange`. The container never slices — it only renders what it's given and fires the callbacks; the caller's own `useQuery` (or equivalent) re-fetches on either callback.
  - `mode="client"`: caller passes the **full** already-filtered/sorted array. The container computes `totalPages`/the current page's slice internally, exposing only `onPageChange`/`onPageSizeChange` for imperative resets (page-size change → reset to page 1) — no caller-side re-fetch needed since there's nothing to fetch.
- **Page-size change (either mode):** always resets to page 1 — a stale page number from a smaller-page-size view could be out of range for the new size.
- **Empty state**: 0 rows → caller's own empty-state message renders in place of the table (as today, per-screen — e.g. `OrgHome`'s "No projects yet."/"No projects match your search."); the pagination row does not render at all when there's only one page's worth of data or fewer (matches `EntityTable`'s and `OrgHome`'s existing behavior — no change).

## 3. Per-screen migration notes

- **`EntityTable.tsx`**: swaps its own inline `CPagination` block for the container in server mode; `EntityListPage.tsx`'s hardcoded `PAGE_SIZE = 25` becomes container-owned state, `page`/`pageSize` lifted to drive the existing `getEntity`(list) call's `page`/`page_size` query params. No change to `fields[]`-driven column rendering, FK-label batching, or the actions column.
- **`OrgHome.tsx` (Dashboard Project table)**: client mode. The existing `SortableHeader` component and search `CFormInput` become the container's header/toolbar slot content, passed through unchanged. `filteredSortedProjects` (today computed via `useMemo`, already fully in memory per ADR-0039/NFR-50) becomes the container's client-mode `items` array — the container takes over only the slicing (today done by hand via `.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)`) and the `CPagination` markup. `PAGE_SIZE = 10`'s hardcode is replaced by the selector; default remains 10 unless the user changes it.
- **`RoleAssignmentsPanel.tsx`**: server mode, first table on this screen to paginate at all. `listRoleAssignments(orgId)` gains `page`/`page_size` params, reads the new `{items,total,page,page_size}` envelope (see API Document, DS-2 note) instead of a bare array.
- **`OrgMembers.tsx`**: server mode, using the already-paginated `GET /orgs/{org_id}/members` route (unchanged shape, this story only wires the UI to consume `page`/`page_size` it already ignores today).
- **`ProjectDetail.tsx`**: server mode for the three outer-level tables (Releases, Test Suites, Risk Items), each against its own already-paginated list route. Nested sections (Requirement→TestCase→TestStep, per-release TestCycle audit, per-suite TestCase membership) are untouched — still flat `<ul>/<li>`, never wrapped in the container.
- **`TestPlanDetail.tsx`**: server mode for the Test Plans list section, against the already-paginated `GET /projects/{id}/test-plans`-equivalent route it currently over-fetches from.

## 4. Location & file-level doc comment

`frontend/src/container/Table.tsx` — new `container/` directory (amends [ADR-0023](../adr/0023-frontend-shared-component-location.md), see that ADR's amendment note). Its own file-level doc comment states the `shared/`-vs-`crud/`-vs-`container/` distinction and points back to ADR-0023/ADR-0041, same convention `FormField`'s own header comment already established for DS-1.

## 5. Out of scope (explicit)

Search/filter/sort UI of any kind (stays exactly where each screen already puts it — the container has zero opinion on how the rows it's handed got that way); persisting the selected page size across navigation or reload; a `molecules`/`organisms` tiering of any kind (same posture ADR-0023 already took for DS-1); consolidating `EntityTable`'s `EntityConfig`-driven column system with the container's generic render-prop system into one API — they stay two different call conventions over the same shared pagination/page-size chrome.
