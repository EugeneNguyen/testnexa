/**
 * SHELL-3 (ADR-0019, FR-SHELL-3/NFR-25) dashboard stat-widget counts.
 *
 * Thin wrappers over the generic-CRUD list endpoints' pagination envelope
 * (API Document §1's `{items, total, page, page_size}` shape — the same
 * shape `lib/api/members.ts`'s `OrgMembersPage` already types for the
 * bespoke `GET /orgs/{org_id}/members` route). `page_size=1` on both calls:
 * only `total` is read, `items` is discarded — requesting the smallest
 * legal page keeps the response cheap without a dedicated count-only
 * endpoint (no new API route, per ADR-0019).
 *
 * Deviation flagged explicitly: `GET /projects` and
 * `GET /org-memberships` are the generic-CRUD factory routes documented in
 * API Document §3 ("Generic CRUD routes (router factory, applied to ~24 of
 * 36 tables)"). As of this story (SHELL-2/3/4), that factory has not
 * shipped in this codebase yet — only PROJ-1's bespoke
 * `POST /orgs/{org_id}/projects` / `GET|PATCH /projects/{id}` (no list) and
 * RBAC-2's bespoke `GET /orgs/{org_id}/members` (no `status` filter) exist.
 * Calling either function below today gets a `404` from the backend, which
 * `OrgHome`'s widgets surface as their explicit error state (NFR-25: never
 * a false zero) rather than a crash. This module is written against the
 * documented target contract, not today's partial backend — once the
 * ADMIN-2 generic-CRUD factory ships these two routes, both widgets start
 * showing real counts with zero frontend changes required.
 */
import { apiFetch } from "./client";

/** API Document §1's generic paginated list-response envelope. */
export interface ListTotalResponse {
  items: unknown[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * `GET /projects?page=1&page_size=1` (generic-CRUD factory, `project.read`).
 * Resolves the caller-visible Project count via the response's `total`
 * field.
 */
export async function getProjectsTotal(): Promise<number> {
  const page = await apiFetch<ListTotalResponse>("/api/v1/projects?page=1&page_size=1");
  return page.total;
}

/**
 * `GET /org-memberships?org_id=<id>&status=active&page=1&page_size=1`
 * (generic-CRUD factory, `org_membership.read`). Resolves `orgId`'s active
 * `OrgMembership` count via the response's `total` field.
 */
export async function getActiveMemberTotal(orgId: string): Promise<number> {
  const query = new URLSearchParams({
    org_id: orgId,
    status: "active",
    page: "1",
    page_size: "1",
  });
  const page = await apiFetch<ListTotalResponse>(`/api/v1/org-memberships?${query.toString()}`);
  return page.total;
}
