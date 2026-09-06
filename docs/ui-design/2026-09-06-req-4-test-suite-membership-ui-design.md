# UI Design Document — REQ-4 TestSuite Membership

**Date:** 2026-09-06
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [ADR-0030](../adr/0030-req4-test-suite-membership-bespoke-routes.md), [API Document §4](../api/2026-09-03-api-design.md), [Sitemap](../sitemap/2026-09-05-project-scaffold-sitemap.md) (correction: removes its `TestSuiteBuilder` reservation), [REQ-3 UI Design Document](2026-09-06-req-3-test-condition-rigor-path-ui-design.md) (the `ProjectDetail.tsx`-extension pattern this document continues), [ADR-0012](../adr/0012-coreui-design-system.md) (CoreUI), [ADR-0023](../adr/0023-frontend-shared-component-location.md) (`FormField` error convention)

This is a bespoke-workflow-screen design, not a generic-admin-surface one (contrast the [Generic Admin CRUD UI Design Document](2026-09-05-generic-admin-crud-ui-design.md)) — same posture as the REQ-1/REQ-2/REQ-3 sections already on `ProjectDetail`. `TestSuite`'s own name/purpose list already renders on the generic admin surface (`entityConfigs/test-suite.ts`, full CRUD) — this document only covers the membership behavior no generic page can express (a many-to-many join, not a plain-field form).

## 1. Placement: extends `ProjectDetail`, not a new page

The Sitemap's 2026-09-05 reservation named a dedicated `TestSuiteBuilder` route for this story. Following the same correction REQ-2/REQ-3 already made for `RequirementDetail` (a stale reservation superseded by REQ-1's own actual `ProjectDetail`-inline placement before either story started), this story adds a "Test Suites" section directly to `ProjectDetail.tsx`, alongside the existing Requirements/Releases sections. `TestSuiteBuilder` is removed from the Sitemap's reserved-paths list, not resurrected.

## 2. New UI elements on `ProjectDetail`

**"Test Suites" section** (new top-level section on `ProjectDetail`, same list+modal shape as the existing Requirements section):
- Fetches `GET /test-suites?project_id=<id>` on mount (existing generic list route, no backend change).
- Renders a `CTable` (name, purpose `CBadge`) — empty state: "No test suites yet."
- "New Test Suite" button opens a `CModal` with `name` (required) + `purpose` (free text, e.g. "regression"/"smoke"/"acceptance" — not an enum at the schema level, per the Database Document) — submits to the existing generic `POST /test-suites`.
- Each suite row expands (`CCollapse`, same pattern as the Requirements section's per-row expand) to a live membership view: fetches `GET /test-suites/{id}/test-cases` on first expand, re-fetches on every subsequent expand (never cached across collapses — AC2's "reflects current membership" claim, ADR-0030) — renders each member `TestCase`'s title + status `CBadge`, with a "Remove" button per row calling `DELETE /test-suites/{id}/test-cases/{case_id}`, followed by an immediate re-fetch of the same list (not an optimistic local splice) so the view always reflects the server's own current state.

**Per-TestCondition "Test Cases" sub-list** (extends REQ-3's existing per-Requirement "Test Conditions" section one level further):
- REQ-3 shipped "New Test Case" as a create-only action with no persistent list rendered afterward (its own UI Design Document's explicit non-goal, since no list route existed at the time). This story adds that list: on expanding a TestCondition row, fetch `GET /test-condition-test-case-links?test_condition_id=<id>` (the existing read-only generic-factory link-table route, ADR-0027) and resolve each `test_case_id` via `GET /test-cases/{id}` (existing item route) to render title + status — a small, bounded fan-out (typically single-digit TestCases per condition), not a new backend route.
- Each rendered TestCase gets an "Add to suite ▾" (`CDropdown`) populated from the same project's `TestSuite` list already fetched for the section above — selecting one calls `POST /test-suites/{id}/test-cases/{case_id}`. A `422` response (cross-project — cannot occur in practice here, since both the TestCondition and every listed TestSuite share this same `ProjectDetail`'s `projectId`, but the dropdown's own request still goes through the real route rather than skipping the check client-side) or `409` (already a member) renders inline as a dismissible `CAlert`, not a toast, so the specific reason stays visible next to the row it applies to.

## 3. Form validation (React Hook Form + Zod, per ADR-0009)

- TestSuite form: `name` non-empty string; `purpose` optional, no client-side enum restriction (the schema itself is a free-text nullable column).
- No form for the add/remove membership actions — both are single-click actions against an existing row (a suite name in the dropdown, a case row's "Remove" button), not data-entry.

## 4. Empty states / edge cases

- A TestSuite with zero members renders "No test cases in this suite yet" inside its expanded row, distinct from the section-level "No test suites yet" empty state.
- The "Add to suite ▾" dropdown is empty (no `CDropdownItem`s) if the project has zero TestSuites yet — rendered as a disabled dropdown with a "No suites yet — create one above" placeholder, not hidden entirely, so the ordering dependency (create a suite first) is visible rather than silently absent.
- No permission-based hide/disable on these new buttons (matches this page's existing Requirement/Release/TestCondition button convention — attempt-then-error via the real `422`/`403`/`409` responses, not pre-hidden — `ProjectDetail` is a bespoke workflow screen, not the generic admin surface ADR-0027's AC4 hide/disable requirement targets).

## 5. Non-goals

- No dedicated `TestSuiteBuilder` route (§1).
- No drag-and-drop or bulk-add UI for membership — one TestCase added/removed per action, matching the bespoke routes' own one-row-at-a-time shape (ADR-0030).
- No UI surfacing of "this suite is included in a TestPlan/TestCycle, membership is now frozen" — that behavior belongs to PLAN-1/FR-EXEC-1 (not built), which this story's own AC2 explicitly scopes membership-liveness to "until the suite is included in a TestPlan/TestCycle." Until that inclusion mechanic exists, every suite's membership view is always the live, editable one described above.
