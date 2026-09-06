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
 * `entityConfigs/project.ts`'s own `scopeResolution` does: fetch the current
 * Project (`GET /projects/{projectId}`, the `project` entity's own `get`
 * method — no bespoke fetch, reuses `entityCrud.getEntity` + the registry)
 * and read its `org_id` off the response.
 */
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { EntityConfig } from "../../entityConfigs/types";
import { EntityRow, getEntity } from "../../lib/api/entityCrud";
import { entityConfigByKey } from "./registry";

export interface AdminRouteContext {
  entityKey: string;
  config: EntityConfig | undefined;
  /** Resolved for permission checks — direct `:orgId` route param, or fetched via the current Project. */
  orgId: string | undefined;
  projectId: string | undefined;
  /** `{orgId, projectId}` — fed straight into `entityCrud`'s `:param` interpolation. */
  routeParams: Record<string, string | undefined>;
}

export function useAdminRouteContext(): AdminRouteContext {
  const params = useParams<{ entity: string; orgId?: string; projectId?: string }>();
  const entityKey = params.entity ?? "";
  const config = entityConfigByKey[entityKey];
  const projectConfig = entityConfigByKey.projects;

  const projectQuery = useQuery({
    queryKey: ["admin-route-project-org-id", params.projectId],
    queryFn: () => getEntity<EntityRow>(projectConfig, params.projectId as string),
    enabled: Boolean(params.projectId) && Boolean(projectConfig) && !params.orgId,
  });

  const orgId = params.orgId ?? (projectQuery.data?.org_id as string | undefined);

  return {
    entityKey,
    config,
    orgId,
    projectId: params.projectId,
    routeParams: { orgId: params.orgId, projectId: params.projectId },
  };
}
