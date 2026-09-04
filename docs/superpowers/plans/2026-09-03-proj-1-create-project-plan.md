# PROJ-1: Create a Project — Plan

**Date:** 2026-09-03
**Story:** [PROJ-1](../../user-stories/2026-09-03-project-release-stories.md#story-proj-1-create-a-project)
**Related:** ADR-0004 (RBAC design), ADR-0007 (real multi-tenancy, 404-vs-403 boundary), [Database Doc §3.5](../../database/2026-09-03-database-design.md), [API Doc §3](../../api/2026-09-03-api-design.md), RBAC-1 plan (established bespoke-route + 404-vs-403 pattern this story reuses)

## Decisions (confirmed with user, 2026-09-03)

All Q1–Q6 below confirmed as proposed — assumptions/suggestions in each are the final design, no changes.

## Open questions (resolved, kept for rationale)

**Q1 — Route path shape.**
API Doc §3 lists `Project` under the generic-factory path shape (`/projects`, `/projects/{id}`, org resolved indirectly), but the factory itself doesn't exist yet — every org-scoped route built so far (`agents.py`, `organizations.py`) is bespoke and puts `org_id` in the path so it can reuse `require_permission`'s existing path-param read and the established 404-vs-403 check as-is.
- **Assumption/suggestion:** `POST /orgs/{org_id}/projects` for create (matches `agents.py` exactly, zero new plumbing). `GET/PATCH /projects/{id}` for read/update (org resolved from the fetched row, same as a future generic-factory item-route would do) — update API Doc §3 with a footnote on `Project` mirroring the existing `Organization`\* footnote ("create is bespoke and org-path-scoped, read/update aren't").

**Q2 — Creator's project-scoped role.**
AC1 says "a project-scoped role appropriate to their action (e.g. `test_manager` if they're already `org_admin`)" — vague beyond the example. Checking RBAC-4's seeded bundles, only `org_admin`'s bundle currently includes `project.create` at all (`test_manager`/`tester`/`auditor`/`ai_agent_scoped` have no `project.*`), so "org_admin creates it" is the only reachable case today.
- **Assumption/suggestion:** always assign the creator a project-scoped (`project_id=<new project>`, `org_id` same) `RoleAssignment` to the seeded `test_manager` `Role`, unconditionally — not dynamic role-mapping logic for hypothetical custom roles that don't exist yet. Document as a known simplification (same posture as RBAC-1's "no hardcoded human-only gate" call).

**Q3 — `standards_profile` default inheritance.**
`Organization.default_standards_profile` already exists in the schema (07 ERD-sourced) and is otherwise unused by any route today. Its evident purpose is "org-wide default a new Project inherits if it doesn't set its own."
- **Assumption/suggestion:** if `standards_profile` is omitted from the create payload, inherit `Organization.default_standards_profile` (itself possibly null); if the caller supplies a value (including explicit `null`), use it as given. Requires reading the request with `exclude_unset` to distinguish "omitted" from "explicit null."

**Q4 — `GET /projects/{id}`.**
Not explicitly required by any AC, but `PATCH` needs fetch-by-id internally anyway, and the frontend needs something to render after creation / before editing `standards_profile`.
- **Assumption/suggestion:** add a minimal `GET /projects/{id}` alongside `POST`/`PATCH` — same 404-vs-403 boundary, `project.read` gate.

**Q5 — Frontend scope.**
RBAC-1 included a small frontend slice (Signup page, "New Organization" modal on `OrgPicker`). PROJ-1's AC text is Priya-framed the same way.
- **Assumption/suggestion:** add a minimal CoreUI "New Project" modal + project list to `OrgHome.tsx` (creates via `POST /orgs/{org_id}/projects`, shows `standards_profile` inline-editable via `PATCH`) — not a full project-management screen, just enough to exercise the flow end-to-end like RBAC-1 did for orgs.

**Q6 — TC-PROJ-002 (no orphaned assets) coverage.**
Requirement/TestSuite/TestPlan models already have non-nullable `project_id` FKs (schema-level enforcement already exists, no code change needed for the AC itself), but none of those entities has a create route yet (generic factory unbuilt) — so "attempt to create one without `project_id` → 422" isn't actually exercisable via the API yet.
- **Assumption/suggestion:** mark TC-PROJ-002 covered-at-schema-level, execution-deferred — same posture RBAC-1's plan took for TC-RBAC-002, owned by whichever story adds the first Requirement/TestSuite/TestPlan create route.

---

## What already exists (do not rebuild)

- `Project` model + table, fully migrated (`backend/app/models/project.py`, `fbf02a6e4764_initial_schema.py`): `id`, `org_id` (FK, not null, indexed), `name` (not null), `standards_profile` (nullable), unique `(org_id, name)`.
- `Organization.default_standards_profile` column, migrated, currently unread by any code path.
- `Role`/`RoleAssignment`/`Permission`/`RolePermission`, RBAC-4 seeded system roles including `project.create`/`.read`/`.update` in `org_admin`'s full bundle.
- `has_permission(actor_id, org_id, code, project_id=None)`, `require_permission(code)` (path-param-based), `get_current_actor` — all real, reusable as-is.
- Established route pattern (`agents.py`): 404-vs-403 boundary (any-status `OrgMembership` check on path `org_id`) before `require_permission` invoked directly in the route body.
- `organizations.py`'s inline-gate + flush-then-catch-`IntegrityError`-for-422 pattern (for the `(org_id, name)` unique constraint here, same as `(org_id, slug)` there).

## Scope

### Backend

1. `app/schemas/projects.py` (new) — `CreateProjectRequest {name, standards_profile: str | None = None}`, `UpdateProjectRequest {name: str | None = None, standards_profile: str | None = None}` (partial, `exclude_unset` semantics), `ProjectSummary {id, org_id, name, standards_profile}`.
2. `app/api/routes/projects.py` (new):
   - `POST /orgs/{org_id}/projects` — 404-vs-403 boundary (any-status `OrgMembership` in `org_id`) → `require_permission("project.create")` → create `Project` (name, standards_profile-or-inherited-default per Q3) → flush, catch `IntegrityError` on `(org_id, name)` → `422` → creator's project-scoped `test_manager` `RoleAssignment` (Q2) → commit → `201 ProjectSummary`.
   - `GET /projects/{id}` (Q4) — fetch row first; missing row OR caller lacks any-status `OrgMembership` in the row's `org_id` → `404`; membership present but no `project.read` → `403` (via `has_permission`, called inline since `org_id` isn't a path param here — same non-`Depends` posture as the create route's own inline check).
   - `PATCH /projects/{id}` — same fetch-then-boundary as `GET`, gate `project.update`, partial-update `name`/`standards_profile`, `422` on rename collision.
3. `app/main.py` — register `projects.router`.

### Frontend (Q5)

- `frontend/src/lib/api/projects.ts` (new) — `createProject`, `getProject`, `updateProject`.
- `frontend/src/pages/workflows/OrgHome.tsx` — project list + "New Project" CoreUI modal (name, optional standards_profile) calling `createProject`; inline `standards_profile` edit calling `updateProject`.

### Tests

- **Backend unit:** `CreateProjectRequest`/`UpdateProjectRequest` schema validation; `exclude_unset` omitted-vs-null distinction for `standards_profile`.
- **Backend integration** (`test_projects.py`):
  - TC-PROJ-001: `org_admin` creates a Project → scoped to `org_id`, creator gets project-scoped `test_manager` `RoleAssignment`.
  - TC-PROJ-003: create with `standards_profile` set → persists; omit at create + org has `default_standards_profile` → inherited; `PATCH` by an actor holding `project.update` → persists new value.
  - `(org_id, name)` collision → `422`.
  - 404-vs-403: non-member of `org_id` → `404`; member without `project.create`/`.read`/`.update` → `403`.
  - Cross-org `GET`/`PATCH` (TC-RBAC-002, now achievable — first tenant-scoped CRUD route) → `404`.
- **E2E:** `e2e/tests/project-create.spec.ts` — create + edit standards_profile via the `OrgHome` UI.

### Docs to update (propagation)

- `docs/api/2026-09-03-api-design.md` — add `POST /orgs/{org_id}/projects`, `GET/PATCH /projects/{id}` contracts; footnote on `Project`'s generic-factory listing (Q1).
- `docs/database/2026-09-03-database-design.md` — note `default_standards_profile` inheritance behavior in prose (schema itself unchanged).
- `docs/test-cases/2026-09-03-test-cases.md` — mark TC-PROJ-001/003 covered, TC-PROJ-002 covered-at-schema-level/execution-deferred (Q6), TC-RBAC-002 now covered.

## Edge cases

- Rename `PATCH` colliding with another Project's `name` in the same org → `422`, same shape as create.
- `standards_profile` explicit `null` in a `PATCH` payload clears it (distinct from omitting the field, which leaves it unchanged) — same `exclude_unset` handling as create's inherit-vs-override.
- `AIAgent` calling `POST /orgs/{org_id}/projects`: no hardcoded gate (AC doesn't restrict to humans); unreachable in practice since no seeded bundle gives `ai_agent_scoped` `project.create`, same reasoning RBAC-1 used for `POST /orgs`.
- Actor with `project.create` only as a project-scoped grant on some *other* project (not org-wide): current `require_permission` reads `project_id` from path params, which `POST /orgs/{org_id}/projects` has none of → resolves as an org-wide-only check, consistent with `has_permission`'s existing default.

## Out of scope

- Generic CRUD router factory for the other ~23 entities (Requirement, TestSuite, TestPlan, etc.) — TC-PROJ-002's live-execution path is blocked on this, noted in Q6.
- Custom per-org roles holding `project.create`/`.update` (Q2's simplification covers only the seeded-roles-as-they-exist-today case).
- Release (PROJ-2) — separate story, not touched here despite sharing `project.py`.
