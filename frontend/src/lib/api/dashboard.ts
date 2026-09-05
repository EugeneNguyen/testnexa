/**
 * SHELL-3 (ADR-0020, FR-SHELL-3/NFR-27) dashboard stat-widget counts.
 *
 * Thin wrappers over the generic-CRUD list endpoints' pagination envelope
 * (API Document §1's `{items, total, page, page_size}` shape — the same
 * shape `lib/api/members.ts`'s `OrgMembersPage` already types for the
 * bespoke `GET /orgs/{org_id}/members` route). `page_size=1` on both calls:
 * only `total` is read, `items` is discarded — requesting the smallest
 * legal page keeps the response cheap without a dedicated count-only
 * endpoint (no new API route, per ADR-0020).
 *
 * `GET /projects` and `GET /org-memberships` are the generic-CRUD factory
 * routes documented in API Document §3 (ADR-0022) — both entities are
 * scoped by `org_id`, required as an explicit query param on `list` (no
 * implicit "caller's own org" inference, same posture every other
 * factory-served entity's list route takes), so both functions below take
 * `orgId` and pass it through.
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
 * `GET /projects?org_id=<id>&page=1&page_size=1` (generic-CRUD factory,
 * `project.read`). Resolves `orgId`'s Project count via the response's
 * `total` field.
 */
export async function getProjectsTotal(orgId: string): Promise<number> {
  const query = new URLSearchParams({ org_id: orgId, page: "1", page_size: "1" });
  const page = await apiFetch<ListTotalResponse>(`/api/v1/projects?${query.toString()}`);
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
