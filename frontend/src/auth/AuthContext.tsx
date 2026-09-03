/**
 * AUTH-1 auth state: access token + org-context data from `POST /auth/login`.
 *
 * Held in React state only — never `localStorage`/`sessionStorage` (ADR-0003)
 * — so it lives only for the lifetime of the page (no persisted session yet;
 * refresh-token-based re-auth is AUTH-2+, out of scope here).
 *
 * `login()` resolves `void` on success (state updates happen internally) and
 * rejects with the underlying `ApiError` on failure; callers (e.g. the Login
 * page) catch it and display `error.message`. Consume via `useAuth()`.
 */
import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { login as loginRequest, OrgSummary } from "../lib/api/auth";

interface AuthContextValue {
  accessToken: string | null;
  orgContext: "auto" | "picker" | null;
  orgs: OrgSummary[];
  login: (email: string, password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [orgContext, setOrgContext] = useState<"auto" | "picker" | null>(null);
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await loginRequest(email, password);
    setAccessToken(response.access_token);
    setOrgContext(response.org_context);
    setOrgs(response.orgs);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ accessToken, orgContext, orgs, login }),
    [accessToken, orgContext, orgs, login],
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
