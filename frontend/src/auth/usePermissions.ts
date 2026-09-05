/**
 * ADR-0025 / FR-ADMIN-2 AC4: client-side permission signal, wrapping
 * `GET /orgs/{org_id}/permissions/mine` (`backend/app/api/routes/rbac_routes.py`)
 * in a TanStack Query hook so action buttons can be hidden/disabled
 * *before* an attempt, not just react to a 403 after the fact (the
 * `OrgMembers.tsx` precedent ADR-0025 explicitly declines to repeat for
 * this surface).
 *
 * `has(code, projectId?)` semantics (UI Design Document §5 / ADR-0025's
 * `MyPermissionCode` docstring): a row with `project_id: null` is an
 * org-wide grant and satisfies every project; a row with a non-null
 * `project_id` only satisfies that exact project. This mirrors
 * `has_permission`'s own OR-semantics on the backend (`app/core/rbac.py`)
 * exactly — this hook is a read-only cache of what that check would already
 * return, never a substitute for it (the write call itself is still the
 * real enforcement boundary, per this hook's own docstring precedent in the
 * ADR).
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api/client";

export interface MyPermissionCode {
  code: string;
  project_id: string | null;
}

export interface MyPermissionsResponse {
  codes: MyPermissionCode[];
}

export interface UsePermissionsResult {
  /**
   * Whether the caller holds `code`, either org-wide or (when `projectId` is
   * given) specifically within that project. Always `false` while the
   * underlying query is loading/erroring — a permission-gated affordance
   * stays hidden rather than flashing visible before the real answer
   * arrives (fail-closed, matching the hide-not-disable posture of §5).
   */
  has: (code: string, projectId?: string) => boolean;
  isLoading: boolean;
  error: unknown;
}

export function usePermissions(orgId: string | undefined): UsePermissionsResult {
  const query = useQuery({
    queryKey: ["permissions-mine", orgId],
    queryFn: () => apiFetch<MyPermissionsResponse>(`/api/v1/orgs/${orgId}/permissions/mine`),
    enabled: Boolean(orgId),
  });

  function has(code: string, projectId?: string): boolean {
    const codes = query.data?.codes ?? [];
    return codes.some(
      (row) => row.code === code && (row.project_id === null || row.project_id === projectId),
    );
  }

  return { has, isLoading: query.isLoading, error: query.error };
}
