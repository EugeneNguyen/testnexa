# UI Design Document — REQ-3 TestCondition Rigor Path

**Date:** 2026-09-06
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [ADR-0028](../adr/0028-req3-test-condition-rigor-path-bespoke-routes.md), [API Document §4](../api/2026-09-03-api-design.md), [Sitemap](../sitemap/2026-09-05-project-scaffold-sitemap.md) (correction: supersedes its 2026-09-05 `RequirementDetail` reservation), [design spec](../superpowers/specs/2026-09-05-req-3-test-condition-rigor-path-design.md), [ADR-0012](../adr/0012-coreui-design-system.md) (CoreUI), [ADR-0023](../adr/0023-frontend-shared-component-location.md) (`FormField` error convention).

This is a bespoke-workflow-screen design, not a generic-admin-surface one (contrast the [Generic Admin CRUD UI Design Document](2026-09-05-generic-admin-crud-ui-design.md)) — it extends `ProjectDetail`'s existing inline Requirement section (the pattern REQ-1 already established there), following the same per-section `useForm` convention already used for Releases and Requirements on that page, rather than introducing a new route/page.

## 1. Placement: extends `ProjectDetail`, not a new page

REQ-1 shipped its Requirement list + "New Requirement" modal directly on `ProjectDetail` (`/projects/:projectId`), not on a separate `RequirementDetail` page the Sitemap had speculatively reserved for FR-REQ-1..3. This document continues that placement: each Requirement row in the existing list gains an expandable "Test Conditions" section, keeping one Requirement's full authoring surface (its own fields, plus everything derived from it) on one screen.

## 2. New UI elements on `ProjectDetail`

**Per-Requirement "Test Conditions" section** (expand/collapse per row, `CCollapse`):
- Fetches `GET /test-conditions?requirement_id=<id>` on first expand (existing generic list route, no backend change).
- Renders a small `CTable` (description, priority `CBadge`) — empty state: "No test conditions yet."
- "New Test Condition" button opens a `CModal` with `description` (textarea) + `priority` (`CFormSelect`: low/medium/high) — submits to `POST /requirements/{id}/test-conditions`.

**Per-TestCondition "New Test Case" action** (button on each row of the section above):
- Opens a `CModal` with `title` (required), `preconditions`/`expected_result` (optional textareas), `test_level_id`/`test_type_id` (`CFormSelect`, populated from `GET /test-levels`/`GET /test-types` — global catalog, fetched once per page load, not per modal open).
- Submits to `POST /test-conditions/{id}/test-cases`. On success: closes the modal, shows a `CToast` confirmation ("Test case created and linked to this test condition") — no persistent per-condition TestCase list is rendered (no `GET` route lists TestCases by condition; out of this story's scope, see design spec's "out of scope" section).

## 3. Form validation (React Hook Form + Zod, per ADR-0009)

- TestCondition form: `description` non-empty string, `priority` one of `["low","medium","high"]`.
- TestCase form: `title` non-empty string; `preconditions`/`expected_result` optional; `test_level_id`/`test_type_id` required UUID (select-driven, so this is really "a selection was made," surfaced as the same required-field `CFormFeedback` message as any other field, per `FormField`'s DS-1 convention).
- Both forms reuse the existing per-section pattern already on this page (independent `useForm` instance per modal, not shared with the Requirement/Release forms already there).

## 4. Empty states / edge cases

- `test_level_id`/`test_type_id` selects render empty if no catalog rows exist yet (ADMIN-1 seeding is a separate concern) — the "New Test Case" button stays enabled but submission 422s with a clear field error if either select is left unset; no client-side blocking on catalog-empty beyond normal required-field validation.
- No permission-based hide/disable on these new buttons (matches this page's existing Requirement/Release button convention — attempt-then-error, not pre-hidden — `ProjectDetail` is a bespoke workflow screen, not the generic admin surface ADR-0027's AC4 hide/disable requirement targets).

## 5. Non-goals

- No traceability/RTM view (FR-TRACE-1/2, separate story) — coexistence of the two authoring paths (REQ-2/REQ-3) is proven at the API/DB layer in this story's tests, not surfaced as a UI feature.
- No listing of TestCases already linked to a given TestCondition (no backend route exists for it; see ADR-0028's design spec for the explicit YAGNI call).
- No changes to the generic admin surface's own `test-condition`/`test-case` pages beyond the `methods` sync already covered in ADR-0028 (dropping `"create"` from `entityConfigs/test-condition.ts`).
