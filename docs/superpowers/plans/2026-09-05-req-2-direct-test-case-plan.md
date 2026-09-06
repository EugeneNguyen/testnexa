# REQ-2: Author a TestCase directly from a Requirement — Plan

**Date:** 2026-09-05
**Story:** [REQ-2](../../user-stories/2026-09-03-requirement-testcase-authoring-stories.md#story-req-2-author-a-test-case-directly-from-a-requirement-lightweight-path)
**Related:** [ADR-0006](../../adr/0006-test-condition-optional.md) (TestCondition optional — the whole reason this direct path exists), [ADR-0022](../../adr/0022-generic-crud-router-factory.md), [Database Doc §3.6](../../database/2026-09-03-database-design.md), [API Doc §3/§4](../../api/2026-09-03-api-design.md)

## Decisions (confirmed with user, 2026-09-05)

All four open questions below confirmed as proposed — assumptions/suggestions in each are the final design, no changes.

## Open questions (resolved, kept for rationale)

**Q1 — `resolve_test_case_org_id` resolver gap.** `TestCase`/`TestStep`/`Attachment`'s shared org-resolver (`app/api/crud_factory.py`) only had two branches: `test_condition_id` (if set) or a `TestSuiteTestCase` link. A direct-link `TestCase` (`test_condition_id = null`, no suite membership) — exactly REQ-2's own shape — had no resolver path at all, so any `GET`/`PATCH`/`DELETE /test-cases/{id}` on one would 404 as "orphaned" immediately after creation. Both the API Document and Database Document explicitly (and, until this fix, incorrectly) described this as "no create path in this codebase produces it."
- **Assumption/suggestion:** add a third fallback branch — `RequirementTestCaseLink` → `Requirement.project_id` — checked before the suite fallback (this is REQ-2's first-class shape, not an edge case). Confirmed; implemented in `resolve_test_case_org_id`, unit-tested (`tests/unit/test_crud_factory.py`) and integration-tested (`test_created_direct_link_test_case_is_readable_afterwards`). Both docs updated to describe the three-branch resolver.

**Q2 — `test_level_id`/`test_type_id` required but absent from the AC.** `TestCase.test_level_id`/`test_type_id` are non-nullable FKs on the model, but REQ-2's AC only lists title/preconditions/expected_result/status/created_by_actor_id.
- **Assumption/suggestion:** keep them required in `CreateTestCaseRequest` — ADR-0006's lightweight-path decision is scoped to TestCondition specifically, not to these two unrelated taxonomy FKs. Confirmed; frontend's "New Test Case" modal sources both as `<select>` options from the (unseeded) global `TestLevel`/`TestType` catalogs.

**Q3 — TestStep reorder vs. `uq_test_step_case_sequence`.** Swapping two steps' `sequence` values one PATCH at a time risks a transient unique-constraint collision (e.g. swapping steps 1 and 2 mid-sequence).
- **Assumption/suggestion:** ship N independent `PATCH /test-steps/{id}` calls (AC3's "independently editable" literally asks for this shape) and accept the existing generic factory behavior — a collision surfaces as `422 validation_error`, the same posture every other entity's `update` route already has via its flush-then-catch-`IntegrityError` handler. No new reorder endpoint or renumbering logic built — out of REQ-2's AC scope, and the generic factory already behaves consistently (if not maximally convenient) on collision. Flagged, not fixed: a client wanting swap-without-402 should use non-adjacent sequence gaps (e.g. 10/20/30) rather than 1/2/3, or move a step to a temporary out-of-range value first.

**Q4 — `GET /requirements/{id}/test-cases` missing from API Doc §4.** The route existed only in §6's MCP tool-surface table (`list_test_cases`'s backing route), not in §4's bespoke-routes table.
- **Assumption/suggestion:** doc gap-fill, not a design question — added the row to §4. Confirmed.

---

## What already existed (do not rebuild)

- `TestCase`/`TestStep`/`RequirementTestCaseLink` models + tables (`backend/app/models/assets.py`, `backend/app/models/trace.py`, `fbf02a6e4764_initial_schema.py`) — `TestCase.test_condition_id` already nullable per ADR-0006, `TestStep` already has the `(test_case_id, sequence)` unique constraint.
- `UpdateTestCaseRequest`/`TestCaseSummary`, full `CreateTestStepRequest`/`UpdateTestStepRequest`/`TestStepSummary`/`TestStepListResponse` schemas.
- Generic-CRUD-factory routes: `GET`/`PATCH`/`DELETE /test-cases/{id}`, full `TestStep` CRUD (`POST`/`GET`/`PATCH`/`DELETE /test-steps`, scoped by `test_case_id`) — all already wired, permission-gated, tenant-boundary-correct (once Q1's resolver fix landed).
- `test_case.*`/`test_step.*` permission codes seeded (RBAC-4/ADMIN-2).

## Scope (this story's actual remaining work)

1. **`backend/app/api/crud_factory.py`** — `resolve_test_case_org_id`'s third fallback branch (Q1).
2. **`backend/app/schemas/assets.py`** — `CreateTestCaseRequest`, `TestCaseListResponse`.
3. **`backend/app/api/routes/assets.py`** — bespoke `POST`/`GET /requirements/{id}/test-cases` (atomic TestCase + RequirementTestCaseLink create; requirement-scoped list).
4. **`frontend/src/lib/api/{testCases,testSteps,taxonomy}.ts`** — new API client modules.
5. **`frontend/src/pages/workflows/ProjectDetail.tsx`** — Requirement rows expand to a directly-linked TestCase list + "New Test Case" modal; each TestCase entry expands to its TestStep list + add-step form + per-step inline edit. Rendered as flat `<ul>`s (not nested `<CTable>`s), matching the Release-cycles convention already on this page — a `<table>` nested inside another `<table>`'s cell makes the outer row's accessible name aggregate the inner rows' text, breaking `getByRole("row", {name})`-style test lookups.
6. **Docs** — API Doc §3 resolver table/footnote, §4 bespoke-routes table (Q4); Database Doc §3.6 resolver prose.
7. **Tests** — backend unit (`test_test_case_schemas.py`, `test_crud_factory.py` resolver additions), backend integration (`test_req2_direct_test_case.py`, TC-REQ-003/004), e2e UI (`req2-direct-test-case-ui.spec.ts`).

## Verification

- Backend: `pytest tests/` — 350 passed (214 unit + integration), run against an isolated throwaway Postgres + local `uvicorn` (never the main `testnexa` Compose project, per CLAUDE.md).
- Frontend: `tsc --noEmit` clean, `vite build` clean.
- E2E: `req2-direct-test-case-ui.spec.ts` plus the full existing suite (`req1-*`, `release-create`, etc.) green against an isolated Compose project (`testnexa-e2e-req2`, port 54701) — no regression from the shared `ProjectDetail.tsx` edit.
