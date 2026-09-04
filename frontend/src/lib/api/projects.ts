/**
 * PROJ-1 Project CRUD calls (ADR-0017).
 *
 * Source: API Document §2 (`POST /orgs/{org_id}/projects`, `GET/PATCH
 * /projects/{id}` request/response contracts).
 *
 * Create is bespoke and org-path-scoped (`POST /orgs/{org_id}/projects`,
 * matching `organizations.ts`'s `createOrg` shape exactly); read/update drop
 * `org_id` from the path since the `Project` row itself carries it (ADR-0017
 * Decision §1) — same `apiFetch` wrapper, no `credentials: "include"` needed
 * for any of the three (none of them set a cookie).
 */
import { apiFetch } from "./client";

export interface ProjectSummary {
  id: string;
  org_id: string;
  name: string;
  standards_profile: string | null;
}

export interface CreateProjectPayload {
  name: string;
  standards_profile?: string;
}

export interface UpdateProjectPayload {
  name?: string;
  standards_profile?: string | null;
}

/**
 * Create a Project under `orgId`. Resolves with the new project's
 * `ProjectSummary` on success — `standards_profile`, if omitted from
 * `payload`, is filled in by the backend from the org's
 * `default_standards_profile` (ADR-0017), so the response may carry a value
 * the caller never sent.
 *
 * Rejects with an `ApiError` on failure: `404` if the caller has no
 * membership at all in `orgId` (NFR-19, existence never confirmable across a
 * tenant boundary), `403 permission_denied` if they're a member but lack
 * `project.create`, `422` on a `(org_id, name)` uniqueness collision
 * (`error.body.field_errors.name`).
 */
export async function createProject(orgId: string, payload: CreateProjectPayload): Promise<ProjectSummary> {
  return apiFetch<ProjectSummary>(`/api/v1/orgs/${orgId}/projects`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Fetch a single Project by id. Resolves with its `ProjectSummary` on
 * success.
 *
 * Rejects with an `ApiError` on failure: `404` if the project doesn't exist
 * or the caller has no membership in its owning org (the two are
 * indistinguishable by design, NFR-19), `403 permission_denied` if they're a
 * member of that org but lack `project.read`.
 */
export async function getProject(id: string): Promise<ProjectSummary> {
  return apiFetch<ProjectSummary>(`/api/v1/projects/${id}`);
}

/**
 * Partially update a Project's `name` and/or `standards_profile`. Only the
 * fields present in `payload` are changed — an omitted field is left
 * unchanged server-side, while an explicit `standards_profile: null` clears
 * it (ADR-0017's `exclude_unset` semantics; the same distinction
 * `createProject`'s omitted-vs-supplied handling relies on).
 *
 * Rejects with an `ApiError` on failure: `404`/`403` same boundary as
 * `getProject`, but gated on `project.update`; `422` on a rename collision
 * with another Project's `name` in the same org (`error.body.field_errors.name`).
 */
export async function updateProject(id: string, payload: UpdateProjectPayload): Promise<ProjectSummary> {
  return apiFetch<ProjectSummary>(`/api/v1/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
