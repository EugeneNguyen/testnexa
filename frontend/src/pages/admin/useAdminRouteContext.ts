/**
 * ADR-0025: shared route/permission-context resolution for `EntityListPage`/
 * `EntityFormPage` — not a page component itself (the ADR's "only two page
 * components on this surface" claim is about `EntityListPage`/
 * `EntityFormPage`; this is their shared internal plumbing).
 *
 * `usePermissions(orgId)` (`auth/usePermissions.ts`) needs an `org_id` to
 * call `GET /orgs/{org_id}/permissions/mine` — trivially available from the
 * route on the 8 org/global-scoped admin pages (`:orgId`), but the 20
 * project-scoped pages (`/projects/:projectId/admin/:entity`) have no
 * `:orgId` segment at all. This resolves it generically, the same way
 * `Project`'s own `scopeResolution` does: fetch the current Project
 * (`GET /projects/{projectId}`, the `project` entity's own `get` method — no
 * bespoke fetch, reuses `entityCrud.getEntity`) and read its `org_id` off the
 * response.
 *
 * **ADR-0053:** both configs this hook needs — the routed `:entity`'s own, and
 * `projects`' (used only to build that org-id-resolution request) — now come
 * from `useEntitySchema()` rather than the deleted `entityConfigByKey` map.
 * Two consequences callers must handle:
 *
 * - `config` is `undefined` *while the schema is in flight*, not only for an
 *   unknown `:entity`. `schemaLoading` disambiguates the two, and both page
 *   components gate on it before their own "Unknown admin entity" branch.
 *   ADR-0053 accepts this new loading state explicitly.
 * - `orgId` resolution on a project-scoped route is now a two-hop chain
 *   (fetch `projects`' schema -> fetch the Project row), so `usePermissions`
 *   starts one request later than it used to. No behavior changes, only
 *   timing; every consumer already tolerated an initially-`undefined` orgId.
 *
 * `label` deliberately stays on `entityLabelByKey` (frontend-static): the nav
 * label must be renderable before any fetch resolves, which is the whole
 * reason ADR-0053 kept the label half in `registry.ts`. The backend's own
 * authoritative label is exposed separately as `schemaLabel` for a caller that
 * wants it *after* the fetch has landed — nothing consumes it today, and a
 * caller that does should fall back to `label`, never render an empty heading
 * while waiting.
 */
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { EntityConfig } from "../../entityConfigs/types";
import { EntityRow, getEntity } from "../../lib/api/entityCrud";
import { entityLabelByKey } from "./registry";
import { useEntitySchema } from "./useEntitySchema";

export interface AdminRouteContext {
  entityKey: string;
  config: EntityConfig | undefined;
  /** Registry's nav-label for this entity (e.g. "Requirements"), or `undefined` for an unknown `:entity`. */
  label: string | undefined;
  /** The backend-served label for this entity — `undefined` until the schema fetch resolves. */
  schemaLabel: string | undefined;
  /** `true` while this entity's schema is being fetched — `config` is `undefined` but the `:entity` may still be valid. */
  schemaLoading: boolean;
  /** Resolved for permission checks — direct `:orgId` route param, or fetched via the current Project. */
  orgId: string | undefined;
  projectId: string | undefined;
  /**
   * `{orgId, projectId}` — fed straight into `entityCrud`'s `:param`
   * interpolation. `orgId` is the **resolved** value (same as this
   * interface's own `orgId` field above), not the raw `:orgId` route
   * param — [ADR-0059](../../../docs/adr/0059-project-generic-admin-create.md):
   * on a project-scoped route the URL carries no `:orgId` segment at all,
   * but `ROUTE_OVERRIDES.projects.createPath` (`/orgs/:orgId/projects`)
   * still needs a real value to interpolate there too, not just on the
   * org-scoped route.
   */
  routeParams: Record<string, string | undefined>;
}

/**
 * ADR-0060: `overrideEntityKey`, for a route with no `:entity` segment at
 * all — `EntityListPage`/`EntityFormPage` mounted at a fixed, entity-specific
 * path (`/orgs/:orgId/projects`, `Project`'s retired-`ProjectsPage`
 * replacement) rather than the generic `/orgs/:orgId/admin/:entity`. Every
 * other admin route still resolves `entityKey` from `params.entity` exactly
 * as before — this is additive, not a behavior change for the generic path.
 */
export function useAdminRouteContext(overrideEntityKey?: string): AdminRouteContext {
  const params = useParams<{ entity: string; orgId?: string; projectId?: string }>();
  const entityKey = overrideEntityKey ?? params.entity ?? "";
  const { config, label: schemaLabel, isLoading: schemaLoading } = useEntitySchema(entityKey);
  const { config: projectConfig } = useEntitySchema("projects");

  const projectQuery = useQuery({
    queryKey: ["admin-route-project-org-id", params.projectId],
    queryFn: () => getEntity<EntityRow>(projectConfig as EntityConfig, params.projectId as string),
    enabled: Boolean(params.projectId) && Boolean(projectConfig) && !params.orgId,
  });

  const orgId = params.orgId ?? (projectQuery.data?.org_id as string | undefined);

  return {
    entityKey,
    config,
    label: entityLabelByKey[entityKey],
    schemaLabel,
    schemaLoading,
    orgId,
    projectId: params.projectId,
    routeParams: { orgId, projectId: params.projectId },
  };
}
