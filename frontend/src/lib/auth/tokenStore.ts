/**
 * AUTH-2 access-token store.
 *
 * Plain module-level state — deliberately NOT React state, NOT
 * `localStorage`/`sessionStorage` (ADR-0003). `apiFetch` (`lib/api/client.ts`)
 * is a plain function with no hooks, so it needs a synchronous, non-React way
 * to read/write the current access token; React consumers (e.g.
 * `AuthContext`) subscribe to change notifications instead of owning the
 * value themselves.
 *
 * The access token still only lives for the tab's lifetime — a page reload
 * loses this module's state entirely, which is exactly why AUTH-2's
 * boot-time silent refresh (Task 4, `AuthContext`) exists: it re-populates
 * this store from the httpOnly refresh-token cookie on mount.
 */

let accessToken: string | null = null;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const callback of subscribers) {
    callback();
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string): void {
  accessToken = token;
  notify();
}

export function clearAccessToken(): void {
  accessToken = null;
  notify();
}

/**
 * Registers `callback` to be invoked on every `setAccessToken`/
 * `clearAccessToken` call. Returns an unsubscribe function.
 */
export function subscribe(callback: () => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}
