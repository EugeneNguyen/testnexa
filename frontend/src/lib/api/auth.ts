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
