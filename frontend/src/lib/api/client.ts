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

/**
 * Fetch `path` (e.g. `/api/health`) against the resolved API base URL and
 * parse the JSON response body as `T`. Throws `ApiError` on a non-2xx
 * response or network failure. On a non-2xx response, attempts to parse the
 * JSON body and, if it has a string `message` field (API Document §1 error
 * shape), uses it as the `ApiError` message; otherwise falls back to a
 * generic status-based message. Either way the parsed body (if any) is
 * attached as `ApiError.body` for callers that need finer-grained handling
 * (e.g. a `code` field).
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
      ...init,
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

    throw new ApiError(message, response.status, body);
  }

  return (await response.json()) as T;
}
