# UI Design Document — PLAN-1 TestPlan Membership & Detail Screen

**Date:** 2026-09-06
**Owner:** xuanbinh91@gmail.com (CTO)
**Sources:** [ADR-0031](../adr/0031-plan1-test-plan-membership-and-status-transition-routes.md), [API Document §4](../api/2026-09-03-api-design.md), [Sitemap](../sitemap/2026-09-05-project-scaffold-sitemap.md), [REQ-4 UI Design Document](2026-09-06-req-4-test-suite-membership-ui-design.md) (the pattern this document deliberately departs from — see §1), [ADR-0012](../adr/0012-coreui-design-system.md) (CoreUI), [ADR-0023](../adr/0023-frontend-shared-component-location.md) (`FormField` error convention)

This is a bespoke-workflow-screen design, not a generic-admin-surface one (contrast the [Generic Admin CRUD UI Design Document](2026-09-05-generic-admin-crud-ui-design.md)). `TestPlan`'s own identifier/scope/approach/staffing/schedule/status fields already render on the generic admin surface (`entityConfigs/test-plan.ts`, full CRUD) — this document covers the membership and coverage behavior no generic page can express (a many-to-many join plus a derived two-hop query), and the dedicated detail route those behaviors need to live on.

## 1. Placement: a new route, not a `ProjectDetail` extension (CTO direction, 2026-09-06)

Every prior REQ-* story (REQ-1 through REQ-4) folded its bespoke UI into `ProjectDetail.tsx` as an expand-in-place section, on the reasoning that each addressed one more facet of a single Requirement→TestCase authoring flow already anchored there. PLAN-1 breaks that pattern deliberately: a `TestPlan` is its own multi-part object — this story's own suite membership and coverage view, plus PLAN-2's entry/exit criteria and PLAN-3's TestCycle/execution-progress view still to come, all scoped to one specific plan, not to the project as a whole. Continuing to nest all of that inside `ProjectDetail` would mean a `TestPlan`-selection sub-state living inside an already-large page rather than its own addressable URL. Given PLAN-2/PLAN-3 are known, imminent extensions of the same object, a dedicated route is opened now rather than deferred until the nesting becomes unmanageable.

**New route:** `/projects/:projectId/test-plans/:testPlanId` → `TestPlanDetail`.

`ProjectDetail.tsx` itself changes minimally: the existing generic-admin "Test Plans" list (reached via its `/admin/test-plans` entity-registry entry, unchanged) is left as-is for pure list/create/delete; a new small "Test Plans" section is added directly on `ProjectDetail` (same list-card shape as the existing Requirements/Releases/Test Suites sections) whose rows link to `TestPlanDetail` instead of expanding in place — the one difference from every prior section's own pattern, and the reason this document exists separately rather than as another `ProjectDetail` subsection.

## 2. `TestPlanDetail` screen layout

**Header card** — `identifier`, `status` (`CBadge`, color-coded: `draft` = secondary, `approved` = success, `superseded` = dark), `scope`/`approach`/`staffing_and_training`/`schedule` rendered as labeled read-only text blocks (an "Edit" button opens a `CModal` reusing the generic admin surface's own `TestPlan` field config for the writable fields — no second, independently-maintained form).

**"Test Suites" section** (new, this story's core UI surface):
- Fetches `GET /test-plans/{id}/test-suites` on mount. Renders a flat `<ul>/<li>` list (name + purpose `CBadge`) — **not** a nested `CTable`, per `frontend/CLAUDE.md`'s nested-table a11y-name gotcha (this list already lives inside `TestPlanDetail`'s own page-level layout, one nesting level deep from the header card, so a second `CTable` here would replicate REQ-4's own already-flagged risk).
- "Include Suite" button opens a `CModal` with a `CFormSelect` populated from `GET /test-suites?project_id=<projectId>` (the same project's own suites, existing generic list route, no backend change) — submits `POST /test-plans/{id}/test-suites/{suite_id}`.
- Each row has a "Remove" button → `DELETE /test-plans/{id}/test-suites/{suite_id}`, followed by an immediate re-fetch of the same list (not an optimistic local splice), same "always reflects the server's own current state" posture REQ-4's UI Design Document established.
- A `422` response (cross-project — the "Include Suite" dropdown is itself populated from `?project_id=<projectId>`, so this can't occur via the dropdown, but the real route is still called rather than skipped client-side) or `409` (already included) renders inline as a dismissible `CAlert` directly under the section header, not a toast.

**"Covered Test Cases" section** (new, read-only, AC2's own query):
- Fetches `GET /test-plans/{id}/test-cases` — re-fetched whenever the "Test Suites" section above successfully adds or removes a suite (the two sections are not independently cached; an include/remove action invalidates both), so the coverage view never silently drifts from the membership that produces it.
- Renders as a flat `<ul>/<li>` (title + status `CBadge`), same nesting-avoidance reasoning as above. No per-row actions — this section is a derived view, not an editable one; adding/removing a `TestCase` from coverage happens only indirectly, by including/removing an entire `TestSuite` above.

## 3. Form validation (React Hook Form + Zod, per ADR-0009)

- Header "Edit" modal: reuses the generic admin surface's existing `TestPlan` field config/validation (`identifier` required, rest optional strings, `status` as a `CFormSelect` of the three enum values) — no second, hand-rolled validation set. A `status` change through this modal goes through the same `PATCH /test-plans/{id}` route and is subject to the same transition guard (§4) as any other `status` write; an illegal transition's `409` renders inline in the modal, not silently swallowed.
- "Include Suite" modal: single required `CFormSelect` (`suite_id`), no free-text fields, no client-side schema beyond "a suite is selected."

## 4. Status-transition guard surfacing (ADR-0031)

The header card's "Edit" modal is the only UI path that can attempt a `status` write (no separate "Approve"/"Supersede" buttons exist yet — that's GOV-1's own `/approve` route, not yet built, and this story's own scope explicitly excludes it, [ADR-0031](../adr/0031-plan1-test-plan-membership-and-status-transition-routes.md)). An illegal transition attempted this way (e.g. selecting `superseded` while the plan is still `draft`) returns `409 invalid_status_transition`, rendered as an inline `CAlert` inside the modal, same convention as the membership section's own `422`/`409` handling above — not silently reverted, not a generic toast.

## 5. Empty states / edge cases

- Zero included suites: "Test Suites" section renders "No test suites included yet."
- Zero covered test cases (either no suites included, or included suites have no members): "Covered Test Cases" section renders "No test cases covered yet" — distinct wording from the suites-section empty state, since the two causes (no suites vs. suites-with-no-members) aren't distinguished in this first pass, both collapse to the same message.
- "Include Suite" dropdown empty (project has zero `TestSuite`s yet): rendered disabled with a "No suites yet — create one on the Test Suites page" placeholder, mirroring REQ-4's own "ordering dependency visible, not hidden" convention.
- No permission-based hide/disable on the "Include Suite"/"Remove"/"Edit" buttons — attempt-then-error via the real `422`/`403`/`409` responses, matching every other bespoke workflow screen's existing convention (`ProjectDetail`'s Requirement/Release/TestSuite sections), not the generic admin surface's ADR-0027 AC4 hide/disable requirement.

## 6. Non-goals

- No "Approve"/"Supersede" action buttons — that UI is GOV-1's own scope, once its dedicated `/approve` route exists; this screen's "Edit" modal can still reach `approved`/`superseded` via a plain `status` field write today (§4), a known, flagged interim state (ADR-0031), not a UI decision to hide.
- No entry/exit-criteria UI (PLAN-2) or TestCycle/execution-progress UI (PLAN-3) on this screen yet — both are the next, already-anticipated extensions of this same route (§1), not built by this pass.
- No bulk-include (multiple suites in one action) — one suite included/removed per action, matching the bespoke routes' own one-row-at-a-time shape (ADR-0031), same posture REQ-4's UI Design Document established for its own membership actions.
