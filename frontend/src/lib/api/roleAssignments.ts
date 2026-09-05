/**
 * RBAC-3 RoleAssignment calls (ADR-0021) + the UI-slice role dropdown source.
 *
 * Source: API Document §2 (`POST`/`GET /orgs/{org_id}/role-assignments`,
 * `GET /orgs/{org_id}/roles` contracts).
 *
 * All three are bespoke and org-path-scoped, same `apiFetch` wrapper shape
 * as `organizations.ts`/`projects.ts` — no cookie involved in any of them.
 */
import { apiFetch } from "./client";

export interface RoleAssignmentSummary {
  id: string;
  actor_id: string;
  org_id: string;
  project_id: string | null;
  role_id: string;
  created_at: string;
}

export interface CreateRoleAssignmentPayload {
  actor_id: string;
  role_id: string;
  project_id?: string;
}

export interface RoleSummary {
  id: string;
  name: string;
  is_system_role: boolean;
}

/**
 * List every `RoleAssignment` (org-wide and project-scoped) in `orgId`.
 *
 * Rejects with an `ApiError`: `404` if the caller has no membership at all
 * in `orgId` (NFR-19), `403 permission_denied` if they're a member but lack
 * `role_assignment.read`.
 */
export async function listRoleAssignments(orgId: string): Promise<RoleAssignmentSummary[]> {
  return apiFetch<RoleAssignmentSummary[]>(`/api/v1/orgs/${orgId}/role-assignments`);
}

/**
 * Grant a Role to an actor in `orgId` — org-wide when `project_id` is
 * omitted, scoped to that Project otherwise (ADR-0021).
 *
 * Rejects with an `ApiError`: `404`/`403` same boundary as
 * `listRoleAssignments`, gated on `role_assignment.create`; `422` on
 * validation failure (`error.body.field_errors.actor_id` /
 * `.role_id` / `.project_id` — cross-org id, unknown actor, non-member
 * `User` actor, or a duplicate grant).
 */
export async function createRoleAssignment(
  orgId: string,
  payload: CreateRoleAssignmentPayload,
): Promise<RoleAssignmentSummary> {
  return apiFetch<RoleAssignmentSummary>(`/api/v1/orgs/${orgId}/role-assignments`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * List every `Role` usable in `orgId` — RBAC-4's 5 seeded system roles plus
 * any custom roles scoped to this org — for the role-assignment form's
 * dropdown. Exactly the set `createRoleAssignment`'s own `role_id`
 * validation accepts.
 *
 * Rejects with an `ApiError`: `404`/`403` same boundary as above, gated on
 * `role.read`.
 */
export async function listRoles(orgId: string): Promise<RoleSummary[]> {
  return apiFetch<RoleSummary[]>(`/api/v1/orgs/${orgId}/roles`);
}
