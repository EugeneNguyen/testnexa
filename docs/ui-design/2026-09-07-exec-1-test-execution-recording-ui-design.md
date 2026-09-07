# EXEC-1 UI Design Document — TestCycleDetail (recording a TestExecution result + live dashboard)

**Date:** 2026-09-07
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [ADR-0034](../adr/0034-exec-1-test-execution-recording-dashboard.md), [ADR-0033](../adr/0033-plan3-test-cycle-creation-and-execution-scope-check.md) (the create route this screen is the first caller of), [PLAN-3 UI Design Document](2026-09-06-plan-3-test-cycle-creation-ui-design.md) (`TestPlanDetail`'s "Test Cycles" section, whose rows now link here), [Sitemap](../sitemap/2026-09-05-project-scaffold-sitemap.md).

## 1. Screen identity

New route: `/projects/:projectId/test-plans/:testPlanId/test-cycles/:testCycleId`, screen `TestCycleDetail` — the sitemap's reserved `TestExecutionRunner` path, partially resolved (FR-EXEC-1 only; FR-EXEC-2/3 remain reserved). Nested under `TestPlanDetail`'s own route for the same reason PLAN-1 gave `TestPlan` its own dedicated page rather than an expand-in-place `ProjectDetail` section: a `TestCycle`'s execution history and dashboard is substantial enough surface to need its own addressable URL, and `TestPlanDetail`'s "Test Cycles" section (ADR-0033) already anticipated this by treating each cycle row as a link target rather than an inline expansion.

Reached from: `TestPlanDetail`'s "Test Cycles" section — each cycle row becomes a link (previously dead-end list rows, PLAN-3's own documented non-goal) navigating to this screen.

## 2. Layout

```
┌─────────────────────────────────────────────────────────────┐
│ ← Back to Test Plan                                          │
│                                                                │
│ Cycle: <name>                          [ Record Result ]     │
│ Plan: <test plan identifier>  Release: <version_label>        │
│ Environment: <name>  <start_date> – <end_date>                 │
│                                                                │
│ ── Dashboard ──────────────────────────────────────────────  │
│  ┌────────┐ ┌────────┐ ┌─────────┐ ┌─────────┐               │
│  │  Pass  │ │  Fail  │ │ Blocked │ │ Skipped │               │
│  │   12   │ │   3    │ │    1    │ │    0    │               │
│  └────────┘ └────────┘ └─────────┘ └─────────┘               │
│                                                                │
│ ── Execution history ─────────────────────────────────────── │
│  • <TestCase title> — Pass — 2026-09-07 14:02 — Priya         │
│    "Behaved as expected."                                     │
│  • <TestCase title> — Fail — 2026-09-07 13:40 — Priya         │
│    "Timeout on submit."                                       │
│  • <TestCase title> — Pass — 2026-09-06 09:15 — agent-ci-01   │
│    …                                                           │
└─────────────────────────────────────────────────────────────┘
```

Prose and sketch agree: the dashboard sits directly **above** the execution history, in that order top-to-bottom, matching the sketch exactly (`docs/CLAUDE.md`'s standing prose-vs-sketch-consistency rule).

## 3. Dashboard section

Four `CCard`/stat-tile widgets (`Pass`/`Fail`/`Blocked`/`Skipped`), same visual family as `OrgHome`'s FR-SHELL-3 widgets. Each tile's count is its own independent `GET /test-executions?test_cycle_id=<testCycleId>&result=<value>&page_size=1` call, reading `total` only — four parallel requests on mount, refetched together after any successful "Record Result" submission (not incremented locally: the whole point of AC2's "live, not manually maintained" wording is that the number always comes from a fresh server read). A cycle with zero executions of a given result shows `0`, not a blank/hidden tile — all four tiles always render.

## 4. Execution history section

Flat list (not a `CTable`, this repo's own nested-list convention — `frontend/CLAUDE.md` — even though this list isn't nested inside another table here, kept flat for consistency with every other cycle-scoped list on this screen family), `GET /test-executions?test_cycle_id=<testCycleId>`, ordered `executed_at` descending (most recent first — same "most recent first" convention TC-EXEC-009's future EXEC-3 defect list already commits to). Each row: `TestCase` title (resolved via its own id — no bespoke join, a client-side lookup same as other screens' `labelField` resolution), `result` (colored badge — green/red/amber/gray for pass/fail/blocked/skipped), `actual_result` (truncated, full text on expand/tooltip), `executed_at` (localized), and the executing actor's display name (`User.name` or `AIAgent.name`, whichever the shared actor-display helper this screen family already uses resolves to — no new resolution mechanism).

Empty state (`0` executions in this cycle): "No executions recorded yet." plain text, not an empty `CTable`.

## 5. Record Result modal

Triggered by the header's "Record Result" button (visible always; disabled/hidden per `usePermissions`'s existing convention if the caller lacks `test_execution.create`, same as every other create action across this app — NFR-37).

Fields:

| Field | Control | Notes |
|---|---|---|
| Test case | `FkAutocomplete` against `test-case`, **`listPath` overridden to `GET /test-plans/{testPlanId}/test-cases`** (PLAN-1's coverage query, `routeParams` prop per `frontend/CLAUDE.md`'s `:paramName` mechanism), not the generic `test-case` config's own (nonexistent) list route | Only offers `TestCase`s the backend's own scope-check (ADR-0033) would actually accept — a UX convenience, not the enforcement boundary (NFR-10 unchanged) |
| Result | `CFormSelect`, `pass`/`fail`/`blocked`/`skipped` | required |
| Actual result | `CFormTextarea` | optional, free text |
| Executed at | `CFormInput type="datetime-local"` | defaults to "now" at modal-open time, editable — a full datetime, not truncated to a date (the field is `datetime`, not `date`, same distinction `entityConfigs/test-execution.ts`'s own docstring already flags) |

Submit → `POST /test-cycles/{id}/executions`. On `201`: close modal, refetch both dashboard tiles and history list. On `422` (out-of-scope test case — should be structurally unreachable given the scoped picker, but still handled): dismissible `CAlert` inside the modal, same convention as every other bespoke-route form in this app. On `403`: same `CAlert` convention (should also be structurally unreachable given the header button's own permission-gating, but the route stays the boundary).

## 6. Explicitly not built (non-goals, same as ADR-0034's own scope line)

- ~~No `TestLog`/status-change timeline (EXEC-2)~~ — **built 2026-09-07** as a "History" button per history row, opening a modal on this same screen. See the [EXEC-2 UI Design Document](2026-09-07-exec-2-append-only-test-log-ui-design.md). This section's original claim held true at the time EXEC-1 shipped; it's struck through rather than deleted so this document's own history of what was and wasn't in scope stays legible.
- No "Raise Defect" button or flow (EXEC-3), even on a `fail` result.
- No edit/delete of a recorded execution — `test_manager` doesn't hold `test_execution.update`/`.delete` (ADR-0033's own deliberate withholding), and no UI affordance implies otherwise.
