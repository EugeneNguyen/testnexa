/**
 * Thin typed fetch wrapper.
 *
 * API base URL resolution (per ADR-0010, single-port Docker Compose topology):
 * - If `VITE_API_BASE_URL` is set (local non-compose dev), requests go to that
 *   origin, e.g. `http://localhost:8000/api/health`.
 * - Otherwise (docker-compose dev/prod profiles), requests are same-origin —
 *   nginx routes `/api/*` to the backend — so the base URL is `''` and the
 *   request path itself (e.g. `/api/health`) is used as-is.
 */
import { clearAccessToken, getAccessToken, setAccessToken } from "../auth/tokenStore";
// `refresh()` is imported from `./auth`, which itself imports `apiFetch` from
// this module — a real circular import. This is intentional (AUTH-2 plan,
// Task 3) and safe: both sides are function declarations only used inside
// other functions' bodies, never evaluated at module-init time, so the cycle
// resolves fine under ESM/Vite's live-binding semantics.
import { refresh as refreshRequest } from "./auth";

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  status: number;
  /**
   * Parsed JSON response body, if the error response had one and it parsed
   * successfully (e.g. `{code, message, field_errors}` per API Document §1).
   * `undefined` for network failures or a non-JSON/unparseable error body.
   */
  body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export interface ApiFetchOptions extends RequestInit {
  /**
   * Opts this call out of the 401 -> refresh -> retry interceptor below.
   * Set internally by `login()` and `refresh()` (`lib/api/auth.ts`) on their
   * own `apiFetch` calls — those two routes are the only unauthenticated
   * ones (API Document §2), and a 401 from `refresh()` itself must never
   * trigger another refresh attempt (infinite recursion risk otherwise).
   */
  skipAuthRetry?: boolean;
}

/**
 * In-flight refresh promise, shared by every concurrent 401 so a burst of
 * simultaneous unauthorized requests triggers exactly one
 * `POST /auth/refresh` call, not one per request (AUTH-2 plan, Task 3).
 */
let refreshPromise: Promise<{ access_token: string }> | null = null;

function requestRefresh(): Promise<{ access_token: string }> {
  if (!refreshPromise) {
    refreshPromise = refreshRequest().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/**
 * Fetch `path` (e.g. `/api/health`) against the resolved API base URL and
 * parse the JSON response body as `T`. Throws `ApiError` on a non-2xx
 * response or network failure. On a non-2xx response, attempts to parse the
 * JSON body and, if it has a string `message` field (API Document §1 error
 * shape), uses it as the `ApiError` message; otherwise falls back to a
 * generic status-based message. Either way the parsed body (if any) is
 * attached as `ApiError.body` for callers that need finer-grained handling
 * (e.g. a `code` field).
 *
 * Attaches `Authorization: Bearer <token>` from `lib/auth/tokenStore` when a
 * token is present — caller-supplied headers win on conflict, same merge
 * order as the `Content-Type` default below.
 *
 * On a 401 from an authenticated call (i.e. `skipAuthRetry` not set), makes
 * exactly one silent `refresh()` + retry attempt: on success, stores the new
 * access token and retries the original request once; on failure, clears the
 * token store, redirects to `/login`, and rejects with the *original* 401's
 * `ApiError` (the redirect is a side effect — the page navigation unmounts
 * whatever was awaiting this promise anyway).
 */
export async function apiFetch<T>(path: string, init?: ApiFetchOptions): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const token = getAccessToken();

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network request failed";
    throw new ApiError(message, 0);
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // Non-JSON or empty error body — leave `body` undefined.
    }

    const message =
      body !== null &&
      typeof body === "object" &&
      "message" in body &&
      typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : `Request to ${url} failed with status ${response.status}`;

    const error = new ApiError(message, response.status, body);

    if (response.status === 401 && !init?.skipAuthRetry) {
      try {
        const { access_token } = await requestRefresh();
        setAccessToken(access_token);
      } catch {
        clearAccessToken();
        window.location.assign("/login");
        throw error;
      }
      return apiFetch<T>(path, { ...init, skipAuthRetry: true });
    }

    throw error;
  }

  return (await response.json()) as T;
}
