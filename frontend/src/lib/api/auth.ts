/**
 * AUTH-1 login API call.
 *
 * Source: API Document §2 (`POST /auth/login` request/response contract).
 *
 * `credentials: "include"` is required so the browser accepts the httpOnly
 * `refresh_token` cookie the backend sets on success (ADR-0003) — the
 * refresh token itself is never present in the JSON body, so there is
 * nothing here for the frontend to read or store for it.
 */
import { apiFetch, ApiError } from "./client";

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
}

export interface LoginResponse {
  access_token: string;
  org_context: "auto" | "picker";
  orgs: OrgSummary[];
}

/**
 * Log in with email + password. Resolves with the backend's `LoginResponse`
 * on success. Rejects with an `ApiError` on failure — for 401/403/429 its
 * `message` is the backend's human-readable message (via `apiFetch`); for
 * 422 (Pydantic validation error, a differently-shaped body) it's replaced
 * with a generic "invalid input" message since the backend's `{"detail": [...]}`
 * shape has nothing suitable to surface directly.
 */
export async function login(email: string, password: string): Promise<LoginResponse> {
  try {
    return await apiFetch<LoginResponse>("/api/v1/auth/login", {
      method: "POST",
      credentials: "include",
      skipAuthRetry: true,
      body: JSON.stringify({ email, password }),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      throw new ApiError(
        "Invalid input. Please check your email and password and try again.",
        error.status,
        error.body,
      );
    }
    throw error;
  }
}

export interface RefreshResponse {
  access_token: string;
}

/**
 * AUTH-2 silent refresh call.
 *
 * Source: API Document §2 (`POST /auth/refresh` request/response contract).
 *
 * No request body — the only input is the httpOnly `refresh_token` cookie,
 * hence `credentials: "include"`. Response is `{access_token}` only;
 * `org_context`/`orgs` are not re-sent (the frontend already holds those from
 * `login()`). On a non-2xx response, rejects with `ApiError` — per the API
 * contract every rejection cause (missing/expired/revoked/rotated-out
 * cookie) collapses to a single `401 invalid_refresh_token`, so there is
 * nothing finer-grained for callers to branch on.
 *
 * `skipAuthRetry: true` is required here: `apiFetch`'s 401 interceptor calls
 * this function to recover from a 401, so this call must never itself be
 * subject to that same interceptor (infinite recursion otherwise).
 */
export async function refresh(): Promise<RefreshResponse> {
  return apiFetch<RefreshResponse>("/api/v1/auth/refresh", {
    method: "POST",
    credentials: "include",
    skipAuthRetry: true,
  });
}

export interface MeResponse {
  actor_id: string;
  email: string;
  actor_type: string;
}

/**
 * AUTH-2 identity check.
 *
 * Source: API Document §2 (`GET /auth/me` request/response contract).
 *
 * Requires `Authorization: Bearer <access_token>` — `apiFetch` attaches it
 * automatically from `lib/auth/tokenStore` when a token is present, so this
 * call needs no special handling beyond delegating to `apiFetch`.
 */
export async function me(): Promise<MeResponse> {
  return apiFetch<MeResponse>("/api/v1/auth/me");
}

/**
 * AUTH-3 logout call.
 *
 * Source: API Document §2 (`POST /auth/logout` request/response contract).
 *
 * No request body; `credentials: "include"` so the httpOnly `refresh_token`
 * cookie is sent for the backend to revoke (ADR-0014). Response is
 * `204 No Content` — `apiFetch<void>` resolves with `undefined`.
 *
 * `skipAuthRetry` is deliberately left unset (unlike `login`/`refresh`): if
 * the caller's access token is already expired at click time, letting
 * `apiFetch`'s normal 401→refresh→retry interceptor run is fine — the retry
 * still ends at the same session's (rotated) refresh token being revoked,
 * and if the refresh itself fails, the interceptor's own failure path
 * already clears the token store and redirects, which is what logout wants
 * anyway. See AUTH-3 scope plan §3 for the full edge-case reasoning.
 */
export async function logout(): Promise<void> {
  await apiFetch<void>("/api/v1/auth/logout", {
    method: "POST",
    credentials: "include",
  });
}
