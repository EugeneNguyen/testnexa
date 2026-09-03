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

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Fetch `path` (e.g. `/api/health`) against the resolved API base URL and
 * parse the JSON response body as `T`. Throws `ApiError` on a non-2xx
 * response or network failure.
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
    throw new ApiError(`Request to ${url} failed with status ${response.status}`, response.status);
  }

  return (await response.json()) as T;
}
