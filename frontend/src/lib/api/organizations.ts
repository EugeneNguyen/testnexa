/**
 * RBAC-1 `POST /orgs` call — an existing authenticated actor mints a further
 * Organization (ADR-0016).
 *
 * Source: API Document §2 (`POST /orgs` request/response contract).
 *
 * No `credentials: "include"` — this route sets no cookie, and `apiFetch`
 * attaches `Authorization: Bearer <access_token>` from `lib/auth/tokenStore`
 * automatically for any authenticated call.
 */
import { apiFetch } from "./client";
import { OrgSummary } from "./auth";

export interface CreateOrgPayload {
  name: string;
  slug: string;
}

/**
 * Create a further Organization. Resolves with the new org's `OrgSummary`
 * on success. Rejects with an `ApiError` on failure: `403 permission_denied`
 * if the caller holds `organization.create` in no org they belong to, `422`
 * on a `slug` uniqueness collision (`error.body.field_errors.slug`).
 */
export async function createOrg(payload: CreateOrgPayload): Promise<OrgSummary> {
  return apiFetch<OrgSummary>("/api/v1/orgs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
