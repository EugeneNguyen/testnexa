/**
 * AUTH-1/AUTH-2 auth state: access token + org-context data.
 *
 * The access token itself is NOT held in this component's own `useState` —
 * it lives in the module-level `lib/auth/tokenStore` (so `apiFetch`, a plain
 * function with no hooks, can read/write it synchronously too). This
 * provider subscribes to that store (`tokenStore.subscribe`) purely to
 * re-render when the token changes; the store remains the single source of
 * truth. `orgContext`/`orgs` are still plain local `useState`, set only by
 * `login()` (`POST /auth/login`'s response carries them; nothing else does).
 *
 * AUTH-2 boot-time silent refresh: on mount, this provider calls
 * `POST /auth/refresh` once (via `requestRefresh()`, `lib/api/client.ts` —
 * NOT the raw `refresh()` from `lib/api/auth.ts`) to attempt restoring a
 * session from the httpOnly `refresh_token` cookie — the token store starts
 * empty on every page load (module state, not persisted), so without this
 * call a full page reload would always look logged-out even with a valid
 * refresh cookie still sitting in the browser. `isInitializing` is `true`
 * until that call settles (success or failure), then `false` forever after;
 * `ProtectedRoute` gates rendering on it so that no protected-route content —
 * and therefore no `apiFetch` call a protected page might make — can mount
 * before the boot refresh has had its chance to populate the token store.
 *
 * Calling `requestRefresh()` here specifically (rather than `refresh()`
 * directly) matters beyond just UX: `apiFetch`'s own 401 interceptor and
 * this boot effect now share the exact same in-flight-promise dedup
 * (`requestRefresh`'s `refreshPromise` memoization in `client.ts`). Refresh
 * tokens are single-use (ADR-0013) — without sharing that dedup, this
 * boot-time call and a near-simultaneous interceptor-triggered refresh could
 * each present the same cookie, and one would get spuriously rejected. This
 * is reachable in practice (React StrictMode double-invoking this effect in
 * dev; two tabs cold-loading concurrently in prod) and was fixed after being
 * reproduced by the AUTH-2 E2E suite.
 *
 * On boot-refresh failure — `401 invalid_refresh_token` (no/expired/revoked/
 * rotated-out cookie) or `403 no_active_organization` (org membership lost),
 * treated identically per binding cross-task guidance, no branching on
 * status — this provider does nothing beyond marking initialization
 * settled: it does NOT clear the token store (already empty on a fresh page
 * load, there is nothing to clear) and does NOT redirect. Redirecting is
 * `ProtectedRoute`'s job, only if and when something actually tries to
 * render a protected page.
 *
 * Known simplification (deliberate, not an oversight): `POST /auth/refresh`'s
 * response is `{access_token}` only — no `org_context`/`orgs` — so a
 * successful boot refresh restores the token store (and therefore access to
 * protected routes generally) but NOT `orgContext`/`orgs`, which stay
 * `null`/`[]` until the user logs in again via the `Login` page. Restoring
 * those would require an extra `GET /auth/me` call, but `/auth/me` returns
 * actor identity only (`actor_id`/`email`/`actor_type`), not org membership,
 * so it cannot actually fill this gap — there is no cheap way to recover
 * `org_context`/`orgs` after a reload without a dedicated endpoint that
 * doesn't exist yet. Practical effect: after a page reload, a direct
 * navigation to `/orgs/:orgId` still works (that route only needs the access
 * token), but `/orgs/pick` will render its own already-existing empty-`orgs`
 * redirect back to `/login` (see `OrgPicker.tsx`) until the user's next
 * explicit login. This is an accepted AUTH-2-scope limitation, not a bug.
 *
 * AUTH-3 logout (ADR-0014): `logout()` calls the `POST /auth/logout` API
 * function, then — in a `finally` block, so it runs whether that call
 * resolves or rejects — unconditionally clears the token store
 * (`clearAccessToken()`) and resets `orgContext`/`orgs` back to `null`/`[]`.
 * The client-side clear is what actually protects a shared/public machine,
 * so it must never be skipped just because the network round-trip to revoke
 * the server-side refresh token failed (accepted trade-off, ADR-0014's
 * Consequences section). Any rejection from the API call itself is swallowed
 * here (not rethrown) — logout isn't a security boundary the caller needs to
 * react to failing; the cleanup already happened. Navigation to `/login`
 * afterward is the caller's (the navbar button's) responsibility, not this
 * method's — `logout()` here is scoped to state-clearing only, matching
 * `login()`'s own shape (it doesn't navigate either — `Login.tsx` does that
 * on success). `AppHeader`'s logout button, which lives under
 * `<BrowserRouter>` (`main.tsx`), uses `useNavigate()` itself after awaiting
 * this method.
 */
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { login as loginRequest, logout as logoutRequest, OrgSummary } from "../lib/api/auth";
import { requestRefresh } from "../lib/api/client";
import { clearAccessToken, getAccessToken, setAccessToken as setStoredAccessToken, subscribe } from "../lib/auth/tokenStore";

interface AuthContextValue {
  accessToken: string | null;
  orgContext: "auto" | "picker" | null;
  orgs: OrgSummary[];
  isInitializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(() => getAccessToken());
  const [orgContext, setOrgContext] = useState<"auto" | "picker" | null>(null);
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [isInitializing, setIsInitializing] = useState(true);

  // Re-render whenever the token store changes, from any caller
  // (`login()` here, `apiFetch`'s own interceptor, or the boot refresh
  // below) — the store is the single source of truth, this just mirrors it
  // into React state for consumers of `useAuth()`.
  useEffect(() => subscribe(() => setAccessToken(getAccessToken())), []);

  // Boot-time silent refresh — see docstring above for the full rationale
  // and the documented org-context simplification.
  useEffect(() => {
    let cancelled = false;

    async function bootRefresh() {
      try {
        // Shared with apiFetch's own 401 interceptor (`lib/api/client.ts`)
        // via its in-flight-promise memoization — see that module's
        // docstring on `requestRefresh`. This is deliberate, not
        // incidental: it's what prevents this boot-time call and a
        // near-simultaneous interceptor-triggered refresh (e.g. React
        // StrictMode's double-invoked effects in dev, or two tabs
        // cold-loading at once in prod) from presenting the same
        // single-use refresh cookie (ADR-0013) twice.
        const response = await requestRefresh();
        if (!cancelled) {
          setStoredAccessToken(response.access_token);
        }
      } catch {
        // 401 invalid_refresh_token or 403 no_active_organization: no
        // session to restore. Nothing to clear, nothing to redirect —
        // ProtectedRoute handles gating once isInitializing settles.
      } finally {
        if (!cancelled) {
          setIsInitializing(false);
        }
      }
    }

    void bootRefresh();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await loginRequest(email, password);
    setStoredAccessToken(response.access_token);
    setOrgContext(response.org_context);
    setOrgs(response.orgs);
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // Swallowed deliberately (ADR-0014): logout isn't a security boundary
      // the caller needs to react to failing — the client-side clear below
      // is what actually matters and must run regardless.
    } finally {
      clearAccessToken();
      setOrgContext(null);
      setOrgs([]);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ accessToken, orgContext, orgs, isInitializing, login, logout }),
    [accessToken, orgContext, orgs, isInitializing, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
