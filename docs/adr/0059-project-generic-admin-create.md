# ADR-0059: Generic admin surface can create Projects — bespoke route reused, not replaced

## Status

Accepted

## Context

ADR-0058 made `Project` reachable through the generic admin surface at
`/orgs/:orgId/admin/projects` (list/edit/delete). Its own real `create` was
excluded (`create_schema=None`) because the real `POST /orgs/{org_id}/projects`
(ADR-0017) does more than insert a row: a pre-insert 404-vs-403 org-membership
check, a `standards_profile` omitted-vs-explicit-null inheritance rule read
from the raw request payload, and — the part that matters most — an
unconditional post-insert `RoleAssignment` grant to the creator. Skipping
that grant (as a naive generic `create_item` would) would leave a Project
its own creator can't act on.

On direct instruction, this ADR wires the generic surface's "New" button to
the real bespoke route, without touching its security-relevant logic.

**A `post_create_hook` (mirroring `post_update_hook`, EXEC-2/ADR-0038) was
considered and rejected.** `post_update_hook` only runs after a write, on the
already-updated row — sufficient for its own case (append a `TestLog` row).
This route's steps 1–3 run *before* any insert and need the raw payload
(`org_id` 404 check, `standards_profile`'s conditional-inheritance read) — a
hook shape covering that would mean exposing most of the generic factory's
own create flow to a per-entity override, a materially bigger change than
this ask needed. The existing "get`/`update` are bespoke but reported via
`full_methods`" precedent (already in place for `Project`) already solves
the actual problem: the frontend doesn't care who registered a route, only
that it exists at the path/method it expects.

**A real, deliberate behavior change was needed to make this reuse work at
all.** `EntityForm` (the generic admin surface's create modal) always
submits every editable field as an explicit key — a blank optional field
serializes as JSON `null`, never an omitted key (`handleFormSubmit`'s own
empty-string→`null` normalization). The bespoke route's original
`"standards_profile" not in payload.model_fields_set` check therefore could
never see "omitted" through this path — an explicit `null` (any blank
`standards_profile` field submitted through the generic form) would have
permanently defeated ADR-0017 Q3's org-default inheritance for every
`Project` created this way. Fixed by collapsing the omitted-vs-explicit-null
distinction into one case (`payload.standards_profile is None`) — the
distinction never served a real product requirement (ADR-0017 Q3 named it as
a safer default for a direct API caller, not something a UI needed to
expose), and a direct API caller can still send `{"standards_profile": null}`
to get the same inheritance omission would have given, just also.

## Decision

- `_PROJECT_FACTORY_CONFIG`: `create_schema=CreateProjectRequest` (schema-
  metadata only — `"create"` is **not** added to `config.methods`, so
  `make_crud_router` still doesn't register a competing route at `/projects`)
  and `"create"` added to `full_methods` (so the served
  `GET /entities/project/schema` reports it as available).
- `create_project`'s `standards_profile` resolution changed from
  `"standards_profile" in payload.model_fields_set` to
  `payload.standards_profile is None` — omitted and explicit `null` are now
  identical inputs, both inheriting the org default. All other steps
  (404-vs-403, permission check, name-collision `422`, the `RoleAssignment`
  grant) are **byte-for-byte unchanged**.
- `frontend/src/entityConfigs/overrides.ts`: `ROUTE_OVERRIDES.projects =
  { createPath: "/orgs/:orgId/projects" }` — same `:param`-interpolation
  mechanism `Release`'s own override already established (ADR-0053).
  `listPath` is left unset (the plain `/projects` default already fits;
  only `create` is org-path-nested).
- `useAdminRouteContext.ts`'s `routeParams.orgId` changed from the raw
  `:orgId` route param to the already-resolved `orgId` value (same value
  this hook's own `orgId` field returns). Found during implementation: on
  the project-scoped route (`/projects/:projectId/admin/projects`, no
  `:orgId` segment in the URL), the raw param is `undefined` — the new
  `createPath` override would have interpolated to a broken URL there even
  though the org id is already known (via the existing two-hop
  `scopeResolution` fetch). No other caller of `routeParams.orgId` existed
  to be affected by resolved-vs-raw (verified via grep — nothing else reads
  it).
- `TC-PROJ-007` (an existing, passing integration test) amended in place:
  it asserted the *opposite*, pre-amendment behavior (explicit `null`
  overrides the org default to stay `null`). Renamed and re-asserted for
  the new behavior, with its own docstring explaining why. The schema-level
  unit test (`test_projects_schemas.py`) needed no assertion change — Pydantic
  still distinguishes omitted-vs-null mechanically, only which route
  *consults* that distinction changed (create doesn't; `PATCH`'s
  `UpdateProjectRequest`/`exclude_unset` semantics are untouched).

## Consequences

- The generic admin surface's "New" button now works for `Project` at both
  `/orgs/:orgId/admin/projects` (org-scoped, ADR-0058) and
  `/projects/:projectId/admin/projects` (project-scoped, pre-existing) —
  both resolve the same real `orgId` and hit the same real create route.
- A direct API caller who relied on "explicit `null` clears the field, never
  inherits" loses that specific capability — they can still request a
  non-null value, or accept the org default; there is no longer a way to
  force `standards_profile` to `null` when the org has a non-null default.
  No known caller depended on this (only `test_projects.py`'s own now-amended
  test exercised it).
- Verified: backend unit 467/467, the 2 directly-touched unit files re-run
  alone 79/79; backend integration `test_projects.py` 18/18 against a real
  isolated stack (fresh DB clone from `main`, real Postgres, real
  `RoleAssignment` grant path exercised); frontend `tsc --noEmit` clean,
  full Vitest suite 73/73 files / 512/512 tests, including a new end-to-end
  test proving the whole chain (`EntityListPage` "New" → real `createEntity`
  → real interpolated URL) without mocking the pieces this ADR actually
  changed.

## Alternatives considered

- **New `post_create_hook` on `CrudEntityConfig`.** Rejected — see Context;
  this route's pre-insert logic doesn't fit a post-write hook shape without
  a much larger factory redesign than this ask needed.
- **Flat `/projects` create with `org_id` in the request body** (the
  generic factory's normal shape for an org-scoped entity). Rejected per
  direct instruction — keeps the existing, already-correct, already-tested
  bespoke route and its URL exactly as they are; a flat route would need to
  either duplicate the `RoleAssignment`-grant logic or leave the bespoke
  route as dead code.
- **Leave the omitted-vs-explicit-null distinction intact, special-case
  `EntityForm` to omit blank optional fields instead of sending `null`.**
  Rejected — `EntityForm`'s null-for-blank normalization is a shared,
  generic-surface-wide convention every other entity's create/edit already
  depends on; carving out a per-entity exception there would be a second,
  narrower version of the same "invented complexity for one entity" problem
  the rejected `post_create_hook` option already illustrates.
