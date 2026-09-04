# PROJ-2: Create a Release and Target Test Cycles to It — Plan

**Date:** 2026-09-04
**Story:** [PROJ-2](../../user-stories/2026-09-03-project-release-stories.md#story-proj-2-create-a-release-and-target-test-cycles-to-it)
**Related:** [ADR-0017](../../adr/0017-project-creation-flow.md) (bespoke-route + 404-vs-403 precedent this story reuses), [PROJ-1 plan](2026-09-03-proj-1-create-project-plan.md) (sibling pattern), [Database Doc §3.5](../../database/2026-09-03-database-design.md), [API Doc §2/§3](../../api/2026-09-03-api-design.md), [Requirements FR-PROJ-2/FR-PLAN-3](../../requirements/2026-09-03-project-scaffold-requirements.md)

## Decisions (confirmed with user, 2026-09-04)

- Q1: `test_manager` gets `release.create/.read/.update` (new RBAC seed migration).
- Q2: `GET /releases/{id}/test-cycles` nests each cycle's `TestExecution`s.
- Q3: that endpoint gates on **all three** — `release.read` AND `test_cycle.read` AND `test_execution.read` (not `release.read` alone — revised from the original assumption below).
- Q4: frontend in scope — minimal Project-detail page + Release list/create modal (sized in Scope below).

Rationale kept below for each (Q3's original assumption text is superseded by the decision above, left in place as a record, not the design).

## What already exists (do not rebuild)

- `Release` model + table, fully migrated (`backend/app/models/project.py`, `fbf02a6e4764_initial_schema.py`): `id`, `project_id` (FK → project.id, not null, indexed), `version_label` (not null), `target_date` (nullable date), timestamps.
- `TestCycle.release_id` (FK → release.id, not null), `TestExecution.test_cycle_id` (FK → test_cycle.id, not null) — both already migrated. AC2's schema-level relationship needs zero code changes.
- `release.create`/`.read`/`.update`/`.delete` already in the seeded `Permission` catalog (`rbac_seed_catalog.py`), currently only in `org_admin`'s bundle (which is "every permission that exists"). `test_manager`'s bundle already has full `test_cycle` CRUD, but no `release.*`.
- `has_permission`, `require_permission`, `get_current_actor`, the any-status-`OrgMembership` 404-vs-403 pattern, flush-then-catch-`IntegrityError`-for-422 — all reusable as-is, same as PROJ-1.
- No generic CRUD router factory exists yet (API Doc §3 lists `Release`/`TestCycle` under it, but the factory itself is unbuilt — same gap ADR-0017 hit for `Project`). PROJ-1 went bespoke rather than build the factory; this story follows that precedent rather than being the one that builds it (YAGNI — still only 2 entities would use it).
- `TestCycle` has **no create route at all** in this codebase yet — owned by FR-PLAN-3 ("Run a TestCycle under a TestPlan, targeted at a Release, in an Environment"), a separate not-yet-built story. So AC2's "when a TestCycle is created and linked to it" is **not** this story's job to make creatable — only to make **queryable** once one exists (seeded directly in tests, same as PROJ-1's RBAC-fixture-seeding precedent for data this story doesn't own the creation of).

## Scope

### Backend

1. `app/schemas/releases.py` (new):
   - `CreateReleaseRequest {version_label: str, target_date: date | None = None}`
   - `ReleaseSummary {id, project_id, version_label, target_date}`
   - `ReleaseListResponse {items: list[ReleaseSummary], total: int, page: int, page_size: int}` (matches API Doc §1 list-response shape)
   - `TestCycleSummary {id, release_id, test_plan_id, environment_id, name, start_date, end_date}` — for the release→cycles query endpoint
2. `app/api/routes/releases.py` (new):
   - `POST /projects/{project_id}/releases` — create. Fetch `Project` row first (need its `org_id` — no `org_id` path segment here, mirrors PROJ-1's `GET`/`PATCH /projects/{id}` shape, not the `POST /orgs/{org_id}/projects` shape). Missing project OR caller has no `OrgMembership` (any status) in the project's org → `404`. Membership present but no `release.create` → `403` (`has_permission` called directly, same as PROJ-1's row-resolved routes — no path `org_id` for `require_permission`'s dependency to read). Create `Release(project_id=..., version_label, target_date)`. `201 ReleaseSummary`.
   - `GET /projects/{project_id}/releases` — list, same 404-vs-403 boundary, gated `release.read`. Query params: `?page=1&page_size=25` (API Doc §1 convention) + `?sort=target_date&order=asc|desc` (default `target_date asc`, nulls-last — AC3's "listable/sortable by target date"). Returns `ReleaseListResponse`.
   - `GET /releases/{id}` — single fetch, org resolved from the row (same shape as `GET /projects/{id}`), gated `release.read`. Included for symmetry/audit lookup even though no AC names it directly — same PROJ-1 Q4 reasoning (cheap, and a useful anchor for the next route).
   - `GET /releases/{id}/test-cycles` — AC2's query. Org/404-vs-403 resolved from the fetched `Release` → `Project` chain. Gated on **all three**: `release.read` AND `test_cycle.read` AND `test_execution.read` (three separate `has_permission` calls, `403` if any fails — no partial response). Returns each `TestCycle` targeting the release, each with a nested `executions: TestExecutionSummary[]` (reuses execution fields already defined for FR-EXEC scope, or a minimal inline shape if that schema doesn't exist yet — check `app/schemas/` for an existing `TestExecutionSummary` before adding a second one).
3. `app/main.py` — register `releases.router`.
4. RBAC seed data migration (new alembic revision): add `release.create`, `.read`, `.update` to `test_manager`'s bundle in `rbac_seed_catalog.py`, plus a data migration mirroring `d33d66f4b3c3_seed_ai_agent_permissions.py`'s existence-checked insert pattern to backfill existing `test_manager` `RolePermission` rows. `test_manager` already holds `test_cycle.read`/`test_execution.read` (full CRUD on both) from RBAC-4's original seed, so the triple-gate above is already satisfiable by `test_manager` once this migration lands — no separate grant needed for those two.

### Frontend

New `ProjectDetail.tsx` page (route `/projects/:projectId`) — the "select a project" landing page that doesn't exist yet, needed as a place to hang Release UI off of:

- `frontend/src/pages/workflows/ProjectDetail.tsx` (new): fetches releases via `GET /projects/{project_id}/releases` (sorted by `target_date`), renders a `CTable` (version_label, target_date), sortable column header (re-queries with `?sort=target_date&order=...` on click). "New Release" `CModal` (React Hook Form + Zod, same convention as `OrgHome.tsx`'s "New Project" modal) posting to `POST /projects/{project_id}/releases`. Each Release row expands (or links) to `GET /releases/{id}/test-cycles`, rendering cycles + nested executions read-only (audit view — no AC asks for edit here).
- `frontend/src/lib/api/releases.ts` (new): `createRelease`, `listReleases`, `getReleaseTestCycles`.
- `frontend/src/App.tsx`: register `/projects/:projectId` route (`ProtectedRoute`-wrapped, same as `OrgHome`).
- `frontend/src/pages/workflows/OrgHome.tsx`: each Project list item becomes a link to `/projects/{project.id}` (currently local-state-only per PROJ-1's Q5 note — still holds; the link works within the session that created the project, same limitation, not newly introduced).

### Tests

- **Backend unit:** `CreateReleaseRequest`/schema validation; `rbac_seed_catalog.py` bundle-shape test update (`test_manager` now includes `release.*`).
- **Backend integration** (`test_releases.py`):
  - TC-PROJ-004: actor with `release.create` creates a Release → scoped to `project_id`.
  - TC-PROJ-005: seed a Release with 2 `TestCycle`s (seeded directly via `AsyncSessionLocal`, each with `TestExecution` rows) → `GET /releases/{id}/test-cycles` returns both cycles and their nested executions.
  - AC3: create 3 Releases with distinct `target_date`s (including one `null`) → `GET .../releases?sort=target_date` returns them in order, nulls last.
  - 404-vs-403: non-member of the project's org → `404`; member without `release.create`/`.read` → `403`.
  - Triple-gate on `.../test-cycles`: actor with `release.read` but missing `test_cycle.read` (or `test_execution.read`) → `403`, not a partial/degraded response.
  - Cross-org: Release in Project of Org A, actor member of Org B only → `404` on `GET /releases/{id}` and `.../test-cycles`.
- **Frontend unit:** `ProjectDetail.tsx` — release list renders sorted, "New Release" modal validation (Zod), sort-toggle re-fetch.
- **E2E:** `e2e/tests/release-create.spec.ts` — create a Project, navigate to its detail page, create a Release, verify it appears sorted by target_date.

### Docs to update

- `docs/api/2026-09-03-api-design.md` — add the 4 routes to §2 (bespoke) or a new subsection; remove `Release` from §3's generic-factory entity list (footnote, same as `Project`\*\*\*).
- `docs/database/2026-09-03-database-design.md` §3.5 — add Release's creation-flow prose paragraph (mirrors Project's).
- `docs/test-cases/2026-09-03-test-cases.md` — mark TC-PROJ-004/005 covered; add a row for the sort AC if none exists.

## Edge cases

- `target_date` omitted → `null`, sorts last regardless of `asc`/`desc` (Postgres default `NULLS LAST` for `ASC`, `NULLS FIRST` for `DESC` unless overridden — pin this explicitly rather than rely on the default so it doesn't silently flip).
- Two Releases in the same Project with the same `version_label` — AC doesn't require uniqueness, no `UniqueConstraint` in the migrated schema, so duplicates are allowed (unlike Project's `(org_id, name)` uniqueness). Flag as intentional, not an oversight.
- `GET /releases/{id}/test-cycles` on a Release with zero linked cycles → `200` with an empty list, not `404` (Release exists; absence of cycles isn't absence of the Release).
- `AIAgent` calling any of these routes: no hardcoded human-only gate (AC doesn't restrict), same posture as PROJ-1 — currently unreachable in practice unless Q1 grants `release.*` somewhere `ai_agent_scoped`'s bundle reaches (it currently doesn't touch `release.*` either way).

## Out of scope

- `TestCycle` creation route itself (FR-PLAN-3's job).
- Generic CRUD router factory.
- Release `PATCH`/`DELETE` (no AC asks for edit/delete of a Release).

## Docs propagation note

`docs/test-cases` should also get a new TC (or an amendment to TC-PROJ-005) asserting the triple-gate 403 case, and the `Permission`/role-bundle table in the Database Document (§3.3-adjacent) should reflect `test_manager`'s new `release.*` grants.
