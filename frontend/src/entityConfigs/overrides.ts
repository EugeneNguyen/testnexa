/**
 * ADR-0053: everything about the admin-CRUD surface that stays **frontend-
 * static** after the field-shape migration, i.e. the residue of the old
 * per-entity `entityConfigs/*.ts` files once `GET /entities/{resource}/schema`
 * took over.
 *
 * ADR-0053's split: the backend owns *data shape* (fields, methods, scope,
 * search/filter), the frontend keeps *route wiring* — because route wiring is
 * information architecture, and it doesn't drift the way a field list does
 * (adding a required backend column doesn't imply a URL change).
 *
 * What's left is deliberately tiny:
 *
 * 1. `path` — derivable, not declared. Every entity's REST path is exactly
 *    `/{entityKey}`, verified across all 28 configs before they were deleted
 *    (`crud_factory._resource_path` and the `:entity` route slug are the same
 *    string by construction — `registry.ts`'s own docstring makes this point).
 *    So `pathFor()` below replaces 28 hand-written `path:` lines.
 * 2. `ROUTE_OVERRIDES` — the genuine exceptions, where the real backend route
 *    doesn't fit the `{path}` / `{path}?{scopeField}=` convention at all.
 *    `Release` (`listPath`+`createPath`, fully bespoke, no factory route at
 *    all — see note 3) and, since
 *    [ADR-0059](../../../docs/adr/0059-project-generic-admin-create.md),
 *    `Project` (`createPath` only — its real create is the bespoke
 *    org-path-nested `POST /orgs/{org_id}/projects`, ADR-0017; `list`/`get`/
 *    `update`/`delete` all still fit the plain convention).
 * 3. `STATIC_ENTITY_CONFIGS` — entities with **no backend `CrudEntityConfig`
 *    at all**, so there is nothing for `GET /entities/{resource}/schema` to
 *    derive and no route to fetch. `Release` again, and only `Release`: its
 *    create/list are 100% bespoke (`POST`/`GET /projects/{id}/releases`), so
 *    it never went through the ADR-0022 factory and is explicitly out of
 *    ADR-0053's scope (see `app/api/entity_registry.py`'s own docstring).
 */
import { EntityConfig } from "./types";

/** Every entity's REST path is its `:entity` route slug — see note 1 above. */
export function pathFor(entityKey: string): string {
  return `/${entityKey}`;
}

/**
 * See note 2 — `Release`'s list/create are project-nested, not flat.
 *
 * `projects.createPath` ([ADR-0059](../../../docs/adr/0059-project-generic-admin-create.md)):
 * `Project`'s real create stays the bespoke, org-path-nested
 * `POST /orgs/{org_id}/projects` (ADR-0017) — this override points the
 * generic admin surface's "New" button at that exact path instead of the
 * flat `/projects` a plain org-scoped entity's create would otherwise use,
 * same `:param`-interpolation mechanism `Release`'s own override already
 * established. `list`/`get`/`update`/`delete` all still use the plain
 * `/projects`/`/projects/{id}` paths (unaffected, no override needed).
 */
export const ROUTE_OVERRIDES: Record<string, Pick<EntityConfig, "listPath" | "createPath">> = {
  releases: {
    listPath: "/projects/:projectId/releases",
    createPath: "/projects/:projectId/releases",
  },
  projects: {
    createPath: "/orgs/:orgId/projects",
  },
};

/**
 * See note 3 — the one entity the backend registry deliberately omits, so it
 * keeps a hand-written config. Kept verbatim from the deleted
 * `entityConfigs/release.ts`; it is NOT a fallback/cache for a
 * backend-derivable entity (ADR-0053 rejected that outright as reintroducing
 * the very two-source-of-truth drift it exists to close).
 */
export const STATIC_ENTITY_CONFIGS: Record<string, EntityConfig> = {
  releases: {
    resource: "release",
    path: "/releases",
    listPath: "/projects/:projectId/releases",
    createPath: "/projects/:projectId/releases",
    scopeField: "project_id",
    methods: ["list", "get", "create"],
    // ADR-0053 (sort): all three fields marked `sortable: false` — this
    // entity's `list` (`GET /projects/:projectId/releases`) is a 100%
    // bespoke route, never registered through `crud_factory.make_crud_router`
    // (see this file's own note 3), so it has no `?sort=` support at all. A
    // clickable header here would silently do nothing.
    fields: [
      {
        name: "project_id",
        label: "Project",
        type: "fk",
        refEntity: "project",
        labelField: "name",
        required: true,
        readOnly: true,
        sortable: false,
      },
      { name: "version_label", label: "Version label", type: "string", required: true, sortable: false },
      { name: "target_date", label: "Target date", type: "date", sortable: false },
    ],
  },
};
