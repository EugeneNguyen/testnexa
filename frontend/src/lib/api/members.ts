/**
 * RBAC-2 org-membership API calls (ADR-0017): invite/list/suspend/reactivate/
 * revoke org members, plus the two accept-invite routes.
 *
 * Source: API Document §2 (`GET/POST/PATCH/DELETE /orgs/{org_id}/members*`,
 * `POST /invites/{token}/accept` request/response contracts).
 *
 * Same shape as `lib/api/organizations.ts`/`lib/api/auth.ts`: thin wrappers
 * over `apiFetch`, no bespoke fetch logic here — `apiFetch` already attaches
 * `Authorization: Bearer <access_token>` from `lib/auth/tokenStore` for the
 * authenticated routes, and already normalizes the `{code, message,
 * field_errors}` error shape into `ApiError` for every non-2xx response.
 */
import { apiFetch } from "./client";
import { LoginResponse } from "./auth";

export type MembershipStatus = "invited" | "active" | "suspended";

/**
 * A single row from `GET /orgs/{org_id}/members`'s paginated `items` array
 * (API Document §2). `joined_at` is `null` for a still-`invited` membership —
 * the backend only sets it once the invite is accepted (ADR-0017).
 */
export interface OrgMember {
  membership_id: string;
  user_id: string;
  email: string;
  status: MembershipStatus;
  joined_at: string | null;
}

/**
 * API Document §1's generic paginated list-response envelope
 * (`{items, total, page, page_size}`), typed for the members list.
 */
export interface OrgMembersPage {
  items: OrgMember[];
  total: number;
  page: number;
  page_size: number;
}

export interface ListMembersParams {
  page?: number;
  page_size?: number;
}

/**
 * `GET /orgs/{org_id}/members` (RBAC-2): `org_membership.read`. Same
 * 404-vs-403 boundary as every org-scoped route (NFR-19) — a caller with
 * zero `OrgMembership` in `org_id` gets `404`, one present but missing
 * `org_membership.read` gets `403 permission_denied`.
 */
export async function listMembers(
  orgId: string,
  params: ListMembersParams = {},
): Promise<OrgMembersPage> {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.page_size !== undefined) query.set("page_size", String(params.page_size));
  const qs = query.toString();
  return apiFetch<OrgMembersPage>(`/api/v1/orgs/${orgId}/members${qs ? `?${qs}` : ""}`);
}

export interface InviteMemberPayload {
  email: string;
}

/**
 * `POST /orgs/{org_id}/members/invite` (RBAC-2): `org_membership.create`.
 * `invite_link` is populated (embeds the raw, one-time invite token, shown
 * exactly once) only for the new-email branch — an invite to an email that
 * already resolves to an existing `User` returns `invite_link: null` (that
 * person just self-accepts via `acceptOwnMembership` below, no token
 * involved). `409` if `email` already has any-status membership in this org.
 */
export interface InviteMemberResponse {
  membership_id: string;
  status: "invited";
  invite_link: string | null;
}

export async function inviteMember(
  orgId: string,
  payload: InviteMemberPayload,
): Promise<InviteMemberResponse> {
  return apiFetch<InviteMemberResponse>(`/api/v1/orgs/${orgId}/members/invite`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface AcceptInvitePayload {
  password: string;
}

/**
 * `POST /invites/{token}/accept` (RBAC-2): public, no `Authorization`
 * header — same unauthenticated shape as `login()`/`signup()`
 * (`lib/api/auth.ts`). `credentials: "include"` is required for the same
 * reason those two need it: on success the backend sets the httpOnly
 * `refresh_token` cookie and issues tokens exactly like
 * `POST /auth/login`'s success path, so the response is `LoginResponse`-
 * shaped (reused here rather than a separate type, same rationale
 * `signup()` documents for reusing it). `skipAuthRetry: true` for the same
 * reason `login()`/`signup()` set it — this route's own 401/404 must never
 * trigger `apiFetch`'s refresh-and-retry interceptor.
 *
 * Rejects with an `ApiError` on failure: `404 invite_not_found` for a
 * missing or expired token (deliberately not distinguished, no enumeration
 * value in doing so — ADR-0017).
 */
export async function acceptInvite(
  token: string,
  payload: AcceptInvitePayload,
): Promise<LoginResponse> {
  return apiFetch<LoginResponse>(`/api/v1/invites/${token}/accept`, {
    method: "POST",
    credentials: "include",
    skipAuthRetry: true,
    body: JSON.stringify(payload),
  });
}

/**
 * `POST /orgs/{org_id}/members/{membership_id}/accept` (RBAC-2): the
 * existing-user accept path — authenticated, no `Permission` code, caller
 * must be the `User` the membership targets or `403 actor_forbidden`.
 * `422` if the membership isn't `status = invited`. No token/password
 * involved (the caller already has working credentials), so this resolves
 * `void` rather than a `LoginResponse` — unlike `acceptInvite` above, there
 * is nothing new to store in the token store.
 */
export async function acceptOwnMembership(orgId: string, membershipId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/orgs/${orgId}/members/${membershipId}/accept`, {
    method: "POST",
  });
}

/**
 * The only two legal values `PATCH /orgs/{org_id}/members/{membership_id}`
 * accepts (ADR-0017) — `invited -> active` is reachable only through the
 * two accept routes above, never through this one.
 */
export type MembershipStatusTransition = "active" | "suspended";

/**
 * `PATCH /orgs/{org_id}/members/{membership_id}` (RBAC-2): `org_membership.update`,
 * suspend (`active -> suspended`) or reactivate (`suspended -> active`).
 * Any other requested transition (including `invited -> active`) is `422`.
 */
export async function updateMembershipStatus(
  orgId: string,
  membershipId: string,
  status: MembershipStatusTransition,
): Promise<OrgMember> {
  return apiFetch<OrgMember>(`/api/v1/orgs/${orgId}/members/${membershipId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

/**
 * `DELETE /orgs/{org_id}/members/{membership_id}` (RBAC-2): `org_membership.delete`,
 * revokes a not-yet-accepted invite. Scoped to `status = invited` only —
 * `422` against an `active`/`suspended` membership (this route is not a
 * general remove-member action). `204 No Content` on success, same as
 * `logout()` — `apiFetch<void>` resolves `undefined`.
 */
export async function revokeInvite(orgId: string, membershipId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/orgs/${orgId}/members/${membershipId}`, {
    method: "DELETE",
  });
}
