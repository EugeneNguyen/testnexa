# ADR-0058: `Project` registered in `orgScopedEntities`, generic admin surface reachable at `/orgs/:orgId/admin/projects`

## Status

Accepted

## Context

Per direct instruction, the generic ADR-0025 admin CRUD surface (list/edit/
delete, reused via [ADR-0057](0057-admin-crud-pages-relocated-to-container.md)'s
`entityCrudRoutes()`) should work for "Project CRUD inside an org" — i.e.
`/orgs/:orgId/admin/projects` should list the Projects belonging to `:orgId`,
scoped automatically from the URL, no manual filter UI.

Investigation found this needs **no new filtering mechanism**. The generic
surface already has one, entity-agnostic: `useEntityScope.ts` resolves a
`{field, value}` scope pair from an entity's backend-declared `scope_field`
plus whatever route params are in context — for a plain `scope_field ===
"org_id"` entity reached via an `:orgId`-carrying route, the value comes
straight from the route param, no fetch, no `ScopeSelector` UI (`useEntityScope.ts`'s
own documented "shape B"). `Project`'s backend config
(`_PROJECT_FACTORY_CONFIG`, `backend/app/api/routes/projects.py`) already
declares `scope_field="org_id"` — this has been true since ADR-0022. The only
actual gap: `frontend/src/pages/admin/registry.ts` had `projects` registered
under `projectScopedEntities` only, so the generic route was reachable at
`/projects/:projectId/admin/projects` (self-referential — resolves the *same*
org via `Project`'s own `scopeResolution` fetch) but not at
`/orgs/:orgId/admin/projects` (the direct, no-fetch org-scoped path this ask
wants).

`Project` also has no generic `create` (`full_methods` excludes it) — its
real create is the bootstrap-aware bespoke route (ADR-0017, auto-grants the
creator a `RoleAssignment`); a generic create would skip that. This surface
gives list/edit/delete only, same as it already did via the project-scoped
path.

Adding `projects` to `orgScopedEntities` has a side effect: `AppSidebar.tsx`'s
`ORG_ENTITY_GROUPS` must be a complete, non-overlapping partition of that
registry (enforced by `AppSidebar.test.tsx`'s TC-SHELL-025), so every entry
needs a group or an explicit exclusion. `projects` cannot get a group entry —
ADR-0047's bespoke `ProjectsPage` (flat sidebar item "Projects",
`/orgs/:orgId/projects`) is the real, already-shipped nav path; a second
"Projects" link pointing at the generic admin surface would read as a
confusing duplicate. The project side already solved the identical problem
for the identical entity: `PROJECT_EXCLUDED_ENTITY_KEYS` already lists
`projects` for this exact reason. This ADR adds the mirror-image
`ORG_EXCLUDED_ENTITY_KEYS` for the org side.

## Decision

- `registry.ts`: `entry("Projects", "projects")` added to `orgScopedEntities`
  (kept in `projectScopedEntities` too, unchanged — the pre-existing
  project-scoped path is left as-is, not removed).
- `AppSidebar.tsx`: new `export const ORG_EXCLUDED_ENTITY_KEYS: string[] =
  ["projects"]`, mirroring `PROJECT_EXCLUDED_ENTITY_KEYS`'s existing shape and
  rationale.
- `AppSidebar.test.tsx`'s TC-SHELL-025 updated to assert a groups-plus-
  exclusions partition (registry length 9, `seen + ORG_EXCLUDED_ENTITY_KEYS`
  sorted-equals the registry, no overlap between the two) instead of a flat
  8-entity partition — mirrors TC-SHELL-035's identical discipline on the
  project side. TC-SHELL-026's icon-exclusivity loop skips excluded keys
  (nothing renders for them to check).
- No backend change — `scope_field="org_id"` already existed; no schema,
  route, or RBAC change.

## Consequences

- `/orgs/:orgId/admin/projects` now works: lists Projects scoped to `:orgId`
  directly off the route param, no extra fetch. Edit/Delete work the same
  way they already did via the project-scoped path. Create is absent by
  design (see Context) — same as before this change.
- No new sidebar link — `ProjectsPage` (ADR-0047) remains the sole nav-
  reachable path for Project CRUD; the generic route is reachable by direct
  URL only, same posture the project-scoped `projects` entry already had.
- Sitemap doc's org-scoped table, route-tree ASCII sketch, and entity-count
  note updated. SHELL-7's own user-story ACs (which stated "8 entities" as
  their own delivered scope) get a forward-pointing addendum, not a rewrite —
  they're an accurate historical record of what that story shipped.
- Verified: `tsc --noEmit` clean, full Vitest suite green (`AppSidebar.test.tsx`
  27/27, no regressions elsewhere).

## Alternatives considered

- **A new `defaultFilters`-style mechanism on `entityCrudRoutes()`/
  `EntityListPage`, baking a fixed filter into the route registration
  itself.** Rejected — redundant with the scope-resolution mechanism that
  already exists and is entity-agnostic; building a second, parallel
  filtering concept for the same problem the schema-driven `scope_field`
  already solves would be the kind of "two independently-maintained lists
  describing the same thing" drift root `CLAUDE.md`'s `entityConfigs`
  drift note already warns against, just invented fresh instead of avoided.
- **Move `projects` out of `projectScopedEntities` instead of adding it to
  `orgScopedEntities`.** Rejected — no reason to remove pre-existing,
  presumably-in-use behavior; this ask is additive, not a replacement.
- **Give `projects` its own sidebar group entry instead of excluding it.**
  Rejected — duplicates `ProjectsPage`'s existing nav-reachable Project CRUD
  with a second, differently-scoped "Projects" link, confusing UX for no
  stated benefit.

### Amendment (2026-09-12, [ADR-0059](0059-project-generic-admin-create.md))

Consequences' "Create is absent by design — same as before this change" no
longer holds: on direct instruction, ADR-0059 wired the generic surface's
"New" button to the existing bespoke `POST /orgs/{org_id}/projects`
(unchanged security logic — see that ADR). This paragraph is left as-written
above (accurate as of this ADR's own original scope); ADR-0059 is the record
of the follow-on decision, not a silent edit here.
