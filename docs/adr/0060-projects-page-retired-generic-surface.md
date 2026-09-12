# ADR-0060: `ProjectsPage` retired — Project CRUD moves to the generic admin surface

## Status

Accepted. **Supersedes [ADR-0047](0047-proj-4-projects-page-sidebar-entry.md).**

## Context

Per direct instruction, the bespoke `ProjectsPage` (PROJ-4/ADR-0047 — full
Project CRUD table extracted out of `OrgHome`) is retired in favor of the
generic admin surface `EntityListPage`/`EntityFormPage` (ADR-0025), which
ADR-0058/ADR-0059 had already brought to full List/Create/Edit/Delete parity
for `Project`. Same URL (`/orgs/:orgId/projects`), same sidebar nav item —
nothing else in the app needed to change.

Two gaps had to close first, both closed in the same pass as the swap:

1. **Search.** `Project`'s backend config had no `search_fields`, so the
   generic surface's `?q=` box would have silently no-op'd (ADR-0022's
   documented behavior for an unconfigured entity) — a real regression from
   `ProjectsPage`'s own working client-side name filter. Fixed:
   `search_fields=("name",)`.
2. **Row navigation into `ProjectDetail`.** `ProjectsPage` linked each row's
   name to `/projects/:id` — `EntityTable` has no such concept at all (every
   other generic entity's own "detail view" is its edit form, not a separate
   workspace page). Fixed generically, not with a one-off hack: `EntityConfig`
   gained `detailPath`/`detailLinkField` (a route template + which field's
   cell becomes the link), consumed by `EntityTable`'s `renderCell`. Set for
   `Project` only, via `entityConfigs/overrides.ts` (`detailPath: "/projects/:id"`,
   `detailLinkField: "name"`) — the same frontend-only route-wiring layer
   ADR-0053 already carved out.

**A route-shape problem, solved by extending existing plumbing rather than
inventing new plumbing.** `EntityListPage`/`EntityFormPage` require a literal
`:entity` route segment (`useAdminRouteContext`'s `params.entity`) — but
`/orgs/:orgId/projects` (the URL to keep, per direct instruction) has none.
Fix: both components accept an optional `entityKeyOverride` prop, threaded
into `useAdminRouteContext(overrideEntityKey?)` as `overrideEntityKey ??
params.entity`. `App.tsx` mounts `<EntityListPage entityKeyOverride="projects" />`
at `/orgs/:orgId/projects` and a new `<EntityFormPage entityKeyOverride="projects" />`
at `/orgs/:orgId/projects/:id/edit` (a route `ProjectsPage` never needed — its
own edit was a modal, not a route).

**A real, previously-latent bug found only by live browser verification, not
by any Vitest mock.** After wiring the above, the new `/orgs/:orgId/projects`
route rendered "No records found." permanently — the list query never fired.
Root cause, in `useEntityScope.ts`: `Project`'s backend config always carries
a `scopeResolution` (needed for its *project-scoped* generic-admin route,
`/projects/:projectId/admin/projects`, where `org_id` must be fetched via the
current Project row) — and `derive_entity_schema` serves that
`scopeResolution` unconditionally, regardless of which frontend route is
asking. `useEntityScope`'s branch order checked `scopeResolution` **before**
the plain `scopeField === "org_id" && routeParams.orgId` check — so on any
route where `:orgId` is already directly present but `:projectId` is not
(both `/orgs/:orgId/projects` here, and, retroactively discovered, ADR-0058's
own `/orgs/:orgId/admin/projects`), the `scopeResolution` branch won anyway,
tried to resolve via the absent `:projectId`, stayed permanently disabled,
and `scope.ready` never became `true` — silently, no error, no console
warning. **This means ADR-0058's own "scope resolves immediately from
`:orgId`, no fetch" claim was never actually true for `Project`** — its own
Vitest coverage (`EntityListPage.projectsCreate.test.tsx`) never caught it
because that test's hand-built config fixture omitted `scopeResolution`
entirely, not matching the real backend-served shape.

Fix: reordered `useEntityScope`'s branches so the direct-from-route-params
check runs first, `scopeResolution` only as a fallback when the direct
value isn't present. Safe for every other entity — `Project` is the only one
with both a `scopeField` directly satisfiable from route params *and* a
`scopeResolution` at the same time; reordering has no effect where only one
of the two exists. A new dedicated test (`useEntityScope.test.tsx`) encodes
exactly this priority, using the real backend-shaped config (both fields
set) — the gap the old fixture-based tests structurally couldn't see.

## Decision

- `_PROJECT_FACTORY_CONFIG`: `search_fields=("name",)` added.
- `EntityConfig` gains `detailPath?: string; detailLinkField?: string`.
  `EntityTable.renderCell`'s default branch wraps the designated field's
  cell in a `<Link>` when both are set on the config. Set for `projects`
  only in `entityConfigs/overrides.ts`.
- `EntityListPage`/`EntityFormPage` gain an optional `entityKeyOverride`
  prop, threaded through `useAdminRouteContext`. Every other mount (the
  generic `:entity`-parameterized routes) omits it, unaffected.
- `App.tsx`: `ProjectsPage`'s route replaced by
  `<EntityListPage entityKeyOverride="projects" />` at the same URL, plus a
  new `<EntityFormPage entityKeyOverride="projects" />` at
  `/orgs/:orgId/projects/:id/edit`. `ProjectsPage.tsx` + its test file
  deleted outright (`pages/workflows/README.md` updated to match).
- `useEntityScope.ts`: the plain `scopeField`-from-route-params branches
  moved before the `scopeResolution` branch (see Context for why).
- `AppBreadcrumb.tsx` gains a pattern for the new
  `/orgs/:orgId/projects/:id/edit` route (`ProjectsPage` never had an edit
  *route* to need one for).
- e2e specs revised in place for the new markup: `project-create.spec.ts`
  (button text "New" not "New Project", heading "Edit Projects" not "Edit
  Project", empty-state "No records found." not "No projects yet" — the
  row-name-links-to-`ProjectDetail` step needed no change) and
  `ds2-table-container.spec.ts`'s Project-table case (rewritten from
  client-mode to server-mode: default page size 25 not 10, `entity-table-*`
  testids not `project-table-*`, seed count bumped to force pagination at
  the new default).

## Consequences

- `ProjectsPage.tsx` (549 lines) and its own Vitest suite (49 tests) are
  gone; the generic surface's own existing coverage
  (`EntityListPage`/`EntityForm`/`EntityTable` test files) is what's left
  exercising this screen's shared logic — no per-entity duplicate coverage
  was rebuilt, per this repo's own "test the shared logic once" posture
  (ADR-0025).
- `detailPath`/`detailLinkField` is new, generic, reusable machinery — any
  future entity needing "click a row to open a dedicated workspace page"
  gets it via two config fields, not a bespoke screen.
- The `useEntityScope` fix is a real correctness fix that outlives this
  story — `ADR-0058`'s own `/orgs/:orgId/admin/projects` route, previously
  silently broken since that ADR shipped, now also works (same root cause,
  same fix).
- Verified against a live isolated stack (`testnexa-swap-test`, fresh clone
  from `main`): backend integration `test_projects.py` 18/18; live
  `?q=`/schema/create/edit round trips via direct `curl`; a full real-browser
  click-through (login → list → search narrows correctly → row-name link
  into `ProjectDetail` → back → create → edit route → breadcrumb → save →
  back on list) — this is what surfaced the `useEntityScope` bug in the
  first place, confirming the value of the live check over trusting mocks.
  The two edited Playwright specs (`project-create.spec.ts`,
  `ds2-table-container.spec.ts`'s Project-table case) both pass clean when
  run alone (a same-batch run hit this repo's own already-documented
  host-CPU-contention flake on an unrelated, untouched test in the same
  file — confirmed non-regression by rerunning each alone). Frontend
  `tsc --noEmit` clean, full Vitest 73/73 files / 496/496 tests. Backend
  unit 467/467.

## Alternatives considered

- **Keep `/orgs/:orgId/projects` bespoke, only retire the create/search
  gaps.** Rejected per direct instruction — the ask was the full swap.
- **Change the URL to `/orgs/:orgId/admin/projects`** (the already-existing
  generic route) instead of threading an `entityKeyOverride` prop. Rejected
  per direct instruction — keep the existing URL/nav item, no redirect
  needed.
- **A per-entity special case inside `EntityTable` for `Project`'s row-link
  behavior**, instead of the generic `detailPath`/`detailLinkField`
  mechanism. Rejected — `EntityTable` is deliberately entity-agnostic
  (ADR-0025); a hardcoded `if (config.resource === "project")` branch would
  be exactly the kind of one-off special case this component's whole design
  exists to avoid.
