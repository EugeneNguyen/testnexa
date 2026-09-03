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
 * `POST /auth/refresh` once (via `refresh()`, `lib/api/auth.ts`) to attempt
 * restoring a session from the httpOnly `refresh_token` cookie — the token
 * store starts empty on every page load (module state, not persisted), so
 * without this call a full page reload would always look logged-out even
 * with a valid refresh cookie still sitting in the browser. `isInitializing`
 * is `true` until that call settles (success or failure), then `false`
 * forever after; `ProtectedRoute` gates rendering on it so that no
 * protected-route content — and therefore no `apiFetch` call a protected
 * page might make — can mount before the boot refresh has had its chance to
 * populate the token store. This ordering matters beyond just UX: `apiFetch`
 * itself dedupes concurrent refreshes it triggers, but that dedup does not
 * cover this boot-time call, so an authenticated `apiFetch` firing while the
 * boot refresh is still in flight could race it and get spuriously
 * rejected against an already-rotated single-use refresh cookie (ADR-0013).
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
import { login as loginRequest, OrgSummary, refresh as refreshRequest } from "../lib/api/auth";
import { getAccessToken, setAccessToken as setStoredAccessToken, subscribe } from "../lib/auth/tokenStore";

interface AuthContextValue {
  accessToken: string | null;
  orgContext: "auto" | "picker" | null;
  orgs: OrgSummary[];
  isInitializing: boolean;
  login: (email: string, password: string) => Promise<void>;
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
        const response = await refreshRequest();
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

  const value = useMemo<AuthContextValue>(
    () => ({ accessToken, orgContext, orgs, isInitializing, login }),
    [accessToken, orgContext, orgs, isInitializing, login],
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
