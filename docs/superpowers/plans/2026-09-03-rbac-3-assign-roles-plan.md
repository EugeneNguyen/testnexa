# RBAC-3: Assign roles, org-wide or project-scoped — Plan

**Date:** 2026-09-03
**Story:** [RBAC-3](../../user-stories/2026-09-03-rbac-tenancy-stories.md#story-rbac-3-assign-roles-org-wide-or-project-scoped)
**Related:** ADR-0004 (RBAC design), ADR-0007 (tenancy), ADR-0015 (404-vs-403 boundary, `has_permission`/`require_permission` project_id design), [Database Doc §3.3](../../database/2026-09-03-database-design.md)

## Decisions (confirmed with user)

- **Cross-org `project_id`/`role_id` in the create body → `422`**, not `404` — validation failure on a body field, not a path-resource existence check; the 404-vs-403 boundary already hid the org's own existence before this point.
- **Creating a `RoleAssignment` for a `User` actor gates on that `User` already holding an `OrgMembership` (any status) in `org_id`** — no membership → `422`. `AIAgent` actors are exempt (no `OrgMembership` concept, same precedent as `organizations.py`/`agents.py`).
- **`GET /orgs/{org_id}/role-assignments` (list) is in scope** — same 404-vs-403 + `require_permission("role_assignment.read")` pattern as every other org-scoped list.

## What already exists (do not rebuild) — updated post-merge (main now has PROJ-1)

- `Role`/`Permission`/`RolePermission`/`RoleAssignment` models + tables, fully migrated (RBAC-4). `role_assignment.create`/`.read`/`.update`/`.delete` and `project.create`/`.read`/`.update`/`.delete` already in the seeded `Permission` catalog.
- `has_permission(actor_id, org_id, code, project_id=None)` — join chain already branches on `project_id`: `None` → org-wide grants only (`RoleAssignment.project_id IS NULL`); given → project-scoped grants for that `project_id`. Written by AUTH-4, unexercised by any real route yet ("RBAC-3 owns that coverage when it lands" — `app/core/rbac.py` docstring).
- `require_permission(code)` — reads `project_id` off `request.path_params`, generic to any route shape. Also unexercised for the project-scoped branch.
- `get_current_actor` resolves `User` (JWT) or `AIAgent` (API key) uniformly — `RoleAssignment.actor_id` FKs to `actor.id`, already accepts either.
- Established route pattern (`agents.py`/`organizations.py`): `get_current_actor` → 404-vs-403 boundary (any-status `OrgMembership` check on path `org_id`) → `require_permission(code)` called directly in the route body → business logic → bespoke `_error()` JSON shape.
- **PROJ-1 (just merged from main, ADR-0017) already built `Project` routes** — resolves former open question #1, no new Project routes needed:
  - `POST /orgs/{org_id}/projects` (`project.create`, org-scoped, same 404-vs-403 pattern).
  - `GET /projects/{id}` / `PATCH /projects/{id}` — no `org_id` in path, row fetched first, its own `org_id` used for the 404-vs-403 boundary.
  - Creator unconditionally gets a **project-scoped** `test_manager` `RoleAssignment` on the project they just created.
- **New finding from reading PROJ-1's code (`app/api/routes/projects.py`):** `get_project`/`update_project` call `has_permission(actor_id, org_id, code)` **without** passing `project_id`. That only checks org-wide grants (`project_id IS NULL`) — a project-scoped-only grant never satisfies it. Concretely: the project's own creator, who is only auto-granted a **project-scoped** `test_manager` role on their own project (not org-wide), currently cannot `GET`/`PATCH` the project they just created unless they're separately `org_admin` org-wide. This is the exact gap RBAC-3's AC2 ("permissions from a project-scoped role apply within that project") is about — `has_permission`'s `project_id` branch exists but nothing passes it in yet. **Fixing this is now in this story's scope** (item 3 below), not a new-route build.
- No generic CRUD router factory exists yet for the other ~22 entities (API Doc §3 is design-only for those).
- RBAC-2 (invite/suspend members) is **not yet built** — no invite route, no way to add a member to an org except via signup/`POST /orgs` (both auto-grant `org_admin`).

## Gap this story fills

1. An actual endpoint to create a `RoleAssignment` (org-wide or project-scoped) — nothing lets an `org_admin` grant one today outside the auto-grants baked into signup/`POST /orgs`/`POST /orgs/{org_id}/projects`.
2. Wire `project_id` into `get_project`/`update_project`'s `has_permission` calls so a project-scoped grant actually works within its project (found above, scope item 5) — the first real HTTP-level exercise of `has_permission`'s project-scoped branch, satisfying AC2/AC3 with genuine requests instead of deferring like RBAC-1 deferred TC-RBAC-002.

## Scope

### Backend

1. **`app/schemas/rbac.py`** (new) — `CreateRoleAssignmentRequest {actor_id: UUID, role_id: UUID, project_id: UUID | None = None}`, `RoleAssignmentSummary {id, actor_id, org_id, project_id, role_id, created_at}`.
2. **`app/api/routes/role_assignments.py`** (new) — `POST /orgs/{org_id}/role-assignments`:
   - `get_current_actor` → 404-vs-403 boundary (caller has zero `OrgMembership` in `org_id` → 404) → `require_permission("role_assignment.create")`.
   - Validate `role_id` resolves to a `Role` usable in this org: `Role.org_id IS NULL` (system template) OR `Role.org_id == org_id`. Otherwise → `422` (cross-org/unknown role).
   - Validate `actor_id` resolves to an existing `Actor` row (`User` or `AIAgent`). Otherwise → `422`.
   - **If the resolved `Actor` is a `User`, require an `OrgMembership` (any status) for that user in `org_id`.** Otherwise → `422` ("actor is not a member of this organization"). Skipped entirely for `AIAgent` actors (no `OrgMembership` row ever exists for one — same posture `organizations.py`/`agents.py` already take).
   - If `project_id` given, validate it resolves to a `Project` with `Project.org_id == org_id`. Otherwise → `422` (never `404` — validation failure on a request body field, not a path-resource lookup; matches the `slug`-collision precedent's posture).
   - Insert `RoleAssignment(actor_id, org_id, project_id, role_id)`. Duplicate (unique constraint `uq_role_assignment_actor_org_project_role`) → catch `IntegrityError` → `422`, same pattern as `organizations.py`'s slug collision.
   - Response: `RoleAssignmentSummary`, `201`.
3. **`app/api/routes/role_assignments.py`** — `GET /orgs/{org_id}/role-assignments`: same 404-vs-403 boundary → `require_permission("role_assignment.read")` → return every `RoleAssignment` row with `org_id == org_id` (org-wide and project-scoped both included; no `project_id` query filter for this story — not asked for). Response: `list[RoleAssignmentSummary]`.
4. **`app/main.py`** — register `role_assignments.router`.
5. **`app/api/routes/projects.py`** — fix `get_project`/`update_project` to pass `project_id=id` (the row's own id) to `has_permission`, so the check becomes "org-wide grant on `project.read`/`.update` in this org OR project-scoped grant on this specific project" rather than org-wide-only. This is the actual AC2/AC3 enforcement fix — no new route needed, PROJ-1's routes already have the right shape (row fetched, its `org_id` known) to pass `project_id` through; they just don't yet.

### Tests

- **Backend unit:** `CreateRoleAssignmentRequest` schema validation.
- **Backend integration** (`test_role_assignments.py`, new):
  - Create-endpoint mechanics: 201 happy path (org-wide and project-scoped), 404 for caller with no `OrgMembership` in `org_id`, 403 for caller lacking `role_assignment.create`, 422 for cross-org `role_id`, unknown `actor_id`, cross-org `project_id`, duplicate assignment, **and a `User` `actor_id` with zero `OrgMembership` in `org_id`**.
  - List-endpoint mechanics: 200 returns both org-wide and project-scoped rows for the org, 404/403 same boundary as create, cross-org rows never leak.
  - TC-RBAC-011 — grantee is an `AIAgent` → assignment succeeds identically to a human `User` grantee (membership gate skipped), and the AIAgent's own subsequent authenticated call resolves the granted permission the same way.
- **`backend/tests/integration/test_projects.py` (extend existing file)** — this is where AC1/AC2/AC3 get their real HTTP-level proof, via the now-fixed `GET`/`PATCH /projects/{id}`:
  - TC-RBAC-008 — actor with an org-wide grant (`project_id=None`) can `GET`/`PATCH` every project in the org, not just one.
  - TC-RBAC-009 — actor with a grant scoped to Project A can `GET`/`PATCH` Project A but gets 403 on Project B (same org).
  - TC-RBAC-010 — actor with `OrgMembership` in the org but zero `RoleAssignment` anywhere → 403 on any project in that org (no implicit access from membership alone).
  - Regression check: the project creator (project-scoped `test_manager` only, per ADR-0017) can now `GET`/`PATCH` their own project without also being org-wide `org_admin` — proves the fix, not just the new endpoint.

### Docs to update (propagation)

- `docs/api/2026-09-03-api-design.md` — add `POST`/`GET /orgs/{org_id}/role-assignments` contracts; note the `GET`/`PATCH /projects/{id}` permission check is now project-id-aware (not org-wide-only).
- `docs/test-cases/2026-09-03-test-cases.md` — mark TC-RBAC-008/009/010/011 covered.
- `docs/database/2026-09-03-database-design.md` — no schema change; skip unless review finds a gap.

## Edge cases

- Duplicate `RoleAssignment` (same actor/org/project/role) → `422` via the existing unique constraint, not a silent no-op.
- `role_id` belonging to a *different* org's custom role → `422`, never leaks whether that role exists (no cross-org enumeration).
- `project_id` belonging to a different org → `422` (confirmed decision, above).
- `actor_id` that's a valid `Actor` but the *wrong* kind for context (e.g., nothing here restricts assigning to an `AIAgent` — AC4 explicitly wants that to work) — no additional gate beyond "Actor exists," and the membership gate is skipped for `AIAgent`s entirely.
- Assigning a role to a `User` with **no** `OrgMembership` in the org at all → `422` (confirmed decision, above) — any status (`invited`/`active`/`suspended`) satisfies the gate, matching the existing any-status `_org_membership_exists` precedent (a suspended member can still have roles managed ahead of reactivation, per RBAC-2's own AC that suspension keeps `RoleAssignment`s recorded).
- `org_admin` assigning a role to *themselves* — not blocked; no story text forbids it.
- Non-human caller (`AIAgent`) with `role_assignment.create` calling this route — not blocked; no human-only gate is specified by this story (unlike RBAC-5's Approval rule).

## Out of scope

- RBAC-2 (invite/suspend members) — untouched.
- RBAC-5 (human-only Approval enforcement) — already done, unrelated.
- Full generic CRUD router factory for the other ~22 entities — `Project` already has its own bespoke routes (PROJ-1), nothing further needed here.
- `DELETE`/revoke of a `RoleAssignment` — not asked for by any AC.
- Role management UI (create custom roles, assign-role screen) — no story text or existing frontend precedent asks for one yet; this story is API-only, matching AUTH-4's posture.
