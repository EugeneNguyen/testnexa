# UI Design Document — PLAN-3 TestCycle Creation

**Date:** 2026-09-06
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [ADR-0033](../adr/0033-plan3-test-cycle-creation-and-execution-scope-check.md), [API Document](../api/2026-09-03-api-design.md), [Sitemap](../sitemap/2026-09-05-project-scaffold-sitemap.md), [PLAN-1 UI Design Document](2026-09-06-plan-1-test-plan-membership-ui-design.md) / [PLAN-2 UI Design Document](2026-09-06-plan-2-entry-exit-criteria-visibility-ui-design.md) (the screen this document further extends), [ADR-0012](../adr/0012-coreui-design-system.md) (CoreUI), [ADR-0023](../adr/0023-frontend-shared-component-location.md) (`FormField` error convention), [Generic Admin CRUD UI Design Document](2026-09-05-generic-admin-crud-ui-design.md) (`EntityForm`/`FkAutocomplete`, reused here)

This is a one-screen extension, not a new route: `TestPlanDetail.tsx` gains a 5th section, directly below PLAN-2's "Entry/Exit Criteria" section — the next-and-last of the three extensions that screen's own PLAN-1 UI Design Document §1 originally anticipated ("this story's suite membership + coverage, plus PLAN-2's entry/exit criteria and PLAN-3's TestCycle view still to come"). No new bespoke API-lib file beyond the two new calls this section makes (`createTestCycle`, and reusing the existing generic `create` helper for `POST /environments`).

## 1. `TestPlanDetail.tsx` — new "Test Cycles" section

Placed directly below the "Entry/Exit Criteria" section (PLAN-2 UI Design Document §1), same `CCard` shape as every other section on this screen.

- Fetches `GET /test-cycles?test_plan_id=<testPlanId>` on mount (the existing generic-CRUD list route, `entityCrud.ts`'s generic `list` helper — no new API-lib file for reading). Renders a flat `<ul>/<li>` (per `frontend/CLAUDE.md`'s nested-table a11y-name gotcha, same as every other list on this screen): each row shows `name`, `start_date`–`end_date`, the linked `Release.version_label` and `Environment.name` (resolved client-side the same way `FkAutocomplete`'s existing label-lookup already works for other sections' read views, not a second denormalized fetch).
- "Create Cycle" button opens a `CModal` with a bespoke form (not `EntityForm` bound to `entityConfigs/test-cycle.ts` — that config's generic `create` submits to a factory route this entity doesn't have; see Non-goals):
  - `release_id` — `FkAutocomplete` against `release`, scoped to this plan's own `project_id` (same scoping convention `FkAutocomplete` already applies elsewhere on this screen for project-scoped ref entities).
  - `environment_id` — `FkAutocomplete` against `environment`, same project scope, **plus an inline "+ New Environment" toggle**: switches this one field from the autocomplete to two inline inputs (`name` required, `config_notes` optional). On submit, if the toggle is active, the form first calls `POST /environments` (existing generic-factory create, `environment.create`) with this plan's `project_id`, then uses the returned `id` as `environment_id` in the `POST /test-plans/{id}/test-cycles` call that follows — two sequential requests, not one atomic call (ADR-0033 Decision #4: no link-table side effect exists here for an atomic route to protect). If the first call fails (e.g. `403` — caller lacks `environment.create`), the second call is never attempted and the modal surfaces that failure alone.
  - `name` — required text `FormField`.
  - `start_date`/`end_date` — native date inputs, both optional (matches the column's own nullability).
- Submits `POST /test-plans/{id}/test-cycles`. A `422` (cross-project `release_id`/`environment_id`, or malformed input) or `403` renders as a dismissible `CAlert` directly under the section header, same convention as every other section's error handling on this screen.
- Re-fetches the list afterward rather than splicing local state — same "always reflects the server's own current state" posture every other section on this screen already established.

**No Edit/Delete actions in this section.** `TestCycle`'s `PATCH`/`DELETE` already exist via the generic admin surface (`entityConfigs/test-cycle.ts`, unaffected by this ADR) — this screen's own section is create-and-view only, mirroring the "Test Suites" section's own add/view-first posture (its own remove action exists because join-row removal has no other UI surface at all; `TestCycle`'s edit/delete already do, via the admin page, so this section doesn't duplicate them). A "View in Admin" link on each row routes to `/projects/:projectId/admin/test-cycles/:id/edit` for anyone who needs to edit/delete.

**No permission-based hide/disable on the "Create Cycle" button** — same attempt-then-error convention every other bespoke workflow screen in this codebase uses (PLAN-1 UI Design Document §5); a `403` surfaces the same way a `422` does.

## 2. Form validation (React Hook Form + Zod, per ADR-0009)

New Zod schema for this section's bespoke form (not `entityConfigs/test-cycle.ts`'s own, which is for the generic-admin fallback path only, see Non-goals): `release_id` (required uuid), `environment_id` (required uuid — or, when the inline-create toggle is active, the nested `name` field becomes required instead, `config_notes` optional), `name` (required, non-empty), `start_date`/`end_date` (optional dates, no cross-field ordering validation — no story asks for `end_date >= start_date`, matching this codebase's existing posture of not inventing validation beyond what an AC states).

## 3. Empty states / edge cases

- Zero cycles under a plan: "No test cycles yet." — same tone as this screen's other empty-list copy.
- Inline "+ New Environment" toggled on, then off again before submit: any typed `name`/`config_notes` are discarded, the field reverts to the autocomplete with nothing pre-selected — no draft persistence across the toggle.
- `POST /environments` succeeds but the subsequent `POST /test-plans/{id}/test-cycles` fails (e.g. `422` cross-project `release_id`): the `Environment` row still exists (the two calls are genuinely sequential, not transactional) — the modal's error surfaces the second call's failure, and the newly created `Environment` becomes selectable via the plain autocomplete on retry (no orphan-row cleanup UI; this mirrors the accepted trade-off of choosing two sequential calls over one atomic route, ADR-0033 Decision #4).
- A plan with zero available `Release`s or `Environment`s in the project: the respective `FkAutocomplete` shows its own existing empty-results state (no bespoke copy for this screen specifically) — the inline "+ New Environment" toggle is the one path that doesn't require a pre-existing `Environment` to already exist.

## 4. Non-goals

- **No dashboard/aggregation view** (pass/fail/blocked/skipped counts) — that's EXEC-1's own scope, not built by this pass. This section only creates and lists cycles.
- **No TestExecutionRunner UI** — recording a result against a cycle is EXEC-1's own screen (`docs/sitemap`'s existing reserved path), not built here. This ADR's backend route (`POST /test-cycles/{id}/executions`) exists and is reachable via the MCP tool / a direct API call, but no frontend form calls it yet.
- **`entityConfigs/test-cycle.ts` stays without `"create"`** — `TestCycle` has no factory-registered `create` route (ADR-0033 keeps it bespoke-only, same posture `TestCase`/`TestCondition` already have on the admin surface), so the generic admin page for `test-cycles` remains list/edit/delete only, same as it is today. `TestPlanDetail`'s own section above is the *only* create path FR-PLAN-3 ships — there is no admin-surface fallback, by design.
- **No cross-field `end_date >= start_date` validation** — not asked for by any AC, consistent with this codebase's general posture of not inventing validation beyond stated requirements.
