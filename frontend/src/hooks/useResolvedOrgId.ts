/**
 * SHELL-9 (ADR-0048): resolve the current screen's owning `org_id`, whether
 * the route carries it directly or only names a Project.
 *
 * `AppSidebar`/`AppBreadcrumb` derived all org-scoped nav content from a raw
 * `useParams<{orgId}>()` read. Every route under `/orgs/:orgId/...` has that
 * param; every route under `/projects/:projectId/...` (`ProjectDetail`,
 * `TestPlanDetail`, `TestCycleDetail`, and the 20 project-scoped generic-admin
 * pages) does not — so on every project-scoped screen both components computed
 * an empty nav and a bare, unlinked "Project" crumb, leaving no click-path back
 * to the org's Projects list. This hook closes that gap for both consumers at
 * once.
 *
 * ## Why a new top-level `hooks/` directory
 *
 * This is the first file in `frontend/src/hooks/`. The two existing route-
 * context hooks live where their consumers do — `useAdminRouteContext`/
 * `useEntityScope` inside `pages/admin/` (admin-surface-specific),
 * `usePermissions` inside `auth/` — because each is scoped to one surface. A
 * hook consumed by two `components/organisms/*` siblings with no admin/auth
 * affinity has no such home, so it gets its own top-level one: the same "a new
 * top-level thing earns a home once a second sibling needs it" precedent
 * `container/` set for DS-2's shared `Table` (ADR-0041).
 *
 * ## Why not reuse `useAdminRouteContext`
 *
 * That hook already solves this exact sub-problem — but only for itself, and
 * only typed/scoped around the admin registry (`EntityConfig`, `getEntity`), a
 * dependency `AppSidebar`/`AppBreadcrumb` have no other reason to take on.
 * ADR-0048 deliberately generalizes the *idea* (route param, else fetch the
 * Project and read its `org_id`) into this small registry-free hook rather than
 * refactoring the already-shipped admin resolver — smallest blast radius.
 *
 * ## Cache key: the plain `["project", projectId]`, deliberately
 *
 * NOT `useAdminRouteContext`'s own `["admin-route-project-org-id", projectId]`.
 * The plain entity key is what a page fetching the same row for its own
 * purposes would naturally use, so sidebar + breadcrumb + page collapse to a
 * single `GET /projects/{id}` per page load instead of one per consumer
 * (NFR-53, TC-SHELL-034). The consequence, named in ADR-0048's own Consequences
 * rather than treated as an oversight: on the 20 project-scoped admin pages two
 * differently-keyed queries now fetch the identical row (this hook's key for the
 * shell chrome, the admin resolver's for the page itself). Unifying them is a
 * small future cleanup that touches the shipped admin surface — out of scope
 * here.
 */
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ProjectSummary, getProject } from "../lib/api/projects";

export interface ResolvedOrgContext {
  /**
   * The `:orgId` route param when present, else the fetched Project's own
   * `org_id`, else `undefined` (`/orgs/pick`, or while the fetch is
   * pending/failed).
   */
  orgId: string | undefined;
  /** The `:projectId` route param, if this route has one. */
  projectId: string | undefined;
  /**
   * The fetched Project row — `name` in particular, so `AppBreadcrumb` can
   * render a real name-bearing trail without issuing a second fetch for the
   * same row. `undefined` on org-scoped routes (nothing to fetch) and while a
   * project-scoped fetch is pending or has failed.
   */
  project: ProjectSummary | undefined;
  /**
   * `"success"` whenever `orgId` needed no fetch to resolve (an `:orgId` route,
   * or `/orgs/pick` where the answer is legitimately `undefined`); otherwise the
   * underlying query's own status. Callers use this to distinguish "still
   * loading" from "resolved to nothing" — both of which render the same
   * degraded state today (ADR-0048 Decision §4), but only one of which is
   * permanent.
   */
  status: "pending" | "error" | "success";
}

export function useResolvedOrgId(): ResolvedOrgContext {
  const { orgId, projectId } = useParams<{ orgId?: string; projectId?: string }>();

  // Only fetch when the route can't answer the question itself. `enabled:
  // false` keeps this a no-op on every `/orgs/:orgId/...` screen — the hook
  // costs nothing there beyond the `useParams` read it replaced.
  const shouldFetch = Boolean(projectId) && !orgId;
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId as string),
    enabled: shouldFetch,
  });

  if (!shouldFetch) {
    return { orgId, projectId, project: undefined, status: "success" };
  }

  return {
    orgId: projectQuery.data?.org_id,
    projectId,
    project: projectQuery.data,
    status: projectQuery.status,
  };
}

export default useResolvedOrgId;
