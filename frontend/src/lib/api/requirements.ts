/**
 * REQ-1 Requirement create/list calls (ADR-0022 generic CRUD factory,
 * ADR-0024 `title` field).
 *
 * Source: `app/api/routes/assets.py` / `app/schemas/assets.py` (exact
 * request/response contracts) — mirrors `releases.ts`'s pattern: `project_id`
 * carried in the body on create, as a required query param on list (no
 * `org_id`/`project_id` path segment — the generic factory's item routes are
 * flat, org resolved server-side via `Project.org_id`).
 */
import { apiFetch } from "./client";

export interface RequirementSummary {
  id: string;
  project_id: string;
  title: string;
  description: string;
  external_ref: string | null;
  source: string | null;
}

export interface CreateRequirementPayload {
  title: string;
  description: string;
  external_ref?: string | null;
  source?: string | null;
}

export interface RequirementListResponse {
  items: RequirementSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface ListRequirementsParams {
  page?: number;
  page_size?: number;
  /** Substring search across `title`/`description`/`external_ref`/`source` (ADR-0022/ADR-0024 `?q=`). */
  q?: string;
  /** Exact-match filter (ADR-0022 `filter_fields`). */
  external_ref?: string;
}

/**
 * Create a Requirement scoped to `projectId`. Resolves with the new
 * requirement's `RequirementSummary` on success.
 *
 * Rejects with an `ApiError` on failure: `404` if the caller has no
 * membership at all in the project's org (NFR-1) or the project doesn't
 * exist, `403 permission_denied` if they're a member but lack
 * `requirement.create`, `422` on a missing/invalid field (e.g. no `title`).
 */
export async function createRequirement(
  projectId: string,
  payload: CreateRequirementPayload,
): Promise<RequirementSummary> {
  return apiFetch<RequirementSummary>("/api/v1/requirements", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, ...payload }),
  });
}

/**
 * List Requirements scoped to `projectId`, paginated and optionally
 * searched/filtered. `project_id` is required by the generic factory's
 * `scope_field` enforcement (422 if omitted) — always sent here.
 *
 * Rejects with an `ApiError` on failure: `404`/`403` same boundary as
 * `createRequirement`, gated on `requirement.read`.
 */
export async function listRequirements(
  projectId: string,
  params: ListRequirementsParams = {},
): Promise<RequirementListResponse> {
  const query = new URLSearchParams({ project_id: projectId });
  if (params.page !== undefined) {
    query.set("page", String(params.page));
  }
  if (params.page_size !== undefined) {
    query.set("page_size", String(params.page_size));
  }
  if (params.q) {
    query.set("q", params.q);
  }
  if (params.external_ref) {
    query.set("external_ref", params.external_ref);
  }
  return apiFetch<RequirementListResponse>(`/api/v1/requirements?${query.toString()}`);
}
