# UI Design Document — PLAN-2 EntryExitCriteria Visibility

**Date:** 2026-09-06
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [ADR-0032](../adr/0032-plan2-entry-exit-criteria-visibility.md), [API Document](../api/2026-09-03-api-design.md), [Sitemap](../sitemap/2026-09-05-project-scaffold-sitemap.md), [PLAN-1 UI Design Document](2026-09-06-plan-1-test-plan-membership-ui-design.md) (the screen this document extends), [ADR-0012](../adr/0012-coreui-design-system.md) (CoreUI), [ADR-0023](../adr/0023-frontend-shared-component-location.md) (`FormField` error convention), [Generic Admin CRUD UI Design Document](2026-09-05-generic-admin-crud-ui-design.md) (`EntityForm`, reused verbatim here)

This is a two-screen extension, not a new route: `TestPlanDetail.tsx` (PLAN-1) gains a new section, and `ProjectDetail.tsx`'s existing Release→TestCycle expand-in-place view (PROJ-2) gains a second nested list. Both reuse existing components/config — no new generic-admin-surface work, no new bespoke API-lib file.

## 1. `TestPlanDetail.tsx` — new "Entry/Exit Criteria" section

Placed directly below the existing "Covered Test Cases" section (PLAN-1 UI Design Document §2), same `CCard` shape as every other section on this screen.

- Fetches `GET /entry-exit-criteria?test_plan_id=<testPlanId>` on mount (the existing generic-CRUD list route, `entityCrud.ts`'s generic `list` helper — no new API-lib file). Renders a flat `<ul>/<li>` (per `frontend/CLAUDE.md`'s nested-table a11y-name gotcha, same as every other list on this screen): each row shows `type` as a `CBadge` (four distinct colors — suggest `entry`=info, `exit`=success, `suspension`=warning, `resumption`=secondary, a first-pass convention not yet used elsewhere in this codebase) and `condition_text`.
- "Add Criteria" button opens a `CModal` rendering `EntityForm` bound to `entityConfigs/entry-exit-criteria.ts` in `mode="create"`, with `test_plan_id` fixed to the route's own `:testPlanId` (filtered out of the visible field list, same pattern `editConfig` already uses to hide `TestPlan.project_id` on this same screen's header Edit modal) — submits `POST /entry-exit-criteria`.
- Each row has "Edit" (opens the same `EntityForm`, `mode="edit"`, pre-filled — submits `PATCH /entry-exit-criteria/{id}`) and "Delete" (`DELETE /entry-exit-criteria/{id}`, no confirmation modal, same no-confirm convention the Test Suites section's "Remove" button already uses on this screen).
- All three actions (add/edit/delete) re-fetch the list afterward rather than splicing local state — same "always reflects the server's own current state" posture every other section on this screen already established (PLAN-1 UI Design Document §2).
- A `422`/`403`/`409` from any of the three renders as a dismissible `CAlert` directly under the section header, same convention as the Test Suites section's `membershipError` alert.

**Full CRUD, no permission-based hide/disable** — same attempt-then-error convention as every other bespoke workflow screen (PLAN-1 UI Design Document §5); the "Add"/"Edit"/"Delete" buttons render unconditionally, a lacking-permission attempt surfaces its `403` the same way a `422`/`409` does.

## 2. `ProjectDetail.tsx` — Release→TestCycle expand view gains exit criteria

The existing expand-in-place row (toggled by clicking a `Release` row, `getReleaseTestCycles`) currently renders, per `TestCycle`: name + dates, then a nested `<ul>` of executions (`result — executed_at`) or "No executions yet."

This adds a second nested `<ul>`, directly below the executions list, in the same `<li>`:

```
{cycle.name} ({start} – {end})
  Exit criteria:
    - {condition_text}   (one <li> per exit_criteria row)
    (or "No exit criteria defined." if cycle.exit_criteria.length === 0)
  Executions:
    - {result} — {executed_at}
    (or "No executions yet." — existing copy, unchanged)
```

`cycle.exit_criteria` arrives already filtered to `type = exit` by the backend (ADR-0032) — the frontend renders it as-is, no client-side filtering. No per-row actions here (read-only, same posture the executions list already has) — editing/deleting a criteria row happens only on `TestPlanDetail`'s own section (§1), reached via the plan's own link elsewhere in this screen, not from this expanded row.

**Why here and not a new route:** no dedicated `TestCycle` detail page exists yet (`TestCycle`/execution-progress UI is PLAN-3's own scope, explicitly deferred in PLAN-1 UI Design Document §6) — this expand-in-place view is the one place "execution progress" is visible today, so it's the one place ADR-0032 requires exit-criteria visibility to land for AC2's "one view" claim to hold.

## 3. Form validation (React Hook Form + Zod, per ADR-0009)

No new validation set: `entityConfigs/entry-exit-criteria.ts`'s existing config (`type` as a `CFormSelect` of the four enum values, `condition_text` as a required textarea) is reused verbatim by both the generic admin page and this new section — the same config, same schema, rendered through `EntityForm` in two different places.

## 4. Empty states / edge cases

- Zero criteria rows on `TestPlanDetail`: "No entry/exit criteria defined yet."
- Zero `exit`-type rows specifically, on the `ProjectDetail` cycle view: "No exit criteria defined." — distinct copy from the executions list's own empty state, not reused verbatim, so the two empty states in the same expanded row aren't visually identical.
- A `TestPlan` with entry/suspension/resumption rows but zero `exit` rows: `TestPlanDetail`'s own section shows all of them; the `ProjectDetail` cycle view's exit-criteria sub-list still shows its own empty state — the two views are never expected to show the same count.
- Deleting a criteria row currently displayed on a live `ProjectDetail` expand view (a different browser tab, say): no cross-tab sync — the expanded view simply reflects the deleted row until that section is next re-fetched (collapsed and re-expanded, or the page reloaded). No orphan-reference risk either way: `EntryExitCriteria` isn't FK'd from `TestExecution`/`TestCycle`.

## 5. Non-goals

- No dedicated `TestCycle` detail page — still PLAN-3's scope; this document only extends the two existing screens that already exist.
- No bulk-add/bulk-edit of criteria rows — one row per action, matching the generic `EntityForm`'s own one-row-at-a-time shape.
- No client-side type-based grouping/sorting on `TestPlanDetail`'s list beyond the fetch's own default order — a first-pass flat list, same as every other list section on this screen.
