# REQ-3: Test case via the rigor path (optional TestCondition layer) — design

**Date:** 2026-09-05
**Story:** [REQ-3](../../user-stories/2026-09-03-requirement-testcase-authoring-stories.md)
**Status:** Approved by user 2026-09-05 (4 open questions confirmed)

## Context

Schema is already fully built: `TestCondition`, `TestCase`, and all 4 dedicated
link tables (`RequirementTestConditionLink`, `TestConditionTestCaseLink`, etc.)
exist since the initial migration (`fbf02a6e4764`). `docs/api/2026-09-03-api-design.md`
§4 already plans the two bespoke routes this story needs but neither is built.
The generic CRUD factory (ADR-0022) already registers a `POST /test-conditions`
route that writes the `TestCondition` row but never the link table — a latent
bug this story closes by restricting it, matching the pattern already applied
to `TestCase` (`create` excluded from its factory methods for the same reason).

## Architecture

Two new bespoke, path-scoped routes, same shape as `POST /projects/{project_id}/releases`
(PROJ-2): fetch the parent row first (404 if missing or caller has no
`OrgMembership` in its org), then `has_permission` directly (not
`require_permission`, which reads path params the factory's flat-route
convention doesn't use here either — these routes DO have a path segment, but
we still call `has_permission` directly for consistency with the rest of this
route family and to reuse `chain_resolver`).

```
POST /requirements/{id}/test-conditions   (test_condition.create)
  -> fetch Requirement(id), resolve org via chain_resolver([])
  -> 404 if missing/no membership; 403 if membership but no test_condition.create
  -> INSERT TestCondition(requirement_id=id, ...body)
  -> INSERT RequirementTestConditionLink(requirement_id=id, test_condition_id=new.id)
  -> single DB transaction, flush, commit
  -> 201 TestConditionSummary

POST /test-conditions/{id}/test-cases   (test_case.create)
  -> fetch TestCondition(id), resolve org via chain_resolver([(Requirement, "requirement_id")])
  -> 404/403 same boundary
  -> INSERT TestCase(test_condition_id=id, status=draft, created_by_actor_id=actor, ...body)
  -> INSERT TestConditionTestCaseLink(test_condition_id=id, test_case_id=new.id)
  -> single DB transaction, flush, commit
  -> 201 TestCaseSummary
```

Both routes live in a new module `backend/app/api/routes/test_condition_authoring.py`,
mounted in `main.py` alongside the other route modules. Kept separate from
`assets.py` (generic-CRUD-only, per its own docstring) and from `releases.py`
(unrelated entity family) — mirrors how PROJ-2 gave `Release` its own bespoke
routes rather than bolting onto an existing generic file.

## Components

**Backend — new file `test_condition_authoring.py`:**
- `create_test_condition_for_requirement(id, payload, actor, db)`
- `create_test_case_for_test_condition(id, payload, actor, db)`
- Both reuse `chain_resolver`, `_org_membership_exists`-equivalent, `has_permission`
  from `crud_factory.py` (exported already) — no new resolver logic needed.

**Backend — `schemas/assets.py` additions:**
- `CreateTestConditionForRequirementRequest {description, priority}`
- `CreateTestCaseForTestConditionRequest {title, preconditions?, expected_result?, test_level_id, test_type_id}`
  (shape intentionally reusable by REQ-2's future `/requirements/{id}/test-cases`
  route — same fields, different link table written server-side)

**Backend — `api/routes/assets.py` change:**
- `_TEST_CONDITION_CONFIG.methods` narrowed to `frozenset({"list", "get", "update", "delete"})`,
  `create_schema` dropped to `None` — same posture as `_TEST_CASE_CONFIG` today.

**Frontend — `entityConfigs/test-condition.ts` change (post-merge addition):**
- Main picked up ADR-0027 (generic admin CRUD UI) while this spec was in
  review — `entityConfigs/test-condition.ts` mirrors the backend's
  `CrudEntityConfig.methods` 1:1 and currently declares
  `methods: ["list","get","create","update","delete"]`. Once the backend
  drops `create` (above), this file's `methods` array must drop `"create"`
  too, or the generic admin surface (`/projects/:projectId/admin/test-condition`)
  shows a Create button calling a route that no longer accepts POST.
  `test-case.ts` already has no `create` and needs no change — confirmed no
  existing test (backend or e2e) exercises `POST /test-conditions` over
  HTTP, so this restriction is safe.

**Backend — RBAC (`db/rbac_seed_catalog.py` + new migration):**
- `test_manager` bundle gains `test_condition.create`, `test_condition.update`,
  `test_condition.delete`, `test_case.create`, `test_case.update`, `test_case.delete`
  (parity with `tester`'s existing full CRUD on both — `test_manager` already had
  `.read` only). New Alembic migration backfills `role_permission` rows for
  existing seeded `test_manager` roles, mirroring `b7f3a1c9d2e4_add_project_permissions_to_test_manager`'s
  idempotent existence-check-then-insert shape.

**Frontend:**
- `frontend/src/lib/api/testConditions.ts` — `createTestCondition(requirementId, payload)`,
  `listTestConditions(requirementId, params)` (list already works against the
  existing generic `GET /test-conditions?requirement_id=`, no backend change).
- `frontend/src/lib/api/testCases.ts` — `createTestCaseForTestCondition(testConditionId, payload)`.
- `frontend/src/lib/api/taxonomy.ts` — `listTestLevels()`, `listTestTypes()` (global
  catalog, no project/org scoping) to back the two `<select>`s.
- UI: extend `ProjectDetail.tsx`'s existing Requirement list — each Requirement
  row gets a "Test Conditions" expand/section (list + "New Test Condition" modal),
  each TestCondition gets a "New Test Case" action (modal with title/preconditions/
  expected_result + test_level/test_type selects). Same `useForm`-per-section
  pattern already established for Requirements/Releases on that page.

## Data flow / error handling

- Both creates are atomic: model row + link row in the same `db.flush()`/`commit()` —
  if the link insert's `IntegrityError`s (shouldn't, since the parent row was
  just fetched and its id is used directly), the whole transaction rolls back,
  422.
- 404-vs-403 boundary identical to every other bespoke route in this codebase:
  no `OrgMembership` at all in the resolved org → 404; membership but missing
  permission → 403.
- `test_level_id`/`test_type_id` pointing at a nonexistent row → FK violation
  at flush → caught `IntegrityError` → 422 (no separate existence pre-check,
  matches the generic factory's own `create_item` posture).

## Testing

- Backend integration: TC-REQ-005 (TestCondition create + link), TC-REQ-006
  (TestCase-via-condition create + link, transitive traceability by querying
  both link tables), TC-REQ-007 (both paths' TestCases coexist in the same
  project — asserted via DB/API state, no traceability-view UI needed, per
  confirmed open question #4). Plus: 404-vs-403 boundary, restricted generic
  `POST /test-conditions` now 405/404s (method removed), `test_manager` role
  can now hit both new routes without `org_admin`/`tester` (mirrors TC-PROJ-017's
  pattern for the RBAC migration).
- Backend unit: new schemas validate; `rbac_seed_catalog` bundle set-membership
  test extended for `test_manager`'s new codes (mirrors existing catalog tests).
- Frontend unit: new modals' form validation (Zod schema per field), API lib
  functions.
- No E2E required by the story's ACs; can be added later if a full journey
  test is wanted.

## Addendum (docs pass, 2026-09-06)

Full ADR/requirements/WBS/database/API/UI-design/sitemap/test-plan/test-design/test-cases propagation written — see [ADR-0028](../../adr/0028-req3-test-condition-rigor-path-bespoke-routes.md) for the finalized decision record. One correction surfaced while updating the Sitemap: its 2026-09-05 version reserved a dedicated `RequirementDetail` page for FR-REQ-1..3, but REQ-1 had already shipped its Requirement UI inline on `ProjectDetail` instead. This design's "extends `ProjectDetail`" placement (§Components, Frontend) already matched that reality — the Sitemap itself was the stale artifact, now corrected rather than this design being changed.

## Out of scope

- REQ-2's own direct-link route/UI (separate worktree/story) — this design
  only shapes the shared `CreateTestCase*Request` fields for later reuse.
- FR-TRACE-1/2 (traceability/RTM views) — not built, not needed for this
  story's ACs.
- ADMIN-1 catalog seeding for `TestLevel`/`TestType` — assumed pre-existing
  or manually seeded for manual QA; this story doesn't seed data.
