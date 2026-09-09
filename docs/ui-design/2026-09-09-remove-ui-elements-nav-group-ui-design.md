# UI Design Document — REMOVE-UI-1: Removal of UI Elements nav group + Colors/Typography/Icons reference pages

**Date:** 2026-09-09
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [ADR-0052](../adr/0052-remove-ui-elements-nav-group.md), the SHELL-7 UI Design Document this removal also touches ([ui-design/2026-09-08-shell-7-sidebar-mini-org-crud-restructure-ui-design.md](2026-09-08-shell-7-sidebar-mini-org-crud-restructure-ui-design.md))

## 1. Scope

This is a delete, not an addition. The org-scoped sidebar's "UI Elements" nav group + its three children (Colors, Typography, Icons) are removed entirely; the corresponding three React Router routes in `App.tsx` go with them; the three page components in `frontend/src/pages/ui-elements/` are deleted from disk. There is no replacement surface, no design decision being introduced — only the explicit retirement of ADR-0020's "UI Elements is template-parity scaffolding, not product scope" stance.

## 2. Before / After — `AppSidebar` desktop expanded rail (1400px+ viewport)

```
BEFORE (ADR-0020 + SHELL-7, current `main`)                  AFTER (REMOVE-UI-1, this ADR)
─────────────────────────────────────────────────           ─────────────────────────────────────────────────
┌────────────────────────────┐                              ┌────────────────────────────┐
│ TestNexa                   │                              │ TestNexa                   │
├────────────────────────────┤                              ├────────────────────────────┤
│ [🎯] Dashboard              │                              │ [🎯] Dashboard              │
│ [👥] Members                │                              │ [📁] Projects               │
│ [📁] Projects               │                              │ [👥] Members                │
│ [🛡]  Access Control      ▸ │                              │ [🛡]  Access Control      ▸ │
│ [▤]  Catalogs            ▸ │                              │ [▤]  Catalogs            ▸ │
│ [🏢] Organization         ▸ │                              │ [🏢] Organization         ▸ │
│ [—]  UI Elements          ▸ │                              │ (nothing else — UI Elements │
└────────────────────────────┘                              │   row is gone, no new row) │
                                                          └────────────────────────────┘
```

The collapsed (`sidebar-collapse sidebar-mini`) rail loses its `—` icon row too — one fewer item in the icon-only rail, otherwise SHELL-7's own measured behavior (4.6rem un-hovered rail, hover-widens to 250px, no JS flyout) is unchanged.

The mobile off-canvas branch (`sidebar-open` at ≤991.98px) loses one item from the off-canvas panel — same width/behavior, just one fewer row to scroll past.

## 3. Three routes + three pages removed

| Was | Now |
|---|---|
| `/orgs/:orgId/ui-elements/colors` (`frontend/src/pages/ui-elements/Colors.tsx`) | React Router catch-all (NotFound) |
| `/orgs/:orgId/ui-elements/typography` (`frontend/src/pages/ui-elements/Typography.tsx`) | React Router catch-all (NotFound) |
| `/orgs/:orgId/ui-elements/icons` (`frontend/src/pages/ui-elements/Icons.tsx`) | React Router catch-all (NotFound) |

No other React Router route references these components. The pages never imported any application route — they were standalone static reference renders (adminlte-style color swatches, type scale, icon glyph list); no entity read/write, no API fetch, no `useQuery` hook. Their deletion is a clean removal with zero downstream callers.

## 4. `AppSidebar.test.tsx` test-fixture swap

The pre-existing treeview-toggle contract test currently uses `sidebar-nav-group-ui-elements` as its concrete nav-group example. With that group gone from the source, the example swap to `sidebar-nav-group-access-control` (4 children, identical menu-open / nav-treeview / aria-expanded mechanism, no coverage shape change). The icon-exclusivity assertion's `UI Elements` sub-clause drops (referent gone); TC-SHELL-026's other assertions (3 groups + Members + Projects + their 8 children) are unaffected. TC-SHELL-027's expected array drops its trailing "UI Elements" entry (7 items → 6 items).

## 5. Docs touched

Per ADR-0052's own `Decision §1–§6 / Doc-propagation scope` block: `docs/adr/README.md` (new row + Date line + ADR-0020 `Status`), `docs/wbs/2026-09-03-project-scaffold-wbs.md` (11.35), `docs/test-design/2026-09-03-test-design.md` (§43), `docs/test-cases/2026-09-03-test-cases.md` (TC-SHELL-014 struck + TC-SHELL-027 corrected + TC-SHELL-039 added), `docs/sitemap/2026-09-05-project-scaffold-sitemap.md` (route row + tree branch removed), `docs/requirements/2026-09-03-project-scaffold-requirements.md` ("Not an FR" paragraph struck), `docs/test-plan/2026-09-03-master-test-plan.md` (scope-creep risk row retired), and the SHELL-7 UI Design Document (ASCII sketch line removed — same correction this document's §2 "AFTER" column already shows).
