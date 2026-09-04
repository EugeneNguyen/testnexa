# ADR-0020: Full CoreUI free-admin-template parity for the authenticated shell

**Date:** 2026-09-04
**Status:** Accepted
**Deciders:** xuanbinh91@gmail.com (CTO)
**Related:** [ADR-0018](0018-admin-shell-sidebar-layout.md) (admin shell sidebar+navbar — this ADR extends its scope, does not reverse its core decision), [ADR-0012](0012-coreui-design-system.md) (CoreUI design system)

## Context

ADR-0018 scoped the shell narrowly: sidebar + navbar wrapping the app's own routes, explicitly rejecting breadcrumbs-only and deferring anything not needed to close the OrgMembers dead-end. Direction now is to build the site on [CoreUI's free Bootstrap admin template](https://coreui.io/product/free-bootstrap-admin-template/) as the structural base, not just its sidebar/navbar piece — i.e. full template parity: breadcrumb, footer, dashboard widget layout, dark/light mode toggle, and the template's UI-element reference pages (Colors, Typography, Icons).

## Decision

- **Shell additions:** `CBreadcrumb` (route-derived) and `CFooter` join `AppSidebar`/`AppHeader` in `AppShell.tsx`. Still `@coreui/react` components only, per ADR-0012 — no raw HTML/CSS/JS pulled from the template's static asset bundle.
- **Dashboard:** `OrgHome` gains the template's widget-row layout (`CWidgetStatsA`/`CWidgetStatsB`), 2 real stat widgets now — Project count, active Org Member count — sourced from the existing generic-CRUD list endpoints' `total` field (`GET /projects`, `GET /org-memberships?status=active`), **no new API route**. The template's trend-chart widget is explicitly **deferred**, not built with placeholder data: this scaffold has no real time-series source yet (`TestExecution`/`Defect` history doesn't exist until their own FR-ADMIN-2 CRUD ships) — a chart with fabricated numbers would misrepresent product state, worse than no chart. Revisit once that data exists.
- **Dark/light mode toggle:** CoreUI's own `useColorModes` hook + header dropdown, `localStorage`-persisted. Template-standard, not a custom theme engine.
- **UI-element reference pages (Colors, Typography, Icons):** added as a "UI Elements" nav group, template-parity scaffolding — **not backed by any FR/NFR or user story**, same status as the template's own demo content. They exist so the site matches the base template's page set, not because a requirement calls for them. A future contributor should not read them as product scope.
- ADR-0018's core decision — single nav-item list, `CSidebar`/`CSidebarNav`, no bespoke responsive logic, no pre-built nav for unbuilt FR-ADMIN-2 entities — is unchanged. This ADR only lifts its narrower "shell-only, no extras" scope boundary.

## Consequences

**Positive:** site visually/structurally matches the chosen base template end-to-end, not just its nav shell; dark/light mode and the 2 real stat widgets are table-stakes for the category and now in place at zero incremental dependency cost (all sourced from components/data already available — no new package, no new API route).

**Negative / Trade-offs:** UI-element reference pages add nav surface and maintenance burden with no FR/NFR backing — flagged explicitly above so it isn't mistaken for real scope; if they go stale or unused, removing them is a documented, low-risk cleanup (delete the nav group + pages), not a data-model or API change. Deferring the trend-chart widget means the dashboard is visually sparser than the base template's own demo until real execution/defect data exists.

## Alternatives considered

- **Shell-only (ADR-0018's original boundary), add demo pages/dashboard/dark-mode later per-story** — rejected for this pass: direction is explicit template-base parity now, and these pieces cost nothing incremental (same dependency family already installed).
- **Full CoreUI PRO template** — not chosen: no story needs PRO-only widgets; the free template covers this scope.
- **Chart widget with placeholder/fabricated data, to match the template 1:1** — rejected: a chart showing numbers with no real backing source is misleading, not neutral filler; deferred instead until `TestExecution`/`Defect` data exists to back it honestly.
